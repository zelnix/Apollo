"""Apollo V1 backend.

Privacy posture:
- Receives only minimal security indicators (a user-submitted link, a host name,
  or an event summary). Never page content, contacts, messages or device data.
- Reputation cache stores an HMAC digest of the indicator, never the raw value.
- All deletes are soft deletes (deleted_at).
"""
from __future__ import annotations

import hmac
import json
import logging
import os
import uuid
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


# --------------------------------------------------------------------------- App wiring
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
