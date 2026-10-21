import uuid
import pytest
from core.db import db, now_utc
from services.higgins import repository as repo
from services.investigation_projector import project_case_started, project_committed_cases

pytestmark = pytest.mark.anyio


async def _device_event(owner: str, event_id: str) -> dict:
    """The patrol record a Gate check files on the device for its own check."""
    document = {
        "event_id": event_id, "device_id": owner, "category": "email", "state": "growling",
        "status": "active", "headline": "Email: claims to be CommBank",
        "what_happened": "Apollo found a lookalike sender domain.", "why": ["Lookalike domain"],
        "what_to_do": "Do not use the link.", "indicator_host": "commbank-alerts.co",
        "indicator_digest": None, "local_indicator": None, "verified_block": False,
        "adapter_label": "preview", "occurred_at": now_utc(), "resolved_at": None,
        "trust_allowed": False, "claimed_brand": "CommBank", "scenario": "E01",
        "evidence_provenance": "local_device", "deleted_at": None,
        "created_at": now_utc(), "updated_at": now_utc(),
    }
    await db.patrol_events.insert_one(dict(document))
    return document


async def test_case_named_by_the_device_never_gets_a_second_record():
    """One check, one record: a case that names the device's own patrol event must never cause a
    second, server-owned event for the same material — before OR after Magnum DI answers."""
    owner = f"onecase-{uuid.uuid4().hex[:8]}"
    event_id = str(uuid.uuid4())
    case = await repo.create_case(owner, "email", None, client_submission_id=event_id, initiator="user_check")

    # Nothing is filed while the investigation runs: the device already has the record.
    assert await project_case_started({**case, "owner_id": owner}) is False
    assert await db.patrol_events.count_documents({"device_id": owner}) == 0

    await _device_event(owner, event_id)
    # A projection pass over a case that has not answered yet must still leave exactly one record.
    await project_committed_cases()
    events = await db.patrol_events.find({"device_id": owner}).to_list(10)
    assert len(events) == 1
    assert events[0]["event_id"] == event_id
    assert events[0]["evidence_provenance"] == "local_device"


async def test_case_without_a_device_record_is_still_filed():
    """Apollo's own server-side investigations (Gmail monitoring, Ask Higgins) have no device record,
    so they must still be given one — the fix must not hide them."""
    owner = f"serveronly-{uuid.uuid4().hex[:8]}"
    case = await repo.create_case(owner, "email", None, initiator="apollo_automatic")
    assert await project_case_started({**case, "owner_id": owner}) is True
    events = await db.patrol_events.find({"device_id": owner}).to_list(10)
    assert len(events) == 1
    assert events[0]["investigation_case_id"] == case["case_id"]
