"""Renewable-ownership recovery fencing regressions (review remediation): upload finalisation takeover, device-result
submission stage claims, and the work_epoch backfill migration. No Gemini calls — device observations and evidence
ingestion here are purely local (regex/text), never routed through the provider."""
import asyncio
import io
import uuid
from datetime import timedelta

import pytest

from core.db import db, now_utc
from services.higgins import jobs
from services.higgins import repository as repo
from services.higgins.contracts import DeviceResult


def _run(coro_fn):
    """Fresh loop + fresh Motor client per scenario (the module-level client is loop-bound)."""
    import importlib
    import core.db as core_db
    async def wrapped():
        core_db.client = core_db.AsyncIOMotorClient(core_db.os.environ["MONGO_URL"])
        core_db.db = core_db.client[core_db.os.environ["DB_NAME"]]
        importlib.reload(repo); importlib.reload(jobs)
        import routers.investigations as inv
        importlib.reload(inv)
        global db
        db = core_db.db
        await coro_fn(inv)
    asyncio.run(wrapped())


def test_upload_finalisation_takeover_is_exclusive():
    _run(lambda inv: _upload_takeover_race())


def test_device_submission_stage_claim_is_exclusive_and_renewable():
    _run(lambda inv: _device_submission_stage_race(inv))


def test_device_submission_happy_path_still_resumes_the_job():
    _run(lambda inv: _device_submission_happy_path(inv))


def test_backfill_work_epochs_is_idempotent_and_revives_nothing():
    _run(lambda inv: _backfill_work_epochs())


def test_scanned_pdf_page_is_rendered_without_crashing():
    _run(lambda inv: _scanned_pdf_no_crash())


@pytest.mark.asyncio
async def test_image_secret_preflight_flags_60k_truncation(monkeypatch):
    """The internal 60,000-character cap on a screenshot's transcription must mark itself as truncated —
    independent of whatever completeness the model itself claims — so the resulting evidence's coverage
    records a material gap instead of silently appearing fully transcribed."""
    from services.higgins import evidence as ev
    from services.higgins import provider

    long_text = "A" * 70_000

    async def fake_generate_json(_system, _prompt, capability="vision"):
        return {"containsSecret": True, "secretKinds": ["password"], "redactedText": long_text,
                "visualDescription": "a login screen", "transcriptionComplete": True}, None

    monkeypatch.setattr(provider, "generate_json", fake_generate_json)
    admission = await ev._image_secret_preflight(b"fake-image-bytes", "image/png")
    assert admission["status"] == "secret_detected"
    assert admission["transcriptionComplete"] is True  # the model itself claims completeness...
    assert admission["transcriptionTruncated"] is True  # ...but OUR budget still flags the gap
    assert len(admission["redactedText"]) == 60_000


async def _upload_takeover_race():
    owner = f"persist-{uuid.uuid4().hex[:8]}"
    await repo.ensure_indexes()
    upload_id = str(uuid.uuid4())
    stale_fence, started_at = "fence-A", now_utc() - timedelta(seconds=200)  # well past the 120s exclusivity window
    await db.investigation_uploads.insert_one({"owner_id": owner, "case_id": "case-x", "upload_id": upload_id,
        "metadata": {"declaredBytes": 1, "clientItemId": "item-1"}, "chunks": {}, "expires_at": now_utc() + timedelta(minutes=10),
        "finalisation": {"state": "ingesting", "digest": "d", "started_at": started_at, "fence": stale_fence, "evidence_id": None}})
    # Two concurrent takeover attempts against the SAME stale claim — this is the exact CAS shape `complete_upload` uses.
    fence_b, fence_c = str(uuid.uuid4()), str(uuid.uuid4())
    taken_b = await db.investigation_uploads.find_one_and_update(
        {"owner_id": owner, "upload_id": upload_id, "finalisation.state": "ingesting", "finalisation.fence": stale_fence, "finalisation.started_at": started_at},
        {"$set": {"finalisation.fence": fence_b, "finalisation.started_at": now_utc()}})
    taken_c = await db.investigation_uploads.find_one_and_update(
        {"owner_id": owner, "upload_id": upload_id, "finalisation.state": "ingesting", "finalisation.fence": stale_fence, "finalisation.started_at": started_at},
        {"$set": {"finalisation.fence": fence_c, "finalisation.started_at": now_utc()}})
    assert taken_b is not None and taken_c is None  # only the first CAS wins; the second never matches the (already moved) stale value
    # The superseded (original) fence can never commit again, even though it "started ingesting" first.
    stale_commit = await db.investigation_uploads.find_one_and_update(
        {"owner_id": owner, "upload_id": upload_id, "finalisation.fence": stale_fence},
        {"$set": {"finalisation.state": "committed", "finalisation.evidence_id": "wrong-item"}})
    assert stale_commit is None
    current = await db.investigation_uploads.find_one({"owner_id": owner, "upload_id": upload_id}, {"_id": 0})
    assert current["finalisation"]["fence"] == fence_b and current["finalisation"]["state"] == "ingesting"
    # The winner's own commit, fenced on its own (current) fence, succeeds.
    won_commit = await db.investigation_uploads.find_one_and_update(
        {"owner_id": owner, "upload_id": upload_id, "finalisation.fence": fence_b},
        {"$set": {"finalisation.state": "committed", "finalisation.evidence_id": "right-item", "evidence_id": "right-item"}})
    assert won_commit is not None


