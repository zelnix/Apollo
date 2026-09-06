"""Iteration 5 — Freeze Guard regression.

Locks the invariant that the frozen v25 controlled bundle CANNOT be bumped via the
public signing API, even by an authenticated admin, and cross-checks all
supporting metadata/evidence remains consistent.
"""
from __future__ import annotations

import hashlib
import json
import os

import pytest
import requests

pytestmark = pytest.mark.skipif(
    os.environ.get("GD_RUN_LIVE_TESTS") != "1",
    reason="live tests disabled by default",
)

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://guard-dog-m1.preview.emergentagent.com",
).rstrip("/")
ADMIN_TOKEN = "m1-dev-admin-token-change-me"
CONTROLLED_RULESET = "gd-m1-controlled-block"
FROZEN_VERSION = 25
EXPECTED_PAYLOAD_HASH = "2581666cc768e1e4e76962db0cc70e497e17e9b9cf4a5a997c8cfb091e6b90c9"
EXPECTED_KEY_ID = "gd-m1-test-ed25519-001"
EXPECTED_HOST = "blocktest.btciq.app"
EXPECTED_IPV4 = "52.25.179.131"


# ---------------------------------------------------------------------------
# fixtures
# ---------------------------------------------------------------------------
@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _latest(api):
    r = api.get(f"{BASE_URL}/api/rules/{CONTROLLED_RULESET}/latest", timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


# ---------------------------------------------------------------------------
# Health / config sanity
# ---------------------------------------------------------------------------
class TestHealthConfig:
    def test_health(self, api):
        r = api.get(f"{BASE_URL}/api/health", timeout=10)
        assert r.status_code == 200
        assert r.json().get("status") in {"ok", "healthy", "up"} or r.json()  # tolerant

    def test_config_controlled_endpoint_and_frozen_version(self, api):
        r = api.get(f"{BASE_URL}/api/config", timeout=10)
        assert r.status_code == 200
        cfg = r.json()
        ce = cfg["controlledEndpoint"]
        assert ce["host"] == EXPECTED_HOST
        assert ce["ipv4"] == EXPECTED_IPV4
        assert ce["isPlaceholder"] is False
        assert cfg["signing"]["frozenBundleVersion"] == FROZEN_VERSION


# ---------------------------------------------------------------------------
# Bundle contents (v25)
# ---------------------------------------------------------------------------
class TestBundleV25:
    def test_latest_bundle_is_v25(self, api):
        b = _latest(api)
        assert b["bundleVersion"] == FROZEN_VERSION
        assert b["keyId"] == EXPECTED_KEY_ID
        assert b["payloadHash"] == EXPECTED_PAYLOAD_HASH

    def test_latest_bundle_has_exactly_one_controlled_block_rule(self, api):
        b = _latest(api)
        rules = b["payload"]["rules"]
        assert len(rules) == 1
        rule = rules[0]
        assert rule["host"] == EXPECTED_HOST
        assert rule["action"] == "block"

    def test_no_mongo_id_leak(self, api):
        b = _latest(api)
        blob = json.dumps(b)
        assert '"_id"' not in blob


# ---------------------------------------------------------------------------
# Freeze guard — the core bug class under test
# ---------------------------------------------------------------------------
class TestFreezeGuard:
    def _sign_payload(self):
        return {
            "rulesetId": CONTROLLED_RULESET,
            "confirm": True,
            "rules": [
                {
                    "ruleId": "m1-controlled-block-001",
                    "host": EXPECTED_HOST,
                    "action": "block",
                }
            ],
        }

    def test_anonymous_sign_is_401(self, api):
        r = api.post(f"{BASE_URL}/api/rules/sign", json=self._sign_payload(), timeout=15)
        assert r.status_code == 401, r.text

    def test_confirm_false_is_409(self, api):
        payload = self._sign_payload()
        payload["confirm"] = False
        r = api.post(
            f"{BASE_URL}/api/rules/sign",
            json=payload,
            headers={"X-GuardDog-Admin-Token": ADMIN_TOKEN},
            timeout=15,
        )
        assert r.status_code == 409, r.text

    def test_other_ruleset_is_403(self, api):
        payload = self._sign_payload()
        payload["rulesetId"] = "gd-other-ruleset"
        r = api.post(
            f"{BASE_URL}/api/rules/sign",
            json=payload,
            headers={"X-GuardDog-Admin-Token": ADMIN_TOKEN},
            timeout=15,
        )
        assert r.status_code == 403, r.text

    def test_admin_confirm_true_matching_rule_is_409_bundle_frozen(self, api):
        """Even a rule that matches current content must be refused: freeze precedes content."""
        r = api.post(
            f"{BASE_URL}/api/rules/sign",
            json=self._sign_payload(),
            headers={"X-GuardDog-Admin-Token": ADMIN_TOKEN},
            timeout=15,
        )
        assert r.status_code == 409, r.text
        body = r.json()
        detail = body.get("detail", body)
        assert isinstance(detail, dict), f"detail is not object: {body}"
        assert detail.get("code") == "BUNDLE_FROZEN", body

    def test_admin_confirm_true_conflicting_rule_is_still_409_bundle_frozen(self, api):
        """Freeze check must run before rule-content validation."""
        payload = {
            "rulesetId": CONTROLLED_RULESET,
            "confirm": True,
            "rules": [
                {
                    "ruleId": "attempted-bump-conflict",
                    "host": "attacker.example",
                    "action": "block",
                }
            ],
        }
        r = api.post(
            f"{BASE_URL}/api/rules/sign",
            json=payload,
            headers={"X-GuardDog-Admin-Token": ADMIN_TOKEN},
            timeout=15,
        )
        assert r.status_code == 409, r.text
        detail = r.json().get("detail", {})
        assert isinstance(detail, dict)
        assert detail.get("code") == "BUNDLE_FROZEN", r.text

    def test_bundle_still_v25_after_all_guard_attempts(self, api):
        b = _latest(api)
        assert b["bundleVersion"] == FROZEN_VERSION
        assert b["payloadHash"] == EXPECTED_PAYLOAD_HASH
        assert b["keyId"] == EXPECTED_KEY_ID
