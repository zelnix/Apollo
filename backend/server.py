"""Apollo V1 backend.

Privacy posture:
- Receives only minimal security indicators (a user-submitted link, a host name,
  or an event summary). Never page content, contacts, messages or device data.
- Reputation cache stores an HMAC digest of the indicator, never the raw value.
- All deletes are soft deletes (deleted_at).
"""
from __future__ import annotations

import asyncio
import hmac
import json
import logging
import os
import secrets
import uuid
from html import escape
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from pathlib import Path
from typing import Annotated, Any, AsyncIterator, Literal, Optional
from urllib.parse import urlparse, urlunparse

import httpx
from bson import ObjectId
from dotenv import load_dotenv
from fastapi import APIRouter, FastAPI, HTTPException, Query
from fastapi.responses import StreamingResponse
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, field_validator
from starlette.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("apollo")
# Never log outbound URLs (they carry the API key and the checked link).
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)

client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = client[os.environ["DB_NAME"]]

SAFE_BROWSING_API_KEY = os.environ.get("SAFE_BROWSING_API_KEY", "")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
URL_HMAC_SECRET = os.environ["URL_HMAC_SECRET"]
SB_ENDPOINT = "https://safebrowsing.googleapis.com/v4/threatMatches:find"
SB_THREAT_TYPES = ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE", "POTENTIALLY_HARMFUL_APPLICATION"]

app = FastAPI(title="Apollo V1 API")
api = APIRouter(prefix="/api")


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


# --------------------------------------------------------------------------- Mongo base
PyObjectId = Annotated[str, BeforeValidator(lambda v: str(v) if isinstance(v, ObjectId) else v)]


