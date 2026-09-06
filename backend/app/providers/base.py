"""Threat-intelligence provider abstraction.

Providers receive ONLY the sanitized URL (scheme + canonical host + path).
They return provider-agnostic ProviderResult values; provider-specific concepts
(e.g. Google threat type names) are mapped to neutral categories here.
"""
from __future__ import annotations

from typing import Protocol

from app.domain.models.provider_result import ProviderResult


class ThreatIntelligenceProvider(Protocol):
    provider_id: str

    def is_configured(self) -> bool: ...

    async def lookup(self, sanitized_url: str) -> ProviderResult: ...


class ProviderUnavailable(Exception):
    """Raised when the provider cannot answer (timeout, quota, 5xx, auth)."""
