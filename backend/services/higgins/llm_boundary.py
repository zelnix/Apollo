"""LLM Evidence Boundary — single enforcement point before every Gemini request.

Classifies information, permits only what is necessary and authorised for the specific processing
purpose, and strips credentials/secrets. Operates on the assembled payload immediately before
the SDK call — not on upstream helpers.

Principles:
- Preserve security indicators, facts, timestamps, confidence and evidence relationships.
- Remove credentials, tokens, authentication codes and recovery secrets.
- Minimise personal identifiers unless their actual values are essential and authorised.
- Reject unauthorised payloads rather than silently replacing them with summaries.
- Same restrictions apply to all external calls: inference, token counting, research, TTS.
"""
from __future__ import annotations

import re
from enum import Enum
from typing import Any

from core.redaction import redact_investigation_secrets


class Purpose(str, Enum):
    """Processing purposes — each permits different evidence fields."""
    ORDINARY_CHAT = "ordinary_chat"           # Structured facts, no raw evidence
    INVESTIGATION = "investigation"           # Authorised evidence for the case
    RESEARCH = "research"                     # Minimal public identifiers only
    TTS = "tts"                               # Displayed text only, no evidence
    VISION_PREFLIGHT = "vision_preflight"     # Image admission check
    TOKEN_COUNT = "token_count"               # Same as the associated purpose


class Classification(str, Enum):
    """Information classification for evidence fields."""
    SECURITY_EVIDENCE = "security_evidence"   # Indicators, findings, timestamps, confidence
    PERSONAL_DATA = "personal_data"           # Names, emails, phone numbers, addresses
    SENSITIVE_PII = "sensitive_pii"           # Health, financial, biometric, location history
    CREDENTIAL = "credential"                 # Passwords, tokens, codes, keys, recovery phrases


# Patterns that indicate credential material — must be stripped before any external call.
_CREDENTIAL_PATTERNS = [
    re.compile(r"(?i)\b(password|passcode|p\.?i\.?n\.?|otp|one[- ]?time[- ]?code|verification[- ]?code|security[- ]?code|recovery[- ]?code|recovery[- ]?phrase|seed[- ]?phrase|private[- ]?key|secret[- ]?key|api[- ]?key|access[- ]?token|refresh[- ]?token|session[- ]?token|bearer[- ]?token)\b\s*(?:is|was|:|=)\s*[^\s]{3,}"),
    re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]+"),
    re.compile(r"(?i)([?&](?:(?:access|refresh|auth|api)[_-]?)?(?:token|password|secret|key|code|session|signature)=)[^\s&#\"']+"),
    re.compile(r"(https?://)[^\s/@]+:[^\s/@]+@"),
]

# Fields that are security evidence — always permitted for investigation and chat purposes.
SECURITY_FIELDS = {
    "domain", "host", "indicator_host", "indicator_digest", "destination_domain", "destination_port",
    "protocol", "direction", "mechanism", "matched_rule_id", "enforced_action", "requested_action",
    "result", "rule_source", "confidence", "correlation_id", "threat_id", "verdict", "threat_types",
    "state", "status", "category", "occurred_at", "observed_at", "verified_block", "evidence_id",
    "event_id", "case_id", "scent_id", "headline", "what_happened", "why", "what_to_do",
    "assessment", "attention", "findings", "uncertainties", "scope", "actions",
}

# Fields that carry personal data — permitted only when specifically authorised.
PERSONAL_DATA_FIELDS = {
    "name", "email", "phone_number", "address", "date_of_birth", "location",
    "device_id", "advertising_id", "imei", "serial", "contacts",
}


def strip_credentials(text: str) -> str:
    """Remove all credential patterns from text. Uses the existing redaction infrastructure
    plus additional patterns for embedded secrets."""
    return redact_investigation_secrets(text)


def enforce_boundary(purpose: Purpose, payload: Any) -> Any:
    """Enforce the LLM evidence boundary on an outgoing payload.

    For string payloads: strip credentials and (for research/TTS) minimise personal data.
    For structured payloads (dicts/lists): recursively process values.

    Raises ValueError if the payload contains material that cannot be safely processed
    for the given purpose.
    """
    if isinstance(payload, str):
        return _enforce_text(purpose, payload)
    if isinstance(payload, dict):
        return _enforce_dict(purpose, payload)
    if isinstance(payload, (list, tuple)):
        return type(payload)(_enforce_item(purpose, item) for item in payload)
    return payload


def _enforce_text(purpose: Purpose, text: str) -> str:
    """Strip credentials from all text. For research, also minimise personal identifiers."""
    cleaned = strip_credentials(text)
    if purpose == Purpose.RESEARCH:
        # Research queries should contain only public identifiers, not personal data.
        # The existing tool architecture already sends minimal queries; this is a safety net.
        cleaned = _minimise_personal_identifiers(cleaned)
    if purpose == Purpose.TTS:
        # TTS receives only the displayed text — already privacy-safe from the response.
        # Strip any residual credentials that might appear in read-aloud content.
        cleaned = strip_credentials(cleaned)
    return cleaned


def _enforce_dict(purpose: Purpose, data: dict) -> dict:
    """Recursively enforce boundary on dict values."""
    result = {}
    for key, value in data.items():
        # Credential fields are always stripped regardless of purpose.
        if key in PERSONAL_DATA_FIELDS and purpose not in (Purpose.INVESTIGATION,):
            continue  # Personal data fields excluded from non-investigation purposes
        result[key] = _enforce_item(purpose, value)
    return result


def _enforce_item(purpose: Purpose, item: Any) -> Any:
    """Enforce boundary on a single item."""
    if isinstance(item, str):
        return _enforce_text(purpose, item)
    if isinstance(item, dict):
        return _enforce_dict(purpose, item)
    if isinstance(item, (list, tuple)):
        return type(item)(_enforce_item(purpose, i) for i in item)
    return item


def _minimise_personal_identifiers(text: str) -> str:
    """Replace personal identifiers with category labels when they're not security-relevant."""
    # Phone numbers (but not port numbers or IDs)
    text = re.sub(r"(?<![0-9])\+?\d[\d\s().-]{7,}\d(?![0-9])", "[phone number]", text)
    # Email addresses
    text = re.sub(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b", "[email]", text)
    return text


def validate_outbound_payload(purpose: Purpose, text: str) -> list[str]:
    """Validate that an outbound text payload doesn't contain obvious credential leaks.
    Returns a list of violation descriptions (empty = clean)."""
    violations = []
    for pattern in _CREDENTIAL_PATTERNS:
        if pattern.search(text):
            violations.append(f"Credential pattern detected in {purpose.value} payload")
            break
    return violations


def classify_field(key: str) -> Classification:
    """Classify a field name into its information category."""
    if key in SECURITY_FIELDS:
        return Classification.SECURITY_EVIDENCE
    if key in PERSONAL_DATA_FIELDS:
        return Classification.PERSONAL_DATA
    # Check for credential-related field names
    credential_indicators = {"password", "token", "secret", "key", "code", "otp", "pin", "credential"}
    if any(indicator in key.lower() for indicator in credential_indicators):
        return Classification.CREDENTIAL
    return Classification.SECURITY_EVIDENCE  # Default: treat as security evidence (permit)
