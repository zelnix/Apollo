"""Purpose-limited threat investigation for user-submitted content.

Raw content exists only in request/task memory. This module writes no prompts, screenshots, pages,
sender details, model output, or extracted tokens to MongoDB, object storage, logs, or analytics.
"""
from __future__ import annotations

import asyncio
import base64
import json
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Literal, Optional
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from pydantic import BaseModel, Field

from core.config import GEMINI_API_KEY, HIGGINS_VOICE, logger
from services.phonerisk import check_phone_risk
from services.webcrawl import CrawlBlocked, fetch_page

AssessmentStatus = Literal["corroborated", "suspicious", "unresolved"]


class InvestigationSource(BaseModel):
    source_id: str = Field(max_length=32)
    label: str = Field(max_length=100)
    url: Optional[str] = Field(default=None, max_length=500)
    status: Literal["supports", "contradicts", "inconclusive", "unavailable"]
    detail: str = Field(max_length=240)


class InvestigationFinding(BaseModel):
    status: AssessmentStatus
    title: str = Field(max_length=100)
    detail: str = Field(max_length=280)
    source_ids: list[str] = Field(default_factory=list, max_length=6)


class InvestigationEntities(BaseModel):
    claimed_organisations: list[str] = Field(default_factory=list, max_length=6)
    sender_details: list[str] = Field(default_factory=list, max_length=6)
    callback_details: list[str] = Field(default_factory=list, max_length=6)
    links: list[str] = Field(default_factory=list, max_length=10)
    requested_actions: list[str] = Field(default_factory=list, max_length=8)
    transaction_claims: list[str] = Field(default_factory=list, max_length=8)


class HigginsAssessment(BaseModel):
    headline: str = Field(max_length=140)
    next_action: str = Field(max_length=260)
    exact_response: str = Field(max_length=900)
    what_was_found: list[str] = Field(default_factory=list, max_length=6)
    why_it_matters: list[str] = Field(default_factory=list, max_length=6)
    could_not_establish: list[str] = Field(default_factory=list, max_length=6)
    action_label: str = Field(max_length=80)
    action_kind: Literal["verify_officially", "avoid_and_delete", "check_account", "call_known_number", "review"]


class InvestigationResult(BaseModel):
    assessment_id: str
    risk: Literal["warning", "clear", "uncertain"]
    entities: InvestigationEntities
    findings: list[InvestigationFinding] = Field(default_factory=list, max_length=16)
    sources: list[InvestigationSource] = Field(default_factory=list, max_length=20)
    higgins: HigginsAssessment
    technical_summary: list[str] = Field(default_factory=list, max_length=12)
    processing: dict[str, Any]


OFFICIAL: dict[str, tuple[list[str], str]] = {
    "commbank": (["commbank.com.au"], "https://www.commbank.com.au/support/security.html"),
    "commonwealth bank": (["commbank.com.au"], "https://www.commbank.com.au/support/security.html"),
    "westpac": (["westpac.com.au"], "https://www.westpac.com.au/security/"),
    "anz": (["anz.com", "anz.com.au"], "https://www.anz.com.au/security/"),
    "nab": (["nab.com.au"], "https://www.nab.com.au/about-us/security"),
    "paypal": (["paypal.com", "paypal.com.au"], "https://www.paypal.com/au/security"),
    "australia post": (["auspost.com.au"], "https://auspost.com.au/about-us/about-our-site/online-security-scams-fraud"),
    "mygov": (["my.gov.au"], "https://my.gov.au/en/about/help/scams"),
    "telstra": (["telstra.com.au"], "https://www.telstra.com.au/privacy-and-cyber-security"),
    "optus": (["optus.com.au"], "https://www.optus.com.au/support/cyber-security"),
    "apple": (["apple.com"], "https://support.apple.com/102568"),
    "microsoft": (["microsoft.com", "microsoftonline.com", "live.com"], "https://support.microsoft.com/security"),
    "google": (["google.com", "gmail.com"], "https://support.google.com/accounts/answer/6294825"),
}

