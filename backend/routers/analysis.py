"""AI-assisted analysis endpoints (message, page screenshot, app, account, breach). Verdicts come from the on-device engines; Gemini only explains."""
from __future__ import annotations

import asyncio
import json
import re
import uuid
from typing import Any, Literal, Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator

from core.config import GEMINI_API_KEY, HIBP_API_KEY, HIGGINS_VOICE, logger

from core.models import ApolloState, DomainInfo, Verdict
from services.intel import assess_indicator, run_intel_check, sanitize_url
from services.webcrawl import CrawlBlocked, fetch_page

router = APIRouter()


# The rule engine runs on-device. The backend adds (a) URL reputation for links found in the message and
# (b) an optional Gemini "second opinion" that only rewrites the explanation in plain language — it never
# overrides the on-device verdict. Message text is sent only when the user taps "Check message"
# (shown in-app as "Shared with Apollo for analysis") and is not stored.
class MessageAnalyseIn(BaseModel):
    device_id: str = Field(min_length=8, max_length=64)
    sender: str = Field(default="", max_length=80)
    text: str = Field(min_length=1, max_length=4000)
    urls: list[str] = Field(default_factory=list, max_length=10)
    local_state: ApolloState
    scenario: str = Field(default="", max_length=40)
    signals: list[str] = Field(default_factory=list, max_length=20)
    claimed_brand: Optional[str] = Field(default=None, max_length=60)
    second_opinion: bool = True


class MessageUrlResult(BaseModel):
    url: str
    host: str
    verdict: Verdict
    threat_types: list[str] = Field(default_factory=list)
    coverage: str
    # Email/Text Guard automatic pre-click assessment (see services/intel.py assess_indicator) —
    # same redirect-chain expansion + RDAP domain-info treatment as a manual Check-a-Link, applied
    # automatically to every link in a checked/scanned message. Presentational context only; never
    # used to derive anything beyond growling/barking (see src/domain/linkGuard.ts on the frontend).
    redirect_chain: list[str] = Field(default_factory=list)
    final_url: Optional[str] = None
    domain_info: Optional[DomainInfo] = None


class MessageAnalyseOut(BaseModel):
    urls: list[MessageUrlResult]
    explanation: Optional[dict[str, Any]] = None  # {summary, why[], recommendation}
    gemini_used: bool = False


GATE2_EXPLAIN_PROMPT = HIGGINS_VOICE + """ You are the calm plain-language security guide for everyday Australians. You will be given a suspicious
message plus the findings of an on-device rule engine. Do NOT change the verdict. Write for a worried, non-technical person.
Return ONLY JSON: {"summary": "<one sentence, max 22 words>", "why": ["<3 short bullets, each max 16 words>"], "recommendation": "<one or two sentences, max 40 words>"}.
Rules: never tell the person to use contact details, links or numbers from the message itself; never promise money can be recovered;
never claim the device is compromised unless the findings say so; if the findings say the message looks normal, say so plainly and avoid alarm."""


# Shared caller for every Gemini "second opinion" (message/app/account) — the explanation only ever
# rewrites the on-device engine's verdict in plain language, so a failure here degrades gracefully to
# None rather than ever blocking or overriding anything. A single transient timeout under concurrent
# load (e.g. several requests hitting the relay at once) is otherwise recoverable and shouldn't silently
# drop an explanation that would normally succeed — one retry before giving up, same philosophy as the
# retry-worth-it check in services/email.py.
async def _gemini_second_opinion_call(*, session_prefix: str, system_message: str, prompt: str, log_label: str, timeout: int = 20, retries: int = 1) -> Optional[dict[str, Any]]:
    if not GEMINI_API_KEY:
        return None
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    last_exc: Optional[Exception] = None
    for attempt in range(retries + 1):
        chat = LlmChat(api_key=GEMINI_API_KEY, session_id=f"{session_prefix}-{uuid.uuid4().hex[:8]}", system_message=system_message).with_model("gemini", "gemini-3-flash-preview")
        try:
            raw = await asyncio.wait_for(chat.send_message(UserMessage(text=prompt)), timeout=timeout)
            txt = raw.strip()
            if txt.startswith("```"):
                txt = txt.strip("`")
                txt = txt[txt.find("{"):txt.rfind("}") + 1]
            data = json.loads(txt)
            why = [str(w)[:160] for w in data.get("why", [])][:4]
            return {"summary": str(data.get("summary", ""))[:200], "why": why, "recommendation": str(data.get("recommendation", ""))[:320]}
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            if attempt < retries:
                logger.info("%s second opinion attempt %d/%d failed (%s), retrying", log_label, attempt + 1, retries + 1, type(exc).__name__)
    logger.warning("%s second opinion unavailable after %d attempt(s): %s", log_label, retries + 1, type(last_exc).__name__ if last_exc else "unknown")
    return None


