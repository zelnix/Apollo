"""Device identity lifecycle + per-device settings (quiet hours)."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import Any, Optional

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from core.db import db, now_utc
from core.models import Device, DeviceRegister
from core.auth import _issue, _unauthorized

router = APIRouter()


@router.post("/devices/register", status_code=201)
async def register_device(body: DeviceRegister):
    """Creates a NEW anonymous device identity. The raw token is returned exactly once and never stored."""
    ts = now_utc()
    device_id = uuid.uuid4().hex
    raw, cred = _issue(device_id)
    doc = Device(device_id=device_id, **body.model_dump(), created_at=ts, last_seen_at=ts).to_mongo()
    doc.update(cred)
    await db.devices.insert_one(doc)
    return {"device_id": device_id, "device_token": raw, "token_expires_at": cred["token_expires_at"], "registered": True}


@router.post("/devices/heartbeat")
async def device_heartbeat(body: DeviceRegister, request: Request):
    """Authenticated 'still here' — updates platform/app/tz and last_seen for the token's device."""
    me = request.state.device["device_id"]
    await db.devices.update_one({"device_id": me}, {"$set": {"last_seen_at": now_utc(), "platform": body.platform, "adapter_mode": body.adapter_mode, "app_version": body.app_version, "tz_offset_minutes": body.tz_offset_minutes}})
    return {"device_id": me}


@router.get("/devices/me")
async def device_me(request: Request):
    d = request.state.device
    return {"device_id": d["device_id"], "token_expires_at": d.get("token_expires_at"), "created_at": d.get("created_at")}


@router.post("/devices/token/rotate")
async def rotate_token(request: Request):
    """Atomic: the old token stops working in the same update that installs the new one."""
    d = request.state.device
    raw, cred = _issue(d["device_id"])
    res = await db.devices.update_one({"device_id": d["device_id"], "token_hash": d["token_hash"], "revoked_at": None}, {"$set": cred})
    if res.modified_count != 1:
        raise _unauthorized("Token is no longer valid.")
    return {"device_id": d["device_id"], "device_token": raw, "token_expires_at": cred["token_expires_at"]}


@router.post("/devices/revoke", status_code=204)
async def revoke_device(request: Request):
    """Revokes this device's credential. The device must register again (new identity) to use Apollo's API."""
    await db.devices.update_one({"device_id": request.state.device["device_id"], "revoked_at": None}, {"$set": {"revoked_at": now_utc()}})
    return None


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


@router.put("/devices/{device_id}/settings")
async def put_device_settings(device_id: str, body: DeviceSettingsIn):
    await db.devices.update_one({"device_id": device_id}, {"$set": {"settings": body.model_dump(), "last_seen_at": now_utc()}}, upsert=True)
    return body


@router.get("/devices/{device_id}/settings")
async def get_device_settings(device_id: str):
    doc = await db.devices.find_one({"device_id": device_id})
    settings = (doc or {}).get("settings") or {"quiet_hours": QuietHours().model_dump()}
    return {**settings, "quiet_now": in_quiet_hours(settings.get("quiet_hours"))}


async def device_quiet_now(device_id: str) -> bool:
    doc = await db.devices.find_one({"device_id": device_id}, {"settings": 1})
    return in_quiet_hours(((doc or {}).get("settings") or {}).get("quiet_hours"))
