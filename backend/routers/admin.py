"""External admin console (X-Admin-Key). Separate router; device bearer never applies here."""
from __future__ import annotations

import re
import secrets
from datetime import timedelta
from typing import Any, Literal, Optional

from fastapi import APIRouter, Header, HTTPException, Query, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field, field_validator

from core.db import db, now_utc
from core.models import BlocklistEntry
from routers.intel import intel_status


# Admin Audit Trail — every state-changing console action is written to `admin_audit` before it returns: who (the
# console's optional `X-Admin-Actor`, e.g. an operator's login, plus the caller IP), what, on which target, when.
# Append-only: there is no admin route that edits or deletes audit rows.
async def audit(request: Request, action: str, target: str, detail: dict[str, Any] | None = None, actor: Optional[str] = None) -> None:
    await db.admin_audit.insert_one({
        "audit_id": secrets.token_hex(8), "at": now_utc(), "action": action, "target": target, "detail": detail or {},
        "actor": (actor or "").strip()[:80] or "console", "ip": (request.headers.get("x-forwarded-for") or (request.client.host if request.client else "") or "").split(",")[0].strip()[:64],
    })


def _audit_row(d: dict[str, Any]) -> dict[str, Any]:
    return {k: d.get(k) for k in ("audit_id", "at", "action", "target", "detail", "actor", "ip")}

router = APIRouter()


class BlocklistIn(BaseModel):
    host: str = Field(min_length=3, max_length=253)
    threat_type: Literal["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE", "POTENTIALLY_HARMFUL_APPLICATION"] = "SOCIAL_ENGINEERING"
    reason: str = Field(min_length=3, max_length=200)

    @field_validator("host")
    @classmethod
    def _host(cls, v: str) -> str:
        h = v.strip().lower().rstrip(".")
        if not re.fullmatch(r"[a-z0-9-]+(\.[a-z0-9-]+)+", h):
            raise ValueError("host must be a bare domain name")
        return h


def _admin_device(d: dict[str, Any]) -> dict[str, Any]:
    return {k: d.get(k) for k in ("device_id", "platform", "adapter_mode", "app_version", "created_at", "last_seen_at", "token_issued_at", "token_expires_at", "revoked_at")}


@router.get("/ping")
async def admin_ping():
    return {"ok": True, "service": "apollo-v1", "time": now_utc().isoformat()}


@router.get("/stats")
async def admin_stats():
    since = now_utc() - timedelta(days=7)
    by_state = {r["_id"]: r["n"] async for r in db.patrol_events.aggregate([{"$match": {"occurred_at": {"$gte": since}, "deleted_at": None}}, {"$group": {"_id": "$state", "n": {"$sum": 1}}}])}
    return {
        "devices": {"total": await db.devices.count_documents({}), "active_credentials": await db.devices.count_documents({"revoked_at": None, "token_expires_at": {"$gt": now_utc()}}), "revoked": await db.devices.count_documents({"revoked_at": {"$ne": None}}), "seen_7d": await db.devices.count_documents({"last_seen_at": {"$gte": since}})},
        "events_7d": {"total": sum(by_state.values()), "by_state": by_state},
        "blocklist": {"entries": await db.blocklist.count_documents({"deleted_at": None})},
        "feedback": {"total": await db.feedback.count_documents({}), "last_7d": await db.feedback.count_documents({"created_at": {"$gte": since}})},
        "family": {"links": await db.family_links.count_documents({}), "guardians": await db.guardians.count_documents({"deleted_at": None})},
        "intel": await intel_status(),
        "audit": {
            "total": await db.admin_audit.count_documents({}),
            "last_7d": await db.admin_audit.count_documents({"at": {"$gte": since}}),
            "by_action_7d": {r["_id"]: r["n"] async for r in db.admin_audit.aggregate([{"$match": {"at": {"$gte": since}}}, {"$group": {"_id": "$action", "n": {"$sum": 1}}}])},
            "recent": [_audit_row(d) for d in await db.admin_audit.find().sort("at", -1).to_list(10)],
        },
    }