async def gemini_second_opinion(body: MessageAnalyseIn, url_results: list[MessageUrlResult]) -> Optional[dict[str, Any]]:
    findings = {"state": body.local_state, "scenario": body.scenario, "signals": body.signals, "claimed_brand": body.claimed_brand,
                "urls": [{"host": u.host, "verdict": u.verdict} for u in url_results]}
    prompt = f"Sender: {body.sender or 'unknown'}\nMessage:\n{body.text[:1500]}\n\nRule-engine findings (authoritative):\n{json.dumps(findings)}"
    return await _gemini_second_opinion_call(session_prefix="gate2", system_message=GATE2_EXPLAIN_PROMPT, prompt=prompt, log_label="gate2")


@router.post("/message/analyse", response_model=MessageAnalyseOut)
async def message_analyse(body: MessageAnalyseIn):
    if body.text != '[local-only]' or body.sender or body.second_opinion or body.signals or body.claimed_brand:
        raise HTTPException(403, 'Raw message cloud processing is disabled. Submit minimal origins only.')
    # Email/Text Guard: every link gets the SAME full assessment as a manual Check-a-Link — redirect
    # chain expansion + Safe Browsing/blocklist + RDAP domain-info — automatically, run concurrently
    # so checking several links costs no more latency than the slowest one.
    async def _one(raw: str) -> Optional[MessageUrlResult]:
        try:
            normalized, host = sanitize_url(raw)
        except HTTPException:
            return None
        r = await assess_indicator("url", normalized, True)
        return MessageUrlResult(url=normalized, host=host, verdict=r.verdict, threat_types=r.threat_types, coverage=r.coverage,
                                 redirect_chain=r.redirect_chain, final_url=r.final_url, domain_info=r.domain_info)

    checked = await asyncio.gather(*[_one(u) for u in body.urls[:10]])
    results = [r for r in checked if r is not None]
    explanation = await gemini_second_opinion(body, results) if body.second_opinion else None
    return MessageAnalyseOut(urls=results, explanation=explanation, gemini_used=explanation is not None)


class MessageExtractIn(BaseModel):
    device_id: str = Field(min_length=8, max_length=64)
    image_base64: str = Field(min_length=100, max_length=6_000_000)


GATE2_EXTRACT_PROMPT = """You read screenshots of text messages, chats, emails or QR codes for a security app. Extract exactly what is visible.
Return ONLY JSON: {"sender": "<phone number, name or handle shown, else empty>", "text": "<the message text(s) verbatim, most recent last>",
"urls": ["<every URL or domain visible, including any decoded from a QR code>"], "source": "<sms|whatsapp|imessage|email|messenger|telegram|other>"}.
Do not add commentary. Do not guess text you cannot read."""


@router.post("/message/extract")
async def message_extract(body: MessageExtractIn):
    """Screenshot → text/sender/URLs via Gemini vision. The image is processed once and not stored."""
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=503, detail="Screenshot reading is not configured")
    from emergentintegrations.llm.chat import ImageContent, LlmChat, UserMessage
    chat = LlmChat(api_key=GEMINI_API_KEY, session_id=f"gate2x-{uuid.uuid4().hex[:8]}", system_message=GATE2_EXTRACT_PROMPT).with_model("gemini", "gemini-3-flash-preview")
    try:
        raw = await asyncio.wait_for(chat.send_message(UserMessage(text="Extract the message from this screenshot.", file_contents=[ImageContent(body.image_base64)])), timeout=45)
        txt = raw.strip()
        if "{" in txt:
            txt = txt[txt.find("{"):txt.rfind("}") + 1]
        data = json.loads(txt)
    except Exception as exc:  # noqa: BLE001
        logger.warning("gate2 extract failed: %s", type(exc).__name__)
        raise HTTPException(status_code=502, detail="Couldn't read that screenshot. Try a clearer image or paste the text.") from exc
    return {"sender": str(data.get("sender", ""))[:80], "text": str(data.get("text", ""))[:4000], "urls": [str(u)[:500] for u in data.get("urls", [])][:10], "source": str(data.get("source", "other"))[:20]}


