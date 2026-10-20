import uuid
import pytest
from core.db import db
from services.higgins import repository as repo
from services.investigation_projector import project_case_started, project_open_cases, patrol_category

pytestmark = pytest.mark.anyio


async def test_started_case_is_listed_immediately_and_once():
    owner = f"open-{uuid.uuid4().hex[:8]}"
    case = await repo.create_case(owner, "vision", None, initiator="user_check")
    created = await project_case_started({**case, "owner_id": owner, "source_metadata": {"type": "text", "preview": "CommBank: a payment is pending"}})
    assert created is True
    events = await db.patrol_events.find({"device_id": owner}).to_list(10)
    assert len(events) == 1
    e = events[0]
    assert e["investigation_case_id"] == case["case_id"]
    assert e["state"] == "sniffing" and e["status"] == "active"
    assert e["category"] == "message"          # the "vision" gate used to fail validation entirely
    assert e["source_metadata"]["preview"].startswith("CommBank")
    # Idempotent: a second pass never creates a duplicate record.
    assert await project_case_started({**case, "owner_id": owner}) is False
    await project_open_cases()
    assert len(await db.patrol_events.find({"device_id": owner}).to_list(10)) == 1
    from core.models import PatrolEvent
    PatrolEvent.from_mongo({**e, "created_at": e.get("created_at") or e["updated_at"]})


def test_every_gate_maps_to_a_valid_category():
    valid = {"link", "website", "connection", "known_threat", "protection", "system", "message",
             "call", "app", "device", "account", "email", "file", "family"}
    for gate in ("text", "vision", "email", "call", "app", "file", "account", "device", "network", "link", "site", "unknown-gate"):
        assert patrol_category(gate) in valid
