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
from core.models import BlocklistEntry, ThreatIndicatorIn, ThreatIndicatorWithdrawIn, ThreatIndicator
from routers.intel import intel_status
from services.patrol_policy import revalidate_stored_patrol


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
    # Aggregates are retrieval too: lazily correct pre-gate claims before counting Biting.
    async for event in db.patrol_events.find({
        "occurred_at": {"$gte": since}, "deleted_at": None,
        "$or": [{"state": "biting"}, {"verified_block": True}],
    }):
        await revalidate_stored_patrol(event)
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



# --------------------------------------------------------------------------- Threat indicators
# Stage 1: threat-intelligence lifecycle foundation. Full provenance, verification
# timestamps, revalidation scheduling, expiry, withdrawal records, audit trail.
# Current production rule delivery (/api/guarddog/rules) is UNCHANGED.

def _ti_row(d: dict[str, Any]) -> dict[str, Any]:
    """Project a threat indicator for the admin API — never expose _id."""
    out = {k: d.get(k) for k in (
        "indicator_id", "hostname", "scope", "source", "source_reference",
        "original_evidence", "original_scope", "status", "review_status",
        "first_seen_at", "last_verified_at", "next_scheduled_check",
        "evidence_expiry_deadline", "verification_count",
        "last_revalidation_outcome", "last_revalidation_at",
        "consecutive_check_failures", "added_at", "updated_at",
        "withdrawn_at", "withdrawal_reason", "added_by",
    )}
    return out


@router.get("/threat-indicators")
async def admin_list_threat_indicators(
    status: Optional[str] = None,
    source: Optional[str] = None,
    hostname: Optional[str] = None,
    include_withdrawn: bool = False,
    limit: int = Query(default=200, le=2000),
):
    q: dict[str, Any] = {}
    if status:
        q["status"] = status
    elif not include_withdrawn:
        q["status"] = {"$ne": "withdrawn"}
    if source:
        q["source"] = source
    if hostname:
        q["hostname"] = hostname.strip().lower()
    rows = await db.threat_indicators.find(q, {"_id": 0}).sort("updated_at", -1).to_list(limit)
    return {"indicators": [_ti_row(r) for r in rows], "total": len(rows)}


@router.get("/threat-indicators/{indicator_id}")
async def admin_get_threat_indicator(indicator_id: str):
    doc = await db.threat_indicators.find_one({"indicator_id": indicator_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Unknown threat indicator.")
    # Include revalidation history
    logs = await db.threat_revalidation_log.find(
        {"indicator_id": indicator_id}, {"_id": 0}
    ).sort("attempted_at", -1).to_list(50)
    return {"indicator": _ti_row(doc), "revalidation_history": logs}


@router.post("/threat-indicators", status_code=201)
async def admin_add_threat_indicator(
    body: ThreatIndicatorIn,
    request: Request,
    actor: Optional[str] = Header(default=None, alias="X-Admin-Actor"),
):
    """Add a new threat indicator with full provenance. Does NOT modify the production rule bundle."""
    import re as _re
    hostname = body.hostname.strip().lower().rstrip(".")
    if not _re.fullmatch(r"[a-z0-9-]+(\.[a-z0-9-]+)+", hostname):
        raise HTTPException(status_code=422, detail="hostname must be a bare domain name")

    # Check for duplicates
    existing = await db.threat_indicators.find_one({
        "hostname": hostname, "status": {"$in": ["active", "check_overdue", "pending_review"]}
    })
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"Active indicator already exists: {existing['indicator_id']}"
        )

    from services.threat_revalidation import check_interval_for, expiry_deadline_for

    ts = now_utc()
    indicator_id = f"ti-{secrets.token_hex(8)}"
    indicator = ThreatIndicator(
        indicator_id=indicator_id,
        hostname=hostname,
        scope="hostname",
        source=body.source,
        source_reference=body.source_reference,
        original_evidence=body.original_evidence,
        original_scope=body.original_scope,
        first_seen_at=ts,
        last_verified_at=ts,
        next_scheduled_check=ts + check_interval_for(body.source),
        evidence_expiry_deadline=ts + expiry_deadline_for(body.source),
        verification_count=1,
        status="active",
        review_status=body.review_status,
        added_at=ts,
        updated_at=ts,
        added_by=f"admin:{(actor or 'console').strip()[:80]}",
    )
    await db.threat_indicators.insert_one(indicator.to_mongo())
    await audit(request, "threat_indicator.add", hostname, {
        "indicator_id": indicator_id, "source": body.source,
        "original_scope": body.original_scope, "reason": body.reason,
    }, actor)
    return _ti_row(indicator.to_mongo() | {"indicator_id": indicator_id})


@router.post("/threat-indicators/{indicator_id}/withdraw", status_code=200)
async def admin_withdraw_threat_indicator(
    indicator_id: str,
    body: ThreatIndicatorWithdrawIn,
    request: Request,
    actor: Optional[str] = Header(default=None, alias="X-Admin-Actor"),
):
    """Withdraw a threat indicator. Records the reason and audit trail."""
    doc = await db.threat_indicators.find_one({"indicator_id": indicator_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Unknown threat indicator.")
    if doc.get("status") == "withdrawn":
        raise HTTPException(status_code=409, detail="Indicator is already withdrawn.")

    ts = now_utc()
    await db.threat_indicators.update_one(
        {"indicator_id": indicator_id},
        {"$set": {
            "status": "withdrawn",
            "withdrawn_at": ts,
            "withdrawal_reason": body.reason,
            "updated_at": ts,
        }},
    )
    # Invalidate reputation cache for this hostname
    from services.intel import digest
    hostname = doc.get("hostname", "")
    if hostname:
        dg = digest(hostname)
        await db.reputation_cache.delete_many({"indicator_digest": dg})

    await audit(request, "threat_indicator.withdraw", indicator_id, {
        "hostname": hostname, "reason": body.reason, "detail": body.detail,
    }, actor)
    return {"indicator_id": indicator_id, "status": "withdrawn", "withdrawn_at": ts.isoformat()}


@router.get("/threat-indicators/stats/summary")
async def admin_threat_indicator_stats():
    """Summary statistics for the threat indicator lifecycle."""
    ts = now_utc()
    pipeline = [
        {"$group": {"_id": "$status", "count": {"$sum": 1}}},
    ]
    by_status = {r["_id"]: r["count"] async for r in db.threat_indicators.aggregate(pipeline)}

    overdue_count = await db.threat_indicators.count_documents({
        "status": {"$in": ["active", "check_overdue"]},
        "next_scheduled_check": {"$lte": ts},
    })
    approaching_expiry = await db.threat_indicators.count_documents({
        "status": {"$in": ["active", "check_overdue"]},
        "evidence_expiry_deadline": {"$lte": ts + timedelta(hours=6)},
    })
    recent_logs = await db.threat_revalidation_log.find(
        {}, {"_id": 0}
    ).sort("attempted_at", -1).to_list(10)

    return {
        "by_status": by_status,
        "total_active": by_status.get("active", 0) + by_status.get("check_overdue", 0),
        "checks_overdue": overdue_count,
        "approaching_expiry_6h": approaching_expiry,
        "recent_revalidations": recent_logs,
    }
