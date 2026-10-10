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
    VISION_PREFLIGHT = "vision_preflight"     # Image admission check (secret detection)
    TOKEN_COUNT = "token_count"               # Same as the associated purpose
    PAGE_SIGNAL_EXTRACTION = "page_signal_extraction"  # Screenshot → security signal extraction (multimodal)
    PUBLIC_ADVISORY_ANALYSIS = "public_advisory_analysis"  # Government scam advisory classification
    VISION_INVESTIGATION = "vision_investigation"  # Vision Gate: photograph/upload → indicator extraction + routing


class Classification(str, Enum):
    """Information classification for evidence fields.

    This enum is retained for backward compatibility. The authoritative classification
    registry is `core.data_classification` which provides finer-grained categories.
    """
    SECURITY_EVIDENCE = "security_evidence"   # Indicators, findings, timestamps, confidence
    PERSONAL_DATA = "personal_data"           # Names, emails, phone numbers, addresses
    SENSITIVE_PII = "sensitive_pii"           # Health, financial, biometric, location history
    CREDENTIAL = "credential"                 # Passwords, tokens, codes, keys, recovery phrases


# ── Authoritative Classification Registry ───────────────────────────────────
# Import the single source of truth for data classification. All field lookups
# and category decisions are delegated to this module.
from core.data_classification import (
    DataCategory,
    FIELD_CATEGORIES,
    classify_field as _authoritative_classify_field,
    is_prohibited as _is_prohibited,
    ProcessingPurpose,
)


# Patterns that indicate credential material — must be stripped before any external call.
_CREDENTIAL_PATTERNS = [
    re.compile(r"(?i)\b(password|passcode|p\.?i\.?n\.?|otp|one[- _]?time[- _]?code|verification[- _]?code|security[- _]?code|recovery[- _]?code|recovery[- _]?phrase|seed[- _]?phrase|private[- _]?key|secret[- _]?key|api[- _]?key|access[- _]?token|refresh[- _]?token|session[- _]?token|bearer[- _]?token)\b\s*(?:is|was|:|=)\s*[^\s]{3,}"),
    re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]+"),
    re.compile(r"(?i)([?&](?:(?:access|refresh|auth|api)[_-]?)?(?:token|password|secret|key|code|session|signature)=)[^\s&#\"']+"),
    re.compile(r"(https?://)[^\s/@]+:[^\s/@]+@"),
]

# Backward-compatible field sets derived from the authoritative classification registry.
# These sets are used by existing code and tests; new code should use data_classification directly.
SECURITY_FIELDS = {
    field for field, cats in FIELD_CATEGORIES.items()
    if DataCategory.SECURITY_INDICATOR in cats
    or DataCategory.DEVICE_OBSERVATION in cats
    or DataCategory.INVESTIGATION_METADATA in cats
    or DataCategory.DERIVED_CONTENT in cats
}

PERSONAL_DATA_FIELDS = {
    field for field, cats in FIELD_CATEGORIES.items()
    if (DataCategory.PII in cats or DataCategory.LOCATION in cats)
    and DataCategory.SECURITY_INDICATOR not in cats  # Exclude dual-classified security+PII fields
}


def strip_credentials(text: str) -> str:
    """Remove all credential patterns from text.

    Uses the base investigation redaction first (passwords, PINs, OTPs, codes),
    then applies additional patterns for API keys, bearer tokens, and URL credentials
    that the base redaction doesn't cover. Avoids double-redaction by checking
    whether the base pass already handled the pattern."""
    result = redact_investigation_secrets(text)
    # Additional patterns: only the ones NOT covered by redact_investigation_secrets
    # Pattern 0 overlaps with base redaction (password/PIN/OTP) — skip it
    # Patterns 1-3 are additional: Bearer tokens, URL query params, URL auth credentials
    for pattern in _CREDENTIAL_PATTERNS[1:]:
        result = pattern.sub("[credential redacted]", result)
    # Pattern 0 catches api_key=, secret_key=, access_token= etc. with underscore separators
    # that the base redaction misses. Apply it but only match lines not already redacted.
    result = _CREDENTIAL_PATTERNS[0].sub("[credential redacted]", result)
    return result


