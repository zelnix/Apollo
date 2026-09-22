"""Ordinary Higgins chat and typed owner context.

These routes never import or call the investigation coordinator. A case begins only through the
separate `/investigations` API after an explicit user action in the client.
"""
from __future__ import annotations

import json
from fastapi import APIRouter, Query, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import Field

from services.higgins import chat
from services.higgins import context as memory
from services.higgins.contracts import Wire
from services.higgins import repository as investigation_repository
from services import government_alerts
from core.db import db
from core.redaction import redact_investigation_secrets

router = APIRouter()
NO_STORE = {"Cache-Control": "private, no-store", "Pragma": "no-cache"}


class ChatRequest(Wire):
    message: str = Field(min_length=1, max_length=4000)
    conversation_id: str = Field(min_length=4, max_length=80)


@router.post("/higgins/chat", response_model=chat.ChatReply)
async def higgins_chat(body: ChatRequest, request: Request):
    owner = request.state.device["device_id"]
    return JSONResponse((await chat.reply(owner, body.conversation_id, body.message)).wire(), headers=NO_STORE)


@router.post("/ask/stream")
async def ask_stream(body: ChatRequest, request: Request):
    """Compatibility SSE transport with ordinary-chat semantics and no case side effect."""
    result = await chat.reply(request.state.device["device_id"], body.conversation_id, body.message)
    async def events():
        yield f"data: {json.dumps({'delta': result.answer, 'clarification': result.clarification, 'action': result.action.wire() if result.action else None, 'investigative_work_started': False})}\n\n"
        yield f"data: {json.dumps({'done': True, 'provider_complete': True, 'finish_reason': 'STOP', 'investigative_work_started': False})}\n\n"
    return StreamingResponse(events(), media_type="text/event-stream", headers={**NO_STORE, "X-Accel-Buffering": "no"})


@router.get("/ask/history")
async def ask_history(request: Request, device_id: str = Query(min_length=8, max_length=64)):
    del device_id
    return JSONResponse({"items": [item.wire() for item in await memory.chat_history(request.state.device["device_id"])], "kind": "ordinary_chat"}, headers=NO_STORE)


@router.delete("/ask/history")
async def clear_ask_history(request: Request, device_id: str = Query(min_length=8, max_length=64)):
    del device_id
    return {"deleted": await memory.clear_chat(request.state.device["device_id"]), "investigations_deleted": 0}


@router.get("/higgins/context")
async def higgins_context(request: Request):
    return JSONResponse({"items": [item.wire() for item in await memory.current(request.state.device["device_id"])], "scope": "owner_only"}, headers=NO_STORE)


@router.post("/higgins/context", status_code=201)
async def add_higgins_context(body: memory.ContextWrite, request: Request):
    return JSONResponse({"item": (await memory.put(request.state.device["device_id"], body)).wire()}, status_code=201, headers=NO_STORE)


@router.delete("/higgins/context")
async def clear_higgins_context(request: Request):
    return {"deleted": await memory.clear(request.state.device["device_id"])}


@router.get("/higgins/history")
async def higgins_history(request: Request, limit: int = Query(default=50, ge=1, le=100)):
    owner = request.state.device["device_id"]
    items: list[dict] = []
    chats = await memory.chat_history(owner, limit=limit)
    for item in chats:
        if item.role == "higgins":
            items.append({"id": item.id, "kind": "ordinary_chat", "title": "Chat with Higgins", "summary": redact_investigation_secrets(item.content)[:300], "status": "handled", "occurredAt": item.created_at, "caseId": None, "reportId": None})
    cases = await db.investigation_cases.find({"owner_id": owner, "deleted": False}, {"_id": 0, "case_id": 1, "status": 1, "gates": 1, "created_at": 1, "updated_at": 1, "response_revision": 1, "accepted_commits": 1}).sort("updated_at", -1).limit(limit).to_list(limit)
    for case in cases:
        turns = await investigation_repository.accepted_turns(owner, case)
        latest = max(turns, key=lambda turn: turn.committed_at) if turns else None
        summary = redact_investigation_secrets(latest.response.overview)[:300] if latest else "Investigation is still being prepared."
        active = case.get("status") not in {"complete", "expired", "cancelled", "failed"}
        items.append({"id": case["case_id"], "kind": "investigation", "title": f"{(case.get('gates') or ['Apollo'])[0].title()} Gate investigation", "summary": summary,
                      "status": "active" if active else "handled", "occurredAt": case.get("updated_at") or case["created_at"], "caseId": case["case_id"], "reportId": None})
    reports = await db.investigation_reports.find({"owner_id": owner}, {"_id": 0, "report_id": 1, "saved_at": 1, "report_ciphertext": 1}).sort("saved_at", -1).limit(limit).to_list(limit)
    for row in reports:
        try:
            report = investigation_repository.dec_json(row["report_ciphertext"])
            title = redact_investigation_secrets(str(report.get("title") or report.get("overview") or "Saved investigation report"))[:160]
            summary = redact_investigation_secrets(str(report.get("overview") or "Saved for later review."))[:300]
        except (ValueError, TypeError):
            title, summary = "Saved investigation report", "Saved for later review."
        items.append({"id": row["report_id"], "kind": "saved_report", "title": title, "summary": summary, "status": "handled", "occurredAt": row["saved_at"], "caseId": None, "reportId": row["report_id"]})
    items.sort(key=lambda item: item["occurredAt"], reverse=True)
    return JSONResponse(jsonable_encoder({"items": items[:limit], "redaction": "Secrets and raw evidence are excluded."}), headers=NO_STORE)


@router.get("/higgins/scams")
async def government_scam_feed(limit: int = Query(default=50, ge=1, le=100)):
    return JSONResponse(jsonable_encoder(await government_alerts.snapshot(limit)), headers=NO_STORE)