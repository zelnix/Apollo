"""M1 integration tests hitting the live public backend URL end-to-end.
Covers health/config/rules/keys/intelligence and independent Ed25519+JCS signature verification."""
from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import uuid

import pytest
import requests
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from cryptography.exceptions import InvalidSignature

# public URL under test
BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://guard-dog-m1.preview.emergentagent.com").rstrip("/")
CONTROLLED_HOST = __import__("os").environ.get("GD_CONTROLLED_HOST", "blocktest.btciq.app")
# Live tests sign bundles against the RUNNING backend. Disabled by default so the controlled bundle is never
# resigned implicitly (final M1 signing waits for infrastructure confirmation). Enable with GD_RUN_LIVE_TESTS=1.
pytestmark = pytest.mark.skipif(__import__("os").environ.get("GD_RUN_LIVE_TESTS") != "1", reason="live signing tests disabled by default")
ADMIN_TOKEN = "m1-dev-admin-token-change-me"

HEX64 = re.compile(r"^[0-9a-f]{64}$")
B64_88 = re.compile(r"^[A-Za-z0-9+/]{86}==$")


# --- RFC 8785 minimal JCS canonicalization (matches backend spec) ---
def _jcs(value) -> bytes:
    if value is True or value is False or value is None or isinstance(value, str):
        return json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    if isinstance(value, (int, float)):
        return json.dumps(value, separators=(",", ":")).encode("utf-8")
    if isinstance(value, list):
        return b"[" + b",".join(_jcs(v) for v in value) + b"]"
    if isinstance(value, dict):
        items = sorted(value.items(), key=lambda kv: kv[0])
        return b"{" + b",".join(_jcs(k) + b":" + _jcs(v) for k, v in items) + b"}"
    raise TypeError(type(value))


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


# ---------- health / config ----------
class TestHealthConfig:
    def test_health(self, s):
        r = s.get(f"{BASE_URL}/api/health")
        assert r.status_code == 200
        d = r.json()
        assert d["status"] == "ok"
        assert d["provider"]["configured"] is False

    def test_config(self, s):
        r = s.get(f"{BASE_URL}/api/config")
        assert r.status_code == 200
        d = r.json()
        assert d["rulesetId"] == "gd-m1-controlled-block"
        assert d["controlledEndpoint"]["host"] == CONTROLLED_HOST
        assert d["controlledEndpoint"]["ipv4"] == "203.0.113.10"
        assert "url" in d["controlledEndpoint"]
        assert d["capabilities"]["android"]["dnsInterception"] is False
        assert d["capabilities"]["android"]["dohDotCoverage"] is False
        assert d["capabilities"]["android"]["quicHttp3Coverage"] is False
        assert d["capabilities"]["android"]["perAppAttribution"] is False


