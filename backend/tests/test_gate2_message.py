"""Gate 2 (local-first policy) tests.

Cloud screenshot extraction is intentionally disabled (403).
Message analyse accepts only minimal local-only payloads.
"""
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
    def test_raw_message_cloud_processing_is_blocked(self, s):
        body = {
            "device_id": "gate2test0001",
            "sender": "+61400000000",
            "text": "verify now",
            "urls": ["https://example.com/login"],
            "local_state": "barking",
            "scenario": "M02",
            "signals": ["urgency"],
            "claimed_brand": "CommBank",
            "second_opinion": True,
        }
        r = s.post(f"{API}/message/analyse", json=body, timeout=20)
        assert r.status_code == 403, r.text

    def test_local_only_payload_succeeds(self, s):
        body = {
            "device_id": "gate2test0001",
            "sender": "",
            "text": "[local-only]",
            "urls": ["https://testsafebrowsing.appspot.com/s/phishing.html"],
            "local_state": "growling",
            "scenario": "M_LOCAL",
            "signals": [],
            "claimed_brand": None,
            "second_opinion": False,
        }
        r = s.post(f"{API}/message/analyse", json=body, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data["urls"], list)
        assert data.get("gemini_used") is False


class TestMessageExtract:
    def test_screenshot_extract_is_intentionally_disabled(self, s):
        body = {"device_id": "gate2test0001", "image_base64": "A" * 200}
        r = s.post(f"{API}/message/extract", json=body, timeout=15)
        assert r.status_code == 403, r.text


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
            "why": ["local-only"],
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