class BaseDocument(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    id: Optional[PyObjectId] = Field(default=None, alias="_id")

    def to_mongo(self) -> dict[str, Any]:
        data = self.model_dump(by_alias=True, exclude_none=True)
        data.pop("_id", None)
        return data

    @classmethod
    def from_mongo(cls, doc: dict[str, Any]):
        return cls.model_validate(doc)


# --------------------------------------------------------------------------- Models
Verdict = Literal["clean", "malicious", "unknown"]
ApolloState = Literal["resting", "growling", "barking", "biting"]
EventStatus = Literal["active", "trusted", "blocked", "resolved"]


class DeviceRegister(BaseModel):
    device_id: str = Field(min_length=8, max_length=64)
    platform: str = Field(max_length=16)
    adapter_mode: str = Field(max_length=16)
    app_version: str = Field(default="1.0.0", max_length=16)


class Device(BaseDocument):
    device_id: str
    platform: str
    adapter_mode: str
    app_version: str
    created_at: datetime
    last_seen_at: datetime


class IntelCheckRequest(BaseModel):
    indicator_type: Literal["url", "domain"]
    value: str = Field(min_length=1, max_length=2048)
    device_id: Optional[str] = Field(default=None, max_length=64)

    @field_validator("value")
    @classmethod
    def validate_value(cls, v: str) -> str:
        return v.strip()


class IntelSource(BaseModel):
    name: str
    status: Literal["match", "clear", "unavailable", "not_configured"]
    detail: str
    threat_types: list[str] = []


class IntelCheckResponse(BaseModel):
    verdict: Verdict
    threat_types: list[str]
    sources: list[IntelSource]
    indicator_digest: str
    checked_at: datetime
    cached: bool
    coverage: Literal["full", "partial", "none"]


class ReputationCache(BaseDocument):
    indicator_digest: str
    verdict: Verdict
    threat_types: list[str]
    sources: list[dict[str, Any]]
    coverage: str
    checked_at: datetime
    expires_at: datetime


class BlocklistEntry(BaseDocument):
    host: str
    threat_type: str
    reason: str
    added_at: datetime
    deleted_at: Optional[datetime] = None


class PatrolEventIn(BaseModel):
    """Minimal event summary synced from device. Full link stays on-device."""

    event_id: str = Field(min_length=8, max_length=64)
    device_id: str = Field(min_length=8, max_length=64)
    category: Literal["link", "website", "connection", "known_threat", "protection", "system"]
    state: ApolloState
    status: EventStatus
    headline: str = Field(max_length=160)
    what_happened: str = Field(max_length=600)
    why: list[str] = Field(default_factory=list, max_length=12)
    what_to_do: str = Field(max_length=400)
    indicator_host: Optional[str] = Field(default=None, max_length=253)
    indicator_digest: Optional[str] = Field(default=None, max_length=64)
    verified_block: bool = False
    adapter_label: str = Field(max_length=64)
    occurred_at: datetime
    resolved_at: Optional[datetime] = None


class PatrolEvent(PatrolEventIn, BaseDocument):
    created_at: datetime
    updated_at: datetime
    deleted_at: Optional[datetime] = None


class PatrolEventPatch(BaseModel):
    status: Optional[EventStatus] = None
    state: Optional[ApolloState] = None
    verified_block: Optional[bool] = None
    what_to_do: Optional[str] = Field(default=None, max_length=400)
    resolved_at: Optional[datetime] = None


class TrustIn(BaseModel):
    device_id: str = Field(min_length=8, max_length=64)
    indicator_type: Literal["url", "domain"]
    indicator_digest: str = Field(min_length=16, max_length=64)
    indicator_host: str = Field(max_length=253)
    event_id: Optional[str] = None
    trust_id: str = Field(min_length=8, max_length=64)


class TrustEntry(TrustIn, BaseDocument):
    created_at: datetime
    deleted_at: Optional[datetime] = None


class AskRequest(BaseModel):
    device_id: str = Field(min_length=8, max_length=64)
    message: str = Field(min_length=1, max_length=2000)
    context: Optional[str] = Field(default=None, max_length=1200)


class AskMessage(BaseDocument):
    device_id: str
    role: Literal["user", "apollo"]
    content: str
    created_at: datetime


# --------------------------------------------------------------------------- Helpers
def digest(value: str) -> str:
    return hmac.new(URL_HMAC_SECRET.encode(), value.encode(), sha256).hexdigest()


def sanitize_url(raw: str) -> tuple[str, str]:
    """Strip credentials and fragments; return (url, host). Validation only, no canonicalisation games."""
    candidate = raw if "://" in raw else f"https://{raw}"
    try:
        parsed = urlparse(candidate)
        hostname, port = parsed.hostname, parsed.port
    except ValueError:
        raise HTTPException(status_code=422, detail="Only http/https links can be checked")
    if parsed.scheme not in {"http", "https"} or not hostname:
        raise HTTPException(status_code=422, detail="Only http/https links can be checked")
    host = hostname.lower()
    netloc = host if port is None else f"{host}:{port}"
    clean = urlunparse((parsed.scheme, netloc, parsed.path or "/", parsed.params, parsed.query, ""))
    return clean, host


def host_matches(host: str, entry_host: str) -> bool:
    return host == entry_host or host.endswith("." + entry_host)


async def blocklist_check(host: str) -> IntelSource:
    entries = await db.blocklist.find({"deleted_at": None}).to_list(5000)
    for raw in entries:
        entry = BlocklistEntry.from_mongo(raw)
        if host_matches(host, entry.host):
            return IntelSource(
                name="apollo_blocklist",
                status="match",
                detail=f"Domain is on Apollo's managed threat list ({entry.reason}).",
                threat_types=[entry.threat_type],
            )
    return IntelSource(name="apollo_blocklist", status="clear", detail="Not on Apollo's managed threat list.")


_sb_probe: dict[str, Any] = {"status": None, "checked_at": None, "detail": ""}


async def safe_browsing_lookup(url: str) -> tuple[IntelSource, Optional[datetime]]:
    if not SAFE_BROWSING_API_KEY:
        return IntelSource(name="google_safe_browsing", status="not_configured", detail="No Safe Browsing key configured."), None
    # Short-circuit while the key is known-bad (re-probed every 10 minutes) to avoid hammering Google.
    if _sb_probe["status"] == "auth_error" and _sb_probe["checked_at"] and now_utc() - _sb_probe["checked_at"] < timedelta(minutes=10):
        return IntelSource(name="google_safe_browsing", status="unavailable", detail="Safe Browsing key was rejected; reputation check unavailable."), None
    payload = {
        "client": {"clientId": "apollo-v1", "clientVersion": "1.0"},
        "threatInfo": {
            "threatTypes": SB_THREAT_TYPES,
            "platformTypes": ["ANY_PLATFORM"],
            "threatEntryTypes": ["URL"],
            "threatEntries": [{"url": url}],
        },
    }
    try:
        async with httpx.AsyncClient(timeout=5.0) as http:
            resp = await http.post(SB_ENDPOINT, params={"key": SAFE_BROWSING_API_KEY}, json=payload)
        if resp.status_code in (401, 403):
            _sb_probe.update(status="auth_error", checked_at=now_utc(), detail="Key rejected by Google Safe Browsing.")
            return IntelSource(name="google_safe_browsing", status="unavailable", detail="Safe Browsing key was rejected; reputation check unavailable."), None
        resp.raise_for_status()
        data = resp.json()
    except (httpx.HTTPError, ValueError):
        _sb_probe.update(status="unreachable", checked_at=now_utc(), detail="Safe Browsing did not respond.")
        return IntelSource(name="google_safe_browsing", status="unavailable", detail="Safe Browsing did not respond in time."), None
    _sb_probe.update(status="ok", checked_at=now_utc(), detail="Safe Browsing reachable.")
    matches = data.get("matches", [])
    if matches:
        threats = sorted({m.get("threatType", "UNKNOWN") for m in matches})
        seconds = 300
        try:
            seconds = max(60, int(str(matches[0].get("cacheDuration", "300s")).rstrip("s").split(".")[0]))
        except ValueError:
            pass
        return (
            IntelSource(name="google_safe_browsing", status="match", detail="Listed as unsafe by Google Safe Browsing.", threat_types=threats),
            now_utc() + timedelta(seconds=seconds),
        )
    return IntelSource(name="google_safe_browsing", status="clear", detail="No current Safe Browsing listing."), None


def combine(sources: list[IntelSource]) -> tuple[Verdict, list[str], str]:
    threats = sorted({t for s in sources for t in s.threat_types})
    if any(s.status == "match" for s in sources):
        return "malicious", threats, "full" if all(s.status in ("match", "clear") for s in sources) else "partial"
    clear = [s for s in sources if s.status == "clear"]
    if len(clear) == len(sources):
        return "clean", [], "full"
    if clear:
        return "unknown", [], "partial"
    return "unknown", [], "none"


# --------------------------------------------------------------------------- Routes: health / devices
@api.get("/health")
async def health():
    return {"status": "ok", "service": "apollo-v1", "time": now_utc().isoformat()}


@api.post("/devices/register")
async def register_device(body: DeviceRegister):
    existing = await db.devices.find_one({"device_id": body.device_id})
    ts = now_utc()
    if existing:
        await db.devices.update_one(
            {"device_id": body.device_id},
            {"$set": {"last_seen_at": ts, "platform": body.platform, "adapter_mode": body.adapter_mode, "app_version": body.app_version}},
        )
        return {"device_id": body.device_id, "registered": False}
    device = Device(**body.model_dump(), created_at=ts, last_seen_at=ts)
    await db.devices.insert_one(device.to_mongo())
    return {"device_id": body.device_id, "registered": True}


# --------------------------------------------------------------------------- Routes: intel
@api.get("/intel/status")
async def intel_status():
    if not SAFE_BROWSING_API_KEY:
        sb = {"status": "not_configured", "detail": "Add SAFE_BROWSING_API_KEY to enable Google Safe Browsing."}
    else:
        stale = _sb_probe["checked_at"] is None or now_utc() - _sb_probe["checked_at"] > timedelta(minutes=10)
        if stale:
            await safe_browsing_lookup("http://testsafebrowsing.appspot.com/s/phishing.html")
        sb = {"status": _sb_probe["status"], "detail": _sb_probe["detail"]}
    count = await db.blocklist.count_documents({"deleted_at": None})
    return {"safe_browsing": sb, "blocklist": {"status": "ok", "entries": count}, "checked_at": now_utc()}


@api.post("/intel/check", response_model=IntelCheckResponse)
async def intel_check(body: IntelCheckRequest):
    return await run_intel_check(body.indicator_type, body.value)


class IntelBatchRequest(BaseModel):
    indicator_type: Literal["url", "domain"] = "url"
    values: list[str] = Field(min_length=1, max_length=200)


class IntelBatchItem(BaseModel):
    value: str
    result: Optional[IntelCheckResponse] = None
    error: Optional[str] = None


@api.post("/intel/check-batch", response_model=list[IntelBatchItem])
async def intel_check_batch(body: IntelBatchRequest):
    """Benchmark support: check many indicators in one round-trip. Same privacy rules as /intel/check."""
    out: list[IntelBatchItem] = []
    for value in body.values:
        try:
            out.append(IntelBatchItem(value=value, result=await run_intel_check(body.indicator_type, value)))
        except HTTPException as exc:
            out.append(IntelBatchItem(value=value, error=str(exc.detail)))
    return out


async def run_intel_check(indicator_type: str, value: str) -> IntelCheckResponse:
    url, host = sanitize_url(value)
    indicator = host if indicator_type == "domain" else url
    dg = digest(indicator)
    ts = now_utc()
    cached = await db.reputation_cache.find_one({"indicator_digest": dg})
    if cached:
        rc = ReputationCache.from_mongo(cached)
        if rc.expires_at.replace(tzinfo=timezone.utc) > ts:
            return IntelCheckResponse(
                verdict=rc.verdict, threat_types=rc.threat_types, sources=[IntelSource(**s) for s in rc.sources],
                indicator_digest=dg, checked_at=rc.checked_at, cached=True, coverage=rc.coverage,  # type: ignore[arg-type]
            )
    sources = [await blocklist_check(host)]
    sb_source, sb_expiry = await safe_browsing_lookup(url if indicator_type == "url" else f"http://{host}/")
    sources.append(sb_source)
    verdict, threats, coverage = combine(sources)
    expires = sb_expiry or (ts + timedelta(minutes=5 if verdict != "unknown" else 1))
    record = ReputationCache(
        indicator_digest=dg, verdict=verdict, threat_types=threats, sources=[s.model_dump() for s in sources],
        coverage=coverage, checked_at=ts, expires_at=expires,
    )
    await db.reputation_cache.update_one({"indicator_digest": dg}, {"$set": record.to_mongo()}, upsert=True)
    return IntelCheckResponse(
        verdict=verdict, threat_types=threats, sources=sources, indicator_digest=dg, checked_at=ts, cached=False, coverage=coverage  # type: ignore[arg-type]
    )


# --------------------------------------------------------------------------- Routes: patrol
@api.post("/patrol/events", response_model=PatrolEvent)
async def upsert_event(body: PatrolEventIn):
    ts = now_utc()
    existing = await db.patrol_events.find_one({"event_id": body.event_id, "device_id": body.device_id})
    if existing:
        await db.patrol_events.update_one({"_id": existing["_id"]}, {"$set": {**body.model_dump(), "updated_at": ts}})
        doc = await db.patrol_events.find_one({"_id": existing["_id"]})
        return PatrolEvent.from_mongo(doc)
    event = PatrolEvent(**body.model_dump(), created_at=ts, updated_at=ts)
    result = await db.patrol_events.insert_one(event.to_mongo())
    event.id = str(result.inserted_id)
    if event.state in ("barking", "biting"):
        asyncio.create_task(notify_guardians(event))
    return event


@api.get("/patrol/events", response_model=list[PatrolEvent])
async def list_events(device_id: str = Query(min_length=8, max_length=64), limit: int = Query(default=200, le=500)):
    docs = await db.patrol_events.find({"device_id": device_id, "deleted_at": None}).sort("occurred_at", -1).to_list(limit)
    return [PatrolEvent.from_mongo(d) for d in docs]


@api.patch("/patrol/events/{event_id}", response_model=PatrolEvent)
async def patch_event(event_id: str, body: PatrolEventPatch, device_id: str = Query(min_length=8, max_length=64)):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    updates["updated_at"] = now_utc()
    result = await db.patrol_events.update_one({"event_id": event_id, "device_id": device_id, "deleted_at": None}, {"$set": updates})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Event not found")
    doc = await db.patrol_events.find_one({"event_id": event_id, "device_id": device_id})
    return PatrolEvent.from_mongo(doc)


@api.delete("/patrol/events")
async def clear_events(device_id: str = Query(min_length=8, max_length=64)):
    result = await db.patrol_events.update_many({"device_id": device_id, "deleted_at": None}, {"$set": {"deleted_at": now_utc()}})
    return {"soft_deleted": result.modified_count}


# --------------------------------------------------------------------------- Routes: trust
@api.post("/trust", response_model=TrustEntry)
async def add_trust(body: TrustIn):
    existing = await db.trust_entries.find_one({"trust_id": body.trust_id})
    if existing:
        return TrustEntry.from_mongo(existing)
    entry = TrustEntry(**body.model_dump(), created_at=now_utc())
    result = await db.trust_entries.insert_one(entry.to_mongo())
    entry.id = str(result.inserted_id)
    return entry


@api.get("/trust", response_model=list[TrustEntry])
async def list_trust(device_id: str = Query(min_length=8, max_length=64)):
    docs = await db.trust_entries.find({"device_id": device_id, "deleted_at": None}).sort("created_at", -1).to_list(500)
    return [TrustEntry.from_mongo(d) for d in docs]


@api.delete("/trust/{trust_id}")
async def revoke_trust(trust_id: str, device_id: str = Query(min_length=8, max_length=64)):
    result = await db.trust_entries.update_one({"trust_id": trust_id, "device_id": device_id, "deleted_at": None}, {"$set": {"deleted_at": now_utc()}})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Trust entry not found")
    return {"revoked": True}


# --------------------------------------------------------------------------- Routes: Ask Apollo
APOLLO_SYSTEM_PROMPT = """You are Apollo, a calm, plain-language security guide inside a privacy-first mobile app for everyday people in Australia.
Your role is explanation and guidance only. You do not decide whether something is safe, and you never claim Apollo blocked or verified anything unless the provided event context says so.
Apollo's four states mean exactly: Resting = safe within the checks Apollo can see; Growling = unusual or uncertain, not confirmed; Barking = the person needs to decide or act; Biting = Apollo verified and blocked a threat.
Rules: no fear theatrics, no jargon without a one-line explanation, no fake certainty. If something is uncertain, say so plainly. Never ask for passwords, codes or personal details. Keep answers short (under 150 words) with clear next steps. If asked about things outside online safety, gently redirect."""


async def gemini_stream(device_id: str, message: str, context: Optional[str]) -> AsyncIterator[str]:
    from emergentintegrations.llm.chat import LlmChat, StreamDone, TextDelta, UserMessage

    history = await db.ask_messages.find({"device_id": device_id}).sort("created_at", -1).to_list(8)
    history_text = "\n".join(
        f"{'User' if AskMessage.from_mongo(m).role == 'user' else 'Apollo'}: {AskMessage.from_mongo(m).content}" for m in reversed(history)
    )
    prompt = message
    if context:
        prompt = f"Event context from the app (minimal indicators only):\n{context}\n\nQuestion: {message}"
    if history_text:
        prompt = f"Recent conversation:\n{history_text}\n\n{prompt}"

    chat = LlmChat(api_key=GEMINI_API_KEY, session_id=f"apollo-{device_id}-{uuid.uuid4().hex[:6]}", system_message=APOLLO_SYSTEM_PROMPT).with_model(
        "gemini", "gemini-3-flash-preview"
    )
    full = ""
    async for ev in chat.stream_message(UserMessage(text=prompt)):
        if isinstance(ev, TextDelta):
            full += ev.content
            yield f"data: {json.dumps({'delta': ev.content})}\n\n"
        elif isinstance(ev, StreamDone):
            break
    await db.ask_messages.insert_one(AskMessage(device_id=device_id, role="apollo", content=full, created_at=now_utc()).to_mongo())
    yield f"data: {json.dumps({'done': True})}\n\n"


@api.post("/ask/stream")
async def ask_stream(body: AskRequest):
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=503, detail="Ask Apollo is not configured")
    await db.ask_messages.insert_one(AskMessage(device_id=body.device_id, role="user", content=body.message, created_at=now_utc()).to_mongo())

    async def gen():
        try:
            async for chunk in gemini_stream(body.device_id, body.message, body.context):
                yield chunk
        except Exception as exc:  # noqa: BLE001
            logger.warning("ask stream failed: %s", type(exc).__name__)
            yield f"data: {json.dumps({'error': 'Apollo could not answer right now.'})}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@api.get("/ask/history", response_model=list[AskMessage])
