import asyncio
from datetime import datetime
from types import SimpleNamespace

import pytest

from services import maintenance


@pytest.mark.asyncio
async def test_cycle_runs_every_component_after_an_independent_failure(monkeypatch):
    recorded = []
    called = []

    async def fake_record(patch):
        recorded.append(patch)

    async def ok_one():
        called.append("one")

    async def broken():
        called.append("broken")
        raise RuntimeError("fixture failure")

    async def ok_two():
        called.append("two")

    monkeypatch.setattr(maintenance, "_record", fake_record)
    outcomes = await maintenance.run_maintenance_cycle((("one", ok_one), ("broken", broken), ("two", ok_two)))
    assert called == ["one", "broken", "two"]
    assert outcomes == {"one": "ok", "broken": "failed", "two": "ok"}
    assert recorded[-1]["status"] == "degraded" and recorded[-1]["last_cycle_failures"] == 1


@pytest.mark.asyncio
async def test_loop_records_stopped_when_supervisor_cancels(monkeypatch):
    recorded = []

    async def fake_cycle():
        return {}

    async def fake_record(patch):
        recorded.append(patch)

    async def cancel_sleep(_seconds):
        raise asyncio.CancelledError

    monkeypatch.setattr(maintenance, "run_maintenance_cycle", fake_cycle)
    monkeypatch.setattr(maintenance, "_record", fake_record)
    monkeypatch.setattr(maintenance.asyncio, "sleep", cancel_sleep)
    with pytest.raises(asyncio.CancelledError):
        await maintenance.maintenance_loop()
    assert recorded[-1]["status"] == "stopped"


@pytest.mark.asyncio
async def test_worker_status_normalises_mongo_naive_datetimes(monkeypatch):
    class Heartbeats:
        async def find_one(self, *_args, **_kwargs):
            return {"status": "healthy", "last_heartbeat_at": datetime.now(), "last_completed_at": datetime.now(), "components": {}}

    monkeypatch.setattr(maintenance, "db", SimpleNamespace(worker_heartbeats=Heartbeats()))
    status = await maintenance.worker_status()
    assert status["stale"] is False and status["lastHeartbeatAt"].endswith("+00:00")