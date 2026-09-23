"""Bounded in-memory WSS relay. SDP/ICE are never persisted or logged."""
from __future__ import annotations

import asyncio
import hashlib
import json
from collections import defaultdict

from fastapi import WebSocket, WebSocketDisconnect
from pymongo import ReturnDocument

from core.db import db, now_utc
from services.family_assist.authorization import require_current_relationship, role_for_device
from services.family_assist.relay_credentials import RelayCredentialError, issue_relay_credentials

MAX_MESSAGE = 65_536
MAX_CANDIDATE = 4_096
MAX_PENDING = 32
MAX_ICE = 128
ALLOWED = {"offer", "answer", "ice_candidate", "ice_complete", "pause_state", "terminate", "relay_refresh"}
FIELDS = {"type", "sequence", "generation", "sdp", "candidate", "paused", "reason"}


class SignalHub:
    def __init__(self):
        self.lock = asyncio.Lock(); self.sockets: dict[str, dict[str, WebSocket]] = defaultdict(dict)
        self.pending: dict[tuple[str, str], list[str]] = defaultdict(list)

    async def connected(self, session_id: str, role: str) -> bool:
        async with self.lock: return role in self.sockets.get(session_id, {})

    async def add(self, session_id: str, role: str, websocket: WebSocket) -> bool:
        async with self.lock:
            if role in self.sockets[session_id] or len(self.sockets[session_id]) >= 2: return False
            self.sockets[session_id][role] = websocket; return True

    async def remove(self, session_id: str, role: str, websocket: WebSocket) -> None:
        async with self.lock:
            if self.sockets.get(session_id, {}).get(role) is websocket: self.sockets[session_id].pop(role, None)
            if not self.sockets.get(session_id): self.sockets.pop(session_id, None)

    async def forward(self, session_id: str, source_role: str, raw: str) -> None:
        target_role = "helper" if source_role == "sharer" else "sharer"
        async with self.lock:
            peer = self.sockets.get(session_id, {}).get(target_role)
            if peer is None:
                queue = self.pending[(session_id, target_role)]
                if len(queue) >= MAX_PENDING: raise ValueError("peer_queue_full")
                queue.append(raw); return
        await asyncio.wait_for(peer.send_text(raw), timeout=5)

    async def flush(self, session_id: str, role: str, websocket: WebSocket) -> None:
        async with self.lock: messages = self.pending.pop((session_id, role), [])
        for raw in messages: await asyncio.wait_for(websocket.send_text(raw), timeout=5)


hub = SignalHub()


async def consume_ticket(raw: str, session_id: str) -> tuple[dict, dict] | None:
    digest = hashlib.sha256(raw.encode()).hexdigest()
    ticket = await db.family_assist_tickets.find_one_and_update({"digest": digest, "session_id": session_id, "consumed_at": None, "expires_at": {"$gt": now_utc()}},
        {"$set": {"consumed_at": now_utc()}}, projection={"_id": 0}, return_document=ReturnDocument.AFTER)
    if not ticket: return None
    session = await db.family_assist_sessions.find_one({"session_id": session_id, "generation": ticket["generation"], "state": {"$in": ["helper_accepted", "awaiting_capture_consent", "connecting", "active", "paused"]}}, {"_id": 0})
    if not session: return None
    await require_current_relationship(session)
    if role_for_device(session, ticket["device_id"]) != ticket["role"]: return None
    return ticket, session


def validate_message(raw: str, role: str, generation: str, last_sequence: int, ice_count: int) -> tuple[dict, int]:
    if len(raw.encode()) > MAX_MESSAGE: raise ValueError("message_too_large")
    message = json.loads(raw)
    if not isinstance(message, dict) or set(message) - FIELDS or message.get("type") not in ALLOWED: raise ValueError("invalid_message")
    if message.get("generation") != generation or not isinstance(message.get("sequence"), int) or message["sequence"] <= last_sequence: raise ValueError("stale_sequence")
    kind = message["type"]
    if kind == "offer" and (role != "sharer" or not isinstance(message.get("sdp"), str) or len(message["sdp"]) > 60_000): raise ValueError("invalid_offer")
    if kind == "answer" and (role != "helper" or not isinstance(message.get("sdp"), str) or len(message["sdp"]) > 60_000): raise ValueError("invalid_answer")
    if kind == "ice_candidate":
        if ice_count >= MAX_ICE or not isinstance(message.get("candidate"), str) or len(message["candidate"]) > MAX_CANDIDATE: raise ValueError("invalid_candidate")
        ice_count += 1
    if kind == "pause_state" and (role != "sharer" or not isinstance(message.get("paused"), bool)): raise ValueError("invalid_pause")
    if kind == "terminate" and message.get("reason") not in {"owner_stopped", "helper_left", "capture_revoked", "relationship_revoked", "timeout", "transport_failed", "os_terminated", "app_terminated"}: raise ValueError("invalid_termination")
    if kind == "relay_refresh" and set(message) != {"type", "sequence", "generation"}: raise ValueError("invalid_relay_refresh")
    return message, ice_count


async def serve(websocket: WebSocket, session_id: str, ticket_value: str) -> None:
    consumed = await consume_ticket(ticket_value, session_id)
    if not consumed: await websocket.close(code=4401, reason="invalid_ticket"); return
    ticket, session = consumed; role = ticket["role"]
    if not await hub.add(session_id, role, websocket): await websocket.close(code=4409, reason="role_already_connected"); return
    await websocket.accept()
    try:
        relay = await issue_relay_credentials(session, ticket["device_id"], role)
        await websocket.send_json({"type": "ready", "sessionId": session_id, "generation": session["generation"], "role": role, "relay": relay})
        await hub.flush(session_id, role, websocket)
        sequence = -1; ice_count = 0; last_relay_refresh: float | None = None
        while True:
            raw = await asyncio.wait_for(websocket.receive_text(), timeout=120)
            message, ice_count = validate_message(raw, role, session["generation"], sequence, ice_count); sequence = message["sequence"]
            current = await db.family_assist_sessions.find_one({"session_id": session_id}, {"_id": 0, "state": 1, "generation": 1, "relationship_id": 1, "relationship_generation": 1, "sharer_owner_id": 1, "helper_owner_id": 1, "sharer_device_id": 1, "helper_device_id": 1})
            if not current or current["generation"] != session["generation"] or current["state"] in {"ended", "expired", "revoked", "failed"}: break
            await require_current_relationship(current)
            if message["type"] == "relay_refresh":
                now_mono = asyncio.get_running_loop().time()
                if last_relay_refresh is not None and now_mono - last_relay_refresh < 300:
                    raise ValueError("relay_refresh_rate_limited")
                last_relay_refresh = now_mono
                refreshed = await issue_relay_credentials(session, ticket["device_id"], role)
                await websocket.send_json({"type": "relay_credentials", "generation": session["generation"], "relay": refreshed})
                continue
            await hub.forward(session_id, role, raw)
    except RelayCredentialError:
        try: await websocket.close(code=1013, reason="relay_unavailable")
        except RuntimeError: pass
    except (WebSocketDisconnect, asyncio.TimeoutError, ValueError, json.JSONDecodeError):
        pass
    finally:
        await hub.remove(session_id, role, websocket)
        try: await websocket.close(code=1000)
        except RuntimeError: pass