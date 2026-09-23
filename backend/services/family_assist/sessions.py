"""FF10 authoritative state coordinator with revision + generation fencing."""
from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import timedelta

from fastapi import HTTPException
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from core.db import db, now_utc
from models.family_assist import TERMINAL_STATES, CaptureScope, FamilyAssistState
from services.family_assist.authorization import active_relationship, require_current_relationship, role_for_device
from services.family_assist.config import PROTOCOL_VERSION, UNAVAILABLE_COPY, load_config
from services.family_assist.outbox import process_once, queue_invitation
from services.family_assist.projector import project_terminal


def _conflict(code: str, message: str) -> HTTPException:
    return HTTPException(409, {"code": code, "message": message})


def _actions(session: dict, role: str) -> list[str]:
    state = session["state"]
    if state in {value.value for value in TERMINAL_STATES}:
        return []
    if role == "helper":
        return ["accept", "decline"] if state == "invited" else ["leave"]
    actions = ["end"]
    if state == "active": actions += ["pause", "extend"]
    if state == "paused": actions += ["resume", "extend"]
    if state == "helper_accepted": actions += ["request_capture_consent"]
    return actions


def view(session: dict, caller: str) -> dict:
    role = role_for_device(session, caller)
    return {key: value for key, value in {
        "sessionId": session["session_id"], "relationshipId": session["relationship_id"], "captureScope": session["capture_scope"],
        "microphoneRequested": False, "state": session["state"], "revision": session["revision"], "generation": session["generation"],
        "createdAt": session["created_at"], "invitationExpiresAt": session["invitation_expires_at"], "activeExpiresAt": session.get("active_expires_at"),
        "activatedAt": session.get("activated_at"), "pausedAt": session.get("paused_at"), "endedAt": session.get("ended_at"),
        "endReason": session.get("end_reason"), "lastHeartbeatAt": session.get("last_heartbeat_at"),
        "helperDisplayName": session["helper_display_name"], "ownerDisplayName": session["owner_display_name"],
        "platformCapabilitySnapshot": session.get("platform_capability_snapshot", {}), "supportedActions": _actions(session, role),
    }.items()}


def require_available() -> None:
    if not load_config().available:
        raise HTTPException(503, UNAVAILABLE_COPY)


async def ensure_indexes() -> None:
    await db.family_assist_sessions.create_index("session_id", unique=True)
    await db.family_assist_sessions.create_index([("sharer_owner_id", 1), ("client_request_id", 1)], unique=True)
    await db.family_assist_sessions.create_index("live_sharer_device", unique=True, partialFilterExpression={"live_sharer_device": {"$type": "string"}})
    await db.family_assist_sessions.create_index("purge_at", expireAfterSeconds=0)
    await db.family_assist_tickets.create_index("digest", unique=True)
    await db.family_assist_tickets.create_index("expires_at", expireAfterSeconds=300)
    await db.family_assist_events.create_index("session_id", unique=True)
    await db.family_assist_outbox.create_index("effect_key", unique=True)
    await db.family_assist_outbox.create_index([("state", 1), ("updated_at", 1)])
    await db.family_assist_turn_issuances.create_index([("session_id", 1), ("generation", 1), ("device_id", 1), ("issued_at", -1)])
    await db.family_assist_turn_issuances.create_index("expires_at", expireAfterSeconds=0)