# --------------------------------------------------------------------------- Gate 3 Phase B: page screenshot signals
# Gemini vision extracts *security signals* from a screenshot of a web page (never stored). The on-device
# rule engine (src/domain/pageAnalysis.ts) maps them to W08/W09/W10/W12/W18 and decides the dog state.
class PageExtractIn(BaseModel):
    device_id: str = Field(min_length=8, max_length=64)
    image_base64: str = Field(min_length=100, max_length=6_000_000)
    url_hint: Optional[str] = Field(default=None, max_length=2048)


PAGE_EXTRACT_PROMPT = """You analyse a screenshot of a web page for a consumer security app. Report ONLY what is visible. Return ONLY JSON:
{"visible_url": "<address bar URL/domain if visible, else empty>",
 "claimed_brand": "<organisation/brand the page presents as (logo, name), else empty>",
 "page_type": "<login|payment|shop|security_warning|tech_support|captcha|wallet|download|article|other>",
 "asks_for": ["<any of: password, username, email, card, bank_login, verification_code, personal_id, phone_call, download, install, permission, wallet_connect, payment>"],
 "virus_or_infection_claim": <true|false>,
 "phone_number_to_call": "<phone number the page tells the user to call, else empty>",
 "remote_access_tool": "<AnyDesk/TeamViewer/other tool named, else empty>",
 "captcha_instructions": "<if a 'verify you are human' step tells the user to download, run, paste or install something, describe briefly, else empty>",
 "wallet_connect_request": <true|false>,
 "urgency_or_threat_text": "<short quote of urgent/threatening wording, else empty>",
 "prices_look_unrealistic": <true|false>,
 "payment_methods": ["<e.g. card, bank transfer, crypto, gift card, western union>"],
 "business_identity": "<contact address/ABN/company details if shown, else empty>",
 "os_or_security_branding": "<Apple/Microsoft/Google/McAfee/Norton style security branding used, else empty>",
 "text_excerpt": "<up to 60 words of the main visible text>"}
Never guess. If unreadable, use empty values."""


@router.post("/page/extract")
async def page_extract(body: PageExtractIn):
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=503, detail="Screenshot reading is not configured")
    from emergentintegrations.llm.chat import ImageContent, LlmChat, UserMessage
    chat = LlmChat(api_key=GEMINI_API_KEY, session_id=f"gate3p-{uuid.uuid4().hex[:8]}", system_message=PAGE_EXTRACT_PROMPT).with_model("gemini", "gemini-3-flash-preview")
    hint = f" The user says the address was: {body.url_hint}" if body.url_hint else ""
    try:
        raw = await asyncio.wait_for(chat.send_message(UserMessage(text=f"Extract the security signals from this page screenshot.{hint}", file_contents=[ImageContent(body.image_base64)])), timeout=45)
        txt = raw.strip()
        if "{" in txt:
            txt = txt[txt.find("{"):txt.rfind("}") + 1]
        data = json.loads(txt)
    except Exception as exc:  # noqa: BLE001
        logger.warning("page extract failed: %s", type(exc).__name__)
        raise HTTPException(status_code=502, detail="Couldn't read that screenshot. Try a clearer image.") from exc
    def s_(k: str, n: int = 200) -> str:
        return str(data.get(k) or "")[:n]
    def b_(k: str) -> bool:
        return bool(data.get(k)) and str(data.get(k)).lower() not in ("false", "0", "")
    def l_(k: str) -> list[str]:
        v = data.get(k) or []
        return [str(x)[:40].lower() for x in v][:12] if isinstance(v, list) else []
    return {"visible_url": s_("visible_url", 500), "claimed_brand": s_("claimed_brand", 60), "page_type": s_("page_type", 20).lower(), "asks_for": l_("asks_for"),
            "virus_or_infection_claim": b_("virus_or_infection_claim"), "phone_number_to_call": s_("phone_number_to_call", 40), "remote_access_tool": s_("remote_access_tool", 40),
            "captcha_instructions": s_("captcha_instructions", 200), "wallet_connect_request": b_("wallet_connect_request"), "urgency_or_threat_text": s_("urgency_or_threat_text", 200),
            "prices_look_unrealistic": b_("prices_look_unrealistic"), "payment_methods": l_("payment_methods"), "business_identity": s_("business_identity", 200),
            "os_or_security_branding": s_("os_or_security_branding", 60), "text_excerpt": s_("text_excerpt", 400)}


