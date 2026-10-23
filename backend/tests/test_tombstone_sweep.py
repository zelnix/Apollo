"""sweep_tombstones stays fast however many deleted cases accumulate, and removes exactly the orphans.

Production failed every maintenance cycle with `component=tombstones type=TimeoutError`: the old sweep
scanned the 200 oldest cases (all long-deleted) with up to 600 delete round trips per cycle — instant
on a local MongoDB, over 15 s against Atlas. The sweep is now driven by the content rows that exist.

Run: cd /app/backend && python -m pytest tests/test_tombstone_sweep.py -q
"""
from __future__ import annotations

import uuid
from datetime import timedelta

import pytest

from core.db import db, now_utc
from services.higgins import repository


@pytest.fixture
def owner():
    return f"tombstone-test-{uuid.uuid4().hex[:10]}"


async def _case(owner: str, *, deleted: bool, expires_in: timedelta, epoch: str) -> str:
    case_id = str(uuid.uuid4())
    await db.investigation_cases.insert_one({"owner_id": owner, "case_id": case_id, "epoch": epoch, "deleted": deleted,
                                             "expires_at": now_utc() + expires_in})
    return case_id


async def _row(collection: str, owner: str, case_id: str, epoch: str | None) -> None:
    doc = {"owner_id": owner, "case_id": case_id, "evidence_id": str(uuid.uuid4()), "client_item_id": str(uuid.uuid4()),
           "chunk_index": 0, "job_id": str(uuid.uuid4()), "sequence": 0}
    if epoch is not None:
        doc["epoch"] = epoch
    await db[collection].insert_one(doc)


async def _count(collection: str, owner: str, case_id: str) -> int:
    return await db[collection].count_documents({"owner_id": owner, "case_id": case_id})


@pytest.mark.anyio
async def test_removes_only_orphans_and_keeps_live_content(owner):
    live = await _case(owner, deleted=False, expires_in=timedelta(minutes=10), epoch="e-live")
    gone = await _case(owner, deleted=True, expires_in=timedelta(minutes=10), epoch="e-gone")
    expired = await _case(owner, deleted=False, expires_in=timedelta(minutes=-1), epoch="e-exp")
    try:
        await _row("investigation_evidence", owner, live, "e-live")        # current epoch: kept
        await _row("investigation_evidence", owner, live, "e-stale")       # late write from an old epoch: removed
        await _row("investigation_content_chunks", owner, live, "e-live")  # kept
        await _row("investigation_events", owner, live, None)              # events of a live case: kept
        for collection in repository._TOMBSTONE_CONTENT:                   # everything of a deleted / expired case: removed
            await _row(collection, owner, gone, "e-gone")
            await _row(collection, owner, expired, "e-exp")

        await repository.sweep_tombstones()

        assert await _count("investigation_evidence", owner, live) == 1
        assert await db.investigation_evidence.count_documents({"owner_id": owner, "case_id": live, "epoch": "e-stale"}) == 0
        assert await _count("investigation_content_chunks", owner, live) == 1
        assert await _count("investigation_events", owner, live) == 1
        for collection in repository._TOMBSTONE_CONTENT:
            assert await _count(collection, owner, gone) == 0
            assert await _count(collection, owner, expired) == 0
    finally:
        await db.investigation_cases.delete_many({"owner_id": owner})
        for collection in repository._TOMBSTONE_CONTENT:
            await db[collection].delete_many({"owner_id": owner})


@pytest.mark.anyio
async def test_thousands_of_deleted_cases_cost_nothing_when_their_content_is_gone(owner, monkeypatch):
    """The production shape: a large tombstone table, a little live content. The sweep touches only the
    cases that still hold content — the deleted cases are never visited."""
    await db.investigation_cases.insert_many([
        {"owner_id": owner, "case_id": str(uuid.uuid4()), "epoch": "e", "deleted": True, "expires_at": now_utc() - timedelta(days=1)}
        for _ in range(3000)])
    live = await _case(owner, deleted=False, expires_in=timedelta(minutes=10), epoch="e-live")
    visited: list[dict] = []

    class _Cases:
        def __init__(self, real):
            self._real = real

        def find(self, query, *args, **kwargs):
            visited.append(query)
            return self._real.find(query, *args, **kwargs)

        def __getattr__(self, name):
            return getattr(self._real, name)

    class _Db:
        def __getattr__(self, name):
            return _Cases(db.investigation_cases) if name == "investigation_cases" else getattr(db, name)

        def __getitem__(self, name):
            return db[name]

    try:
        await _row("investigation_evidence", owner, live, "e-live")
        monkeypatch.setattr(repository, "db", _Db())
        await repository.sweep_tombstones()
        looked_up = [clause for query in visited for clause in query.get("$or", []) if clause.get("owner_id") == owner]
        assert looked_up == [{"owner_id": owner, "case_id": live}], "only the one case that holds content is looked up"
        assert await _count("investigation_evidence", owner, live) == 1
    finally:
        await db.investigation_cases.delete_many({"owner_id": owner})
        await db.investigation_evidence.delete_many({"owner_id": owner})
