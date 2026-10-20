"""Ordinary Higgins chat: deterministic context, single Gemini call, no agent loops.

Flow:
  1. Investigation intent check → if detected, route to shared Magnum DI pipeline.
  2. Existing investigation context → if viewing a report, inject it directly.
  3. Deterministic context classification → select minimum required Apollo context.
  4. Single Gemini call with context pre-injected → answer.

No tool-selection round trips. No repair calls. No agent loops.

When the user expresses clear investigation intent AND submits an artefact
(URL, email, phone, or substantial text), Higgins routes the Original Item
into the shared investigation pipeline (`initiator='higgins_user_request'`)
instead of performing a pseudo-investigation inside chat.
"""
from __future__ import annotations

import json
import logging
from typing import Literal, Optional

from pydantic import ConfigDict, Field
from pydantic.alias_generators import to_camel

from core.db import db
from core.redaction import redact_investigation_secrets
from services.higgins import context as memory
from services.higgins import context_tools, provider
from services.higgins.contracts import Wire
from services.higgins.pipeline_submit import (
    detect_investigation_intent,
    extract_submittable_items,
    submit_to_investigation_pipeline,
)

log = logging.getLogger("apollo.higgins.chat")

SYSTEM = """You are Higgins, Apollo's trusted adviser, interpreter and guide.

APOLLO DETECTS AND PROTECTS. MAGNUM DI INVESTIGATES. HIGGINS COMMUNICATES, EXPLAINS AND GUIDES.

SCOPE — STRICTLY ENFORCED:
You specialise ONLY in:
- Scams and fraud safety
- Cybersecurity and online/digital safety
- Apollo functionality, features, protection and settings — including protections, Gates, manual checks, automatic protection, limitations, coverage
- Device settings, details, OS information — but only what Apollo actually observes
- Security findings and investigation results
- Previous Apollo investigations and their outcomes
- Current Patrol findings, warnings, growling/barking reasons
- Scam Alerts from recognised government feeds
- Learn with Higgins articles and educational content
- How to use Apollo — features, screens, checks, protection functions, settings, actions
- Guidance relating to the above areas

If asked about anything outside this scope (e.g. general knowledge, cooking, maths, entertainment, politics, health, travel, coding, homework, creative writing), respond:
"I specialise in helping you stay safe from scams and cyber threats through Apollo. For that question, a general assistant would be a better fit. Is there anything security-related I can help with?"
Do NOT answer general knowledge questions, even partially.

YOUR ROLE IN CHAT:
- Answer security and scam questions directly from your knowledge when no Apollo-specific context is needed.
- Use supplied Apollo context (protection state, Patrol findings, Scam Alerts, Learn articles, investigation results) when relevant.
- Interpret Apollo findings, investigation results and Scam Alerts clearly and helpfully.
- When Learn with Higgins articles are provided, reference them by name and share their guidance.
- Guide the person towards the appropriate Apollo capability or investigation when needed.
- Answer follow-up questions about existing investigations using the actual case evidence and findings.

INVESTIGATION INITIATION:
- You may initiate a Magnum DI investigation when the person explicitly asks you to check or investigate a specific item (URL, phone number, email, message, file).
- You do NOT conduct the investigation yourself. Magnum DI performs the investigation.
- If a completed Magnum DI investigation already answers the question, use those stored findings directly. Do NOT regenerate or re-summarise the same analysis.

CURRENT-STATE ANSWERS:
- When asked about protection status, use the SUPPLIED protection context. Give one coherent answer: protected, partially protected, limited, or unavailable.
- When asked "Why is Apollo growling/barking?", identify the actual current finding from the SUPPLIED Patrol context: what happened, what is affected, whether action is required, what the person should do.
- Do NOT answer "no issues" when the supplied context shows an active growling/barking finding.
- Do NOT combine contradictory statements like "protection isn't running" and "no issues found."
- If Apollo cannot observe a requested detail, say so clearly. Never invent device model, OS version, permission state, or protection state.

SOURCE-OF-TRUTH RULE:
- Questions about the person's actual device/Apollo state → use supplied context only.
- Questions about Apollo generally → answer from authoritative product knowledge.
- Questions about existing content (Scam Alerts, Learn articles, investigations) → use the supplied content.

COMMUNICATION:
- Be calm, knowledgeable, approachable and reassuring. Use natural, conversational Australian English.
- When action is warranted, give a specific recommendation. When no action is needed, say so clearly.
- When evidence is uncertain, direct towards the safest proportionate precaution without presenting suspicion as fact.
- Explain necessary technical terms simply in context. Do not lecture.
- Provide genuine reassurance when findings support it. Never manufacture a concern.
- Keep answers concise. Aim for 2-4 short paragraphs maximum for typical questions.

EVIDENCE AVAILABILITY: Records with evidence_availability="limited_to_originating_device" do NOT contain actual findings. State only what is structurally known.

GATE STATUS: A gate with state 'ready' or 'manual_checks_available' is NOT offline. Only say offline if state is explicitly 'offline' or 'unavailable' with reason 'service_down'.

User-facing protection names:
- Websites & Links — automatic website protection + manual link checking
- Messages & Calls — message screening + call risk checks
- Email & Accounts — email monitoring + account compromise checks
- Apps & Files — app and file safety checks
- Device & Internet — device settings + network security monitoring
- Vision — photograph/upload safety checks

Return only the required JSON."""


