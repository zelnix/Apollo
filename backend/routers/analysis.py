"""Compatibility analysis endpoints. Local observations and revisable Gemini assessments remain distinct."""
from __future__ import annotations

import asyncio
import io
import re
from datetime import datetime, timezone
from typing import Any, Literal, Optional

import httpx
from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel, Field, field_validator
from google.genai import types

from core.config import GEMINI_API_KEY, HIBP_API_KEY, logger

from core.models import ApolloState, DomainInfo, Verdict
from services.intel import assess_indicator, run_intel_check, sanitize_url
from services.breach_check import active_provider, scan_email, source_label
from services.webcrawl import CrawlBlocked, fetch_page
from services.investigation import InvestigationResult, extract_message_screenshot, investigate_message, purpose_limited_url
from services.higgins.provider import ProviderFailure, VISION_MODEL, generate_json
from services.higgins.llm_boundary import Purpose
from services.higgins.capacity import TEXT, ITEMS, bounded_analysis

router = APIRouter()


# The rule engine runs on-device. The backend adds (a) URL reputation for links found in the message and
# (b) an optional Gemini "second opinion" that only rewrites the explanation in plain language — it never
# overrides the on-device verdict. Message text is sent only when the user taps "Check message"
# (shown in-app as "Shared with Apollo for analysis") and is not stored.
class MessageAnalyseIn(BaseModel):
    device_id: str = Field(min_length=8, max_length=64)
    sender: str = Field(default="", max_length=TEXT.value)
    text: str = Field(min_length=1, max_length=TEXT.value)
    urls: list[str] = Field(default_factory=list, max_length=ITEMS.value)
    local_state: ApolloState
    scenario: str = Field(default="", max_length=40)
    signals: list[str] = Field(default_factory=list, max_length=20)
    claimed_brand: Optional[str] = Field(default=None, max_length=60)
    second_opinion: bool = True

    @field_validator("urls")
    @classmethod
    def redact_url_secrets(cls, values: list[str]) -> list[str]:
        try:
            return [purpose_limited_url(value) for value in values]
        except ValueError as exc:
            raise ValueError(str(exc)) from exc


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
    ai_used: bool = False
    assessment: InvestigationResult


class LinkInvestigateIn(BaseModel):
    device_id: str = Field(min_length=8, max_length=64)
    url: str = Field(min_length=1, max_length=2048)
    local_state: ApolloState
    local_findings: list[str] = Field(default_factory=list, max_length=12)
    claimed_brand: Optional[str] = Field(default=None, max_length=60)
    second_opinion: bool = True

    @field_validator("url")
    @classmethod
    def redact_link_secrets(cls, value: str) -> str:
        try:
            return purpose_limited_url(value)
        except ValueError as exc:
            raise ValueError(str(exc)) from exc


@router.post("/message/analyse", response_model=MessageAnalyseOut)
@bounded_analysis
async def message_analyse(body: MessageAnalyseIn, request: Request):
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

    semaphore = asyncio.Semaphore(3)
    async def bounded_one(url: str):
        async with semaphore:
            return await _one(url)
    checked = await asyncio.gather(*[bounded_one(u) for u in body.urls])
    results = [r for r in checked if r is not None]
    url_context = [{"url": result.url, "host": result.host, "verdict": result.verdict,
                    "coverage": result.coverage, "threat_types": result.threat_types,
                    "redirect_chain": result.redirect_chain, "final_url": result.final_url} for result in results]
    assessment = await investigate_message(sender=body.sender, text=body.text, urls=body.urls,
        claimed_brand=body.claimed_brand, local_state=body.local_state, url_context=url_context,
        use_model=body.second_opinion, locale=request.state.device.get("locale"))
    explanation = {"summary": assessment.higgins.headline, "why": assessment.higgins.why_it_matters,
                   "recommendation": assessment.higgins.next_action}
    model_used = bool(assessment.processing.get("model_used"))
    return MessageAnalyseOut(urls=results, explanation=explanation, gemini_used=model_used, ai_used=model_used, assessment=assessment)


@router.post("/link/investigate", response_model=InvestigationResult)
@bounded_analysis
async def link_investigate(body: LinkInvestigateIn, request: Request):
    """One disclosed, request-scoped link investigation. Raw URL context is never persisted here."""
    del body.device_id
    normalized, host = sanitize_url(body.url)
    intel = await assess_indicator("url", normalized, True)
    url_context = [{"url": normalized, "host": host, "verdict": intel.verdict,
                    "coverage": intel.coverage, "threat_types": intel.threat_types,
                    "redirect_chain": intel.redirect_chain, "final_url": intel.final_url}]
    return await investigate_message(sender="", text=f"Submitted link: {body.url}", urls=[body.url],
        claimed_brand=body.claimed_brand, local_state=body.local_state, url_context=url_context,
        local_findings=body.local_findings, use_model=body.second_opinion,
        locale=request.state.device.get("locale"))


