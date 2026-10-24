"""Higgins chat — Higgins faithfully communicates what Apollo already knows.

HARD BOUNDARY. Before any Gemini call the question is checked against everything already established:
  1. Investigation intent with an artefact → the shared Magnum DI pipeline (Magnum DI investigates).
  2. A completed Magnum DI report, a scam alert, Patrol findings, the phone's live state, recent
     investigations or Apollo's product knowledge → deterministic presentation (presenter.py).
  3. Apollo's knowledge base — Learn articles, Scam Alerts, official guidance and researched trusted pages,
     quoted with their provenance and labelled as general knowledge, never as a finding about a case.
Only a general scam-safety question that none of these answers reaches Gemini: one call, the question
alone (no device state, no history, no case), and the answer is cached (labelled as Gemini's) so it is
never asked again. Tavily is never used here — it only maintains the knowledge base.
Questions outside Higgins' scope get a fixed reply. No tool loops, no repair calls, no presentation calls.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Literal, Optional

from pydantic import ConfigDict, Field
from pydantic.alias_generators import to_camel

from core.db import db
from core.redaction import redact_investigation_secrets
from services import government_alerts, learning
from services.higgins import app_knowledge, knowledge, presenter
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
    """The system prompt for the general-knowledge fallback: permanent core + any selected modules.

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


class ChatSource(Wire):
    """Where an answer's words come from: an official page (url) or an Apollo screen (route)."""
    title: str
    publisher: str
    url: Optional[str] = None
    route: Optional[str] = None
    licence: Optional[str] = None


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
    sources: list[ChatSource] = Field(default_factory=list)
    # apollo = Apollo's own records; knowledge_base = quoted KB sources; gemini = general-knowledge fallback
    answered_by: Literal["apollo", "knowledge_base", "gemini"] = "apollo"
    retention: ChatRetention


