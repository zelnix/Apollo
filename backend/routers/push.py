"""Alert notification boundary. Managed relay removed; direct credentials required."""
from __future__ import annotations

import os
import re

import httpx
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from core.config import logger
from core.db import db, now_utc
from core.models import PatrolEvent
from routers.devices import device_quiet_now

router = APIRouter()


# Sound routing — Android channel id + iOS aps.sound. Files bundled via expo-notifications `sounds` in app.json.
PUSH_THREAT = {"channel_id": "threats", "sound": "apollo_bark.wav"}   # Apollo barks: threat alerts (owner + family)
PUSH_FAMILY = {"channel_id": "family", "sound": "apollo_chime.wav"}   # softer chime: family replies


class RegisterPushBody(BaseModel):
    user_id: str = Field(min_length=8, max_length=64)
    platform: Literal["android", "ios"]
    device_token: str = Field(min_length=8, max_length=4096)


EXPO_PUSH_ACCESS_TOKEN = os.environ.get("EXPO_PUSH_ACCESS_TOKEN", "")
EXPO_PUSH_ENABLED = os.environ.get("EXPO_PUSH_ENABLED", "").lower() in ("1", "true", "yes")


def push_configured() -> bool:
    return EXPO_PUSH_ENABLED and bool(EXPO_PUSH_ACCESS_TOKEN)


@router.post("/register-push", status_code=201)
async def register_push(body: RegisterPushBody, request: Request):
    """Stores the owner project's Expo push token for the calling device (owner-scoped; token never returned)."""
    if not push_configured():
        raise HTTPException(503, "Push delivery requires the owner's Expo push credentials (EXPO_PUSH_ENABLED, EXPO_PUSH_ACCESS_TOKEN). No device was registered for delivery.")
    if not re.match(r"^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$", body.device_token):
        raise HTTPException(422, "Only Expo push tokens from the owner's project are accepted.")
    owner = request.state.device["device_id"]
    await db.push_tokens.update_one({"device_id": owner}, {"$set": {"platform": body.platform, "token": body.device_token, "updated_at": now_utc()}}, upsert=True)
    return {"registered": True}


async def send_push(recipients: list[str], data: dict, idempotency_key: Optional[str] = None) -> None:
    if not recipients:
        return
    if len(recipients) > 100:
        raise ValueError("max 100 recipients per /trigger call; chunk before sending")
    if "title" not in data or "message" not in data:
        raise ValueError("data must include title and message")
    if not push_configured():
        raise HTTPException(503, "Push delivery requires owner-managed push credentials. No notification was sent.")
    if idempotency_key and await db.delivery_receipts.find_one({"channel": "push", "idempotency_key": idempotency_key}, {"_id": 1}):
        return
    tokens = [t["token"] async for t in db.push_tokens.find({"device_id": {"$in": recipients}}, {"_id": 0, "token": 1})]
    if not tokens:
        return
    messages = [{"to": token, "title": data["title"], "body": data["message"], "subtitle": data.get("subtext"), "data": {"action_url": data.get("action_url")},
                 "channelId": data.get("channel_id"), "priority": "high" if data.get("channel_id") == "threat" else "default"} for token in tokens]
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post("https://exp.host/--/api/v2/push/send", headers={"Authorization": f"Bearer {EXPO_PUSH_ACCESS_TOKEN}", "Accept": "application/json"}, json=messages)
    except httpx.HTTPError:
        raise HTTPException(503, "The push service did not answer. No notification was sent.")
    if r.status_code >= 400:
        raise HTTPException(503, "The push service rejected the notification.")
    tickets = r.json().get("data", [])
    for token, ticket in zip(tokens, tickets):
        if ticket.get("details", {}).get("error") == "DeviceNotRegistered":
            await db.push_tokens.delete_one({"token": token})
    if idempotency_key:
        await db.delivery_receipts.insert_one({"channel": "push", "idempotency_key": idempotency_key, "sent_at": now_utc(), "tickets": len(tickets)})


class PushTestIn(BaseModel):
    device_id: str = Field(min_length=8, max_length=64)


@router.post("/push/test")
async def push_test(body: PushTestIn):
    """Sample bark so people can hear and see exactly what a threat alert looks like."""
    try:
        await send_push(
            recipients=[body.device_id],
            data={"title": "Apollo is barking (test)", "message": "Higgins: This is what a threat alert looks like. A real alert names the concern and the evidence.",
                  "subtext": "Higgins: No action needed — this is a test.", "action_url": "/settings", **PUSH_THREAT},
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
            data = {"title": "Apollo is growling", "message": f"Higgins: {event.headline}", "subtext": f"Higgins: {event.what_to_do[:110]}", "action_url": f"/patrol/{event.event_id}", "channel_id": "growling"}
        else:
            verb = "Apollo is barking" if event.state == "barking" else "Apollo is biting"
            data = {"title": verb, "message": f"Higgins: {event.headline}", "subtext": f"Higgins: {event.what_to_do[:110]}", "action_url": f"/patrol/{event.event_id}", **PUSH_THREAT}
        await send_push(recipients=[event.device_id], data=data, idempotency_key=f"owner-{event.event_id}")
    except Exception as exc:  # noqa: BLE001
        logger.warning("owner push failed (non-blocking): %s", type(exc).__name__)
