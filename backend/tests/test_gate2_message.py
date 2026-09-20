"""Gate 2 purpose-limited investigation and deletion-contract tests."""
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
    def test_explicit_submission_returns_higgins_and_never_claims_a_block(self, s):
        body = {
            "device_id": "gate2test0001",
            "sender": "+61400000000",
            "text": "CommBank alert: verify a $4,820 payment at the supplied link.",
            "urls": ["https://example.com/login"],
            "local_state": "barking",
            "scenario": "M02",
            "signals": ["urgency"],
            "claimed_brand": "CommBank",
            "second_opinion": True,
        }
        r = s.post(f"{API}/message/analyse", json=body, timeout=75)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["assessment"]["higgins"]["next_action"]
        assert data["assessment"]["processing"]["raw_retained_by_apollo"] is False
        assert "packet" not in data["assessment"]["higgins"]["exact_response"].lower()

    def test_genuine_message_stays_a_warning_or_clear_not_a_block(self, s):
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
        assert data["assessment"]["risk"] in ("clear", "uncertain", "warning")
        assert "blocked" not in data["assessment"]["higgins"]["exact_response"].lower()


class TestMessageExtract:
    def test_screenshot_upload_rejects_non_image(self):
        r = requests.post(f"{API}/message/extract", data={"device_id": "gate2test0001"},
                          files={"file": ("message.txt", b"not an image", "text/plain")}, timeout=15)
        assert r.status_code == 415, r.text

    def test_realistic_screenshot_is_extracted_request_scoped(self):
        from PIL import Image, ImageDraw
        image = Image.new("RGB", (1000, 420), "white")
        draw = ImageDraw.Draw(image)
        draw.rectangle((20, 20, 980, 400), outline="black", width=4)
        draw.text((55, 70), "CommBank Alert", fill="black")
        draw.text((55, 150), "A $4,820 payment was detected.", fill="black")
        draw.text((55, 230), "Visit commbank-secure-verify.xyz now", fill="black")
        buf = io.BytesIO(); image.save(buf, format="PNG")
        r = requests.post(f"{API}/message/extract", data={"device_id": "gate2test0001"},
                          files={"file": ("message.png", buf.getvalue(), "image/png")}, timeout=90)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "CommBank" in data["text"] or "commbank" in " ".join(data["urls"]).lower()
        assert data["processing"]["raw_retained_by_apollo"] is False


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