PHONE_RE = re.compile(r"(?<!\w)(?:\+?61|0)[2-478](?:[\s().-]*\d){8}(?!\w)")
EMAIL_RE = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.I)
AMOUNT_RE = re.compile(r"(?i)(?:AUD\s*)?\$\s?\d[\d,]*(?:\.\d{2})?|\b\d[\d,]*(?:\.\d{2})?\s?(?:AUD|dollars?)\b")
ACTION_PATTERNS = (
    (r"\b(?:click|tap|open|visit|follow)\b.{0,35}\b(?:link|website|url)\b", "open the supplied link"),
    (r"\b(?:pay|transfer|send)\b.{0,45}\b(?:money|funds|fee|invoice|account|crypto|bitcoin)\b", "send money or pay a fee"),
    (r"\b(?:share|send|read)\b.{0,35}\b(?:code|otp|pin|passcode)\b", "share a verification code"),
    (r"\b(?:log ?in|sign ?in|verify|unlock|reactivate)\b.{0,45}\b(?:account|details|identity)\b", "enter account or identity details"),
    (r"\b(?:call|phone|ring)\b.{0,30}(?:\+?61|0)[2-478]", "call the number supplied in the message"),
    (r"\b(?:download|install)\b.{0,35}\b(?:app|software|anydesk|teamviewer|tool)\b", "install software or allow remote access"),
)


def _unique(values: list[str], limit: int) -> list[str]:
    return list(dict.fromkeys(v.strip() for v in values if v and v.strip()))[:limit]


def _host(raw: str) -> str:
    value = raw if "://" in raw else f"https://{raw}"
    return (urlsplit(value).hostname or "").lower().rstrip(".")


def purpose_limited_url(raw: str) -> str:
    value = raw if "://" in raw else f"https://{raw}"
    parsed = urlsplit(value)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ValueError("Only public HTTP(S) links can be assessed")
    port = f":{parsed.port}" if parsed.port else ""
    netloc = f"{parsed.hostname.lower()}{port}"
    secret = re.compile(r"token|code|otp|auth|session|password|pass|secret|key|signature|sig", re.I)
    query = urlencode([(key, "[redacted]" if secret.search(key) else value) for key, value in parse_qsl(parsed.query, keep_blank_values=True)])
    return urlunsplit((parsed.scheme.lower(), netloc, parsed.path or "/", query, ""))


def deterministic_entities(sender: str, text: str, urls: list[str], claimed_brand: Optional[str]) -> InvestigationEntities:
    phones = _unique(PHONE_RE.findall(text), 6)
    emails = _unique(EMAIL_RE.findall(text), 6)
    actions = [label for pattern, label in ACTION_PATTERNS if re.search(pattern, text, re.I | re.S)]
    return InvestigationEntities(
        claimed_organisations=_unique([claimed_brand or ""], 6),
        sender_details=_unique([sender, *emails], 6),
        callback_details=phones,
        links=_unique([_host(url) for url in urls], 10),
        requested_actions=_unique(actions, 8),
        transaction_claims=_unique(AMOUNT_RE.findall(text), 8),
    )


async def _page_context(raw_url: str) -> dict[str, Any]:
    try:
        page = await asyncio.wait_for(fetch_page(raw_url), timeout=10)
        return {"url": raw_url, "final_url": page.final_url, "title": page.title, "forms": page.forms,
                "buttons": page.buttons[:8], "text_excerpt": page.text[:800], "error": None}
    except (CrawlBlocked, asyncio.TimeoutError) as exc:
        return {"url": raw_url, "error": getattr(exc, "reason", "timeout")}


async def _phone_context(numbers: list[str]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for number in numbers[:2]:
        try:
            risk = await check_phone_risk(number, "AU", persist_cache=False)
            rows.append({"number": number, "decision": risk.decision, "fraud_score": risk.fraud_score,
                         "recent_abuse": risk.recent_abuse, "risky": risk.risky, "source": risk.source})
        except Exception:  # purposefully no number/error logging
            rows.append({"number": number, "decision": "unavailable", "source": "unavailable"})
    return rows


async def _stream_json(system: str, prompt: str) -> Optional[dict[str, Any]]:
    if not GEMINI_API_KEY:
        return None
    from emergentintegrations.llm.chat import LlmChat, StreamDone, TextDelta, UserMessage
    for attempt in range(2):
        chunks: list[str] = []
        chat = (LlmChat(api_key=GEMINI_API_KEY, session_id=f"investigation-{uuid.uuid4().hex}", system_message=system)
                .with_model("gemini", "gemini-3-flash-preview").with_params(temperature=0.1, max_tokens=3000))
        async def consume() -> None:
            async for event in chat.stream_message(UserMessage(text=prompt)):
                if isinstance(event, TextDelta):
                    chunks.append(event.content)
                elif isinstance(event, StreamDone):
                    break
        try:
            await asyncio.wait_for(consume(), timeout=55)
            raw = "".join(chunks).strip()
            if "{" in raw and "}" in raw:
                raw = raw[raw.find("{"):raw.rfind("}") + 1]
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, dict) else None
        except Exception as exc:
            logger.warning("Gemini investigation attempt %s failed: %s (response_chars=%s)", attempt + 1, type(exc).__name__, len("".join(chunks)))
        finally:
            chunks.clear()
    return None


