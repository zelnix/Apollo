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
from services.higgins import app_knowledge
from services.higgins import context as memory
from services.higgins import context_tools, provider
from services.higgins.contracts import Wire
from services.higgins.pipeline_submit import (
    detect_investigation_intent,
    extract_submittable_items,
    submit_to_investigation_pipeline,
)

log = logging.getLogger("apollo.higgins.chat")

# ── Permanent core ────────────────────────────────────────────────────────────
# These ~600 tokens NEVER leave the prompt. They protect Higgins' safety
# invariants: role separation, evidence authority, scope, uncertainty handling.
# Conditional modules are appended by build_system_prompt().

_PERMANENT_CORE = """You are Higgins, Apollo's trusted adviser, interpreter and guide.

APOLLO DETECTS AND PROTECTS. MAGNUM DI INVESTIGATES AND SEARCHES. HIGGINS KNOWS APOLLO AND SCAMS, AND COMMUNICATES, EXPLAINS AND GUIDES.

You are the savant of this app. You know every screen, every check, every protection, every setting, every flow and every privacy rule in Apollo, and you know how scams and fraud work. You are not a general assistant and you do not investigate: Magnum DI owns investigation and external searching, Apollo owns detection and protection.

SCOPE — STRICTLY ENFORCED:
You specialise ONLY in: scams and fraud safety; cybersecurity and digital safety; Apollo functionality, features, protections, settings, checks, screens, flows, privacy; device settings and OS information as observed by Apollo; security findings and investigation results; Patrol findings and warnings; Scam Alerts; Learn articles; guidance in the above areas.

If asked about anything outside this scope (e.g. general knowledge, cooking, maths, entertainment, politics, health, travel, coding, homework, creative writing), respond:
"I specialise in helping you stay safe from scams and cyber threats through Apollo. For that question, a general assistant would be a better fit. Is there anything security-related I can help with?"
Do NOT answer general knowledge questions, even partially.

INVESTIGATION: You may tell the person you'll hand off to Magnum DI when they ask to check/investigate a specific item. You do NOT conduct the investigation yourself. If a completed investigation already answers the question, use those stored findings directly. Do NOT re-summarise. Answer follow-up questions about existing investigations using the actual case evidence.

EVIDENCE RULES (non-negotiable):
- DEVICE SNAPSHOT: when supplied, it is a live authoritative reading. Use it for any question about their protections, threats, permissions, alerts, settings. It is the truth about their phone; NEVER contradict it and NEVER guess past it.
- If Apollo cannot observe a requested detail, say so clearly. Never invent device model, OS version, permission state, or protection state.
- Do NOT answer "no issues" when supplied context shows an active finding.
- Do NOT combine contradictory statements.
- When evidence is uncertain, direct towards the safest proportionate precaution without presenting suspicion as fact. Never manufacture a concern.
- Records with evidence_availability="limited_to_originating_device" do NOT contain actual findings. State only what is structurally known.

SOURCE-OF-TRUTH: Device/Apollo state → use supplied context only. Apollo generally → answer from product knowledge. Existing content → use supplied content.

GATE STATUS: A gate with state 'ready' or 'manual_checks_available' is NOT offline. Only 'offline' or 'unavailable/service_down' means offline.

COMMUNICATION: Calm, knowledgeable, approachable Australian English. 2-4 short paragraphs max. Specific recommendations when action is warranted. Clear reassurance when findings support it. Explain technical terms simply. Do not lecture.

NAVIGATION: return the route string in `navigate` chosen only from the APOLLO PRODUCT KNOWLEDGE route list. At most two. Only when the destination genuinely answers the question.

Return only the required JSON."""


def build_system_prompt(
    knowledge_modules: list[str] | None = None,
    route_groups: list[str] | None = None,
) -> str:
    """Assemble the Higgins system prompt from permanent core + classifier-selected modules.

    The permanent core (~600 tokens) is always present.
    Conditional modules and route groups are appended only when the classifier
    determines the question needs them.
    """
    kb = app_knowledge.knowledge_block(
        modules=knowledge_modules or [],
        route_groups=route_groups or [],
    )
    return _PERMANENT_CORE + "\n\n" + kb


# Legacy constant for tests and imports that reference SYSTEM directly.
# This is the FULL prompt (all modules, all routes) — used only for backward
# compatibility with tests.  Live turns use build_system_prompt() with
# classifier-selected modules.
SYSTEM = build_system_prompt(
    knowledge_modules=list(app_knowledge.KNOWLEDGE_MODULES.keys()),
    route_groups=list(app_knowledge.ROUTE_GROUPS.keys()),
)


