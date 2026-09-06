"""Real controlled endpoint, post-resign (Elastic IP confirmed, bundle resigned with gd-m1-test-ed25519-001).

Spec:
- GET /api/config -> controlledEndpoint {host:'blocktest.btciq.app', ipv4:'52.25.179.131',
  url:'https://blocktest.btciq.app/', isPlaceholder:false}
- GET /api/rules/gd-m1-controlled-block/latest -> bundleVersion>17, exactly one block rule for blocktest.btciq.app
- POST /api/intelligence/lookup {url:'https://blocktest.btciq.app/x?t=1'} ->
  verdict='block', source='local-signed-rules', sanitizedUrl='https://blocktest.btciq.app/x'
"""
import os

import pytest
import requests

# Live read-only checks against the running backend (post-resign). Enable with GD_RUN_LIVE_TESTS=1.
pytestmark = pytest.mark.skipif(__import__("os").environ.get("GD_RUN_LIVE_TESTS") != "1", reason="live tests disabled by default")

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8001").rstrip("/")


@pytest.fixture
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# --- /api/config: real controlled endpoint, isPlaceholder=false ---
class TestConfigRealEndpoint:
    def test_controlled_endpoint_real(self, client):
        r = client.get(f"{BASE_URL}/api/config")
        assert r.status_code == 200, r.text
        ce = r.json()["controlledEndpoint"]
        assert ce == {
            "host": "blocktest.btciq.app",
            "ipv4": "52.25.179.131",
            "url": "https://blocktest.btciq.app/",
            "isPlaceholder": False,
        }


# --- /api/rules/.../latest: resigned bundle with the real host only ---
class TestBundleResigned:
    def test_bundle_version_and_hosts(self, client):
        r = client.get(f"{BASE_URL}/api/rules/gd-m1-controlled-block/latest")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["bundleVersion"] > 17, body["bundleVersion"]
        rules = body["payload"]["rules"]
        assert [(rule["host"], rule["action"]) for rule in rules] == [("blocktest.btciq.app", "block")], rules
        assert body["payloadHash"] == "2581666cc768e1e4e76962db0cc70e497e17e9b9cf4a5a997c8cfb091e6b90c9"
        # signature envelope must remain intact
        assert body["keyId"] == "gd-m1-test-ed25519-001"
        assert body["signature"]


# --- /api/intelligence/lookup: block from local signed rules for the real host ---
class TestIntelligenceLookupRealHost:
    def test_block_from_local_signed_rules(self, client):
        r = client.post(
            f"{BASE_URL}/api/intelligence/lookup",
            json={"url": "https://blocktest.btciq.app/x?t=1"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["verdict"] == "block", body
        assert body["source"] == "local-signed-rules", body
        assert body["sanitizedUrl"] == "https://blocktest.btciq.app/x", body