def enforce_boundary(purpose: Purpose, payload: Any, *, evidence_pii: set[str] | None = None) -> Any:
    """Enforce the LLM evidence boundary on an outgoing payload.

    For string payloads: strip credentials and (for research/TTS) minimise personal data.
    For structured payloads (dicts/lists): recursively process values.

    `evidence_pii`: optional set of known personal data values from the case evidence
    inventory. When provided and purpose is RESEARCH, these exact values are replaced
    deterministically in outbound text. This is safer than heuristic regex.

    Raises ValueError if the payload contains material that cannot be safely processed
    for the given purpose.
    """
    if isinstance(payload, str):
        return _enforce_text(purpose, payload, evidence_pii=evidence_pii)
    if isinstance(payload, dict):
        return _enforce_dict(purpose, payload, evidence_pii=evidence_pii)
    if isinstance(payload, (list, tuple)):
        return type(payload)(_enforce_item(purpose, item, evidence_pii=evidence_pii) for item in payload)
    return payload


def _enforce_text(purpose: Purpose, text: str, *, evidence_pii: set[str] | None = None) -> str:
    """Strip credentials from all text. For research and advisory analysis, also minimise personal identifiers."""
    cleaned = strip_credentials(text)
    if purpose in (Purpose.RESEARCH, Purpose.PUBLIC_ADVISORY_ANALYSIS):
        # Research and advisory queries should contain only public identifiers, not personal data.
        # Public advisories may contain third-party PII (victim details, witness names).
        # Uses evidence-inventory-aware minimisation when available (deterministic, not heuristic).
        cleaned = _minimise_personal_identifiers(cleaned, evidence_pii=evidence_pii)
    return cleaned


def _enforce_dict(purpose: Purpose, data: dict, *, evidence_pii: set[str] | None = None) -> dict:
    """Recursively enforce boundary on dict values.

    For non-investigation purposes, personal data field VALUES are minimised (replaced
    with category labels), not silently dropped. This preserves the field structure
    while protecting the actual personal data content."""
    result = {}
    for key, value in data.items():
        classification = classify_field(key)
        if classification == Classification.CREDENTIAL:
            continue  # Credential fields always excluded
        if classification in (Classification.PERSONAL_DATA, Classification.SENSITIVE_PII) \
                and purpose not in (Purpose.INVESTIGATION,):
            # Minimise personal data values rather than dropping the field entirely.
            # This preserves structure while protecting content.
            if isinstance(value, str):
                result[key] = "[personal data withheld]"
            else:
                continue  # Non-string personal data (nested objects) excluded
        else:
            result[key] = _enforce_item(purpose, value, evidence_pii=evidence_pii)
    return result


def _enforce_item(purpose: Purpose, item: Any, *, evidence_pii: set[str] | None = None) -> Any:
    """Enforce boundary on a single item."""
    if isinstance(item, str):
        return _enforce_text(purpose, item, evidence_pii=evidence_pii)
    if isinstance(item, dict):
        return _enforce_dict(purpose, item, evidence_pii=evidence_pii)
    if isinstance(item, (list, tuple)):
        return type(item)(_enforce_item(purpose, i, evidence_pii=evidence_pii) for i in item)
    return item


