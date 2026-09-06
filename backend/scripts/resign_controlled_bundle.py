"""Re-sign the M1 controlled block bundle with gd-m1-test-ed25519-001 after injecting the real endpoint.

Usage: cd backend && python scripts/resign_controlled_bundle.py --confirm [--allow-placeholder]
Runs the same guarded workflow as POST /api/rules/sign (conflict validation, controlled-config check,
version increment). Never prints private key material.
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


async def main() -> int:
    s = get_settings()
    if s.controlled_endpoint_is_placeholder and "--allow-placeholder" not in sys.argv:
        print("REFUSED: placeholder endpoint; run verify_controlled_endpoint.py after injecting the real config")
        return 2
    request = SignRequest(
        rulesetId=s.ruleset_id,
        confirm="--confirm" in sys.argv,
        keyId=s.signing_key_id,
        rules=[RuleEntry(ruleId="m1-controlled-block-001", host=s.controlled_host, action="block", category="controlled-test")],
    )
    enforce_signing_preconditions(s, request)  # raises SigningRefused (e.g. CONFIRMATION_REQUIRED)
    client = AsyncIOMotorClient(s.mongo_url)
    db = client[s.db_name]
    keys = KeyRegistryService(s, KeyMetadataRepository(db))
    await keys.ensure_seeded()
    signed = await RuleBundleService(s, RulesRepository(db), keys).sign_and_publish(request)
    print(f"signed ruleset={signed.rulesetId} version={signed.bundleVersion} keyId={signed.keyId} payloadHash={signed.payloadHash}")
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
