"""Post-resign acceptance check for the M1 controlled bundle (AC-03 closure evidence).

Usage: cd backend && python scripts/verify_resigned_bundle.py [--min-version N] [--api http://localhost:8001]
Exit 0 only if every check passes. Writes docs/evidence/resigned-bundle-verification.json.
Never prints private key material.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core.settings import get_settings  # noqa: E402
from app.services.rule_signer import verify_bundle  # noqa: E402

PINNED = json.loads((ROOT / "security/test-vectors/signing/trusted_keys.json").read_text())["trustedKeys"]
OLD_PLACEHOLDER_HOSTS = {"m1-block-test.guarddog.example"}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--min-version", type=int, default=17, help="new bundleVersion must be strictly greater")
    ap.add_argument("--api", default="http://localhost:8001")
    args = ap.parse_args()
    s = get_settings()
    now = datetime.now(timezone.utc)

    config = httpx.get(f"{args.api}/api/config", timeout=10).json()
    bundle = httpx.get(f"{args.api}/api/rules/{s.ruleset_id}/latest", timeout=10).json()
    versions = httpx.get(f"{args.api}/api/rules/{s.ruleset_id}/versions", timeout=10)
    latest_listed = max((v["bundleVersion"] for v in versions.json()["versions"]), default=None) if versions.status_code == 200 else None

    rules = bundle["payload"]["rules"]
    block_rules = [r for r in rules if r["action"] == "block"]
    hosts = {r["host"] for r in rules}
    verification = verify_bundle(bundle, PINNED, now)
    issued = datetime.fromisoformat(bundle["issuedAt"].replace("Z", "+00:00"))
    expires = datetime.fromisoformat(bundle["expiresAt"].replace("Z", "+00:00"))

    checks = {
        "bundleVersion_gt_previous": bundle["bundleVersion"] > args.min_version,
        "rulesetId_is_m1_controlled": bundle["rulesetId"] == s.ruleset_id == "gd-m1-controlled-block",
        "keyId_is_gd_m1_test_ed25519_001": bundle["keyId"] == "gd-m1-test-ed25519-001",
        "block_host_is_controlled_host": block_rules and block_rules[0]["host"] == s.controlled_host == "blocktest.btciq.app",
        "old_placeholder_host_absent": not (hosts & OLD_PLACEHOLDER_HOSTS) and not any(h.endswith(".example") for h in hosts),
        "exactly_one_controlled_block_rule": len(block_rules) == 1 and len(rules) == 1 and block_rules[0]["ruleId"] == "m1-controlled-block-001",
        "signature_verifies_against_pinned_public_key": verification.accepted,
        "issuedAt_expiresAt_valid": issued <= now < expires,
        "config_isPlaceholder_false": config["controlledEndpoint"]["isPlaceholder"] is False and config["controlledEndpoint"]["host"] == s.controlled_host,
        "latest_endpoint_serves_new_version": latest_listed is None or latest_listed == bundle["bundleVersion"],
    }
    checks = {k: bool(v) for k, v in checks.items()}
    ok = all(checks.values())
    report = {
        "checkedAt": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "rulesetId": bundle["rulesetId"],
        "bundleVersion": bundle["bundleVersion"],
        "keyId": bundle["keyId"],
        "payloadHash": bundle["payloadHash"],
        "issuedAt": bundle["issuedAt"],
        "expiresAt": bundle["expiresAt"],
        "rules": rules,
        "controlledEndpoint": config["controlledEndpoint"],
        "verifyReason": None if verification.accepted else str(verification.reason),
        "checks": checks,
        "result": "PASS" if ok else "FAIL",
    }
    out = ROOT / "docs/evidence/resigned-bundle-verification.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2) + "\n")
    for k, v in checks.items():
        print(f"{'PASS' if v else 'FAIL'}  {k}")
    print(f"{report['result']}: bundle v{bundle['bundleVersion']} payloadHash={bundle['payloadHash']} -> {out.relative_to(ROOT)}")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
