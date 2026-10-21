"""Alert notification boundary (spec §10A push protocol).

Delivery goes through Apollo's managed push relay: the app registers the device's native FCM/APNs token, the relay
resolves tokens from the installation id at send time, and no device token is ever stored here. Permission,
registration and delivery remain separate states. Every send is one durable delivery per (owner, event, channel,
recipient) with a payload digest and attempt history. A queued request, an accepted relay response and a visible
notification are separate outcomes; nothing is reported "sent" without a registered recipient and an accepted
response, and a timeout after send is `outcome_unknown` until retried — never a definite non-delivery.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
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

# Sound routing — Android channel id MUST match a channel the app actually creates
# (src/push/notifications.ts). Android silently drops a notification addressed to a channel that
# does not exist or has been deleted, so the consolidated "apollo_alerts" channel is the only
# destination for Apollo's own alerts; Family Help keeps its separate channel. `sound` is the iOS
# filename for the same intent (the channel owns the sound on Android 8+).
APOLLO_ALERTS_CHANNEL = "apollo_alerts"
PUSH_THREAT = {"channel_id": APOLLO_ALERTS_CHANNEL, "sound": "apollo_bark.wav"}   # Apollo barks: threat alerts (owner + family)
PUSH_FAMILY = {"channel_id": "family", "sound": "apollo_chime.wav"}               # softer chime: family replies
PUSH_GROWL = {"channel_id": APOLLO_ALERTS_CHANNEL, "sound": None}

PUSH_BASE_URL = "https://integrations.emergentagent.com"
PUSH_KEY = os.environ.get("EMERGENT_PUSH_KEY", "")
# The build pipeline replaces the placeholder with the real key when the app is published, so before
# that the channel is honestly "not configured" rather than silently failing on every send.
PUSH_KEY_PLACEHOLDER = PUSH_KEY.strip().lower() in ("", "placeholder")
# Billing/consent states on the owner's Emergent account. Not transient: retrying is pointless until
# the owner acts, so they are recorded as the failure reason instead of being retried in a loop.
BILLING_CODES = ("insufficient_credits", "integration_disabled", "daily_limit_reached")

DeliveryState = Literal["queued", "submitted", "provider_accepted", "device_observed", "failed", "outcome_unknown"]

_client = httpx.AsyncClient(base_url=PUSH_BASE_URL, headers={"X-Push-Key": PUSH_KEY}, timeout=15.0)


def push_configured() -> bool:
    return not PUSH_KEY_PLACEHOLDER


def push_setup_detail() -> str:
    return ("Alerts that arrive while Apollo is closed are switched on when the app is published and built — the managed "
            "alert key is filled in by the build pipeline (EMERGENT_PUSH_KEY). Until then no notification is sent.")



async def ensure_indexes() -> None:
    await db.push_registrations.create_index([("device_id", 1)], unique=True)
    await db.push_deliveries.create_index([("owner_id", 1), ("event_key", 1), ("channel", 1), ("recipient_id", 1)], unique=True)
    await db.push_deliveries.create_index([("delivery_id", 1)], unique=True)
    await db.push_deliveries.create_index([("state", 1), ("updated_at", 1)])


# ------------------------------------------------------------------ registration
class RegisterPushBody(BaseModel):
    platform: Literal["android", "ios"]
    # The device's native FCM/APNs token. The relay resolves it from the installation id at send
    # time, so it is forwarded once and never stored here.
    device_token: str = Field(min_length=8, max_length=4096)

    model_config = {"populate_by_name": True}


@router.post("/register-push", status_code=201)
async def register_push(body: RegisterPushBody, request: Request):
    """Registers the calling installation for alerts. Ownership is the authenticated device; a body user_id cannot choose it."""
    if not push_configured():
        raise HTTPException(503, push_setup_detail())
    owner = request.state.device["device_id"]
    try:
        resp = await _client.post("/api/v1/push/users/register", json={"user_id": owner, "platform": body.platform, "device_token": body.device_token})
    except httpx.HTTPError:
        raise HTTPException(502, "Apollo's alert service could not be reached, so this device is not registered for alerts yet.")
    if resp.status_code == 401:
        raise HTTPException(503, "Apollo's managed alert key is missing or invalid, so this device cannot be registered for alerts.")
    if resp.status_code >= 500:
        raise HTTPException(502, "Apollo's alert service is unavailable, so this device is not registered for alerts yet.")
    if resp.status_code >= 400:
        raise HTTPException(422, "Apollo's alert service rejected this device token.")
    existing = await db.push_registrations.find_one({"device_id": owner}, {"_id": 0, "registration_id": 1})
    registration_id = existing["registration_id"] if existing else str(uuid.uuid4())
    registered_at = now_utc()
    await db.push_registrations.update_one(
        {"device_id": owner},
        {"$set": {"registration_id": registration_id, "platform": body.platform, "provider": "emergent", "registered_at": registered_at},
         "$unset": {"token": "", "project_id": ""}},  # tokens live in the relay, never in Apollo's database
        upsert=True)
    return {"registered": True, "provider": "emergent", "registrationId": registration_id, "registeredAt": registered_at.isoformat()}


async def _registrations(recipients: list[str]) -> dict[str, dict]:
    return {r["device_id"]: r async for r in db.push_registrations.find({"device_id": {"$in": recipients}}, {"_id": 0})}


# ------------------------------------------------------------------ deliveries
def _status(row: dict) -> dict:
    return {"deliveryId": row["delivery_id"], "channel": "push", "state": row["state"], "retryable": row.get("retryable", False),
            "failureCode": row.get("failure_code"), "updatedAt": row["updated_at"].isoformat()}


def _relay_data(data: dict) -> dict:
    """The relay's data contract. Fields it types as strings must be omitted rather than sent as null —
    a null value makes the provider reject the request outright (this is what failed every weekly
    family alert with HTTP 400 while Apollo sent `subtitle: null`)."""
    out = {"title": data["title"], "message": data["message"], "channel_id": data.get("channel_id") or APOLLO_ALERTS_CHANNEL}
    for key in ("subtext", "action_url", "sound", "image_url"):
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            out[key] = value
    return out


async def _set(delivery_id: str, state: DeliveryState, *, failure_code: Optional[str] = None, retryable: bool = False, extra: Optional[dict] = None) -> None:
    attempt = {"at": now_utc(), "state": state, "failureCode": failure_code, **(extra or {})}
    await db.push_deliveries.update_one({"delivery_id": delivery_id}, {"$set": {"state": state, "failure_code": failure_code, "retryable": retryable, "updated_at": now_utc(), **(extra or {})},
                                                                     "$push": {"attempts": attempt}})


async def _trigger(recipients: list[str], data: dict, idempotency_key: str, attempt: int = 0) -> httpx.Response:
    """One relay trigger, retrying only the 'same key still in flight' answer (which is not a failure)."""
    payload = {"recipients": recipients, "data": _relay_data(data), "$idempotency_key": idempotency_key}
    resp = await _client.post("/api/v1/push/trigger", json=payload)
    if resp.status_code == 409 and attempt < 3 and _code(resp) == "idempotency_key_in_progress":
        await asyncio.sleep(3)
        return await _trigger(recipients, data, idempotency_key, attempt + 1)
    return resp


def _code(resp: httpx.Response) -> str:
    if not resp.headers.get("content-type", "").startswith("application/json"):
        return ""
    try:
        return (resp.json() or {}).get("code", "") or ""
    except ValueError:
        return ""


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
                row = existing  # bounded retry of the same logical delivery
            else:
                rows.append(existing or row)
                continue
        rows.append(row)
    to_send = [r for r in rows if r["state"] in ("queued", "failed", "outcome_unknown") and r.get("retryable", True) and len(r.get("attempts", [])) < 5]
    if not to_send:
        return [_status(r) for r in rows]
    for r in to_send:
        await _set(r["delivery_id"], "submitted")

    async def finish() -> list[dict]:
        return [_status(await db.push_deliveries.find_one({"delivery_id": r["delivery_id"]}, {"_id": 0})) for r in rows]

    try:
        resp = await _trigger([r["recipient_id"] for r in to_send], data, event_key)
    except httpx.TimeoutException:
        for r in to_send:  # the request may have reached the relay: unknown until retried, not a definite failure
            await _set(r["delivery_id"], "outcome_unknown", failure_code="provider_timeout", retryable=True)
        return await finish()
    except httpx.HTTPError:
        for r in to_send:
            await _set(r["delivery_id"], "failed", failure_code="provider_unreachable", retryable=True)
        return await finish()

    code = _code(resp)
    if code in BILLING_CODES:
        # The owner's account, not the device: say so plainly in the ledger and stop — a retry loop
        # would only repeat the refusal. Sends resume on their own once the owner acts.
        logger.warning("push paused: %s (%s)", code, resp.status_code)
        for r in to_send:
            await _set(r["delivery_id"], "failed", failure_code=code, retryable=False)
        return await finish()
    if resp.status_code == 401:
        for r in to_send:
            await _set(r["delivery_id"], "failed", failure_code="push_key_invalid", retryable=False)
        return await finish()
    if resp.status_code >= 400:
        for r in to_send:
            await _set(r["delivery_id"], "failed", failure_code=code or f"provider_http_{resp.status_code}", retryable=resp.status_code >= 500)
        return await finish()
    # Accepted by the relay. That is a hand-off, not a sighting: the delivery stays "provider_accepted"
    # and is never reported as seen on the device.
    for r in to_send:
        await _set(r["delivery_id"], "provider_accepted")
    return await finish()


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
    row = await db.push_registrations.find_one({"device_id": owner}, {"_id": 0, "registration_id": 1, "registered_at": 1, "platform": 1, "provider": 1})
    return {"configured": push_configured(), "registered": bool(row), "registrationId": row["registration_id"] if row else None,
            "registeredAt": row["registered_at"].isoformat() if row else None, "provider": row.get("provider") if row else None,
            "setupDetail": None if push_configured() else push_setup_detail()}


class PushTestIn(BaseModel):
    device_id: Optional[str] = Field(default=None, min_length=8, max_length=64)  # ignored: the authenticated installation is the recipient


@router.post("/push/test", status_code=202)
async def push_test(request: Request, body: Optional[PushTestIn] = None):
    """Sample bark so people can hear and see exactly what a threat alert looks like. 202 DeliveryStatus when queued;
    409 recipient_unregistered when this installation has no registration; 503 when the channel is not configured."""
    owner = request.state.device["device_id"]
    if not push_configured():
        raise HTTPException(503, push_setup_detail())
    if not await db.push_registrations.find_one({"device_id": owner}, {"_id": 1}):
        return JSONResponse({"detail": "This installation has no push registration yet. Allow notifications and let Apollo register, then try again.",
                             "error": {"code": "recipient_unregistered", "message": "This installation has no push registration yet. Allow notifications and let Apollo register, then try again."}}, status_code=409)
    statuses = await send_push(recipients=[owner], owner_id=owner,
                               data={"title": "Apollo is barking (test)", "message": "Higgins: This is what a threat alert looks like. A real alert names the concern and the evidence.",
                                     "subtext": "Higgins: No action needed — this is a test.", "action_url": "/settings", **PUSH_THREAT},
                               idempotency_key=f"test-{owner}-{int(now_utc().timestamp())}")
    if not statuses:
        return JSONResponse({"detail": "No registered destination for this installation.",
                             "error": {"code": "recipient_unregistered", "message": "No registered destination for this installation."}}, status_code=409)
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
