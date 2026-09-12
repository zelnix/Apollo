"""Add the dedicated, isolated Row 4.1 (DNS-capability check) block rule to the M2 Website Gate
ruleset (`gd-m2-website-gate`) as an additive new bundle version.

Why: the automated Phase 6A harness's DNS-capability check (row 4.1) used to re-probe the SAME
host as rows 1.1/1.2/3.x (`blocktest.btciq.app`), so leftover background retries from those
earlier rows could land inside row 4.1's own observation window and contaminate its verdict. This
script provisions a completely separate, dedicated, signed block rule
(`m2-block-dns-capability-001` -> `dnsprobe.blocktest.btciq.app`) so row 4.1's evidence can never
be confused with any other row's traffic. See phase6AutomatedHarness.ts's runDnsCapabilityCheck for
the matching frontend attribution fix.

Idempotent + additive only: every existing rule in the current latest `gd-m2-website-gate` bundle
(including `m2-block-blocktest-001` -> `blocktest.btciq.app`, which rows 1.1-3.5 depend on and must
NEVER change) is carried forward byte-for-byte into the new version; this script only ever appends
the one new rule, never removes or edits an existing one. If the dedicated rule already exists in
the latest bundle, this is a no-op.

Usage: cd backend && python scripts/add_dns_capability_rule.py --confirm
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

DNS_CAPABILITY_RULE_ID = "m2-block-dns-capability-001"
DNS_CAPABILITY_HOST = "dnsprobe.blocktest.btciq.app"


async def main() -> int:
    s = get_settings()
    ruleset_id = s.website_gate_ruleset_id
    client = AsyncIOMotorClient(s.mongo_url)
    db = client[s.db_name]
    keys = KeyRegistryService(s, KeyMetadataRepository(db))
    await keys.ensure_seeded()
    repo = RulesRepository(db)
    service = RuleBundleService(s, repo, keys)

    existing = await repo.latest(ruleset_id)
    if existing is None:
        print(f"REFUSED: no existing bundle for ruleset '{ruleset_id}' -- expected the frozen "
              f"m2-block-blocktest-001 bundle to already exist (rows 1.1-3.5 depend on it).")
        client.close()
        return 2

    already_present = any(r.ruleId == DNS_CAPABILITY_RULE_ID or r.host == DNS_CAPABILITY_HOST for r in existing.payload.rules)
    if already_present:
        print(f"NO-OP: ruleset '{ruleset_id}' v{existing.bundleVersion} already carries "
              f"{DNS_CAPABILITY_RULE_ID} / {DNS_CAPABILITY_HOST} -- nothing to do.")
        client.close()
        return 0

    # Carry every existing rule forward byte-for-byte; append only the one new dedicated rule.
    carried_rules = [RuleEntry(**r.model_dump()) for r in existing.payload.rules]
    new_rule = RuleEntry(ruleId=DNS_CAPABILITY_RULE_ID, host=DNS_CAPABILITY_HOST, action="block", category="test-malicious")

    request = SignRequest(
        rulesetId=ruleset_id,
        confirm="--confirm" in sys.argv,
        keyId=existing.keyId,
        purpose="m2-website-gate-block",
        rules=[*carried_rules, new_rule],
    )
    enforce_signing_preconditions(s, request)  # raises SigningRefused (e.g. CONFIRMATION_REQUIRED)
    signed = await service.sign_and_publish(request)
    print(f"signed ruleset={signed.rulesetId} version={signed.bundleVersion} keyId={signed.keyId} "
          f"rules={len(signed.payload.rules)} payloadHash={signed.payloadHash}")
    print(f"carried forward unchanged: {[r.ruleId for r in carried_rules]}")
    print(f"added: {new_rule.ruleId} -> {new_rule.host}")
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
