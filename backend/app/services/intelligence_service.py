"""M1 resolution order: local signed rules -> provider cache -> sanitized cloud lookup.

Failure behavior: provider unavailable => verdict 'unavailable', degraded=True.
Unresolved traffic is never auto-classified malicious (fail open, honest state).
"""
from __future__ import annotations

from app.core.logging import get_logger
from app.domain.models.provider_result import IntelligenceLookupResponse, ProviderResult
from app.domain.validation.normalization import sanitize_url
from app.providers.base import ProviderUnavailable, ThreatIntelligenceProvider
from app.services.provider_cache_service import ProviderCacheService, cache_key
from app.services.rule_bundle_service import RuleBundleService

log = get_logger("intelligence")


class IntelligenceService:
    def __init__(self, rules: RuleBundleService, cache: ProviderCacheService, provider: ThreatIntelligenceProvider):
        self._rules, self._cache, self._provider = rules, cache, provider

    async def lookup(self, raw_url: str) -> IntelligenceLookupResponse | None:
        sanitized = sanitize_url(raw_url)
        if sanitized is None:
            return None
        safe_url = sanitized.sanitized_url
        # Never log the URL; log only the hashed lookup key prefix.
        key_prefix = cache_key(safe_url)[:12]

        action, _rule_id = await self._rules.local_verdict(sanitized.host)
        if action is not None:
            log.info("lookup key=%s resolved by local-signed-rules", key_prefix)
            return IntelligenceLookupResponse(verdict=action, source="local-signed-rules", sanitizedUrl=safe_url)

        cached = await self._cache.get(safe_url)
        if cached is not None:
            log.info("lookup key=%s resolved by provider-cache", key_prefix)
            return _from_result(cached, "provider-cache", safe_url)

        if not self._provider.is_configured():
            log.info("lookup key=%s unresolved; provider not configured", key_prefix)
            return IntelligenceLookupResponse(verdict="unknown", source="none", sanitizedUrl=safe_url, degraded=True)

        try:
            result = await self._provider.lookup(safe_url)
        except ProviderUnavailable:
            log.warning("lookup key=%s provider unavailable", key_prefix)
            return IntelligenceLookupResponse(verdict="unavailable", source="none", sanitizedUrl=safe_url, degraded=True)
        await self._cache.put(safe_url, result)
        log.info("lookup key=%s resolved by cloud-provider", key_prefix)
        return _from_result(result, "cloud-provider", safe_url)


def _from_result(result: ProviderResult, source: str, safe_url: str) -> IntelligenceLookupResponse:
    return IntelligenceLookupResponse(
        verdict=result.verdict, source=source, threatCategories=result.threatCategories, ttlSeconds=result.ttlSeconds, sanitizedUrl=safe_url
    )