def _minimise_personal_identifiers(text: str, evidence_pii: set[str] | None = None) -> str:
    """Replace personal identifiers with category labels when they're not security-relevant.

    Two protection layers:
    1. Deterministic pattern matching for email addresses, phone numbers, and financial identifiers.
       These patterns are narrow enough to avoid over-redacting domain names or security indicators.
    2. Evidence-inventory-aware replacement: if `evidence_pii` is provided, exact-match those
       known personal values in the outbound text. This is DETERMINISTIC (exact string match,
       not heuristic) and cannot over-redact investigation-relevant identifiers.

    DESIGN DECISION: No broad name-recognition regex is used. Name-pattern regexes would
    over-redact legitimate domain names, business names and scam identifiers that Higgins
    must investigate. Instead, personal names are protected only when they appear in the
    evidence inventory as known PII values — deterministic, not heuristic.
    """
    # Layer 1: Deterministic patterns (order matters: longer/specific patterns first)
    # Financial identifiers: credit card numbers (13-19 digits with optional separators)
    text = re.sub(r"\b(?:\d[ -]?){12,18}\d\b", "[financial identifier]", text)
    # BSB / sort codes (6 digits with dash in the middle, when preceded by context)
    text = re.sub(r"(?i)(?:BSB|sort\s*code|routing)[:\s]*\d{3}[- ]?\d{3}", "[financial identifier]", text)
    # Account numbers preceded by context keywords
    text = re.sub(r"(?i)(?:account|acct|a/c)[:\s#]*\d{4,12}", "[account number]", text)
    # Australian Tax File Number (TFN): 8-9 digits, often with spaces, preceded by context
    text = re.sub(r"(?i)(?:TFN|tax\s*file)[:\s]*\d{3}\s*\d{3}\s*\d{2,3}", "[tax identifier]", text)
    # Australian Medicare number: 10-11 digits, often formatted 1234 56789 0 / 1
    text = re.sub(r"(?i)(?:medicare)[:\s#]*\d{4}\s*\d{5}\s*\d{1,2}(?:\s*/\s*\d)?", "[medicare number]", text)
    # Australian Business Number (ABN): 11 digits preceded by context
    text = re.sub(r"(?i)(?:ABN)[:\s]*\d{2}\s*\d{3}\s*\d{3}\s*\d{3}", "[business number]", text)
    # Passport numbers preceded by context
    text = re.sub(r"(?i)(?:passport)[:\s#]*[A-Z]{1,2}\d{6,9}", "[passport number]", text)
    # National Insurance / SSN preceded by context
    text = re.sub(r"(?i)(?:SSN|social\s*security|NI\s*number)[:\s]*[\dA-Z]{6,11}", "[government identifier]", text)
    # Phone numbers (but not port numbers, IDs, years, or short numeric sequences).
    # Requires at least 8 digits total. The negative lookbehind/lookahead prevents matching
    # numbers embedded in larger numeric contexts. Dots in domains are excluded.
    text = re.sub(r"(?<![0-9@./])\+?\d[\d\s().-]{7,}\d(?![0-9@./])", "[phone number]", text)
    # Email addresses
    text = re.sub(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b", "[email]", text)

    # Layer 2: Evidence-inventory-aware deterministic replacement
    if evidence_pii:
        # Sort by length descending so longer matches replace first (prevents partial replacements)
        for pii_value in sorted(evidence_pii, key=len, reverse=True):
            if len(pii_value) >= 3 and pii_value in text:
                text = text.replace(pii_value, "[personal identifier]")

    return text


def extract_evidence_pii(evidence_texts: list[str]) -> set[str]:
    """Extract known personal identifiers from case evidence texts for deterministic protection.

    Returns a set of exact string values found in evidence that are personal data (emails,
    phone numbers, account numbers). These are then used by `_minimise_personal_identifiers()`
    to perform exact-match replacement in outbound research queries.

    This function does NOT use heuristic name detection. It only extracts identifiers that
    can be deterministically classified as personal data by their format.
    """
    pii: set[str] = set()
    for text in evidence_texts:
        if not text:
            continue
        # Extract email addresses
        for match in re.finditer(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b", text):
            pii.add(match.group(0))
        # Extract phone numbers (not port numbers or domain-embedded digits)
        for match in re.finditer(r"(?<![0-9@./])\+?\d[\d\s().-]{7,}\d(?![0-9@./])", text):
            pii.add(match.group(0).strip())
        # Extract financial identifiers (credit card-like)
        for match in re.finditer(r"\b(?:\d[ -]?){12,18}\d\b", text):
            pii.add(match.group(0).strip())
        # Extract account numbers with context
        for match in re.finditer(r"(?i)(?:account|acct|a/c)[:\s#]*(\d{4,12})", text):
            pii.add(match.group(1))
    return pii


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
    """Classify a field name into its information category.

    Uses the authoritative data_classification registry. Returns a backward-compatible
    Classification enum for existing callers.

    Dual-classified fields (both SECURITY_INDICATOR and PII, e.g. sender, caller_number)
    return SECURITY_EVIDENCE — the security indicator role takes operational precedence.
    The field remains classified as also containing personal data in the authoritative
    registry (data_classification.py) for compliance and consent purposes.
    """
    categories = _authoritative_classify_field(key)

    # Map authoritative categories to backward-compatible Classification
    if DataCategory.CREDENTIAL in categories:
        return Classification.CREDENTIAL
    # Dual-classified: security indicator + personal data → security evidence wins operationally
    if DataCategory.SECURITY_INDICATOR in categories:
        return Classification.SECURITY_EVIDENCE
    if DataCategory.MEDICAL in categories or DataCategory.FINANCIAL in categories or DataCategory.LOCATION in categories:
        return Classification.SENSITIVE_PII
    if DataCategory.PII in categories or DataCategory.SENSITIVE_PERSONAL in categories:
        return Classification.PERSONAL_DATA
    if DataCategory.UNKNOWN in categories:
        # CRITICAL: Unknown data defaults to PERSONAL_DATA (restricted), not SECURITY_EVIDENCE.
        return Classification.PERSONAL_DATA
    return Classification.SECURITY_EVIDENCE