async def _device_submission_stage_race(inv):
    owner = f"persist-{uuid.uuid4().hex[:8]}"
    await repo.ensure_indexes()
    request_id = str(uuid.uuid4())
    await db.investigation_device_requests.insert_one({"owner_id": owner, "case_id": "case-x", "request_id": request_id, "job_id": "job-x",
        "request": {"capabilityId": "cap.x", "fields": []}, "fulfilled": False,
        "submission": {"state": "claimed", "digest": "d1", "result_ciphertext": repo.enc_json({}), "evidence_id": None, "claimed_at": now_utc(), "fence": "f0"}})
    fence1 = await inv._claim_submission_stage(owner, "case-x", request_id, "claimed", "storing")
    assert fence1
    # A second attempt can neither claim "storing" from "claimed" (state already moved) nor take over immediately (not stale).
    fence2 = await inv._claim_submission_stage(owner, "case-x", request_id, "claimed", "storing")
    assert fence2 is None
    # Force the in-flight claim stale, then confirm a fresh attempt takes over with a NEW fence.
    await db.investigation_device_requests.update_one({"owner_id": owner, "request_id": request_id},
                                                       {"$set": {"submission.stage_started_at": now_utc() - timedelta(seconds=200)}})
    fence3 = await inv._claim_submission_stage(owner, "case-x", request_id, "claimed", "storing")
    assert fence3 and fence3 != fence1
    # The original (superseded) fence can never commit the stage again.
    stale_commit = await db.investigation_device_requests.find_one_and_update(
        {"owner_id": owner, "case_id": "case-x", "request_id": request_id, "submission.fence": fence1},
        {"$set": {"submission.state": "stored", "submission.evidence_id": "wrong-item"}})
    assert stale_commit is None
    won_commit = await db.investigation_device_requests.find_one_and_update(
        {"owner_id": owner, "case_id": "case-x", "request_id": request_id, "submission.fence": fence3},
        {"$set": {"submission.state": "stored", "submission.evidence_id": "right-item"}})
    assert won_commit is not None


