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
import re
import secrets
import uuid
from html import escape
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from pathlib import Path
from typing import Annotated, Any, AsyncIterator, Literal, Optional
from urllib.parse import urlparse, urlunparse

import httpx
from pymongo.errors import DuplicateKeyError
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
# Gate 8 — optional breach intelligence (Have I Been Pwned). Empty → /api/account/breach reports "not_configured".
HIBP_API_KEY = os.environ.get("HIBP_API_KEY", "")
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
ApolloState = Literal["sniffing", "resting", "ears_up", "growling", "barking", "biting"]
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
    # Gate 3: follow shorteners/redirects and judge the FINAL destination (W04/W05). Shortened ≠ malicious.
    expand: bool = False

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
    redirect_chain: list[str] = Field(default_factory=list)  # hosts visited, first → final (only when expand=True and redirects occurred)
    final_url: Optional[str] = None


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
    category: Literal["link", "website", "connection", "known_threat", "protection", "system", "message", "call", "app", "device", "account", "email"]
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
    # True when the native Site Guard raised this while the app was closed → owner gets a push.
    background: bool = False
    # Gate 2 (messages): extracted security signals only — never the conversation.
    claimed_brand: Optional[str] = Field(default=None, max_length=60)
    scenario: Optional[str] = Field(default=None, max_length=40)
    scent_id: Optional[str] = Field(default=None, max_length=64)


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


# --------------------------------------------------------------------------- Quiet hours (device settings)
# Growling (non-urgent) pushes are silenced inside the window; Barking/Biting always come through.
class QuietHours(BaseModel):
    enabled: bool = False
    start_minutes: int = Field(default=22 * 60, ge=0, le=1439)  # local minutes since midnight
    end_minutes: int = Field(default=7 * 60, ge=0, le=1439)
    tz_offset_minutes: int = Field(default=0, ge=-840, le=840)  # local = UTC + offset


class DeviceSettingsIn(BaseModel):
    quiet_hours: QuietHours


def in_quiet_hours(qh: Optional[dict[str, Any]], at: Optional[datetime] = None) -> bool:
    if not qh or not qh.get("enabled"):
        return False
    local = (at or now_utc()) + timedelta(minutes=int(qh.get("tz_offset_minutes", 0)))
    m = local.hour * 60 + local.minute
    start, end = int(qh.get("start_minutes", 1320)), int(qh.get("end_minutes", 420))
    return start <= m < end if start <= end else (m >= start or m < end)


@api.put("/devices/{device_id}/settings")
async def put_device_settings(device_id: str, body: DeviceSettingsIn):
    await db.devices.update_one({"device_id": device_id}, {"$set": {"settings": body.model_dump(), "last_seen_at": now_utc()}}, upsert=True)
    return body


@api.get("/devices/{device_id}/settings")
async def get_device_settings(device_id: str):
    doc = await db.devices.find_one({"device_id": device_id})
    settings = (doc or {}).get("settings") or {"quiet_hours": QuietHours().model_dump()}
    return {**settings, "quiet_now": in_quiet_hours(settings.get("quiet_hours"))}


async def device_quiet_now(device_id: str) -> bool:
    doc = await db.devices.find_one({"device_id": device_id}, {"settings": 1})
    return in_quiet_hours(((doc or {}).get("settings") or {}).get("quiet_hours"))


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


async def expand_redirects(url: str, max_hops: int = 5) -> list[str]:
    """Follow HTTP redirects without downloading bodies. Returns the URL chain (first → final)."""
    chain = [url]
    try:
        async with httpx.AsyncClient(timeout=6.0, follow_redirects=False, headers={"User-Agent": "Mozilla/5.0 (Apollo link check)"}) as http:
            cur = url
            for _ in range(max_hops):
                try:
                    resp = await http.head(cur)
                    if resp.status_code in (405, 403, 400):
                        resp = await http.get(cur)
                except httpx.HTTPError:
                    break
                loc = resp.headers.get("location")
                if resp.status_code not in (301, 302, 303, 307, 308) or not loc:
                    break
                nxt = str(httpx.URL(cur).join(loc))
                if nxt in chain:
                    break
                chain.append(nxt)
                cur = nxt
    except Exception as exc:  # noqa: BLE001
        logger.info("redirect expansion stopped: %s", type(exc).__name__)
    return chain


