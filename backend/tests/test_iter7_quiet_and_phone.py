"""Apollo V1 iteration-7 backend tests.

Covers:
- PUT /api/devices/{device_id}/settings (quiet_hours: enabled, start_minutes, end_minutes, tz_offset_minutes)
  echoes body; GET returns settings + quiet_now.
- Quiet-hours window computation:
    (a) window that includes current UTC time (tz_offset 0) -> quiet_now True
    (b) window that excludes it -> quiet_now False
    (c) overnight wrap (start 1320 -> end 420)
- Unknown device GET returns defaults (enabled False).
- POST /api/patrol/events: growling+background=True inside quiet_hours -> 200, log
  contains 'growling push suppressed by quiet hours'; barking+background=True -> 200,
  log contains 'owner push failed (non-blocking)' (i.e. not suppressed);
  growling+background=False -> 200 and NO push attempt for that state (no owner-push log line).
- POST /api/family/pair phone validation: valid AU number, invalid 'abc' -> 400,
  omitted phone -> 200.
- POST /api/family/link + GET /api/family/links -> i_watch[0].phone reflects owner phone.
- POST /api/family/links/phone -> overrides phone; unknown link -> 404.
- After a barking event on protected device, GET /api/family/shared-events for
  guardian -> items include protected_device_id and phone.
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
BACKEND_LOG = "/var/log/supervisor/backend.err.log"


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


def _log_tail(nbytes: int = 8000) -> str:
    try:
        with open(BACKEND_LOG, "rb") as f:
            f.seek(0, 2)
            size = f.tell()
            f.seek(max(0, size - nbytes))
            return f.read().decode("utf-8", errors="ignore")
    except FileNotFoundError:
        # try the other supervisor log name
        for alt in ("/var/log/supervisor/backend.out.log",):
            try:
                with open(alt, "rb") as f:
                    f.seek(0, 2)
                    size = f.tell()
                    f.seek(max(0, size - nbytes))
                    return f.read().decode("utf-8", errors="ignore")
            except FileNotFoundError:
                continue
        return ""


# --------------------------------------------------------------------- Quiet hours (settings CRUD)
class TestQuietHoursSettings:
    def test_unknown_device_returns_defaults(self, s):
        dev = f"dev-unset-{uuid.uuid4().hex[:10]}"
        r = s.get(f"{API}/devices/{dev}/settings")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["quiet_hours"]["enabled"] is False
        assert body["quiet_now"] is False

    def test_put_settings_echoes_body(self, s):
        dev = f"dev-set-{uuid.uuid4().hex[:10]}"
        payload = {"quiet_hours": {"enabled": True, "start_minutes": 1320,
                                    "end_minutes": 420, "tz_offset_minutes": 0}}
        r = s.put(f"{API}/devices/{dev}/settings", json=payload)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["quiet_hours"]["enabled"] is True
        assert body["quiet_hours"]["start_minutes"] == 1320
        assert body["quiet_hours"]["end_minutes"] == 420
        assert body["quiet_hours"]["tz_offset_minutes"] == 0

    def test_quiet_now_true_when_window_includes_current_utc(self, s):
        """Compute a start/end pair that surely brackets 'now'."""
        dev = f"dev-qn-t-{uuid.uuid4().hex[:10]}"
        now = datetime.now(timezone.utc)
        m = now.hour * 60 + now.minute
        start = (m - 60) % 1440
        end = (m + 60) % 1440
        payload = {"quiet_hours": {"enabled": True, "start_minutes": start,
                                    "end_minutes": end, "tz_offset_minutes": 0}}
        pr = s.put(f"{API}/devices/{dev}/settings", json=payload)
        assert pr.status_code == 200, pr.text
        g = s.get(f"{API}/devices/{dev}/settings")
        assert g.status_code == 200
        body = g.json()
        assert body["quiet_now"] is True, body

    def test_quiet_now_false_when_window_excludes_current_utc(self, s):
        dev = f"dev-qn-f-{uuid.uuid4().hex[:10]}"
        now = datetime.now(timezone.utc)
        m = now.hour * 60 + now.minute
        # A 60-minute window well away from 'now'
        start = (m + 240) % 1440
        end = (m + 300) % 1440
        payload = {"quiet_hours": {"enabled": True, "start_minutes": start,
                                    "end_minutes": end, "tz_offset_minutes": 0}}
        pr = s.put(f"{API}/devices/{dev}/settings", json=payload)
        assert pr.status_code == 200, pr.text
        g = s.get(f"{API}/devices/{dev}/settings")
        assert g.status_code == 200
        assert g.json()["quiet_now"] is False

    def test_overnight_wrap_1320_to_420(self, s):
        """Verify that server handles start>end (overnight). We can't force wall-clock,
        but we CAN ensure the endpoint accepts the payload and echoes it."""
        dev = f"dev-wrap-{uuid.uuid4().hex[:10]}"
        payload = {"quiet_hours": {"enabled": True, "start_minutes": 1320,
                                    "end_minutes": 420, "tz_offset_minutes": 0}}
        pr = s.put(f"{API}/devices/{dev}/settings", json=payload)
        assert pr.status_code == 200
        g = s.get(f"{API}/devices/{dev}/settings")
        body = g.json()
        assert body["quiet_hours"]["start_minutes"] == 1320
        assert body["quiet_hours"]["end_minutes"] == 420
        # quiet_now must be a boolean regardless of local time (proves wrap didn't crash)
        assert isinstance(body["quiet_now"], bool)


# --------------------------------------------------------------------- Patrol events + push suppression
class TestPatrolPushSuppression:
    def _payload(self, device_id: str, state: str, background=None):
        p = {
            "event_id": f"evt-{uuid.uuid4().hex[:12]}",
            "device_id": device_id,
            "category": "known_threat",
            "state": state,
            "status": "active",
            "headline": "Quiet-hours test",
            "what_happened": "Testing suppression",
            "why": [],
            "what_to_do": "Investigate",
            "indicator_host": "quiet.example",
            "adapter_label": "test",
            "occurred_at": datetime.now(timezone.utc).isoformat(),
        }
        if background is not None:
            p["background"] = background
        return p

    def _enable_quiet_now(self, s, dev):
        now = datetime.now(timezone.utc)
        m = now.hour * 60 + now.minute
        start = (m - 60) % 1440
        end = (m + 60) % 1440
        r = s.put(f"{API}/devices/{dev}/settings", json={"quiet_hours": {
            "enabled": True, "start_minutes": start, "end_minutes": end,
            "tz_offset_minutes": 0
        }})
        assert r.status_code == 200
        # sanity
        assert s.get(f"{API}/devices/{dev}/settings").json()["quiet_now"] is True

    def test_growling_bg_true_in_quiet_hours_suppressed(self, s):
        dev = f"dev-qh-grow-{uuid.uuid4().hex[:10]}"
        self._enable_quiet_now(s, dev)
        before = _log_tail()
        r = s.post(f"{API}/patrol/events", json=self._payload(dev, "growling", True))
        assert r.status_code == 200, r.text
        # allow background task to run
        time.sleep(1.5)
        after = _log_tail()
        added = after[len(before):] if after.startswith(before) else after
        assert "growling push suppressed by quiet hours" in added, added[-1500:]

    def test_barking_bg_true_in_quiet_hours_not_suppressed(self, s):
        dev = f"dev-qh-bark-{uuid.uuid4().hex[:10]}"
        self._enable_quiet_now(s, dev)
        before = _log_tail()
        r = s.post(f"{API}/patrol/events", json=self._payload(dev, "barking", True))
        assert r.status_code == 200, r.text
        time.sleep(1.5)
        after = _log_tail()
        added = after[len(before):] if after.startswith(before) else after
        # barking must NOT be suppressed; because EMERGENT_PUSH_KEY=placeholder, we
        # expect the non-blocking failure log line to be emitted.
        assert "owner push failed (non-blocking)" in added, added[-1500:]

    def test_growling_bg_false_no_push_attempt(self, s):
        dev = f"dev-qh-grow-fg-{uuid.uuid4().hex[:10]}"
        # Disable quiet hours to isolate the background=False branch
        s.put(f"{API}/devices/{dev}/settings", json={"quiet_hours": {
            "enabled": False, "start_minutes": 1320, "end_minutes": 420,
            "tz_offset_minutes": 0
        }})
        before = _log_tail()
        r = s.post(f"{API}/patrol/events", json=self._payload(dev, "growling", False))
        assert r.status_code == 200, r.text
        time.sleep(1.5)
        after = _log_tail()
        added = after[len(before):] if after.startswith(before) else after
        # No owner-push side-effects at all for foreground growling
        assert "owner push failed (non-blocking)" not in added, added[-1500:]
        assert "growling push suppressed by quiet hours" not in added


# --------------------------------------------------------------------- Family pair phone validation
class TestFamilyPairPhone:
    DEV_A = f"iter7A-{uuid.uuid4().hex[:10]}"
    DEV_B = f"iter7B-{uuid.uuid4().hex[:10]}"
    state = {}

    def test_pair_valid_phone(self, s):
        r = s.post(f"{API}/family/pair", json={
            "device_id": self.DEV_A, "owner_name": "Mum",
            "phone": "+61 400 123 456"
        })
        assert r.status_code == 200, r.text
        code = r.json()["code"]
        assert len(code) == 6
        TestFamilyPairPhone.state["code"] = code

    def test_pair_invalid_phone_400(self, s):
        r = s.post(f"{API}/family/pair", json={
            "device_id": f"pair-bad-{uuid.uuid4().hex[:8]}", "owner_name": "X",
            "phone": "abc"
        })
        assert r.status_code == 400, r.text
        assert r.json()["detail"] == "Enter a valid phone number"

    def test_pair_omitted_phone_ok(self, s):
        r = s.post(f"{API}/family/pair", json={
            "device_id": f"pair-ok-{uuid.uuid4().hex[:8]}", "owner_name": "Y"
        })
        assert r.status_code == 200, r.text

    def test_link_and_links_includes_phone(self, s):
        r = s.post(f"{API}/family/link", json={
            "device_id": self.DEV_B, "code": self.state["code"]
        })
        assert r.status_code == 200, r.text
        # GET links from guardian side
        g = s.get(f"{API}/family/links", params={"device_id": self.DEV_B})
        assert g.status_code == 200
        i_watch = g.json()["i_watch"]
        assert len(i_watch) >= 1
        row = next(x for x in i_watch if x["protected_device_id"] == self.DEV_A)
        assert row["phone"] == "+61 400 123 456"

    def test_override_phone_success(self, s):
        r = s.post(f"{API}/family/links/phone", json={
            "device_id": self.DEV_B, "protected_device_id": self.DEV_A,
            "phone": "0411 222 333"
        })
        assert r.status_code == 200, r.text
        assert r.json()["phone"] == "0411 222 333"
        g = s.get(f"{API}/family/links", params={"device_id": self.DEV_B})
        row = next(x for x in g.json()["i_watch"] if x["protected_device_id"] == self.DEV_A)
        assert row["phone"] == "0411 222 333"

    def test_override_phone_unknown_link_404(self, s):
        r = s.post(f"{API}/family/links/phone", json={
            "device_id": self.DEV_B,
            "protected_device_id": f"nolink-{uuid.uuid4().hex[:10]}",
            "phone": "0411 222 333"
        })
        assert r.status_code == 404, r.text

    def test_shared_event_has_protected_id_and_phone(self, s):
        eid = f"evt7-{uuid.uuid4().hex[:12]}"
        r = s.post(f"{API}/patrol/events", json={
            "event_id": eid, "device_id": self.DEV_A, "category": "known_threat",
            "state": "barking", "status": "active",
            "headline": "Test bark", "what_happened": "trigger",
            "why": [], "what_to_do": "Check.",
            "indicator_host": "phishing.apollo.test", "adapter_label": "test",
            "occurred_at": datetime.now(timezone.utc).isoformat(),
        })
        assert r.status_code == 200, r.text
        # wait for fanout
        found = None
        for _ in range(6):
            time.sleep(1.0)
            g = s.get(f"{API}/family/shared-events", params={"device_id": self.DEV_B})
            assert g.status_code == 200
            match = [e for e in g.json() if e["event_id"] == eid]
            if match:
                found = match[0]
                break
        assert found, "shared event never fanned out"
        assert found.get("protected_device_id") == self.DEV_A
        # phone should be the guardian override
        assert found.get("phone") == "0411 222 333"