@router.post("/message/extract")
@bounded_analysis
async def message_extract(device_id: str = Form(min_length=8, max_length=64),
                          sanitization_status: str = Form(default=""),
                          sanitization_receipt_id: str = Form(default=""),
                          sanitization_digest: str = Form(default=""),
                          file: UploadFile = File(...)):
    """Request-scoped screenshot OCR. Upload spooling is closed/deleted in every exit path."""
    del device_id  # anonymous device authorises this one disclosed assessment; never persisted here
    # ── Backend pipeline enforcement: screenshot uploads MUST include valid sanitisation receipt ──
    if sanitization_status != "approved":
        await file.close()
        raise HTTPException(422, "Screenshot uploads must pass through the on-device privacy gate.")
    if not sanitization_receipt_id or len(sanitization_receipt_id) < 8:
        await file.close()
        raise HTTPException(422, "Missing or invalid sanitisation receipt. Image rejected.")
    if not sanitization_digest or len(sanitization_digest) < 16:
        await file.close()
        raise HTTPException(422, "Missing or invalid sanitisation digest. Image rejected.")
    if file.content_type not in {"image/png", "image/jpeg", "image/webp"}:
        await file.close()
        raise HTTPException(415, "Choose a PNG, JPEG or WebP screenshot.")
    try:
        data = await file.read(6_000_001)
        if len(data) > 6_000_000:
            raise HTTPException(413, "Screenshot is larger than 6 MB.")
        if len(data) < 64:
            raise HTTPException(422, "That screenshot is empty or unreadable.")
        from PIL import Image
        with Image.open(io.BytesIO(data)) as image:
            image.verify()
            if image.width * image.height > 24_000_000:
                raise HTTPException(413, "Screenshot dimensions are too large.")
        with Image.open(io.BytesIO(data)) as image:
            image.load()
            image.thumbnail((2048, 2048))
            rendered = io.BytesIO()
            image.convert("RGB").save(rendered, format="JPEG", quality=90, optimize=True)
            processed = rendered.getvalue()
        return await extract_message_screenshot(processed)
    except HTTPException:
        raise
    except ProviderFailure as exc:
        raise HTTPException(503 if exc.code == 'provider_configuration' else 502,
                            f'Higgins screenshot processing did not complete ({exc.code}). The image was not assessed.') from exc
    except Exception as exc:  # noqa: BLE001
        logger.warning("message screenshot extraction failed: %s", type(exc).__name__)
        raise HTTPException(status_code=502, detail="Couldn't read that screenshot. Try a clearer image or paste the text.") from exc
    finally:
        data = b"" if "data" in locals() else b""
        processed = b"" if "processed" in locals() else b""
        await file.close()


