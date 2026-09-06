from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict

Verdict = Literal["block", "allow", "unknown", "unavailable"]
VerdictSource = Literal["local-signed-rules", "provider-cache", "cloud-provider", "none"]


class ProviderResult(BaseModel):
    """Provider-agnostic lookup outcome. No Google-specific concepts cross this boundary."""

    model_config = ConfigDict(extra="forbid")

    verdict: Verdict
    threatCategories: list[str] = []
    ttlSeconds: int = 0
    providerId: str = "none"


class IntelligenceLookupRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    url: str


class IntelligenceLookupResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    verdict: Verdict
    source: VerdictSource
    threatCategories: list[str] = []
    ttlSeconds: int = 0
    degraded: bool = False
    sanitizedUrl: str
