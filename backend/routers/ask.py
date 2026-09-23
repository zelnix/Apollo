"""Ordinary Higgins chat and typed owner context.

These routes never import or call the investigation coordinator. A case begins only through the
separate `/investigations` API after an explicit user action in the client.
"""
from __future__ import annotations

import json
import re
import uuid
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
    turn_id: str = Field(default_factory=lambda: str(uuid.uuid4()), min_length=8, max_length=80, pattern=r"^[A-Za-z0-9._:-]+$")
    message: str = Field(min_length=1, max_length=4000)
    conversation_id: str = Field(default_factory=lambda: str(uuid.uuid4()), min_length=4, max_length=80)
    previous_turn_ids: list[str] = Field(default_factory=list, max_length=8)
    selected_patrol_record_id: str | None = Field(default=None, max_length=100)
    selected_report_id: str | None = Field(default=None, max_length=100)


@router.post("/higgins/chat", response_model=chat.ChatReply)
async def higgins_chat(body: ChatRequest, request: Request):
    owner = request.state.device["device_id"]
    try:
        result = await chat.reply(owner, body.conversation_id, body.turn_id, body.message, body.previous_turn_ids,
                                  body.selected_patrol_record_id, body.selected_report_id)
    except chat.provider.ProviderFailure as exc:
        from fastapi import HTTPException
        raise HTTPException(status_code=503, detail="Higgins is temporarily unavailable. No investigation was started.") from exc
    return JSONResponse(result.wire(), headers=NO_STORE)


@router.post("/ask/stream")
async def ask_stream(body: ChatRequest, request: Request):
    """Compatibility SSE transport with ordinary-chat semantics and no case side effect."""
    result = await chat.reply(request.state.device["device_id"], body.conversation_id, body.turn_id, body.message, body.previous_turn_ids,
                              body.selected_patrol_record_id, body.selected_report_id)
    async def events():
        yield f"data: {json.dumps({'delta': result.answer, 'clarification': result.clarification, 'suggested_actions': [a.wire() for a in result.suggested_actions], 'investigative_work_started': False})}\n\n"
        yield f"data: {json.dumps({'done': True, 'provider_complete': True, 'finish_reason': 'STOP', 'investigative_work_started': False})}\n\n"
    return StreamingResponse(events(), media_type="text/event-stream", headers={**NO_STORE, "X-Accel-Buffering": "no"})


@router.get("/ask/history")
async def ask_history(request: Request, device_id: str = Query(min_length=8, max_length=64)):
    del device_id
    owner = request.state.device["device_id"]
    return JSONResponse([item.wire() for item in await memory.chat_history(owner)], headers=NO_STORE)