# --------------------------------------------------------------------------- Gate 3 Phase B: page screenshot signals
# Gemini vision extracts *security signals* from a screenshot of a web page (never stored). The on-device
# rule engine (src/domain/pageAnalysis.ts) maps them to W08/W09/W10/W12/W18 and decides the dog state.
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
@bounded_analysis
async def page_extract(device_id: str = Form(min_length=8, max_length=64), url_hint: str = Form(default="", max_length=2048),
                       sanitization_status: str = Form(default=""),
                       sanitization_receipt_id: str = Form(default=""),
                       sanitization_digest: str = Form(default=""),
                       file: UploadFile = File(...)):
    del device_id
    # ── Backend pipeline enforcement: page screenshot uploads MUST include valid sanitisation receipt ──
    if sanitization_status != "approved":
        await file.close()
        raise HTTPException(422, "Screenshot uploads must pass through the on-device privacy gate.")
    if not sanitization_receipt_id or len(sanitization_receipt_id) < 8:
        await file.close()
        raise HTTPException(422, "Missing or invalid sanitisation receipt. Image rejected.")
    if not sanitization_digest or len(sanitization_digest) < 16:
        await file.close()
        raise HTTPException(422, "Missing or invalid sanitisation digest. Image rejected.")
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=503, detail="Screenshot reading is not configured")
    if file.content_type not in {"image/png", "image/jpeg", "image/webp"}:
        await file.close()
        raise HTTPException(415, "Choose a PNG, JPEG or WebP screenshot.")
    hint = f" The user says the address was: {purpose_limited_url(url_hint)}" if url_hint else ""
    try:
        raw_image = await file.read(6_000_001)
        if len(raw_image) > 6_000_000: raise HTTPException(413, "Screenshot is larger than 6 MB.")
        from PIL import Image
        with Image.open(io.BytesIO(raw_image)) as image:
            image.load()
            if image.width * image.height > 24_000_000: raise HTTPException(413, "Screenshot dimensions are too large.")
            image.thumbnail((2048, 2048)); rendered = io.BytesIO(); image.convert("RGB").save(rendered, format="JPEG", quality=90, optimize=True)
            processed = rendered.getvalue()
        data, provider_metadata = await generate_json(PAGE_EXTRACT_PROMPT,
            [types.Part.from_bytes(data=processed, mime_type="image/jpeg"), types.Part(text=f"Extract page observations.{hint}")],
            model=VISION_MODEL, capability="vision", purpose=Purpose.PAGE_SIGNAL_EXTRACTION)
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.warning("page extract failed: %s", type(exc).__name__)
        raise HTTPException(status_code=502, detail="Couldn't read that screenshot. Try a clearer image.") from exc
    finally:
        raw_image = b""; processed = b""
        await file.close()
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
            "os_or_security_branding": s_("os_or_security_branding", 60), "text_excerpt": s_("text_excerpt", 400),
            "processing": {"raw_retained_by_apollo": False, **provider_metadata,
                           "provider_note": "Apollo does not persist the screenshot. Provider-side retention follows the configured API policy."}}


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
@bounded_analysis
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
    content = (f"Page title: {page.title or '(none)'}\nVisible text (coverage follows): {page.text or '(none)'}\nCoverage: {page.coverage}\n"
               f"Form field types present: {', '.join(page.forms) or 'none'}\nButton/submit labels: {', '.join(page.buttons) or 'none'}\n"
               f"Outbound link hostnames sample: {', '.join(page.links_sample) or 'none'}\nFinal address after redirects: {page.final_url}")
    try:
        data, provider_metadata = await generate_json(PAGE_CRAWL_EXTRACT_PROMPT, content, purpose=Purpose.INVESTIGATION)
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
    second_opinion: bool = False


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
    assessment: Optional[InvestigationResult] = None


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


@router.post("/app/analyse", response_model=AppAnalyseOut)
@bounded_analysis
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
    # Compatibility route: reputation and host lookups only. The shared case engine owns all Higgins reasoning.
    return AppAnalyseOut(reputation=rep, hosts=hosts, explanation=None, gemini_used=False, assessment=None)


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
    text: str = Field(default="", max_length=TEXT.value)
    urls: list[str] = Field(default_factory=list, max_length=ITEMS.value)
    local_state: ApolloState
    scenario: str = Field(default="", max_length=40)
    second_opinion: bool = False

    @field_validator("urls")
    @classmethod
    def redact_account_url_secrets(cls, values: list[str]) -> list[str]:
        try:
            return [purpose_limited_url(value) for value in values]
        except ValueError as exc:
            raise ValueError(str(exc)) from exc

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
    assessment: Optional[InvestigationResult] = None


@router.post("/account/analyse", response_model=AccountAnalyseOut)
@bounded_analysis
async def account_analyse(body: AccountAnalyseIn):
    official = OFFICIAL_DOMAINS.get(body.provider, [])
    results: list[AccountUrlResult] = []
    for raw in body.urls:
        try:
            normalized, host = sanitize_url(raw)
            r = await run_intel_check("url", normalized)
            is_official = any(host == d or host.endswith(f".{d}") for d in official)
            results.append(AccountUrlResult(url=normalized, host=host, verdict=r.verdict, threat_types=r.threat_types, coverage=r.coverage, official=is_official))
        except HTTPException:
            continue
    # Compatibility route: official-domain and reputation lookups only. Higgins runs once through the case engine.
    return AccountAnalyseOut(urls=results, explanation=None, gemini_used=False, assessment=None)


class BreachCheckIn(BaseModel):
    device_id: str = Field(min_length=8, max_length=64)
    identifier: str = Field(min_length=3, max_length=254)


class BreachCheckOut(BaseModel):
    status: Literal["not_configured", "clear", "found", "unavailable"]
    breaches: list[dict[str, Any]] = Field(default_factory=list)
    password_exposed: bool = False
    detail: str
    higgins: dict[str, Any]