class ModelChatReply(Wire):
    model_config = ConfigDict(extra="ignore", alias_generator=to_camel, populate_by_name=True)
    answer: str = Field(min_length=1, max_length=2000)
    evidence_basis: list[str] = Field(default_factory=list, max_length=6)
    uncertainty: list[str] = Field(default_factory=list, max_length=4)
    clarification: Optional[str] = Field(default=None, max_length=300)
    recommend_investigation: bool = False
    destination: Optional[Literal["check_it", "higgins_case"]] = None
    navigate: list[str] = Field(default_factory=list, max_length=4)


class NavTarget(Wire):
    """A validated Apollo destination the person can tap straight through to."""
    route: str
    label: str


class SnapshotGate(Wire):
    """One protection, exactly as the phone currently reports it."""
    id: str = Field(max_length=40)
    title: str = Field(max_length=60)
    status: str = Field(max_length=80)
    tone: str = Field(max_length=20)
    automatic: bool = False
    coverage: str = Field(default="", max_length=40)


class DeviceSnapshot(Wire):
    """Everything Apollo holds on this phone, as the phone reads it right now.

    Every field is a state reading or a short headline Apollo itself wrote. No
    message bodies, screenshots, files or secrets are ever carried here.
    """
    platform: Optional[str] = Field(default=None, max_length=20)
    checked_at: Optional[str] = Field(default=None, max_length=40)
    protection_on: Optional[bool] = None
    adapter: Optional[str] = Field(default=None, max_length=80)
    gates: list[SnapshotGate] = Field(default_factory=list, max_length=14)
    permissions: list[str] = Field(default_factory=list, max_length=14)
    network: Optional[str] = Field(default=None, max_length=240)
    threat_counts: list[str] = Field(default_factory=list, max_length=8)
    open_threats: list[str] = Field(default_factory=list, max_length=8)
    alerts: Optional[str] = Field(default=None, max_length=120)
    quiet_hours: Optional[str] = Field(default=None, max_length=80)
    battery_saver: Optional[bool] = None
    trusted_links: Optional[int] = None
    saved_checks: Optional[int] = None
    personal_data: Optional[str] = Field(default=None, max_length=160)
    call_screener: Optional[str] = Field(default=None, max_length=240)
    email_accounts: Optional[str] = Field(default=None, max_length=160)
    # Device Capabilities — what this device protects by itself, what Apollo is allowed to use, and
    # which native settings Apollo cannot read. Attribution is carried in the strings themselves.
    capability_summary: Optional[str] = Field(default=None, max_length=300)
    device_protections: list[str] = Field(default_factory=list, max_length=8)
    capabilities: list[str] = Field(default_factory=list, max_length=16)
    recommended_settings: list[str] = Field(default_factory=list, max_length=8)
    notes: list[str] = Field(default_factory=list, max_length=10)


def _render_snapshot(snap: DeviceSnapshot) -> str:
    """Turn the snapshot into the authoritative state block for the prompt."""
    lines: list[str] = ["--- CURRENT APOLLO STATE ON THIS PHONE (live reading, authoritative) ---"]
    if snap.platform:
        lines.append(f"Platform: {snap.platform}")
    if snap.adapter:
        lines.append(f"Protection engine: {snap.adapter}")
    if snap.protection_on is not None:
        lines.append(f"Apollo protection switched on: {'yes' if snap.protection_on else 'no'}")
    if snap.checked_at:
        lines.append(f"Status last read at: {snap.checked_at}")
    if snap.gates:
        lines.append("Protections:")
        for gate in snap.gates:
            detail = f"  - {gate.title} ({gate.id}): {gate.status} [tone={gate.tone}"
            if gate.coverage:
                detail += f", coverage={gate.coverage}"
            detail += f", {'automatic' if gate.automatic else 'manual checks only'}]"
            lines.append(detail)
    if snap.permissions:
        lines.append("Permissions: " + "; ".join(snap.permissions))
    if snap.network:
        lines.append(f"Internet connection: {snap.network}")
    if snap.call_screener:
        lines.append(f"Call screening: {snap.call_screener}")
    if snap.capability_summary:
        lines.append(f"Device capability coverage: {snap.capability_summary}")
    if snap.device_protections:
        lines.append(
            "Protection built into this device (belongs to the named provider, NOT to Apollo — "
            "never describe these as Apollo detections):"
        )
        lines.extend(f"  - {item}" for item in snap.device_protections)
    if snap.capabilities:
        lines.append(
            "What Apollo is allowed to use on this device (exact state per capability; "
            "'Managed by your device' means the OS or the named provider keeps it to itself and "
            "Apollo must not infer it, 'Apollo couldn't check' means a read failed and is NOT an "
            "all-clear, 'Can't be read in this preview' means Apollo is not on the phone itself):"
        )
        lines.extend(f"  - {item}" for item in snap.capabilities)
    if snap.recommended_settings:
        lines.append(
            "Native settings Apollo cannot read or switch on (recommend the person checks these "
            "themselves; never state whether they are currently on or off):"
        )
        lines.extend(f"  - {item}" for item in snap.recommended_settings)
    if snap.threat_counts:
        lines.append("Threats recorded: " + "; ".join(snap.threat_counts))
    if snap.open_threats:
        lines.append("Threats currently open:")
        lines.extend(f"  - {item}" for item in snap.open_threats)
    if snap.alerts:
        lines.append(f"Security alerts: {snap.alerts}")
    if snap.quiet_hours:
        lines.append(f"Quiet hours: {snap.quiet_hours}")
    if snap.battery_saver is not None:
        lines.append(f"Battery saver: {'on' if snap.battery_saver else 'off'}")
    if snap.trusted_links is not None:
        lines.append(f"Trusted links saved: {snap.trusted_links}")
    if snap.saved_checks is not None:
        lines.append(f"Saved checks kept: {snap.saved_checks}")
    if snap.personal_data:
        lines.append(f"Personal data protected: {snap.personal_data}")
    if snap.email_accounts:
        lines.append(f"Email accounts: {snap.email_accounts}")
    if snap.notes:
        lines.extend(f"Note: {item}" for item in snap.notes)
    lines.append("--- END CURRENT APOLLO STATE ---")
    return "\n".join(lines)


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
    navigation: list[NavTarget] = Field(default_factory=list)
    investigation_available: bool
    investigative_work_started: bool = False
    pipeline_case_id: Optional[str] = None
    retention: ChatRetention