# --------------------------------------------------------------------------- Gate 3 Phase C: "Let Apollo read the page"
# Manual, opt-in alternative to the screenshot flow: Apollo fetches the link's page content directly
# (SSRF-safe, see services/webcrawl.py) instead of the user taking a screenshot. The fetched HTML is
# held only for this request and DISCARDED once the signals below are produced — never stored, never
# cached. Output uses the exact same PageSignals shape as /page/extract so the frontend's existing
# on-device rule engine (src/domain/pageAnalysis.ts) stays the sole, authoritative decision-maker;
# Gemini here only reports what it saw (signals) plus a purely descriptive "higgins_note" — no verdict.
class PageCrawlIn(BaseModel):
    device_id: str = Field(min_length=8, max_length=64)
    url: str = Field(min_length=1, max_length=2048)


CRAWL_ERROR_DETAIL = {
    "invalid_url": "Only http and https links can be read.",
    "private_target": "That address points at a private or internal network — Apollo won't fetch it.",
    "dns_failed": "Apollo couldn't find that address.",
    "redirect_no_location": "That page redirected without saying where to.",
    "too_many_redirects": "That page redirected too many times.",
    "not_html": "That link isn't a web page Apollo can read (not HTML).",
    "fetch_failed": "Apollo couldn't reach that page.",
    "timeout": "That page took too long to answer.",
    "not_configured": "Reading pages isn't configured on this build.",
    "extract_failed": "Apollo read the page but couldn't make sense of it.",
}

PAGE_CRAWL_EXTRACT_PROMPT = """You analyse TEXT Apollo fetched directly from a web page (not a screenshot, not vision) for a consumer
security app. You are given: the page title, a truncated excerpt of its visible text, the types of input fields found on the page
(password/email/tel — never their values), button/submit labels, and a sample of outbound link hostnames. Report ONLY what is present
in what you were given. Return ONLY JSON:
{"claimed_brand": "<organisation/brand the page presents as (from its title/text/branding), else empty>",
 "page_type": "<login|payment|shop|security_warning|tech_support|captcha|wallet|download|article|other>",
 "asks_for": ["<any of: password, username, email, card, bank_login, verification_code, personal_id, phone_call, download, install, permission, wallet_connect, payment — inferred only from the input field types and text given>"],
 "virus_or_infection_claim": <true|false>,
 "phone_number_to_call": "<phone number the text tells the user to call, else empty>",
 "remote_access_tool": "<AnyDesk/TeamViewer/other tool named in the text, else empty>",
 "captcha_instructions": "<if the text describes a 'verify you are human' step that tells the user to download, run, paste or install something, describe briefly, else empty>",
 "wallet_connect_request": <true|false>,
 "urgency_or_threat_text": "<short quote of urgent/threatening wording from the text, else empty>",
 "prices_look_unrealistic": <true|false>,
 "payment_methods": ["<e.g. card, bank transfer, crypto, gift card, western union>"],
 "business_identity": "<contact address/ABN/company details if present in the text, else empty>",
 "os_or_security_branding": "<Apple/Microsoft/Google/McAfee/Norton style security branding used, else empty>",
 "text_excerpt": "<up to 60 words of the main visible text>",
 "higgins_note": "<one or two calm, plain-English sentences describing what Apollo found on this page, for a worried non-technical
 person — purely descriptive of what's there, never a verdict, warning or instruction; the decision belongs to Apollo's on-device engine>"}
Never guess beyond what's given. If a field isn't present in the given content, use an empty/false value."""