@router.get("/account/status")
async def account_status():
    return {"breach_lookup_configured": bool(HIBP_API_KEY)}


@router.post("/account/breach", response_model=BreachCheckOut)
async def account_breach(body: BreachCheckIn):
    """Breach exposure lookup (HIBP). The identifier is forwarded once and never stored or logged."""
    if not HIBP_API_KEY:
        detail = "Breach intelligence isn't connected on this build. Apollo won't guess — you can check haveibeenpwned.com yourself."
        return BreachCheckOut(status="not_configured", detail=detail, higgins={"headline": "Breach evidence is unavailable",
            "exact_response": f"{detail} If the account alert was unexpected, secure the account through its official app or website.",
            "next_action": "Open the official account and review recent sign-ins."})
    ident = body.identifier.strip().lower()
    try:
        async with httpx.AsyncClient(timeout=12) as client:
            r = await client.get(f"https://haveibeenpwned.com/api/v3/breachedaccount/{ident}", params={"truncateResponse": "false"},
                                 headers={"hibp-api-key": HIBP_API_KEY, "user-agent": "Apollo-GuardDog"})
    except httpx.HTTPError:
        detail = "The breach service didn't answer. Try again later."
        return BreachCheckOut(status="unavailable", detail=detail, higgins={"headline": "Breach evidence is temporarily unavailable",
            "exact_response": detail, "next_action": "Treat an unexpected alert as unverified and use the official recovery path."})
    if r.status_code == 404:
        detail = "No known breach lists this account. That's good — not a guarantee."
        return BreachCheckOut(status="clear", detail=detail, higgins={"headline": "No known breach match was found",
            "exact_response": f"{detail} A recent phishing attempt or unreported breach may not appear here.",
            "next_action": "If the alert was unexpected, review account activity and enable two-factor authentication."})
    if r.status_code != 200:
        detail = "The breach service is unavailable right now."
        return BreachCheckOut(status="unavailable", detail=detail, higgins={"headline": "Breach evidence is temporarily unavailable",
            "exact_response": detail, "next_action": "Treat an unexpected alert as unverified and use the official recovery path."})
    data = r.json()
    breaches = [{"name": b.get("Title") or b.get("Name"), "date": b.get("BreachDate"), "data": (b.get("DataClasses") or [])[:8]} for b in data[:20]]
    pw = any("Passwords" in (b.get("DataClasses") or []) for b in data)
    detail = f"Found in {len(data)} known breach{'es' if len(data) != 1 else ''}.{' At least one included passwords.' if pw else ''}"
    action = "Change that password everywhere it was reused, then enable two-factor authentication." if pw else "Expect targeted phishing and enable two-factor authentication."
    return BreachCheckOut(status="found", breaches=breaches, password_exposed=pw, detail=detail,
        higgins={"headline": "This email appears in known breach data", "exact_response": f"{detail} {action}", "next_action": action})



# --------------------------------------------------------------------------- Account Gate — exposure monitoring
# The owner monitors their own email addresses for appearance in known breaches. The addresses are the
# user's own, authorised per scan, forwarded once to the configured provider and never stored or logged.
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


class MonitorScanIn(BaseModel):
    device_id: str = Field(min_length=8, max_length=64)
    emails: list[str] = Field(min_length=1, max_length=10)


class MonitorBreach(BaseModel):
    name: str
    date: str = ""


class MonitorFinding(BaseModel):
    email: str
    status: Literal["clear", "found", "unavailable"]
    breaches: list[MonitorBreach] = Field(default_factory=list)
    password_exposed: bool = False
    detail: str


class MonitorScanOut(BaseModel):
    provider: str
    source_label: str
    checked_at: str
    results: list[MonitorFinding]


@router.post("/account/monitor/scan", response_model=MonitorScanOut)
@bounded_analysis
async def account_monitor_scan(body: MonitorScanIn):
    """Check each monitored address once through the active provider (XposedOrNot, or HIBP when keyed).
    Degrades to a per-address 'unavailable' status; it never fabricates a clean result on failure."""
    provider = active_provider()
    results: list[MonitorFinding] = []
    seen: set[str] = set()
    for raw in body.emails:
        email = raw.strip().lower()
        if email in seen:
            continue
        seen.add(email)
        if not EMAIL_RE.match(email) or len(email) > 254:
            results.append(MonitorFinding(email=raw.strip()[:254], status="unavailable",
                                          detail="That doesn't look like an email address, so Apollo couldn't check it."))
            continue
        outcome = await scan_email(email)
        results.append(MonitorFinding(email=email, status=outcome["status"],
                                      breaches=[MonitorBreach(**b) for b in outcome.get("breaches", [])],
                                      password_exposed=bool(outcome.get("password_exposed")), detail=outcome["detail"]))
    return MonitorScanOut(provider=provider, source_label=source_label(provider),
                          checked_at=datetime.now(timezone.utc).isoformat(),
                          results=results)


