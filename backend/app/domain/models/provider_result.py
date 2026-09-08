from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict

Verdict = Literal["block", "allow", "warn", "unknown", "unavailable"]
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
    # Optional: which signed ruleset's local rules to consult first. Defaults to the M1 controlled
    # ruleset (existing behavior, unchanged) when omitted. Gate Guard M2 callers pass the website-gate
    # ruleset id explicitly; this never mutates or reads the M1 bundle differently than before.
    rulesetId: str | None = None


class IntelligenceLookupResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    verdict: Verdict
    source: VerdictSource
    threatCategories: list[str] = []
    ttlSeconds: int = 0
    degraded: bool = False
    sanitizedUrl: str
    # True when the consulted ruleset has a bundle that exists but is past its expiresAt. Distinct from
    # "no rule matched": an expired local ruleset must surface as degraded, never as a silent pass-through
    # that looks identical to "nothing local says anything about this host".
    localRulesExpired: bool = False
