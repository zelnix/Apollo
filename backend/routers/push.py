"""Alert notification boundary (spec §10A push protocol).

Expo is the sender, so devices register an Expo push token for the owner's Expo project (never a raw FCM/APNs token).
Permission, registration and delivery are separate states. Every send is one durable delivery per (owner, event, channel,
recipient) with a payload digest, attempt history and the real Expo ticket/receipt references. A queued request, an accepted
ticket, a receipt and a visible notification are separate outcomes; nothing is reported "sent" without a registered recipient
and an accepted ticket, and a timeout after send is `outcome_unknown` until reconciled — never a definite non-delivery.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import uuid
from typing import Literal, Optional

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from pymongo.errors import DuplicateKeyError

from core.config import logger
from core.db import db, now_utc
from core.models import PatrolEvent
from routers.devices import device_quiet_now

router = APIRouter()

# Sound routing — Android channel id (must match the channels created in app/_layout.tsx) + bundled sound file.
PUSH_THREAT = {"channel_id": "threats", "sound": "apollo_bark.wav"}   # Apollo barks: threat alerts (owner + family)
PUSH_FAMILY = {"channel_id": "family", "sound": "apollo_chime.wav"}   # softer chime: family replies
PUSH_GROWL = {"channel_id": "growling", "sound": None}

EXPO_PUSH_ACCESS_TOKEN = os.environ.get("EXPO_PUSH_ACCESS_TOKEN", "")
EXPO_PUSH_ENABLED = os.environ.get("EXPO_PUSH_ENABLED", "").lower() in ("1", "true", "yes")
EXPO_PROJECT_ID = os.environ.get("EXPO_PROJECT_ID", "")
EXPO_SEND_URL = "https://exp.host/--/api/v2/push/send"
EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts"
TOKEN_RE = re.compile(r"^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$")

DeliveryState = Literal["queued", "submitted", "provider_accepted", "device_observed", "failed", "outcome_unknown"]


def push_configured() -> bool:
    return EXPO_PUSH_ENABLED and bool(EXPO_PUSH_ACCESS_TOKEN)


def push_setup_detail() -> str:
    missing = [k for k, v in (("EXPO_PUSH_ENABLED", EXPO_PUSH_ENABLED), ("EXPO_PUSH_ACCESS_TOKEN", bool(EXPO_PUSH_ACCESS_TOKEN))) if not v]
    return f"Push delivery needs the owner's Expo push configuration ({', '.join(missing)}) plus native FCM/APNs setup in the Expo project. No notification was sent."


async def ensure_indexes() -> None:
    await db.push_registrations.create_index([("device_id", 1)], unique=True)
    await db.push_deliveries.create_index([("owner_id", 1), ("event_key", 1), ("channel", 1), ("recipient_id", 1)], unique=True)
    await db.push_deliveries.create_index([("delivery_id", 1)], unique=True)
    await db.push_deliveries.create_index([("state", 1), ("updated_at", 1)])


# ------------------------------------------------------------------ registration
class RegisterPushBody(BaseModel):
    platform: Literal["android", "ios"]
    provider: Literal["expo"] = "expo"
    project_id: str = Field(alias="projectId", min_length=8, max_length=64)
    device_token: str = Field(min_length=8, max_length=4096)

    model_config = {"populate_by_name": True}


@router.post("/register-push", status_code=201)
async def register_push(body: RegisterPushBody, request: Request):
    """Registers the calling installation's Expo push token. Ownership is the authenticated device; a body user_id cannot choose it."""
    if not TOKEN_RE.match(body.device_token):
        raise HTTPException(422, "Only Expo push tokens (ExponentPushToken[...]) from the owner's Expo project are accepted; raw FCM/APNs tokens are not.")
    if EXPO_PROJECT_ID and body.project_id != EXPO_PROJECT_ID:
        raise HTTPException(422, "The push token belongs to a different Expo project than the one this backend sends from.")
    if not push_configured():
        raise HTTPException(503, push_setup_detail())
    owner = request.state.device["device_id"]
    existing = await db.push_registrations.find_one({"device_id": owner}, {"_id": 0, "registration_id": 1})
    registration_id = existing["registration_id"] if existing else str(uuid.uuid4())
    registered_at = now_utc()
    await db.push_registrations.update_one({"device_id": owner}, {"$set": {"registration_id": registration_id, "platform": body.platform, "provider": "expo",
                                                                            "project_id": body.project_id, "token": body.device_token, "registered_at": registered_at}}, upsert=True)
    return {"registered": True, "provider": "expo", "registrationId": registration_id, "registeredAt": registered_at.isoformat()}


