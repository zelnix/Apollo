"""Patrol events (event summaries synced from devices) and scoped trust entries."""
from __future__ import annotations

import asyncio
import hashlib
import json
import uuid

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field
from pydantic import ValidationError
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from core.db import db, now_utc
from core.models import EnforcementEvidenceIn, PatrolEvent, PatrolEventIn, PatrolEventPatch, TrustEntry, TrustIn
from routers.family import notify_guardians
from routers.push import push_owner_alert
from services.patrol_policy import packet_verified, minimal_patrol, revalidate_stored_patrol
from services import patrol_records

router = APIRouter()


class InvestigationBindingIn(BaseModel):
    case_id: str = Field(min_length=4, max_length=80)

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
    return packet_verified(body)


def _evidence_fingerprint(evidence: EnforcementEvidenceIn | dict) -> str:
    model = evidence if isinstance(evidence, EnforcementEvidenceIn) else EnforcementEvidenceIn.model_validate(evidence)
    raw = json.dumps(model.model_dump(mode='json'), sort_keys=True, separators=(',', ':')).encode()
    return hashlib.sha256(raw).hexdigest()


def _binding_matches(receipt: dict, body: PatrolEventIn, fingerprint: str) -> bool:
    evidence = body.enforcement_evidence
    return bool(evidence and receipt.get('device_id') == body.device_id and receipt.get('event_id') == body.event_id
                and receipt.get('evidence_id') == evidence.evidence_id and receipt.get('fingerprint') == fingerprint)


async def _append_authoritative_record(document: dict | None) -> None:
    """Project complete consumer events; tolerate pre-remediation minimal legacy fixtures."""
    if not document:
        return
    try:
        parsed = PatrolEventIn.model_validate(document)
    except ValidationError:
        return
    await patrol_records.append(parsed, bool(document.get("verified_block")))


async def _claim_evidence_binding(body: PatrolEventIn, fingerprint: str) -> tuple[dict, bool]:
    evidence = body.enforcement_evidence
    assert evidence is not None
    token = uuid.uuid4().hex
    event_key = {'device_id': body.device_id, 'event_id': body.event_id}
    inserted = {**event_key, 'evidence_id': evidence.evidence_id, 'fingerprint': fingerprint,
                'claim_token': token, 'created_at': now_utc()}
    try:
        receipt = await db.evidence_receipts.find_one_and_update(
            event_key, {'$setOnInsert': inserted}, upsert=True, return_document=ReturnDocument.AFTER)
    except DuplicateKeyError:
        receipt = await db.evidence_receipts.find_one({
            'device_id': body.device_id,
            '$or': [{'event_id': body.event_id}, {'evidence_id': evidence.evidence_id}],
        })
    if not receipt or not _binding_matches(receipt, body, fingerprint):
        raise HTTPException(409, 'Event or evidence identity is already bound to a different payload')
    return receipt, receipt.get('claim_token') == token


@router.post("/patrol/events", response_model=PatrolEvent)
async def upsert_event(body: PatrolEventIn):
    ts = now_utc()
    existing = await db.patrol_events.find_one({'event_id': body.event_id, 'device_id': body.device_id})
    fingerprint = _evidence_fingerprint(body.enforcement_evidence) if body.enforcement_evidence else None
    if body.enforcement_evidence:
        receipt = await db.evidence_receipts.find_one({
            'device_id': body.device_id,
            '$or': [{'event_id': body.event_id}, {'evidence_id': body.enforcement_evidence.evidence_id}],
        })
        if receipt:
            if not _binding_matches(receipt, body, fingerprint):
                raise HTTPException(409, 'Event or evidence identity is already bound to a different payload')
            if existing:
                return PatrolEvent.from_mongo(await revalidate_stored_patrol(existing))
        stored_evidence = (existing or {}).get('enforcement_evidence')
        if stored_evidence and (_evidence_fingerprint(stored_evidence) != fingerprint
                                or stored_evidence.get('evidence_id') != body.enforcement_evidence.evidence_id):
            raise HTTPException(409, 'Event already has different enforcement evidence')
    verified = _derive_verified_block(body)
    # Cross-Platform Architecture Directive: state="biting" (THREAT_BLOCKED-equivalent) must never
    # be PERSISTED unless _derive_verified_block() says so — not just have its verified_block flag
    # silently downgraded while the biting state itself sails through. Reject outright rather than
    # downgrade: a client (or a native adapter regression) that thinks it verified a block when it
    # didn't is a bug that needs to be visible, not quietly smoothed over. An honest client that no
    # longer has evidence must submit a non-biting state (e.g. "barking") itself.
    if body.state == "biting" and not verified:
        raise HTTPException(
            status_code=422,
            detail="state='biting' requires validated enforcement_evidence (see _derive_verified_block); "
            "rejecting rather than persisting an unverified Biting claim. Submit a non-biting state instead.",
        )
    payload = minimal_patrol(body, verified)
    payload["verified_block"] = verified  # never trust the client's claim directly
    claimed_here = False
    if body.enforcement_evidence and fingerprint:
        _, claimed_here = await _claim_evidence_binding(body, fingerprint)
        existing = await db.patrol_events.find_one({'event_id': body.event_id, 'device_id': body.device_id})
        if existing and not claimed_here:
            return PatrolEvent.from_mongo(await revalidate_stored_patrol(existing))
    if existing:
        await db.patrol_events.update_one({"_id": existing["_id"]}, {"$set": {**payload, "updated_at": ts}})
        doc = await db.patrol_events.find_one({"_id": existing["_id"]})
        await _append_authoritative_record(doc)
        return PatrolEvent.from_mongo(doc)
    event = PatrolEvent(**payload, created_at=ts, updated_at=ts)
    try:
        result = await db.patrol_events.insert_one(event.to_mongo())
    except DuplicateKeyError:
        # Evidence replay is read-only: a concurrent identical request must never overwrite a later
        # status/resolution. Non-evidence legacy races retain the existing last-write behavior.
        if body.enforcement_evidence:
            doc = await db.patrol_events.find_one({"event_id": body.event_id, "device_id": body.device_id})
            return PatrolEvent.from_mongo(await revalidate_stored_patrol(doc))
        await db.patrol_events.update_one({"event_id": body.event_id, "device_id": body.device_id}, {"$set": {**payload, "updated_at": ts}})
        doc = await db.patrol_events.find_one({"event_id": body.event_id, "device_id": body.device_id})
        await _append_authoritative_record(doc)
        return PatrolEvent.from_mongo(doc)
    event.id = str(result.inserted_id)
    await _append_authoritative_record(await db.patrol_events.find_one({"_id": result.inserted_id}))
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
    return [PatrolEvent.from_mongo(await revalidate_stored_patrol(d)) for d in docs]


