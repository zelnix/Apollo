"""Compatibility Ask transport adapted to the shared investigation engine (one engine; spec §3).

`/ask/stream` creates or continues a case for the conversation and streams the committed Higgins response.
History and deletion are derived from accepted turn bundles of the owner's cases.
"""
from __future__ import annotations

import asyncio
import json
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import StreamingResponse

from core.db import db, now_utc
from core.models import AskIssueContext, AskMessage, AskRequest
from core.redaction import redact_investigation_secrets
from routers.investigations import _submit_turn
from services.higgins import evidence as ev
from services.higgins import repository as repo
from services.higgins.contracts import SubmitTurn
from services.higgins.encryption import cipher

router = APIRouter()


def _event(value: dict) -> str:
    return f"data: {json.dumps(value)}\n\n"


def _findings(context: Optional[AskIssueContext]) -> list[str]:
    if not context:
        return []
    return [f"Apollo {context.gate} check summary: {context.issue_summary} (state {context.assessment_state})",
            *(f"{f.provenance} ({f.status}): {f.summary}" for f in context.findings), *(f"Uncertain: {u}" for u in context.uncertainty),
            *(f"Confirmed protective action: {a}" for a in context.confirmed_protective_actions), *(f"User reported action: {a}" for a in context.user_reported_actions)]


async def _case_for(owner: str, body: AskRequest) -> dict:
    mapping = await db.investigation_idempotency.find_one({"owner_id": owner, "operation": "conversation", "key_digest": repo.digest(f"{owner}:conversation:{body.conversation_id}")}, {"_id": 0})
    if mapping:
        try:
            return await repo.get_case(owner, mapping["result"]["caseId"], for_mutation=True)
        except HTTPException as exc:
            if exc.status_code != 410:
                raise
    gate = body.context.gate if body.context and body.context.gate != "incident" else None
    case = await repo.create_case(owner, gate, None)
    for index, finding in enumerate(_findings(body.context)):
        await ev.ingest_text(owner, case, f"apollo-finding-{index}", finding, origin="apollo_inference", label="Apollo initial finding", coverage=ev.Coverage(status="examined", unit="items", total=1, examined=1))
    await db.investigation_idempotency.update_one({"owner_id": owner, "operation": "conversation", "key_digest": repo.digest(f"{owner}:conversation:{body.conversation_id}")},
                                                  {"$set": {"payload_digest": "", "result": {"caseId": case["case_id"]}, "expires_at": repo.utc(case["expires_at"])}}, upsert=True)
    return case


@router.post("/ask/stream")
async def ask_stream(body: AskRequest, request: Request):
    owner = request.state.device["device_id"]
    cipher()
    case = await _case_for(owner, body)
    turn_id = body.turn_id or str(uuid.uuid4())
    job = await _submit_turn(owner, case, SubmitTurn(expected_revision=case["revision"], turn_id=turn_id, message=redact_investigation_secrets(body.message)), f"ask:{turn_id}")

    async def gen():
        sequence = 0
        deadline = repo.utc(job["deadline_at"])
        try:
            while now_utc() < deadline:
                for event in await repo.events_after(owner, job["job_id"], sequence):
                    sequence = event["sequence"]
                    payload = event["payload"]
                    if event["type"] == "progress":
                        yield _event({"progress": payload["message"]})
                    elif event["type"] == "response":
                        response = payload["response"]
                        text = response["overview"] + "\n\n" + response["explanationMarkdown"]
                        if response.get("question"):
                            text += "\n\n" + response["question"]["text"]
                        yield _event({"delta": text, "case_id": case["case_id"], "revision": response["revision"], "completion": response["completion"]})
                    elif event["type"] == "completed":
                        yield _event({"done": True, "turn_id": turn_id, "provider_complete": True, "finish_reason": "STOP", "case_id": case["case_id"]})
                        return
                    elif event["type"] in ("failed", "cancelled", "expired"):
                        yield _event({"error": payload.get("message", "Higgins did not complete this answer."), "failure_kind": payload.get("code", event["type"])})
                        return
                    elif event["type"] == "device_request":
                        yield _event({"error": "Higgins needs a device observation this transport cannot supply. Use the Ask Higgins screen.", "failure_kind": "device_unavailable"})
                        return
                await asyncio.sleep(0.5)
            yield _event({"error": "The work slice ended before Higgins completed this answer. Retry this question.", "failure_kind": "transport_interrupted"})
        except asyncio.CancelledError:
            raise
    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "private, no-store", "X-Accel-Buffering": "no"})


@router.get("/ask/history", response_model=list[AskMessage], response_model_by_alias=False)
async def ask_history(request: Request, device_id: str = Query(min_length=8, max_length=64)):
    owner = request.state.device["device_id"]
    messages: list[AskMessage] = []
    async for case in db.investigation_cases.find({"owner_id": owner, "deleted": False, "expires_at": {"$gt": now_utc()}}, {"_id": 0}).sort("created_at", 1):
        for turn in await repo.accepted_turns(owner, case):
            messages.append(AskMessage(id=f"u-{turn.turn_id}", device_id=owner, role="user", content=turn.question, created_at=turn.committed_at, conversation_id=case["case_id"], expires_at=repo.utc(case["expires_at"])))
            messages.append(AskMessage(id=f"h-{turn.turn_id}", device_id=owner, role="higgins", content=turn.response.overview + "\n\n" + turn.response.explanation_markdown, created_at=turn.committed_at, conversation_id=case["case_id"], expires_at=repo.utc(case["expires_at"])))
    return messages


@router.delete("/ask/history")
async def clear_ask_history(request: Request, device_id: str = Query(min_length=8, max_length=64)):
    owner = request.state.device["device_id"]
    count = 0
    async for case in db.investigation_cases.find({"owner_id": owner, "deleted": False}, {"_id": 0, "case_id": 1}):
        await repo.revoke(owner, case["case_id"], "deleted")
        await repo.run_cleanup(owner, case["case_id"])
        count += 1
    for name in ("ask_messages", "ask_handoffs"):
        await db[name].delete_many({"device_id": owner})
    return {"deleted": count, "temporary_content_invalidated": True}