async def _device_submission_happy_path(inv):
    owner = f"persist-{uuid.uuid4().hex[:8]}"
    await repo.ensure_indexes()
    case = await repo.create_case(owner, "text", None)
    turn_id = str(uuid.uuid4())
    job = await repo.create_job(owner, case, turn_id, repo.digest("k2"), repo.digest("p2"), "turn", {"message": "q", "turnId": turn_id})
    await repo.cas(owner, case["case_id"], {"revision": 0}, {"$set": {"active_job_id": job["job_id"], "active_turn_id": turn_id, "status": "waiting_device"}})
    request_id = str(uuid.uuid4())
    result = DeviceResult(request_id=request_id, case_revision=1, capability_id="cap.x", status="observed", values={"state": True})
    await db.investigation_device_requests.insert_one({"owner_id": owner, "case_id": case["case_id"], "request_id": request_id, "job_id": job["job_id"],
        "request": {"id": request_id, "caseId": case["case_id"], "caseRevision": 1, "capabilityId": "cap.x", "fields": [], "reason": "test",
                    "expiresAt": repo.utc(case["expires_at"]).isoformat()},
        "fulfilled": False, "submission": {"state": "claimed", "digest": "d1", "result_ciphertext": repo.enc_json(result.wire()), "evidence_id": None,
                                            "claimed_at": now_utc(), "fence": str(uuid.uuid4())}, "created_at": now_utc()})
    pending = await db.investigation_device_requests.find_one({"owner_id": owner, "case_id": case["case_id"], "request_id": request_id}, {"_id": 0})
    item_id = await inv._finish_device_submission(owner, case, pending)
    assert item_id
    fresh_job = await repo.get_job(owner, case["case_id"], job["job_id"])
    assert fresh_job["status"] == "queued"
    checkpoint = repo.dec_json(fresh_job["checkpoint_ciphertext"])
    assert any(r["evidenceId"] == item_id for r in checkpoint["deviceResults"])
    final = await db.investigation_device_requests.find_one({"owner_id": owner, "request_id": request_id}, {"_id": 0})
    assert final["submission"]["state"] == "resumed" and final["fulfilled"] is True
    # Idempotent replay from the sweeper/a retry after full completion returns the same evidence, no double work.
    again = await inv._finish_device_submission(owner, case, final)
    assert again == item_id


async def _backfill_work_epochs():
    owner = f"persist-{uuid.uuid4().hex[:8]}"
    await repo.ensure_indexes()
    case = await repo.create_case(owner, "text", None)
    job = await repo.create_job(owner, case, str(uuid.uuid4()), repo.digest("k3"), repo.digest("p3"), "turn", {})
    # Simulate pre-migration documents: `work_epoch` never existed.
    await db.investigation_cases.update_one({"case_id": case["case_id"]}, {"$unset": {"work_epoch": ""}})
    await db.investigation_jobs.update_one({"job_id": job["job_id"]}, {"$unset": {"work_epoch": ""}})
    stale_case = await db.investigation_cases.find_one({"case_id": case["case_id"]}, {"_id": 0})
    assert "work_epoch" not in stale_case
    await repo.backfill_work_epochs()
    fixed_case = await db.investigation_cases.find_one({"case_id": case["case_id"]}, {"_id": 0})
    fixed_job = await db.investigation_jobs.find_one({"job_id": job["job_id"]}, {"_id": 0})
    assert fixed_case["work_epoch"] == fixed_case["epoch"]
    assert fixed_job["work_epoch"] == fixed_job["epoch"]
    assert fixed_case["status"] == case["status"] and fixed_job["status"] == job["status"]  # nothing revived, only the field was set
    # Idempotent and harmless on a case that was already migrated (or a cancelled one): running it again changes nothing.
    await db.investigation_cases.update_one({"case_id": case["case_id"]}, {"$set": {"status": "cancelled"}})
    await repo.backfill_work_epochs()
    untouched = await db.investigation_cases.find_one({"case_id": case["case_id"]}, {"_id": 0})
    assert untouched["status"] == "cancelled" and untouched["work_epoch"] == fixed_case["work_epoch"]


async def _scanned_pdf_no_crash():
    owner = f"persist-{uuid.uuid4().hex[:8]}"
    await repo.ensure_indexes()
    case = await repo.create_case(owner, "text", None)
    from services.higgins import evidence as ev
    from pypdf import PdfWriter
    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)  # no text layer at all -> "unreadable"/scanned page
    buf = io.BytesIO()
    writer.write(buf)
    data = buf.getvalue()
    item = await ev.ingest_file(owner, case, {"clientItemId": "doc-1", "mediaType": "application/pdf", "kind": "document", "filename": "scan.pdf"}, data)
    row = await repo.get_evidence(owner, case["case_id"], item.id)
    # Before the fix, rendering a scanned page raised a NameError (undefined `expires`), silently caught by the
    # broad handler and downgraded to "parser failed; content not examined" — this asserts that no longer happens.
    assert row["coverage"]["status"] != "unavailable"
    assert row["coverage"].get("reason") != "parser failed; content not examined"
    children = await db.investigation_evidence.find({"owner_id": owner, "case_id": case["case_id"], "parent_id": item.id}, {"_id": 0}).to_list(None)
    assert any(c["kind"] == "image" for c in children)  # the scanned page was rasterised and stored as its own evidence


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))