@router.get("/patrol/records")
async def list_patrol_records(request: Request, limit: int = Query(default=200, ge=1, le=500)):
    return await patrol_records.current(request.state.device["device_id"], limit)


@router.get("/patrol/records/{record_id}/timeline")
async def patrol_record_timeline(record_id: str, request: Request):
    items = await patrol_records.timeline(request.state.device["device_id"], record_id)
    if not items:
        raise HTTPException(status_code=404, detail="Patrol record not found")
    return {"items": items}


@router.post("/patrol/events/{event_id}/investigation")
async def bind_event_investigation(event_id: str, body: InvestigationBindingIn, request: Request):
    """Bind one owned Patrol event to one owned live investigation; replay is idempotent."""
    owner = request.state.device["device_id"]
    event = await db.patrol_events.find_one({"event_id": event_id, "device_id": owner, "deleted_at": None})
    case = await db.investigation_cases.find_one({"case_id": body.case_id, "owner_id": owner, "deleted": False}, {"_id": 1})
    if not event or not case:
        raise HTTPException(status_code=404, detail="Event or investigation not found")
    existing = event.get("investigation_case_id")
    if existing and existing != body.case_id:
        raise HTTPException(status_code=409, detail="Event is already bound to a different investigation")
    await db.patrol_events.update_one({"_id": event["_id"]}, {"$set": {"investigation_case_id": body.case_id, "updated_at": now_utc()}})
    updated = await db.patrol_events.find_one({"_id": event["_id"]})
    if updated:
        await _append_authoritative_record(updated)
    return {"eventId": event_id, "caseId": body.case_id}


@router.get("/patrol/events/{event_id}/investigation")
async def get_event_investigation(event_id: str, request: Request):
    owner = request.state.device["device_id"]
    event = await db.patrol_events.find_one({"event_id": event_id, "device_id": owner, "deleted_at": None}, {"_id": 0, "investigation_case_id": 1})
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    return {"caseId": event.get("investigation_case_id")}


@router.patch("/patrol/events/{event_id}", response_model=PatrolEvent)
async def patch_event(event_id: str, body: PatrolEventPatch, device_id: str = Query(min_length=8, max_length=64)):
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    query = {"event_id": event_id, "device_id": device_id, "deleted_at": None}
    if updates.get("state") == "biting":
        # A PATCH can never PROMOTE an event into a verified block — only POST /patrol/events with
        # validated enforcement_evidence can (see _derive_verified_block above). Only let this
        # through when the stored record already carries verified_block=True (e.g. patching
        # status/resolved_at/what_to_do on an already-verified block); otherwise this is the exact
        # PATCH-based loophole around the biting gate and must be rejected the same way POST is.
        query["verified_block"] = True
        prior = await db.patrol_events.find_one(query)
        if not prior or not _derive_verified_block(PatrolEventIn(**prior)):
            raise HTTPException(422, 'Stored record lacks packet-backed evidence')
    updates["updated_at"] = now_utc()
    result = await db.patrol_events.update_one(query, {"$set": updates})
    if result.matched_count == 0:
        if updates.get("state") == "biting" and await db.patrol_events.find_one({"event_id": event_id, "device_id": device_id, "deleted_at": None}):
            raise HTTPException(status_code=422, detail="state='biting' cannot be set via PATCH unless verified_block is already true on this event.")
        raise HTTPException(status_code=404, detail="Event not found")
    doc = await db.patrol_events.find_one({"event_id": event_id, "device_id": device_id})
    await _append_authoritative_record(doc)
    return PatrolEvent.from_mongo(await revalidate_stored_patrol(doc))


@router.delete("/patrol/events")
async def clear_events(device_id: str = Query(min_length=8, max_length=64)):
    result = await db.patrol_events.update_many({"device_id": device_id, "deleted_at": None}, {"$set": {"deleted_at": now_utc()}})
    await db.patrol_records.delete_many({"owner_id": device_id})
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