# ---------- rules ----------
class TestRules:
    def test_latest_bundle_and_independent_signature_verification(self, s):
        r = s.get(f"{BASE_URL}/api/rules/gd-m1-controlled-block/latest")
        assert r.status_code == 200
        b = r.json()
        assert b["schemaVersion"] == "1.0"
        assert b["keyId"] == "gd-m1-test-ed25519-001"
        assert HEX64.match(b["payloadHash"]), b["payloadHash"]
        assert len(b["signature"]) == 88 and B64_88.match(b["signature"]), b["signature"]
        assert b["payload"]["rules"][0]["host"] == CONTROLLED_HOST
        assert b["payload"]["rules"][0]["action"] == "block"

        # verify payloadHash = sha256(JCS(payload))
        computed_hash = hashlib.sha256(_jcs(b["payload"])).hexdigest()
        assert computed_hash == b["payloadHash"], "payloadHash mismatch (JCS parity)"

        # fetch key
        keys = s.get(f"{BASE_URL}/api/keys").json()
        pub_b64 = next(k["publicKeyB64"] for k in keys if k["keyId"] == b["keyId"])
        pub = Ed25519PublicKey.from_public_bytes(base64.b64decode(pub_b64))
        unsigned = {k: v for k, v in b.items() if k != "signature"}
        try:
            pub.verify(base64.b64decode(b["signature"]), _jcs(unsigned))
        except InvalidSignature:
            pytest.fail("Ed25519 signature failed to verify over JCS(unsigned envelope)")

    def test_latest_unknown_ruleset_404(self, s):
        assert s.get(f"{BASE_URL}/api/rules/unknown-ruleset/latest").status_code == 404

    def test_versions_no_mongo_id(self, s):
        r = s.get(f"{BASE_URL}/api/rules/gd-m1-controlled-block/versions")
        assert r.status_code == 200
        d = r.json()
        assert d["rulesetId"] == "gd-m1-controlled-block"
        assert isinstance(d["versions"], list) and len(d["versions"]) >= 1
        for v in d["versions"]:
            assert "bundleVersion" in v
            assert "_id" not in v

    def test_sign_requires_admin(self, s):
        r = s.post(
            f"{BASE_URL}/api/rules/sign",
            json={"rulesetId": "gd-m1-controlled-block", "rules": [{"ruleId": "t-x", "host": "x.example", "action": "block"}]},
        )
        assert r.status_code == 401

    def test_sign_success_and_canonicalization_and_version_increment(self, s):
        # NOTE: uses the controlled ruleset intentionally per test spec; test restores state at teardown.
        prev = s.get(f"{BASE_URL}/api/rules/gd-m1-controlled-block/latest").json()["bundleVersion"]
        body = {"rulesetId": "gd-m1-controlled-block", "confirm": True,
                "rules": [{"ruleId": "m1-controlled-block-001", "host": CONTROLLED_HOST, "action": "block"},
                          {"ruleId": f"t-{uuid.uuid4().hex[:6]}", "host": "Evil.Example.", "action": "block"}]}
        r = s.post(f"{BASE_URL}/api/rules/sign", json=body, headers={"X-GuardDog-Admin-Token": ADMIN_TOKEN})
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["bundleVersion"] == prev + 1
        assert any(rule["host"] == "evil.example" for rule in b["payload"]["rules"])
        # Restore controlled-host rule so live frontend continues to show "block" for the default URL.
        restore = {"rulesetId": "gd-m1-controlled-block", "confirm": True,
                   "rules": [{"ruleId": "m1-controlled-block-001", "host": CONTROLLED_HOST, "action": "block"}]}
        r2 = s.post(f"{BASE_URL}/api/rules/sign", json=restore, headers={"X-GuardDog-Admin-Token": ADMIN_TOKEN})
        assert r2.status_code == 200

    def test_sign_rule_conflict_422(self, s):
        body = {"rulesetId": "gd-m1-controlled-block", "confirm": True,
                "rules": [
                    {"ruleId": "c-1", "host": "a.example", "action": "block"},
                    {"ruleId": "c-2", "host": "A.EXAMPLE.", "action": "allow"},
                ]}
        r = s.post(f"{BASE_URL}/api/rules/sign", json=body, headers={"X-GuardDog-Admin-Token": ADMIN_TOKEN})
        assert r.status_code == 422, r.text
        detail = r.json()["detail"]
        assert detail["code"] == "RULE_CONFLICT"


# ---------- keys ----------
class TestKeys:
    def test_keys_list(self, s):
        r = s.get(f"{BASE_URL}/api/keys")
        assert r.status_code == 200
        keys = r.json()
        assert isinstance(keys, list) and len(keys) >= 1
        for k in keys:
            assert "publicKeyB64" in k and "status" in k and "keyId" in k
            # ensure no private material
            for forbidden in ("privateKey", "privateKeyB64", "seed", "secret"):
                assert forbidden not in k


# ---------- intelligence ----------
class TestIntelligence:
    def test_lookup_controlled_host_block_local_signed_rules(self, s):
        r = s.post(f"{BASE_URL}/api/intelligence/lookup",
                   json={"url": "https://M1-Block-Test.GuardDog.Example/x?token=SECRET"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["verdict"] == "block"
        assert d["source"] == "local-signed-rules"
        assert d["sanitizedUrl"] == "https://m1-block-test.guarddog.example/x"
        assert "SECRET" not in json.dumps(d)

    def test_lookup_unknown_host_unknown_degraded_fail_open(self, s):
        r = s.post(f"{BASE_URL}/api/intelligence/lookup",
                   json={"url": "https://unknown-host.example/p?t=1"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["verdict"] == "unknown"
        assert d["degraded"] is True
        assert d["source"] == "none"

    def test_lookup_invalid_scheme_422(self, s):
        r = s.post(f"{BASE_URL}/api/intelligence/lookup", json={"url": "javascript:alert(1)"})
        assert r.status_code == 422
