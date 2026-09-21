"""Persistence regressions for R01 (immutable accepted commit, crash repair) and R02 (late writes after deletion). No Gemini calls."""
import asyncio
import uuid
from datetime import timedelta

import pytest

from core.db import db, now_utc
from services.higgins import jobs
from services.higgins import repository as repo
from services.higgins.contracts import HigginsResponse, ProviderResult, TurnCommit


def _response(revision: int) -> HigginsResponse:
    return HigginsResponse(revision=revision, overview="Accepted answer", explanation_markdown="Full explanation.", assessment="uncertain", attention="none",
                           findings=[], uncertainties=[], scope="", source_ids=[], remaining_evidence_ids=[], actions=[], completion="complete")


async def _accepted_case(owner: str):
    await repo.ensure_indexes()
    case = await repo.create_case(owner, "text", None)
    turn_id = str(uuid.uuid4())
    job = await repo.create_job(owner, case, turn_id, repo.digest("k"), repo.digest("p"), "turn", {"message": "q", "turnId": turn_id})
    await repo.cas(owner, case["case_id"], {"revision": 0}, {"$set": {"active_job_id": job["job_id"], "active_turn_id": turn_id}})
    job = await repo.acquire_lease(owner, job["job_id"])
    case = await repo.cas(owner, case["case_id"], {"active_job_id": job["job_id"]}, {"$set": {"lease_fence": job["fence"]}}, bump=False)
    commit = TurnCommit(turn_id=turn_id, case_id=case["case_id"], input_revision=1, committed_revision=1, question="q", response=_response(1),
                        provider=ProviderResult(model="gemini-3-flash-preview", finish_reason="STOP", provider_complete=True), committed_at=now_utc())
    commit_id = await repo.stage_turn(owner, commit, job, repo.utc(case["expires_at"]))
    updated = await repo.accept_turn(owner, case, job, commit, commit_id, "complete", "none", None)
    assert updated and updated["accepted_commits"][0]["commit_id"] == commit_id
    return updated, job, commit, commit_id


def _run(coro_fn):
    """Each scenario runs in its own subprocess-free fresh loop with a fresh Motor client (the module-level client is loop-bound)."""
    import importlib
    import core.db as core_db
    async def wrapped():
        core_db.client = core_db.AsyncIOMotorClient(core_db.os.environ["MONGO_URL"])
        core_db.db = core_db.client[core_db.os.environ["DB_NAME"]]
        importlib.reload(repo); importlib.reload(jobs)
        global db
        db = core_db.db
        await coro_fn()
    asyncio.run(wrapped())


def test_crash_after_acceptance_is_repaired_without_second_conclusion():
    _run(_crash_repair)


def test_losing_attempt_cannot_overwrite_accepted_bundle_and_gc_keeps_referenced():
    _run(_losing_attempt)


def test_late_content_write_after_delete_is_rejected_and_not_publishable():
    _run(_late_write)


async def _crash_repair():
    owner = f"persist-{uuid.uuid4().hex[:8]}"
    case, job, commit, commit_id = await _accepted_case(owner)
    # Simulate the crash: job never finalised; lease expired; a new worker picks it up.
    await db.investigation_jobs.update_one({"owner_id": owner, "job_id": job["job_id"]}, {"$set": {"status": "investigating", "lease_until": now_utc() - timedelta(seconds=1)}})
    await jobs.run(owner, case["case_id"], job["job_id"])
    fresh = await repo.get_job(owner, case["case_id"], job["job_id"])
    assert fresh["status"] == "complete"
    events = await repo.events_after(owner, job["job_id"], 0)
    kinds = [e["type"] for e in events]
    assert kinds[-1] == "completed" and events[-1]["payload"].get("repaired") is True
    assert sum(1 for k in kinds if k == "response") == 1
    turns = await repo.accepted_turns(owner, await repo.get_case(owner, case["case_id"]))
    assert [t.turn_id for t in turns] == [commit.turn_id]


async def _losing_attempt():
    owner = f"persist-{uuid.uuid4().hex[:8]}"
    case, job, commit, commit_id = await _accepted_case(owner)
    stale_job = {**job, "fence": "stale-fence"}
    other = await repo.stage_turn(owner, commit.model_copy(update={"response": _response(1).model_copy(update={"overview": "STALE"})}), stale_job, repo.utc(case["expires_at"]))
    assert await repo.accept_turn(owner, case, stale_job, commit, other, "complete", "none", None) is None
    assert await db.investigation_turn_commits.find_one({"commit_id": other}) is None  # loser removed only its own bundle
    await db.investigation_turn_commits.update_many({"owner_id": owner}, {"$set": {"committed_at": now_utc() - timedelta(hours=1)}})
    await repo.sweep()
    assert await db.investigation_turn_commits.find_one({"commit_id": commit_id}) is not None  # referenced bundle survives GC
    turns = await repo.accepted_turns(owner, await repo.get_case(owner, case["case_id"]))
    assert turns[0].response.overview == "Accepted answer"


async def _late_write():
    owner = f"persist-{uuid.uuid4().hex[:8]}"
    await repo.ensure_indexes()
    case = await repo.create_case(owner, "text", None)
    from services.higgins import evidence as ev
    item = await ev.ingest_text(owner, case, str(uuid.uuid4()), "hello world")
    await repo.revoke(owner, case["case_id"], "deleted")
    await repo.run_cleanup(owner, case["case_id"])
    with pytest.raises(Exception):
        await repo.store_bytes(owner, case["case_id"], item.id, b"late", repo.utc(case["expires_at"]))
    with pytest.raises(Exception):
        await ev.ingest_text(owner, case, str(uuid.uuid4()), "late text")
    assert await db.investigation_content_chunks.count_documents({"owner_id": owner, "case_id": case["case_id"]}) == 0
    assert await repo.emit(owner, case["case_id"], "missing-job", "progress", {"x": 1}, 1, now_utc()) == 0


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))