async def create_session(caller: str, body) -> dict:
    require_available()
    if body.sharer_device_id != caller:
        raise HTTPException(403, "That sharer device does not belong to this device.")
    existing = await db.family_assist_sessions.find_one({"sharer_owner_id": caller, "client_request_id": body.client_request_id}, {"_id": 0})
    if existing:
        await queue_invitation(existing)
        return view(existing, caller)
    relationship = await active_relationship(body.relationship_id)
    if relationship["protected_device_id"] != caller:
        raise HTTPException(403, "Only the person asking for help can create this session.")
    if await db.family_assist_sessions.find_one({"live_sharer_device": caller}, {"_id": 1}):
        raise _conflict("sharer_session_exists", "This device already has a live Family Help session.")
    config = load_config(); now = now_utc(); session_id = str(uuid.uuid4())
    doc = {
        "session_id": session_id, "relationship_id": body.relationship_id, "relationship_generation": relationship.get("lifecycle_generation") or str(relationship["_id"]),
        "sharer_owner_id": caller, "sharer_device_id": caller, "helper_owner_id": relationship["guardian_device_id"], "helper_device_id": None,
        "owner_display_name": (relationship.get("owner_name") or "Family member")[:60], "helper_display_name": (relationship.get("guardian_label") or "A family member")[:60],
        "capture_scope": body.capture_scope.value if isinstance(body.capture_scope, CaptureScope) else str(body.capture_scope), "microphone_requested": False,
        "state": FamilyAssistState.INVITED.value, "revision": 1, "generation": secrets.token_urlsafe(24), "client_request_id": body.client_request_id,
        "created_at": now, "invitation_expires_at": now + timedelta(seconds=config.invitation_seconds), "active_expires_at": None,
        "hard_expires_at": now + timedelta(seconds=config.hard_max_seconds), "last_heartbeat_at": None, "platform_capability_snapshot": {},
        "protocol_version": PROTOCOL_VERSION, "live_sharer_device": caller, "purge_at": now + timedelta(days=30),
    }
    try:
        await db.family_assist_sessions.insert_one(dict(doc))
    except DuplicateKeyError:
        found = await db.family_assist_sessions.find_one({"sharer_owner_id": caller, "client_request_id": body.client_request_id}, {"_id": 0})
        if not found:
            raise _conflict("sharer_session_exists", "This device already has a live Family Help session.")
        doc = found
    await queue_invitation(doc)
    return view(doc, caller)


async def get_session(session_id: str, caller: str) -> dict:
    row = await db.family_assist_sessions.find_one({"session_id": session_id}, {"_id": 0})
    if not row:
        raise HTTPException(404, "That help session is unavailable.")
    role_for_device(row, caller)
    await require_current_relationship(row)
    return row


async def invitations(caller: str) -> list[dict]:
    rows = await db.family_assist_sessions.find({"helper_owner_id": caller, "state": "invited", "invitation_expires_at": {"$gt": now_utc()}}, {"_id": 0}).sort("created_at", -1).to_list(20)
    return [view(row, caller) for row in rows]


async def respond(session_id: str, caller: str, body) -> dict:
    row = await get_session(session_id, caller)
    if row["helper_owner_id"] != caller or body.helper_device_id != caller:
        raise HTTPException(403, "Only the selected paired helper can respond.")
    if row["state"] == "helper_accepted" and row.get("helper_device_id") == caller and body.decision == "accept":
        return view(row, caller)
    if row["state"] in {"ended", "expired", "revoked", "failed"}:
        raise _conflict("terminal_session", "This help session has ended.")
    if row["state"] != "invited" or row["revision"] != body.expected_revision:
        raise _conflict("stale_revision", "The help session changed. Refresh before responding.")
    now = now_utc()
    updates = {"state": "helper_accepted", "helper_device_id": caller, "helper_accepted_at": now,
               "consent_reservation_expires_at": now + timedelta(seconds=load_config().consent_reservation_seconds)} if body.decision == "accept" else {
        "state": "ended", "end_reason": "helper_left", "ended_at": now, "live_sharer_device": None,
    }
    updated = await db.family_assist_sessions.find_one_and_update({"session_id": session_id, "state": "invited", "revision": body.expected_revision},
        {"$set": updates, "$inc": {"revision": 1}}, projection={"_id": 0}, return_document=ReturnDocument.AFTER)
    if not updated:
        raise _conflict("stale_revision", "The help session changed. Refresh before responding.")
    if updated["state"] == "ended": await project_terminal(updated)
    return view(updated, caller)