async def ask_history(device_id: str = Query(min_length=8, max_length=64)):
    docs = await db.ask_messages.find({"device_id": device_id}).sort("created_at", 1).to_list(200)
    return [AskMessage.from_mongo(d) for d in docs]


@api.delete("/ask/history")
async def clear_ask_history(device_id: str = Query(min_length=8, max_length=64)):
    result = await db.ask_messages.delete_many({"device_id": device_id})
    return {"deleted": result.deleted_count}


# --------------------------------------------------------------------------- Family sharing
# Two channels: (a) email to a confirmed guardian via Emergent-managed email; (b) device pairing code.
# Only Barking/Biting event summaries are shared (headline, domain, what to do). Never the full link.
EMAIL_BASE_URL = "https://integrations.emergentagent.com"
EMAIL_KEY = os.environ.get("EMERGENT_EMAIL_KEY", "")
EMAIL_FROM_NAME = os.environ["EMAIL_FROM_NAME"]
PUBLIC_BASE = os.environ.get("PUBLIC_API_BASE", "")  # e.g. https://<host>; confirm links are first-party
_CRED_ASK = ("reply with your password", "reply with the code", "send your password", "cvv", "seed phrase", "verify your card", "confirm your bank details")


def _assert_safe_email(subject: str, html: str) -> None:
    low = f"{subject}\n{html}".lower()
    if "<form" in low or "<input" in low:
        raise ValueError("No forms in email")
    if any(p in low for p in _CRED_ASK):
        raise ValueError("Credential ask phrasing")
    for m in __import__("re").finditer(r'(?:href|src)="([^"]+)"', html):
        u = m.group(1).lower()
        if u.startswith(("mailto:", "#")):
            continue
        if not u.startswith("https://") or "xn--" in u or "@" in u.split("/")[2]:
            raise ValueError(f"Unsafe link {u}")


