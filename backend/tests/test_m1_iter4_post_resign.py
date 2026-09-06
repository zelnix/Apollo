"""Iteration 4 post-resign spec checks (bundle v25, single-rule controlled block).

Enabled with GD_RUN_LIVE_TESTS=1 like the other live suites. All checks are read-only;
POST /api/rules/sign is only exercised with confirm=false or an unrelated ruleset id to
avoid resigning the frozen M1 bundle.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os

import pytest
import requests
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

pytestmark = pytest.mark.skipif(
    os.environ.get("GD_RUN_LIVE_TESTS") != "1",
    reason="live tests disabled by default",
)

BASE_URL = os.environ.get(
    "EXPO_PUBLIC_BACKEND_URL",
    "https://guard-dog-m1.preview.emergentagent.com",
).rstrip("/")
ADMIN = {"X-GuardDog-Admin-Token": "m1-dev-admin-token-change-me"}
PINNED_PUB_001 = "ccf41NL6VHYQsH171Lw98hKiIoQFvAY0t171X4PL/ac="
PAYLOAD_HASH = "2581666cc768e1e4e76962db0cc70e497e17e9b9cf4a5a997c8cfb091e6b90c9"


def _jcs(value):
    if value is True or value is False or value is None or isinstance(value, str):
        return json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode()
    if isinstance(value, (int, float)):
        return json.dumps(value, separators=(",", ":")).encode()
    if isinstance(value, list):
        return b"[" + b",".join(_jcs(v) for v in value) + b"]"
    if isinstance(value, dict):
        return (
            b"{"
            + b",".join(_jcs(k) + b":" + _jcs(v) for k, v in sorted(value.items()))
            + b"}"
        )
    raise TypeError(type(value))


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


# --- /api/config: no secret material, controlled endpoint real ---
class TestConfig:
    def test_no_private_material_and_signing_metadata(self, s):
        r = s.get(f"{BASE_URL}/api/config")
        assert r.status_code == 200
        text = r.text
        for forbidden in ("privateKey", "privateKeyB64", "seed", "GD_ADMIN_TOKEN", "m1-dev-admin-token"):
            assert forbidden not in text, forbidden
        d = r.json()
        assert d["signing"]["enabled"] is True
        assert d["signing"]["requiresConfirm"] is True
        assert d["signing"]["allowedRulesets"] == ["gd-m1-controlled-block"]
        assert d["controlledEndpoint"] == {
            "host": "blocktest.btciq.app",
            "ipv4": "52.25.179.131",
            "url": "https://blocktest.btciq.app/",
            "isPlaceholder": False,
        }


# --- /api/rules/gd-m1-controlled-block/latest: v25 exact assertions + pinned pubkey verify ---
class TestBundleV25:
    def test_bundle_v25_exact_and_signature_verifies_with_pinned_pub(self, s):
        b = s.get(f"{BASE_URL}/api/rules/gd-m1-controlled-block/latest").json()
        assert b["bundleVersion"] == 25
        assert b["keyId"] == "gd-m1-test-ed25519-001"
        assert b["payloadHash"] == PAYLOAD_HASH
        rules = b["payload"]["rules"]
        assert len(rules) == 1
        assert rules[0]["ruleId"] == "m1-controlled-block-001"
        assert rules[0]["host"] == "blocktest.btciq.app"
        assert rules[0]["action"] == "block"

        # payloadHash == sha256(JCS(payload))
        assert hashlib.sha256(_jcs(b["payload"])).hexdigest() == PAYLOAD_HASH

        # Signature over JCS(unsigned envelope) using the PINNED public key
        pub = Ed25519PublicKey.from_public_bytes(base64.b64decode(PINNED_PUB_001))
        unsigned = {k: v for k, v in b.items() if k != "signature"}
        pub.verify(base64.b64decode(b["signature"]), _jcs(unsigned))


# --- /api/rules/.../versions: max bundleVersion is 25, no _id fields ---
class TestVersions:
    def test_max_version_25_no_mongo_id(self, s):
        r = s.get(f"{BASE_URL}/api/rules/gd-m1-controlled-block/versions")
        assert r.status_code == 200
        d = r.json()
        assert d["rulesetId"] == "gd-m1-controlled-block"
        vs = d["versions"]
        assert isinstance(vs, list) and vs
        for v in vs:
            assert "_id" not in v
        assert max(v["bundleVersion"] for v in vs) == 25


# --- /api/keys: 001 and 002 present, no private material ---
class TestKeys:
    def test_keys_pinned_and_no_private_material(self, s):
        keys = s.get(f"{BASE_URL}/api/keys").json()
        ids = {k["keyId"] for k in keys}
        assert "gd-m1-test-ed25519-001" in ids
        assert "gd-m1-test-ed25519-002" in ids
        for k in keys:
            assert k.get("publicKeyB64")
            for forbidden in ("privateKey", "privateKeyB64", "seed", "secret"):
                assert forbidden not in k
            if k["keyId"] == "gd-m1-test-ed25519-001":
                assert k["publicKeyB64"] == PINNED_PUB_001


# --- /api/intelligence/lookup ---
class TestIntelligence:
    def test_controlled_host_block_sanitized(self, s):
        r = s.post(
            f"{BASE_URL}/api/intelligence/lookup",
            json={"url": "https://BlockTest.BTCIQ.app/x?token=SECRET"},
        )
        assert r.status_code == 200
        d = r.json()
        assert d["verdict"] == "block"
        assert d["source"] == "local-signed-rules"
        assert d["sanitizedUrl"] == "https://blocktest.btciq.app/x"
        assert "SECRET" not in json.dumps(d)

    def test_unknown_host_unknown_degraded(self, s):
        r = s.post(
            f"{BASE_URL}/api/intelligence/lookup",
            json={"url": "https://not-in-any-ruleset.example/"},
        )
        d = r.json()
        assert d["verdict"] == "unknown"
        assert d["degraded"] is True


# --- Signing guards WITHOUT mutating the frozen v25 bundle ---
class TestSigningGuardsNonMutating:
    RULE = {"ruleId": "m1-controlled-block-001", "host": "blocktest.btciq.app", "action": "block"}

    def test_anonymous_is_401(self, s):
        r = s.post(
            f"{BASE_URL}/api/rules/sign",
            json={"rulesetId": "gd-m1-controlled-block", "confirm": False, "rules": [self.RULE]},
        )
        assert r.status_code == 401

    def test_wrong_token_is_401(self, s):
        r = s.post(
            f"{BASE_URL}/api/rules/sign",
            json={"rulesetId": "gd-m1-controlled-block", "confirm": False, "rules": [self.RULE]},
            headers={"X-GuardDog-Admin-Token": "not-the-real-token"},
        )
        assert r.status_code == 401

    def test_admin_without_confirm_is_409(self, s):
        r = s.post(
            f"{BASE_URL}/api/rules/sign",
            json={"rulesetId": "gd-m1-controlled-block", "confirm": False, "rules": [self.RULE]},
            headers=ADMIN,
        )
        assert r.status_code == 409
        assert r.json()["detail"]["code"] == "CONFIRMATION_REQUIRED"

    def test_other_ruleset_with_confirm_is_403(self, s):
        # Using confirm=True here is safe: the guard rejects before mutation because
        # 'gd-other-ruleset' is not on the allow-list.
        r = s.post(
            f"{BASE_URL}/api/rules/sign",
            json={
                "rulesetId": "gd-other-ruleset",
                "confirm": True,
                "rules": [{"ruleId": "x", "host": "x.example", "action": "block"}],
            },
            headers=ADMIN,
        )
        assert r.status_code == 403
        assert r.json()["detail"]["code"] == "RULESET_NOT_ALLOWED"

    def test_bundle_still_v25_after_guard_tests(self, s):
        b = s.get(f"{BASE_URL}/api/rules/gd-m1-controlled-block/latest").json()
        assert b["bundleVersion"] == 25, "guard tests must NOT bump the frozen v25 bundle"