async def issue_ticket(session_id: str, caller: str) -> dict:
    require_available(); row = await get_session(session_id, caller); role = role_for_device(row, caller)
    if row["state"] == "helper_accepted" and role == "sharer":
        changed = await db.family_assist_sessions.find_one_and_update({"session_id": session_id, "state": "helper_accepted", "revision": row["revision"]},
            {"$set": {"state": "awaiting_capture_consent"}, "$inc": {"revision": 1}}, projection={"_id": 0}, return_document=ReturnDocument.AFTER)
        row = changed or row
    if row["state"] not in {"helper_accepted", "awaiting_capture_consent", "connecting", "active", "paused"}:
        raise _conflict("ticket_not_available", "Signaling is not available in the current session state.")
    raw = secrets.token_urlsafe(32); digest = hashlib.sha256(raw.encode()).hexdigest(); expires = now_utc() + timedelta(seconds=load_config().signaling_ticket_seconds)
    await db.family_assist_tickets.insert_one({"digest": digest, "session_id": session_id, "generation": row["generation"], "device_id": caller,
                                               "role": role, "expires_at": expires, "consumed_at": None, "created_at": now_utc()})
    return {"ticket": raw, "expiresAt": expires, "sessionId": session_id, "generation": row["generation"], "role": role, "protocolVersion": PROTOCOL_VERSION}


async def transition(session_id: str, caller: str, expected_revision: int, action: str) -> dict:
    row = await get_session(session_id, caller); role = role_for_device(row, caller); now = now_utc()
    if row["revision"] != expected_revision: raise _conflict("stale_revision", "The help session changed. Refresh and try again.")
    if action in {"pause", "resume", "extend"} and role != "sharer": raise HTTPException(403, "Only the screen owner can use that control.")
    if action == "pause" and row["state"] == "active": updates = {"state": "paused", "paused_at": now, "ever_paused": True}
    elif action == "resume" and row["state"] == "paused": updates = {"state": "active", "paused_at": None}
    elif action == "extend" and row["state"] in {"active", "paused"}:
        current = row.get("active_expires_at") or now; proposed = current + timedelta(seconds=load_config().extension_seconds)
        if proposed > row["hard_expires_at"]: raise _conflict("hard_maximum", "This session cannot be extended beyond two hours. Start a new session with new consent.")
        updates = {"active_expires_at": proposed}
    else: raise _conflict("invalid_transition", "That action is not available in the current session state.")
    updated = await db.family_assist_sessions.find_one_and_update({"session_id": session_id, "revision": expected_revision, "generation": row["generation"]},
        {"$set": updates, "$inc": {"revision": 1}}, projection={"_id": 0}, return_document=ReturnDocument.AFTER)
    if not updated: raise _conflict("stale_revision", "The help session changed. Refresh and try again.")
    return view(updated, caller)


async def publish_native_state(session_id: str, caller: str, body, helper_connected: bool) -> dict:
    row = await get_session(session_id, caller)
    if role_for_device(row, caller) != "sharer": raise HTTPException(403, "Only the screen owner can publish capture state.")
    if row["generation"] != body.generation or row["revision"] != body.expected_revision: raise _conflict("stale_generation", "That capture callback belongs to an older session state.")
    now = now_utc()
    if body.native_state == "connecting" and row["state"] == "awaiting_capture_consent": updates = {"state": "connecting", "last_heartbeat_at": now}
    elif body.native_state == "active" and row["state"] == "connecting" and helper_connected:
        updates = {"state": "active", "activated_at": row.get("activated_at") or now, "active_expires_at": now + timedelta(seconds=load_config().active_seconds), "helper_connected_at": now, "last_heartbeat_at": now}
    elif body.native_state == "failed":
        updates = {"state": "failed", "end_reason": "transport_failed", "failure_code": body.failure_code or "native_failed", "ended_at": now, "live_sharer_device": None}
    else: raise _conflict("native_state_rejected", "The native state is not valid for the current session.")
    updated = await db.family_assist_sessions.find_one_and_update({"session_id": session_id, "revision": body.expected_revision, "generation": body.generation},
        {"$set": updates, "$inc": {"revision": 1}}, projection={"_id": 0}, return_document=ReturnDocument.AFTER)
    if not updated: raise _conflict("stale_generation", "That capture callback belongs to an older session state.")
    if updated["state"] == "failed": await project_terminal(updated)
    return view(updated, caller)