async def send_email(*, to: str, subject: str, html: str) -> Optional[str]:
    _assert_safe_email(subject, html)
    if not EMAIL_KEY:
        raise HTTPException(status_code=503, detail="Email is not configured")
    async with httpx.AsyncClient(timeout=30) as http:
        resp = await http.post(f"{EMAIL_BASE_URL}/api/v1/email/send", headers={"X-Email-Key": EMAIL_KEY}, json={"to": [to], "subject": subject, "html": html, "from_name": EMAIL_FROM_NAME})
    if resp.status_code >= 400:
        logger.error("email send failed: %s", resp.status_code)
        raise HTTPException(status_code=502, detail="Failed to send email")
    return resp.json().get("id")


def _wrap(body: str) -> str:
    return (f'<table role="presentation" width="100%"><tr><td style="padding:24px;font-family:Arial,sans-serif;color:#111">{body}'
            f'<p style="font-size:12px;color:#888">Sent by {escape(EMAIL_FROM_NAME)}, a privacy-first security app. Apollo never asks for passwords, codes or payment details by email.</p></td></tr></table>')


class GuardianIn(BaseModel):
    device_id: str = Field(min_length=8, max_length=64)
    email: str = Field(min_length=5, max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    name: str = Field(default="", max_length=60)
    owner_name: str = Field(default="", max_length=60)


class Guardian(BaseDocument):
    guardian_id: str
    device_id: str
    email: str
    name: str
    owner_name: str
    confirmed: bool
    confirm_token: str
    created_at: datetime
    deleted_at: Optional[datetime] = None
    sent_today: int = 0
    sent_day: str = ""


@api.post("/family/guardians")
async def add_guardian(body: GuardianIn):
    count = await db.guardians.count_documents({"device_id": body.device_id, "deleted_at": None})
    if count >= 3:
        raise HTTPException(status_code=400, detail="Up to 3 trusted family members")
    g = Guardian(guardian_id=uuid.uuid4().hex, device_id=body.device_id, email=body.email.lower(), name=body.name, owner_name=body.owner_name,
                 confirmed=False, confirm_token=secrets.token_urlsafe(24), created_at=now_utc())
    await db.guardians.insert_one(g.to_mongo())
    link = f"{PUBLIC_BASE}/api/family/confirm/{g.confirm_token}" if PUBLIC_BASE.startswith("https://") else None
    who = escape(body.owner_name) or "someone you know"
    html = _wrap(f"<p>Hi {escape(body.name) or 'there'},</p><p>{who} uses {escape(EMAIL_FROM_NAME)} to stay safe from dangerous links and has asked to share safety alerts with you. "
                 f"You would only receive plain-language notices when Apollo is <strong>barking</strong> (action needed) or <strong>biting</strong> (a threat was blocked).</p>"
                 + (f'<p><a href="{link}">Yes, send me these alerts</a></p>' if link else "<p>Ask them to confirm this in the app.</p>")
                 + "<p>If you did not expect this, simply ignore this email.</p>")
    try:
        await send_email(to=g.email, subject=f"{who} wants to share Apollo safety alerts with you", html=html)
    except HTTPException as exc:
        await db.guardians.update_one({"guardian_id": g.guardian_id}, {"$set": {"deleted_at": now_utc()}})
        raise exc
    return {"guardian_id": g.guardian_id, "confirmed": False}


@api.get("/family/confirm/{token}")
async def confirm_guardian(token: str):
    from fastapi.responses import HTMLResponse
    result = await db.guardians.update_one({"confirm_token": token, "deleted_at": None}, {"$set": {"confirmed": True}})
    msg = "You're now receiving Apollo safety alerts. You can stop any time by asking the person who added you." if result.matched_count else "This link is no longer valid."
    return HTMLResponse(f"<html><body style='font-family:Arial;padding:32px;background:#0B1220;color:#F4F7FA'><h2>Apollo</h2><p>{msg}</p></body></html>")


@api.get("/family/guardians")
async def list_guardians(device_id: str = Query(min_length=8, max_length=64)):
    docs = await db.guardians.find({"device_id": device_id, "deleted_at": None}).to_list(10)
    return [{"guardian_id": d["guardian_id"], "email": d["email"], "name": d["name"], "confirmed": d["confirmed"], "created_at": d["created_at"]} for d in docs]


@api.delete("/family/guardians/{guardian_id}")
async def remove_guardian(guardian_id: str, device_id: str = Query(min_length=8, max_length=64)):
    r = await db.guardians.update_one({"guardian_id": guardian_id, "device_id": device_id, "deleted_at": None}, {"$set": {"deleted_at": now_utc()}})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"removed": True}