@api.post("/intel/check", response_model=IntelCheckResponse)
async def intel_check(body: IntelCheckRequest):
    if not body.expand or body.indicator_type != "url":
        return await run_intel_check(body.indicator_type, body.value)
    chain = await expand_redirects(body.value)
    final = chain[-1]
    # Judge the final destination; any confirmed-malicious hop along the way also counts.
    result = await run_intel_check("url", final)
    threat_types, sources, verdict = list(result.threat_types), list(result.sources), result.verdict
    for hop in chain[:-1]:
        try:
            r = await run_intel_check("url", hop)
        except HTTPException:
            continue
        if r.verdict == "malicious":
            verdict = "malicious"; threat_types = sorted(set(threat_types + r.threat_types))
    hosts = []
    for u in chain:
        try:
            hosts.append(sanitize_url(u)[1])
        except HTTPException:
            hosts.append(urlparse(u).hostname or u)
    return IntelCheckResponse(verdict=verdict, threat_types=threat_types, sources=sources, indicator_digest=result.indicator_digest, checked_at=result.checked_at, cached=result.cached,
                              coverage=result.coverage, redirect_chain=hosts if len(chain) > 1 else [], final_url=final if len(chain) > 1 else None)


class FeedbackIn(BaseModel):
    device_id: str = Field(min_length=8, max_length=64)
    event_id: str = Field(min_length=8, max_length=64)
    kind: Literal["false_positive", "missed_threat", "override"]
    state: ApolloState
    host: Optional[str] = Field(default=None, max_length=253)
    sources: list[str] = Field(default_factory=list, max_length=10)
    note: str = Field(default="", max_length=300)


@api.post("/feedback", status_code=201)
async def submit_feedback(body: FeedbackIn):
    """Report Mistake / user override. Reviewed by humans — never auto-whitelists a site globally."""
    await db.feedback.insert_one({**body.model_dump(), "created_at": now_utc()})
    return {"received": True}


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
    try:
        result = await db.patrol_events.insert_one(event.to_mongo())
    except DuplicateKeyError:
        # Two syncs of the same event raced (e.g. link check + QR merge). Idempotent: apply as an update.
        await db.patrol_events.update_one({"event_id": body.event_id, "device_id": body.device_id}, {"$set": {**body.model_dump(), "updated_at": ts}})
        doc = await db.patrol_events.find_one({"event_id": body.event_id, "device_id": body.device_id})
        return PatrolEvent.from_mongo(doc)
    event.id = str(result.inserted_id)
    if event.state in ("barking", "biting"):
        asyncio.create_task(notify_guardians(event))
        if event.background:
            asyncio.create_task(push_owner_alert(event))
    elif event.state == "growling" and event.background:
        asyncio.create_task(push_owner_alert(event))  # respects quiet hours
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
Apollo's four states mean exactly: Patrolling (internally "resting") = on the lookout, safe within the checks Apollo can see; Growling = unusual or uncertain, not confirmed; Barking = the person needs to decide or act; Biting = Apollo verified and blocked a threat.
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
        # fan out to paired guardian devices (in-app + push)
        for ln in links:
            await db.shared_events.update_one({"event_id": event.event_id, "guardian_device_id": ln["guardian_device_id"]}, {"$set": {
                "event_id": event.event_id, "guardian_device_id": ln["guardian_device_id"], "protected_device_id": event.device_id, "from_label": ln.get("owner_name") or "Family member",
                "state": event.state, "headline": event.headline, "what_to_do": event.what_to_do, "indicator_host": event.indicator_host, "occurred_at": event.occurred_at, "created_at": now_utc()}}, upsert=True)
        if links:
            who = links[0].get("owner_name") or "A family member"
            verb = "needs to be careful" if event.state == "barking" else "was protected"
            try:
                await send_push(
                    recipients=[ln["guardian_device_id"] for ln in links][:100],
                    data={"title": f"Apollo: {who} {verb}", "message": event.headline, "subtext": "Tap to see the alert and call them.", "action_url": f"/family/alert/{event.event_id}", **PUSH_THREAT},
                    idempotency_key=f"guardian-{event.event_id}",
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning("guardian push failed (non-blocking): %s", type(exc).__name__)
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
    phone: str = Field(default="", max_length=24)  # optional; shared only with the family member who links


class LinkRequest(BaseModel):
    device_id: str = Field(min_length=8, max_length=64)
    code: str = Field(min_length=6, max_length=6)


_PHONE_OK = set("+0123456789 ()-")


def _clean_phone(p: str) -> str:
    p = p.strip()
    if p and (any(ch not in _PHONE_OK for ch in p) or sum(ch.isdigit() for ch in p) < 6):
        raise HTTPException(status_code=400, detail="Enter a valid phone number")
    return p


@api.post("/family/pair")
async def create_pair_code(body: PairRequest):
    phone = _clean_phone(body.phone)
    code = "".join(secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(6))
    await db.pair_codes.insert_one({"code": code, "protected_device_id": body.device_id, "owner_name": body.owner_name, "owner_phone": phone, "created_at": now_utc(), "expires_at": now_utc() + timedelta(hours=24), "used": False})
    if phone:  # keep existing links in sync so watchers always have the latest number
        await db.family_links.update_many({"protected_device_id": body.device_id, "deleted_at": None}, {"$set": {"owner_phone": phone}})
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
                                     {"$set": {"protected_device_id": pc["protected_device_id"], "guardian_device_id": body.device_id, "owner_name": pc.get("owner_name", ""), "owner_phone": pc.get("owner_phone", ""), "created_at": now_utc(), "deleted_at": None}}, upsert=True)
    return {"linked": True, "owner_name": pc.get("owner_name", "")}


