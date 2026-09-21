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

HANDOFF_SYSTEM_PROMPT = """\nThis is a structured issue handoff. Never state that Apollo can, will or does determine, confirm or tell whether something is safe, harmful or compromised. Never state that Apollo has confirmed or determined safety, harm or compromise. Apollo reports only supplied observations and bounded inferences. Do not claim safety, compromise, deletion, dialling, blocking or enforcement unless the structured context explicitly confirms it. Investigate and explain only Apollo's supplied findings and the person's question. Do not output CHECKS and do not send the person back through a Gate that already ran. Keep observed evidence, Apollo inference and the person's report distinct. When the context includes uncertainty items, incorporate them using explicit uncertainty language such as cannot, uncertain, unknown, not confirmed, not established, limited, not inspected, no evidence or remains unverified. State what Apollo's bounded checks cannot determine. End with exactly one concrete, supported next action. Make the final sentence an imperative instruction beginning with a clear action verb such as Keep, Open, Contact, Review, Remove, Avoid, Change, Delete, Verify, Disable, Turn, Return, Deny or End. Never invent app controls, Settings icons, toggles or navigation paths that are not named in the structured context. When available_actions are supplied, use their labels and instructions as the complete set of supported in-app actions. When an exact control is unavailable, direct the person to the visible action on the Gate result screen. For File issues, explain only the supplied signature/sample findings and limits; never describe additional File Gate capabilities. Do not use Apollo mascot-state phrases such as 'Apollo is growling' or 'Apollo is resting'. Use your own wording; do not copy a canned template."""


class HandoffContractError(ValueError):
    def __init__(self, failures: list[str]):
        self.failures = failures
        super().__init__(f"Higgins response did not meet the structured handoff contract: {','.join(failures)}")


class HigginsAnswerUnavailable(RuntimeError):
    def __init__(self, kind: str):
        self.kind = kind
        super().__init__(kind)


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


def _guard_handoff_response(text: str, context: AskIssueContext, *, require_uncertainty: bool = True, require_action: bool = True) -> str:
    """Reject unsafe or ungrounded model output; never substitute an injected answer."""
    checks_match = re.search(r"(?im)^\s*CHECKS:\s*([^\n]+)", text)
    checks = [item.strip().lower() for item in checks_match.group(1).split(",")] if checks_match else []
    same_gate = context.gate in checks
    multiple_routes = len(set(checks)) > 1
    unsupported = bool(re.search(r"\bI blocked\b|\bApollo is (?:growling|barking|resting|biting)|\b(?:settings icon.{0,30}top corner|background patrolling toggle)\b|\b(?:can|will|does) (?:tell|determine|confirm).{0,50}(?:safe|harmful|compromised)|\b(?:has|have) (?:confirmed|determined).{0,40}(?:safe|harmful|compromised)", text, re.I | re.S))
    uncertainty_present = bool(re.search(r"\b(unknown|uncertain|cannot|can't|could not|couldn't|not confirmed|not establish(?:ed)?|not prove(?:n)?|limited|only.{0,40}inspect(?:ed|ion)|not inspected|no evidence|remain(?:s)? unverified)\b", text, re.I | re.S))
    complete_sentence = bool(re.search(r"[.!?][\"')\]]?\s*$", text))
    final_sentence = re.split(r"(?<=[.!?])\s+", text.strip())[-1]
    action_present = bool(re.search(r"\b(next|do|open|keep|leave|contact|review|remove|avoid|use|check|change|deny|end|delete|verify|disable|enable|tap|navigate|turn|uninstall|return|follow|choose|close|stop|disconnect|lock|update|protect|seek)\b", final_sentence, re.I))
    if not action_present and context.available_actions:
        answer_words = set(re.findall(r"[a-z]{5,}", text.lower()))
        grounded_words = set(re.findall(r"[a-z]{5,}", " ".join(f"{item.label} {item.instruction}" for item in context.available_actions).lower()))
        action_present = len(answer_words & grounded_words) >= 2
    failures = []
    if same_gate: failures.append("same_gate_check")
    if multiple_routes: failures.append("multiple_check_routes")
    if unsupported: failures.append("unsupported_capability_claim")
    if not complete_sentence: failures.append("truncated_response")
    if require_uncertainty and context.uncertainty and not uncertainty_present: failures.append("missing_uncertainty")
    if require_action and not action_present: failures.append("missing_action")
    if failures:
        raise HandoffContractError(failures)
    return text.strip()


