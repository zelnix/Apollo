# Guardian Voice Note — audio in Emergent Object Storage, ownership in MongoDB, playback via expiring HMAC ticket URL.
import os, time, uuid
from datetime import datetime, timezone

import requests

BASE_URL = (os.environ.get("EXPO_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://threat-patrol-1.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
H = {"User-Agent": "apollo-tests", "X-Apollo-Raw": "1"}


class Dev:
    def __init__(self):
        j = requests.post(f"{API}/devices/register", json={"platform": "web", "adapter_mode": "mock"}, headers=H).json()
        self.id, self.tok = j["device_id"], j["device_token"]
        self.h = {**H, "Authorization": f"Bearer {self.tok}"}
    def post(self, p, **kw): return requests.post(f"{API}{p}", headers={**self.h, **kw.pop("headers", {})}, **kw)
    def get(self, p, **kw): return requests.get(f"{API}{p}", headers=self.h, **kw)


def paired_incident():
    p, g = Dev(), Dev()
    code = p.post("/family/pair", json={"device_id": p.id, "owner_name": "Mum"}).json()["code"]
    assert g.post("/family/link", json={"device_id": g.id, "code": code, "guardian_name": "Sarah"}).status_code == 200
    scent = f"scent-{uuid.uuid4().hex[:10]}"
    r = p.post("/family/incidents/share", json={"device_id": p.id, "scent_id": scent, "headline": "Fake bank text", "state": "barking", "events": [], "steps": []})
    assert r.status_code in (200, 201), r.text
    return p, g, scent


def wav_bytes(seconds=1.0):
    import struct
    n = int(8000 * seconds); data = b"".join(struct.pack("<h", 0) for _ in range(n))
    return b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 1, 1, 8000, 16000, 2, 16) + b"data" + struct.pack("<I", len(data)) + data


class TestVoiceNote:
    def test_guardian_records_and_mum_can_play_with_a_ticket(self):
        p, g, scent = paired_incident()
        r = g.post(f"/family/incidents/{scent}/voice", data={"device_id": g.id, "from_name": "Sarah", "duration_s": "1.0"}, files={"file": ("note.wav", wav_bytes(), "audio/wav")})
        assert r.status_code == 201, r.text
        note = r.json()
        assert note["kind"] == "voice" and note["guardian_label"] == "Sarah" and note["duration_s"] == 1.0 and "audio_path" not in note
        # listed for both sides, storage path never exposed
        notes = p.get(f"/family/incidents/{scent}/notes", params={"device_id": p.id}).json()
        assert any(n["note_id"] == note["note_id"] and n["kind"] == "voice" and "audio_path" not in n for n in notes)
        t = p.get(f"/family/voice/{note['note_id']}/ticket", params={"device_id": p.id})
        assert t.status_code == 200, t.text
        url = t.json()["url"]
        assert "/api/family/voice-play/" in url and "exp=" in url and "sig=" in url and "Bearer" not in url and g.tok not in url and p.tok not in url
        play = requests.get(url, headers=H)  # public, ticketed: no bearer needed (web <audio> can't send headers)
        assert play.status_code == 200 and play.headers["content-type"].startswith("audio/wav") and play.content == wav_bytes()
        assert g.get(f"/family/voice/{note['note_id']}/ticket", params={"device_id": g.id}).status_code == 200  # guardian can replay their own

    def test_tickets_are_note_bound_and_expire_and_strangers_get_nothing(self):
        p, g, scent = paired_incident()
        note = g.post(f"/family/incidents/{scent}/voice", data={"device_id": g.id, "duration_s": "1"}, files={"file": ("n.wav", wav_bytes(), "audio/wav")}).json()
        url = p.get(f"/family/voice/{note['note_id']}/ticket", params={"device_id": p.id}).json()["url"]
        base, qs = url.split("?")
        sig = dict(kv.split("=") for kv in qs.split("&"))["sig"]; exp = dict(kv.split("=") for kv in qs.split("&"))["exp"]
        assert requests.get(f"{base}?exp={exp}&sig={'0' * 32}", headers=H).status_code == 403                 # forged sig
        assert requests.get(f"{base}?exp={int(exp) + 1}&sig={sig}", headers=H).status_code == 403             # tampered expiry
        assert requests.get(f"{base}?exp={int(time.time()) - 5}&sig={sig}", headers=H).status_code == 403     # expired
        assert requests.get(f"{base.rsplit('/', 1)[0]}/other?exp={exp}&sig={sig}", headers=H).status_code == 403  # other note
        stranger = Dev()
        assert stranger.get(f"/family/voice/{note['note_id']}/ticket", params={"device_id": stranger.id}).status_code == 404
        assert requests.get(f"{API}/family/voice/{note['note_id']}/ticket", params={"device_id": p.id}, headers=H).status_code == 401  # no bearer

    def test_upload_guardrails(self):
        p, g, scent = paired_incident()
        big = wav_bytes(70)  # > 1 MB
        assert g.post(f"/family/incidents/{scent}/voice", data={"device_id": g.id, "duration_s": "70"}, files={"file": ("n.wav", big, "audio/wav")}).status_code == 422  # duration > 30
        assert g.post(f"/family/incidents/{scent}/voice", data={"device_id": g.id, "duration_s": "20"}, files={"file": ("n.wav", big, "audio/wav")}).status_code == 413
        assert g.post(f"/family/incidents/{scent}/voice", data={"device_id": g.id, "duration_s": "1"}, files={"file": ("n.txt", b"hello", "text/plain")}).status_code == 415
        assert g.post(f"/family/incidents/{scent}/voice", data={"device_id": g.id, "duration_s": "1"}, files={"file": ("n.wav", b"RIFF", "audio/wav")}).status_code == 422
        # the form's device_id must be the bearer's own device
        other = Dev()
        assert g.post(f"/family/incidents/{scent}/voice", data={"device_id": other.id, "duration_s": "1"}, files={"file": ("n.wav", wav_bytes(), "audio/wav")}).status_code == 403
        # the protected person cannot post a voice note onto their own incident as if they were a guardian
        assert p.post(f"/family/incidents/{scent}/voice", data={"device_id": p.id, "duration_s": "1"}, files={"file": ("n.wav", wav_bytes(), "audio/wav")}).status_code == 404
        # unpaired guardian is refused
        link_id = g.get("/family/links", params={"device_id": g.id}).json()["i_watch"][0]["link_id"]
        assert requests.delete(f"{API}/family/links/{link_id}", params={"device_id": g.id}, headers=g.h).status_code == 204
        assert g.post(f"/family/incidents/{scent}/voice", data={"device_id": g.id, "duration_s": "1"}, files={"file": ("n.wav", wav_bytes(), "audio/wav")}).status_code == 403
