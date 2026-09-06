"""Signing guard: signing is an administrative/test workflow, never a public production API.

Layers (all required):
  1. admin token (route dependency `require_admin`)
  2. GD_SIGNING_ENABLED must be true (distribution-only deployments set it false)
  3. explicit `confirm: true` in the request (human confirmation; not access control)
  4. rulesetId must be on the GD_SIGNING_ALLOWED_RULESETS allow-list
  5. for the M1 controlled ruleset the bundle must keep the controlled test configuration:
     exactly one `block` rule for the configured canonical controlled host, no `allow` for it,
     so the controlled block cannot be silently replaced.
"""
from __future__ import annotations

from dataclasses import dataclass

from app.core.settings import Settings
from app.domain.models.rule_bundle import SignRequest
from app.domain.models.rule_entry import RuleEntry
from app.domain.validation.normalization import canonicalize_host


@dataclass
class SigningRefused(Exception):
    status_code: int
    code: str
    detail: str

    def __str__(self) -> str:
        return f"{self.code}: {self.detail}"


def enforce_signing_preconditions(settings: Settings, request: SignRequest) -> None:
    if not settings.signing_enabled:
        raise SigningRefused(403, "SIGNING_DISABLED", "rule signing is disabled on this deployment")
    if request.confirm is not True:
        raise SigningRefused(409, "CONFIRMATION_REQUIRED", "set confirm=true to sign and publish a new bundle version")
    if request.rulesetId not in settings.signing_allowed_rulesets:
        raise SigningRefused(403, "RULESET_NOT_ALLOWED", f"rulesetId '{request.rulesetId}' is not on the signing allow-list")


def enforce_controlled_configuration(settings: Settings, ruleset_id: str, canonical_rules: list[RuleEntry]) -> None:
    if ruleset_id != settings.ruleset_id:
        return
    controlled = canonicalize_host(settings.controlled_host)
    if controlled is None:
        raise SigningRefused(500, "CONTROLLED_CONFIG_INVALID", "configured controlled host is not canonicalizable")
    blocks = [r for r in canonical_rules if r.host == controlled and r.action == "block"]
    allows = [r for r in canonical_rules if r.host == controlled and r.action == "allow"]
    if len(blocks) != 1 or allows:
        raise SigningRefused(
            422,
            "CONTROLLED_CONFIG_MISMATCH",
            f"M1 ruleset must contain exactly one block rule for the controlled host '{controlled}' and no allow rule for it",
        )