async def extract_message_screenshot(image_bytes: bytes) -> dict[str, Any]:
    """Vision extraction with request-memory only; caller owns/ closes the temporary upload."""
    if not GEMINI_API_KEY:
        raise RuntimeError("Screenshot reading is not configured")
    from emergentintegrations.llm.chat import ImageContent, LlmChat, StreamDone, TextDelta, UserMessage
    prompt = ("Read exactly what is visible in this screenshot of a message, chat, email or QR code. "
              "Return ONLY JSON: {\"sender\":\"\",\"text\":\"\",\"urls\":[],\"source\":\"sms|whatsapp|imessage|email|messenger|telegram|other\"}. "
              "Do not guess unreadable text and do not add commentary.")
    encoded = base64.b64encode(image_bytes).decode("ascii")
    try:
        for attempt in range(2):
            chunks: list[str] = []
            chat = (LlmChat(api_key=GEMINI_API_KEY, session_id=f"screenshot-{uuid.uuid4().hex}", system_message=prompt)
                    .with_model("gemini", "gemini-3-flash-preview").with_params(temperature=0, max_tokens=1600))
            async def consume() -> None:
                async for event in chat.stream_message(UserMessage(text="Extract the visible message.", file_contents=[ImageContent(encoded)])):
                    if isinstance(event, TextDelta): chunks.append(event.content)
                    elif isinstance(event, StreamDone): break
            try:
                await asyncio.wait_for(consume(), timeout=55)
                raw = "".join(chunks).strip()
                raw = raw[raw.find("{"):raw.rfind("}") + 1] if "{" in raw and "}" in raw else raw
                data = json.loads(raw)
                return {"sender": str(data.get("sender", ""))[:80], "text": str(data.get("text", ""))[:4000],
                        "urls": [str(value)[:500] for value in data.get("urls", [])][:10],
                        "source": str(data.get("source", "other"))[:20],
                        "processing": {"raw_retained_by_apollo": False,
                                       "provider_note": "Apollo does not persist the image. Gemini-side retention follows the configured API policy."}}
            except Exception as exc:
                logger.warning("Gemini screenshot attempt %s failed: %s (response_chars=%s)", attempt + 1, type(exc).__name__, len("".join(chunks)))
        raise RuntimeError("Gemini could not read the screenshot")
    finally:
        encoded = ""


SYSTEM = HIGGINS_VOICE + """ You are producing the core result of a consumer threat assessment. Apollo's deterministic checks and supplied source records are authoritative. Never invent a source or claim a source checked something it did not. Distinguish corroborated facts, suspicious patterns, and unresolved questions. Never call something safe merely because no listing was found. Never say Apollo blocked anything: this assessment did not observe a packet drop. Lead with one clear next action. Return ONLY JSON with this schema:
{"claimed_organisations":[],"sender_details":[],"callback_details":[],"requested_actions":[],"transaction_claims":[],
"findings":[{"status":"corroborated|suspicious|unresolved","title":"","detail":"","source_ids":[]}],
"headline":"","next_action":"","exact_response":"","what_was_found":[],"why_it_matters":[],"could_not_establish":[],
"action_label":"","action_kind":"verify_officially|avoid_and_delete|check_account|call_known_number|review"}.
Do not quote secrets, passwords, verification codes, full account numbers, or long message passages. Source IDs must come from the supplied source list."""
SYSTEM += " A clean reputation result means only that no current listing was found; it is not proof of safety or identity. DNS/HTTP inspection failure is unresolved and never evidence that a site was fraudulent, removed, or taken down."


