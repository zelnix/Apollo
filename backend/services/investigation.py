"""Apollo investigation utilities — observations, redaction and data extraction.

IMPORTANT: This module is NOT an investigation engine. Magnum DI (services/higgins/coordinator.py)
is the single authoritative investigation engine for all person-requested Apollo investigations.

This module provides genuine utility capabilities that may supply evidence/context to Magnum DI:
  - URL sanitisation and purpose limitation
  - Deterministic entity extraction
  - Screenshot/image text extraction
  - Country/locale resolution
  - Temporary copy policy constants

These are inputs/observations, not separate investigations.
"""
from __future__ import annotations

import re
import json
import logging
from typing import Any, Optional

from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import phonenumbers
from google.genai import types
from pydantic import BaseModel, Field

from core.redaction import redact_investigation_secrets
from services.higgins.provider import ProviderFailure, VISION_MODEL, generate_json
from services.higgins.llm_boundary import Purpose

logger = logging.getLogger("apollo.investigation")


# ── Temporary copy policy ────────────────────────────────────────────────────

TEMPORARY_COPY_POLICY = (
    "Submitted content is processed temporarily and discarded after the investigation. "
    "Apollo does not retain copies of submitted text, URLs or files beyond the investigation session."
)


# ── URL sanitisation ─────────────────────────────────────────────────────────

_SECRET_PARAMS = re.compile(
    r"(?i)(?:token|key|secret|auth|session|password|pwd|code|nonce|sig|signature|"
    r"access_token|refresh_token|api_key|apikey|jwt|bearer|credential|otp|pin|ssn|"
    r"card|cvv|expir|account|routing|sort_code|bsb|iban|swift|medicare|passport|"
    r"driver.?licen|tfn|tax.?file|abn|acn)"
)

_SECRET_FRAGMENTS = re.compile(
    r"(?i)(?:token|key|secret|auth|session|password|access_token|jwt|bearer|otp|pin|code)"
)


def purpose_limited_url(url: str) -> str:
    """Return a URL with secret-bearing query parameters and fragments redacted.

    This preserves the structural information Apollo needs (host, path, scheme) while
    protecting credentials, tokens and personal identifiers from unnecessary exposure.

    Raises ValueError if the URL appears to be primarily a credential carrier (all
    parameters are secret-bearing) — such a URL should not be followed or shared.
    """
    if not url or len(url) > 4096:
        raise ValueError("URL is empty or exceeds length limit.")
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https", ""):
        raise ValueError(f"Unsupported URL scheme: {parts.scheme}")
    # Strip credentials from netloc (user:pass@host → host)
    netloc = parts.hostname or parts.netloc
    if parts.port:
        netloc = f"{netloc}:{parts.port}"
    pairs = parse_qsl(parts.query, keep_blank_values=True)
    redacted = [(k, "[redacted]" if _SECRET_PARAMS.search(k) else v) for k, v in pairs]
    secret_count = sum(1 for k, v in redacted if v == "[redacted]")
    if secret_count and secret_count == len(redacted) and len(redacted) >= 2:
        raise ValueError("URL appears to be primarily a credential carrier. Do not follow or share.")
    new_query = urlencode(redacted)
    fragment = "" if parts.fragment and _SECRET_FRAGMENTS.search(parts.fragment) else parts.fragment
    # Also strip fragment if it contains any secret-bearing content
    if parts.username or parts.password:
        fragment = ""  # Credential-bearing URL — clear fragment for safety
    return urlunsplit((parts.scheme or "https", netloc, parts.path, new_query, fragment))


# ── Country/locale resolution ────────────────────────────────────────────────

def country_from_locale(locale: Optional[str] = None, country: Optional[str] = None) -> Optional[str]:
    """Extract a 2-letter country code from locale string or explicit country parameter."""
    if country and len(country) == 2:
        return country.upper()
    if locale:
        parts = locale.replace("-", "_").split("_")
        for part in reversed(parts):
            if len(part) == 2 and part.isalpha():
                return part.upper()
    return None


# ── Deterministic entity extraction ──────────────────────────────────────────

class InvestigationEntities(BaseModel):
    claimed_organisations: list[str] = Field(default_factory=list)
    sender_details: list[str] = Field(default_factory=list)
    sender_phone_numbers: list[str] = Field(default_factory=list)
    callback_details: list[str] = Field(default_factory=list)
    links: list[str] = Field(default_factory=list)
    requested_actions: list[str] = Field(default_factory=list)
    transaction_claims: list[str] = Field(default_factory=list)
    mentioned_names: list[str] = Field(default_factory=list)
    suspected_deception: list[str] = Field(default_factory=list)


def deterministic_entities(sender: str, text: str, urls: list[str],
                           claimed_brand: Optional[str] = None,
                           locale: Optional[str] = None,
                           country: Optional[str] = None) -> InvestigationEntities:
    """Extract observable entities from submitted content without AI inference.

    This is a deterministic observation — it does not assess risk or legitimacy.
    Results may supply evidence context to Magnum DI.
    """
    phone_numbers: list[str] = []
    lookup_country = country_from_locale(locale, country) or "AU"
    combined = f"{sender} {text}"
    for match in phonenumbers.PhoneNumberMatcher(combined, lookup_country):
        formatted = phonenumbers.format_number(match.number, phonenumbers.PhoneNumberFormat.E164)
        if formatted not in phone_numbers:
            phone_numbers.append(formatted)
    sender_phones = []
    for match in phonenumbers.PhoneNumberMatcher(sender, lookup_country):
        formatted = phonenumbers.format_number(match.number, phonenumbers.PhoneNumberFormat.E164)
        if formatted not in sender_phones:
            sender_phones.append(formatted)
    callback_phones = [p for p in phone_numbers if p not in sender_phones]
    return InvestigationEntities(
        claimed_organisations=[claimed_brand] if claimed_brand else [],
        sender_details=[sender.strip()] if sender.strip() else [],
        sender_phone_numbers=sender_phones,
        callback_details=callback_phones,
        links=list(dict.fromkeys(urls)),
    )


# ── Screenshot / image text extraction ───────────────────────────────────────

async def extract_message_screenshot(image_bytes: bytes) -> dict:
    """Extract text content from a screenshot/image using Gemini Vision.

    This is a text extraction observation, not an investigation.
    The extracted text may be supplied as evidence to Magnum DI.
    """
    prompt = (
        "Extract all visible text from this screenshot. Return JSON:\n"
        '{"text": "all visible text", "sender": "sender name/number if visible", '
        '"app": "messaging app name if identifiable", "timestamp": "message timestamp if visible"}\n'
        "Include ALL visible text. If a field is not visible, use empty string."
    )
    try:
        # The gateway takes one contents list: the instruction and the image travel together, the same
        # shape the page-screenshot reader uses. (An `images=` keyword is not part of the gateway and made
        # this path fail before Gemini was ever reached.)
        data, _meta = await generate_json(
            "You extract text from screenshots accurately and completely.",
            [types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"), types.Part(text=prompt)],
            model=VISION_MODEL, capability="vision", purpose=Purpose.PAGE_SIGNAL_EXTRACTION,
            correlation_id="screenshot-extract",
            trigger_source="vision_extract",
        )
        return {
            "text": redact_investigation_secrets(str(data.get("text", ""))),
            "sender": redact_investigation_secrets(str(data.get("sender", ""))),
            "app": str(data.get("app", "")),
            "timestamp": str(data.get("timestamp", "")),
            "extraction_status": "ok",
        }
    except ProviderFailure:
        return {"text": "", "sender": "", "app": "", "timestamp": "", "extraction_status": "failed"}
