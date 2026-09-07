# External admin console — separate trust boundary (X-Admin-Key shared secret), never mixed with device bearer auth.
import os, uuid
from pathlib import Path

import pytest, requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
BASE_URL = (os.environ.get("EXPO_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://threat-patrol-1.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
KEY = os.environ.get("APOLLO_ADMIN_KEY", "")
H = {"User-Agent": "apollo-tests", "X-Apollo-Raw": "1"}
ADMIN = {**H, "X-Admin-Key": KEY}

pytestmark = pytest.mark.skipif(not KEY, reason="APOLLO_ADMIN_KEY not configured")


def _device():
    r = requests.post(f"{API}/devices/register", json={"platform": "web", "adapter_mode": "mock"}, headers=H)
    return r.json()["device_id"], r.json()["device_token"]


class TestAdminKeyBoundary:
    def test_missing_and_wrong_key_are_generic_401(self):
        assert requests.get(f"{API}/admin/ping", headers=H).status_code == 401
        r = requests.get(f"{API}/admin/ping", headers={**H, "X-Admin-Key": KEY[:-1] + ("x" if KEY[-1] != "x" else "y")})
        assert r.status_code == 401 and r.json()["detail"] == "Invalid admin credentials."
        assert requests.get(f"{API}/admin/ping", headers={**H, "X-Admin-Key": ""}).status_code == 401

    def test_right_key_works(self):
        r = requests.get(f"{API}/admin/ping", headers=ADMIN)
        assert r.status_code == 200 and r.json()["ok"] is True

    def test_device_bearer_cannot_open_admin(self):
        _, tok = _device()
        assert requests.get(f"{API}/admin/ping", headers={**H, "Authorization": f"Bearer {tok}"}).status_code == 401

    def test_admin_key_cannot_open_device_routes(self):
        assert requests.get(f"{API}/devices/me", headers=ADMIN).status_code == 401
        assert requests.get(f"{API}/patrol/events?device_id=abcdefgh12345678", headers=ADMIN).status_code == 401


class TestAdminOperations:
    def test_stats_shape(self):
        j = requests.get(f"{API}/admin/stats", headers=ADMIN).json()
        assert {"devices", "events_7d", "blocklist", "feedback", "family", "intel"} <= set(j)
        assert j["devices"]["total"] >= j["devices"]["active_credentials"]

    def test_devices_listing_never_leaks_token_hashes(self):
        did, _ = _device()
        rows = requests.get(f"{API}/admin/devices?limit=500", headers=ADMIN).json()
        assert all("token_hash" not in r for r in rows)
        one = requests.get(f"{API}/admin/devices/{did}", headers=ADMIN).json()
        assert one["device_id"] == did and "token_hash" not in one and one["patrol_events"] == 0

    def test_revoke_from_console_kills_the_device_credential(self):
        did, tok = _device()
        dev = {**H, "Authorization": f"Bearer {tok}"}
        assert requests.get(f"{API}/devices/me", headers=dev).status_code == 200
        assert requests.post(f"{API}/admin/devices/{did}/revoke", headers=ADMIN).status_code == 204
        r = requests.get(f"{API}/devices/me", headers=dev)
        assert r.status_code == 401 and "WWW-Authenticate" in r.headers  # app enters the explicit re-register state
        assert requests.post(f"{API}/admin/devices/{did}/revoke", headers=ADMIN).status_code == 404
        assert requests.post(f"{API}/admin/devices/no-such-device/revoke", headers=ADMIN).status_code == 404

    def test_blocklist_add_changes_verdicts_immediately_and_remove_restores(self):
        host = f"console-{uuid.uuid4().hex[:8]}.apollo.test"
        did, tok = _device()
        dev = {**H, "Authorization": f"Bearer {tok}"}
        check = lambda: requests.post(f"{API}/intel/check", json={"indicator_type": "url", "value": f"https://{host}/login", "device_id": did}, headers=dev).json()  # noqa: E731
        assert check()["verdict"] != "malicious"
        r = requests.post(f"{API}/admin/blocklist", json={"host": host, "threat_type": "SOCIAL_ENGINEERING", "reason": "console test"}, headers=ADMIN)
        assert r.status_code == 201 and r.json()["host"] == host
        assert any(e["host"] == host for e in requests.get(f"{API}/admin/blocklist", headers=ADMIN).json())
        j = check()
        assert j["verdict"] == "malicious" and j["cached"] is False
        assert requests.delete(f"{API}/admin/blocklist/{host}", headers=ADMIN).status_code == 204
        assert check()["verdict"] != "malicious"
        assert requests.delete(f"{API}/admin/blocklist/{host}", headers=ADMIN).status_code == 404

    def test_blocklist_rejects_non_domains(self):
        for bad in ["not a host", "http://x.y", "localhost", "a..b"]:
            assert requests.post(f"{API}/admin/blocklist", json={"host": bad, "reason": "bad input"}, headers=ADMIN).status_code == 422

    def test_feedback_listing(self):
        r = requests.get(f"{API}/admin/feedback?limit=5", headers=ADMIN)
        assert r.status_code == 200 and isinstance(r.json(), list)