async def notify_guardians(event: PatrolEvent) -> None:
    try:
        guardians = await db.guardians.find({"device_id": event.device_id, "deleted_at": None, "confirmed": True}).to_list(10)
        links = await db.family_links.find({"protected_device_id": event.device_id, "deleted_at": None}).to_list(10)
        # fan out to paired guardian devices (in-app)
        for ln in links:
            await db.shared_events.update_one({"event_id": event.event_id, "guardian_device_id": ln["guardian_device_id"]}, {"$set": {
                "event_id": event.event_id, "guardian_device_id": ln["guardian_device_id"], "from_label": ln.get("owner_name") or "Family member",
                "state": event.state, "headline": event.headline, "what_to_do": event.what_to_do, "indicator_host": event.indicator_host, "occurred_at": event.occurred_at, "created_at": now_utc()}}, upsert=True)
        today = now_utc().strftime("%Y-%m-%d")
        for g in guardians:
            sent = g.get("sent_today", 0) if g.get("sent_day") == today else 0
            if sent >= 5:
                continue
            who = escape(g.get("owner_name") or "Your family member")
            verb = "needs to be careful" if event.state == "barking" else "was protected"
            html = _wrap(f"<p>Hi {escape(g.get('name') or 'there')},</p><p>{who} {verb}: <strong>{escape(event.headline)}</strong></p>"
                         f"<p>{escape(event.what_happened)}</p><p><strong>What to do:</strong> {escape(event.what_to_do)}</p>"
                         f"<p>Website involved: {escape(event.indicator_host or 'n/a')}. A quick call to check in is usually the most helpful thing.</p>")
            await send_email(to=g["email"], subject=f"Apollo alert: {who} {verb}", html=html)
            await db.guardians.update_one({"guardian_id": g["guardian_id"]}, {"$set": {"sent_day": today, "sent_today": sent + 1}})
    except Exception as exc:  # noqa: BLE001
        logger.warning("guardian notify failed: %s", type(exc).__name__)


