"""Ask Higgins — explanation-only streaming chat (Gemini) + history."""
from __future__ import annotations

import asyncio
import json
import re
import uuid
from typing import Any, AsyncIterator, Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pymongo.errors import DuplicateKeyError

from core.config import GEMINI_API_KEY, HIGGINS_VOICE, logger
from core.db import db, now_utc
from core.models import AskIssueContext, AskMessage, AskRequest
from core.redaction import redact_user_secrets

router = APIRouter()


HIGGINS_SYSTEM_PROMPT = HIGGINS_VOICE + """ You are the plain-language security guide inside Apollo, a privacy-first mobile app for everyday people in Australia.
Your role is explanation and guidance only. You do not decide whether something is safe, and you never claim Apollo blocked or verified anything unless the provided event context says so.
Apollo's four states mean exactly: Patrolling (internally "resting") = on the lookout, safe within the checks Apollo can see; Growling = unusual or uncertain, not confirmed; Barking = the person needs to decide or act; Biting = Apollo verified and blocked a threat.
Apollo's checks — exact name, what it is for, and WHERE TO FIND IT in the app:
- "Check a link" (a web address someone sent or you're about to open) — Home → Check a link.
- "Check a message" (an SMS, email or chat text, especially one asking you to act) — Home → Check a message.
- "File Gate" (a selected or shared download or attachment, including cloud-drive files; hosting is not evidence of safety) — Gates → File Gate, or Home → All checks → File Gate.
- "Check an app" (an app you were told to install, or that asked for unusual permissions such as accessibility or screen sharing) — Home → Check an app.
- "Device Gate" (existing apps with powerful access, remote access, a profile/VPN you didn't add, Apollo protection health or changed security settings) — Gates → Device Gate, or Home → All checks → Device Gate.
- "Account Gate" (a login, MFA prompt or password reset you didn't start; a breach; details typed into a fake page) — Home → Account Gate, or the Gates tab → Open Account Gate.
- "Network Gate" (odd Wi-Fi, a sign-in page that appeared, a VPN you don't recognise) — Home → Network Gate, or the Gates tab → Open Network Gate.
When you advise a check: name the exact check(s), say in one short clause where to tap to find each, and say what it will tell them. Tie it to Apollo's behaviour: Growling = possible concern needing caution or investigation; Barking = significant concern, so act first (hang up / don't tap / don't share codes), then run the checks that limit damage — Account Gate whenever details or codes were shared, Device Gate whenever someone connected remotely, and File Gate for a selected or shared download or attachment. Permissions and installed capabilities show what an app could do, not proof it behaved maliciously; inactivity is not proof that its capabilities disappeared. Call something suspected tampering only when the supplied context contains a specific observed high-confidence configuration or permission change. Biting = Apollo confirmed one actual protective block, but that does not prove every other threat is contained. You are Higgins: provide every explanation and recommendation, but never claim that you detect or block. Apollo detects, warns and blocks only where supported and confirmed. Then end the reply with one final line in this exact machine-readable form: CHECKS: <ids> — using only these ids: link, message, file, app, device, account, network (comma-separated, most important first). Omit that line entirely when no check is needed. Never invent other checks.
The issue context is structured. Preserve its provenance: observed evidence, inference and user reports are different. A selected service, alert type or user action is not proof that a sender is genuine, a notice is true, a threat succeeded or an item is safe. Ask only one necessary follow-up when its answer could change the assessment or next action; otherwise explain what Apollo found, what remains unknown and provide one working next action.
The selected issue is already the result of its named Gate. Do not send the person back to the same Gate or claim another check has already run. Do not say File Gate scans for malware, reads a whole file, establishes safety or can tell whether contents are known harmful: it reads only a signature and a bounded supported sample and reports explicit limits. Do not say Account Gate can determine whether login details or codes were compromised: it assesses submitted alert evidence and reported actions, and any breach lookup is a separate explicit action. Never turn a model suggestion into a promise that Apollo can delete an original message/email/file, dial a number, open a destination, suppress future alerts or block traffic. Recommend one truthful action that the current app supports; use independently configured official apps, typed addresses, card/bill contact details or visible in-app instructions rather than contact details from suspicious content. Do not list multiple Gates as a substitute for that action.
Rules: no fear theatrics, no jargon without a one-line explanation, no fake certainty. If something is uncertain, say so plainly. Never ask for, repeat or store a password, login username, PIN, recovery code, verification code, OTP or one-time security code. If the user says they pasted one, tell them it was redacted and give the appropriate account-recovery action without asking them to resend it. Keep answers short (under 150 words) with clear next steps. If asked about things outside online safety, redirect with good grace."""