async def _grounded_handoff_answer(device_id: str, prompt: str, system_prompt: str, context: AskIssueContext,
                                   *, require_uncertainty: bool, require_action: bool) -> str:
    """Retry real Gemini output once when transport or grounding validation fails; never replace it."""
    from emergentintegrations.llm.chat import LlmChat, StreamDone, TextDelta, UserMessage

    last_kind = "provider_failure"
    correction = ""
    for attempt in range(2):
        chunks: list[str] = []
        chat = (LlmChat(api_key=GEMINI_API_KEY, session_id=f"apollo-{device_id}-{uuid.uuid4().hex[:6]}", system_message=system_prompt)
                .with_model("gemini", "gemini-3-flash-preview").with_params(temperature=0.1 if attempt == 0 else 0, max_tokens=1200))

        async def consume() -> None:
            async for event in chat.stream_message(UserMessage(text=prompt + correction)):
                if isinstance(event, TextDelta):
                    chunks.append(event.content)
                elif isinstance(event, StreamDone):
                    break

        try:
            await asyncio.wait_for(consume(), timeout=40)
            raw = "".join(chunks).strip()
            if not raw:
                last_kind = "empty_response"
                correction = "\n\nThe previous attempt was empty. Answer the original question now and follow every structured handoff rule."
                continue
            return redact_user_secrets(_guard_handoff_response(raw, context, require_uncertainty=require_uncertainty, require_action=require_action))
        except HandoffContractError as exc:
            last_kind = "contract_rejected"
            logger.warning("Higgins handoff attempt %s rejected: %s", attempt + 1, ",".join(exc.failures))
            correction = ("\n\nThe previous attempt was rejected for: " + ", ".join(exc.failures) + ". " +
                          ("Include explicit uncertainty language: cannot, uncertain, unknown, not confirmed, not established or limited. " if "missing_uncertainty" in exc.failures else "") +
                          ("End with one imperative using open, keep, contact, review, remove, avoid, check, change, delete, verify, disable, turn or return. " if "missing_action" in exc.failures else "") +
                          ("Do not claim Apollo can, will or does determine, confirm or tell whether something is safe, harmful or compromised. Explain only what Apollo observed or inferred; never claim Apollo has the capability to determine safety or harm. " if "unsupported_capability_claim" in exc.failures else "") +
                          ("Finish the entire response and end with complete punctuation. " if "truncated_response" in exc.failures else "") +
                          "Use only supplied evidence and available_actions; do not copy this instruction into the answer.")
        except asyncio.TimeoutError:
            last_kind = "provider_timeout"
            logger.warning("Higgins handoff attempt %s timed out", attempt + 1)
            correction = "\n\nThe previous attempt timed out. Give one concise grounded answer under 120 words."
        except Exception as exc:  # noqa: BLE001
            last_kind = "provider_failure"
            logger.warning("Higgins handoff attempt %s failed: %s", attempt + 1, type(exc).__name__)
            correction = "\n\nThe previous attempt failed. Give one concise grounded answer under 120 words."
        finally:
            chunks.clear()
    raise HigginsAnswerUnavailable(last_kind)


async def _claim_handoff(device_id: str, handoff_id: str) -> tuple[str, Optional[str]]:
    existing = await db.ask_handoffs.find_one({"device_id": device_id, "handoff_id": handoff_id}, {"_id": 0})
    if existing and existing.get("status") == "completed" and existing.get("response"):
        return "completed", str(existing["response"])
    if existing and existing.get("status") == "processing":
        return "processing", None
    try:
        result = await db.ask_handoffs.update_one(
            {"device_id": device_id, "handoff_id": handoff_id, "status": {"$ne": "processing"}},
            {"$set": {"device_id": device_id, "handoff_id": handoff_id, "status": "processing", "response": None, "failure_kind": None, "updated_at": now_utc()}},
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

    system_prompt = HIGGINS_SYSTEM_PROMPT + (HANDOFF_SYSTEM_PROMPT if context else "")
    if context:
        follow_up = handoff_id is None
        action_seeking = bool(re.search(r"\b(what should|what do|how (?:do|can)|help me|next|change|remove|delete|open|setting)\b", message, re.I))
        uncertainty_seeking = bool(re.search(r"\b(safe|risk|danger|harm|compromis|trust|certain|sure|what (?:did|was) found)\b", message, re.I))
        safe_full = await _grounded_handoff_answer(device_id, prompt, system_prompt, context,
                                                   require_uncertainty=not follow_up or uncertainty_seeking,
                                                   require_action=not follow_up or action_seeking)
        yield f"data: {json.dumps({'delta': safe_full})}\n\n"
        full = safe_full
    else:
        chat = LlmChat(api_key=GEMINI_API_KEY, session_id=f"apollo-{device_id}-{uuid.uuid4().hex[:6]}", system_message=system_prompt).with_model(
            "gemini", "gemini-3-flash-preview"
        )
        full = ""
        async for ev in chat.stream_message(UserMessage(text=prompt)):
            if isinstance(ev, TextDelta):
                full += ev.content
                yield f"data: {json.dumps({'delta': ev.content})}\n\n"
            elif isinstance(ev, StreamDone):
                break
        if not full.strip():
            raise HigginsAnswerUnavailable("empty_response")
        full = redact_user_secrets(full)
    await db.ask_messages.insert_one(AskMessage(device_id=device_id, role="higgins", content=full, created_at=now_utc(),
                                                conversation_id=conversation_id, handoff_id=handoff_id).to_mongo())
    if handoff_id:
        await db.ask_handoffs.update_one({"device_id": device_id, "handoff_id": handoff_id},
                                         {"$set": {"status": "completed", "response": full, "failure_kind": None, "updated_at": now_utc()}})
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
            logger.warning("ask stream failed: %s: %s", type(exc).__name__, str(exc)[:240])
            failure_kind = exc.kind if isinstance(exc, HigginsAnswerUnavailable) else "unexpected_failure"
            if body.handoff_id:
                await db.ask_handoffs.update_one({"device_id": body.device_id, "handoff_id": body.handoff_id},
                                                 {"$set": {"status": "failed", "failure_kind": failure_kind, "updated_at": now_utc()}})
            message = ("Higgins' answer did not meet Apollo's evidence rules. Retry." if failure_kind == "contract_rejected" else
                       "Higgins did not answer before the time limit. Retry." if failure_kind == "provider_timeout" else
                       "Higgins could not answer right now. Retry.")
            yield f"data: {json.dumps({'error': message, 'failure_kind': failure_kind})}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/ask/history", response_model=list[AskMessage], response_model_by_alias=False)
async def ask_history(device_id: str = Query(min_length=8, max_length=64)):
    docs = await db.ask_messages.find({"device_id": device_id}).sort("created_at", 1).to_list(200)
    return [AskMessage.from_mongo(d) for d in docs]


@router.delete("/ask/history")
async def clear_ask_history(device_id: str = Query(min_length=8, max_length=64)):
    result = await db.ask_messages.delete_many({"device_id": device_id})
    return {"deleted": result.deleted_count}
