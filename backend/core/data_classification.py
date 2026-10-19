"""Apollo field registry — which payload fields hold what kind of information.

Used by the outbound LLM boundary (services/higgins/llm_boundary.py) to make the single privacy decision
before Gemini:  credential → never sent;  security evidence / explicit lookup target → sent;  unrelated
personal data → withheld outside an authorised investigation.

Security indicators that also identify a person (sender, caller number, email address) are dual-classified:
their investigative value wins at the boundary. Unknown field names default to UNKNOWN; names that look like
credentials (password, token, otp…) are always CREDENTIAL. Deterministic — no heuristic guessing.
"""
from __future__ import annotations

from enum import Enum


# ── Data Categories ─────────────────────────────────────────────────────────
# Exhaustive classification of information Apollo may encounter.


class DataCategory(str, Enum):
    """Primary data categories — every piece of information must belong to at least one."""

    # ── Protected personal information ──────────────────────────────────
    PII = "pii"
    """Personally identifiable information: names, email addresses, contact details,
    government identifiers, and information capable of identifying a living person."""

    MEDICAL = "medical"
    """Medical and health information: records, diagnoses, treatments, prescriptions,
    genetic information, biometric identifiers."""

    FINANCIAL = "financial"
    """Financial information: banking details, payment information, financial records,
    transaction histories, identifiable financial circumstances."""

    LOCATION = "location"
    """Location information: precise GPS coordinates, home locations, movement histories,
    identifiable location patterns."""

    SENSITIVE_PERSONAL = "sensitive_personal"
    """Other legally protected sensitive information: applicable personal beliefs,
    characteristics, relationships and records."""

    CREDENTIAL = "credential"
    """Authentication secrets: passwords, PINs, OTPs, session tokens, API credentials,
    private keys, recovery secrets. NEVER transmit to any external service."""

    # ── Security evidence ───────────────────────────────────────────────
    SECURITY_INDICATOR = "security_indicator"
    """Security evidence: domains, URLs, IP addresses, redirect chains, certificates,
    message wording relevant to threat assessment, sender identities for
    authentication analysis, app identities, permissions, file signatures."""

    DEVICE_OBSERVATION = "device_observation"
    """Device-originated evidence: enforcement actions, packet evidence, block records,
    connection observations, timestamps, provenance, Apollo state."""

    INVESTIGATION_METADATA = "investigation_metadata"
    """Case management data: case IDs, evidence IDs, source IDs, timestamps,
    coverage records, assessment outcomes, confidence levels, relationships."""

    # ── Operational ─────────────────────────────────────────────────────
    DEVICE_IDENTITY = "device_identity"
    """Device registration data: server-issued device_id, platform, app version,
    UTC offset, push tokens. No PII by design."""

    CONVERSATION = "conversation"
    """Conversation history: user questions, Higgins responses, follow-up context.
    May contain embedded personal information from user input."""

    DERIVED_CONTENT = "derived_content"
    """Content derived by AI processing: assessments, explanations, narrations,
    research results, speech synthesis."""

    # ── Default ─────────────────────────────────────────────────────────
    UNKNOWN = "unknown"
    """Unclassified data. Defaults to RESTRICTED handling — never treated as
    unrestricted security evidence. Must be classified before external transmission."""


# Maps known field names to their data categories. Fields may belong to multiple
# categories (dual classification). Unknown fields default to UNKNOWN.

