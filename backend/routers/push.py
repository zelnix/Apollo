"""Alert notifications via the Emergent-managed push relay."""
from __future__ import annotations

from typing import Any, Literal, Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from core.config import PUSH_BASE_URL, PUSH_KEY, logger
from core.db import db, now_utc
from core.models import PatrolEvent
from routers.devices import device_quiet_now

router = APIRouter()


_push_client = httpx.AsyncClient(base_url=PUSH_BASE_URL, headers={"X-Push-Key": PUSH_KEY}, timeout=10.0)
# Sound routing — Android channel id + iOS aps.sound. Files bundled via expo-notifications `sounds` in app.json.
PUSH_THREAT = {"channel_id": "threats", "sound": "apollo_bark.wav"}   # Apollo barks: threat alerts (owner + family)
PUSH_FAMILY = {"channel_id": "family", "sound": "apollo_chime.wav"}   # softer chime: family replies


class RegisterPushBody(BaseModel):
    user_id: str = Field(min_length=8, max_length=64)
    platform: Literal["android", "ios"]
    device_token: str = Field(min_length=8, max_length=4096)


@router.post("/register-push", status_code=201)
async def register_push(body: RegisterPushBody):
    resp = await _push_client.post("/api/v1/push/users/register", json=body.model_dump())
    if resp.status_code == 401:
        raise HTTPException(status_code=500, detail="EMERGENT_PUSH_KEY missing or invalid")
    if resp.status_code >= 500:
        raise HTTPException(status_code=502, detail="Push provider unavailable")
    resp.raise_for_status()
    await db.devices.update_one({"device_id": body.user_id}, {"$set": {"push_registered_at": now_utc(), "push_platform": body.platform}})
    return {"status": "registered"}


async def send_push(recipients: list[str], data: dict, idempotency_key: Optional[str] = None) -> None:
    if not recipients:
        return
    if len(recipients) > 100:
        raise ValueError("max 100 recipients per /trigger call; chunk before sending")
    if "title" not in data or "message" not in data:
        raise ValueError("data must include title and message")
    payload: dict[str, Any] = {"recipients": recipients, "data": data}
    if idempotency_key:
        payload["$idempotency_key"] = idempotency_key
    resp = await _push_client.post("/api/v1/push/trigger", json=payload)
    if resp.status_code == 401:
        raise HTTPException(status_code=500, detail="EMERGENT_PUSH_KEY missing or invalid")
    if resp.status_code >= 500:
        raise HTTPException(status_code=502, detail="Push provider unavailable")
    resp.raise_for_status()


class PushTestIn(BaseModel):
    device_id: str = Field(min_length=8, max_length=64)


@router.post("/push/test")
async def push_test(body: PushTestIn):
    """Sample bark so people can hear and see exactly what a threat alert looks like."""
    try:
        await send_push(
            recipients=[body.device_id],
            data={"title": "Apollo is barking (test)", "message": "This is what a threat alert looks like. A real one names the website and tells you what to do.",
                  "subtext": "No action needed — this is a test.", "action_url": "/settings", **PUSH_THREAT},
            idempotency_key=f"test-{body.device_id}-{int(now_utc().timestamp())}",
        )
    except HTTPException as exc:
        raise HTTPException(status_code=exc.status_code, detail="Test alert could not be sent. Notifications work after a native build with push configured.") from exc
    return {"sent": True}


async def push_owner_alert(event: PatrolEvent) -> None:
    """Tell the protected person the moment Apollo barks/bites while the app is closed.
    Growling is a non-urgent nudge → default channel, silenced during the device's quiet hours."""
    try:
        if event.state == "growling":
            if await device_quiet_now(event.device_id):
                logger.info("growling push suppressed by quiet hours")
                return
            data = {"title": "Apollo is growling", "message": event.headline, "subtext": event.what_to_do[:120], "action_url": f"/patrol/{event.event_id}", "channel_id": "growling"}
        else:
            verb = "Apollo is barking" if event.state == "barking" else "Apollo blocked a threat"
            data = {"title": verb, "message": event.headline, "subtext": event.what_to_do[:120], "action_url": f"/patrol/{event.event_id}", **PUSH_THREAT}
        await send_push(recipients=[event.device_id], data=data, idempotency_key=f"owner-{event.event_id}")
    except Exception as exc:  # noqa: BLE001
        logger.warning("owner push failed (non-blocking): %s", type(exc).__name__)