class PairRequest(BaseModel):
    device_id: str = Field(min_length=8, max_length=64)
    owner_name: str = Field(default="", max_length=60)


class LinkRequest(BaseModel):
    device_id: str = Field(min_length=8, max_length=64)
    code: str = Field(min_length=6, max_length=6)


@api.post("/family/pair")
async def create_pair_code(body: PairRequest):
    code = "".join(secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(6))
    await db.pair_codes.insert_one({"code": code, "protected_device_id": body.device_id, "owner_name": body.owner_name, "created_at": now_utc(), "expires_at": now_utc() + timedelta(hours=24), "used": False})
    return {"code": code, "expires_in_hours": 24}


@api.post("/family/link")
async def link_device(body: LinkRequest):
    pc = await db.pair_codes.find_one({"code": body.code.upper(), "used": False})
    if not pc or pc["expires_at"].replace(tzinfo=timezone.utc) < now_utc():
        raise HTTPException(status_code=404, detail="Code not found or expired")
    if pc["protected_device_id"] == body.device_id:
        raise HTTPException(status_code=400, detail="You can't link a device to itself")
    await db.pair_codes.update_one({"_id": pc["_id"]}, {"$set": {"used": True}})
    await db.family_links.update_one({"protected_device_id": pc["protected_device_id"], "guardian_device_id": body.device_id},
                                     {"$set": {"protected_device_id": pc["protected_device_id"], "guardian_device_id": body.device_id, "owner_name": pc.get("owner_name", ""), "created_at": now_utc(), "deleted_at": None}}, upsert=True)
    return {"linked": True, "owner_name": pc.get("owner_name", "")}