async def reply(owner: str, conversation_id: str, turn_id: str, message: str, previous_turn_ids: list[str],
                selected_patrol_record_id: str | None = None, selected_report_id: str | None = None,
                device_snapshot: DeviceSnapshot | None = None) -> ChatReply:
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
    # Higgins is the savant of Apollo: the core Apollo readers are gathered on every
    # turn so he always answers from what is actually true, and the classifier adds
    # whatever else the specific question needs on top.
    plan = context_tools.classify_context(
        clean,
        has_selected_report=bool(investigation_context),
        has_selected_patrol_record=bool(selected_patrol_record_id),
    )
    plan = context_tools.with_core_readers(plan)
    log.info("higgins_context_plan device=%s plan=%s readers=%s modules=%s routes=%s",
             owner[:12], plan.label, plan.readers, plan.knowledge_modules, plan.route_groups)

    # Gather the required context deterministically
    apollo_context, context_uses_raw = await context_tools.gather_context(owner, plan)
    uses = [ContextUse(source=u["source"], status=u["status"],
                        provenance=[str(v) for v in u.get("provenance", [])][:6],
                        observed_at=u.get("observedAt")) for u in context_uses_raw]

    # ── P3: Build prompt with pre-injected context ───────────────────────────
    snapshot_block = _render_snapshot(device_snapshot) if device_snapshot else ""
    context_block = investigation_context + ("\n\n" + snapshot_block if snapshot_block else "") + ("\n\n" + apollo_context if apollo_context else "")
    history_block = json.dumps([{"role": item.role, "content": item.content, "turnId": item.turn_id} for item in history], ensure_ascii=False) if history else "[]"

    prompt = json.dumps({
        "message": clean + (f"\n\n{context_block}" if context_block else ""),
        "previousTurns": json.loads(history_block),
        "selectedPatrolRecordId": selected_patrol_record_id,
        "selectedReportId": selected_report_id,
        "contextPlan": plan.label,
    }, ensure_ascii=False)

    # ── P4: Single Gemini call — no tool selection, no repair loop ───────────
    # Build the system prompt with only the classifier-selected modules.
    system_prompt = build_system_prompt(
        knowledge_modules=plan.knowledge_modules,
        route_groups=plan.route_groups,
    )
    chat_model = provider.CHAT_MODEL
    final = await provider.generate(
        system_prompt, prompt, model=chat_model,
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
    # Deep links: only genuine Apollo destinations survive. An invented route is dropped
    # rather than offered, so a tap can never land the person nowhere.
    navigation: list[NavTarget] = []
    for route in parsed.navigate:
        candidate = str(route or "").strip()
        if app_knowledge.valid_route(candidate) and all(candidate != item.route for item in navigation):
            navigation.append(NavTarget(route=candidate, label=app_knowledge.route_label(candidate)))
        if len(navigation) == 2:
            break
    combined = parsed.answer + (f"\n\n{parsed.clarification}" if parsed.clarification else "")
    expires = await memory.add_chat_exchange(owner, conversation_id, turn_id, clean, combined,
        classification="ordinary_chat", context_sources=[item.source for item in uses], investigation_available=investigation_available)
    return ChatReply(turn_id=turn_id, conversation_id=conversation_id, answer=parsed.answer,
                     evidence_basis=parsed.evidence_basis, uncertainty=parsed.uncertainty,
                     clarification=parsed.clarification, context_used=uses, suggested_actions=actions,
                     navigation=navigation,
                     investigation_available=investigation_available,
                     retention=ChatRetention(server_content_expires_at=expires.isoformat()))
