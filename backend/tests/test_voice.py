# Higgins' voice — Gemini TTS: owner-scoped WAV, no public caching, legacy public mp3 removed (AR-15).
import os
import uuid

import pytest
import requests

BASE_URL = (os.environ.get("EXPO_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "http://localhost:8001").rstrip("/")


def _owner():
    r = requests.post(f"{BASE_URL}/api/devices/register", json={"platform": "web", "adapter_mode": "unsupported", "app_version": "1.0.0"}, timeout=20)
    r.raise_for_status()
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", "Authorization": f"Bearer {r.json()['device_token']}"})
    return s, r.json()["device_id"]


@pytest.fixture
def api():
    return _owner()


def test_speak_returns_owner_scoped_wav(api):
    s, device_id = api
    text = "Apollo is growling at this one. Something looks suspicious, though it is not yet confirmed."
    scope = uuid.uuid4().hex[:16]
    r = s.post(f"{BASE_URL}/api/voice/speak", json={"device_id": device_id, "text": text, "scope_id": scope}, timeout=90)
    assert r.status_code == 200, r.text
    url = r.json()["url"]
    assert url.startswith("/api/voice/") and url.endswith(".wav")
    a = s.get(f"{BASE_URL}{url}", timeout=30)
    assert a.status_code == 200 and a.headers["content-type"].startswith("audio/wav") and len(a.content) > 5000
    assert "no-store" in a.headers.get("cache-control", "")
    # Another owner cannot fetch it, even with the exact URL.
    other, _ = _owner()
    assert other.get(f"{BASE_URL}{url}", timeout=30).status_code == 404


def test_speak_validation(api):
    s, device_id = api
    assert s.post(f"{BASE_URL}/api/voice/speak", json={"device_id": device_id, "text": "🐕"}).status_code == 422  # emoji-only → nothing to say
    assert s.post(f"{BASE_URL}/api/voice/speak", json={"device_id": device_id, "text": "x" * 1501}).status_code == 422
    assert s.get(f"{BASE_URL}/api/voice/nope.mp3").status_code == 410  # legacy public narration removed
    assert s.get(f"{BASE_URL}/api/voice/{uuid.uuid4()}.wav").status_code == 404