@router.get("/higgins/chat/history")
async def higgins_chat_history(request: Request, device_id: str = Query(min_length=8, max_length=64)):
    del device_id
    owner = request.state.device["device_id"]
    return JSONResponse({"items": [item.wire() for item in await memory.chat_history(owner)], "receipts": await memory.chat_receipts(owner), "kind": "ordinary_chat"}, headers=NO_STORE)


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
async def higgins_history(request: Request, limit: int = Query(default=25, ge=1, le=100), cursor: str | None = None,
                          status: str | None = None, gate: str | None = None, search: str | None = None):
    owner = request.state.device["device_id"]
    items: list[dict] = []
    history_query: dict = {"owner_id": owner, "deleted": False}
    if cursor:
        try:
            from datetime import datetime
            history_query["last_update"] = {"$lt": datetime.fromisoformat(cursor.replace("Z", "+00:00"))}
        except ValueError:
            pass
    if status:
        history_query["status"] = status
    if gate:
        history_query["gates"] = gate
    if search:
        history_query["conclusion"] = {"$regex": re.escape(search[:80]), "$options": "i"}
    history_rows = await db.higgins_investigation_history.find(history_query, {"_id": 0}).sort("last_update", -1).limit(limit + 1).to_list(limit + 1)
    for row in history_rows[:limit]:
        items.append({"id": row["history_id"], "kind": "investigation", "title": f"{(row.get('gates') or ['Apollo'])[0].title()} Gate investigation",
                      "summary": redact_investigation_secrets(row.get("conclusion", ""))[:300], "status": row.get("status", "completed"),
                      "occurredAt": row["last_update"], "caseStart": row["case_start"], "lastUpdate": row["last_update"], "gates": row.get("gates", []),
                      "attention": row.get("attention", "unknown"), "conclusion": redact_investigation_secrets(row.get("conclusion", ""))[:600],
                      "caseId": row.get("case_id"), "reportId": None, "reopenable": False})
    cases = await db.investigation_cases.find({"owner_id": owner, "deleted": False}, {"_id": 0, "case_id": 1, "status": 1, "gates": 1, "created_at": 1, "updated_at": 1, "response_revision": 1, "accepted_commits": 1}).sort("updated_at", -1).limit(limit).to_list(limit)
    for case in cases:
        turns = await investigation_repository.accepted_turns(owner, case)
        latest = max(turns, key=lambda turn: turn.committed_at) if turns else None
        summary = redact_investigation_secrets(latest.response.overview)[:300] if latest else "Investigation is still being prepared."
        active = case.get("status") not in {"complete", "expired", "cancelled", "failed"}
        items.append({"id": case["case_id"], "kind": "investigation", "title": f"{(case.get('gates') or ['Apollo'])[0].title()} Gate investigation", "summary": summary,
                      "status": "active" if active else "completed", "occurredAt": case.get("updated_at") or case["created_at"], "caseStart": case["created_at"],
                      "lastUpdate": case.get("updated_at") or case["created_at"], "gates": case.get("gates", []), "attention": latest.response.attention if latest else "unknown",
                      "conclusion": summary, "caseId": case["case_id"], "reportId": None, "reopenable": active})
    reports = await db.investigation_reports.find({"owner_id": owner}, {"_id": 0, "report_id": 1, "saved_at": 1, "report_ciphertext": 1}).sort("saved_at", -1).limit(limit).to_list(limit)
    for row in reports:
        try:
            report = investigation_repository.dec_json(row["report_ciphertext"])
            title = redact_investigation_secrets(str(report.get("title") or report.get("overview") or "Saved investigation report"))[:160]
            summary = redact_investigation_secrets(str(report.get("overview") or "Saved for later review."))[:300]
        except (ValueError, TypeError):
            title, summary = "Saved investigation report", "Saved for later review."
        items.append({"id": row["report_id"], "kind": "saved_report", "title": title, "summary": summary, "status": "saved", "occurredAt": row["saved_at"], "caseStart": row["saved_at"], "lastUpdate": row["saved_at"], "gates": [], "attention": "none", "conclusion": summary, "caseId": None, "reportId": row["report_id"], "reopenable": True})
    deduped = list({f"{item['kind']}:{item.get('caseId') or item['id']}": item for item in items}.values())
    deduped.sort(key=lambda item: item["occurredAt"], reverse=True)
    next_cursor = history_rows[limit - 1]["last_update"].isoformat() if len(history_rows) > limit else None
    return JSONResponse(jsonable_encoder({"items": deduped[:limit], "nextCursor": next_cursor, "redaction": "Secrets and raw evidence are excluded."}), headers=NO_STORE)


@router.delete("/higgins/history/{history_id}", status_code=204)
async def delete_higgins_history(history_id: str, request: Request):
    owner = request.state.device["device_id"]
    changed = await db.higgins_investigation_history.update_one({"owner_id": owner, "history_id": history_id, "deleted": False}, {"$set": {"deleted": True}})
    if not changed.matched_count:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="History item not found.")
    return None


@router.get("/higgins/scams")
async def government_scam_feed(limit: int = Query(default=50, ge=1, le=100)):
    return JSONResponse(jsonable_encoder(await government_alerts.snapshot(limit)), headers=NO_STORE)