def _redact_tree(value: Any) -> Any:
    if isinstance(value, str):
        safe = redact_user_secrets(value)
        safe = re.sub(r"\+?\d[\d ()-]{8,}\d", "[phone]", safe)
        return re.sub(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", "[email]", safe, flags=re.I)
    if isinstance(value, list):
        return [_redact_tree(item) for item in value]
    if isinstance(value, dict):
        return {key: _redact_tree(item) for key, item in value.items()}
    return value


def _context_prompt(context: Optional[AskIssueContext]) -> Optional[str]:
    if not context:
        return None
    safe = _redact_tree(context.model_dump())
    return json.dumps(safe, ensure_ascii=False, separators=(",", ":"))


def _safe_handoff_response(context: AskIssueContext) -> str:
    state = context.assessment_state.replace("_", " ")
    evidence = context.findings[0].summary if context.findings else context.issue_summary
    provenance = context.findings[0].provenance if context.findings else "inferred"
    source = {"observed": "observed evidence", "inferred": "Apollo's inference", "user_reported": "your report"}.get(provenance, "available evidence")
    unknown = context.uncertainty[0] if context.uncertainty else "This result does not establish that the item is safe or that a threat succeeded."
    confirmed = f" Apollo confirmed: {context.confirmed_protective_actions[0]}" if context.confirmed_protective_actions else " No protective action was confirmed for this issue."
    reported = f" You reported: {context.user_reported_actions[0]}." if context.user_reported_actions else ""
    action = {
        "file": "Keep the file closed and verify it with the sender through a separate contact method you already trust.",
        "account": "Open the claimed service's official app yourself and review its security activity there; do not use the alert's links or contact details.",
        "email": "Open the claimed service's official app or type its known address yourself; do not use the email's links or contact details.",
        "text": "Contact the claimed sender through a separate number or app you already trust; do not use details from the message.",
        "call": "End the call and contact the organisation using a number from its official app, your card or a bill—not the caller's number.",
        "link": "Leave the link closed and open the claimed service by typing its known address or using its official app.",
        "site": "Leave the site and open the claimed service by typing its known address or using its official app.",
        "app": "Use this result screen's Settings action to review the app's access; remove it if you do not recognise or need it.",
        "device": "Use this result screen's first Settings action and review the named setting; do not change unrelated settings.",
        "network": "Avoid sensitive activity on this network until you can use a network you trust.",
        "incident": "Start with the first recovery step shown in this incident's action plan.",
    }.get(context.gate, "Use the one next action shown on the result screen.")
    return (f"Higgins here. Apollo's {context.gate} check is {state}. From {source}: {evidence}. "
            f"What remains unknown: {unknown}.{confirmed}{reported}\n\nNext action: {action}")


def _guard_handoff_response(text: str, context: AskIssueContext) -> str:
    """A model response is never the executable capability contract.

    Structured handoffs always render from the validated evidence envelope so every issue gets exactly one
    supported action and the same provenance/uncertainty guarantees. The model call still occurs for Higgins'
    investigation lifecycle; unrestricted wording never crosses this final user-facing boundary.
    """
    checks_match = re.search(r"(?im)^\s*CHECKS:\s*([^\n]+)", text)
    checks = [item.strip().lower() for item in checks_match.group(1).split(",")] if checks_match else []
    gate_mentions = set(re.findall(r"\b(site|link|text|message|call|network|account|email|app|file|device) gate\b", text.lower()))
    same_gate = context.gate in checks or context.gate in gate_mentions
    multiple_routes = len(set(checks)) > 1 or len(gate_mentions) > 1
    unsupported = bool(re.search(r"\bI blocked\b|tell you (?:whether|if).{0,40}(?:safe|harmful)|determine.{0,30}(?:compromised|safe)", text, re.I | re.S))
    if context.gate == "file" and re.search(r"file gate.{0,100}(?:scan|malware|known to be harmful|safe)", text, re.I | re.S):
        unsupported = True
    _ = (same_gate, multiple_routes, unsupported)  # retained as audit signals for future telemetry
    return _safe_handoff_response(context)


async def _claim_handoff(device_id: str, handoff_id: str) -> tuple[str, Optional[str]]:
    existing = await db.ask_handoffs.find_one({"device_id": device_id, "handoff_id": handoff_id}, {"_id": 0})
    if existing and existing.get("status") == "completed" and existing.get("response"):
        return "completed", str(existing["response"])
    if existing and existing.get("status") == "processing":
        return "processing", None
    try:
        result = await db.ask_handoffs.update_one(
            {"device_id": device_id, "handoff_id": handoff_id, "status": {"$ne": "processing"}},
            {"$set": {"device_id": device_id, "handoff_id": handoff_id, "status": "processing", "response": None, "updated_at": now_utc()}},
            upsert=True,
        )
        if result.upserted_id or result.modified_count:
            return "claimed", None
    except DuplicateKeyError:
        pass
    raced = await db.ask_handoffs.find_one({"device_id": device_id, "handoff_id": handoff_id}, {"_id": 0})
    if raced and raced.get("status") == "completed" and raced.get("response"):
        return "completed", str(raced["response"])
    return "processing", None


async def gemini_stream(device_id: str, message: str, context: Optional[AskIssueContext], conversation_id: str,
                        handoff_id: Optional[str]) -> AsyncIterator[str]:
    from emergentintegrations.llm.chat import LlmChat, StreamDone, TextDelta, UserMessage

    history = await db.ask_messages.find({"device_id": device_id, "conversation_id": conversation_id}).sort("created_at", -1).to_list(8)
    history_text = "\n".join(
        # Apollo is the dog; he doesn't talk. Prior assistant turns are Higgins speaking — label
        # the history the same way we ask the model to speak, so it never gets confused about who
        # said what (see HIGGINS_VOICE: "Refer to Apollo... in the third person").
        f"{'User' if AskMessage.from_mongo(m).role == 'user' else 'Higgins'}: {AskMessage.from_mongo(m).content}" for m in reversed(history)
    )
    prompt = message
    context_text = _context_prompt(context)
    if context_text:
        prompt = f"Selected issue context from Apollo (bounded structured evidence; preserve provenance):\n{context_text}\n\nQuestion: {message}"
    if history_text:
        prompt = f"Recent conversation:\n{history_text}\n\n{prompt}"

    chat = LlmChat(api_key=GEMINI_API_KEY, session_id=f"apollo-{device_id}-{uuid.uuid4().hex[:6]}", system_message=HIGGINS_SYSTEM_PROMPT).with_model(
        "gemini", "gemini-3-flash-preview"
    )
    full = ""
    buffered = context is not None
    async for ev in chat.stream_message(UserMessage(text=prompt)):
        if isinstance(ev, TextDelta):
            full += ev.content
            if not buffered:
                yield f"data: {json.dumps({'delta': ev.content})}\n\n"
        elif isinstance(ev, StreamDone):
            break
    if not full.strip():
        raise RuntimeError("empty Higgins response")
    safe_full = redact_user_secrets(_guard_handoff_response(full, context) if context else full)
    if buffered:
        yield f"data: {json.dumps({'delta': safe_full})}\n\n"
    await db.ask_messages.insert_one(AskMessage(device_id=device_id, role="higgins", content=safe_full, created_at=now_utc(),
                                                conversation_id=conversation_id, handoff_id=handoff_id).to_mongo())
    if handoff_id:
        await db.ask_handoffs.update_one({"device_id": device_id, "handoff_id": handoff_id},
                                         {"$set": {"status": "completed", "response": safe_full, "updated_at": now_utc()}})
    yield f"data: {json.dumps({'done': True})}\n\n"


@router.post("/ask/stream")
async def ask_stream(body: AskRequest):
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=503, detail="Ask Higgins is not configured")
    if body.handoff_id and body.conversation_id != body.handoff_id:
        raise HTTPException(status_code=422, detail="A handoff must use its own conversation id")
    safe_message = redact_user_secrets(body.message)
    if body.handoff_id:
        state, cached = await _claim_handoff(body.device_id, body.handoff_id)
        if state == "completed":
            async def cached_gen():
                yield f"data: {json.dumps({'delta': cached})}\n\n"
                yield f"data: {json.dumps({'done': True})}\n\n"
            return StreamingResponse(cached_gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
        if state == "processing":
            async def processing_gen():
                yield f"data: {json.dumps({'error': 'Higgins is already answering this issue.'})}\n\n"
            return StreamingResponse(processing_gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
    previous = await db.ask_messages.find_one({"device_id": body.device_id, "handoff_id": body.handoff_id, "role": "user"}, {"_id": 0}) if body.handoff_id else None
    if not previous:
        await db.ask_messages.insert_one(AskMessage(device_id=body.device_id, role="user", content=safe_message, created_at=now_utc(),
                                                    conversation_id=body.conversation_id, handoff_id=body.handoff_id).to_mongo())

    async def gen():
        try:
            async for chunk in gemini_stream(body.device_id, safe_message, body.context, body.conversation_id, body.handoff_id):
                yield chunk
        except asyncio.CancelledError:
            if body.handoff_id:
                await db.ask_handoffs.update_one({"device_id": body.device_id, "handoff_id": body.handoff_id},
                                                 {"$set": {"status": "failed", "updated_at": now_utc()}})
            raise
        except Exception as exc:  # noqa: BLE001
            logger.warning("ask stream failed: %s", type(exc).__name__)
            if body.handoff_id:
                await db.ask_handoffs.update_one({"device_id": body.device_id, "handoff_id": body.handoff_id},
                                                 {"$set": {"status": "failed", "updated_at": now_utc()}})
            yield f"data: {json.dumps({'error': 'I could not answer right now.'})}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/ask/history", response_model=list[AskMessage], response_model_by_alias=False)
async def ask_history(device_id: str = Query(min_length=8, max_length=64)):
    docs = await db.ask_messages.find({"device_id": device_id}).sort("created_at", 1).to_list(200)
    return [AskMessage.from_mongo(d) for d in docs]


@router.delete("/ask/history")
async def clear_ask_history(device_id: str = Query(min_length=8, max_length=64)):
    result = await db.ask_messages.delete_many({"device_id": device_id})
    return {"deleted": result.deleted_count}
