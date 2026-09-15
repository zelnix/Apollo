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

Hostnames confirmed real/provisioned by the domain operator 2026-09: dnsprobe2-5.blocktest.btciq.app
are net-new subdomains, one each for the 4 automated/polling rows (dot-automatic, dot-strict,
doh-off, doh-on). "dot-off" is the domain operator's explicit exception -- it reuses the
pre-existing dnsprobe.blocktest.btciq.app rather than a 5th net-new host; the accepted risk (that
host may carry a stale cache entry from a prior M2.1 Phase 6A run) applies only to that one row.

Idempotent AND replace-in-place: EXPECTED_RULES is authoritative for its 5 ruleIds -- if the latest
bundle already carries the exact same 5 rules, this is a no-op; if any of those ruleIds previously
had a different host (e.g. this script's first run in 2026-09 published speculative `dnswiz-*`
placeholders before the domain operator confirmed the real hostnames above), that rule is replaced
in-place under a NEW bundle version rather than appended as a duplicate. Any other, unrelated
pre-existing rule under this ruleset is still carried forward byte-for-byte.

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

# One dedicated, never-reused hostname per wizard row -- confirmed real/provisioned by the domain
# operator 2026-09 (dnsprobe2-5 are net-new subdomains of blocktest.btciq.app; "dot-off" is the
# domain operator's explicit exception, reusing the pre-existing dnsprobe.blocktest.btciq.app
# instead of a 5th net-new host -- accepted risk: that host could carry a stale DNS cache entry
# from a prior M2.1 Phase 6A run, since it's shared with the frozen gd-m2-website-gate ruleset).
EXPECTED_RULES = [
    RuleEntry(ruleId="m2-dns-wizard-dot-off-001", host="dnsprobe.blocktest.btciq.app", action="block", category="test-malicious"),
    RuleEntry(ruleId="m2-dns-wizard-dot-automatic-001", host="dnsprobe2.blocktest.btciq.app", action="block", category="test-malicious"),
    RuleEntry(ruleId="m2-dns-wizard-dot-strict-001", host="dnsprobe3.blocktest.btciq.app", action="block", category="test-malicious"),
    RuleEntry(ruleId="m2-dns-wizard-doh-off-001", host="dnsprobe4.blocktest.btciq.app", action="block", category="test-malicious"),
    RuleEntry(ruleId="m2-dns-wizard-doh-on-001", host="dnsprobe5.blocktest.btciq.app", action="block", category="test-malicious"),
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
    prior_by_rule_id = {r.ruleId: r for r in (existing.payload.rules if existing else [])}
    expected_ids = {r.ruleId for r in EXPECTED_RULES}
    # EXPECTED_RULES is authoritative for its 5 ruleIds (replaces a placeholder host with the
    # domain operator's confirmed real host in-place); any OTHER pre-existing rule under this
    # ruleset (shouldn't normally happen) is carried forward byte-for-byte, unrelated to this fix.
    changed = [r for r in EXPECTED_RULES if prior_by_rule_id.get(r.ruleId) != r]
    extra_carried = [r for r in prior_by_rule_id.values() if r.ruleId not in expected_ids]
    final_rules = [*EXPECTED_RULES, *extra_carried]

    if existing is not None and not changed and not extra_carried:
        print(f"NO-OP: ruleset '{RULESET_ID}' v{existing.bundleVersion} already carries all 5 expected wizard rules -- nothing to do.")
        client.close()
        return 0

    request = SignRequest(
        rulesetId=RULESET_ID,
        confirm="--confirm" in sys.argv,
        keyId=existing.keyId if existing else None,  # None -> RuleBundleService uses the default signing key
        purpose="m2-website-gate-block",
        rules=final_rules,
    )
    enforce_signing_preconditions(s, request)  # raises SigningRefused (e.g. CONFIRMATION_REQUIRED, RULESET_NOT_ALLOWED)
    signed = await service.sign_and_publish(request)
    print(f"signed ruleset={signed.rulesetId} version={signed.bundleVersion} keyId={signed.keyId} rules={len(signed.payload.rules)} payloadHash={signed.payloadHash}")
    if extra_carried:
        print(f"carried forward unchanged: {[r.ruleId for r in extra_carried]}")
    print(f"replaced/confirmed: {[r.ruleId + ' -> ' + r.host for r in changed]}")
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