async def _registrations(recipients: list[str]) -> dict[str, dict]:
    return {r["device_id"]: r async for r in db.push_registrations.find({"device_id": {"$in": recipients}}, {"_id": 0})}


# ------------------------------------------------------------------ deliveries
def _status(row: dict) -> dict:
    return {"deliveryId": row["delivery_id"], "channel": "push", "state": row["state"], "retryable": row.get("retryable", False),
            "failureCode": row.get("failure_code"), "updatedAt": row["updated_at"].isoformat()}


def _message(token: str, data: dict) -> dict:
    channel = data.get("channel_id") or "growling"
    msg = {"to": token, "title": data["title"], "body": data["message"], "subtitle": data.get("subtext"), "data": {"action_url": data.get("action_url")},
           "channelId": channel, "priority": "high" if channel == "threats" else "default"}
    if data.get("sound"):
        msg["sound"] = data["sound"]
    return msg


async def _set(delivery_id: str, state: DeliveryState, *, failure_code: Optional[str] = None, retryable: bool = False, extra: Optional[dict] = None) -> None:
    attempt = {"at": now_utc(), "state": state, "failureCode": failure_code, **(extra or {})}
    await db.push_deliveries.update_one({"delivery_id": delivery_id}, {"$set": {"state": state, "failure_code": failure_code, "retryable": retryable, "updated_at": now_utc(), **(extra or {})},
                                                                     "$push": {"attempts": attempt}})


