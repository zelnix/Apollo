"""Authoritative data classification registry for Apollo.

Single source of truth for:
- What categories of information Apollo processes
- Which categories are protected and how
- What is permitted, transformed or prohibited for each processing purpose
- What security evidence must be preserved and why
- Default handling for unknown/unclassified data

Design principles:
- Unknown data defaults to RESTRICTED (never to unrestricted security evidence)
- Security indicators that also contain personal information are dual-classified
- Authentication secrets are NEVER permitted for external transmission
- Classification decisions are deterministic — no heuristic guessing

Used by: llm_boundary.py, provider.py, and all services that handle personal or evidence data.

Standards reference: ISO/IEC 27701:2025, ISO/IEC 29100:2024, ISO/IEC 27559:2022,
Australian Privacy Act 1988 (APPs), ISO 31700-1:2023.
"""
from __future__ import annotations

from enum import Enum
from typing import Any, FrozenSet


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


class ProtectionLevel(str, Enum):
    """How strictly a data category must be protected."""
    PROHIBITED = "prohibited"       # Never transmit externally (credentials)
    RESTRICTED = "restricted"       # Requires purpose-specific authorisation and minimisation
    CONTROLLED = "controlled"       # Permitted with appropriate controls and logging
    PERMITTED = "permitted"         # Permitted for the stated purpose with standard safeguards


class ProcessingPurpose(str, Enum):
    """Recognised processing purposes. Each defines what data may be used and how."""
    INVESTIGATION = "investigation"       # Authorised security investigation
    ORDINARY_CHAT = "ordinary_chat"       # General Higgins conversation
    RESEARCH = "research"                 # Public source research
    TTS = "tts"                           # Text-to-speech synthesis
    VISION_PREFLIGHT = "vision_preflight" # Image admission screening (secret detection)
    TOKEN_COUNT = "token_count"           # Token budget check
    TRANSCRIPTION = "transcription"       # Audio-to-text conversion
    REPUTATION_LOOKUP = "reputation"      # External reputation/intel check
    BREACH_CHECK = "breach_check"         # Breach exposure lookup
    FAMILY_SHARING = "family_sharing"     # Alert/incident sharing with guardians
    DEVICE_REGISTRATION = "device_reg"    # Device setup and heartbeat
    NOTIFICATION = "notification"         # Push notification delivery
    PAGE_SIGNAL_EXTRACTION = "page_signal_extraction"  # Screenshot → security signal extraction (multimodal, privacy-gated)
    PUBLIC_ADVISORY_ANALYSIS = "public_advisory_analysis"  # Government scam advisory classification


# ── Protection Level Assignments ────────────────────────────────────────────
# Each category has a base protection level. Purpose-specific overrides are
# defined in the authorisation matrix below.

CATEGORY_PROTECTION: dict[DataCategory, ProtectionLevel] = {
    DataCategory.PII:                    ProtectionLevel.RESTRICTED,
    DataCategory.MEDICAL:                ProtectionLevel.RESTRICTED,
    DataCategory.FINANCIAL:              ProtectionLevel.RESTRICTED,
    DataCategory.LOCATION:               ProtectionLevel.RESTRICTED,
    DataCategory.SENSITIVE_PERSONAL:     ProtectionLevel.RESTRICTED,
    DataCategory.CREDENTIAL:             ProtectionLevel.PROHIBITED,
    DataCategory.SECURITY_INDICATOR:     ProtectionLevel.CONTROLLED,
    DataCategory.DEVICE_OBSERVATION:     ProtectionLevel.CONTROLLED,
    DataCategory.INVESTIGATION_METADATA: ProtectionLevel.CONTROLLED,
    DataCategory.DEVICE_IDENTITY:        ProtectionLevel.CONTROLLED,
    DataCategory.CONVERSATION:           ProtectionLevel.RESTRICTED,
    DataCategory.DERIVED_CONTENT:        ProtectionLevel.CONTROLLED,
    DataCategory.UNKNOWN:                ProtectionLevel.RESTRICTED,
}


# ── Authorisation Matrix ────────────────────────────────────────────────────
# For each (purpose, category), defines what is permitted.
#
# Key:
#   PERMITTED    — allowed for this purpose with standard safeguards
#   CONTROLLED   — allowed with specific transformation/minimisation
#   RESTRICTED   — allowed only when specifically authorised by user for this case
#   PROHIBITED   — never allowed regardless of purpose or authorisation
#
# Rules:
# 1. CREDENTIAL is PROHIBITED for ALL purposes that involve external transmission.
# 2. UNKNOWN defaults to RESTRICTED — must be classified before external use.
# 3. Security indicators are PERMITTED for investigation but CONTROLLED for research
#    (minimisation required for non-indicator personal data within them).

AuthorisationEntry = tuple[ProtectionLevel, str]