@router.get("/audit")
async def admin_audit_log(limit: int = Query(default=100, le=1000), action: Optional[str] = None, actor: Optional[str] = None, target: Optional[str] = None):
    q: dict[str, Any] = {}
    if action:
        q["action"] = action
    if actor:
        q["actor"] = actor
    if target:
        q["target"] = target
    return [_audit_row(d) for d in await db.admin_audit.find(q).sort("at", -1).to_list(limit)]


@router.get("/blocklist")
async def admin_list_blocklist(include_deleted: bool = False):
    q = {} if include_deleted else {"deleted_at": None}
    rows = await db.blocklist.find(q, {"_id": 0}).sort("added_at", -1).to_list(5000)
    return rows


@router.post("/blocklist", status_code=201)
async def admin_add_blocklist(body: BlocklistIn, request: Request, actor: Optional[str] = Header(default=None, alias="X-Admin-Actor")):
    entry = BlocklistEntry(host=body.host, threat_type=body.threat_type, reason=body.reason, added_at=now_utc())
    await db.blocklist.update_one({"host": body.host}, {"$set": {**entry.to_mongo(), "deleted_at": None}}, upsert=True)
    await db.reputation_cache.delete_many({})  # verdicts must reflect the list immediately, not after the cache TTL
    await audit(request, "blocklist.add", body.host, {"threat_type": body.threat_type, "reason": body.reason}, actor)
    return {"host": body.host, "threat_type": body.threat_type, "reason": body.reason}


@router.delete("/blocklist/{host}", status_code=204)
async def admin_remove_blocklist(host: str, request: Request, actor: Optional[str] = Header(default=None, alias="X-Admin-Actor")):
    r = await db.blocklist.update_one({"host": host.strip().lower(), "deleted_at": None}, {"$set": {"deleted_at": now_utc()}})
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="Not on the blocklist.")
    await db.reputation_cache.delete_many({})
    await audit(request, "blocklist.remove", host.strip().lower(), None, actor)
    return Response(status_code=204)


@router.get("/feedback")
async def admin_list_feedback(limit: int = Query(default=100, le=500), kind: Optional[str] = None):
    q: dict[str, Any] = {"kind": kind} if kind else {}
    return await db.feedback.find(q, {"_id": 0}).sort("created_at", -1).to_list(limit)


@router.get("/devices")
async def admin_list_devices(limit: int = Query(default=100, le=500), platform: Optional[str] = None):
    q: dict[str, Any] = {"platform": platform} if platform else {}
    rows = await db.devices.find(q).sort("last_seen_at", -1).to_list(limit)
    return [_admin_device(d) for d in rows]  # never token hashes


@router.get("/devices/{device_id}")
async def admin_get_device(device_id: str):
    d = await db.devices.find_one({"device_id": device_id})
    if not d:
        raise HTTPException(status_code=404, detail="Unknown device.")
    events = await db.patrol_events.count_documents({"device_id": device_id, "deleted_at": None})
    links = await db.family_links.count_documents({"$or": [{"protected_device_id": device_id}, {"guardian_device_id": device_id}]})
    return {**_admin_device(d), "patrol_events": events, "family_links": links}


@router.post("/devices/{device_id}/revoke", status_code=204)
async def admin_revoke_device(device_id: str, request: Request, actor: Optional[str] = Header(default=None, alias="X-Admin-Actor")):
    """Kills the device's credential: its next call gets 401 and the app enters the explicit re-register state."""
    r = await db.devices.update_one({"device_id": device_id, "revoked_at": None}, {"$set": {"revoked_at": now_utc()}})
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="Unknown or already revoked device.")
    await audit(request, "device.revoke", device_id, None, actor)
    return Response(status_code=204)