def _fallback(entities: InvestigationEntities, local_state: str, sources: list[InvestigationSource]) -> tuple[list[InvestigationFinding], HigginsAssessment]:
    suspicious = bool(entities.requested_actions or entities.transaction_claims or any(s.status == "contradicts" for s in sources))
    findings = [InvestigationFinding(status="suspicious" if suspicious else "unresolved", title="The request needs independent verification",
        detail="The submitted content asks you to act, but Apollo could not establish that the sender is authorised to make that request.",
        source_ids=[s.source_id for s in sources if s.status in ("contradicts", "inconclusive")][:4])]
    next_action = "Do not use the supplied link or contact details. Open the organisation's official app or website yourself."
    response = ("Apollo found a request that should be checked independently. The content may name a real organisation, but that does not establish who sent it. "
                f"{next_action}")
    return findings, HigginsAssessment(headline="Verify this outside the message", next_action=next_action, exact_response=response,
        what_was_found=["A submitted message was checked with local patterns, link intelligence and available public evidence."],
        why_it_matters=["Impersonation often combines a real organisation's name with unrelated contact details."],
        could_not_establish=["Apollo could not authenticate the person or organisation behind the message."],
        action_label="Verify in the official app", action_kind="verify_officially")


def _complete_higgins_response(higgins: HigginsAssessment) -> HigginsAssessment:
    def sentence(value: str) -> str:
        value = value.strip()
        return value if value.endswith((".", "!", "?")) else f"{value}."
    found = sentence(higgins.what_was_found[0] if higgins.what_was_found else higgins.headline)
    why = sentence(higgins.why_it_matters[0] if higgins.why_it_matters else "The sender's identity and request must be considered separately")
    unknown = (higgins.could_not_establish[0] if higgins.could_not_establish else "Apollo could not authenticate the sender").rstrip(".")
    response = f"{found} {why} I could not establish: {unknown.lower()}. {sentence(higgins.next_action)}"
    return higgins.model_copy(update={"exact_response": response[:900]})