FIELD_CATEGORIES: dict[str, frozenset[DataCategory]] = {
    # ── Security evidence fields (MUST be preserved for investigation) ──
    "domain":                  frozenset({DataCategory.SECURITY_INDICATOR}),
    "host":                    frozenset({DataCategory.SECURITY_INDICATOR}),
    "indicator_host":          frozenset({DataCategory.SECURITY_INDICATOR}),
    "indicator_digest":        frozenset({DataCategory.SECURITY_INDICATOR}),
    "destination_domain":      frozenset({DataCategory.SECURITY_INDICATOR}),
    "destination_port":        frozenset({DataCategory.SECURITY_INDICATOR}),
    "protocol":                frozenset({DataCategory.SECURITY_INDICATOR}),
    "direction":               frozenset({DataCategory.SECURITY_INDICATOR}),
    "mechanism":               frozenset({DataCategory.DEVICE_OBSERVATION}),
    "matched_rule_id":         frozenset({DataCategory.DEVICE_OBSERVATION}),
    "enforced_action":         frozenset({DataCategory.DEVICE_OBSERVATION}),
    "requested_action":        frozenset({DataCategory.DEVICE_OBSERVATION}),
    "result":                  frozenset({DataCategory.DEVICE_OBSERVATION}),
    "rule_source":             frozenset({DataCategory.DEVICE_OBSERVATION}),
    "confidence":              frozenset({DataCategory.INVESTIGATION_METADATA}),
    "correlation_id":          frozenset({DataCategory.INVESTIGATION_METADATA}),
    "threat_id":               frozenset({DataCategory.SECURITY_INDICATOR}),
    "verdict":                 frozenset({DataCategory.INVESTIGATION_METADATA}),
    "threat_types":            frozenset({DataCategory.SECURITY_INDICATOR}),
    "state":                   frozenset({DataCategory.DEVICE_OBSERVATION}),
    "status":                  frozenset({DataCategory.INVESTIGATION_METADATA}),
    "category":                frozenset({DataCategory.INVESTIGATION_METADATA}),
    "occurred_at":             frozenset({DataCategory.INVESTIGATION_METADATA}),
    "observed_at":             frozenset({DataCategory.INVESTIGATION_METADATA}),
    "verified_block":          frozenset({DataCategory.DEVICE_OBSERVATION}),
    "evidence_id":             frozenset({DataCategory.INVESTIGATION_METADATA}),
    "event_id":                frozenset({DataCategory.INVESTIGATION_METADATA}),
    "case_id":                 frozenset({DataCategory.INVESTIGATION_METADATA}),
    "scent_id":                frozenset({DataCategory.INVESTIGATION_METADATA}),
    "headline":                frozenset({DataCategory.SECURITY_INDICATOR}),
    "what_happened":           frozenset({DataCategory.SECURITY_INDICATOR}),
    "why":                     frozenset({DataCategory.SECURITY_INDICATOR}),
    "what_to_do":              frozenset({DataCategory.DERIVED_CONTENT}),
    "assessment":              frozenset({DataCategory.INVESTIGATION_METADATA}),
    "attention":               frozenset({DataCategory.INVESTIGATION_METADATA}),
    "findings":                frozenset({DataCategory.INVESTIGATION_METADATA}),
    "uncertainties":           frozenset({DataCategory.INVESTIGATION_METADATA}),
    "scope":                   frozenset({DataCategory.INVESTIGATION_METADATA}),
    "actions":                 frozenset({DataCategory.DERIVED_CONTENT}),
    "redirect_chain":          frozenset({DataCategory.SECURITY_INDICATOR}),
    "final_url":               frozenset({DataCategory.SECURITY_INDICATOR}),
    "certificates":            frozenset({DataCategory.SECURITY_INDICATOR}),
    "enforcement_evidence":    frozenset({DataCategory.DEVICE_OBSERVATION}),
    "evidence_provenance":     frozenset({DataCategory.INVESTIGATION_METADATA}),

    # ── Dual-classified fields (security indicator AND personal data) ──
    "sender":                  frozenset({DataCategory.SECURITY_INDICATOR, DataCategory.PII}),
    "sender_email":            frozenset({DataCategory.SECURITY_INDICATOR, DataCategory.PII}),
    "sender_phone":            frozenset({DataCategory.SECURITY_INDICATOR, DataCategory.PII}),
    "caller_number":           frozenset({DataCategory.SECURITY_INDICATOR, DataCategory.PII}),
    "from_address":            frozenset({DataCategory.SECURITY_INDICATOR, DataCategory.PII}),
    "reply_to":                frozenset({DataCategory.SECURITY_INDICATOR, DataCategory.PII}),
    "recipient":               frozenset({DataCategory.PII}),
    "to_address":              frozenset({DataCategory.PII}),

    # ── Personal data fields ────────────────────────────────────────────
    "name":                    frozenset({DataCategory.PII}),
    "email":                   frozenset({DataCategory.PII}),
    "phone_number":            frozenset({DataCategory.PII}),
    "address":                 frozenset({DataCategory.PII}),
    "date_of_birth":           frozenset({DataCategory.PII}),
    "location":                frozenset({DataCategory.LOCATION}),
    "gps_coordinates":         frozenset({DataCategory.LOCATION}),
    "home_location":           frozenset({DataCategory.LOCATION}),
    "movement_history":        frozenset({DataCategory.LOCATION}),
    "device_id":               frozenset({DataCategory.DEVICE_IDENTITY}),
    "advertising_id":          frozenset({DataCategory.PII}),
    "imei":                    frozenset({DataCategory.PII}),
    "serial":                  frozenset({DataCategory.PII}),
    "contacts":                frozenset({DataCategory.PII}),

    # ── Medical fields ──────────────────────────────────────────────────
    "diagnosis":               frozenset({DataCategory.MEDICAL}),
    "treatment":               frozenset({DataCategory.MEDICAL}),
    "prescription":            frozenset({DataCategory.MEDICAL}),
    "medical_record":          frozenset({DataCategory.MEDICAL}),
    "health_data":             frozenset({DataCategory.MEDICAL}),
    "biometric":               frozenset({DataCategory.MEDICAL}),

    # ── Financial fields ────────────────────────────────────────────────
    "bank_account":            frozenset({DataCategory.FINANCIAL}),
    "card_number":             frozenset({DataCategory.FINANCIAL}),
    "bsb":                     frozenset({DataCategory.FINANCIAL}),
    "sort_code":               frozenset({DataCategory.FINANCIAL}),
    "transaction":             frozenset({DataCategory.FINANCIAL}),
    "balance":                 frozenset({DataCategory.FINANCIAL}),
    "payment_method":          frozenset({DataCategory.FINANCIAL}),

    # ── Credential fields (ALWAYS PROHIBITED for external transmission) ──
    "password":                frozenset({DataCategory.CREDENTIAL}),
    "passcode":                frozenset({DataCategory.CREDENTIAL}),
    "pin":                     frozenset({DataCategory.CREDENTIAL}),
    "otp":                     frozenset({DataCategory.CREDENTIAL}),
    "verification_code":       frozenset({DataCategory.CREDENTIAL}),
    "security_code":           frozenset({DataCategory.CREDENTIAL}),
    "recovery_code":           frozenset({DataCategory.CREDENTIAL}),
    "recovery_phrase":         frozenset({DataCategory.CREDENTIAL}),
    "seed_phrase":             frozenset({DataCategory.CREDENTIAL}),
    "private_key":             frozenset({DataCategory.CREDENTIAL}),
    "secret_key":              frozenset({DataCategory.CREDENTIAL}),
    "api_key":                 frozenset({DataCategory.CREDENTIAL}),
    "access_token":            frozenset({DataCategory.CREDENTIAL}),
    "refresh_token":           frozenset({DataCategory.CREDENTIAL}),
    "session_token":           frozenset({DataCategory.CREDENTIAL}),
    "bearer_token":            frozenset({DataCategory.CREDENTIAL}),

    # ── Conversation and derived ────────────────────────────────────────
    "user_question":           frozenset({DataCategory.CONVERSATION}),
    "higgins_response":        frozenset({DataCategory.DERIVED_CONTENT}),
    "explanation":             frozenset({DataCategory.DERIVED_CONTENT}),
    "overview":                frozenset({DataCategory.DERIVED_CONTENT}),
    "explanation_markdown":    frozenset({DataCategory.DERIVED_CONTENT}),

    # ── Device identity ─────────────────────────────────────────────────
    "platform":                frozenset({DataCategory.DEVICE_IDENTITY}),
    "app_version":             frozenset({DataCategory.DEVICE_IDENTITY}),
    "utc_offset":              frozenset({DataCategory.DEVICE_IDENTITY}),
    "push_token":              frozenset({DataCategory.DEVICE_IDENTITY}),
}


# ── Classification Functions ────────────────────────────────────────────────


def classify_field(field_name: str) -> frozenset[DataCategory]:
    """Classify a field by name. Returns its data categories.

    Unknown fields return {DataCategory.UNKNOWN} — never treated as unrestricted.
    Fields with credential-related names are always classified as CREDENTIAL
    even if not explicitly listed."""
    if field_name in FIELD_CATEGORIES:
        return FIELD_CATEGORIES[field_name]

    # Defensive: check for credential indicators in unknown field names
    credential_indicators = {
        "password", "token", "secret", "key", "code", "otp",
        "pin", "credential", "passphrase", "seed_phrase",
    }
    lower = field_name.lower()
    if any(indicator in lower for indicator in credential_indicators):
        return frozenset({DataCategory.CREDENTIAL})

    return frozenset({DataCategory.UNKNOWN})