@router.post("/page/crawl")
async def page_crawl(body: PageCrawlIn):
    try:
        normalized, _host = sanitize_url(body.url)
    except HTTPException:
        return {"error": "invalid_url", "detail": CRAWL_ERROR_DETAIL["invalid_url"], "signals": None, "higgins_note": None, "final_url": None, "gemini_used": False}
    try:
        page = await asyncio.wait_for(fetch_page(normalized), timeout=14)
    except CrawlBlocked as exc:
        logger.info("page crawl blocked: %s", exc.reason)
        return {"error": exc.reason, "detail": CRAWL_ERROR_DETAIL.get(exc.reason, "Apollo couldn't read that page."), "signals": None, "higgins_note": None, "final_url": None, "gemini_used": False}
    except asyncio.TimeoutError:
        return {"error": "timeout", "detail": CRAWL_ERROR_DETAIL["timeout"], "signals": None, "higgins_note": None, "final_url": None, "gemini_used": False}
    if not GEMINI_API_KEY:
        return {"error": "not_configured", "detail": CRAWL_ERROR_DETAIL["not_configured"], "signals": None, "higgins_note": None, "final_url": page.final_url, "gemini_used": False}
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    content = (f"Page title: {page.title or '(none)'}\nVisible text (truncated, up to 6000 chars): {page.text[:4000] or '(none)'}\n"
               f"Form field types present: {', '.join(page.forms) or 'none'}\nButton/submit labels: {', '.join(page.buttons) or 'none'}\n"
               f"Outbound link hostnames sample: {', '.join(page.links_sample) or 'none'}\nFinal address after redirects: {page.final_url}")
    chat = LlmChat(api_key=GEMINI_API_KEY, session_id=f"gate3crawl-{uuid.uuid4().hex[:8]}", system_message=PAGE_CRAWL_EXTRACT_PROMPT).with_model("gemini", "gemini-3-flash-preview")
    try:
        raw = await asyncio.wait_for(chat.send_message(UserMessage(text=content)), timeout=25)
        txt = raw.strip()
        if "{" in txt:
            txt = txt[txt.find("{"):txt.rfind("}") + 1]
        data = json.loads(txt)
    except Exception as exc:  # noqa: BLE001
        logger.warning("page crawl-extract failed: %s", type(exc).__name__)
        return {"error": "extract_failed", "detail": CRAWL_ERROR_DETAIL["extract_failed"], "signals": None, "higgins_note": None, "final_url": page.final_url, "gemini_used": False}

    def s_(k: str, n: int = 200) -> str:
        return str(data.get(k) or "")[:n]

    def b_(k: str) -> bool:
        return bool(data.get(k)) and str(data.get(k)).lower() not in ("false", "0", "")

    def l_(k: str) -> list[str]:
        v = data.get(k) or []
        return [str(x)[:40].lower() for x in v][:12] if isinstance(v, list) else []

    signals = {
        "visible_url": page.final_url[:500], "claimed_brand": s_("claimed_brand", 60), "page_type": s_("page_type", 20).lower(), "asks_for": l_("asks_for"),
        "virus_or_infection_claim": b_("virus_or_infection_claim"), "phone_number_to_call": s_("phone_number_to_call", 40), "remote_access_tool": s_("remote_access_tool", 40),
        "captcha_instructions": s_("captcha_instructions", 200), "wallet_connect_request": b_("wallet_connect_request"), "urgency_or_threat_text": s_("urgency_or_threat_text", 200),
        "prices_look_unrealistic": b_("prices_look_unrealistic"), "payment_methods": l_("payment_methods"), "business_identity": s_("business_identity", 200),
        "os_or_security_branding": s_("os_or_security_branding", 60), "text_excerpt": s_("text_excerpt", 400) or page.text[:400],
    }
    return {"error": None, "detail": None, "signals": signals, "higgins_note": s_("higgins_note", 300) or None, "final_url": page.final_url, "gemini_used": True}


