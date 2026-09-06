"""Google Web Risk Lookup API adapter (uris:search), hidden behind ThreatIntelligenceProvider.

What leaves the backend: the sanitized URL only (no userinfo/query/fragment/port).
Never logs the URL. API key comes from env (WEBRISK_API_KEY) and is never persisted.
"""
from __future__ import annotations

import httpx

from app.core.logging import get_logger
from app.domain.models.provider_result import ProviderResult
from app.providers.base import ProviderUnavailable

log = get_logger("provider.webrisk")

ENDPOINT = "https://webrisk.googleapis.com/v1/uris:search"
THREAT_TYPES = ("MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE")
_CATEGORY_MAP = {"MALWARE": "malware", "SOCIAL_ENGINEERING": "phishing", "UNWANTED_SOFTWARE": "unwanted-software"}


class GoogleWebRiskProvider:
    provider_id = "google-webrisk"

    def __init__(self, api_key: str | None, timeout_seconds: float, default_ttl_seconds: int):
        self._api_key, self._timeout, self._default_ttl = api_key, timeout_seconds, default_ttl_seconds

    def is_configured(self) -> bool:
        return bool(self._api_key)

    async def lookup(self, sanitized_url: str) -> ProviderResult:
        if not self.is_configured():
            raise ProviderUnavailable("provider not configured")
        params: list[tuple[str, str]] = [("key", self._api_key or ""), ("uri", sanitized_url)]
        params += [("threatTypes", t) for t in THREAT_TYPES]
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                response = await client.get(ENDPOINT, params=params)
        except httpx.HTTPError as exc:
            log.warning("webrisk transport failure: %s", type(exc).__name__)
            raise ProviderUnavailable("transport") from exc

        if response.status_code in (429, 500, 503, 504):
            log.warning("webrisk unavailable status=%s", response.status_code)
            raise ProviderUnavailable(f"status {response.status_code}")
        if response.status_code in (400, 401, 403):
            log.error("webrisk configuration/auth failure status=%s", response.status_code)
            raise ProviderUnavailable(f"status {response.status_code}")
        if response.status_code != 200:
            raise ProviderUnavailable(f"status {response.status_code}")

        threat = (response.json() or {}).get("threat") or {}
        types = threat.get("threatTypes") or []
        if not types:
            return ProviderResult(verdict="allow", ttlSeconds=self._default_ttl, providerId=self.provider_id)
        return ProviderResult(
            verdict="block",
            threatCategories=sorted({_CATEGORY_MAP.get(t, "unknown-threat") for t in types}),
            ttlSeconds=_ttl_from_expire_time(threat.get("expireTime"), self._default_ttl),
            providerId=self.provider_id,
        )


def _ttl_from_expire_time(expire_time: str | None, fallback: int) -> int:
    if not expire_time:
        return fallback
    from datetime import datetime, timezone

    try:
        expires = datetime.fromisoformat(expire_time.replace("Z", "+00:00"))
    except ValueError:
        return fallback
    remaining = int((expires - datetime.now(timezone.utc)).total_seconds())
    return max(60, min(remaining, fallback)) if remaining > 0 else fallback
