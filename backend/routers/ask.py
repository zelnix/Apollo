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
            yield f"data: {json.dumps({'error': 'Apollo could not answer right now.'})}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/ask/history", response_model=list[AskMessage])
async def ask_history(device_id: str = Query(min_length=8, max_length=64)):
    docs = await db.ask_messages.find({"device_id": device_id}).sort("created_at", 1).to_list(200)
    return [AskMessage.from_mongo(d) for d in docs]


@router.delete("/ask/history")
async def clear_ask_history(device_id: str = Query(min_length=8, max_length=64)):
    result = await db.ask_messages.delete_many({"device_id": device_id})
    return {"deleted": result.deleted_count}