async def send_push(recipients: list[str], data: dict, idempotency_key: Optional[str] = None, owner_id: Optional[str] = None) -> list[dict]:
    """Queues and submits one durable delivery per recipient. Returns DeliveryStatus rows (possibly empty when nobody is registered).
    Raises 503 when the channel is not configured. Never claims success from an empty or error response."""
    if not recipients:
        return []
    if len(recipients) > 100:
        raise ValueError("max 100 recipients per send; chunk before sending")
    if "title" not in data or "message" not in data:
        raise ValueError("data must include title and message")
    if not push_configured():
        raise HTTPException(503, push_setup_detail())
    event_key = idempotency_key or f"adhoc-{uuid.uuid4()}"
    owner = owner_id or recipients[0]
    digest = hashlib.sha256(json.dumps(data, sort_keys=True, default=str).encode()).hexdigest()
    registrations = await _registrations(recipients)
    rows: list[dict] = []
    for recipient in recipients:
        if recipient not in registrations:
            continue  # unregistered destinations produce no delivery; callers that need one recipient check `recipient_unregistered`
        row = {"delivery_id": str(uuid.uuid4()), "owner_id": owner, "event_key": event_key, "channel": "push", "recipient_id": recipient,
               "payload_digest": digest, "state": "queued", "retryable": True, "failure_code": None, "attempts": [], "ticket_id": None, "receipt": None,
               "created_at": now_utc(), "updated_at": now_utc()}
        try:
            await db.push_deliveries.insert_one(row)
        except DuplicateKeyError:
            existing = await db.push_deliveries.find_one({"owner_id": owner, "event_key": event_key, "channel": "push", "recipient_id": recipient}, {"_id": 0})
            if existing and existing["payload_digest"] != digest:
                logger.warning("push delivery %s reused with a different payload; original retained", existing["delivery_id"])
            if existing and existing["state"] in ("failed", "outcome_unknown") and existing.get("retryable"):
                row = existing  # bounded retry of the same logical delivery; ticket/receipt reconciliation below
            else:
                rows.append(existing or row)
                continue
        rows.append(row)
    to_send = [r for r in rows if r["state"] in ("queued", "failed", "outcome_unknown") and r.get("retryable", True) and len(r.get("attempts", [])) < 5]
    if not to_send:
        return [_status(r) for r in rows]
    messages = [_message(registrations[r["recipient_id"]]["token"], data) for r in to_send]
    for r in to_send:
        await _set(r["delivery_id"], "submitted")
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(EXPO_SEND_URL, headers={"Authorization": f"Bearer {EXPO_PUSH_ACCESS_TOKEN}", "Accept": "application/json"}, json=messages)
    except httpx.TimeoutException:
        for r in to_send:  # the request may have reached Expo: unknown until reconciled, not a definite failure
            await _set(r["delivery_id"], "outcome_unknown", failure_code="provider_timeout", retryable=True)
        return [_status(await db.push_deliveries.find_one({"delivery_id": r["delivery_id"]}, {"_id": 0})) for r in rows]
    except httpx.HTTPError:
        for r in to_send:
            await _set(r["delivery_id"], "failed", failure_code="provider_unreachable", retryable=True)
        return [_status(await db.push_deliveries.find_one({"delivery_id": r["delivery_id"]}, {"_id": 0})) for r in rows]
    if resp.status_code >= 400:
        for r in to_send:
            await _set(r["delivery_id"], "failed", failure_code=f"provider_http_{resp.status_code}", retryable=resp.status_code >= 500)
        return [_status(await db.push_deliveries.find_one({"delivery_id": r["delivery_id"]}, {"_id": 0})) for r in rows]
    tickets = (resp.json() or {}).get("data") or []
    if len(tickets) != len(to_send):  # empty/short response is not success
        for r in to_send[len(tickets):]:
            await _set(r["delivery_id"], "outcome_unknown", failure_code="ticket_missing", retryable=True)
    for r, ticket in zip(to_send, tickets):
        if ticket.get("status") == "ok" and ticket.get("id"):
            await _set(r["delivery_id"], "provider_accepted", extra={"ticket_id": ticket["id"]})
        else:
            code = (ticket.get("details") or {}).get("error") or "ticket_error"
            if code == "DeviceNotRegistered":
                await db.push_registrations.delete_one({"device_id": r["recipient_id"]})
            await _set(r["delivery_id"], "failed", failure_code=code, retryable=code not in ("DeviceNotRegistered", "InvalidCredentials"))
    return [_status(await db.push_deliveries.find_one({"delivery_id": r["delivery_id"]}, {"_id": 0})) for r in rows]


async def reconcile_receipts(limit: int = 100) -> int:
    """Queries Expo receipts for accepted tickets (Expo makes receipts available ~15 minutes after acceptance)."""
    if not push_configured():
        return 0
    pending = [r async for r in db.push_deliveries.find({"state": "provider_accepted", "ticket_id": {"$ne": None}}, {"_id": 0}).limit(limit)]
    if not pending:
        return 0
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(EXPO_RECEIPTS_URL, headers={"Authorization": f"Bearer {EXPO_PUSH_ACCESS_TOKEN}", "Accept": "application/json"}, json={"ids": [r["ticket_id"] for r in pending]})
    except httpx.HTTPError:
        return 0
    if resp.status_code >= 400:
        return 0
    receipts = (resp.json() or {}).get("data") or {}
    updated = 0
    for r in pending:
        receipt = receipts.get(r["ticket_id"])
        if not receipt:
            continue
        if receipt.get("status") == "ok":
            await _set(r["delivery_id"], "device_observed", extra={"receipt": receipt})  # provider-confirmed hand-off to the platform push service
        else:
            code = (receipt.get("details") or {}).get("error") or "receipt_error"
            if code == "DeviceNotRegistered":
                await db.push_registrations.delete_one({"device_id": r["recipient_id"]})
            await _set(r["delivery_id"], "failed", failure_code=code, retryable=False, extra={"receipt": receipt})
        updated += 1
    return updated


