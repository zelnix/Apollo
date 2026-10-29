# Removing every threat case (services/case_wipe.py): a deleted case can't come back from a device, devices are told
# to drop their copies, and the reset itself needs the exact confirmation. The full wipe is never run here.
import os
import uuid
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv
from pymongo import MongoClient

from services.case_wipe import REMOVED_REASON
from tests.test_enforcement_evidence_gate import API, _device

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
KEY = os.environ.get("APOLLO_ADMIN_KEY", "")
ADMIN = {"User-Agent": "apollo-tests", "X-Apollo-Raw": "1", "X-Admin-Key": KEY}
DB = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]


def _event(did: str, eid: str) -> dict:
    return {"event_id": eid, "device_id": did, "category": "message", "state": "growling", "status": "active",
            "headline": "Message worth a second look", "what_happened": "", "why": [], "what_to_do": "",
            "indicator_host": None, "indicator_digest": None, "verified_block": False, "adapter_label": "web",
            "occurred_at": "2026-06-01T00:00:00Z", "resolved_at": None}


def test_a_deleted_case_is_acknowledged_but_never_stored_again_and_devices_are_told_to_drop_it():
    did, auth = _device()
    eid = f"evt_{uuid.uuid4().hex[:10]}"
    assert requests.post(f"{API}/patrol/events", json=_event(did, eid), headers=auth, timeout=15).status_code == 200
    # Exactly what the reset does to each Patrol event.
    DB.patrol_events.update_one({"event_id": eid, "device_id": did}, [{"$replaceWith": {
        "_id": "$_id", "event_id": "$event_id", "device_id": "$device_id", "removed_reason": REMOVED_REASON, "deleted_at": "$$NOW"}}])

    again = requests.post(f"{API}/patrol/events", json=_event(did, eid), headers=auth, timeout=15)
    assert again.status_code == 200 and again.json()["event_id"] == eid  # the device's queue counts it delivered
    stored = DB.patrol_events.find_one({"event_id": eid, "device_id": did}, {"_id": 0})
    assert set(stored) == {"event_id", "device_id", "removed_reason", "deleted_at"}
    listed = requests.get(f"{API}/patrol/events", params={"device_id": did}, headers=auth, timeout=15).json()
    assert eid not in [e["event_id"] for e in listed]
    assert eid in requests.get(f"{API}/patrol/removed", headers=auth, timeout=15).json()["eventIds"]

    # A new case from the same device is stored as normal.
    fresh = f"evt_{uuid.uuid4().hex[:10]}"
    assert requests.post(f"{API}/patrol/events", json=_event(did, fresh), headers=auth, timeout=15).status_code == 200
    assert DB.patrol_events.find_one({"event_id": fresh, "device_id": did, "removed_reason": None})


def test_devices_can_read_the_latest_reset():
    _, auth = _device()
    body = requests.get(f"{API}/patrol/wipe", headers=auth, timeout=15).json()
    assert set(body) == {"wipeId", "at"}
    assert (body["wipeId"] is None) == (body["at"] is None)


@pytest.mark.skipif(not KEY, reason="APOLLO_ADMIN_KEY not configured")
def test_the_reset_needs_the_exact_confirmation_and_the_scan_changes_nothing():
    before = requests.get(f"{API}/admin/case-wipe/scan", headers=ADMIN, timeout=30).json()
    assert {"patrolEvents", "deleted", "total", "lastWipe"} <= set(before)
    for wrong in ("", "delete all cases", "DELETE PREVIEW DATA"):
        assert requests.post(f"{API}/admin/case-wipe", json={"confirm": wrong}, headers=ADMIN, timeout=30).status_code == 422
    assert requests.post(f"{API}/admin/case-wipe", json={"confirm": "DELETE ALL CASES"}, headers={"User-Agent": "apollo-tests"}, timeout=30).status_code == 401
    after = requests.get(f"{API}/admin/case-wipe/scan", headers=ADMIN, timeout=30).json()
    assert after["lastWipe"] == before["lastWipe"]
