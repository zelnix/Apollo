# Undo "Mark as contained": PATCH reopen clears resolved_at on the server and the record projection.
import uuid

import requests

from tests.test_enforcement_evidence_gate import API, _device, _event_payload, _evidence


def test_reopen_clears_resolution_for_verified_block():
    did, auth = _device()
    eid = f"evt_{uuid.uuid4().hex[:10]}"
    first = _event_payload(did, eid, "biting", _evidence())
    assert requests.post(f"{API}/patrol/events", json=first, headers=auth, timeout=15).status_code == 200
    resolved = {**first, "status": "resolved", "resolved_at": "2026-06-02T00:00:00Z"}
    assert requests.post(f"{API}/patrol/events", json=resolved, headers=auth, timeout=15).json()["resolved_at"]

    r = requests.patch(f"{API}/patrol/events/{eid}", params={"device_id": did}, json={"reopen": True, "status": "blocked"}, headers=auth, timeout=15)
    assert r.status_code == 200, r.text
    assert r.json()["resolved_at"] is None and r.json()["status"] == "blocked"

    records = requests.get(f"{API}/patrol/records", headers=auth, timeout=15).json()
    rec = next(x for x in records if x["sourceEventId"] == eid)
    assert rec["event"]["resolved_at"] is None


def test_reopen_without_status_defaults_to_active():
    did, auth = _device()
    eid = f"evt_{uuid.uuid4().hex[:10]}"
    p = {**_event_payload(did, eid, "growling", None), "status": "resolved", "resolved_at": "2026-06-02T00:00:00Z"}
    assert requests.post(f"{API}/patrol/events", json=p, headers=auth, timeout=15).status_code == 200
    r = requests.patch(f"{API}/patrol/events/{eid}", params={"device_id": did}, json={"reopen": True}, headers=auth, timeout=15)
    assert r.status_code == 200 and r.json()["status"] == "active" and r.json()["resolved_at"] is None
