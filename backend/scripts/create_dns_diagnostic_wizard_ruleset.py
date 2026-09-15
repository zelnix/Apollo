"""Create/maintain the DNS/DoH Capability Diagnostic Wizard's OWN dedicated ruleset
(`gd-m2-dns-diagnostic-wizard`) -- deliberately SEPARATE from the frozen M2.1 `gd-m2-website-gate`
bundle (frozen at v4; never touched by this script).

Why a separate ruleset, and why 5 distinct hosts instead of 1: a physical-device review found that
every wizard row (Private DNS Off/Automatic/Strict, browser DoH Off/On) previously re-probed the
SAME hostname (`dnsprobe.blocktest.btciq.app`, the frozen M2.1 row-4.1 host). If an earlier row's
probe genuinely bypassed Apollo and resolved that hostname, the OS/DNS resolver could cache that
answer; a LATER row could then reuse the cached IP without a fresh over-the-wire lookup, making it
falsely LOOK like a bypass happened under that later row's configuration when no new DNS query
actually occurred. Giving each row its own, never-reused hostname makes that cross-row cache reuse
structurally impossible. The M2.1 v4 bundle/`m2-block-dns-capability-001` rule stays completely
untouched -- this is a brand-new, independent ruleset with its own version history.

Idempotent: if the latest bundle for this ruleset already carries all 5 expected rules, this is a
no-op. If it exists but is missing some (e.g. a prior partial run), the existing rules are carried
forward byte-for-byte and only the missing ones are appended, exactly like
add_dns_capability_rule.py's carry-forward pattern for the (unrelated, untouched) M2.1 bundle.

Usage: cd backend && python scripts/create_dns_diagnostic_wizard_ruleset.py --confirm
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

from motor.motor_asyncio import AsyncIOMotorClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core.settings import get_settings  # noqa: E402
from app.domain.models.rule_bundle import SignRequest  # noqa: E402
from app.domain.models.rule_entry import RuleEntry  # noqa: E402
from app.domain.validation.signing_guard import enforce_signing_preconditions  # noqa: E402
from app.repositories.key_metadata_repository import KeyMetadataRepository  # noqa: E402
from app.repositories.rules_repository import RulesRepository  # noqa: E402
from app.services.key_registry_service import KeyRegistryService  # noqa: E402
from app.services.rule_bundle_service import RuleBundleService  # noqa: E402

RULESET_ID = "gd-m2-dns-diagnostic-wizard"

# One dedicated, never-shared hostname per wizard row. Single-level subdomains of
# `blocktest.btciq.app` (same domain the frozen M1/M2 controlled endpoints already use) so they can
# reuse that domain's existing wildcard DNS/TLS coverage if one exists -- confirm with the domain
# operator before the physical-device run; see docs/dns-capability-characterization.md §1a.
EXPECTED_RULES = [
    RuleEntry(ruleId="m2-dns-wizard-dot-off-001", host="dnswiz-dot-off.blocktest.btciq.app", action="block", category="test-malicious"),
    RuleEntry(ruleId="m2-dns-wizard-dot-automatic-001", host="dnswiz-dot-automatic.blocktest.btciq.app", action="block", category="test-malicious"),
    RuleEntry(ruleId="m2-dns-wizard-dot-strict-001", host="dnswiz-dot-strict.blocktest.btciq.app", action="block", category="test-malicious"),
    RuleEntry(ruleId="m2-dns-wizard-doh-off-001", host="dnswiz-doh-off.blocktest.btciq.app", action="block", category="test-malicious"),
    RuleEntry(ruleId="m2-dns-wizard-doh-on-001", host="dnswiz-doh-on.blocktest.btciq.app", action="block", category="test-malicious"),
]


async def main() -> int:
    s = get_settings()
    client = AsyncIOMotorClient(s.mongo_url)
    db = client[s.db_name]
    keys = KeyRegistryService(s, KeyMetadataRepository(db))
    await keys.ensure_seeded()
    repo = RulesRepository(db)
    service = RuleBundleService(s, repo, keys)

    existing = await repo.latest(RULESET_ID)
    carried_rules = list(existing.payload.rules) if existing else []
    have = {(r.ruleId, r.host) for r in carried_rules}
    missing = [r for r in EXPECTED_RULES if (r.ruleId, r.host) not in have]

    if existing is not None and not missing:
        print(f"NO-OP: ruleset '{RULESET_ID}' v{existing.bundleVersion} already carries all 5 expected wizard rules -- nothing to do.")
        client.close()
        return 0

    request = SignRequest(
        rulesetId=RULESET_ID,
        confirm="--confirm" in sys.argv,
        keyId=existing.keyId if existing else None,  # None -> RuleBundleService uses the default signing key
        purpose="m2-website-gate-block",
        rules=[*carried_rules, *missing],
    )
    enforce_signing_preconditions(s, request)  # raises SigningRefused (e.g. CONFIRMATION_REQUIRED, RULESET_NOT_ALLOWED)
    signed = await service.sign_and_publish(request)
    print(f"signed ruleset={signed.rulesetId} version={signed.bundleVersion} keyId={signed.keyId} rules={len(signed.payload.rules)} payloadHash={signed.payloadHash}")
    if carried_rules:
        print(f"carried forward unchanged: {[r.ruleId for r in carried_rules]}")
    print(f"added: {[r.ruleId + ' -> ' + r.host for r in missing]}")
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