async def investigate_message(*, sender: str, text: str, urls: list[str], claimed_brand: Optional[str],
                              local_state: str, url_context: list[dict[str, Any]]) -> InvestigationResult:
    entities = deterministic_entities(sender, text, urls, claimed_brand)
    pages, phones = await asyncio.gather(
        asyncio.gather(*[_page_context(url) for url in urls[:3]]),
        _phone_context(entities.callback_details),
    )
    sources: list[InvestigationSource] = [InvestigationSource(source_id="local-1", label="Apollo on-device message analysis", url=None,
        status="supports" if local_state == "resting" else "inconclusive",
        detail="No strong local scam pattern was found." if local_state == "resting" else f"Local message patterns produced a {local_state} warning; this is not proof of sender identity or a packet block.")]
    technical: list[str] = []
    for index, item in enumerate(url_context):
        sid = f"link-{index + 1}"
        verdict = str(item.get("verdict", "unknown"))
        detail = f"{item.get('host', 'Unknown host')}: {verdict}; coverage {item.get('coverage', 'none')}."
        if verdict == "clean":
            detail += " No current listing was found; this does not authenticate the site or prove safety."
        sources.append(InvestigationSource(source_id=sid, label="Apollo link intelligence", url=None,
            status="contradicts" if verdict == "malicious" else "inconclusive", detail=detail))
        technical.append(detail)
    for index, page in enumerate(pages):
        sid = f"page-{index + 1}"
        sources.append(InvestigationSource(source_id=sid, label="Isolated webpage inspection", url=None,
            status="unavailable" if page.get("error") else "inconclusive",
            detail=f"Inspection unavailable: {page.get('error')}." if page.get("error") else f"Static page title: {page.get('title') or 'none'}; forms: {', '.join(page.get('forms') or []) or 'none'}."))
    for org in entities.claimed_organisations:
        match = OFFICIAL.get(org.lower())
        if not match:
            continue
        domains, ref = match
        linked = entities.links
        official_match = any(host == domain or host.endswith(f".{domain}") for host in linked for domain in domains)
        sources.append(InvestigationSource(source_id=f"official-{len(sources) + 1}", label=f"{org} official domain reference", url=ref,
            status="supports" if official_match else "contradicts" if linked else "inconclusive",
            detail=f"Official domain{'s' if len(domains) > 1 else ''}: {', '.join(domains)}. " +
                   ("A submitted link matches." if official_match else "No submitted link matches." if linked else "No link was available to compare.")))
    for index, phone in enumerate(phones):
        decision = phone.get("decision")
        sources.append(InvestigationSource(source_id=f"phone-{index + 1}", label="Caller-number reputation", url=None,
            status="contradicts" if decision == "avoid" else "inconclusive",
            detail=f"Reputation result: {decision}; fraud score {phone.get('fraud_score') if phone.get('fraud_score') is not None else 'unavailable'}. This does not authenticate the caller."))

    source_payload = [source.model_dump() for source in sources]
    prompt = (f"User-submitted sender: {sender[:80] or '(not supplied)'}\nUser-submitted content:\n{text[:4000]}\n\n"
              f"Deterministic extraction:\n{entities.model_dump_json()}\nLocal warning state: {local_state}\n"
              f"Available source records (the only permitted sources):\n{json.dumps(source_payload)}\n"
              f"Isolated page observations:\n{json.dumps(pages)}\nPhone observations:\n{json.dumps(phones)}")
    model = await _stream_json(SYSTEM, prompt)
    model_used = model is not None
    valid_ids = {source.source_id for source in sources}
    if model:
        entities = InvestigationEntities(
            claimed_organisations=_unique([*entities.claimed_organisations, *[str(x) for x in model.get("claimed_organisations", [])]], 6),
            sender_details=_unique([*entities.sender_details, *[str(x) for x in model.get("sender_details", [])]], 6),
            callback_details=_unique([*entities.callback_details, *[str(x) for x in model.get("callback_details", [])]], 6),
            links=entities.links,
            requested_actions=_unique([*entities.requested_actions, *[str(x) for x in model.get("requested_actions", [])]], 8),
            transaction_claims=_unique([*entities.transaction_claims, *[str(x) for x in model.get("transaction_claims", [])]], 8),
        )
        findings: list[InvestigationFinding] = []
        for raw in model.get("findings", [])[:16]:
            try:
                status = raw.get("status") if raw.get("status") in ("corroborated", "suspicious", "unresolved") else "unresolved"
                source_ids = [x for x in raw.get("source_ids", []) if x in valid_ids][:6]
                cited = [source for source in sources if source.source_id in source_ids]
                detail = str(raw.get("detail", ""))[:280]
                if cited and all(source.status == "unavailable" for source in cited):
                    status = "unresolved"
                    detail = "Apollo could not inspect this source. The failure neither confirms nor clears the concern."
                if cited and all(source.source_id.startswith("phone-") for source in cited) and all(source.status != "contradicts" for source in cited):
                    status = "unresolved"
                    detail = "The current reputation lookup found no strong abuse signal, but it does not authenticate the caller or sender."
                if status == "corroborated" and cited and all(source.source_id.startswith("official-") for source in cited):
                    detail = cited[0].detail
                findings.append(InvestigationFinding(status=status, title=str(raw.get("title", ""))[:100],
                    detail=detail, source_ids=source_ids))
            except Exception:
                continue
        fallback_findings, fallback_higgins = _fallback(entities, local_state, sources)
        if not findings:
            findings = fallback_findings
        allowed_actions = {"verify_officially", "avoid_and_delete", "check_account", "call_known_number", "review"}
        action_kind = model.get("action_kind") if model.get("action_kind") in allowed_actions else fallback_higgins.action_kind
        try:
            higgins = HigginsAssessment(headline=(str(model.get("headline") or fallback_higgins.headline))[:140],
                next_action=(str(model.get("next_action") or fallback_higgins.next_action))[:260],
                exact_response=(str(model.get("exact_response") or fallback_higgins.exact_response))[:900],
                what_was_found=[str(x)[:220] for x in model.get("what_was_found", [])][:6] or fallback_higgins.what_was_found,
                why_it_matters=[str(x)[:220] for x in model.get("why_it_matters", [])][:6] or fallback_higgins.why_it_matters,
                could_not_establish=[str(x)[:220] for x in model.get("could_not_establish", [])][:6] or fallback_higgins.could_not_establish,
                action_label=(str(model.get("action_label") or fallback_higgins.action_label))[:80], action_kind=action_kind)
        except Exception:
            higgins = fallback_higgins
    else:
        findings, higgins = _fallback(entities, local_state, sources)
    higgins = _complete_higgins_response(higgins)
    risk: Literal["warning", "clear", "uncertain"] = "warning" if local_state in ("growling", "barking") or any(f.status == "suspicious" for f in findings) else "uncertain"
    return InvestigationResult(assessment_id=uuid.uuid4().hex, risk=risk, entities=entities, findings=findings, sources=sources,
        higgins=higgins, technical_summary=technical, processing={"raw_retained_by_apollo": False, "temporary_expiry_minutes": 0,
        "temporary_copy_policy": "Request/task-memory only; request-scoped copies close immediately on success, failure, timeout or cancellation.",
        "provider": "Gemini", "model_used": model_used,
        "provider_note": "Apollo does not persist submitted content. Gemini-side retention follows the configured API policy.",
        "completed_at": datetime.now(timezone.utc).isoformat()})