# --------------------------------------------------------------------------- Vision Gate
# Photograph/upload → visual recognition + indicator extraction → existing gate routing.
# Reuses PAGE_EXTRACT_PROMPT-style vision, plus existing link/message/account engines.
# --------------------------------------------------------------------------- 

VISION_INVESTIGATE_PROMPT = """You are analysing a photograph or uploaded image for a consumer security app called Apollo.
The user showed Apollo something suspicious. Your job is to describe what you see and extract security-relevant indicators.

Return ONLY JSON:
{"image_type": "<letter|notice|sms|email|website|app_screen|qr_code|advertisement|invoice|login_screen|security_warning|delivery_notice|payment_request|other>",
 "description": "<2-3 sentences describing what appears to be in the image, written for a worried non-technical person>",
 "claimed_brand": "<organisation/brand the content presents as (logo, name, letterhead), else empty>",
 "urls": ["<any URLs, web addresses or domains visible in the image>"],
 "phone_numbers": ["<any phone numbers visible>"],
 "email_addresses": ["<any email addresses visible>"],
 "qr_code_present": <true|false>,
 "asks_user_to": ["<any of: visit_url, call_number, send_money, provide_credentials, install_app, download_file, scan_qr, reply_message, open_attachment, provide_personal_info, make_payment, transfer_funds>"],
 "urgency_or_threat_text": "<short quote of urgent/threatening wording if present, else empty>",
 "payment_details": {"present": <true|false>, "method": "<bank transfer|card|crypto|gift card|other|empty>", "changed_details_warning": <true if payment details appear modified or different from expected>},
 "suspicious_indicators": ["<list specific observations that could indicate a scam or security threat — e.g. 'sender address doesn't match claimed brand', 'unusual payment method requested', 'urgency pressure tactics'>"],
 "legitimate_indicators": ["<list specific observations that suggest legitimacy — e.g. 'official letterhead matches known format', 'ABN number present'>"],
 "text_content": "<key text visible in the image, up to 200 words>",
 "confidence": "<high|medium|low> — how clearly you can read and interpret the content"}

Rules:
- Report ONLY what you actually see. Never fabricate or guess content.
- If text is partially readable, say so. Do not complete words or numbers you cannot read.
- Extract ALL visible URLs, phone numbers and email addresses exactly as printed.
- Note visual quality issues (blurry, partial, dark) that limit interpretation.
- Do not declare verdicts. Apollo's security engines will investigate the extracted indicators.
- Your observations are INPUT to Apollo's investigation, not the final assessment."""


class VisionInvestigateOut(BaseModel):
    """Unified vision investigation result: what was seen, checked, found, and what couldn't be verified."""
    # What Apollo recognised
    image_type: str = ""
    description: str = ""
    claimed_brand: str = ""
    confidence: str = "low"
    # Extracted indicators
    urls_found: list[str] = Field(default_factory=list)
    phone_numbers_found: list[str] = Field(default_factory=list)
    email_addresses_found: list[str] = Field(default_factory=list)
    qr_code_present: bool = False
    asks_user_to: list[str] = Field(default_factory=list)
    suspicious_indicators: list[str] = Field(default_factory=list)
    legitimate_indicators: list[str] = Field(default_factory=list)
    payment_details: Optional[dict[str, Any]] = None
    text_content: str = ""
    # What Apollo checked (investigations that ran)
    checks_performed: list[dict[str, Any]] = Field(default_factory=list)
    # What Apollo found
    findings: list[dict[str, Any]] = Field(default_factory=list)
    # What Apollo couldn't verify
    limitations: list[str] = Field(default_factory=list)
    # Higgins recommendation
    higgins: dict[str, Any] = Field(default_factory=dict)
    # Processing metadata
    gemini_used: bool = False
    processing: dict[str, Any] = Field(default_factory=dict)