AUTHORISATION_MATRIX: dict[ProcessingPurpose, dict[DataCategory, AuthorisationEntry]] = {
    ProcessingPurpose.INVESTIGATION: {
        DataCategory.PII:                    (ProtectionLevel.CONTROLLED, "Permitted when necessary for the investigation; actual values preserved where investigatively relevant"),
        DataCategory.MEDICAL:                (ProtectionLevel.RESTRICTED, "Permitted only when directly relevant to the security concern and user-authorised"),
        DataCategory.FINANCIAL:              (ProtectionLevel.CONTROLLED, "Financial indicators (account patterns) permitted; full account numbers minimised unless investigatively essential"),
        DataCategory.LOCATION:               (ProtectionLevel.RESTRICTED, "Permitted only when directly relevant to the security concern"),
        DataCategory.SENSITIVE_PERSONAL:     (ProtectionLevel.RESTRICTED, "Permitted only when directly relevant and user-authorised"),
        DataCategory.CREDENTIAL:             (ProtectionLevel.PROHIBITED, "NEVER transmitted to Gemini or any external service"),
        DataCategory.SECURITY_INDICATOR:     (ProtectionLevel.PERMITTED, "Preserved in full — domains, URLs, IPs, redirect chains, message wording, sender identities"),
        DataCategory.DEVICE_OBSERVATION:     (ProtectionLevel.PERMITTED, "Preserved in full — enforcement evidence, packet proof, timestamps, provenance"),
        DataCategory.INVESTIGATION_METADATA: (ProtectionLevel.PERMITTED, "Case IDs, evidence IDs, source references, coverage, assessment outcomes"),
        DataCategory.DEVICE_IDENTITY:        (ProtectionLevel.CONTROLLED, "Device ID used for scoping; not transmitted to Gemini"),
        DataCategory.CONVERSATION:           (ProtectionLevel.CONTROLLED, "Prior conversation context permitted; embedded PII subject to investigation controls"),
        DataCategory.DERIVED_CONTENT:        (ProtectionLevel.PERMITTED, "Previous assessments and research results available for context"),
        DataCategory.UNKNOWN:                (ProtectionLevel.RESTRICTED, "Must be classified before inclusion in investigation payload"),
    },
    ProcessingPurpose.ORDINARY_CHAT: {
        DataCategory.PII:                    (ProtectionLevel.RESTRICTED, "Structured facts only; no raw evidence with personal data"),
        DataCategory.MEDICAL:                (ProtectionLevel.PROHIBITED, "Not processed in ordinary chat"),
        DataCategory.FINANCIAL:              (ProtectionLevel.PROHIBITED, "Not processed in ordinary chat"),
        DataCategory.LOCATION:               (ProtectionLevel.PROHIBITED, "Not processed in ordinary chat"),
        DataCategory.SENSITIVE_PERSONAL:     (ProtectionLevel.PROHIBITED, "Not processed in ordinary chat"),
        DataCategory.CREDENTIAL:             (ProtectionLevel.PROHIBITED, "NEVER transmitted"),
        DataCategory.SECURITY_INDICATOR:     (ProtectionLevel.CONTROLLED, "General security guidance; no case-specific indicators"),
        DataCategory.DEVICE_OBSERVATION:     (ProtectionLevel.CONTROLLED, "Current Apollo state summary only"),
        DataCategory.INVESTIGATION_METADATA: (ProtectionLevel.RESTRICTED, "Not available in ordinary chat context"),
        DataCategory.DEVICE_IDENTITY:        (ProtectionLevel.CONTROLLED, "Scoping only"),
        DataCategory.CONVERSATION:           (ProtectionLevel.CONTROLLED, "Conversation history available with credential stripping"),
        DataCategory.DERIVED_CONTENT:        (ProtectionLevel.PERMITTED, "Previous chat responses available"),
        DataCategory.UNKNOWN:                (ProtectionLevel.RESTRICTED, "Must be classified before processing"),
    },
    ProcessingPurpose.RESEARCH: {
        DataCategory.PII:                    (ProtectionLevel.CONTROLLED, "Minimised — emails, phones, names replaced with category labels"),
        DataCategory.MEDICAL:                (ProtectionLevel.PROHIBITED, "Never included in research queries"),
        DataCategory.FINANCIAL:              (ProtectionLevel.CONTROLLED, "Minimised — account numbers replaced; transaction patterns described generically"),
        DataCategory.LOCATION:               (ProtectionLevel.PROHIBITED, "Never included in research queries"),
        DataCategory.SENSITIVE_PERSONAL:     (ProtectionLevel.PROHIBITED, "Never included in research queries"),
        DataCategory.CREDENTIAL:             (ProtectionLevel.PROHIBITED, "NEVER transmitted"),
        DataCategory.SECURITY_INDICATOR:     (ProtectionLevel.PERMITTED, "Domains, URLs, scam identifiers preserved — essential for research effectiveness"),
        DataCategory.DEVICE_OBSERVATION:     (ProtectionLevel.RESTRICTED, "Not relevant to public research"),
        DataCategory.INVESTIGATION_METADATA: (ProtectionLevel.RESTRICTED, "Not relevant to public research"),
        DataCategory.DEVICE_IDENTITY:        (ProtectionLevel.PROHIBITED, "Never included in research queries"),
        DataCategory.CONVERSATION:           (ProtectionLevel.PROHIBITED, "Never included in research queries"),
        DataCategory.DERIVED_CONTENT:        (ProtectionLevel.CONTROLLED, "Research context from prior results only"),
        DataCategory.UNKNOWN:                (ProtectionLevel.RESTRICTED, "Must be classified before inclusion"),
    },
    ProcessingPurpose.TTS: {
        DataCategory.PII:                    (ProtectionLevel.CONTROLLED, "Only what is already in the displayed Higgins response"),
        DataCategory.MEDICAL:                (ProtectionLevel.RESTRICTED, "Only if already in displayed response"),
        DataCategory.FINANCIAL:              (ProtectionLevel.RESTRICTED, "Only if already in displayed response"),
        DataCategory.LOCATION:               (ProtectionLevel.RESTRICTED, "Only if already in displayed response"),
        DataCategory.SENSITIVE_PERSONAL:     (ProtectionLevel.RESTRICTED, "Only if already in displayed response"),
        DataCategory.CREDENTIAL:             (ProtectionLevel.PROHIBITED, "NEVER in TTS — stripped before synthesis"),
        DataCategory.SECURITY_INDICATOR:     (ProtectionLevel.PERMITTED, "Domain names and threat descriptions read aloud"),
        DataCategory.DEVICE_OBSERVATION:     (ProtectionLevel.CONTROLLED, "Apollo state descriptions read aloud"),
        DataCategory.INVESTIGATION_METADATA: (ProtectionLevel.RESTRICTED, "Not read aloud"),
        DataCategory.DEVICE_IDENTITY:        (ProtectionLevel.PROHIBITED, "Never read aloud"),
        DataCategory.CONVERSATION:           (ProtectionLevel.CONTROLLED, "Displayed response text only"),
        DataCategory.DERIVED_CONTENT:        (ProtectionLevel.PERMITTED, "Higgins response text read aloud"),
        DataCategory.UNKNOWN:                (ProtectionLevel.RESTRICTED, "Must be classified before synthesis"),
    },
    ProcessingPurpose.VISION_PREFLIGHT: {
        DataCategory.PII:                    (ProtectionLevel.RESTRICTED, "Image may contain PII — user must approve via privacy gate"),
        DataCategory.MEDICAL:                (ProtectionLevel.RESTRICTED, "Image may contain medical info — user must approve"),
        DataCategory.FINANCIAL:              (ProtectionLevel.RESTRICTED, "Image may contain financial info — user must approve"),
        DataCategory.LOCATION:               (ProtectionLevel.RESTRICTED, "Image may contain location info — user must approve"),
        DataCategory.SENSITIVE_PERSONAL:     (ProtectionLevel.RESTRICTED, "Image may contain sensitive info — user must approve"),
        DataCategory.CREDENTIAL:             (ProtectionLevel.PROHIBITED, "Credentials in images must be redacted before transmission"),
        DataCategory.SECURITY_INDICATOR:     (ProtectionLevel.PERMITTED, "Visual security indicators preserved for analysis"),
        DataCategory.DEVICE_OBSERVATION:     (ProtectionLevel.CONTROLLED, "Screenshot context"),
        DataCategory.INVESTIGATION_METADATA: (ProtectionLevel.RESTRICTED, "Not relevant to vision"),
        DataCategory.DEVICE_IDENTITY:        (ProtectionLevel.PROHIBITED, "Not included in vision requests"),
        DataCategory.CONVERSATION:           (ProtectionLevel.RESTRICTED, "Not included in vision requests"),
        DataCategory.DERIVED_CONTENT:        (ProtectionLevel.CONTROLLED, "Prior assessment context may accompany image"),
        DataCategory.UNKNOWN:                (ProtectionLevel.RESTRICTED, "Must be classified — privacy gate required"),
    },
    ProcessingPurpose.REPUTATION_LOOKUP: {
        DataCategory.PII:                    (ProtectionLevel.CONTROLLED, "Only the specific identifier being checked (URL, domain, phone)"),
        DataCategory.MEDICAL:                (ProtectionLevel.PROHIBITED, "Never sent to reputation services"),
        DataCategory.FINANCIAL:              (ProtectionLevel.PROHIBITED, "Never sent to reputation services"),
        DataCategory.LOCATION:               (ProtectionLevel.PROHIBITED, "Never sent to reputation services"),
        DataCategory.SENSITIVE_PERSONAL:     (ProtectionLevel.PROHIBITED, "Never sent to reputation services"),
        DataCategory.CREDENTIAL:             (ProtectionLevel.PROHIBITED, "NEVER transmitted"),
        DataCategory.SECURITY_INDICATOR:     (ProtectionLevel.PERMITTED, "URL, domain or phone number — the lookup target"),
        DataCategory.DEVICE_OBSERVATION:     (ProtectionLevel.PROHIBITED, "Not sent to reputation services"),
        DataCategory.INVESTIGATION_METADATA: (ProtectionLevel.PROHIBITED, "Not sent to reputation services"),
        DataCategory.DEVICE_IDENTITY:        (ProtectionLevel.PROHIBITED, "Not sent to reputation services"),
        DataCategory.CONVERSATION:           (ProtectionLevel.PROHIBITED, "Not sent to reputation services"),
        DataCategory.DERIVED_CONTENT:        (ProtectionLevel.PROHIBITED, "Not sent to reputation services"),
        DataCategory.UNKNOWN:                (ProtectionLevel.PROHIBITED, "Must be classified before lookup"),
    },
    ProcessingPurpose.BREACH_CHECK: {
        DataCategory.PII:                    (ProtectionLevel.CONTROLLED, "Only the email address the user explicitly submitted for breach check"),
        DataCategory.MEDICAL:                (ProtectionLevel.PROHIBITED, "Never sent to breach services"),
        DataCategory.FINANCIAL:              (ProtectionLevel.PROHIBITED, "Never sent to breach services"),
        DataCategory.LOCATION:               (ProtectionLevel.PROHIBITED, "Never sent to breach services"),
        DataCategory.SENSITIVE_PERSONAL:     (ProtectionLevel.PROHIBITED, "Never sent to breach services"),
        DataCategory.CREDENTIAL:             (ProtectionLevel.PROHIBITED, "NEVER transmitted"),
        DataCategory.SECURITY_INDICATOR:     (ProtectionLevel.CONTROLLED, "Breach results are security evidence"),
        DataCategory.DEVICE_OBSERVATION:     (ProtectionLevel.PROHIBITED, "Not relevant to breach check"),
        DataCategory.INVESTIGATION_METADATA: (ProtectionLevel.PROHIBITED, "Not sent to breach services"),
        DataCategory.DEVICE_IDENTITY:        (ProtectionLevel.PROHIBITED, "Not sent to breach services"),
        DataCategory.CONVERSATION:           (ProtectionLevel.PROHIBITED, "Not sent to breach services"),
        DataCategory.DERIVED_CONTENT:        (ProtectionLevel.PROHIBITED, "Not sent to breach services"),
        DataCategory.UNKNOWN:                (ProtectionLevel.PROHIBITED, "Must be classified before breach check"),
    },
    ProcessingPurpose.FAMILY_SHARING: {
        DataCategory.PII:                    (ProtectionLevel.CONTROLLED, "Chosen names and contact details only; user-initiated sharing"),
        DataCategory.MEDICAL:                (ProtectionLevel.PROHIBITED, "Not shared with guardians"),
        DataCategory.FINANCIAL:              (ProtectionLevel.PROHIBITED, "Not shared with guardians"),
        DataCategory.LOCATION:               (ProtectionLevel.PROHIBITED, "Not shared with guardians"),
        DataCategory.SENSITIVE_PERSONAL:     (ProtectionLevel.PROHIBITED, "Not shared with guardians"),
        DataCategory.CREDENTIAL:             (ProtectionLevel.PROHIBITED, "NEVER shared"),
        DataCategory.SECURITY_INDICATOR:     (ProtectionLevel.CONTROLLED, "Minimal alert summary: category, state, domain only"),
        DataCategory.DEVICE_OBSERVATION:     (ProtectionLevel.CONTROLLED, "Apollo state and weekly counts only"),
        DataCategory.INVESTIGATION_METADATA: (ProtectionLevel.RESTRICTED, "Incident scent_id for correlation only"),
        DataCategory.DEVICE_IDENTITY:        (ProtectionLevel.CONTROLLED, "Paired device IDs for routing"),
        DataCategory.CONVERSATION:           (ProtectionLevel.CONTROLLED, "Explicit user-initiated notes and replies only"),
        DataCategory.DERIVED_CONTENT:        (ProtectionLevel.CONTROLLED, "Incident summaries shared with guardian"),
        DataCategory.UNKNOWN:                (ProtectionLevel.PROHIBITED, "Must be classified before sharing"),
    },
    ProcessingPurpose.PAGE_SIGNAL_EXTRACTION: {
        DataCategory.PII:                    (ProtectionLevel.CONTROLLED, "PII visible in screenshots subject to privacy gate; minimised where not security-relevant"),
        DataCategory.MEDICAL:                (ProtectionLevel.RESTRICTED, "Medical content in screenshots requires explicit user approval via privacy gate"),
        DataCategory.FINANCIAL:              (ProtectionLevel.CONTROLLED, "Financial indicators (payment page type) extracted; card numbers not extracted from images"),
        DataCategory.LOCATION:               (ProtectionLevel.RESTRICTED, "Location in screenshots requires explicit user approval"),
        DataCategory.SENSITIVE_PERSONAL:     (ProtectionLevel.RESTRICTED, "Sensitive content requires privacy gate approval"),
        DataCategory.CREDENTIAL:             (ProtectionLevel.PROHIBITED, "Credentials visible in screenshots must be redacted before transmission"),
        DataCategory.SECURITY_INDICATOR:     (ProtectionLevel.PERMITTED, "Page type, claimed brand, URLs, form types, urgency text — core security signals"),
        DataCategory.DEVICE_OBSERVATION:     (ProtectionLevel.CONTROLLED, "Screenshot context: URL hint only"),
        DataCategory.INVESTIGATION_METADATA: (ProtectionLevel.RESTRICTED, "Not included in page signal extraction"),
        DataCategory.DEVICE_IDENTITY:        (ProtectionLevel.PROHIBITED, "Not included in page signal extraction"),
        DataCategory.CONVERSATION:           (ProtectionLevel.PROHIBITED, "Not included in page signal extraction"),
        DataCategory.DERIVED_CONTENT:        (ProtectionLevel.CONTROLLED, "Prior assessment context may accompany"),
        DataCategory.UNKNOWN:                (ProtectionLevel.RESTRICTED, "Must pass privacy gate before extraction"),
    },
    ProcessingPurpose.PUBLIC_ADVISORY_ANALYSIS: {
        DataCategory.PII:                    (ProtectionLevel.CONTROLLED, "Third-party PII in government advisories minimised; scam identifiers preserved"),
        DataCategory.MEDICAL:                (ProtectionLevel.RESTRICTED, "Medical references in advisories: category labels only"),
        DataCategory.FINANCIAL:              (ProtectionLevel.CONTROLLED, "Financial scam patterns preserved; victim account details minimised"),
        DataCategory.LOCATION:               (ProtectionLevel.CONTROLLED, "Geographic scam targeting regions preserved; personal locations minimised"),
        DataCategory.SENSITIVE_PERSONAL:     (ProtectionLevel.RESTRICTED, "Sensitive references minimised"),
        DataCategory.CREDENTIAL:             (ProtectionLevel.PROHIBITED, "NEVER transmitted — credential examples in advisories are stripped"),
        DataCategory.SECURITY_INDICATOR:     (ProtectionLevel.PERMITTED, "Scam domains, phone numbers, techniques, patterns — core intelligence"),
        DataCategory.DEVICE_OBSERVATION:     (ProtectionLevel.PROHIBITED, "Not relevant to advisory analysis"),
        DataCategory.INVESTIGATION_METADATA: (ProtectionLevel.PROHIBITED, "Not relevant to advisory analysis"),
        DataCategory.DEVICE_IDENTITY:        (ProtectionLevel.PROHIBITED, "Not included in advisory analysis"),
        DataCategory.CONVERSATION:           (ProtectionLevel.PROHIBITED, "Not included in advisory analysis"),
        DataCategory.DERIVED_CONTENT:        (ProtectionLevel.CONTROLLED, "Prior classification results available for context"),
        DataCategory.UNKNOWN:                (ProtectionLevel.RESTRICTED, "Must be classified before advisory analysis"),
    },
}