async def reply(owner: str, conversation_id: str, turn_id: str, message: str, previous_turn_ids: list[str],
                selected_patrol_record_id: str | None = None, selected_report_id: str | None = None,
                device_snapshot: DeviceSnapshot | None = None, selected_scam_alert_url: str | None = None) -> ChatReply:
    clean = redact_investigation_secrets(message).strip()

    # ── P0: Completed Magnum DI report → deterministic follow-up (0 Gemini calls) ──
    # Checked first so a follow-up that mentions a new link, email or number is still answered from the
    # finished record — it never opens a new investigation and never reaches Gemini.
    if selected_report_id:
        report = await _saved_report(owner, selected_report_id)
        if report is not None:
            follow = presenter.investigation_follow_up(report, report.get("sources") or [], clean)
            provenance = ["saved_report"]
            if follow["intent"] == "unanswered" and not follow["newItems"]:
                # A general question about this kind of scam: Higgins can teach from the KB, kept apart from the case.
                entries = await knowledge.search(clean)
                if entries:
                    general, sources = knowledge.present(entries, clean)
                    follow = {**follow, "answer": f"{follow['answer']}\n\nGeneral knowledge — not part of Magnum DI's findings about this case:\n\n{general}",
                              "sources": sources}
                    provenance.append("apollo_knowledge_base")
            return await _deterministic(owner, conversation_id, turn_id, clean, follow, "investigation_report", provenance,
                                        uncertainty=["The investigation doesn't answer this directly."] if follow["limitation"] else [])

    # ── P1: Investigation intent routing ─────────────────────────────────────
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

    # ── P2: A scam alert the person opened → the source's own sections (0 Gemini calls) ──
    card = _alert_card_in(clean)
    alert_url = selected_scam_alert_url or (card or {}).get("url") or _alert_url_in(clean)
    if alert_url or card:
        alert = await government_alerts.alert_by_url(alert_url) if alert_url else None
        if alert:
            return await _deterministic(owner, conversation_id, turn_id, clean, presenter.scam_alert_explanation(alert),
                                        "scam_alert", ["recognised_government_feed_cache"])
        if card:
            # Apollo no longer holds the full alert: present only what the card carried. Never Gemini.
            return await _deterministic(owner, conversation_id, turn_id, clean,
                                        presenter.scam_alert_card(card["title"], card["source"], card["summary"], card["url"]),
                                        "scam_alert", ["scam_alert_card"])

    # ── P2b: A Learn with Higgins article the person opened → its own words (0 Gemini calls) ──
    article_title = _article_title_in(clean)
    if article_title:
        article = await _learn_article(article_title)
        result = presenter.learn_article(article) if article else {
            "answer": f"I couldn't find “{article_title}” in Apollo's Learn with Higgins library, so I have nothing of its to show you.",
            "navigate": ["/higgins/learning"], "limitation": True}
        return await _deterministic(owner, conversation_id, turn_id, clean, result, "learn_article", ["learn_with_higgins_catalogue"])

    # ── P3: The hard boundary — anything Apollo already knows is presented, never sent to Gemini ──
    plan = context_tools.classify_context(clean, has_selected_report=False, has_selected_patrol_record=bool(selected_patrol_record_id))
    established = await _from_apollo(owner, clean, plan, device_snapshot, selected_patrol_record_id)
    if established:
        result, label, provenance = established
        return await _deterministic(owner, conversation_id, turn_id, clean, result, label, provenance)

    # ── P4: Apollo's knowledge base (Learn, Scam Alerts, cyber.gov.au, saved answers) ──
    entries = await knowledge.search(clean)
    if entries:
        answer, sources = knowledge.present(entries, clean)
        return await _deterministic(owner, conversation_id, turn_id, clean, {"answer": answer, "navigate": [], "sources": sources},
                                    "knowledge_base", [e["kind"] for e in entries], answered_by="knowledge_base")

    # Nothing Apollo holds answers it. Outside Higgins' scope → fixed reply, no AI.
    if not in_scope(clean):
        return await _deterministic(owner, conversation_id, turn_id, clean, {"answer": presenter.OUT_OF_SCOPE, "navigate": []},
                                    "out_of_scope", [])

    # ── P5: One Gemini call for a general scam-safety question nothing else covers; saved for reuse ──
    final = await provider.generate(
        build_system_prompt(), json.dumps({"message": clean}, ensure_ascii=False), model=provider.CHAT_MODEL,
        capability="json", json_output=True, response_schema=ModelChatReply,
        purpose=provider.Purpose.ORDINARY_CHAT, correlation_id=f"chat-{owner[:8]}", trigger_source="chat_general_knowledge",
    )
    try:
        parsed = ModelChatReply.model_validate_json(final.text)
    except (ValueError, TypeError):
        parsed = ModelChatReply(answer="My answer came back in a form Apollo couldn't read, so I have nothing to show you for that question. "
                                       "Nothing has been made up in its place — please ask again.")
    else:
        await knowledge.remember_gemini_answer(clean, parsed.answer)
    investigation_available = parsed.recommend_investigation or parsed.destination is not None
    actions = []
    if investigation_available:
        destination = parsed.destination or "higgins_case"
        actions.append(SuggestedAction(destination=destination, label="Investigate this" if destination == "higgins_case" else "Open Check It",
                                       purpose="Start a separate, explicit investigation of the item you choose. Nothing has started yet."))
    navigation = _navigation(parsed.navigate)
    combined = parsed.answer + (f"\n\n{parsed.clarification}" if parsed.clarification else "")
    expires = await memory.add_chat_exchange(owner, conversation_id, turn_id, clean, combined,
        classification="general_knowledge", context_sources=["gemini"], investigation_available=investigation_available)
    return ChatReply(turn_id=turn_id, conversation_id=conversation_id, answer=parsed.answer,
                     evidence_basis=parsed.evidence_basis, uncertainty=parsed.uncertainty,
                     clarification=parsed.clarification, context_used=[ContextUse(source="gemini_general_knowledge", status="ok")],
                     suggested_actions=actions, navigation=navigation, investigation_available=investigation_available,
                     answered_by="gemini", retention=ChatRetention(server_content_expires_at=expires.isoformat()))


# ── Deterministic helpers ─────────────────────────────────────────────────────

