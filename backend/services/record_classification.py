"""Historical record classification for the Apollo Scam Guard retrofit.

Classifies patrol records into the approved taxonomy:
  security_threat     — Evidence-backed, unresolved security concern
  threat_stopped      — Confirmed threat stopped (verified enforcement)
  protection_issue    — Gate failure, missing permission, unsupported capability
  reduced_protection  — Protection degraded but not a security attack
  diagnostic_result   — Manual device check or diagnostic
  informational       — Observation without security concern
  resolved            — Handled incident (no longer active)
  unverifiable_legacy — Cannot be reliably assessed; limited evidence

Classification is deterministic, repeatable, and never changes the source record's
original evidence or timestamps. Reassessments are stored as separate metadata.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

RecordClass = Literal[
    "security_threat",
    "threat_stopped",
    "protection_issue",
    "reduced_protection",
    "diagnostic_result",
    "informational",
    "resolved",
    "unverifiable_legacy",
]

# Categories that are always protection-health, never a user-facing threat.
PROTECTION_CATEGORIES = {"protection", "system"}

# Categories where growling/barking could indicate a real threat.
THREAT_CATEGORIES = {"link", "website", "connection", "known_threat", "message", "call", "app", "email", "file", "account"}

# States that represent active security concern.
THREAT_STATES = {"growling", "barking"}

# States that represent the threat was stopped.
STOPPED_STATES = {"biting"}


def classify_record(record: dict[str, Any]) -> RecordClass:
    """Classify a patrol record into the approved taxonomy.

    Uses the raw stored fields:
      - category, raw_state, effective_state, source_type
      - investigation_case_id, observed_block_reference
      - resolution, event (nested original data)

    Never invents evidence. When classification is ambiguous, defaults to
    the safer (less alarming) option.
    """
    category = record.get("category", "")
    raw_state = record.get("raw_state", "resting")
    effective_state = record.get("effective_state", "")
    source_type = record.get("source_type", "device_assessment")
    resolution = record.get("resolution") or {}
    resolution_status = resolution.get("status", "")
    has_investigation = bool(record.get("investigation_case_id"))
    has_enforcement = bool(record.get("observed_block_reference"))
    event = record.get("event") or {}
    verified_block = event.get("verified_block", False)
    headline = record.get("headline", "")
    summary = record.get("summary", "")

    # 1. Already resolved — keep as resolved regardless of original classification.
    if resolution_status in ("resolved", "trusted"):
        return "resolved"

    # 2. Verified enforcement → threat_stopped.
    if raw_state in STOPPED_STATES and verified_block and has_enforcement:
        return "threat_stopped"

    # 2b. Biting without verified block — claimed enforcement but not confirmed.
    if raw_state in STOPPED_STATES and not verified_block:
        return "protection_issue"

    # 3. Protection / system categories are NEVER security threats.
    if category in PROTECTION_CATEGORIES:
        if raw_state in THREAT_STATES:
            return "protection_issue"  # Gate failure misclassified as threat
        if raw_state == "ears_up":
            return "reduced_protection"
        return "informational"

    # 4. Device category — diagnostic or device check.
    if category == "device":
        if has_investigation:
            # Device check that opened an investigation
            if raw_state in THREAT_STATES:
                return "security_threat"
            return "diagnostic_result"
        return "diagnostic_result"

    # 5. Investigation-backed findings.
    if source_type == "investigation" or has_investigation:
        if raw_state in THREAT_STATES:
            return "security_threat"
        if raw_state == "resting":
            return "resolved"
        if raw_state in ("ears_up", "sniffing"):
            return "informational"
        return "informational"

    # 6. Enforcement events without verification.
    if source_type == "device_enforcement":
        if raw_state in THREAT_STATES:
            return "security_threat"
        return "informational"

    # 7. Standard threat categories with threat states.
    if category in THREAT_CATEGORIES:
        if raw_state in THREAT_STATES:
            return "security_threat"
        if raw_state in ("ears_up", "sniffing"):
            return "informational"
        return "informational"

    # 8. Family events are always informational.
    if category == "family":
        return "informational"

    # 9. Fallback: if we truly can't determine, mark as unverifiable legacy.
    if not headline and not summary:
        return "unverifiable_legacy"

    return "informational"


def build_reassessment(
    record: dict[str, Any],
    new_class: RecordClass,
    reassessed_at: datetime,
) -> dict[str, Any]:
    """Build the reassessment metadata sub-document.

    Stored alongside (not replacing) the original record fields.
    """
    original_class = record.get("record_class")
    return {
        "original_class": original_class,
        "new_class": new_class,
        "reassessed_at": reassessed_at.isoformat(),
        "reason": _classification_reason(record, new_class),
        "version": "retrofit_v1",
    }


def _classification_reason(record: dict[str, Any], new_class: RecordClass) -> str:
    """Human-readable reason for the classification."""
    category = record.get("category", "unknown")
    raw_state = record.get("raw_state", "unknown")
    source_type = record.get("source_type", "unknown")

    if new_class == "protection_issue":
        if category in PROTECTION_CATEGORIES:
            return f"Category '{category}' with state '{raw_state}' is a protection health issue, not a security threat."
        return f"Unverified enforcement claim (source_type: {source_type}) classified as protection issue."

    if new_class == "threat_stopped":
        return "Verified enforcement evidence confirms the threat was blocked."

    if new_class == "security_threat":
        return f"Evidence-backed security concern (category: {category}, state: {raw_state}, source: {source_type})."

    if new_class == "resolved":
        return "Record has been resolved or trusted by the user."

    if new_class == "diagnostic_result":
        return f"Device diagnostic or manual check (category: {category})."

    if new_class == "reduced_protection":
        return f"Protection capability is degraded (category: {category}, state: {raw_state})."

    if new_class == "unverifiable_legacy":
        return "Insufficient data for reliable classification; preserved as legacy record."

    return f"Standard classification for category '{category}', state '{raw_state}'."


def generate_higgins_briefing(record: dict[str, Any], record_class: RecordClass) -> dict[str, Any]:
    """Generate a concise Higgins briefing for a historical record.

    Structure:
      1. What was investigated — conversational, not report-style
      2. What was established — uses actual record data
      3. Key evidence — bullet points from the record
      4. What it means for the user — reassuring, plain English
      5. Action (only if needed)

    Higgins speaks naturally, briefly and in plain English.
    Never invents evidence. Uses only what's in the record.
    """
    headline = record.get("headline", "")
    summary = record.get("summary", "")
    category = record.get("category", "unknown")
    event = record.get("event") or {}
    what_to_do = event.get("what_to_do", "")
    why = event.get("why", [])
    has_investigation = bool(record.get("investigation_case_id"))
    cat_label = _category_label(category)
    scenario = (record.get("scenario_context") or {})
    brand = scenario.get("claimedBrand", "")
    host = scenario.get("indicatorHost", "")

    # Build a natural context phrase from available data
    subject = brand or host or cat_label
    if brand and host:
        subject = f"{brand} ({host})"

    # 1. What was investigated — conversational
    if has_investigation:
        investigated = f"Magnum DI looked into a {cat_label} concern{f' involving {subject}' if subject != cat_label else ''}."
    elif record_class == "diagnostic_result":
        investigated = f"ApolloSG ran a {cat_label} check on your device."
    elif record_class == "protection_issue":
        investigated = f"Apollo noticed a problem with your {cat_label}."
    elif record_class == "threat_stopped":
        investigated = f"Apollo's protection blocked a {cat_label} threat{f' from {subject}' if subject != cat_label else ''}."
    elif record_class == "resolved":
        investigated = f"Apollo previously flagged a {cat_label} concern{f' involving {subject}' if subject != cat_label else ''} — it's now resolved."
    else:
        investigated = f"Apollo noticed something about {cat_label}{f' involving {subject}' if subject != cat_label else ''}."

    # 2. What was established — use real data
    if record_class == "security_threat":
        established = summary or headline or "Something here looks concerning and may need your attention."
    elif record_class == "threat_stopped":
        established = summary or headline or "The threat was blocked before it could cause harm."
    elif record_class == "protection_issue":
        established = (
            (summary or headline or "A protection feature isn't working as expected.")
            + " This isn't a security attack — it's about keeping your protection running properly."
        )
    elif record_class == "resolved":
        established = summary or headline or "This concern has been handled and no further action is needed."
    elif record_class == "diagnostic_result":
        established = summary or headline or "The check completed and the results are available below."
    elif record_class == "unverifiable_legacy":
        established = (summary or headline or "This is an older record.") + " The original details are limited, so take this as historical context."
    elif record_class == "reduced_protection":
        established = summary or headline or "Your protection is running but at a reduced level."
    else:
        established = summary or headline or "Nothing needed your attention."

    # 3. Key evidence — from why array or summary
    evidence_points: list[str] = []
    if why:
        evidence_points = [str(w) for w in why[:4]]
    elif summary and summary != established:
        evidence_points = [summary[:200]]

    # 4. What it means — warm, reassuring, plain English
    if record_class == "security_threat":
        meaning = "This needs your attention — have a look at the details and follow the recommended steps."
    elif record_class == "threat_stopped":
        meaning = "ApolloSG took care of this for you. Nothing more is needed on your part."
    elif record_class == "protection_issue":
        meaning = "You're not under attack. A protection feature just needs a bit of attention to keep working properly."
    elif record_class == "resolved":
        meaning = "All sorted. This is kept in your history so you can look back if you ever need to."
    elif record_class == "reduced_protection":
        meaning = "Your protection is still working but could be better. When you have a moment, it's worth checking."
    elif record_class == "unverifiable_legacy":
        meaning = "This is from an earlier time and we don't have all the details. Treat it as background information."
    elif record_class == "diagnostic_result":
        meaning = "This was a routine check. No action needed unless the results flag something specific."
    else:
        meaning = "Nothing to worry about — this is just recorded for your awareness."

    # 5. Action — only when genuinely needed
    action = None
    if record_class == "security_threat" and what_to_do:
        action = what_to_do
    elif record_class == "protection_issue" and what_to_do:
        action = what_to_do
    elif record_class == "reduced_protection" and what_to_do:
        action = what_to_do

    return {
        "investigated": investigated,
        "established": established,
        "evidence_points": evidence_points,
        "meaning": meaning,
        "action": action,
        "record_class": record_class,
        "generated_at": None,  # Set by caller
        "version": "briefing_v2",
    }


def _category_label(category: str) -> str:
    """Human-readable category label."""
    labels = {
        "link": "link safety",
        "website": "website",
        "connection": "network connection",
        "known_threat": "known threat",
        "protection": "protection capability",
        "system": "system configuration",
        "message": "message",
        "call": "phone call",
        "app": "application",
        "device": "device security",
        "account": "account security",
        "email": "email",
        "file": "file safety",
        "family": "family safety",
    }
    return labels.get(category, category)
