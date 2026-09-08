"""Patrol events (event summaries synced from devices) and scoped trust entries."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException, Query
from pymongo.errors import DuplicateKeyError

from core.db import db, now_utc
from core.models import PatrolEvent, PatrolEventIn, PatrolEventPatch, TrustEntry, TrustIn
from routers.family import notify_guardians
from routers.push import push_owner_alert

router = APIRouter()

# Mechanisms that can NEVER back a verified block, no matter what result/enforcedAction they claim.
# "simulated" is the mock adapter's label (Expo Go/dev preview); "none" means nothing was enforced.
_NEVER_VERIFIED_MECHANISMS = {"simulated", "none"}


def _derive_verified_block(body: PatrolEventIn) -> bool:
    """THE gate. verified_block must never come from the client's boolean directly — only from
    validated enforcement evidence. All of the following must hold:
      1. Evidence is attached at all.
      2. Its own result is "verified" and its enforcedAction is "blocked" (not a rule match, not a
         plan, not a monitor-only action).
      3. Its mechanism is a real one — "simulated"/"none" can never verify, however the rest of the
         record reads (this is what stops the mock adapter, or a client pretending to be it, from
         ever producing a THREAT_BLOCKED-equivalent state).
      4. If the evidence names a device_id, it must match the event's own device_id — one device's
         evidence can never authorise another device's block.
    Mirrors isVerifiedEnforcement() in frontend/src/security/PlatformCapabilityProfile.ts exactly.
    """
    ev = body.enforcement_evidence
    if ev is None:
        return False
    if ev.result != "verified" or ev.enforced_action != "blocked":
        return False
    if ev.mechanism in _NEVER_VERIFIED_MECHANISMS:
        return False
    if ev.device_id and ev.device_id != body.device_id:
        return False
    return True


@router.post("/patrol/events", response_model=PatrolEvent)
async def upsert_event(body: PatrolEventIn):
    ts = now_utc()
    payload = body.model_dump()
    payload["verified_block"] = _derive_verified_block(body)  # never trust the client's claim directly
    existing = await db.patrol_events.find_one({"event_id": body.event_id, "device_id": body.device_id})
    if existing:
        await db.patrol_events.update_one({"_id": existing["_id"]}, {"$set": {**payload, "updated_at": ts}})
        doc = await db.patrol_events.find_one({"_id": existing["_id"]})
        return PatrolEvent.from_mongo(doc)
    event = PatrolEvent(**payload, created_at=ts, updated_at=ts)
    try:
        result = await db.patrol_events.insert_one(event.to_mongo())
    except DuplicateKeyError:
        # Two syncs of the same event raced (e.g. link check + QR merge). Idempotent: apply as an update.
        await db.patrol_events.update_one({"event_id": body.event_id, "device_id": body.device_id}, {"$set": {**payload, "updated_at": ts}})
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


@router.get("/patrol/events", response_model=list[PatrolEvent])
async def list_events(device_id: str = Query(min_length=8, max_length=64), limit: int = Query(default=200, le=500)):
    docs = await db.patrol_events.find({"device_id": device_id, "deleted_at": None}).sort("occurred_at", -1).to_list(limit)
    return [PatrolEvent.from_mongo(d) for d in docs]


@router.patch("/patrol/events/{event_id}", response_model=PatrolEvent)
async def patch_event(event_id: str, body: PatrolEventPatch, device_id: str = Query(min_length=8, max_length=64)):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    updates["updated_at"] = now_utc()
    result = await db.patrol_events.update_one({"event_id": event_id, "device_id": device_id, "deleted_at": None}, {"$set": updates})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Event not found")
    doc = await db.patrol_events.find_one({"event_id": event_id, "device_id": device_id})
    return PatrolEvent.from_mongo(doc)


@router.delete("/patrol/events")
async def clear_events(device_id: str = Query(min_length=8, max_length=64)):
    result = await db.patrol_events.update_many({"device_id": device_id, "deleted_at": None}, {"$set": {"deleted_at": now_utc()}})
    return {"soft_deleted": result.modified_count}


# --------------------------------------------------------------------------- Routes: trust
@router.post("/trust", response_model=TrustEntry)
async def add_trust(body: TrustIn):
    existing = await db.trust_entries.find_one({"trust_id": body.trust_id})
    if existing:
        return TrustEntry.from_mongo(existing)
    entry = TrustEntry(**body.model_dump(), created_at=now_utc())
    result = await db.trust_entries.insert_one(entry.to_mongo())
    entry.id = str(result.inserted_id)
    return entry


@router.get("/trust", response_model=list[TrustEntry])
async def list_trust(device_id: str = Query(min_length=8, max_length=64)):
    docs = await db.trust_entries.find({"device_id": device_id, "deleted_at": None}).sort("created_at", -1).to_list(500)
    return [TrustEntry.from_mongo(d) for d in docs]


@router.delete("/trust/{trust_id}")
async def revoke_trust(trust_id: str, device_id: str = Query(min_length=8, max_length=64)):
    result = await db.trust_entries.update_one({"trust_id": trust_id, "device_id": device_id, "deleted_at": None}, {"$set": {"deleted_at": now_utc()}})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Trust entry not found")
    return {"revoked": True}
