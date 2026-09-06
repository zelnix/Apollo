"""Iteration 3 review checks: real controlled endpoint injected without resigning.

Spec:
- GET /api/config -> controlledEndpoint {host:'blocktest.btciq.app', ipv4:'52.25.179.131',
  url:'https://blocktest.btciq.app/', isPlaceholder:false}
- GET /api/rules/gd-m1-controlled-block/latest -> bundleVersion=17 AND
  rule hosts do NOT include blocktest.btciq.app
- POST /api/intelligence/lookup {url:'https://blocktest.btciq.app/x?t=1'} ->
  verdict='unknown', degraded=true, sanitizedUrl='https://blocktest.btciq.app/x'
"""
import os

import pytest
import requests

# Live read-only checks against the running backend (pre-resign snapshot). Enable with GD_RUN_LIVE_TESTS=1.
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


# --- /api/rules/.../latest: v17 & real host absent (bundle intentionally not resigned) ---
class TestBundleFrozen:
    def test_bundle_version_and_hosts(self, client):
        r = client.get(f"{BASE_URL}/api/rules/gd-m1-controlled-block/latest")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["bundleVersion"] == 17, body["bundleVersion"]
        hosts = [rule["host"] for rule in body["payload"]["rules"]]
        assert "blocktest.btciq.app" not in hosts, hosts
        # signature envelope must remain intact
        assert body["keyId"] == "gd-m1-test-ed25519-001"
        assert body["signature"]


# --- /api/intelligence/lookup: unknown/degraded for real host (no signed rule yet) ---
class TestIntelligenceLookupRealHost:
    def test_unknown_degraded(self, client):
        r = client.post(
            f"{BASE_URL}/api/intelligence/lookup",
            json={"url": "https://blocktest.btciq.app/x?t=1"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["verdict"] == "unknown", body
        assert body["degraded"] is True, body
        assert body["sanitizedUrl"] == "https://blocktest.btciq.app/x", body