@router.post("/vision/investigate", response_model=VisionInvestigateOut)
@bounded_analysis
async def vision_investigate(
    device_id: str = Form(min_length=8, max_length=64),
    extracted_text: str = Form(default=""),
    sanitization_status: str = Form(default=""),
    sanitization_receipt_id: str = Form(default=""),
    sanitization_digest: str = Form(default=""),
    file: Optional[UploadFile] = File(default=None),
):
    """Vision Gate investigation: photograph/upload → visual recognition → gate routing.
    
    Accepts either:
    - A privacy-screened image (with sanitisation receipt) for Gemini visual analysis
    - Extracted text only (from on-device OCR, image withheld)
    - Both image and text
    
    Routes extracted indicators to existing security engines and combines results.
    """
    del device_id  # anonymous device authorises this disclosed assessment

    vision_data: dict[str, Any] = {}
    provider_metadata: dict[str, Any] = {}
    gemini_used = False
    limitations: list[str] = []

    # ── Step 1: Visual analysis via Gemini (if image provided with valid receipt) ──
    if file and file.content_type in {"image/png", "image/jpeg", "image/webp"}:
        if sanitization_status != "approved":
            if file: await file.close()
            raise HTTPException(422, "Image uploads must pass through the on-device privacy gate.")
        if not sanitization_receipt_id or len(sanitization_receipt_id) < 8:
            if file: await file.close()
            raise HTTPException(422, "Missing or invalid sanitisation receipt.")
        if not sanitization_digest or len(sanitization_digest) < 16:
            if file: await file.close()
            raise HTTPException(422, "Missing or invalid sanitisation digest.")
        if not GEMINI_API_KEY:
            limitations.append("Visual analysis is not configured. Using text extraction only.")
        else:
            try:
                raw_image = await file.read(6_000_001)
                if len(raw_image) > 6_000_000:
                    raise HTTPException(413, "Image is larger than 6 MB.")
                from PIL import Image as PILImage
                with PILImage.open(io.BytesIO(raw_image)) as image:
                    image.load()
                    if image.width * image.height > 24_000_000:
                        raise HTTPException(413, "Image dimensions are too large.")
                    image.thumbnail((2048, 2048))
                    rendered = io.BytesIO()
                    image.convert("RGB").save(rendered, format="JPEG", quality=90, optimize=True)
                    processed = rendered.getvalue()
                parts = [
                    types.Part.from_bytes(data=processed, mime_type="image/jpeg"),
                    types.Part(text="Analyse this image for security indicators. The user showed Apollo something they find suspicious."),
                ]
                if extracted_text:
                    parts.append(types.Part(text=f"On-device OCR also extracted this text: {extracted_text[:2000]}"))
                vision_data, provider_metadata = await generate_json(
                    VISION_INVESTIGATE_PROMPT, parts,
                    model=VISION_MODEL, capability="vision",
                    purpose=Purpose.VISION_INVESTIGATION,
                )
                gemini_used = True
            except HTTPException:
                raise
            except ProviderFailure as exc:
                limitations.append(f"Visual analysis unavailable ({exc.code}). Using text extraction only.")
            except Exception as exc:
                logger.warning("vision investigate failed: %s", type(exc).__name__)
                limitations.append("Visual analysis failed. Using text extraction only.")
            finally:
                raw_image = b""
                processed = b"" if "processed" in locals() else b""
                if file: await file.close()
    elif file:
        await file.close()

    # ── Step 2: Extract indicators from vision data + OCR text ──
    def s_(k: str, n: int = 500) -> str:
        return str(vision_data.get(k) or "")[:n]
    def l_(k: str) -> list[str]:
        v = vision_data.get(k) or []
        return [str(x)[:500] for x in v][:20] if isinstance(v, list) else []
    def b_(k: str) -> bool:
        return bool(vision_data.get(k)) and str(vision_data.get(k)).lower() not in ("false", "0", "")

    image_type = s_("image_type", 40)
    description = s_("description", 500)
    claimed_brand = s_("claimed_brand", 60)
    confidence = s_("confidence", 10) or "low"
    
    # Combine URLs from vision + OCR text
    urls_from_vision = l_("urls")
    urls_from_text = _extract_urls(extracted_text) if extracted_text else []
    all_urls = list(dict.fromkeys(urls_from_vision + urls_from_text))[:10]

    phone_numbers = l_("phone_numbers")
    email_addresses = l_("email_addresses")
    qr_code_present = b_("qr_code_present")
    asks_user_to = l_("asks_user_to")
    suspicious_indicators = l_("suspicious_indicators")
    legitimate_indicators = l_("legitimate_indicators")
    text_content = s_("text_content", 500) or extracted_text[:500]
    
    payment_raw = vision_data.get("payment_details")
    payment_details = None
    if isinstance(payment_raw, dict) and payment_raw.get("present"):
        payment_details = {
            "present": True,
            "method": str(payment_raw.get("method", ""))[:40],
            "changed_details_warning": bool(payment_raw.get("changed_details_warning")),
        }

    # ── Step 3: Route indicators to existing security engines ──
    checks_performed: list[dict[str, Any]] = []
    findings: list[dict[str, Any]] = []

    # 3a) Check URLs via Link Gate
    if all_urls:
        for raw_url in all_urls[:5]:
            try:
                normalized, host = sanitize_url(raw_url if raw_url.startswith("http") else f"https://{raw_url}")
                intel_result = await assess_indicator("url", normalized, True)
                checks_performed.append({"gate": "Link Gate", "type": "url", "indicator": normalized, "host": host})
                findings.append({
                    "gate": "Link Gate",
                    "type": "url",
                    "indicator": normalized,
                    "host": host,
                    "verdict": intel_result.verdict,
                    "threat_types": intel_result.threat_types,
                    "coverage": intel_result.coverage,
                    "redirect_chain": intel_result.redirect_chain,
                    "final_url": intel_result.final_url,
                })
            except Exception:
                limitations.append(f"Could not check URL: {raw_url[:80]}")

    # 3b) Check email addresses via Account Gate
    if email_addresses:
        for email in email_addresses[:3]:
            email_clean = email.strip().lower()
            if re.match(r"^[^\s@]+@[^\s@]+\.[^\s@]+$", email_clean):
                checks_performed.append({"gate": "Account Gate", "type": "email", "indicator": email_clean})
                # Note: we check if breach lookup is configured
                if HIBP_API_KEY:
                    try:
                        from services.breach_check import scan_email
                        outcome = await scan_email(email_clean)
                        findings.append({
                            "gate": "Account Gate",
                            "type": "email_breach",
                            "indicator": email_clean,
                            "status": outcome["status"],
                            "detail": outcome["detail"],
                        })
                    except Exception:
                        limitations.append(f"Could not check email breach status: {email_clean[:40]}")
                else:
                    findings.append({
                        "gate": "Account Gate",
                        "type": "email_breach",
                        "indicator": email_clean,
                        "status": "not_configured",
                        "detail": "Breach lookup is not configured.",
                    })

    # 3c) Phone numbers noted for Call Gate (no automated calling)
    if phone_numbers:
        for phone in phone_numbers[:3]:
            checks_performed.append({"gate": "Call Gate", "type": "phone", "indicator": phone})
            findings.append({
                "gate": "Call Gate",
                "type": "phone_noted",
                "indicator": phone,
                "detail": "Phone number extracted. Apollo does not call numbers automatically.",
            })

    # 3d) Text content analysis via Text Gate (if substantial text found)
    text_for_analysis = text_content or extracted_text
    if text_for_analysis and len(text_for_analysis) > 20:
        try:
            assessment = await investigate_message(
                sender="", text=text_for_analysis[:3000],
                urls=all_urls[:5],
                claimed_brand=claimed_brand or None,
                local_state=ApolloState(state="growling"),
                url_context=[],
                use_model=bool(GEMINI_API_KEY),
                locale=None,
            )
            checks_performed.append({"gate": "Text Gate", "type": "message_analysis"})
            findings.append({
                "gate": "Text Gate",
                "type": "message_analysis",
                "assessment": assessment.model_dump() if hasattr(assessment, "model_dump") else {},
            })
        except Exception:
            limitations.append("Text analysis did not complete.")

    if not gemini_used and not extracted_text:
        limitations.append("No image or text was available for analysis.")
    if not all_urls and not email_addresses and not phone_numbers and not text_for_analysis:
        limitations.append("No security indicators were extracted from this image.")

    # ── Step 4: Build Higgins recommendation ──
    higgins = _build_vision_higgins(
        image_type=image_type, description=description,
        claimed_brand=claimed_brand, confidence=confidence,
        findings=findings, suspicious_indicators=suspicious_indicators,
        legitimate_indicators=legitimate_indicators,
        limitations=limitations, asks_user_to=asks_user_to,
        payment_details=payment_details,
    )

    return VisionInvestigateOut(
        image_type=image_type, description=description,
        claimed_brand=claimed_brand, confidence=confidence,
        urls_found=all_urls, phone_numbers_found=phone_numbers,
        email_addresses_found=email_addresses,
        qr_code_present=qr_code_present,
        asks_user_to=asks_user_to,
        suspicious_indicators=suspicious_indicators,
        legitimate_indicators=legitimate_indicators,
        payment_details=payment_details,
        text_content=text_content,
        checks_performed=checks_performed,
        findings=findings,
        limitations=limitations,
        higgins=higgins,
        gemini_used=gemini_used,
        processing={"raw_retained_by_apollo": False, **provider_metadata},
    )


