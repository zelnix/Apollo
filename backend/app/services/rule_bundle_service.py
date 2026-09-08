"""Rule bundle workflow: validate -> version -> sign -> persist -> distribute."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.core.settings import Settings
from app.domain.models.rule_bundle import SignedRuleBundle, SignRequest, parse_iso_z
from app.domain.models.rule_entry import RuleEntry
from app.domain.validation.rule_conflicts import validate_and_canonicalize
from app.domain.validation.signing_guard import enforce_controlled_configuration
from app.repositories.rules_repository import RulesRepository
from app.services.key_registry_service import KeyRegistryService
from app.services.rule_signer import build_unsigned, sign_unsigned


class RuleBundleService:
    def __init__(self, settings: Settings, repo: RulesRepository, keys: KeyRegistryService):
        self._settings, self._repo, self._keys = settings, repo, keys

    async def sign_and_publish(self, request: SignRequest, now: datetime | None = None) -> SignedRuleBundle:
        rules = validate_and_canonicalize(request.rules)  # raises RuleValidationError
        enforce_controlled_configuration(self._settings, request.rulesetId, rules)  # raises SigningRefused
        issued = now or datetime.now(timezone.utc)
        expires = parse_iso_z(request.expiresAt) if request.expiresAt else issued + timedelta(days=self._settings.bundle_ttl_days)
        if expires <= issued:
            raise ValueError("expiresAt must be after issuedAt")
        key_id = request.keyId or self._keys.default_key_id
        version = (await self._repo.highest_version(request.rulesetId) or 0) + 1
        unsigned = build_unsigned(
            ruleset_id=request.rulesetId, bundle_version=version, key_id=key_id, rules=rules, issued_at=issued, expires_at=expires
        )
        signed = sign_unsigned(unsigned, self._keys.private_key(key_id))
        await self._repo.save(signed)
        return signed

    async def latest(self, ruleset_id: str) -> SignedRuleBundle | None:
        return await self._repo.latest(ruleset_id)

    async def versions(self, ruleset_id: str) -> list[dict]:
        return await self._repo.versions(ruleset_id)

    async def ensure_controlled_block_bundle(self) -> SignedRuleBundle:
        """Seed the M1 controlled-block bundle if the ruleset has no bundle yet.

        The controlled host comes from injected config, but the block still flows
        through the normal rule-authority chain (validated, versioned, signed).
        """
        existing = await self._repo.latest(self._settings.ruleset_id)
        if existing is not None:
            return existing
        request = SignRequest(
            rulesetId=self._settings.ruleset_id,
            confirm=True,
            rules=[RuleEntry(ruleId="m1-controlled-block-001", host=self._settings.controlled_host, action="block", category="controlled-test")],
        )
        return await self.sign_and_publish(request)

    async def local_verdict(self, host: str, ruleset_id: str | None = None) -> tuple[str | None, str | None, bool]:
        """Return (action, ruleId, expired) from the newest bundle of `ruleset_id`.

        `ruleset_id` defaults to the M1 controlled ruleset (existing behavior, unchanged) when omitted, so
        every existing caller keeps resolving against the same bundle as before. `expired=True` means a
        bundle exists but is past its `expiresAt`: distinct from "no bundle"/"no match" (both `expired=False`)
        so a caller can surface DEGRADED protection instead of silently treating expiry as "unknown".
        """
        bundle = await self._repo.latest(ruleset_id or self._settings.ruleset_id)
        if bundle is None:
            return None, None, False
        if parse_iso_z(bundle.expiresAt) <= datetime.now(timezone.utc):
            return None, None, True
        for rule in bundle.payload.rules:
            if rule.host == host:
                return rule.action, rule.ruleId, False
        return None, None, False