class ModelChatReply(Wire):
    model_config = ConfigDict(extra="ignore", alias_generator=to_camel, populate_by_name=True)
    answer: str = Field(min_length=1, max_length=2000)
    evidence_basis: list[str] = Field(default_factory=list, max_length=6)
    uncertainty: list[str] = Field(default_factory=list, max_length=4)
    clarification: Optional[str] = Field(default=None, max_length=300)
    recommend_investigation: bool = False
    destination: Optional[Literal["check_it", "higgins_case"]] = None


class ContextUse(Wire):
    source: str
    status: str
    provenance: list[str] = Field(default_factory=list)
    observed_at: Optional[str] = None


class SuggestedAction(Wire):
    kind: Literal["app_destination"] = "app_destination"
    destination: Literal["check_it", "higgins_case"]
    label: str
    purpose: str


class ChatRetention(Wire):
    server_content_expires_at: str
    local_content_max_seconds: Literal[3600] = 3600
    receipt_only_after_expiry: Literal[True] = True


class ChatReply(Wire):
    turn_id: str
    conversation_id: str
    answer: str
    evidence_basis: list[str]
    uncertainty: list[str]
    clarification: Optional[str]
    context_used: list[ContextUse]
    suggested_actions: list[SuggestedAction]
    investigation_available: bool
    investigative_work_started: bool = False
    pipeline_case_id: Optional[str] = None
    retention: ChatRetention