_SCOPE = re.compile(r"\b(scam\w*|fraud\w*|phish\w*|smish\w*|vish\w*|spam|hack\w*|malware|virus\w*|ransomware|spyware|security|secure|safe\w*|cyber\w*|"
                    r"password\w*|passphrase\w*|passkey\w*|pin|two[- ]factor|2fa|mfa|authenticat\w*|identity|id theft|privacy|private|data breach\w*|breach\w*|"
                    r"account\w*|bank\w*|card\w*|payment\w*|money|transfer\w*|invest\w*|crypto\w*|bitcoin|gift cards?|romance|dating|sextortion|blackmail|"
                    r"impersonat\w*|fake|suspicious|link\w*|url|website\w*|email\w*|text messages?|sms|message\w*|calls?|caller|number|phone|device|app\w*|"
                    r"wi-?fi|network|vpn|router|update\w*|backup\w*|download\w*|attachment\w*|qr|remote access|tech support|apollo|higgins|magnum|"
                    r"report\w*|stolen|steal\w*|lost|trick\w*|con|deepfake\w*|ai voice|social media|facebook|instagram|whatsapp|marketplace)\b", re.I)


def in_scope(question: str) -> bool:
    return bool(_SCOPE.search(question or ""))


_ALERT_URL = re.compile(r"official source:\s*(https?://\S+)", re.I)
_ALERT_CARD = re.compile(r"i just read this scam alert", re.I)
_CARD_FIELD = {"title": re.compile(r"^\W*title:\s*(.+)$", re.I | re.M), "source": re.compile(r"^\W*source:\s*(.+)$", re.I | re.M),
               "summary": re.compile(r"^\W*what the source says:\s*(.+)$", re.I | re.M)}
_ARTICLE = re.compile(r"explain the learning article:\s*(.+?)\s*$", re.I | re.S)


def _alert_url_in(message: str) -> Optional[str]:
    match = _ALERT_URL.search(message or "")
    return match.group(1).rstrip(").,") if match else None


def _alert_card_in(message: str) -> Optional[dict]:
    """The alert card the Scam Alerts screen hands to Higgins: its title, source, summary and official link."""
    if not _ALERT_CARD.search(message or ""):
        return None
    fields = {name: (m.group(1).strip() if (m := pattern.search(message)) else "") for name, pattern in _CARD_FIELD.items()}
    if not fields["title"]:
        return None
    return {**fields, "url": _alert_url_in(message) or ""}


def _article_title_in(message: str) -> Optional[str]:
    match = _ARTICLE.search(message or "")
    return match.group(1).strip().strip("“”\"'.") if match else None


async def _learn_article(title: str) -> Optional[dict]:
    row = await db.learning_articles.find_one({"title": {"$regex": f"^{re.escape(title)}$", "$options": "i"}, "status": "published", "deleted_at": None},
                                              {"_id": 0, "slug": 1})
    return await learning.get_article(row["slug"]) if row else None


def _navigation(routes: list[str]) -> list[NavTarget]:
    """Only genuine Apollo destinations survive, so a tap can never land the person nowhere."""
    navigation: list[NavTarget] = []
    for route in routes:
        candidate = str(route or "").strip()
        if app_knowledge.valid_route(candidate) and all(candidate != item.route for item in navigation):
            navigation.append(NavTarget(route=candidate, label=app_knowledge.route_label(candidate)))
        if len(navigation) == 2:
            break
    return navigation


async def _saved_report(owner: str, report_id: str) -> Optional[dict]:
    """Legacy server-side saved report (removed in Stage 11); new investigations live on the device."""
    from services.higgins import repository as repo
    doc = await db.investigation_reports.find_one({"owner_id": owner, "report_id": report_id}, {"_id": 0, "report_ciphertext": 1})
    if not doc or not doc.get("report_ciphertext"):
        return None
    try:
        return repo.dec_json(doc["report_ciphertext"])
    except (ValueError, TypeError, KeyError):
        return None