# ---------------------------------------------------------------------------
# Gate 7 — Apps & Device: reputation hints + SDK-host intel + Gemini plain-language second opinion.
# The on-device App & Device Engine is authoritative; nothing here overrides its verdict.
# ---------------------------------------------------------------------------

REMOTE_ACCESS_TOOLS = ["anydesk", "teamviewer", "quicksupport", "rustdesk", "airdroid", "airmirror", "supremo", "splashtop", "logmein", "rescue", "zoho assist", "ultraviewer", "remote desktop", "alpemix", "aweray", "hoptodesk"]
SECURITY_VENDORS = ["google authenticator", "microsoft authenticator", "authy", "1password", "bitwarden", "lastpass", "dashlane", "proton", "nordvpn", "expressvpn", "mullvad", "surfshark", "malwarebytes", "norton", "mcafee", "bitdefender", "kaspersky", "avast", "lookout", "okta verify", "duo mobile"]
APP_BRANDS = ["commbank", "westpac", "anz", "nab", "paypal", "auspost", "linkt", "ato", "mygov", "centrelink", "medicare", "telstra", "optus", "whatsapp", "netflix", "amazon", "microsoft", "apple", "google", "facebook", "instagram"]


class AppAnalyseIn(BaseModel):
    device_id: str = Field(min_length=8, max_length=64)
    name: str = Field(min_length=1, max_length=120)
    developer: Optional[str] = Field(default=None, max_length=120)
    source: str = Field(default="not_sure", max_length=30)
    purpose: str = Field(default="other", max_length=30)
    permissions: list[str] = Field(default_factory=list, max_length=20)
    hosts: list[str] = Field(default_factory=list, max_length=10)
    local_state: ApolloState
    scenario: str = Field(default="", max_length=40)
    second_opinion: bool = True


class AppHostResult(BaseModel):
    host: str
    verdict: Verdict
    threat_types: list[str] = Field(default_factory=list)
    coverage: str


class AppReputation(BaseModel):
    remote_access_tool: Optional[str] = None
    known_security_vendor: Optional[str] = None
    impersonates_brand: Optional[str] = None
    official_store: bool
    note: str


class AppAnalyseOut(BaseModel):
    reputation: AppReputation
    hosts: list[AppHostResult]
    explanation: Optional[dict[str, Any]] = None
    gemini_used: bool = False


GATE7_EXPLAIN_PROMPT = HIGGINS_VOICE + """ You are the calm plain-language security guide for everyday Australians. You will be given facts about an app
someone installed (name, source, claimed purpose, permissions) plus the findings of an on-device App & Device Engine. Do NOT change the verdict.
Explain permissions in plain words (what they let the app do to the person), never jargon. Write for a worried, non-technical person.
Return ONLY JSON: {"summary": "<one sentence, max 22 words>", "why": ["<3 short bullets, each max 16 words>"], "recommendation": "<one or two sentences, max 40 words>"}.
Rules: never call an app malware unless the findings say a dangerous connection or impersonation was confirmed; never say an app is safe just because
it is in a store; if the findings say the app looks fine, say so plainly and avoid alarm; never tell the person to trust a caller or a link."""


def app_reputation(body: AppAnalyseIn) -> AppReputation:
    n = body.name.lower()
    compact = re.sub(r"[^a-z0-9]", "", n)
    remote = next((t for t in REMOTE_ACCESS_TOOLS if t in n), None)
    vendor = next((v for v in SECURITY_VENDORS if v in n), None)
    brand = next((b for b in APP_BRANDS if b in compact), None)
    official = body.source in ("app_store", "play_store")
    impersonates = brand.capitalize() if brand and not official and not vendor else None
    if remote:
        note = f"{remote.title()} is a genuine remote-control tool — and the tool scammers most often ask people to install. Legitimate only when you sought the help yourself."
    elif impersonates:
        note = f"Uses {impersonates}'s name but wasn't installed from {impersonates}'s official store listing."
    elif vendor:
        note = f"{vendor.title()} is a well-known security vendor. Still check that the developer name in the store matches."
    elif official:
        note = "Store presence is a useful signal, not proof of safety."
    else:
        note = "No reputation information for this name. Unknown is not the same as dangerous."
    return AppReputation(remote_access_tool=remote.title() if remote else None, known_security_vendor=vendor.title() if vendor else None, impersonates_brand=impersonates, official_store=official, note=note)


