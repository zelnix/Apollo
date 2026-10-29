"""GET /api/patrol/removed lists only this device's Patrol events hidden as loop duplicates."""
import asyncio
import os
import uuid

import requests
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

from services.loop_cleanup import REMOVED_REASON
from tests.test_enforcement_evidence_gate import API, _device

load_dotenv("/app/backend/.env")


async def _seed(rows):
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    await client[os.environ.get("DB_NAME", "test_database")].patrol_events.insert_many(rows)
    client.close()


def test_removed_lists_only_this_devices_hidden_events():
    did, auth = _device()
    other, _ = _device()
    mine, kept, theirs = (f"evt_{uuid.uuid4().hex[:10]}" for _ in range(3))
    asyncio.run(_seed([
        {"event_id": mine, "device_id": did, "removed_reason": REMOVED_REASON, "deleted_at": None},
        {"event_id": kept, "device_id": did, "deleted_at": None},
        {"event_id": theirs, "device_id": other, "removed_reason": REMOVED_REASON, "deleted_at": None},
    ]))
    r = requests.get(f"{API}/patrol/removed", headers=auth, timeout=15)
    assert r.status_code == 200, r.text
    assert r.json()["eventIds"] == [mine]