async def _from_apollo(owner: str, message: str, plan: context_tools.ContextPlan,
                       snapshot: DeviceSnapshot | None, patrol_record_id: str | None = None) -> Optional[tuple[dict, str, list[str]]]:
    """What Apollo, Patrol, Magnum DI or the device already established — presented, never re-reasoned."""
    label = plan.label
    if label == "patrol_record_context" and patrol_record_id:
        found = await context_tools.execute(owner, "get_recent_patrol_outcomes")
        record = next((item for item in found.get("items") or [] if item.get("recordId") == patrol_record_id), None)
        if record:
            return presenter.patrol_record(record), label, ["authoritative_patrol_record_store"]
    if label in ("patrol_record_context", "patrol_history"):
        found = await context_tools.execute(owner, "get_recent_patrol_outcomes")
        return presenter.patrol_findings(found.get("items") or []), label, ["authoritative_patrol_record_store"]
    if label == "current_issues" and snapshot is None:
        found = await context_tools.execute(owner, "get_recent_patrol_outcomes")
        return presenter.patrol_findings(found.get("items") or []), label, ["authoritative_patrol_record_store"]
    # Anything about THIS phone's state is answered from its live reading — never inferred, never sent to Gemini.
    about_state = label in ("protection_status", "current_issues", "device_info") or bool(_ABOUT_STATE.search(message))
    device = presenter.device_state(snapshot, message, about_phone=about_state)
    if device and (about_state or _ABOUT_THIS_PHONE.search(message)):
        return device, "device_state", ["device_snapshot" if snapshot else "no_device_reading"]
    if label == "scam_alerts":
        snapshot_alerts = await government_alerts.snapshot(5)
        return presenter.scam_alerts(snapshot_alerts["alerts"]), label, ["recognised_government_feed_cache"]
    if label == "investigation_explain":
        found = await context_tools.execute(owner, "get_recent_cases")
        return presenter.recent_investigations(found.get("items") or []), label, ["investigation_case_store"]
    if plan.knowledge_modules or label == "product_info" or _ABOUT_APOLLO.search(message):
        product = presenter.product_knowledge(message, plan.knowledge_modules)
        if product:
            return product, "product_knowledge", ["apollo_product_knowledge"]
    return None


_ABOUT_THIS_PHONE = re.compile(r"\b(my|this)\s+(phone|device|mobile|iphone|android)\b|\bon (?:my|this) (?:phone|device)\b|\b(?:am i|are my|is my)\b", re.I)
# Unmistakably about the state Apollo reads on this phone: always answered from the reading, whatever the wording.
_ABOUT_STATE = re.compile(r"\bmy\s+(?:[\w'-]+\s+){0,3}(?:protections?|gates?|permissions|security (?:review|check|status)|device (?:check|assessment))\b"
                          r"|\bapollo (?:says|shows|reports) (?:its|the|my) status\b", re.I)
_ABOUT_APOLLO = re.compile(r"\b(apollo|higgins|magnum|this app)\b|\bwhere (?:do|can) i\b|\bhow (?:do|can) i (?:check|scan|open|find|turn|use)\b", re.I)


async def _deterministic(owner: str, conversation_id: str, turn_id: str, message: str, result: dict, label: str,
                         provenance: list[str], *, uncertainty: list[str] | None = None, answered_by: str = "apollo") -> ChatReply:
    """Higgins presents what is already established. No Gemini call is made on this path."""
    expires = await memory.add_chat_exchange(owner, conversation_id, turn_id, message, result["answer"], classification=label,
                                             context_sources=provenance, investigation_available=False)
    limitation = ["Apollo's records don't answer this directly."] if result.get("limitation") else []
    return ChatReply(turn_id=turn_id, conversation_id=conversation_id, answer=result["answer"], evidence_basis=provenance,
                     uncertainty=(uncertainty or []) + limitation, clarification=None,
                     context_used=[ContextUse(source=item, status="ok") for item in provenance], suggested_actions=[],
                     navigation=_navigation(result.get("navigate") or []), sources=[ChatSource(**src) for src in result.get("sources") or []],
                     investigation_available=False, answered_by=answered_by,
                     retention=ChatRetention(server_content_expires_at=expires.isoformat()))