async def gemini_app_opinion(body: AppAnalyseIn, rep: AppReputation, hosts: list[AppHostResult]) -> Optional[dict[str, Any]]:
    findings = {"state": body.local_state, "scenario": body.scenario, "reputation": rep.model_dump(), "hosts": [{"host": h.host, "verdict": h.verdict} for h in hosts]}
    prompt = (f"App: {body.name}\nDeveloper: {body.developer or 'unknown'}\nSource: {body.source}\nClaimed purpose: {body.purpose}\n"
              f"Permissions: {', '.join(body.permissions) or 'none'}\n\nEngine findings (authoritative):\n{json.dumps(findings)}")
    return await _gemini_second_opinion_call(session_prefix="gate7", system_message=GATE7_EXPLAIN_PROMPT, prompt=prompt, log_label="gate7")


@router.post("/app/analyse", response_model=AppAnalyseOut)
async def app_analyse(body: AppAnalyseIn):
    rep = app_reputation(body)
    hosts: list[AppHostResult] = []
    for raw in body.hosts[:10]:
        try:
            _, host = sanitize_url(raw if "://" in raw else f"https://{raw}")
            r = await run_intel_check("domain", host)
            hosts.append(AppHostResult(host=host, verdict=r.verdict, threat_types=r.threat_types, coverage=r.coverage))
        except HTTPException:
            continue
    explanation = await gemini_app_opinion(body, rep, hosts) if body.second_opinion else None
    return AppAnalyseOut(reputation=rep, hosts=hosts, explanation=explanation, gemini_used=explanation is not None)


# ---------------------------------------------------------------------------
# Gate 8 — Account Guard: link intel + official-domain match for pasted alerts, optional Gemini plain-language
# second opinion (never overrides), and breach exposure via HIBP when a key is configured. No passwords, ever.
# ---------------------------------------------------------------------------

OFFICIAL_DOMAINS: dict[str, list[str]] = {
    "microsoft": ["microsoft.com", "live.com", "microsoftonline.com", "outlook.com", "office.com"],
    "google": ["google.com", "gmail.com", "youtube.com"],
    "apple": ["apple.com", "icloud.com"],
    "bank": ["commbank.com.au", "westpac.com.au", "anz.com", "anz.com.au", "nab.com.au"],
    "paypal": ["paypal.com", "paypal.com.au"],
    "facebook": ["facebook.com", "fb.com", "instagram.com", "meta.com"],
    "mygov": ["my.gov.au", "servicesaustralia.gov.au", "ato.gov.au"],
    "other": [],
}


class AccountAnalyseIn(BaseModel):
    device_id: str = Field(min_length=8, max_length=64)
    kind: str = Field(default="other", max_length=30)
    provider: str = Field(default="other", max_length=30)
    sender: str = Field(default="", max_length=80)
    text: str = Field(default="", max_length=4000)
    urls: list[str] = Field(default_factory=list, max_length=10)
    local_state: ApolloState
    scenario: str = Field(default="", max_length=40)
    second_opinion: bool = True

    @field_validator("text")
    @classmethod
    def no_passwords(cls, v: str) -> str:
        # Never persist or forward anything that looks like a shared password. Apollo doesn't want it.
        return re.sub(r"(?i)(password|passcode|pin)\s*[:=]\s*\S+", r"\1: [removed]", v)


class AccountUrlResult(BaseModel):
    url: str
    host: str
    verdict: Verdict
    threat_types: list[str] = Field(default_factory=list)
    coverage: str
    official: bool


class AccountAnalyseOut(BaseModel):
    urls: list[AccountUrlResult]
    explanation: Optional[dict[str, Any]] = None
    gemini_used: bool = False