class PhoneIn(BaseModel):
    device_id: str = Field(min_length=8, max_length=64)  # caller (guardian)
    protected_device_id: str = Field(min_length=8, max_length=64)
    phone: str = Field(default="", max_length=24)


@api.post("/family/links/phone")
async def set_link_phone(body: PhoneIn):
    """Watcher edits/adds the number they call for a person they watch (overrides the owner-supplied one)."""
    phone = _clean_phone(body.phone)
    r = await db.family_links.update_one({"protected_device_id": body.protected_device_id, "guardian_device_id": body.device_id, "deleted_at": None}, {"$set": {"guardian_phone": phone}})
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="Link not found")
    return {"phone": phone}


def _link_phone(ln: dict[str, Any]) -> str:
    return ln.get("guardian_phone") or ln.get("owner_phone") or ""


@api.get("/family/links")
async def list_links(device_id: str = Query(min_length=8, max_length=64)):
    protecting = await db.family_links.find({"guardian_device_id": device_id, "deleted_at": None}).to_list(20)
    watched_by = await db.family_links.find({"protected_device_id": device_id, "deleted_at": None}).to_list(20)
    return {"i_watch": [{"owner_name": l.get("owner_name", ""), "protected_device_id": l["protected_device_id"], "phone": _link_phone(l), "since": l["created_at"]} for l in protecting], "watching_me": len(watched_by)}


@api.get("/family/shared-events")
async def shared_events(device_id: str = Query(min_length=8, max_length=64)):
    docs = await db.shared_events.find({"guardian_device_id": device_id}).sort("occurred_at", -1).to_list(100)
    links = {l["protected_device_id"]: l for l in await db.family_links.find({"guardian_device_id": device_id, "deleted_at": None}).to_list(20)}
    return [{**{k: v for k, v in d.items() if k != "_id"}, "phone": _link_phone(links.get(d.get("protected_device_id", ""), {}))} for d in docs]


class AckIn(BaseModel):
    device_id: str = Field(min_length=8, max_length=64)  # guardian device
    reply: Literal["called", "messaged", "visiting", "noted"] = "called"


ACK_LABEL = {"called": "I called them", "messaged": "I messaged them", "visiting": "I'm visiting them", "noted": "Noted, no action needed"}


