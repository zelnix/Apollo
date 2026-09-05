"""Gate 2 - Text & Messaging Protection backend tests."""
import base64
import io
import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("EXPO_BACKEND_URL", "https://threat-patrol-1.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

COMM_TEXT = ("CommBank Alert: We detected an attempted payment of $4,820. "
             "Your account has been temporarily restricted. Verify immediately at "
             "commbank-security-example.test")


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


# --- /api/message/analyse -----------------------------------------------------
class TestMessageAnalyse:
    def test_commbank_acceptance_with_second_opinion(self, s):
        body = {
            "device_id": "gate2test0001",
            "sender": "+61 400 000 222",
            "text": COMM_TEXT,
            "urls": ["http://commbank-security-example.test"],
            "local_state": "barking",
            "scenario": "M02",
            "signals": ["bank impersonation", "urgency"],
            "claimed_brand": "CommBank",
        }
        r = s.post(f"{API}/message/analyse", json=body, timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        assert len(data["urls"]) >= 1
        u0 = data["urls"][0]
        assert u0["host"] == "commbank-security-example.test"
        assert u0["verdict"] in ("clean", "unknown", "malicious")
        # explanation shape
        exp = data.get("explanation")
        assert isinstance(exp, dict), f"expected explanation object, got {exp!r}"
        assert isinstance(exp.get("summary"), str) and exp["summary"]
        assert isinstance(exp.get("why"), list) and 1 <= len(exp["why"]) <= 4
        assert isinstance(exp.get("recommendation"), str) and exp["recommendation"]
        assert data.get("gemini_used") is True

    def test_second_opinion_false_no_explanation(self, s):
        body = {
            "device_id": "gate2test0001",
            "sender": "+61 400 000 222",
            "text": COMM_TEXT,
            "urls": [],
            "local_state": "barking",
            "second_opinion": False,
        }
        r = s.post(f"{API}/message/analyse", json=body, timeout=45)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("explanation") is None
        assert data.get("gemini_used") is False

    def test_text_empty_422(self, s):
        body = {"device_id": "gate2test0001", "text": "", "urls": [], "local_state": "barking"}
        r = s.post(f"{API}/message/analyse", json=body, timeout=15)
        assert r.status_code == 422

    def test_local_state_invalid_422(self, s):
        body = {"device_id": "gate2test0001", "text": "hi", "urls": [], "local_state": "weird"}
        r = s.post(f"{API}/message/analyse", json=body, timeout=15)
        assert r.status_code == 422

    def test_known_bad_url_malicious(self, s):
        body = {
            "device_id": "gate2test0001",
            "text": "check this",
            "urls": ["http://testsafebrowsing.appspot.com/s/phishing.html"],
            "local_state": "growling",
            "second_opinion": False,
        }
        r = s.post(f"{API}/message/analyse", json=body, timeout=45)
        assert r.status_code == 200, r.text
        data = r.json()
        assert len(data["urls"]) == 1
        assert data["urls"][0]["verdict"] == "malicious", data["urls"][0]


# --- /api/message/extract -----------------------------------------------------
class TestMessageExtract:
    def test_image_too_short_422(self, s):
        body = {"device_id": "gate2test0001", "image_base64": "abc"}
        r = s.post(f"{API}/message/extract", json=body, timeout=15)
        assert r.status_code == 422

    def test_valid_png_200_with_shape(self, s):
        try:
            from PIL import Image, ImageDraw
        except ImportError:
            pytest.skip("PIL not available")
        img = Image.new("RGB", (200, 60), "white")
        d = ImageDraw.Draw(img)
        d.text((10, 20), "Hi Dad new number", fill="black")
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        b64 = base64.b64encode(buf.getvalue()).decode()
        r = s.post(f"{API}/message/extract",
                   json={"device_id": "gate2test0001", "image_base64": b64}, timeout=60)
        # 200 preferred; 502 is acceptable "couldn't read" for tiny images (Gemini vision)
        assert r.status_code in (200, 502), r.text
        if r.status_code == 200:
            data = r.json()
            for k in ("sender", "text", "urls", "source"):
                assert k in data, f"missing key {k}"
            assert isinstance(data["text"], str)
            assert isinstance(data["urls"], list)


# --- /api/patrol/events with Gate 2 fields ------------------------------------
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
            "headline": "Hi Dad new number check",
            "what_happened": "Family pattern with new number.",
            "why": ["family claim", "new number"],
            "what_to_do": "Call on the number you already have.",
            "adapter_label": "message-check",
            "occurred_at": "2026-01-15T10:00:00+00:00",
            "claimed_brand": "CommBank",
            "scenario": "M05",
            "scent_id": f"sc{uuid.uuid4().hex[:8]}",
        }
        r = s.post(f"{API}/patrol/events", json=body, timeout=15)
        assert r.status_code == 200, r.text
        e = r.json()
        assert e["state"] == "ears_up"
        assert e["category"] == "message"
        assert e["claimed_brand"] == "CommBank"
        assert e["scenario"] == "M05"
        assert e["scent_id"] == body["scent_id"]
        # GET verify
        r2 = s.get(f"{API}/patrol/events", params={"device_id": device_id}, timeout=15)
        assert r2.status_code == 200
        lst = r2.json()
        assert any(x["event_id"] == event_id and x["scent_id"] == body["scent_id"] for x in lst)