# ── Field Classification ────────────────────────────────────────────────────
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


def classify_value_patterns(text: str) -> frozenset[DataCategory]:
    """Classify a text value by its content patterns. Returns detected categories.

    This is supplementary to field-name classification. It detects embedded
    personal data within free-text fields (e.g. emails in message text).

    NOTE: This does not use broad heuristic name detection. Only deterministic
    patterns are matched (emails, phone numbers, financial identifiers).
    """
    import re
    categories: set[DataCategory] = set()

    # Email addresses
    if re.search(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b", text):
        categories.add(DataCategory.PII)

    # Phone numbers (conservative — not ports, not years)
    if re.search(r"(?<![0-9])\+?\d[\d\s().-]{7,}\d(?![0-9])", text):
        categories.add(DataCategory.PII)

    # Credit card patterns (13-19 digits with optional separators)
    if re.search(r"\b(?:\d[ -]?){12,18}\d\b", text):
        categories.add(DataCategory.FINANCIAL)

    # BSB / sort codes
    if re.search(r"(?i)(?:BSB|sort\s*code|routing)[:\s]*\d{3}[- ]?\d{3}", text):
        categories.add(DataCategory.FINANCIAL)

    # Account numbers with context
    if re.search(r"(?i)(?:account|acct|a/c)[:\s#]*\d{4,12}", text):
        categories.add(DataCategory.FINANCIAL)

    # GPS coordinates
    if re.search(r"-?\d{1,3}\.\d{4,},\s*-?\d{1,3}\.\d{4,}", text):
        categories.add(DataCategory.LOCATION)

    # Credential patterns (passwords, tokens, etc.)
    if re.search(
        r"(?i)\b(password|passcode|p\.?i\.?n\.?|otp|one[- ]?time[- ]?code|"
        r"verification[- ]?code|security[- ]?code|recovery[- ]?code|"
        r"recovery[- ]?phrase|seed[- ]?phrase|private[- ]?key|secret[- ]?key|"
        r"api[- ]?key|access[- ]?token|refresh[- ]?token|session[- ]?token|"
        r"bearer[- ]?token)\b\s*(?:is|was|:|=)\s*[^\s]{3,}",
        text,
    ):
        categories.add(DataCategory.CREDENTIAL)

    # Bearer tokens
    if re.search(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]+", text):
        categories.add(DataCategory.CREDENTIAL)

    return frozenset(categories) if categories else frozenset({DataCategory.UNKNOWN})


def is_permitted(
    purpose: ProcessingPurpose,
    category: DataCategory,
) -> bool:
    """Check whether a data category is permitted (PERMITTED or CONTROLLED) for a purpose.

    RESTRICTED requires explicit authorisation (not checked here).
    PROHIBITED is never permitted."""
    purpose_matrix = AUTHORISATION_MATRIX.get(purpose)
    if not purpose_matrix:
        return False  # Unknown purpose — fail closed
    entry = purpose_matrix.get(category)
    if not entry:
        return False  # Unknown category for this purpose — fail closed
    level, _ = entry
    return level in (ProtectionLevel.PERMITTED, ProtectionLevel.CONTROLLED)


def is_prohibited(
    purpose: ProcessingPurpose,
    category: DataCategory,
) -> bool:
    """Check whether a data category is absolutely prohibited for a purpose."""
    purpose_matrix = AUTHORISATION_MATRIX.get(purpose)
    if not purpose_matrix:
        return True  # Unknown purpose — fail closed (prohibited)
    entry = purpose_matrix.get(category)
    if not entry:
        return True  # Unknown category — fail closed (prohibited)
    level, _ = entry
    return level == ProtectionLevel.PROHIBITED


def required_transformation(
    purpose: ProcessingPurpose,
    category: DataCategory,
) -> str | None:
    """Return the transformation note for a (purpose, category) pair, or None."""
    purpose_matrix = AUTHORISATION_MATRIX.get(purpose)
    if not purpose_matrix:
        return None
    entry = purpose_matrix.get(category)
    if not entry:
        return None
    _, note = entry
    return note


def categories_for_purpose(purpose: ProcessingPurpose) -> dict[DataCategory, AuthorisationEntry]:
    """Return the full authorisation map for a processing purpose."""
    return AUTHORISATION_MATRIX.get(purpose, {})


def prohibited_categories(purpose: ProcessingPurpose) -> frozenset[DataCategory]:
    """Return all categories that are PROHIBITED for a given purpose."""
    matrix = AUTHORISATION_MATRIX.get(purpose, {})
    return frozenset(
        cat for cat, (level, _) in matrix.items()
        if level == ProtectionLevel.PROHIBITED
    )


def dual_classified_fields() -> dict[str, frozenset[DataCategory]]:
    """Return all fields that have dual classification (both security indicator and personal data).

    These fields require special handling: the security indicator value must be preserved
    for investigation effectiveness, but the personal data aspect requires appropriate
    controls for the processing purpose."""
    return {
        field: cats
        for field, cats in FIELD_CATEGORIES.items()
        if DataCategory.SECURITY_INDICATOR in cats and len(cats) > 1
    }


# ── Processing Pathway Registry ─────────────────────────────────────────────
# Documents every pathway where data leaves the device or is processed externally.


class ProcessingPathway:
    """Describes a data processing pathway with its classification requirements."""
    __slots__ = (
        "pathway_id", "name", "description", "source", "destination",
        "purpose", "data_categories", "transformations",
        "prohibited_disclosures", "evidence_preservation",
        "authorisation_required", "implementation_files",
    )

    def __init__(
        self,
        pathway_id: str,
        name: str,
        description: str,
        source: str,
        destination: str,
        purpose: ProcessingPurpose,
        data_categories: frozenset[DataCategory],
        transformations: tuple[str, ...],
        prohibited_disclosures: tuple[str, ...],
        evidence_preservation: tuple[str, ...],
        authorisation_required: str,
        implementation_files: tuple[str, ...],
    ):
        self.pathway_id = pathway_id
        self.name = name
        self.description = description
        self.source = source
        self.destination = destination
        self.purpose = purpose
        self.data_categories = data_categories
        self.transformations = transformations
        self.prohibited_disclosures = prohibited_disclosures
        self.evidence_preservation = evidence_preservation
        self.authorisation_required = authorisation_required
        self.implementation_files = implementation_files


PROCESSING_PATHWAYS: tuple[ProcessingPathway, ...] = (
    ProcessingPathway(
        pathway_id="PW-01",
        name="Message Analysis",
        description="User-submitted message text and URLs assessed for security threats",
        source="Device (user action)",
        destination="Backend → Intel services → Optional Gemini",
        purpose=ProcessingPurpose.INVESTIGATION,
        data_categories=frozenset({
            DataCategory.SECURITY_INDICATOR, DataCategory.PII,
            DataCategory.DERIVED_CONTENT, DataCategory.INVESTIGATION_METADATA,
        }),
        transformations=(
            "URL secret redaction (purpose_limited_url)",
            "Password removal from text (no_passwords validator)",
            "Credential stripping before Gemini (strip_credentials)",
        ),
        prohibited_disclosures=(
            "Passwords, PINs, OTPs in message text",
            "URL authentication tokens and credentials",
        ),
        evidence_preservation=(
            "Domain names, URLs (sanitised), redirect chains preserved",
            "Message wording preserved for threat assessment",
            "Sender identity preserved for authentication analysis",
        ),
        authorisation_required="User taps 'Check message' (explicit submission)",
        implementation_files=(
            "routers/analysis.py (message_analyse)",
            "services/investigation.py (investigate_message)",
            "services/intel.py (assess_indicator)",
            "services/higgins/provider.py (generate_json)",
        ),
    ),
    ProcessingPathway(
        pathway_id="PW-02",
        name="Screenshot Analysis (Message)",
        description="User-submitted message screenshot processed by Gemini vision for text extraction",
        source="Device (user action, privacy gate required)",
        destination="Backend → Gemini Vision",
        purpose=ProcessingPurpose.VISION_PREFLIGHT,
        data_categories=frozenset({
            DataCategory.SECURITY_INDICATOR, DataCategory.PII,
            DataCategory.CREDENTIAL, DataCategory.DERIVED_CONTENT,
        }),
        transformations=(
            "On-device privacy gate screening (ImagePrivacyGate)",
            "Sanitisation receipt validation (sanitization_status='approved')",
            "Image resize/compression (2048x2048 max, JPEG 90%)",
            "Credential stripping from extracted text",
        ),
        prohibited_disclosures=(
            "Images without privacy gate approval",
            "Images containing unredacted credentials (should be caught by gate)",
        ),
        evidence_preservation=(
            "Extracted text with security indicators preserved",
            "Visual layout context for threat assessment",
        ),
        authorisation_required="User approves through ImagePrivacyGate + sanitization_status='approved'",
        implementation_files=(
            "routers/analysis.py (message_extract)",
            "frontend/src/components/ImagePrivacyGate.tsx",
            "frontend/src/domain/imageSanitization.ts",
        ),
    ),
    ProcessingPathway(
        pathway_id="PW-03",
        name="Page Screenshot Analysis",
        description="User-submitted webpage screenshot analysed by Gemini vision for security signals",
        source="Device (user action, privacy gate required)",
        destination="Backend → Gemini Vision",
        purpose=ProcessingPurpose.VISION_PREFLIGHT,
        data_categories=frozenset({
            DataCategory.SECURITY_INDICATOR, DataCategory.PII,
            DataCategory.FINANCIAL, DataCategory.DERIVED_CONTENT,
        }),
        transformations=(
            "On-device privacy gate screening",
            "Sanitisation receipt validation",
            "Image resize/compression",
            "URL hint sanitisation (purpose_limited_url)",
        ),
        prohibited_disclosures=(
            "Images without privacy gate approval",
            "Raw user credentials visible in screenshots",
        ),
        evidence_preservation=(
            "Page type, claimed brand, security signals preserved",
            "URL and redirect information preserved",
            "Form field types (not values) preserved",
        ),
        authorisation_required="User approves through ImagePrivacyGate + sanitization_status='approved'",
        implementation_files=(
            "routers/analysis.py (page_extract)",
            "frontend/src/components/ImagePrivacyGate.tsx",
        ),
    ),
    ProcessingPathway(
        pathway_id="PW-04",
        name="Page Crawl Analysis",
        description="Backend fetches and analyses a URL's page content directly",
        source="Device (user action)",
        destination="Backend → Target URL → Gemini",
        purpose=ProcessingPurpose.INVESTIGATION,
        data_categories=frozenset({
            DataCategory.SECURITY_INDICATOR, DataCategory.DERIVED_CONTENT,
        }),
        transformations=(
            "URL sanitisation and SSRF protection",
            "HTML extraction (text, forms, links — no field values)",
            "Credential stripping before Gemini",
        ),
        prohibited_disclosures=(
            "Internal/private network addresses (SSRF protection)",
            "Form field values (only field types extracted)",
        ),
        evidence_preservation=(
            "Page title, visible text, form field types, button labels, link hostnames",
            "Final URL after redirects, redirect chain",
        ),
        authorisation_required="User taps 'Let Apollo read the page' (explicit action)",
        implementation_files=(
            "routers/analysis.py (page_crawl)",
            "services/webcrawl.py (fetch_page)",
            "services/higgins/provider.py (generate_json)",
        ),
    ),
    ProcessingPathway(
        pathway_id="PW-05",
        name="Link Investigation",
        description="User-submitted link checked via reputation and optional Gemini analysis",
        source="Device (user action)",
        destination="Backend → Intel services → Optional Gemini",
        purpose=ProcessingPurpose.INVESTIGATION,
        data_categories=frozenset({
            DataCategory.SECURITY_INDICATOR, DataCategory.DERIVED_CONTENT,
        }),
        transformations=(
            "URL secret redaction (purpose_limited_url)",
            "Credential stripping before Gemini",
        ),
        prohibited_disclosures=(
            "URL authentication tokens",
            "URL fragment identifiers",
        ),
        evidence_preservation=(
            "Domain, host, verdict, threat types, redirect chain, final URL, domain info",
        ),
        authorisation_required="User submits link for checking (explicit action)",
        implementation_files=(
            "routers/analysis.py (link_investigate)",
            "services/intel.py (assess_indicator, sanitize_url)",
        ),
    ),
    ProcessingPathway(
        pathway_id="PW-06",
        name="Investigation Case (Coordinator)",
        description="Full Higgins investigation with evidence, tools, research and response validation",
        source="Device (user action via Gate)",
        destination="Backend → Encrypted storage → Gemini (single gateway)",
        purpose=ProcessingPurpose.INVESTIGATION,
        data_categories=frozenset({
            DataCategory.SECURITY_INDICATOR, DataCategory.PII,
            DataCategory.DEVICE_OBSERVATION, DataCategory.INVESTIGATION_METADATA,
            DataCategory.CONVERSATION, DataCategory.DERIVED_CONTENT,
        }),
        transformations=(
            "Evidence encryption at rest (Fernet)",
            "Credential stripping on system prompt and text contents",
            "SDK Content object text parts: credential stripped",
            "Research queries: PII minimisation (evidence-aware)",
            "Response validation (structural + reference checking)",
        ),
        prohibited_disclosures=(
            "Authentication secrets in any Gemini payload",
            "Unscoped evidence from other devices/owners",
        ),
        evidence_preservation=(
            "Full evidence items with IDs, timestamps, provenance, coverage",
            "Source references with status and checked_at",
            "Assessment outcomes with confidence and uncertainty",
            "Enforcement evidence with packet proof",
        ),
        authorisation_required="Device authentication + owner-scoped case creation",
        implementation_files=(
            "routers/investigations.py",
            "services/higgins/coordinator.py",
            "services/higgins/evidence.py",
            "services/higgins/provider.py",
            "services/higgins/llm_boundary.py",
            "services/higgins/tools.py",
            "services/higgins/validation.py",
            "services/higgins/encryption.py",
            "services/higgins/retention.py",
        ),
    ),
    ProcessingPathway(
        pathway_id="PW-07",
        name="Public Research",
        description="Grounded web research with minimised queries via Gemini Search",
        source="Investigation coordinator (tool call)",
        destination="Backend → Gemini (with Google Search grounding)",
        purpose=ProcessingPurpose.RESEARCH,
        data_categories=frozenset({
            DataCategory.SECURITY_INDICATOR, DataCategory.PII,
            DataCategory.DERIVED_CONTENT,
        }),
        transformations=(
            "Evidence-inventory PII extraction and minimisation",
            "Personal identifiers replaced with category labels",
            "Domain names and scam indicators preserved",
            "Credential stripping",
        ),
        prohibited_disclosures=(
            "Personal email addresses, phone numbers, account numbers",
            "Medical, financial, location information",
            "Authentication secrets",
            "Device identity information",
        ),
        evidence_preservation=(
            "Domain names, URLs, scam identifiers preserved for research effectiveness",
            "Research results registered as sources with provenance",
        ),
        authorisation_required="Investigation case authorisation (tool call within coordinator)",
        implementation_files=(
            "services/higgins/tools.py (research_public_sources)",
            "services/higgins/llm_boundary.py (enforce_boundary, _minimise_personal_identifiers)",
            "services/higgins/provider.py (generate)",
        ),
    ),
    ProcessingPathway(
        pathway_id="PW-08",
        name="Text-to-Speech",
        description="Higgins response text synthesised as speech via Gemini TTS",
        source="Displayed Higgins response",
        destination="Backend → Gemini TTS",
        purpose=ProcessingPurpose.TTS,
        data_categories=frozenset({
            DataCategory.DERIVED_CONTENT, DataCategory.SECURITY_INDICATOR,
        }),
        transformations=(
            "Credential stripping (enforce_boundary + validate_outbound_payload)",
            "Double-check: strip_credentials on any violation",
        ),
        prohibited_disclosures=(
            "Any credential material in spoken text",
            "Raw personal data not already in the displayed response",
        ),
        evidence_preservation=(
            "Domain names and threat descriptions preserved in speech",
        ),
        authorisation_required="User taps read-aloud or enables automatic read-aloud",
        implementation_files=(
            "services/higgins/provider.py (speech_bytes)",
            "routers/voice.py",
            "services/higgins/llm_boundary.py",
        ),
    ),
    ProcessingPathway(
        pathway_id="PW-09",
        name="Reputation Lookup",
        description="URL/domain/phone checked against configured reputation services",
        source="Investigation or analysis pipeline",
        destination="Backend → Safe Browsing / IPQS / Blocklist",
        purpose=ProcessingPurpose.REPUTATION_LOOKUP,
        data_categories=frozenset({
            DataCategory.SECURITY_INDICATOR,
        }),
        transformations=(
            "URL sanitisation (purpose_limited_url)",
            "Cached reputation uses digest (not raw URL)",
        ),
        prohibited_disclosures=(
            "Full URL paths (only domain/hostname for domain lookups)",
            "Personal data beyond the lookup target",
        ),
        evidence_preservation=(
            "Verdict, threat types, coverage, source label",
        ),
        authorisation_required="Part of user-initiated check",
        implementation_files=(
            "services/intel.py (run_intel_check, assess_indicator)",
            "services/phonerisk.py (check_phone_risk)",
        ),
    ),
    ProcessingPathway(
        pathway_id="PW-10",
        name="Breach Check",
        description="Email address checked against known breach databases",
        source="Device (user-submitted email)",
        destination="Backend → HIBP / XposedOrNot",
        purpose=ProcessingPurpose.BREACH_CHECK,
        data_categories=frozenset({
            DataCategory.PII, DataCategory.SECURITY_INDICATOR,
        }),
        transformations=(
            "Email lowercased and trimmed",
            "Forwarded once, never stored or logged",
        ),
        prohibited_disclosures=(
            "Any data beyond the email address",
            "Device identity or investigation context",
        ),
        evidence_preservation=(
            "Breach names, dates, data classes, password exposure status",
        ),
        authorisation_required="User explicitly submits email for breach check",
        implementation_files=(
            "routers/analysis.py (account_breach, account_monitor_scan)",
            "services/breach_check.py",
        ),
    ),
    ProcessingPathway(
        pathway_id="PW-11",
        name="Family Alert Sharing",
        description="Minimal security alerts shared with paired guardians",
        source="Patrol events (automatic for paired devices)",
        destination="Backend → Paired guardian devices (push + DB)",
        purpose=ProcessingPurpose.FAMILY_SHARING,
        data_categories=frozenset({
            DataCategory.SECURITY_INDICATOR, DataCategory.DEVICE_OBSERVATION,
            DataCategory.DEVICE_IDENTITY, DataCategory.PII,
        }),
        transformations=(
            "Minimal alert: category, state, domain only",
            "No raw message text, caller numbers, or evidence narratives",
            "Guardian names chosen by users",
        ),
        prohibited_disclosures=(
            "Raw message text or screenshots",
            "Caller numbers or contact details (not shared with guardians)",
            "Full evidence or investigation details",
        ),
        evidence_preservation=(
            "Event category, state, indicator domain, timestamps",
        ),
        authorisation_required="User pairs with guardian (explicit opt-in)",
        implementation_files=(
            "routers/family.py",
            "routers/push.py",
        ),
    ),
    ProcessingPathway(
        pathway_id="PW-12",
        name="Voice Transcription",
        description="Audio recording transcribed via Gemini for voice notes",
        source="Family voice note (user-recorded)",
        destination="Backend → S3 storage → Gemini transcription",
        purpose=ProcessingPurpose.TRANSCRIPTION,
        data_categories=frozenset({
            DataCategory.CONVERSATION, DataCategory.PII,
        }),
        transformations=(
            "Secret redaction on transcribed text (redact_user_secrets)",
            "Link generation check (family pairing must be active)",
        ),
        prohibited_disclosures=(
            "Passwords or codes spoken in the recording",
        ),
        evidence_preservation=(
            "Transcript text (redacted), language detection",
        ),
        authorisation_required="User explicitly records and sends voice note",
        implementation_files=(
            "services/transcribe.py",
            "routers/family.py (add_voice_note)",
            "services/storage.py",
        ),
    ),
    ProcessingPathway(
        pathway_id="PW-13",
        name="Gmail Investigation",
        description="Read-only Gmail access for email security scanning",
        source="User OAuth consent",
        destination="Backend → Gmail API (read-only) → Investigation pipeline",
        purpose=ProcessingPurpose.INVESTIGATION,
        data_categories=frozenset({
            DataCategory.PII, DataCategory.SECURITY_INDICATOR,
            DataCategory.CONVERSATION,
        }),
        transformations=(
            "OAuth-scoped read-only access",
            "Raw message content not copied to Patrol",
            "Credential stripping on analysed content",
        ),
        prohibited_disclosures=(
            "Gmail username or password (OAuth only, never stored)",
            "Raw email content beyond the investigation scope",
        ),
        evidence_preservation=(
            "Email headers, sender, subject for threat assessment",
            "Links and attachments assessed through investigation pipeline",
        ),
        authorisation_required="User connects Gmail with Google OAuth (explicit opt-in)",
        implementation_files=(
            "routers/gmail.py",
            "services/gmail.py",
            "services/mailbox_monitor.py",
        ),
    ),
    ProcessingPathway(
        pathway_id="PW-14",
        name="Device Registration & Heartbeat",
        description="Device identity setup and periodic health check",
        source="Device (automatic)",
        destination="Backend → MongoDB",
        purpose=ProcessingPurpose.DEVICE_REGISTRATION,
        data_categories=frozenset({
            DataCategory.DEVICE_IDENTITY,
        }),
        transformations=(
            "Server-issued random device_id (no PII)",
            "Bearer token: only SHA-256 hash stored",
        ),
        prohibited_disclosures=(
            "Raw bearer tokens (only hash stored)",
            "Personal information (not collected)",
        ),
        evidence_preservation=(
            "Platform, app version, UTC offset, registration timestamp",
        ),
        authorisation_required="App installation (implicit)",
        implementation_files=(
            "routers/devices.py (register_device, device_heartbeat)",
            "core/auth.py",
        ),
    ),
    ProcessingPathway(
        pathway_id="PW-15",
        name="Patrol Event Recording",
        description="Device security observations stored as patrol events",
        source="Device (automatic after checks and observations)",
        destination="Backend → MongoDB",
        purpose=ProcessingPurpose.INVESTIGATION,
        data_categories=frozenset({
            DataCategory.SECURITY_INDICATOR, DataCategory.DEVICE_OBSERVATION,
            DataCategory.INVESTIGATION_METADATA,
        }),
        transformations=(
            "No caller numbers, app/process attribution, or raw message narratives",
            "Enforcement evidence fingerprinting for deduplication",
            "Verified block validation (proof required)",
        ),
        prohibited_disclosures=(
            "Caller phone numbers",
            "Raw message content",
            "App/process attribution details",
        ),
        evidence_preservation=(
            "Category, state, timestamps, event IDs, indicator host",
            "Enforcement evidence: mechanism, protocol, rule ID, port, observed action",
        ),
        authorisation_required="Device authentication (bearer token)",
        implementation_files=(
            "routers/patrol.py",
            "services/patrol_records.py",
        ),
    ),
)
