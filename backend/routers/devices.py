"""Device identity lifecycle + per-device settings (quiet hours)."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta
from typing import Any, Literal, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from core.db import db, now_utc
from core.models import Device, DeviceRegister
from core.auth import _issue, _unauthorized
from services import device_stats

router = APIRouter()
TEST_LAB = device_stats.TEST_LAB


@router.post("/devices/register", status_code=201)
async def register_device(body: DeviceRegister):
    """Creates a NEW anonymous device identity. The raw token is returned exactly once and never stored."""
    ts = now_utc()
    device_id = uuid.uuid4().hex
    raw, cred = _issue(device_id)
    doc = Device(device_id=device_id, **body.model_dump(exclude={"test_lab"}), test_device=TEST_LAB if body.test_lab else None,
                 created_at=ts, last_seen_at=ts).to_mongo()
    doc.update(cred)
    await db.devices.insert_one(doc)
    return {"device_id": device_id, "device_token": raw, "token_expires_at": cred["token_expires_at"], "registered": True}


@router.post("/devices/heartbeat")
async def device_heartbeat(body: DeviceRegister, request: Request):
    """Authenticated 'still here' — updates platform/app/tz and last_seen for the token's device."""
    me = request.state.device["device_id"]
    await db.devices.update_one({"device_id": me}, {"$set": {"last_seen_at": now_utc(), "platform": body.platform, "adapter_mode": body.adapter_mode, "app_version": body.app_version, "tz_offset_minutes": body.tz_offset_minutes, "locale": body.locale, **body.telemetry(),
                                                             **({"test_device": TEST_LAB} if body.test_lab else {})}})
    return {"device_id": me}


class DeviceActivity(BaseModel):
    """A feature used on the phone that the server doesn't otherwise see: a Device Check, or opening a Learn article
    or a scam alert (`item` is its slug or link; only a digest of it is kept)."""
    kind: Literal["device_check", "learn_read", "scam_alert_read"]
    item: Optional[str] = Field(default=None, min_length=1, max_length=2048)


@router.post("/devices/activity", status_code=204)
async def device_activity(body: DeviceActivity, request: Request):
    me = request.state.device["device_id"]
    if body.kind == "device_check":
        await device_stats.bump(me, "device_checks")
    elif body.item:
        await device_stats.mark_read(me, body.kind, body.item)
    else:
        raise HTTPException(422, "Say which article or alert was opened.")
    return None


@router.get("/devices/me")
async def device_me(request: Request):
    d = request.state.device
    return {"device_id": d["device_id"], "token_expires_at": d.get("token_expires_at"), "created_at": d.get("created_at")}


@router.get("/devices/model-name")
async def device_model_name(request: Request):
    """This phone's descriptive name ("Samsung Galaxy Z Fold6"), from the manufacturer and model it already reported.
    `name` is null when the list of supported devices doesn't name that model."""
    from services import device_models
    d = request.state.device
    return {"name": await device_models.name_for(d.get("manufacturer"), d.get("model")), "model": d.get("model")}


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
    device_id = request.state.device["device_id"]
    from services.family_assist.sessions import revoke_for_device
    await revoke_for_device(device_id, "owner_signed_out")
    await db.devices.update_one({"device_id": device_id, "revoked_at": None}, {"$set": {"revoked_at": now_utc()}})
    return None


@router.get("/devices/data-inventory")
async def device_data_inventory(request: Request):
    """Honest, category-grouped count of everything Apollo currently stores for this device."""
    from services.account_deletion import inventory
    return await inventory(request.state.device["device_id"])


@router.post("/devices/delete-data")
async def device_delete_data(request: Request):
    """Permanently delete EVERYTHING Apollo holds for this device, then remove the device identity.
    The device must register again (a brand-new anonymous identity) to use Apollo afterwards."""
    from services.account_deletion import purge_device
    return await purge_device(request.state.device["device_id"])


# --------------------------------------------------------------------------- Quiet hours (device settings)
# Growling (non-urgent) pushes are silenced inside the window; Barking/Biting always come through.
class QuietHours(BaseModel):
    enabled: bool = False
    start_minutes: int = Field(default=22 * 60, ge=0, le=1439)  # local minutes since midnight
    end_minutes: int = Field(default=7 * 60, ge=0, le=1439)
    tz_offset_minutes: int = Field(default=0, ge=-840, le=840)  # local = UTC + offset


class NotificationPreferences(BaseModel):
    """Per-category notification toggles. Barking and Biting are always on and cannot be disabled."""
    sniffing_growling: bool = True   # Cases needing attention (growling/sniffing/ears_up)
    scam_alerts: bool = True         # New scam advisories
    learn_with_higgins: bool = True  # New learning content


class DeviceSettingsIn(BaseModel):
    quiet_hours: QuietHours
    notification_preferences: Optional[NotificationPreferences] = None


def in_quiet_hours(qh: Optional[dict[str, Any]], at: Optional[datetime] = None) -> bool:
    if not qh or not qh.get("enabled"):
        return False
    local = (at or now_utc()) + timedelta(minutes=int(qh.get("tz_offset_minutes", 0)))
    m = local.hour * 60 + local.minute
    start, end = int(qh.get("start_minutes", 1320)), int(qh.get("end_minutes", 420))
    return start <= m < end if start <= end else (m >= start or m < end)


def quiet_hours_end_utc(qh: Optional[dict[str, Any]], at: Optional[datetime] = None) -> Optional[datetime]:
    """When the quiet window a person is currently inside ends, in UTC. None when they are not in one.
    Used to hold gentle alerts until morning instead of dropping them."""
    at = at or now_utc()
    if not in_quiet_hours(qh, at):
        return None
    tz = timedelta(minutes=int((qh or {}).get("tz_offset_minutes", 0)))
    local = at + tz
    end = int((qh or {}).get("end_minutes", 420))
    local_end = local.replace(hour=end // 60, minute=end % 60, second=0, microsecond=0)
    if local_end <= local:  # the window runs past midnight, so the end is tomorrow morning
        local_end += timedelta(days=1)
    return local_end - tz



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


async def device_quiet_until(device_id: str) -> Optional[datetime]:
    """UTC end of the quiet window this device is currently inside, or None when it isn't in one."""
    doc = await db.devices.find_one({"device_id": device_id}, {"settings": 1})
    return quiet_hours_end_utc(((doc or {}).get("settings") or {}).get("quiet_hours"))
