# Regression: "Mark as contained" on a verified-block (biting) event must persist on the server.
# Previously the evidence-receipt replay guard returned the stored event unchanged, silently
# dropping the user's resolution, so the server copy stayed unresolved and later overwrote the device.
import uuid

import requests

from tests.test_enforcement_evidence_gate import API, _device, _event_payload, _evidence


def _post(did, auth, payload):
    r = requests.post(f"{API}/patrol/events", json=payload, headers=auth, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def test_resolution_of_verified_block_is_persisted_and_never_reopened_by_replay():
    did, auth = _device()
    eid = f"evt_{uuid.uuid4().hex[:10]}"
    ev = _evidence()
    first = _event_payload(did, eid, "biting", ev)
    assert _post(did, auth, first)["resolved_at"] is None

    resolved = {**first, "status": "resolved", "resolved_at": "2026-06-02T00:00:00Z"}
    out = _post(did, auth, resolved)
    assert out["status"] == "resolved" and out["resolved_at"], out

    rg = requests.get(f"{API}/patrol/events", params={"device_id": did}, headers=auth, timeout=15).json()
    stored = next(e for e in rg if e["event_id"] == eid)
    assert stored["status"] == "resolved" and stored["resolved_at"]

    # Replaying the original unresolved payload must not un-resolve it.
    again = _post(did, auth, first)
    assert again["status"] == "resolved" and again["resolved_at"]

    records = requests.get(f"{API}/patrol/records", headers=auth, timeout=15).json()
    rec = next(r for r in records if r["sourceEventId"] == eid)
    assert rec["event"]["status"] == "resolved" and rec["event"]["resolved_at"]