async def end_session(session_id: str, caller: str, expected_revision: int | None = None, reason: str | None = None) -> dict:
    row = await get_session(session_id, caller); role = role_for_device(row, caller)
    if row["state"] in {value.value for value in TERMINAL_STATES}: return view(row, caller)
    if expected_revision is not None and row["revision"] != expected_revision: raise _conflict("stale_revision", "The help session changed. Stop locally, then refresh its final status.")
    end_reason = reason or ("owner_stopped" if role == "sharer" else "helper_left"); now = now_utc()
    updated = await db.family_assist_sessions.find_one_and_update({"session_id": session_id, "generation": row["generation"], "state": {"$nin": [v.value for v in TERMINAL_STATES]}},
        {"$set": {"state": "ended", "end_reason": end_reason, "ended_at": now, "live_sharer_device": None}, "$inc": {"revision": 1}},
        projection={"_id": 0}, return_document=ReturnDocument.AFTER)
    updated = updated or await db.family_assist_sessions.find_one({"session_id": session_id}, {"_id": 0})
    await project_terminal(updated)
    return view(updated, caller)


async def _revoke(query: dict, reason: str) -> int:
    rows = await db.family_assist_sessions.find({**query, "state": {"$nin": [v.value for v in TERMINAL_STATES]}}, {"_id": 0}).to_list(100)
    count = 0
    for row in rows:
        updated = await db.family_assist_sessions.find_one_and_update({"session_id": row["session_id"], "generation": row["generation"], "state": {"$nin": [v.value for v in TERMINAL_STATES]}},
            {"$set": {"state": "revoked", "end_reason": reason, "ended_at": now_utc(), "live_sharer_device": None}, "$inc": {"revision": 1}}, projection={"_id": 0}, return_document=ReturnDocument.AFTER)
        if updated: await project_terminal(updated); count += 1
    return count


async def revoke_for_relationship(relationship_id: str) -> int: return await _revoke({"relationship_id": relationship_id}, "relationship_revoked")
async def revoke_for_device(device_id: str, reason: str) -> int: return await _revoke({"$or": [{"sharer_device_id": device_id}, {"helper_device_id": device_id}, {"helper_owner_id": device_id}]}, reason)


async def maintenance_once() -> int:
    now = now_utc(); expired = await db.family_assist_sessions.find({"state": {"$nin": [v.value for v in TERMINAL_STATES]}, "$or": [
        {"state": "invited", "invitation_expires_at": {"$lte": now}},
        {"state": {"$in": ["helper_accepted", "awaiting_capture_consent"]}, "consent_reservation_expires_at": {"$lte": now}},
        {"state": {"$in": ["active", "paused"]}, "active_expires_at": {"$lte": now}},
        {"hard_expires_at": {"$lte": now}},
    ]}, {"_id": 0}).to_list(100)
    for row in expired:
        updated = await db.family_assist_sessions.find_one_and_update({"session_id": row["session_id"], "generation": row["generation"], "state": row["state"]},
            {"$set": {"state": "expired", "end_reason": "timeout", "ended_at": now, "live_sharer_device": None}, "$inc": {"revision": 1}}, projection={"_id": 0}, return_document=ReturnDocument.AFTER)
        if updated: await project_terminal(updated)
    return len(expired) + await process_once()