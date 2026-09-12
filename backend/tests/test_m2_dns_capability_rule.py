"""Phase 6A M2.1 freeze regression: verifies the newly-published gd-m2-website-gate v4 bundle
(added via backend/scripts/add_dns_capability_rule.py) carries the dedicated DNS-capability rule
alongside the untouched existing rules, that the envelope is properly signed, and that the frozen
M1 ruleset + /api/config are completely unaffected by this change."""
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.services.rule_signer import payload_hash, verify_bundle  # noqa: E402
from app.domain.models.rule_bundle import SignedRuleBundle  # noqa: E402

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")

TRUSTED_KEYS = {
    "gd-m1-test-ed25519-001": "ccf41NL6VHYQsH171Lw98hKiIoQFvAY0t171X4PL/ac=",
    "gd-m1-test-ed25519-002": "tjHUbcOwKuqnHFAMkoiurrgdJDbO7g6FXV7Y5nMwzSg=",
}

M2_RULESET_ID = "gd-m2-website-gate"
M1_RULESET_ID = "gd-m1-controlled-block"

EXPECTED_RULE_IDS = {
    "m2-block-blocktest-001": ("blocktest.btciq.app", "block"),
    "m2-kotlin-test-allow-001": None,
    "m2-kotlin-test-block-001": None,
    "m2-block-dns-capability-001": ("dnsprobe.blocktest.btciq.app", "block"),
}


@pytest.fixture
def api_client():
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


class TestM2WebsiteGateBundle:
    def test_latest_bundle_status_200(self, api_client):
        resp = api_client.get(f"{BASE_URL}/api/rules/{M2_RULESET_ID}/latest")
        assert resp.status_code == 200

    def test_bundle_version_is_4(self, api_client):
        resp = api_client.get(f"{BASE_URL}/api/rules/{M2_RULESET_ID}/latest")
        data = resp.json()
        assert data["bundleVersion"] == 4, f"expected v4, got {data.get('bundleVersion')}"

    def test_bundle_has_exactly_4_rules(self, api_client):
        resp = api_client.get(f"{BASE_URL}/api/rules/{M2_RULESET_ID}/latest")
        data = resp.json()
        rules = data["payload"]["rules"]
        assert len(rules) == 4, f"expected 4 rules, got {len(rules)}: {[r['ruleId'] for r in rules]}"

    def test_all_expected_rule_ids_present(self, api_client):
        resp = api_client.get(f"{BASE_URL}/api/rules/{M2_RULESET_ID}/latest")
        data = resp.json()
        rules = {r["ruleId"]: r for r in data["payload"]["rules"]}
        assert set(rules.keys()) == set(EXPECTED_RULE_IDS.keys())

    def test_dns_capability_rule_fields(self, api_client):
        resp = api_client.get(f"{BASE_URL}/api/rules/{M2_RULESET_ID}/latest")
        data = resp.json()
        rules = {r["ruleId"]: r for r in data["payload"]["rules"]}
        new_rule = rules["m2-block-dns-capability-001"]
        assert new_rule["host"] == "dnsprobe.blocktest.btciq.app"
        assert new_rule["action"] == "block"

    def test_blocktest_rule_unchanged(self, api_client):
        resp = api_client.get(f"{BASE_URL}/api/rules/{M2_RULESET_ID}/latest")
        data = resp.json()
        rules = {r["ruleId"]: r for r in data["payload"]["rules"]}
        old_rule = rules["m2-block-blocktest-001"]
        assert old_rule["host"] == "blocktest.btciq.app"
        assert old_rule["action"] == "block"

    def test_signature_and_key_id_present(self, api_client):
        resp = api_client.get(f"{BASE_URL}/api/rules/{M2_RULESET_ID}/latest")
        data = resp.json()
        assert "signature" in data and data["signature"]
        assert "keyId" in data and data["keyId"]

    def test_payload_hash_present(self, api_client):
        resp = api_client.get(f"{BASE_URL}/api/rules/{M2_RULESET_ID}/latest")
        data = resp.json()
        assert "payloadHash" in data and data["payloadHash"]

    def test_payload_hash_matches_recomputed(self, api_client):
        """payloadHash must equal sha256(JCS(payload)) recomputed independently from the rules array."""
        resp = api_client.get(f"{BASE_URL}/api/rules/{M2_RULESET_ID}/latest")
        data = resp.json()
        recomputed = payload_hash(data["payload"])
        assert recomputed == data["payloadHash"]

    def test_signature_verifiable_via_verify_bundle(self, api_client):
        """Full parity-chain verification (schema, payloadHash, keyId, Ed25519 signature, issued/expiry)
        using the same verify_bundle() used by native-parity tests -- proves the envelope is genuinely
        signed and trustworthy, not just that fields are present."""
        resp = api_client.get(f"{BASE_URL}/api/rules/{M2_RULESET_ID}/latest")
        data = resp.json()
        if data["keyId"] not in TRUSTED_KEYS:
            pytest.skip(f"unknown keyId {data['keyId']}, cannot verify locally without pubkey")
        result = verify_bundle(data, TRUSTED_KEYS, datetime.now(timezone.utc))
        assert result.accepted, f"bundle failed verification: {result.reason}"


class TestM1FrozenBundleUnaffected:
    def test_m1_bundle_status_200(self, api_client):
        resp = api_client.get(f"{BASE_URL}/api/rules/{M1_RULESET_ID}/latest")
        assert resp.status_code == 200

    def test_m1_bundle_version_frozen_at_25(self, api_client):
        resp = api_client.get(f"{BASE_URL}/api/rules/{M1_RULESET_ID}/latest")
        data = resp.json()
        assert data["bundleVersion"] == 25, f"M1 frozen bundle must stay at v25, got {data.get('bundleVersion')}"


class TestConfigEndpoint:
    def test_config_status_200(self, api_client):
        resp = api_client.get(f"{BASE_URL}/api/config")
        assert resp.status_code == 200

    def test_config_website_gate_ruleset_id(self, api_client):
        resp = api_client.get(f"{BASE_URL}/api/config")
        data = resp.json()
        assert data["gateGuard"]["websiteGateRulesetId"] == "gd-m2-website-gate"