@api.post("/family/shared-events/{event_id}/ack")
async def ack_shared_event(event_id: str, body: AckIn):
    """Guardian Reply: the family member marks how they responded; both sides see it."""
    se = await db.shared_events.find_one({"event_id": event_id, "guardian_device_id": body.device_id})
    if not se:
        raise HTTPException(status_code=404, detail="Alert not found")
    ts = now_utc()
    link = await db.family_links.find_one({"guardian_device_id": body.device_id, "deleted_at": None})
    await db.shared_events.update_one({"_id": se["_id"]}, {"$set": {"acknowledged_at": ts, "ack_label": ACK_LABEL[body.reply]}})
    ev = await db.patrol_events.find_one({"event_id": event_id})
    if ev:
        guardian_label = (link or {}).get("guardian_label") or "A family member"
        await db.family_acks.update_one({"event_id": event_id, "guardian_device_id": body.device_id}, {"$set": {
            "event_id": event_id, "protected_device_id": ev["device_id"], "guardian_device_id": body.device_id,
            "guardian_label": guardian_label, "ack_label": ACK_LABEL[body.reply], "headline": ev["headline"], "acknowledged_at": ts}}, upsert=True)
        try:
            await send_push(
                recipients=[ev["device_id"]],
                data={"title": f"{guardian_label} replied: {ACK_LABEL[body.reply]}", "message": ev["headline"], "action_url": "/family", **PUSH_FAMILY},
                idempotency_key=f"ack-{event_id}-{body.device_id}",
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("ack push failed (non-blocking): %s", type(exc).__name__)
    return {"acknowledged": True, "ack_label": ACK_LABEL[body.reply]}


# ---------------------------------------------------------------------------
# Family Incident Sharing — the protected person explicitly shares ONE incident (Threat Scent timeline + the
# combined Stay With Me plan and tick progress) with paired guardians. Minimal fields only; no message text.
# ---------------------------------------------------------------------------

class SharedIncidentEvent(BaseModel):
    event_id: str = Field(max_length=64)
    category: str = Field(max_length=20)
    state: ApolloState
    headline: str = Field(max_length=200)
    occurred_at: str = Field(max_length=40)
    status: str = Field(default="active", max_length=20)


class SharedIncidentStep(BaseModel):
    id: str = Field(max_length=40)
    text: str = Field(max_length=400)


class ShareIncidentIn(BaseModel):
    device_id: str = Field(min_length=8, max_length=64)
    scent_id: str = Field(min_length=4, max_length=64)
    headline: str = Field(max_length=200)
    state: ApolloState
    events: list[SharedIncidentEvent] = Field(max_length=30)
    steps: list[SharedIncidentStep] = Field(max_length=30)
    done: list[str] = Field(default_factory=list, max_length=30)
    note: str = Field(default="", max_length=300)


class IncidentProgressIn(BaseModel):
    device_id: str = Field(min_length=8, max_length=64)
    done: list[str] = Field(default_factory=list, max_length=30)
    resolved: bool = False


def _incident_out(d: dict[str, Any], links: dict[str, dict[str, Any]]) -> dict[str, Any]:
    return {**{k: v for k, v in d.items() if k != "_id"}, "phone": _link_phone(links.get(d.get("protected_device_id", ""), {}))}


@api.post("/family/incidents/share")
async def share_incident(body: ShareIncidentIn):
    links = await db.family_links.find({"protected_device_id": body.device_id, "deleted_at": None}).to_list(10)
    ts = now_utc()
    for ln in links:
        await db.shared_incidents.update_one({"scent_id": body.scent_id, "guardian_device_id": ln["guardian_device_id"]}, {"$set": {
            "scent_id": body.scent_id, "guardian_device_id": ln["guardian_device_id"], "protected_device_id": body.device_id,
            "from_label": ln.get("owner_name") or "Family member", "headline": body.headline, "state": body.state,
            "events": [e.model_dump() for e in body.events], "steps": [s.model_dump() for s in body.steps], "done": body.done, "note": body.note,
            "resolved": False, "shared_at": ts, "updated_at": ts}}, upsert=True)
    if links:
        who = links[0].get("owner_name") or "A family member"
        try:
            await send_push(recipients=[ln["guardian_device_id"] for ln in links][:100],
                            data={"title": f"Apollo: {who} is asking for help", "message": body.headline, "subtext": "Tap to see what happened and the steps they're working through.", "action_url": f"/family/incident/{body.scent_id}", **PUSH_THREAT},
                            idempotency_key=f"incident-{body.scent_id}-{ts.isoformat()[:16]}")
        except Exception as exc:  # noqa: BLE001
            logger.warning("incident push failed (non-blocking): %s", type(exc).__name__)
    return {"shared_with": len(links)}


@api.patch("/family/incidents/{scent_id}/progress")
async def incident_progress(scent_id: str, body: IncidentProgressIn):
    r = await db.shared_incidents.update_many({"scent_id": scent_id, "protected_device_id": body.device_id}, {"$set": {"done": body.done, "resolved": body.resolved, "updated_at": now_utc()}})
    return {"updated": r.matched_count}


@api.get("/family/incidents")
async def list_shared_incidents(device_id: str = Query(min_length=8, max_length=64)):
    docs = await db.shared_incidents.find({"guardian_device_id": device_id}).sort("updated_at", -1).to_list(50)
    links = {l["protected_device_id"]: l for l in await db.family_links.find({"guardian_device_id": device_id, "deleted_at": None}).to_list(20)}
    return [_incident_out(d, links) for d in docs]


@api.get("/family/incidents/{scent_id}")
async def get_shared_incident(scent_id: str, device_id: str = Query(min_length=8, max_length=64)):
    d = await db.shared_incidents.find_one({"scent_id": scent_id, "guardian_device_id": device_id})
    if not d:
        raise HTTPException(status_code=404, detail="Incident not found")
    links = {l["protected_device_id"]: l for l in await db.family_links.find({"guardian_device_id": device_id, "deleted_at": None}).to_list(20)}
    return _incident_out(d, links)


# Family Reassurance Note — a guardian sends a short "I'm here" note back onto a shared incident. Preset kinds
# keep it calm and quick; a custom line is capped short. Never carries passwords/codes (protected user is told so).
NOTE_TEXT = {"here": "I'm here — call me when you're ready.", "calling": "I'm calling you now.", "on_way": "I'm on my way over.", "together": "Don't worry, we'll sort this out together."}


class IncidentNoteIn(BaseModel):
    device_id: str = Field(min_length=8, max_length=64)  # guardian device
    kind: Literal["here", "calling", "on_way", "together", "custom"] = "here"
    text: str = Field(default="", max_length=140)
    from_name: str = Field(default="", max_length=40)


@api.post("/family/incidents/{scent_id}/notes", status_code=201)
async def add_incident_note(scent_id: str, body: IncidentNoteIn):
    inc = await db.shared_incidents.find_one({"scent_id": scent_id, "guardian_device_id": body.device_id})
    if not inc:
        raise HTTPException(status_code=404, detail="Incident not found")
    text = body.text.strip() if body.kind == "custom" else NOTE_TEXT[body.kind]
    if not text:
        raise HTTPException(status_code=422, detail="Write a short note first.")
    link_q = {"guardian_device_id": body.device_id, "protected_device_id": inc["protected_device_id"], "deleted_at": None}
    link = await db.family_links.find_one(link_q)
    from_name = body.from_name.strip()
    if from_name and link:
        await db.family_links.update_one({"_id": link["_id"]}, {"$set": {"guardian_label": from_name}})
    guardian_label = from_name or (link or {}).get("guardian_label") or "A family member"
    note = {"note_id": uuid.uuid4().hex, "scent_id": scent_id, "protected_device_id": inc["protected_device_id"], "guardian_device_id": body.device_id,
            "guardian_label": guardian_label, "kind": body.kind, "text": text, "created_at": now_utc()}
    await db.incident_notes.insert_one(dict(note))
    try:
        await send_push(recipients=[inc["protected_device_id"]],
                        data={"title": f"{guardian_label}: {text}", "message": inc["headline"], "action_url": f"/patrol/scent/{scent_id}", **PUSH_FAMILY},
                        idempotency_key=f"note-{note['note_id']}")
    except Exception as exc:  # noqa: BLE001
        logger.warning("note push failed (non-blocking): %s", type(exc).__name__)
    return note


@api.get("/family/incidents/{scent_id}/notes")
async def list_incident_notes(scent_id: str, device_id: str = Query(min_length=8, max_length=64)):
    """Protected user sees every guardian's notes; a guardian sees only the notes they sent."""
    docs = await db.incident_notes.find({"scent_id": scent_id, "$or": [{"protected_device_id": device_id}, {"guardian_device_id": device_id}]}).sort("created_at", 1).to_list(50)
    return [{k: v for k, v in d.items() if k != "_id"} for d in docs]


@api.get("/family/acks")
async def list_acks(device_id: str = Query(min_length=8, max_length=64)):
    docs = await db.family_acks.find({"protected_device_id": device_id}).sort("acknowledged_at", -1).to_list(50)
    return [{k: v for k, v in d.items() if k != "_id"} for d in docs]


# --------------------------------------------------------------------------- Alert notifications (Emergent managed push)
# Recipient identity is the anonymous device_id. Device tokens are relayed to the managed push
# service and never stored in our database. Payloads carry only the event headline + what to do.
PUSH_BASE_URL = "https://integrations.emergentagent.com"
PUSH_KEY = os.environ.get("EMERGENT_PUSH_KEY", "placeholder")
_push_client = httpx.AsyncClient(base_url=PUSH_BASE_URL, headers={"X-Push-Key": PUSH_KEY}, timeout=10.0)
# Sound routing — Android channel id + iOS aps.sound. Files bundled via expo-notifications `sounds` in app.json.
PUSH_THREAT = {"channel_id": "threats", "sound": "apollo_bark.wav"}   # Apollo barks: threat alerts (owner + family)
PUSH_FAMILY = {"channel_id": "family", "sound": "apollo_chime.wav"}   # softer chime: family replies


class RegisterPushBody(BaseModel):
    user_id: str = Field(min_length=8, max_length=64)
    platform: Literal["android", "ios"]
    device_token: str = Field(min_length=8, max_length=4096)


@api.post("/register-push", status_code=201)
async def register_push(body: RegisterPushBody):
    resp = await _push_client.post("/api/v1/push/users/register", json=body.model_dump())
    if resp.status_code == 401:
        raise HTTPException(status_code=500, detail="EMERGENT_PUSH_KEY missing or invalid")
    if resp.status_code >= 500:
        raise HTTPException(status_code=502, detail="Push provider unavailable")
    resp.raise_for_status()
    await db.devices.update_one({"device_id": body.user_id}, {"$set": {"push_registered_at": now_utc(), "push_platform": body.platform}})
    return {"status": "registered"}


async def send_push(recipients: list[str], data: dict, idempotency_key: Optional[str] = None) -> None:
    if not recipients:
        return
    if len(recipients) > 100:
        raise ValueError("max 100 recipients per /trigger call; chunk before sending")
    if "title" not in data or "message" not in data:
        raise ValueError("data must include title and message")
    payload: dict[str, Any] = {"recipients": recipients, "data": data}
    if idempotency_key:
        payload["$idempotency_key"] = idempotency_key
    resp = await _push_client.post("/api/v1/push/trigger", json=payload)
    if resp.status_code == 401:
        raise HTTPException(status_code=500, detail="EMERGENT_PUSH_KEY missing or invalid")
    if resp.status_code >= 500:
        raise HTTPException(status_code=502, detail="Push provider unavailable")
    resp.raise_for_status()


class PushTestIn(BaseModel):
    device_id: str = Field(min_length=8, max_length=64)


@api.post("/push/test")
async def push_test(body: PushTestIn):
    """Sample bark so people can hear and see exactly what a threat alert looks like."""
    try:
        await send_push(
            recipients=[body.device_id],
            data={"title": "Apollo is barking (test)", "message": "This is what a threat alert looks like. A real one names the website and tells you what to do.",
                  "subtext": "No action needed — this is a test.", "action_url": "/settings", **PUSH_THREAT},
            idempotency_key=f"test-{body.device_id}-{int(now_utc().timestamp())}",
        )
    except HTTPException as exc:
        raise HTTPException(status_code=exc.status_code, detail="Test alert could not be sent. Notifications work after a native build with push configured.") from exc
    return {"sent": True}


async def push_owner_alert(event: PatrolEvent) -> None:
    """Tell the protected person the moment Apollo barks/bites while the app is closed.
    Growling is a non-urgent nudge → default channel, silenced during the device's quiet hours."""
    try:
        if event.state == "growling":
            if await device_quiet_now(event.device_id):
                logger.info("growling push suppressed by quiet hours")
                return
            data = {"title": "Apollo is growling", "message": event.headline, "subtext": event.what_to_do[:120], "action_url": f"/patrol/{event.event_id}", "channel_id": "growling"}
        else:
            verb = "Apollo is barking" if event.state == "barking" else "Apollo blocked a threat"
            data = {"title": verb, "message": event.headline, "subtext": event.what_to_do[:120], "action_url": f"/patrol/{event.event_id}", **PUSH_THREAT}
        await send_push(recipients=[event.device_id], data=data, idempotency_key=f"owner-{event.event_id}")
    except Exception as exc:  # noqa: BLE001
        logger.warning("owner push failed (non-blocking): %s", type(exc).__name__)



# --------------------------------------------------------------------------- Gate 2: Text & Messaging
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


class MessageAnalyseOut(BaseModel):
    urls: list[MessageUrlResult]
    explanation: Optional[dict[str, Any]] = None  # {summary, why[], recommendation}
    gemini_used: bool = False


GATE2_EXPLAIN_PROMPT = """You are Apollo, a calm plain-language security guide for everyday Australians. You will be given a suspicious
message plus the findings of an on-device rule engine. Do NOT change the verdict. Write for a worried, non-technical person.
Return ONLY JSON: {"summary": "<one sentence, max 22 words>", "why": ["<3 short bullets, each max 16 words>"], "recommendation": "<one or two sentences, max 40 words>"}.
Rules: never tell the person to use contact details, links or numbers from the message itself; never promise money can be recovered;
never claim the device is compromised unless the findings say so; if the findings say the message looks normal, say so plainly and avoid alarm."""


async def gemini_second_opinion(body: MessageAnalyseIn, url_results: list[MessageUrlResult]) -> Optional[dict[str, Any]]:
    if not GEMINI_API_KEY:
        return None
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    findings = {"state": body.local_state, "scenario": body.scenario, "signals": body.signals, "claimed_brand": body.claimed_brand,
                "urls": [{"host": u.host, "verdict": u.verdict} for u in url_results]}
    prompt = f"Sender: {body.sender or 'unknown'}\nMessage:\n{body.text[:1500]}\n\nRule-engine findings (authoritative):\n{json.dumps(findings)}"
    chat = LlmChat(api_key=GEMINI_API_KEY, session_id=f"gate2-{uuid.uuid4().hex[:8]}", system_message=GATE2_EXPLAIN_PROMPT).with_model("gemini", "gemini-3-flash-preview")
    try:
        raw = await asyncio.wait_for(chat.send_message(UserMessage(text=prompt)), timeout=20)
        txt = raw.strip()
        if txt.startswith("```"):
            txt = txt.strip("`")
            txt = txt[txt.find("{"):txt.rfind("}") + 1]
        data = json.loads(txt)
        why = [str(w)[:160] for w in data.get("why", [])][:4]
        return {"summary": str(data.get("summary", ""))[:200], "why": why, "recommendation": str(data.get("recommendation", ""))[:320]}
    except Exception as exc:  # noqa: BLE001
        logger.warning("gate2 second opinion unavailable: %s", type(exc).__name__)
        return None


@api.post("/message/analyse", response_model=MessageAnalyseOut)
async def message_analyse(body: MessageAnalyseIn):
    results: list[MessageUrlResult] = []
    for raw in body.urls[:10]:
        try:
            normalized, host = sanitize_url(raw)
            r = await run_intel_check("url", normalized)
            results.append(MessageUrlResult(url=normalized, host=host, verdict=r.verdict, threat_types=r.threat_types, coverage=r.coverage))
        except HTTPException:
            continue
    explanation = await gemini_second_opinion(body, results) if body.second_opinion else None
    return MessageAnalyseOut(urls=results, explanation=explanation, gemini_used=explanation is not None)


class MessageExtractIn(BaseModel):
    device_id: str = Field(min_length=8, max_length=64)
    image_base64: str = Field(min_length=100, max_length=6_000_000)


GATE2_EXTRACT_PROMPT = """You read screenshots of text messages, chats, emails or QR codes for a security app. Extract exactly what is visible.
Return ONLY JSON: {"sender": "<phone number, name or handle shown, else empty>", "text": "<the message text(s) verbatim, most recent last>",
"urls": ["<every URL or domain visible, including any decoded from a QR code>"], "source": "<sms|whatsapp|imessage|email|messenger|telegram|other>"}.
Do not add commentary. Do not guess text you cannot read."""


@api.post("/message/extract")
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


@api.post("/page/extract")
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


GATE7_EXPLAIN_PROMPT = """You are Apollo, a calm plain-language security guide for everyday Australians. You will be given facts about an app
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
    if not GEMINI_API_KEY:
        return None
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    findings = {"state": body.local_state, "scenario": body.scenario, "reputation": rep.model_dump(), "hosts": [{"host": h.host, "verdict": h.verdict} for h in hosts]}
    prompt = (f"App: {body.name}\nDeveloper: {body.developer or 'unknown'}\nSource: {body.source}\nClaimed purpose: {body.purpose}\n"
              f"Permissions: {', '.join(body.permissions) or 'none'}\n\nEngine findings (authoritative):\n{json.dumps(findings)}")
    chat = LlmChat(api_key=GEMINI_API_KEY, session_id=f"gate7-{uuid.uuid4().hex[:8]}", system_message=GATE7_EXPLAIN_PROMPT).with_model("gemini", "gemini-3-flash-preview")
    try:
        raw = await asyncio.wait_for(chat.send_message(UserMessage(text=prompt)), timeout=20)
        txt = raw.strip()
        if txt.startswith("```"):
            txt = txt.strip("`")
            txt = txt[txt.find("{"):txt.rfind("}") + 1]
        data = json.loads(txt)
        return {"summary": str(data.get("summary", ""))[:200], "why": [str(w)[:160] for w in data.get("why", [])][:4], "recommendation": str(data.get("recommendation", ""))[:320]}
    except Exception as exc:  # noqa: BLE001
        logger.warning("gate7 gemini opinion failed: %s", exc)
        return None


@api.post("/app/analyse", response_model=AppAnalyseOut)
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


GATE8_EXPLAIN_PROMPT = """You are Apollo, a calm plain-language security guide for everyday Australians. You will be given an account-security
alert (login prompt, MFA request, password reset, breach notice…) plus the findings of an on-device Identity & Account Engine. Do NOT change the verdict.
Write for a worried, non-technical person. Return ONLY JSON: {"summary": "<one sentence, max 22 words>", "why": ["<3 short bullets, each max 16 words>"],
"recommendation": "<one or two sentences, max 40 words>"}. Rules: never tell the person to use links, numbers or buttons from the alert itself; always say to open
the service's own app or type its address; never say the account is definitely compromised unless the findings say a code or password was shared;
never ask for or mention their password value; if the findings say the alert looks normal, say so plainly."""


async def gemini_account_opinion(body: AccountAnalyseIn, urls: list[AccountUrlResult]) -> Optional[dict[str, Any]]:
    if not GEMINI_API_KEY:
        return None
    from emergentintegrations.llm.chat import LlmChat, UserMessage
    findings = {"state": body.local_state, "scenario": body.scenario, "kind": body.kind, "provider": body.provider, "urls": [{"host": u.host, "verdict": u.verdict, "official": u.official} for u in urls]}
    prompt = f"Sender: {body.sender or 'unknown'}\nAlert text:\n{body.text[:1500] or '(none shared)'}\n\nEngine findings (authoritative):\n{json.dumps(findings)}"
    chat = LlmChat(api_key=GEMINI_API_KEY, session_id=f"gate8-{uuid.uuid4().hex[:8]}", system_message=GATE8_EXPLAIN_PROMPT).with_model("gemini", "gemini-3-flash-preview")
    try:
        raw = await asyncio.wait_for(chat.send_message(UserMessage(text=prompt)), timeout=20)
        txt = raw.strip()
        if txt.startswith("```"):
            txt = txt.strip("`")
            txt = txt[txt.find("{"):txt.rfind("}") + 1]
        data = json.loads(txt)
        return {"summary": str(data.get("summary", ""))[:200], "why": [str(w)[:160] for w in data.get("why", [])][:4], "recommendation": str(data.get("recommendation", ""))[:320]}
    except Exception as exc:  # noqa: BLE001
        logger.warning("gate8 gemini opinion failed: %s", exc)
        return None


@api.post("/account/analyse", response_model=AccountAnalyseOut)
async def account_analyse(body: AccountAnalyseIn):
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


@api.post("/account/breach", response_model=BreachCheckOut)
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
