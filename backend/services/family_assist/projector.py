"""Minimal, content-free FF10 Family event projection."""
from __future__ import annotations

from core.db import db, now_utc


async def project_terminal(session: dict) -> None:
    await db.family_assist_events.update_one({"session_id": session["session_id"]}, {"$set": {
        "session_id": session["session_id"], "event_type": "family_assist_session", "relationship_id": session["relationship_id"],
        "sharer_owner_id": session["sharer_owner_id"], "sharer_device_id": session["sharer_device_id"],
        "helper_owner_id": session["helper_owner_id"], "helper_device_id": session.get("helper_device_id"),
        "capture_scope": session["capture_scope"], "created_at": session["created_at"], "activated_at": session.get("activated_at"),
        "ended_at": session.get("ended_at") or now_utc(), "final_state": session["state"], "end_reason": session.get("end_reason"),
        "helper_connected": bool(session.get("helper_connected_at")), "owner_paused": bool(session.get("ever_paused")),
        "protocol_version": session.get("protocol_version", 1), "platform_capability_snapshot": session.get("platform_capability_snapshot", {}),
        "failure_code": session.get("failure_code"), "content_retained": False,
    }}, upsert=True)