GATE8_EXPLAIN_PROMPT = HIGGINS_VOICE + """ You are the calm plain-language security guide for everyday Australians. You will be given an account-security
alert (login prompt, MFA request, password reset, breach notice…) plus the findings of an on-device Identity & Account Engine. Do NOT change the verdict.
Write for a worried, non-technical person. Return ONLY JSON: {"summary": "<one sentence, max 22 words>", "why": ["<3 short bullets, each max 16 words>"],
"recommendation": "<one or two sentences, max 40 words>"}. Rules: never tell the person to use links, numbers or buttons from the alert itself; always say to open
the service's own app or type its address; never say the account is definitely compromised unless the findings say a code or password was shared;
never ask for or mention their password value; if the findings say the alert looks normal, say so plainly."""


async def gemini_account_opinion(body: AccountAnalyseIn, urls: list[AccountUrlResult]) -> Optional[dict[str, Any]]:
    findings = {"state": body.local_state, "scenario": body.scenario, "kind": body.kind, "provider": body.provider, "urls": [{"host": u.host, "verdict": u.verdict, "official": u.official} for u in urls]}
    prompt = f"Sender: {body.sender or 'unknown'}\nAlert text:\n{body.text[:1500] or '(none shared)'}\n\nEngine findings (authoritative):\n{json.dumps(findings)}"
    return await _gemini_second_opinion_call(session_prefix="gate8", system_message=GATE8_EXPLAIN_PROMPT, prompt=prompt, log_label="gate8")


@router.post("/account/analyse", response_model=AccountAnalyseOut)
async def account_analyse(body: AccountAnalyseIn):
    if body.text not in ('', '[local-only]') or body.sender or body.second_opinion:
        raise HTTPException(403, 'Raw account-alert cloud processing is disabled. Submit minimal origins only.')
    official = OFFICIAL_DOMAINS.get(body.provider, [])
    results: list[AccountUrlResult] = []
    for raw in body.urls[:10]:
        try:
            normalized, host = sanitize_url(raw)
            r = await run_intel_check("url", normalized)
            is_official = any(host == d or host.endswith(f".{d}") for d in official)
            results.append(AccountUrlResult(url=normalized, host=host, verdict=r.verdict, threat_types=r.threat_types, coverage=r.coverage, official=is_official))
        except HTTPException:
            continue
    explanation = await gemini_account_opinion(body, results) if body.second_opinion else None
    return AccountAnalyseOut(urls=results, explanation=explanation, gemini_used=explanation is not None)


class BreachCheckIn(BaseModel):
    device_id: str = Field(min_length=8, max_length=64)
    identifier: str = Field(min_length=3, max_length=254)


class BreachCheckOut(BaseModel):
    status: Literal["not_configured", "clear", "found", "unavailable"]
    breaches: list[dict[str, Any]] = Field(default_factory=list)
    password_exposed: bool = False
    detail: str


@router.post("/account/breach", response_model=BreachCheckOut)
async def account_breach(body: BreachCheckIn):
    """Breach exposure lookup (HIBP). The identifier is forwarded once and never stored or logged."""
    if not HIBP_API_KEY:
        return BreachCheckOut(status="not_configured", detail="Breach intelligence isn't connected on this build. Apollo won't guess — you can check haveibeenpwned.com yourself.")
    ident = body.identifier.strip().lower()
    try:
        async with httpx.AsyncClient(timeout=12) as client:
            r = await client.get(f"https://haveibeenpwned.com/api/v3/breachedaccount/{ident}", params={"truncateResponse": "false"},
                                 headers={"hibp-api-key": HIBP_API_KEY, "user-agent": "Apollo-GuardDog"})
    except httpx.HTTPError:
        return BreachCheckOut(status="unavailable", detail="The breach service didn't answer. Try again later.")
    if r.status_code == 404:
        return BreachCheckOut(status="clear", detail="No known breach lists this account. That's good — not a guarantee.")
    if r.status_code != 200:
        return BreachCheckOut(status="unavailable", detail="The breach service is unavailable right now.")
    data = r.json()
    breaches = [{"name": b.get("Title") or b.get("Name"), "date": b.get("BreachDate"), "data": (b.get("DataClasses") or [])[:8]} for b in data[:20]]
    pw = any("Passwords" in (b.get("DataClasses") or []) for b in data)
    return BreachCheckOut(status="found", breaches=breaches, password_exposed=pw, detail=f"Found in {len(data)} known breach{'es' if len(data) != 1 else ''}.{' At least one included passwords.' if pw else ''}")