async def reply(owner: str, conversation_id: str, turn_id: str, message: str, previous_turn_ids: list[str],
                selected_patrol_record_id: str | None = None, selected_report_id: str | None = None) -> ChatReply:
    clean = redact_investigation_secrets(message).strip()
    history = await memory.turn_history(owner, previous_turn_ids[-8:])

    # ── P0: Investigation intent routing ─────────────────────────────────────
    # If the user clearly asks Higgins to investigate a specific artefact, submit
    # it directly into the shared investigation pipeline.  Higgins does NOT perform
    # a separate pseudo-investigation in chat — it uses the same pipeline as User
    # Checks and Apollo automatic detection.
    if detect_investigation_intent(clean):
        items = extract_submittable_items(clean)
        if items:
            try:
                result = await submit_to_investigation_pipeline(owner, clean, items)
                case_id = result["case_id"]
                reused = result["reused"]

                if reused:
                    answer = (
                        "I found an existing investigation for that item on your device. "
                        "You can review the full Magnum DI findings in your investigation history — "
                        "tap the investigation to see the complete briefing, evidence and assessment."
                    )
                else:
                    artefact_desc = items[0]["value"][:80] if items else "your item"
                    answer = (
                        f"I've submitted that for a full Magnum DI investigation. "
                        f"Apollo is now investigating {artefact_desc} through the same pipeline "
                        f"used for all security checks. You'll find the full briefing, evidence chain "
                        f"and recommended actions in your investigation history once it completes."
                    )

                expires = await memory.add_chat_exchange(
                    owner, conversation_id, turn_id, clean, answer,
                    classification="investigation_submission",
                    context_sources=["pipeline_submit"],
                    investigation_available=True,
                )
                log.info("higgins_investigation_routed device=%s case=%s reused=%s",
                         owner[:12], case_id[:12], reused)
                return ChatReply(
                    turn_id=turn_id,
                    conversation_id=conversation_id,
                    answer=answer,
                    evidence_basis=["investigation_pipeline"],
                    uncertainty=[],
                    clarification=None,
                    context_used=[ContextUse(source="pipeline_submit", status="submitted")],
                    suggested_actions=[SuggestedAction(
                        destination="higgins_case",
                        label="View Investigation",
                        purpose="Open the Magnum DI investigation that was submitted from this conversation.",
                    )],
                    investigation_available=True,
                    investigative_work_started=True,
                    pipeline_case_id=case_id,
                    retention=ChatRetention(server_content_expires_at=expires.isoformat()),
                )
            except Exception as exc:
                log.warning("higgins_pipeline_submit_failed device=%s error=%s", owner[:12], type(exc).__name__)
                # Fall through to normal chat if pipeline submission fails

    # ── P1: Inject existing Magnum DI investigation report ───────────────────
    # When the user is viewing a saved report, inject the full stored investigation
    # content directly into the prompt. Higgins uses the existing result — it does
    # not reinvestigate, reinterpret or run a second analysis.
    investigation_context = ""
    if selected_report_id:
        try:
            # Legacy path: reads from server-side saved reports (removed in Stage 11).
            # For existing legacy reports this still works; new investigations store
            # results on-device only. Falls through gracefully when no server report exists.
            from services.higgins import repository as repo
            report_doc = await db.investigation_reports.find_one(
                {"owner_id": owner, "report_id": selected_report_id},
                {"_id": 0, "report_ciphertext": 1},
            )
            if report_doc and report_doc.get("report_ciphertext"):
                report = repo.dec_json(report_doc["report_ciphertext"])
                overview = redact_investigation_secrets(str(report.get("overview") or ""))
                explanation = redact_investigation_secrets(str(report.get("explanationMarkdown") or ""))
                assessment = str(report.get("assessment") or "")
                findings_list = report.get("findings") or []
                actions_list = report.get("actions") or []
                findings_text = "\n".join(
                    f"- {redact_investigation_secrets(str(f.get('text', '')))[:400]}"
                    for f in findings_list[:8]
                ) if findings_list else ""
                actions_text = "\n".join(
                    f"- {redact_investigation_secrets(str(a.get('instruction', '')))[:300]}"
                    for a in actions_list[:5]
                ) if actions_list else ""
                investigation_context = (
                    "\n\n--- COMPLETED INVESTIGATION REPORT (from Magnum DI) ---\n"
                    f"Overview: {overview[:800]}\n"
                    f"Assessment: {assessment}\n"
                )
                if explanation:
                    investigation_context += f"\nDetailed Briefing:\n{explanation[:3000]}\n"
                if findings_text:
                    investigation_context += f"\nFindings:\n{findings_text}\n"
                if actions_text:
                    investigation_context += f"\nRecommended Actions:\n{actions_text}\n"
                investigation_context += (
                    "\n--- END OF INVESTIGATION REPORT ---\n"
                    "The above investigation is already complete. Use it directly to answer the "
                    "person's question. Do NOT reinvestigate, reinterpret or run another analysis.\n"
                )
        except (ValueError, TypeError, KeyError):
            pass  # Decryption or parsing failed — fall through to normal flow

    # ── P2: Deterministic context selection ───────────────────────────────────
    # Instead of asking Gemini to choose tools, determine the minimum context needed.
    plan = context_tools.classify_context(
        clean,
        has_selected_report=bool(investigation_context),
        has_selected_patrol_record=bool(selected_patrol_record_id),
    )
    log.info("higgins_context_plan device=%s plan=%s readers=%s", owner[:12], plan.label, plan.readers)

    # Gather the required context deterministically
    apollo_context, context_uses_raw = await context_tools.gather_context(owner, plan)
    uses = [ContextUse(source=u["source"], status=u["status"],
                        provenance=[str(v) for v in u.get("provenance", [])][:6],
                        observed_at=u.get("observedAt")) for u in context_uses_raw]

    # ── P3: Build prompt with pre-injected context ───────────────────────────
    context_block = investigation_context + ("\n\n" + apollo_context if apollo_context else "")
    history_block = json.dumps([{"role": item.role, "content": item.content, "turnId": item.turn_id} for item in history], ensure_ascii=False) if history else "[]"

    prompt = json.dumps({
        "message": clean + (f"\n\n{context_block}" if context_block else ""),
        "previousTurns": json.loads(history_block),
        "selectedPatrolRecordId": selected_patrol_record_id,
        "selectedReportId": selected_report_id,
        "contextPlan": plan.label,
    }, ensure_ascii=False)

    # ── P4: Single Gemini call — no tool selection, no repair loop ───────────
    chat_model = provider.CHAT_MODEL
    final = await provider.generate(
        SYSTEM, prompt, model=chat_model,
        capability="json", json_output=True, response_schema=ModelChatReply,
        purpose=provider.Purpose.ORDINARY_CHAT,
        correlation_id=f"chat-{owner[:8]}",
        trigger_source="chat",
    )

    # ── P5: Parse — straightforward fallback, no repair Gemini call ──────────
    try:
        parsed = ModelChatReply.model_validate_json(final.text)
    except (ValueError, TypeError):
        # Try to extract answer from raw JSON
        try:
            legacy = json.loads(final.text)
            answer_text = str(legacy.get("answer") or legacy.get("text") or final.text or "")
            parsed = ModelChatReply(
                answer=answer_text[:2000] if answer_text else "My answer came back in a form Apollo couldn't read, so I have nothing to show you for that question. Nothing has been made up in its place — please ask again.",
                clarification=legacy.get("clarification"),
                recommend_investigation=bool(legacy.get("recommendInvestigation") or legacy.get("recommend_investigation")),
                destination=legacy.get("destination"),
            )
        except (ValueError, KeyError, TypeError):
            # Last resort: use raw text as the answer — NO repair Gemini call
            raw_text = (final.text or "").strip()
            if raw_text and len(raw_text) > 5:
                # Strip JSON fences if present
                import re
                raw_text = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw_text).strip()
                # Try to extract just the answer field
                try:
                    maybe_json = json.loads(raw_text)
                    raw_text = str(maybe_json.get("answer", raw_text))
                except (ValueError, TypeError):
                    pass
                parsed = ModelChatReply(answer=raw_text[:2000])
            else:
                parsed = ModelChatReply(answer="My answer came back empty or unreadable, so there is nothing to show you for that question. Nothing has been made up in its place — please ask again.")

    investigation_available = parsed.recommend_investigation or parsed.destination is not None
    actions = []
    if investigation_available:
        destination = parsed.destination or "higgins_case"
        actions.append(SuggestedAction(destination=destination, label="Investigate this" if destination == "higgins_case" else "Open Check It",
                                       purpose="Start a separate, explicit investigation of the item you choose. Nothing has started yet."))
    combined = parsed.answer + (f"\n\n{parsed.clarification}" if parsed.clarification else "")
    expires = await memory.add_chat_exchange(owner, conversation_id, turn_id, clean, combined,
        classification="ordinary_chat", context_sources=[item.source for item in uses], investigation_available=investigation_available)
    return ChatReply(turn_id=turn_id, conversation_id=conversation_id, answer=parsed.answer,
                     evidence_basis=parsed.evidence_basis, uncertainty=parsed.uncertainty,
                     clarification=parsed.clarification, context_used=uses, suggested_actions=actions,
                     investigation_available=investigation_available,
                     retention=ChatRetention(server_content_expires_at=expires.isoformat()))
