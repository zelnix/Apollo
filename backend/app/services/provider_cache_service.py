"""TTL cache for provider verdicts. Keyed by sha256(sanitizedUrl); raw URLs never persisted."""
from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone

from app.domain.models.provider_result import ProviderResult
from app.repositories.provider_cache_repository import ProviderCacheRepository


def cache_key(sanitized_url: str) -> str:
    return hashlib.sha256(sanitized_url.encode("utf-8")).hexdigest()


class ProviderCacheService:
    def __init__(self, repo: ProviderCacheRepository, default_ttl_seconds: int):
        self._repo, self._default_ttl = repo, default_ttl_seconds

    async def get(self, sanitized_url: str, now: datetime | None = None) -> ProviderResult | None:
        now = now or datetime.now(timezone.utc)
        doc = await self._repo.get(cache_key(sanitized_url))
        if doc is None:
            return None
        expires_at = datetime.fromisoformat(doc["expiresAt"])
        if expires_at <= now:
            return None
        remaining = int((expires_at - now).total_seconds())
        return ProviderResult(verdict=doc["verdict"], threatCategories=doc["threatCategories"], ttlSeconds=remaining, providerId=doc["providerId"])

    async def put(self, sanitized_url: str, result: ProviderResult, now: datetime | None = None) -> None:
        if result.verdict in ("unknown", "unavailable"):
            return  # never cache non-answers as if they were verdicts
        now = now or datetime.now(timezone.utc)
        ttl = result.ttlSeconds or self._default_ttl
        await self._repo.put(
            cache_key(sanitized_url),
            {
                "verdict": result.verdict,
                "threatCategories": result.threatCategories,
                "providerId": result.providerId,
                "expiresAt": (now + timedelta(seconds=ttl)).isoformat(),
                "cachedAt": now.isoformat(),
            },
        )
