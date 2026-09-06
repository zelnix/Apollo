# Higgins' voice — TTS endpoint: cached mp3 URL, served as audio/mpeg, validation.
import os, uuid
import pytest, requests

BASE_URL = (os.environ.get("EXPO_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://threat-patrol-1.preview.emergentagent.com").rstrip("/")


@pytest.fixture
def api():
    s = requests.Session(); s.headers.update({"Content-Type": "application/json", "User-Agent": "apollo-tests"}); return s


def test_speak_returns_playable_mp3_and_caches(api):
    text = "Apollo is growling at this one. Something looks suspicious, though it is not yet confirmed."
    r = api.post(f"{BASE_URL}/api/voice/speak", json={"device_id": f"dev{uuid.uuid4().hex[:10]}", "text": text}, timeout=60)
    assert r.status_code == 200, r.text
    url = r.json()["url"]
    assert url.startswith("/api/voice/") and url.endswith(".mp3")
    a = api.get(f"{BASE_URL}{url}", timeout=30)
    assert a.status_code == 200 and a.headers["content-type"].startswith("audio/mpeg") and len(a.content) > 5000
    # same text → same cached url (no second TTS call)
    assert api.post(f"{BASE_URL}/api/voice/speak", json={"device_id": f"dev{uuid.uuid4().hex[:10]}", "text": text}, timeout=60).json()["url"] == url


def test_speak_validation(api):
    assert api.post(f"{BASE_URL}/api/voice/speak", json={"device_id": "abcdefgh1234", "text": "https://only-a-link.example"}).status_code in (200, 422)  # link is replaced by 'a web address'
    assert api.post(f"{BASE_URL}/api/voice/speak", json={"device_id": "abcdefgh1234", "text": "🐕"}).status_code == 422  # emoji-only → nothing to say
    assert api.post(f"{BASE_URL}/api/voice/speak", json={"device_id": "abcdefgh1234", "text": "x" * 1501}).status_code == 422
    assert api.get(f"{BASE_URL}/api/voice/nope.mp3").status_code == 404