# ── Vision helpers ──

_URL_PATTERN = re.compile(r"https?://[^\s<>\"']+|(?:www\.)[^\s<>\"']+|[a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z]{2,}(?:/[^\s<>\"']*)?")

def _extract_urls(text: str) -> list[str]:
    """Extract URL-like strings from OCR text."""
    return list(dict.fromkeys(_URL_PATTERN.findall(text)))[:10]


def _build_vision_higgins(
    image_type: str, description: str, claimed_brand: str, confidence: str,
    findings: list, suspicious_indicators: list, legitimate_indicators: list,
    limitations: list, asks_user_to: list, payment_details: Optional[dict],
) -> dict[str, Any]:
    """Build a Higgins recommendation from vision investigation results."""
    
    # Determine threat level from findings
    has_malicious_url = any(
        f.get("verdict") in ("malicious", "suspicious") 
        for f in findings if f.get("type") == "url"
    )
    has_breach = any(
        f.get("status") == "found" 
        for f in findings if f.get("type") == "email_breach"
    )
    has_payment_change = bool(payment_details and payment_details.get("changed_details_warning"))
    has_urgency = bool(asks_user_to and any(a in asks_user_to for a in [
        "send_money", "provide_credentials", "transfer_funds", "make_payment",
    ]))
    
    # Count suspicious vs legitimate
    susp_count = len(suspicious_indicators)
    legit_count = len(legitimate_indicators)
    
    # Build headline
    if has_malicious_url:
        headline = "Apollo found a dangerous link in this image."
        severity = "high"
    elif has_payment_change:
        headline = "Payment details in this image may have been altered."
        severity = "high"
    elif has_breach and has_urgency:
        headline = "This appears to be a targeted message using real breach data."
        severity = "high"
    elif susp_count > 0 and susp_count > legit_count:
        headline = f"Apollo found {susp_count} suspicious {'indicator' if susp_count == 1 else 'indicators'} in this image."
        severity = "medium"
    elif has_urgency:
        headline = "This content is pressuring you to act quickly."
        severity = "medium"
    elif susp_count > 0:
        headline = "Some elements need caution, but nothing conclusive was found."
        severity = "low"
    else:
        headline = "Apollo didn't find clear security threats, but couldn't verify everything."
        severity = "low"
    
    # Build explanation
    parts: list[str] = []
    if description:
        parts.append(description)
    if has_malicious_url:
        bad_urls = [f.get("indicator", "") for f in findings if f.get("verdict") in ("malicious", "suspicious") and f.get("type") == "url"]
        if bad_urls:
            parts.append(f"The link {bad_urls[0]} was flagged as {'malicious' if any(f.get('verdict') == 'malicious' for f in findings) else 'suspicious'} by Apollo's threat intelligence.")
    if has_payment_change:
        parts.append("Payment details appear to have been changed — this is a common tactic in invoice fraud.")
    if claimed_brand and susp_count > 0:
        parts.append(f"The content claims to be from {claimed_brand}. Verify through the official channel, not through this image.")
    
    # Build recommendation
    if has_malicious_url or has_payment_change:
        action = "Do not use any links, phone numbers or payment details from this image. Verify through the official website or app."
    elif severity == "medium":
        action = "Don't act on this immediately. Verify the sender and any requests through official channels."
    elif susp_count > 0:
        action = "If you weren't expecting this, verify it through the official source before taking any action."
    else:
        action = "Apollo checked what it could. If something still feels wrong, don't act on it without verifying through official channels."
    
    # Limitations disclaimer
    if confidence == "low":
        parts.append("The image was difficult to read clearly, so Apollo's analysis may be incomplete.")
    if limitations:
        parts.append(f"Apollo could not verify {len(limitations)} {'aspect' if len(limitations) == 1 else 'aspects'} of this content.")
    
    parts.append("AI visual interpretation alone is not proof. Apollo's investigation is based on what it could extract and verify.")
    
    return {
        "headline": headline,
        "severity": severity,
        "explanation": " ".join(parts),
        "action": action,
        "checks_summary": f"Apollo performed {len([c for c in findings if c.get('gate')])} security checks on indicators found in this image.",
    }