@router.get("/push/deliveries/{delivery_id}")
async def get_delivery(delivery_id: str, request: Request):
    owner = request.state.device["device_id"]
    row = await db.push_deliveries.find_one({"delivery_id": delivery_id, "$or": [{"owner_id": owner}, {"recipient_id": owner}]}, {"_id": 0})
    if not row:
        raise HTTPException(404, "Unknown delivery.")
    return _status(row)


@router.get("/push/registration")
async def get_registration(request: Request):
    """Registration state for the calling installation (separate from the OS notification permission)."""
    owner = request.state.device["device_id"]
    row = await db.push_registrations.find_one({"device_id": owner}, {"_id": 0, "registration_id": 1, "registered_at": 1, "platform": 1})
    return {"configured": push_configured(), "registered": bool(row), "registrationId": row["registration_id"] if row else None,
            "registeredAt": row["registered_at"].isoformat() if row else None, "setupDetail": None if push_configured() else push_setup_detail()}


class PushTestIn(BaseModel):
    device_id: Optional[str] = Field(default=None, min_length=8, max_length=64)  # ignored: the authenticated installation is the recipient


@router.post("/push/test", status_code=202)
async def push_test(body: PushTestIn, request: Request):
    """Sample bark so people can hear and see exactly what a threat alert looks like. 202 DeliveryStatus when queued;
    409 recipient_unregistered when this installation has no registration; 503 when the channel is not configured."""
    owner = request.state.device["device_id"]
    if not push_configured():
        raise HTTPException(503, push_setup_detail())
    if not await db.push_registrations.find_one({"device_id": owner}, {"_id": 1}):
        return JSONResponse({"error": {"code": "recipient_unregistered", "message": "This installation has no push registration yet. Allow notifications and let Apollo register, then try again."}}, status_code=409)
    statuses = await send_push(recipients=[owner], owner_id=owner,
                               data={"title": "Apollo is barking (test)", "message": "Higgins: This is what a threat alert looks like. A real alert names the concern and the evidence.",
                                     "subtext": "Higgins: No action needed — this is a test.", "action_url": "/settings", **PUSH_THREAT},
                               idempotency_key=f"test-{owner}-{int(now_utc().timestamp())}")
    if not statuses:
        return JSONResponse({"error": {"code": "recipient_unregistered", "message": "No registered destination for this installation."}}, status_code=409)
    return JSONResponse(statuses[0], status_code=202)


async def push_owner_alert(event: PatrolEvent) -> None:
    """Tell the protected person the moment Apollo barks/bites while the app is closed.
    Growling is a non-urgent nudge → default channel, silenced during the device's quiet hours."""
    try:
        if event.state == "growling":
            if await device_quiet_now(event.device_id):
                logger.info("growling push suppressed by quiet hours")
                return
            data = {"title": "Apollo is growling", "message": f"Higgins: {event.headline}", "subtext": f"Higgins: {event.what_to_do[:110]}", "action_url": f"/patrol/{event.event_id}", **PUSH_GROWL}
        else:
            verb = "Apollo is barking" if event.state == "barking" else "Apollo is biting"
            data = {"title": verb, "message": f"Higgins: {event.headline}", "subtext": f"Higgins: {event.what_to_do[:110]}", "action_url": f"/patrol/{event.event_id}", **PUSH_THREAT}
        await send_push(recipients=[event.device_id], data=data, idempotency_key=f"owner-{event.event_id}", owner_id=event.device_id)
    except Exception as exc:  # noqa: BLE001
        logger.warning("owner push failed (non-blocking): %s", type(exc).__name__)
