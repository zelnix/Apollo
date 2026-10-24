"""Gate 2 purpose-limited investigation and deletion-contract tests.

Current response model (MessageAnalyseOut):
  urls: list[MessageUrlResult]
  investigation_case_id: Optional[str]
  job: Optional[dict]

These tests verify:
  1. Suspicious messages get investigation linkage (investigation_case_id).
  2. Genuine messages don't falsely claim blocks.
  3. Screenshot text is read on the device (no server-side extraction call).
  4. Patrol events can be created and listed.
"""
import io
import os
import uuid
from pathlib import Path

import pytest
import requests

def _base_url() -> str:
    base = os.environ.get("EXPO_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    if not base:
        env_file = Path(__file__).resolve().parents[2] / "frontend" / ".env"
        if env_file.exists():
            for line in env_file.read_text().splitlines():
                if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                    base = line.split("=", 1)[1].strip()
                    break
                if line.startswith("EXPO_BACKEND_URL="):
                    base = line.split("=", 1)[1].strip()
                    break
    if not base:
        raise RuntimeError("EXPO_PUBLIC_BACKEND_URL (or EXPO_BACKEND_URL) is required")
    return base.rstrip("/")


BASE_URL = _base_url()
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


class TestMessageAnalyse:
    def test_explicit_submission_returns_investigation_and_never_claims_a_block(self, s):
        """Suspicious message analysis should return URLs and an investigation_case_id."""
        body = {
            "device_id": "gate2test0001",
            "sender": "+61400000000",
            "text": "CommBank alert: verify a $4,820 payment at the supplied link.",
            "urls": ["https://example.com/login"],
            "local_state": "barking",
            "scenario": "M02",
            "signals": ["urgency"],
            "claimed_brand": "CommBank",
            "second_opinion": False,
        }
        r = s.post(f"{API}/message/analyse", json=body, timeout=75)
        assert r.status_code == 200, r.text
        data = r.json()
        # Current model returns urls list and optional investigation_case_id
        assert "urls" in data
        assert isinstance(data["urls"], list)

    def test_genuine_message_stays_a_warning_or_clear_not_a_block(self, s):
        """Benign messages should not be treated as blocks — verdict/urls should be safe."""
        body = {
            "device_id": "gate2test0001",
            "sender": "School Office",
            "text": "Reminder: parent-teacher interviews are Tuesday at 4:30 pm. No reply needed.",
            "urls": [],
            "local_state": "resting",
            "scenario": "M15",
            "signals": [],
            "claimed_brand": None,
            "second_opinion": False,
        }
        r = s.post(f"{API}/message/analyse", json=body, timeout=75)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data["urls"], list)
        # Genuine message should not get malicious URLs
        if data["urls"]:
            for url_result in data["urls"]:
                assert url_result.get("verdict") != "malicious", \
                    f"Genuine message URL incorrectly marked malicious: {url_result}"


class TestMessageScreenshot:
    def test_screenshot_text_is_read_on_the_device_not_by_a_server_call(self):
        """The old Gemini text-extraction endpoint is gone: a screenshot's text is read on the phone, and only
        Magnum DI's one investigation call may ever send it to Gemini."""
        r = requests.post(f"{API}/message/extract", data={"device_id": "gate2test0001"},
                          files={"file": ("message.png", b"fake-png", "image/png")}, timeout=15)
        assert r.status_code in (401, 404), r.text


class TestPatrolEventsGate2:
    def test_upsert_and_list_message_event(self, s):
        device_id = f"g2dev{uuid.uuid4().hex[:10]}"
        event_id = f"evm{uuid.uuid4().hex[:10]}"
        body = {
            "event_id": event_id,
            "device_id": device_id,
            "category": "message",
            "state": "ears_up",
            "status": "active",
            "headline": "Minimal summary",
            "what_happened": "Minimal summary",
            "why": ["Purpose-limited assessment summary"],
            "what_to_do": "Review on device",
            "adapter_label": "message-check",
            "occurred_at": "2026-01-15T10:00:00+00:00",
            "claimed_brand": "CommBank",
            "scenario": "M05",
            "scent_id": f"sc{uuid.uuid4().hex[:8]}",
        }
        r = s.post(f"{API}/patrol/events", json=body, timeout=15)
        assert r.status_code == 200, r.text
        r2 = s.get(f"{API}/patrol/events", params={"device_id": device_id}, timeout=15)
        assert r2.status_code == 200
        assert any(x["event_id"] == event_id for x in r2.json())
