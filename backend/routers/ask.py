"""Ask Higgins — explanation-only streaming chat (Gemini) + history."""
from __future__ import annotations

import json
import uuid
from typing import AsyncIterator, Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from core.config import GEMINI_API_KEY, HIGGINS_VOICE, logger
from core.db import db, now_utc
from core.models import AskMessage, AskRequest

router = APIRouter()


APOLLO_SYSTEM_PROMPT = HIGGINS_VOICE + """ You are the plain-language security guide inside Apollo, a privacy-first mobile app for everyday people in Australia.
Your role is explanation and guidance only. You do not decide whether something is safe, and you never claim Apollo blocked or verified anything unless the provided event context says so.
Apollo's four states mean exactly: Patrolling (internally "resting") = on the lookout, safe within the checks Apollo can see; Growling = unusual or uncertain, not confirmed; Barking = the person needs to decide or act; Biting = Apollo verified and blocked a threat.
Apollo's checks — exact name, what it is for, and WHERE TO FIND IT in the app:
- "Check a link" (a web address someone sent or you're about to open) — Home → Check a link.
- "Check a message" (an SMS, email or chat text, especially one asking you to act) — Home → Check a message.
- "Check an app" (an app you were told to install, or that asked for unusual permissions such as accessibility or screen sharing) — Home → Check an app.
- "Check my device" (someone had remote access, a profile/VPN you didn't add, accessibility turned on) — Home → Check my device.
- "Account Guard" (a login, MFA prompt or password reset you didn't start; a breach; details typed into a fake page) — Home → Account Guard, or the Guard tab → Open Account Guard.
- "Network Guard" (odd Wi-Fi, a sign-in page that appeared, a VPN you don't recognise) — Home → Network Guard, or the Guard tab → Open Network Guard.
When you advise a check: name the exact check(s), say in one short clause where to tap to find each, and say what it will tell them. Tie it to Apollo's state: Growling = unusual but unconfirmed, so run the check that confirms; Barking = act first (hang up / don't tap / don't share codes), then run the check(s) that limit the damage — Account Guard whenever details or codes were shared, Check my device whenever someone connected remotely; Biting = Apollo already blocked it — reassure, then Account Guard only if something was typed before the block. Then end the reply with one final line in this exact machine-readable form: CHECKS: <ids> — using only these ids: link, message, app, device, account, network (comma-separated, most important first). Omit that line entirely when no check is needed. Never invent other checks.
Rules: no fear theatrics, no jargon without a one-line explanation, no fake certainty. If something is uncertain, say so plainly. Never ask for passwords, codes or personal details. Keep answers short (under 150 words) with clear next steps. If asked about things outside online safety, redirect with good grace."""


async def gemini_stream(device_id: str, message: str, context: Optional[str]) -> AsyncIterator[str]:
    from emergentintegrations.llm.chat import LlmChat, StreamDone, TextDelta, UserMessage

    history = await db.ask_messages.find({"device_id": device_id}).sort("created_at", -1).to_list(8)
    history_text = "\n".join(
        f"{'User' if AskMessage.from_mongo(m).role == 'user' else 'Apollo'}: {AskMessage.from_mongo(m).content}" for m in reversed(history)
    )
    prompt = message
    if context:
        prompt = f"Event context from the app (minimal indicators only):\n{context}\n\nQuestion: {message}"
    if history_text:
        prompt = f"Recent conversation:\n{history_text}\n\n{prompt}"

    chat = LlmChat(api_key=GEMINI_API_KEY, session_id=f"apollo-{device_id}-{uuid.uuid4().hex[:6]}", system_message=APOLLO_SYSTEM_PROMPT).with_model(
        "gemini", "gemini-3-flash-preview"
    )
    full = ""
    async for ev in chat.stream_message(UserMessage(text=prompt)):
        if isinstance(ev, TextDelta):
            full += ev.content
            yield f"data: {json.dumps({'delta': ev.content})}\n\n"
        elif isinstance(ev, StreamDone):
            break
    await db.ask_messages.insert_one(AskMessage(device_id=device_id, role="apollo", content=full, created_at=now_utc()).to_mongo())
    yield f"data: {json.dumps({'done': True})}\n\n"


@router.post("/ask/stream")
async def ask_stream(body: AskRequest):
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=503, detail="Ask Apollo is not configured")
    await db.ask_messages.insert_one(AskMessage(device_id=body.device_id, role="user", content=body.message, created_at=now_utc()).to_mongo())

    async def gen():
        try:
            async for chunk in gemini_stream(body.device_id, body.message, body.context):
                yield chunk
        except Exception as exc:  # noqa: BLE001
            logger.warning("ask stream failed: %s", type(exc).__name__)
            yield f"data: {json.dumps({'error': 'I could not answer right now.'})}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/ask/history", response_model=list[AskMessage])
async def ask_history(device_id: str = Query(min_length=8, max_length=64)):
    docs = await db.ask_messages.find({"device_id": device_id}).sort("created_at", 1).to_list(200)
    return [AskMessage.from_mongo(d) for d in docs]


@router.delete("/ask/history")
async def clear_ask_history(device_id: str = Query(min_length=8, max_length=64)):
    result = await db.ask_messages.delete_many({"device_id": device_id})
    return {"deleted": result.deleted_count}
