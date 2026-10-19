"""Durable invitation effect. Provider acceptance is never helper acceptance."""
from __future__ import annotations

from fastapi import HTTPException

from core.config import logger
from core.db import db, now_utc
from routers.push import PUSH_FAMILY, send_push


async def queue_invitation(session: dict) -> None:
    await db.family_assist_outbox.update_one({"effect_key": f"invite:{session['session_id']}"}, {"$setOnInsert": {
        "effect_key": f"invite:{session['session_id']}", "session_id": session["session_id"], "recipient_id": session["helper_owner_id"],
        "state": "queued", "attempts": 0, "created_at": now_utc(), "updated_at": now_utc(),
    }}, upsert=True)


async def process_once(limit: int = 20) -> int:
    rows = await db.family_assist_outbox.find({"state": {"$in": ["queued", "retryable"]}, "attempts": {"$lt": 5}}, {"_id": 0}).sort("created_at", 1).to_list(limit)
    processed = 0
    for row in rows:
        session = await db.family_assist_sessions.find_one({"session_id": row["session_id"]}, {"_id": 0})
        if not session or session["state"] != "invited":
            await db.family_assist_outbox.update_one({"effect_key": row["effect_key"]}, {"$set": {"state": "cancelled", "updated_at": now_utc()}})
            continue
        try:
            statuses = await send_push([row["recipient_id"]], {
                "title": f"{session['owner_display_name']} is asking for help",
                "message": "They can choose to share their screen. You cannot control their device.",
                "subtext": "Tap to respond in Apollo.", "action_url": f"/family/help/join?sessionId={session['session_id']}", **PUSH_FAMILY,
            }, idempotency_key=row["effect_key"], owner_id=session["sharer_owner_id"])
            state = "submitted" if statuses else "recipient_unregistered"
            await db.family_assist_outbox.update_one({"effect_key": row["effect_key"]}, {"$set": {"state": state, "updated_at": now_utc()}, "$inc": {"attempts": 1}})
        except HTTPException:
            await db.family_assist_outbox.update_one({"effect_key": row["effect_key"]}, {"$set": {"state": "retryable", "updated_at": now_utc()}, "$inc": {"attempts": 1}})
        except Exception:  # no payload/body logging
            logger.warning("family assist invitation delivery failed")
            await db.family_assist_outbox.update_one({"effect_key": row["effect_key"]}, {"$set": {"state": "retryable", "updated_at": now_utc()}, "$inc": {"attempts": 1}})
        processed += 1
    return processed