"""Apollo V1 iteration-6 backend tests: Emergent-managed push relay & non-blocking failure.

Covers:
- POST /api/register-push validation (short user_id, bad platform)
- POST /api/register-push in dev with EMERGENT_PUSH_KEY=placeholder -> 500 with expected detail
- POST /api/patrol/events with state=biting, background=true still returns 200 (push failure is non-blocking)
- background defaults to false when omitted
- Full pairing flow guardian fan-out (already covered by iter4 but re-verifies with new device_ids)
"""
import os
import time
import uuid
from datetime import datetime, timezone

import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
load_dotenv("/app/frontend/.env")

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


# ------------------------- /api/register-push validation ------------------------
class TestRegisterPushValidation:
    def test_short_user_id_returns_422(self, s):
        r = s.post(f"{API}/register-push", json={
            "user_id": "short",   # <8
            "platform": "android",
            "device_token": "tok-abc12345",
        })
        assert r.status_code == 422, r.text

    def test_bad_platform_returns_422(self, s):
        r = s.post(f"{API}/register-push", json={
            "user_id": "device-id-abcdef123",
            "platform": "windows",  # not android/ios
            "device_token": "tok-abc12345",
        })
        assert r.status_code == 422, r.text

    def test_short_device_token_returns_422(self, s):
        r = s.post(f"{API}/register-push", json={
            "user_id": "device-id-abcdef123",
            "platform": "android",
            "device_token": "abc",  # <8
        })
        assert r.status_code == 422, r.text


# ------------------------- /api/register-push placeholder key ------------------
class TestRegisterPushDev:
    def test_valid_body_returns_500_placeholder_key(self, s):
        """EMERGENT_PUSH_KEY=placeholder → 401 upstream → 500 with the specific detail."""
        r = s.post(f"{API}/register-push", json={
            "user_id": f"dev-{uuid.uuid4().hex[:12]}",
            "platform": "android",
            "device_token": f"tok-{uuid.uuid4().hex}",
        })
        assert r.status_code == 500, r.text
        assert r.json().get("detail") == "EMERGENT_PUSH_KEY missing or invalid"


# ------------------------- /api/patrol/events background field ------------------
class TestPatrolEventsBackground:
    def _payload(self, device_id: str, state: str, background=None):
        p = {
            "event_id": f"evt-{uuid.uuid4().hex[:12]}",
            "device_id": device_id,
            "category": "known_threat",
            "state": state,
            "status": "active",
            "headline": "Test event",
            "what_happened": "Testing.",
            "why": [],
            "what_to_do": "Investigate.",
            "indicator_host": "bad.example",
            "adapter_label": "test",
            "occurred_at": datetime.now(timezone.utc).isoformat(),
        }
        if background is not None:
            p["background"] = background
        return p

    def test_biting_with_background_true_returns_200_and_persists(self, s):
        dev = f"dev-{uuid.uuid4().hex[:12]}"
        payload = self._payload(dev, "biting", background=True)
        r = s.post(f"{API}/patrol/events", json=payload)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["background"] is True
        assert body["state"] == "biting"
        # GET verifies persistence
        g = s.get(f"{API}/patrol/events", params={"device_id": dev})
        assert g.status_code == 200
        ids = [e["event_id"] for e in g.json()]
        assert payload["event_id"] in ids

    def test_background_defaults_to_false_when_omitted(self, s):
        dev = f"dev-{uuid.uuid4().hex[:12]}"
        payload = self._payload(dev, "barking", background=None)
        r = s.post(f"{API}/patrol/events", json=payload)
        assert r.status_code == 200, r.text
        assert r.json()["background"] is False

    def test_barking_with_background_true_returns_200(self, s):
        """The push helper fires (non-blocking), but the API MUST still succeed."""
        dev = f"dev-{uuid.uuid4().hex[:12]}"
        r = s.post(f"{API}/patrol/events", json=self._payload(dev, "barking", background=True))
        assert r.status_code == 200, r.text


# ------------------------- Full family pairing + ack (iter6 re-verify) ----------
class TestFamilyPairingAndAck:
    state = {}
    DEV_P = f"iter6P-{uuid.uuid4().hex[:10]}"
    DEV_G = f"iter6G-{uuid.uuid4().hex[:10]}"

    def test_01_pair(self, s):
        r = s.post(f"{API}/family/pair", json={"device_id": self.DEV_P, "owner_name": "Mum"})
        assert r.status_code == 200, r.text
        code = r.json()["code"]
        assert len(code) == 6
        TestFamilyPairingAndAck.state["code"] = code

    def test_02_link(self, s):
        r = s.post(f"{API}/family/link", json={"device_id": self.DEV_G, "code": self.state["code"]})
        assert r.status_code == 200, r.text
        assert r.json()["linked"] is True
        assert r.json()["owner_name"] == "Mum"

    def test_03_patrol_event_and_fanout(self, s):
        eid = f"evt6-{uuid.uuid4().hex[:12]}"
        TestFamilyPairingAndAck.state["event_id"] = eid
        r = s.post(f"{API}/patrol/events", json={
            "event_id": eid, "device_id": self.DEV_P, "category": "known_threat",
            "state": "barking", "status": "active",
            "headline": "Suspicious link tapped", "what_happened": "Contacted blocklist host.",
            "why": ["blocklisted"], "what_to_do": "Check with family.",
            "indicator_host": "phishing.apollo.test", "adapter_label": "test",
            "occurred_at": datetime.now(timezone.utc).isoformat(),
        })
        assert r.status_code == 200, r.text
        # Fanout is a background task; poll up to ~5s
        for _ in range(6):
            time.sleep(1.0)
            g = s.get(f"{API}/family/shared-events", params={"device_id": self.DEV_G})
            assert g.status_code == 200
            evs = g.json()
            if any(e["event_id"] == eid for e in evs):
                return
        assert False, f"event not fanned out to guardian: {evs}"

    def test_04_ack_called_returns_label(self, s):
        eid = self.state["event_id"]
        r = s.post(f"{API}/family/shared-events/{eid}/ack",
                   json={"device_id": self.DEV_G, "reply": "called"})
        assert r.status_code == 200, r.text
        assert r.json() == {"acknowledged": True, "ack_label": "I called them"}

    def test_05_protected_sees_ack(self, s):
        eid = self.state["event_id"]
        r = s.get(f"{API}/family/acks", params={"device_id": self.DEV_P})
        assert r.status_code == 200
        match = [d for d in r.json() if d["event_id"] == eid]
        assert len(match) == 1
        assert match[0]["ack_label"] == "I called them"

    def test_06_shared_events_shows_acknowledged(self, s):
        eid = self.state["event_id"]
        r = s.get(f"{API}/family/shared-events", params={"device_id": self.DEV_G})
        assert r.status_code == 200
        match = [e for e in r.json() if e["event_id"] == eid]
        assert len(match) == 1
        assert match[0].get("acknowledged_at")
        assert match[0].get("ack_label") == "I called them"

    def test_07_ack_unknown_event_returns_404(self, s):
        r = s.post(f"{API}/family/shared-events/does-not-exist/ack",
                   json={"device_id": self.DEV_G, "reply": "called"})
        assert r.status_code == 404, r.text
