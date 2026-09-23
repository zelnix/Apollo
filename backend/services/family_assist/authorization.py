"""Relationship/device authority for FF10. Client-supplied identity is never authoritative."""
from __future__ import annotations

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import HTTPException

from core.db import db


async def active_relationship(relationship_id: str) -> dict:
    try:
        oid = ObjectId(relationship_id)
    except (InvalidId, TypeError):
        raise HTTPException(404, "That trusted family relationship is unavailable.")
    row = await db.family_links.find_one({"_id": oid, "deleted_at": None}, {"_id": 1, "protected_device_id": 1, "guardian_device_id": 1, "owner_name": 1, "guardian_label": 1, "lifecycle_generation": 1})
    if not row:
        raise HTTPException(404, "That trusted family relationship is unavailable.")
    return row


def role_for_device(session: dict, device_id: str) -> str:
    if session.get("sharer_device_id") == device_id:
        return "sharer"
    if session.get("helper_device_id") == device_id or (session.get("helper_device_id") is None and session.get("helper_owner_id") == device_id):
        return "helper"
    raise HTTPException(403, "This device is not part of that help session.")


async def require_current_relationship(session: dict) -> dict:
    row = await active_relationship(session["relationship_id"])
    if row["protected_device_id"] != session["sharer_owner_id"] or row["guardian_device_id"] != session["helper_owner_id"]:
        raise HTTPException(409, {"code": "relationship_changed", "message": "This family relationship changed. Start a new help request."})
    if (row.get("lifecycle_generation") or str(row["_id"])) != session["relationship_generation"]:
        raise HTTPException(409, {"code": "relationship_changed", "message": "This family relationship changed. Start a new help request."})
    return row