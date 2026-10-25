"""Send to family + the Apollo SG banner on emails and reports. Drives the running server (no Gemini, no email sent)."""
import os
import uuid

import httpx

from core.brand import BANNER_PATH, BANNER_URL
from services import email

BASE = os.environ.get("APOLLO_API", "http://localhost:8001/api")


def _device():
    r = httpx.post(f"{BASE}/devices/register", json={"platform": "web", "adapter_mode": "unsupported", "app_version": "1.0.0"}, timeout=20)
    r.raise_for_status()
    d = r.json()
    return d["device_id"], {"Authorization": f"Bearer {d['device_token']}"}


def _summary(device_id: str, event_id: str, **extra):
    return {"device_id": device_id, "event_id": event_id, "state": "barking", "result": "Confirmed scam or threat",
            "headline": "A phishing link", "what_happened": "Apollo's blocklist lists it as phishing.", "what_to_do": "Don't open the link.",
            "involved_label": "Website", "involved": "scam.example", "case_ref": "TC-2026-ABCDE", "occurred_at": "2026-10-25T06:17:00Z", **extra}


def test_a_threat_summary_reaches_linked_family_and_nothing_else():
    owner, owner_h = _device()
    helper, helper_h = _device()
    code = httpx.post(f"{BASE}/family/pair", json={"device_id": owner, "owner_name": "Mum"}, headers=owner_h, timeout=20).json()["code"]
    assert httpx.post(f"{BASE}/family/link", json={"device_id": helper, "code": code}, headers=helper_h, timeout=20).json()["linked"]
    event_id = f"evt-{uuid.uuid4().hex[:12]}"

    r = httpx.post(f"{BASE}/family/threats/share", json=_summary(owner, event_id), headers=owner_h, timeout=20)
    assert r.status_code == 200 and r.json() == {"shared_with": 1}

    got = [e for e in httpx.get(f"{BASE}/family/shared-events", params={"device_id": helper}, headers=helper_h, timeout=20).json() if e["event_id"] == event_id]
    assert len(got) == 1
    e = got[0]
    assert (e["from_label"], e["result"], e["involved_label"], e["involved"], e["indicator_host"], e["shared_by_owner"]) == \
        ("Mum", "Confirmed scam or threat", "Website", "scam.example", "scam.example", True)
    assert not {"text", "url", "message", "urls", "images"} & set(e)


def test_share_rejects_extra_content_and_another_devices_id():
    owner, owner_h = _device()
    other, _ = _device()
    event_id = f"evt-{uuid.uuid4().hex[:12]}"
    assert httpx.post(f"{BASE}/family/threats/share", json=_summary(other, event_id), headers=owner_h, timeout=20).status_code == 403
    assert httpx.post(f"{BASE}/family/threats/share", json=_summary(owner, event_id, involved=None), headers=owner_h, timeout=20).status_code == 422
    assert httpx.post(f"{BASE}/family/threats/share", json=_summary(owner, event_id), headers=owner_h, timeout=20).json() == {"shared_with": 0}


def test_family_reply_notes_reach_the_person_and_only_them():
    owner, owner_h = _device()
    helper, helper_h = _device()
    stranger, stranger_h = _device()
    code = httpx.post(f"{BASE}/family/pair", json={"device_id": owner, "owner_name": "Mum"}, headers=owner_h, timeout=20).json()["code"]
    httpx.post(f"{BASE}/family/link", json={"device_id": helper, "code": code, "guardian_name": "Sarah"}, headers=helper_h, timeout=20).raise_for_status()
    event_id = f"evt-{uuid.uuid4().hex[:12]}"
    httpx.post(f"{BASE}/family/threats/share", json=_summary(owner, event_id), headers=owner_h, timeout=20).raise_for_status()

    def note(device, headers, **body):
        return httpx.post(f"{BASE}/family/shared-events/{event_id}/notes", json={"device_id": device, **body}, headers=headers, timeout=20)

    assert note(helper, helper_h, kind="calling").json()["text"] == "I'm calling you now."
    assert note(helper, helper_h, kind="custom", text="  On   my way  ").json()["text"] == "On my way"
    assert note(helper, helper_h, kind="custom", text="   ").status_code == 422
    assert note(helper, helper_h, kind="custom", text="x" * 141).status_code == 422
    assert note(stranger, stranger_h, kind="calling").status_code == 404

    seen = httpx.get(f"{BASE}/family/shared-events/{event_id}/notes", params={"device_id": owner}, headers=owner_h, timeout=20).json()
    assert [(n["guardian_label"], n["text"]) for n in seen] == [("Sarah", "I'm calling you now."), ("Sarah", "On my way")]
    assert httpx.get(f"{BASE}/family/shared-events/{event_id}/notes", params={"device_id": stranger}, headers=stranger_h, timeout=20).json() == []
    acks = [a for a in httpx.get(f"{BASE}/family/acks", params={"device_id": owner}, headers=owner_h, timeout=20).json() if a["event_id"] == event_id]
    assert [(a["guardian_label"], a["ack_label"]) for a in acks] == [("Sarah", "On my way")]


def test_the_banner_is_public_and_tops_every_email():
    r = httpx.get(f"{BASE}/brand/banner.jpg", timeout=20)
    assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg" and r.content == BANNER_PATH.read_bytes()
    html = email._wrap("<p>Hello</p>")
    if BANNER_URL:
        assert html.index(BANNER_URL) < html.index("<p>Hello</p>")
    email._assert_safe_email("Apollo alert", html)


def test_the_investigation_pdf_carries_the_banner():
    from services.higgins.pdf_export import generate_pdf
    pdf = generate_pdf({"id": "case-1234567890", "response": {"overview": "Nothing found.", "assessment": "low"}}, [], subject="Test")
    assert pdf.startswith(b"%PDF") and b"/Subtype /Image" in pdf and b"ApolloSG" in pdf