@api.get("/family/links")
async def list_links(device_id: str = Query(min_length=8, max_length=64)):
    protecting = await db.family_links.find({"guardian_device_id": device_id, "deleted_at": None}).to_list(20)
    watched_by = await db.family_links.find({"protected_device_id": device_id, "deleted_at": None}).to_list(20)
    return {"i_watch": [{"owner_name": l.get("owner_name", ""), "since": l["created_at"]} for l in protecting], "watching_me": len(watched_by)}


@api.get("/family/shared-events")
async def shared_events(device_id: str = Query(min_length=8, max_length=64)):
    docs = await db.shared_events.find({"guardian_device_id": device_id}).sort("occurred_at", -1).to_list(100)
    return [{k: v for k, v in d.items() if k != "_id"} for d in docs]



app.include_router(api)
app.add_middleware(CORSMiddleware, allow_credentials=True, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

SEED_BLOCKLIST = [
    ("testsafebrowsing.appspot.com", "SOCIAL_ENGINEERING", "Google Safe Browsing public test pages"),
    ("malware.testing.google.test", "MALWARE", "Google malware test domain"),
    ("phishing.apollo.test", "SOCIAL_ENGINEERING", "Apollo internal phishing test domain"),
    ("malware.apollo.test", "MALWARE", "Apollo internal malware test domain"),
]


@app.on_event("startup")
async def startup():
    await db.reputation_cache.create_index("indicator_digest", unique=True)
    await db.reputation_cache.create_index("expires_at", expireAfterSeconds=0)
    await db.patrol_events.create_index([("device_id", 1), ("event_id", 1)], unique=True)
    await db.trust_entries.create_index("trust_id", unique=True)
    await db.ask_messages.create_index([("device_id", 1), ("created_at", 1)])
    await db.blocklist.create_index("host", unique=True)
    for host, threat, reason in SEED_BLOCKLIST:
        entry = BlocklistEntry(host=host, threat_type=threat, reason=reason, added_at=now_utc())
        await db.blocklist.update_one({"host": host}, {"$setOnInsert": entry.to_mongo()}, upsert=True)


@app.on_event("shutdown")
async def shutdown():
    client.close()
