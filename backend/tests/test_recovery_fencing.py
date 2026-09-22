"""Renewable-ownership recovery fencing regressions (review remediation): upload finalisation takeover, device-result
submission stage claims, and the work_epoch backfill migration. No Gemini calls — device observations and evidence
ingestion here are purely local (regex/text), never routed through the provider."""
import asyncio
import io
import json
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


def test_coverage_aggregates_across_text_and_image_children():
    _run(lambda inv: _coverage_aggregation_across_children())


def test_truncated_text_never_reaches_examined():
    _run(lambda inv: _truncated_text_never_reaches_examined())


def test_ordinary_partial_read_still_reaches_examined_once_complete():
    _run(lambda inv: _partial_then_complete_read_reaches_examined())


def test_upload_replay_rejects_a_different_file_under_the_same_client_item():
    _run(lambda inv: _upload_replay_digest_mismatch_is_rejected(inv))


def test_upload_replay_binds_to_identical_content_from_a_different_upload():
    _run(lambda inv: _upload_replay_digest_match_binds(inv))


def test_device_observation_metadata_without_content_is_reingested():
    _run(lambda inv: _device_observation_missing_content_is_reingested(inv))


def test_lease_renewal_detects_loss_and_stops_the_work():
    _run(lambda inv: _lease_renewal_detects_loss(inv))


def test_device_submission_resumes_from_a_crashed_storing_state():
    _run(lambda inv: _device_submission_resumes_from_storing(inv))


def test_device_submission_is_not_acknowledged_before_job_consumes_it():
    _run(lambda inv: _device_submission_waits_for_authoritative_consumption(inv))


def test_incomplete_evidence_attempt_is_invisible_until_root_publication():
    _run(lambda inv: _evidence_publication_is_atomic())


def test_device_tool_request_replay_uses_one_durable_request_identity():
    _run(lambda inv: _device_request_identity_is_durable())


def test_legacy_content_discard_migration_runs_only_once():
    _run(lambda inv: _legacy_content_discard_is_one_time())


def test_published_evidence_root_cannot_be_discarded_as_incomplete():
    _run(lambda inv: _published_root_survives_discard())


def test_published_root_replays_when_upload_projection_was_interrupted():
    _run(lambda inv: _published_root_repairs_upload_projection(inv))


def test_stale_cancellation_cannot_clear_a_newer_active_turn():
    _run(lambda inv: _stale_cancel_preserves_new_turn(inv))


def test_observation_ledger_replay_restores_pending_request():
    _run(lambda inv: _ledger_replay_restores_observation())


def test_consumed_observation_repairs_inbox_before_coordinator_wait_check():
    _run(lambda inv: _consumed_observation_repairs_inbox())


def test_document_continuation_removes_only_the_extracted_page_gap():
    from services.higgins.evidence import _subtract_page_range
    ranges = [{"start": 64, "end": 200, "reason": "later pages"}, {"start": 4, "end": 5, "reason": "scanned"}]
    assert _subtract_page_range(ranges, 64, 128) == [
        {"start": 128, "end": 200, "reason": "later pages"}, {"start": 4, "end": 5, "reason": "scanned"}
    ]


def test_document_continuation_publishes_a_later_pdf_slice():
    _run(lambda inv: _document_continuation_publishes_slice())


def test_publication_manifest_excludes_late_or_wrong_attempt_children():
    _run(lambda inv: _publication_manifest_is_attempt_isolated())


def test_concurrent_device_results_merge_under_checkpoint_revision():
    _run(lambda inv: _concurrent_device_results_merge(inv))


def test_upload_control_document_fences_publication_takeover():
    _run(lambda inv: _upload_control_fences_publication())


def test_bounded_tests_prohibit_provider_calls():
    _run(lambda inv: _provider_call_guard())


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
    original_launch = inv.jobs.launch
    inv.jobs.launch = lambda *a, **k: None  # do not actually spawn the real coordinator/Gemini run from a unit test
    try:
        item_id = await inv._finish_device_submission(owner, case, pending)
    finally:
        inv.jobs.launch = original_launch
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


async def _coverage_aggregation_across_children():
    owner = f"persist-{uuid.uuid4().hex[:8]}"
    await repo.ensure_indexes()
    case = await repo.create_case(owner, "text", None)
    from services.higgins import evidence as ev
    from services.higgins.contracts import EvidenceItem, Coverage
    expires = repo.utc(case["expires_at"])
    # A 2-page PDF: page 1 has a text layer, page 2 is scanned (rendered as its own image child) — mirrors _derive's shape.
    parent = EvidenceItem(id=str(uuid.uuid4()), case_id=case["case_id"], client_item_id="doc-1", origin="user_submission", kind="document",
                          parent_id=None, collected_at=now_utc(), expires_at=expires, media_type="application/pdf", byte_length=100,
                          coverage=Coverage(status="partial", unit="pages", total=2, examined=0), transformations=[], label="doc")
    attempt_id = uuid.uuid4().hex
    await repo.insert_evidence(owner, parent, {"filename": "doc.pdf"}, publication_root_id=parent.id, ingestion_attempt_id=attempt_id)
    text_child = EvidenceItem(id=str(uuid.uuid4()), case_id=case["case_id"], client_item_id="doc-1.text", origin="user_submission", kind="text",
                              parent_id=parent.id, collected_at=now_utc(), expires_at=expires, media_type="text/plain", byte_length=20,
                              coverage=Coverage(status="not_started", unit="characters", total=20, examined=0), transformations=[], label="text")
    await repo.insert_evidence(owner, text_child, {"pages": [{"page": 1, "start": 0, "end": 10, "readable": True}, {"page": 2, "start": 10, "end": 20, "readable": False}]},
                               publication_root_id=parent.id, ingestion_attempt_id=attempt_id)
    await repo.store_bytes(owner, case["case_id"], text_child.id, b"page one text.......", expires, publish_root=False)
    image_child = EvidenceItem(id=str(uuid.uuid4()), case_id=case["case_id"], client_item_id="doc-1.page2", origin="user_submission", kind="image",
                               parent_id=parent.id, collected_at=now_utc(), expires_at=expires, media_type="image/png", byte_length=5,
                               coverage=Coverage(status="not_started", unit="items", total=1, examined=0), transformations=[], label="page 2 image")
    await repo.insert_evidence(owner, image_child, {"page": 2, "derivedFrom": parent.id}, publication_root_id=parent.id, ingestion_attempt_id=attempt_id)
    await repo.store_bytes(owner, case["case_id"], image_child.id, b"PNG!!", expires, publish_root=False)
    assert await repo.publish_evidence_root(owner, case["case_id"], parent.id, attempt_id)

    # Reading the rendered page-2 image FIRST must not, by itself, mark the WHOLE parent PDF "examined" — page 1 is still unread.
    await ev.mark_examined(owner, case["case_id"], image_child.id, 0, 5, 5)
    parent_row = await repo.get_evidence(owner, case["case_id"], parent.id)
    assert parent_row["coverage"]["status"] == "partial" and parent_row["coverage"]["examined"] == 1

    # Reading page-2's EMPTY extracted-text span (it has no text layer) must not double-count or fabricate examination of page 2.
    await ev.mark_examined(owner, case["case_id"], text_child.id, 10, 20, 20)
    parent_row = await repo.get_evidence(owner, case["case_id"], parent.id)
    assert parent_row["coverage"]["examined"] == 1

    # Reading page-1's readable text completes the document (both of its pages are now genuinely covered).
    await ev.mark_examined(owner, case["case_id"], text_child.id, 0, 10, 20)
    parent_row = await repo.get_evidence(owner, case["case_id"], parent.id)
    assert parent_row["coverage"]["examined"] == 2 and parent_row["coverage"]["status"] == "examined" and parent_row["coverage"]["materialGap"] is False


async def _truncated_text_never_reaches_examined():
    owner = f"persist-{uuid.uuid4().hex[:8]}"
    await repo.ensure_indexes()
    case = await repo.create_case(owner, "text", None)
    from services.higgins import evidence as ev
    from services.higgins.contracts import EvidenceItem, Coverage
    expires = repo.utc(case["expires_at"])
    item = EvidenceItem(id=str(uuid.uuid4()), case_id=case["case_id"], client_item_id="shot-1.redacted", origin="apollo_inference", kind="text",
                        parent_id=None, collected_at=now_utc(), expires_at=expires, media_type="text/plain", byte_length=60000,
                        coverage=Coverage(status="not_started", unit="characters", total=60000, examined=0, material_gap=True, permanent_gap=True,
                                          reason="the transcription exceeded the 60,000-character processing budget and was truncated"),
                        transformations=[], label="redacted transcription")
    await repo.insert_evidence(owner, item, {})
    await repo.store_bytes(owner, case["case_id"], item.id, b"A" * 60000, expires)
    await ev.mark_examined(owner, case["case_id"], item.id, 0, 60000, 60000)  # the model reads EVERYTHING that was actually retained
    row = await repo.get_evidence(owner, case["case_id"], item.id)
    assert row["coverage"]["status"] == "partial"  # never "examined" — the untruncated remainder was never retained to read
    assert row["coverage"]["materialGap"] is True


async def _device_submission_resumes_from_storing(inv):
    """Simulates the sweeper picking up a claim that crashed mid-"storing" (never reached the "stored" commit)."""
    owner = f"persist-{uuid.uuid4().hex[:8]}"
    await repo.ensure_indexes()
    case = await repo.create_case(owner, "text", None)
    turn_id = str(uuid.uuid4())
    job = await repo.create_job(owner, case, turn_id, repo.digest("k4"), repo.digest("p4"), "turn", {"message": "q", "turnId": turn_id})
    await repo.cas(owner, case["case_id"], {"revision": 0}, {"$set": {"active_job_id": job["job_id"], "active_turn_id": turn_id, "status": "waiting_device"}})
    request_id = str(uuid.uuid4())
    result = DeviceResult(request_id=request_id, case_revision=1, capability_id="cap.x", status="observed", values={"state": True})
    stale_started = now_utc() - timedelta(seconds=200)
    await db.investigation_device_requests.insert_one({"owner_id": owner, "case_id": case["case_id"], "request_id": request_id, "job_id": job["job_id"],
        "request": {"id": request_id, "caseId": case["case_id"], "caseRevision": 1, "capabilityId": "cap.x", "fields": [], "reason": "test",
                    "expiresAt": repo.utc(case["expires_at"]).isoformat()},
        "fulfilled": False, "submission": {"state": "storing", "digest": "d1", "result_ciphertext": repo.enc_json(result.wire()), "evidence_id": None,
                                            "claimed_at": stale_started, "fence": "crashed-fence", "stage_started_at": stale_started}, "created_at": now_utc()})
    pending = await db.investigation_device_requests.find_one({"owner_id": owner, "case_id": case["case_id"], "request_id": request_id}, {"_id": 0})
    assert pending["submission"]["state"] == "storing"  # this is what the sweeper's query would hand to _finish_device_submission
    original_launch = inv.jobs.launch
    inv.jobs.launch = lambda *a, **k: None  # do not actually spawn the real coordinator/Gemini run from a unit test
    try:
        item_id = await inv._finish_device_submission(owner, case, pending)
    finally:
        inv.jobs.launch = original_launch
    assert item_id  # the crashed claim was taken over and completed, not silently ignored
    final = await db.investigation_device_requests.find_one({"owner_id": owner, "request_id": request_id}, {"_id": 0})
    assert final["submission"]["state"] == "resumed" and final["fulfilled"] is True


async def _partial_then_complete_read_reaches_examined():
    owner = f"persist-{uuid.uuid4().hex[:8]}"
    await repo.ensure_indexes()
    case = await repo.create_case(owner, "text", None)
    from services.higgins import evidence as ev
    from services.higgins.contracts import EvidenceItem, Coverage
    expires = repo.utc(case["expires_at"])
    item = EvidenceItem(id=str(uuid.uuid4()), case_id=case["case_id"], client_item_id="note-1", origin="user_submission", kind="text",
                        parent_id=None, collected_at=now_utc(), expires_at=expires, media_type="text/plain", byte_length=5000,
                        coverage=Coverage(status="not_started", unit="characters", total=5000, examined=0), transformations=[], label="note")
    await repo.insert_evidence(owner, item, {})
    await repo.store_bytes(owner, case["case_id"], item.id, b"B" * 5000, expires)
    # An ordinary, genuinely in-progress partial read (no ingestion-time gap at all).
    await ev.mark_examined(owner, case["case_id"], item.id, 0, 2000, 5000)
    row = await repo.get_evidence(owner, case["case_id"], item.id)
    assert row["coverage"]["status"] == "partial" and row["coverage"]["materialGap"] is True  # correctly not yet fully read
    # Reading the remainder must complete it — an ordinary in-progress read is NOT a permanent gap and must resolve.
    await ev.mark_examined(owner, case["case_id"], item.id, 2000, 5000, 5000)
    row = await repo.get_evidence(owner, case["case_id"], item.id)
    assert row["coverage"]["status"] == "examined" and row["coverage"]["materialGap"] is False


def _request(owner: str):
    from starlette.requests import Request
    request = Request({"type": "http", "method": "POST", "path": "/", "headers": []})
    request.state.device = {"device_id": owner}
    return request


async def _upload_replay_digest_mismatch_is_rejected(inv):
    from fastapi import HTTPException
    from services.higgins.contracts import CreateUpload

    owner = f"persist-{uuid.uuid4().hex[:8]}"
    await repo.ensure_indexes()
    case = await repo.create_case(owner, "file", None)
    first = CreateUpload(expected_revision=0, client_item_id="shared-item", parent_id=None, kind="document", filename="a.txt", media_type="text/plain", declared_bytes=3)
    await inv.create_upload(case["case_id"], first, _request(owner))
    changed = CreateUpload(expected_revision=0, client_item_id="shared-item", parent_id=None, kind="document", filename="b.txt", media_type="text/plain", declared_bytes=4)
    with pytest.raises(HTTPException) as exc:
        await inv.create_upload(case["case_id"], changed, _request(owner))
    assert exc.value.status_code == 409
    assert await db.investigation_uploads.count_documents({"owner_id": owner, "case_id": case["case_id"], "metadata.clientItemId": "shared-item"}) == 1


async def _upload_replay_digest_match_binds(inv):
    from services.higgins.contracts import CreateUpload

    owner = f"persist-{uuid.uuid4().hex[:8]}"
    await repo.ensure_indexes()
    case = await repo.create_case(owner, "file", None)
    first = CreateUpload(expected_revision=0, client_item_id="shared-item-2", parent_id=None, kind="document", filename="a.txt", media_type="text/plain", declared_bytes=3)
    one = json.loads((await inv.create_upload(case["case_id"], first, _request(owner))).body)
    replay = first.model_copy(update={"expected_revision": 999})
    two = json.loads((await inv.create_upload(case["case_id"], replay, _request(owner))).body)
    assert two["replayed"] is True
    assert two["uploadId"] == one["uploadId"] and two["evidenceRootId"] == one["evidenceRootId"]


async def _device_observation_missing_content_is_reingested(inv):
    owner = f"persist-{uuid.uuid4().hex[:8]}"
    await repo.ensure_indexes()
    case = await repo.create_case(owner, "text", None)
    turn_id = str(uuid.uuid4())
    job = await repo.create_job(owner, case, turn_id, repo.digest("k5"), repo.digest("p5"), "turn", {"message": "q", "turnId": turn_id})
    await repo.cas(owner, case["case_id"], {"revision": 0}, {"$set": {"active_job_id": job["job_id"], "active_turn_id": turn_id, "status": "waiting_device"}})
    request_id = str(uuid.uuid4())
    # A metadata-only evidence row: mimics a crash between repo.insert_evidence and repo.store_bytes — no content chunk exists.
    orphan_id = str(uuid.uuid4())
    from services.higgins.contracts import EvidenceItem, Coverage
    orphan = EvidenceItem(id=orphan_id, case_id=case["case_id"], client_item_id=f"observation-{request_id}", origin="device_observation", kind="observation",
                          parent_id=None, collected_at=now_utc(), expires_at=repo.utc(case["expires_at"]), media_type="text/plain", byte_length=10,
                          coverage=Coverage(status="not_started", unit="characters", total=10, examined=0), transformations=[], label="observation")
    await repo.insert_evidence(owner, orphan, {})
    result = DeviceResult(request_id=request_id, case_revision=1, capability_id="cap.x", status="observed", values={"state": True})
    await db.investigation_device_requests.insert_one({"owner_id": owner, "case_id": case["case_id"], "request_id": request_id, "job_id": job["job_id"],
        "request": {"id": request_id, "caseId": case["case_id"], "caseRevision": 1, "capabilityId": "cap.x", "fields": [], "reason": "test",
                    "expiresAt": repo.utc(case["expires_at"]).isoformat()},
        "fulfilled": False, "submission": {"state": "claimed", "digest": "d1", "result_ciphertext": repo.enc_json(result.wire()), "evidence_id": None,
                                            "claimed_at": now_utc(), "fence": str(uuid.uuid4())}, "created_at": now_utc()})
    pending = await db.investigation_device_requests.find_one({"owner_id": owner, "case_id": case["case_id"], "request_id": request_id}, {"_id": 0})
    original_launch = inv.jobs.launch
    inv.jobs.launch = lambda *a, **k: None
    try:
        item_id = await inv._finish_device_submission(owner, case, pending)
    finally:
        inv.jobs.launch = original_launch
    assert item_id and item_id != orphan_id  # the content-less orphan was discarded, never reused as "already ingested"
    assert await db.investigation_evidence.find_one({"owner_id": owner, "case_id": case["case_id"], "evidence_id": orphan_id}) is None
    fresh_row = await db.investigation_content_chunks.find_one({"owner_id": owner, "case_id": case["case_id"], "evidence_id": item_id})
    assert fresh_row is not None  # the replacement evidence has actual durable content


async def _lease_renewal_detects_loss(inv):
    owner = f"persist-{uuid.uuid4().hex[:8]}"
    await repo.ensure_indexes()
    selector = {"owner_id": owner, "case_id": "case-x", "request_id": "req-x"}
    fence = "fence-1"
    await db.investigation_device_requests.insert_one({**selector, "job_id": "job-x", "request": {}, "fulfilled": False,
                                                       "submission": {"state": "storing", "fence": fence, "stage_started_at": now_utc()}})
    original_interval = inv.LEASE_RENEWAL_SECONDS
    inv.LEASE_RENEWAL_SECONDS = 0.05  # fast heartbeat for the test
    started, stopped = asyncio.Event(), asyncio.Event()

    async def _long_running_work():
        started.set()
        try:
            await asyncio.sleep(5)
        except asyncio.CancelledError:
            stopped.set()
            raise
    try:
        work = inv._with_lease_renewal(db.investigation_device_requests, selector, "submission.fence", fence, "submission.stage_started_at", _long_running_work())
        task = asyncio.ensure_future(work)
        await started.wait()
        await asyncio.sleep(0.02)
        # Steal the fence from underneath the in-flight work — simulating a takeover by another attempt.
        await db.investigation_device_requests.update_one(selector, {"$set": {"submission.fence": "fence-2"}})
        with pytest.raises(inv.LeaseLost):
            await task
        assert stopped.is_set()  # the wrapped work was actually cancelled, not left running after ownership was lost
    finally:
        inv.LEASE_RENEWAL_SECONDS = original_interval


async def _device_submission_waits_for_authoritative_consumption(inv):
    owner = f"persist-{uuid.uuid4().hex[:8]}"
    await repo.ensure_indexes()
    case = await repo.create_case(owner, "device", None)
    turn_id = str(uuid.uuid4())
    job = await repo.create_job(owner, case, turn_id, repo.digest("consume-key"), repo.digest("consume-payload"), "turn", {"message": "q", "turnId": turn_id})
    request_id = str(uuid.uuid4())
    await db.investigation_jobs.update_one({"job_id": job["job_id"]}, {"$set": {"status": "waiting_device", "lease_until": now_utc() + timedelta(seconds=60)}})
    await repo.cas(owner, case["case_id"], {"revision": 0}, {"$set": {"active_job_id": job["job_id"], "active_turn_id": turn_id,
                                                                                  "status": "waiting_device", "pending_device_request_ids": [request_id]}})
    result = DeviceResult(request_id=request_id, case_revision=1, capability_id="cap.x", status="observed", values={"state": True})
    await db.investigation_device_requests.insert_one({"owner_id": owner, "case_id": case["case_id"], "request_id": request_id, "job_id": job["job_id"],
        "request": {"id": request_id, "caseId": case["case_id"], "caseRevision": 1, "capabilityId": "cap.x", "fields": [], "reason": "test",
                    "expiresAt": repo.utc(case["expires_at"]).isoformat()}, "fulfilled": False,
        "submission": {"state": "claimed", "digest": "d1", "result_ciphertext": repo.enc_json(result.wire()), "evidence_id": None,
                       "claimed_at": now_utc(), "fence": str(uuid.uuid4())}, "created_at": now_utc()})
    pending = await db.investigation_device_requests.find_one({"owner_id": owner, "request_id": request_id}, {"_id": 0})
    item_id = await inv._finish_device_submission(owner, await repo.get_case(owner, case["case_id"]), pending)
    assert item_id
    final = await db.investigation_device_requests.find_one({"owner_id": owner, "request_id": request_id}, {"_id": 0})
    assert final["submission"]["state"] == "stored"
    assert final["fulfilled"] is False
    fresh_job = await repo.get_job(owner, case["case_id"], job["job_id"])
    assert request_id not in fresh_job.get("consumed_device_request_ids", [])


async def _evidence_publication_is_atomic():
    from services.higgins.contracts import EvidenceItem, Coverage
    from fastapi import HTTPException

    owner = f"persist-{uuid.uuid4().hex[:8]}"
    await repo.ensure_indexes()
    case = await repo.create_case(owner, "file", None)
    root_id, attempt_id = str(uuid.uuid4()), uuid.uuid4().hex
    item = EvidenceItem(id=root_id, case_id=case["case_id"], client_item_id="atomic-file", origin="user_submission", kind="document",
                        parent_id=None, collected_at=now_utc(), expires_at=repo.utc(case["expires_at"]), media_type="application/pdf", byte_length=4,
                        coverage=Coverage(status="not_started", unit="bytes", total=4), transformations=[], label="document")
    await repo.insert_evidence(owner, item, {}, publication_root_id=root_id, ingestion_attempt_id=attempt_id)
    await repo.store_bytes(owner, case["case_id"], root_id, b"data", item.expires_at, publish_root=False)
    assert await repo.list_evidence(owner, case["case_id"]) == []
    with pytest.raises(HTTPException) as exc:
        await repo.get_evidence(owner, case["case_id"], root_id)
    assert exc.value.status_code == 409
    assert await repo.publish_evidence_root(owner, case["case_id"], root_id, attempt_id)
    assert [row["evidence_id"] for row in await repo.list_evidence(owner, case["case_id"])] == [root_id]


async def _device_request_identity_is_durable():
    from services.higgins import tools

    owner = f"persist-{uuid.uuid4().hex[:8]}"
    await repo.ensure_indexes()
    case = await repo.create_case(owner, "device", {"platform": "android", "capabilityIds": ["cap.x"]})
    job = {"job_id": str(uuid.uuid4())}
    first = tools.ToolContext(owner, case, job, {"platform": "android", "capabilityIds": ["cap.x"]})
    first.tool_call_key = "1:0:request_device_observation:abc"
    result_one = await tools.request_device_observation(first, {"capabilityId": "cap.x", "fields": ["state"], "reason": "test"})
    replay = tools.ToolContext(owner, case, job, {"platform": "android", "capabilityIds": ["cap.x"]})
    replay.tool_call_key = first.tool_call_key
    result_two = await tools.request_device_observation(replay, {"capabilityId": "cap.x", "fields": ["state"], "reason": "test"})
    assert result_one["requestId"] == result_two["requestId"]
    assert await db.investigation_device_requests.count_documents({"owner_id": owner, "job_id": job["job_id"]}) == 1


async def _legacy_content_discard_is_one_time():
    from services.higgins.retention import _discard_legacy_content_once, migrate_and_index

    migration_id = f"test-retention-{uuid.uuid4().hex}"
    owner = f"retention-{uuid.uuid4().hex}"
    await db.ask_messages.insert_one({"device_id": owner, "scope_id": "before", "content_version": 0})
    await migrate_and_index()
    assert await db.ask_messages.count_documents({"device_id": owner}) == 1
    assert await _discard_legacy_content_once(migration_id) is True
    assert await db.ask_messages.count_documents({"device_id": owner}) == 0
    await db.ask_messages.insert_one({"device_id": owner, "scope_id": "after", "content_version": 0})
    assert await _discard_legacy_content_once(migration_id) is False
    assert await db.ask_messages.count_documents({"device_id": owner, "scope_id": "after"}) == 1
    await db.ask_messages.delete_many({"device_id": owner})


async def _published_root_survives_discard():
    from services.higgins.contracts import Coverage, EvidenceItem

    owner = f"persist-{uuid.uuid4().hex[:8]}"
    await repo.ensure_indexes()
    case = await repo.create_case(owner, "file", None)
    root_id, attempt_id = str(uuid.uuid4()), uuid.uuid4().hex
    item = EvidenceItem(id=root_id, case_id=case["case_id"], client_item_id="immutable-file", origin="user_submission", kind="document",
                        parent_id=None, collected_at=now_utc(), expires_at=repo.utc(case["expires_at"]), media_type="text/plain", byte_length=4,
                        coverage=Coverage(status="not_started", unit="bytes", total=4), transformations=[], label="document")
    await repo.insert_evidence(owner, item, {"contentDigest": "same"}, publication_root_id=root_id, ingestion_attempt_id=attempt_id)
    await repo.store_bytes(owner, case["case_id"], root_id, b"data", item.expires_at, publish_root=False)
    assert await repo.publish_evidence_root(owner, case["case_id"], root_id, attempt_id)
    assert await repo.discard_incomplete_ingestion(owner, case["case_id"], root_id, attempt_id=attempt_id) is False
    assert (await repo.get_evidence(owner, case["case_id"], root_id))["publication_state"] == "committed"


async def _published_root_repairs_upload_projection(inv):
    from services.higgins import evidence as ev
    from services.higgins.contracts import CreateUpload, ExpectedRevision
    from services.higgins.encryption import encrypt

    owner = f"persist-{uuid.uuid4().hex[:8]}"
    await repo.ensure_indexes()
    case = await repo.create_case(owner, "file", None)
    body = CreateUpload(expected_revision=0, client_item_id="projection-replay", parent_id=None, kind="document",
                        filename="proof.txt", media_type="text/plain", declared_bytes=3)
    created = json.loads((await inv.create_upload(case["case_id"], body, _request(owner))).body)
    root_id, upload_id = created["evidenceRootId"], created["uploadId"]
    data = b"abc"; digest = __import__("hashlib").sha256(data).hexdigest()
    await ev.ingest_file(owner, case, body.wire(), data, evidence_root_id=root_id, ingestion_attempt_id="published-before-projection", content_digest=digest)
    await db.investigation_upload_chunks.insert_one({"owner_id": owner, "case_id": case["case_id"], "upload_id": upload_id,
        "chunk_index": 0, "digest": repo.digest(data.hex()), "ciphertext": encrypt(data), "length": len(data), "expires_at": repo.utc(case["expires_at"])})
    response = await inv.complete_upload(case["case_id"], upload_id, ExpectedRevision(expected_revision=0), _request(owner))
    payload = json.loads(response.body)
    assert payload["replayed"] is True and payload["evidence"]["id"] == root_id
    upload = await db.investigation_uploads.find_one({"owner_id": owner, "upload_id": upload_id}, {"_id": 0})
    assert upload["evidence_id"] == root_id and upload["finalisation"]["state"] == "committed"


async def _stale_cancel_preserves_new_turn(inv):
    from fastapi import HTTPException
    from services.higgins.contracts import ExpectedRevision

    owner = f"persist-{uuid.uuid4().hex[:8]}"
    await repo.ensure_indexes()
    case = await repo.create_case(owner, "text", None)
    first = await repo.create_job(owner, case, str(uuid.uuid4()), repo.digest("cancel-1"), repo.digest("p1"), "turn", {"message": "first"})
    second = await repo.create_job(owner, case, str(uuid.uuid4()), repo.digest("cancel-2"), repo.digest("p2"), "turn", {"message": "second"})
    active = await repo.cas(owner, case["case_id"], {"revision": 0}, {"$set": {"active_job_id": second["job_id"], "active_turn_id": second["turn_id"], "status": "queued"}})
    with pytest.raises(HTTPException) as exc:
        await inv.cancel_job(case["case_id"], first["job_id"], ExpectedRevision(expected_revision=active["revision"]), _request(owner))
    assert exc.value.status_code == 409
    fresh_case = await repo.get_case(owner, case["case_id"])
    assert fresh_case["active_job_id"] == second["job_id"]
    await db.investigation_jobs.update_one({"owner_id": owner, "job_id": first["job_id"]}, {"$set": {"status": "completed"}})
    response = await inv.cancel_job(case["case_id"], first["job_id"], ExpectedRevision(expected_revision=fresh_case["revision"]), _request(owner))
    assert json.loads(response.body) == {"status": "completed", "cleanupStatus": "not_required", "cancelled": False}


async def _ledger_replay_restores_observation():
    from services.higgins import coordinator

    owner = f"persist-{uuid.uuid4().hex[:8]}"
    await repo.ensure_indexes()
    case = await repo.create_case(owner, "device", {"platform": "android", "capabilityIds": ["cap.x"]})
    job = await repo.create_job(owner, case, str(uuid.uuid4()), repo.digest("ledger"), repo.digest("payload"), "turn", {"message": "q"})
    request_id = str(uuid.uuid4())
    checkpoint = {"contents": [], "rounds": 1, "toolLedger": {"tool-key": {"output": {"status": "pending", "requestId": request_id}, "researchCalls": 0}},
                  "pendingBatch": [{"key": "tool-key", "name": "request_device_observation", "args": {"capabilityId": "cap.x"}}],
                  "pendingNextIndex": 0, "pendingOutputs": [], "pendingMarks": [], "deviceResults": []}
    await db.investigation_jobs.update_one({"owner_id": owner, "job_id": job["job_id"]}, {"$set": {"checkpoint_ciphertext": repo.enc_json(checkpoint)}})
    request = {"id": request_id, "caseId": case["case_id"], "caseRevision": 0, "capabilityId": "cap.x", "fields": [], "reason": "test",
               "expiresAt": repo.utc(case["expires_at"]).isoformat()}
    await db.investigation_device_requests.insert_one({"owner_id": owner, "case_id": case["case_id"], "request_id": request_id, "job_id": job["job_id"],
                                                        "request": request, "fulfilled": False, "submission": None, "created_at": now_utc()})
    async def progress(*_args):
        return None
    outcome = await coordinator.run_turn(owner, await repo.get_case(owner, case["case_id"]), await repo.get_job(owner, case["case_id"], job["job_id"]), progress)
    assert outcome.kind == "waiting_device" and outcome.request["id"] == request_id


async def _consumed_observation_repairs_inbox():
    from services.higgins import coordinator

    class ProviderReached(Exception):
        pass

    owner = f"persist-{uuid.uuid4().hex[:8]}"
    await repo.ensure_indexes()
    case = await repo.create_case(owner, "device", {"platform": "android", "capabilityIds": ["cap.x"]})
    job = await repo.create_job(owner, case, str(uuid.uuid4()), repo.digest("consumed"), repo.digest("payload"), "turn", {"message": "q"})
    request_id = str(uuid.uuid4())
    await db.investigation_jobs.update_one({"owner_id": owner, "job_id": job["job_id"]}, {"$set": {"consumed_device_request_ids": [request_id]}})
    await db.investigation_device_requests.insert_one({"owner_id": owner, "case_id": case["case_id"], "request_id": request_id, "job_id": job["job_id"],
        "request": {"id": request_id}, "fulfilled": False, "submission": {"state": "stored"}, "created_at": now_utc()})
    original = coordinator.provider.generate
    async def reached(*_args, **_kwargs):
        raise ProviderReached()
    coordinator.provider.generate = reached
    async def progress(*_args):
        return None
    try:
        with pytest.raises(ProviderReached):
            await coordinator.run_turn(owner, await repo.get_case(owner, case["case_id"]), await repo.get_job(owner, case["case_id"], job["job_id"]), progress)
    finally:
        coordinator.provider.generate = original
    repaired = await db.investigation_device_requests.find_one({"owner_id": owner, "request_id": request_id}, {"_id": 0})
    assert repaired["fulfilled"] is True and repaired["submission"]["state"] == "resumed"


async def _document_continuation_publishes_slice():
    from pypdf import PdfWriter
    from services.higgins import evidence as ev
    from services.higgins.contracts import Coverage, EvidenceItem

    buffer = io.BytesIO(); writer = PdfWriter()
    for _ in range(3): writer.add_blank_page(width=100, height=100)
    writer.add_uri(1, "https://later.example/path", [0, 0, 80, 20])
    writer.write(buffer); data = buffer.getvalue()
    owner = f"persist-{uuid.uuid4().hex[:8]}"
    await repo.ensure_indexes()
    case = await repo.create_case(owner, "file", None)
    root_id = str(uuid.uuid4())
    item = EvidenceItem(id=root_id, case_id=case["case_id"], client_item_id="long-pdf", origin="user_submission", kind="document",
                        parent_id=None, collected_at=now_utc(), expires_at=repo.utc(case["expires_at"]), media_type="application/pdf", byte_length=len(data),
                        coverage=Coverage(status="partial", unit="pages", total=3, omitted_ranges=[{"start": 0, "end": 3, "reason": "not extracted"}], material_gap=True),
                        transformations=[], label="PDF")
    await repo.insert_evidence(owner, item, {})
    await repo.store_bytes(owner, case["case_id"], root_id, data, item.expires_at)
    stale_id, stale_attempt = str(uuid.uuid4()), uuid.uuid4().hex
    stale = EvidenceItem(id=stale_id, case_id=case["case_id"], client_item_id="long-pdf.pages.2-3", origin="apollo_inference", kind="text", parent_id=root_id,
                         collected_at=now_utc(), expires_at=item.expires_at, media_type="text/plain", byte_length=5,
                         coverage=Coverage(status="not_started", unit="characters", total=5), transformations=[], label="interrupted slice")
    await repo.insert_evidence(owner, stale, {}, publication_root_id=stale_id, ingestion_attempt_id=stale_attempt)
    await repo.store_bytes(owner, case["case_id"], stale_id, b"stale", stale.expires_at, publish_root=False)
    result = await ev.continue_document(owner, case, root_id, 2, 2)
    assert result["startPage"] == 2 and result["endPage"] == 3 and result["replayed"] is False
    assert any("https://later.example/path" in link for link in result["links"])
    assert result["evidenceId"] != stale_id
    parent = await repo.get_evidence(owner, case["case_id"], root_id)
    assert result["evidenceId"] in parent["related_evidence_ids"]
    assert parent["coverage"]["permanentGap"] is False


async def _publication_manifest_is_attempt_isolated():
    from fastapi import HTTPException
    from services.higgins.contracts import Coverage, EvidenceItem

    owner = f"persist-{uuid.uuid4().hex[:8]}"; await repo.ensure_indexes(); case = await repo.create_case(owner, "file", None)
    root_id, winning = str(uuid.uuid4()), uuid.uuid4().hex
    root = EvidenceItem(id=root_id, case_id=case["case_id"], client_item_id="manifest-root", origin="user_submission", kind="document", parent_id=None,
                        collected_at=now_utc(), expires_at=repo.utc(case["expires_at"]), media_type="text/plain", byte_length=4,
                        coverage=Coverage(status="not_started", unit="bytes", total=4), transformations=[], label="root")
    await repo.insert_evidence(owner, root, {}, publication_root_id=root_id, ingestion_attempt_id=winning)
    await repo.store_bytes(owner, case["case_id"], root_id, b"root", root.expires_at, publish_root=False)
    assert await repo.publish_evidence_root(owner, case["case_id"], root_id, winning)
    late_id = str(uuid.uuid4())
    late = root.model_copy(update={"id": late_id, "client_item_id": "late-child", "parent_id": root_id, "label": "late"})
    await repo.insert_evidence(owner, late, {}, publication_root_id=root_id, ingestion_attempt_id="abandoned-attempt")
    await repo.store_bytes(owner, case["case_id"], late_id, b"late", late.expires_at, publish_root=False)
    assert late_id not in [row["evidence_id"] for row in await repo.list_evidence(owner, case["case_id"])]
    with pytest.raises(HTTPException) as exc:
        await repo.get_evidence(owner, case["case_id"], late_id)
    assert exc.value.status_code == 409
    with pytest.raises(HTTPException):
        await repo.update_evidence(owner, case["case_id"], root_id, {"$set": {"label": "wrong"}}, attempt_id="abandoned-attempt")


async def _concurrent_device_results_merge(inv):
    owner = f"persist-{uuid.uuid4().hex[:8]}"; await repo.ensure_indexes(); case = await repo.create_case(owner, "device", None)
    turn_id = str(uuid.uuid4()); job = await repo.create_job(owner, case, turn_id, repo.digest("multi-device"), repo.digest("payload"), "turn", {"message": "q"})
    request_ids = [str(uuid.uuid4()), str(uuid.uuid4())]
    await db.investigation_jobs.update_one({"owner_id": owner, "job_id": job["job_id"]}, {"$set": {"status": "waiting_device", "lease_until": None}})
    await repo.cas(owner, case["case_id"], {"revision": 0}, {"$set": {"active_job_id": job["job_id"], "active_turn_id": turn_id,
        "status": "waiting_device", "pending_device_request_ids": request_ids}})
    pending_rows = []
    for index, request_id in enumerate(request_ids):
        result = DeviceResult(request_id=request_id, case_revision=1, capability_id=f"cap.{index}", status="observed", values={"index": index})
        await db.investigation_device_requests.insert_one({"owner_id": owner, "case_id": case["case_id"], "request_id": request_id, "job_id": job["job_id"],
            "request": {"id": request_id}, "fulfilled": False, "submission": {"state": "claimed", "digest": f"d{index}",
            "result_ciphertext": repo.enc_json(result.wire()), "evidence_id": None, "claimed_at": now_utc(), "fence": str(uuid.uuid4())}, "created_at": now_utc()})
        pending_rows.append(await db.investigation_device_requests.find_one({"owner_id": owner, "request_id": request_id}, {"_id": 0}))
    original_launch = inv.jobs.launch; inv.jobs.launch = lambda *_args: None
    try:
        current_case = await repo.get_case(owner, case["case_id"])
        await asyncio.gather(*[inv._finish_device_submission(owner, current_case, row) for row in pending_rows])
    finally:
        inv.jobs.launch = original_launch
    merged = await repo.get_job(owner, case["case_id"], job["job_id"])
    checkpoint = repo.dec_json(merged["checkpoint_ciphertext"])
    assert set(merged["consumed_device_request_ids"]) == set(request_ids)
    assert {result["requestId"] for result in checkpoint["deviceResults"]} == set(request_ids)


async def _upload_control_fences_publication():
    from services.higgins.contracts import Coverage, EvidenceItem

    owner = f"persist-{uuid.uuid4().hex[:8]}"; await repo.ensure_indexes(); case = await repo.create_case(owner, "file", None)
    upload_id, root_id, old_fence, new_fence = str(uuid.uuid4()), str(uuid.uuid4()), "old-fence", "new-fence"
    await db.investigation_uploads.insert_one({"owner_id": owner, "case_id": case["case_id"], "upload_id": upload_id,
        "evidence_root_id": root_id, "metadata": {"clientItemId": "controlled-root"}, "chunks": {}, "expires_at": repo.utc(case["expires_at"]),
        "finalisation": {"state": "ingesting", "fence": old_fence}})
    old = EvidenceItem(id=root_id, case_id=case["case_id"], client_item_id="controlled-root", origin="user_submission", kind="document", parent_id=None,
                       collected_at=now_utc(), expires_at=repo.utc(case["expires_at"]), media_type="text/plain", byte_length=3,
                       coverage=Coverage(status="not_started", unit="bytes", total=3), transformations=[], label="old")
    old_owner = {"upload_id": upload_id, "fence": old_fence}
    await repo.insert_evidence(owner, old, {}, publication_root_id=root_id, ingestion_attempt_id=old_fence, publication_owner=old_owner)
    await repo.store_bytes(owner, case["case_id"], root_id, b"old", old.expires_at, publish_root=False)
    await db.investigation_uploads.update_one({"owner_id": owner, "upload_id": upload_id, "finalisation.fence": old_fence},
                                               {"$set": {"finalisation.fence": new_fence}})
    assert await repo.publish_evidence_root(owner, case["case_id"], root_id, old_fence, publication_owner=old_owner) is False
    assert await repo.discard_incomplete_ingestion(owner, case["case_id"], root_id, attempt_id=old_fence, publication_owner=old_owner)
    current = old.model_copy(update={"label": "new"}); new_owner = {"upload_id": upload_id, "fence": new_fence}
    await repo.insert_evidence(owner, current, {}, publication_root_id=root_id, ingestion_attempt_id=new_fence, publication_owner=new_owner)
    await repo.store_bytes(owner, case["case_id"], root_id, b"new", current.expires_at, publish_root=False)
    assert await repo.publish_evidence_root(owner, case["case_id"], root_id, new_fence, publication_owner=new_owner)
    authority = await db.investigation_uploads.find_one({"owner_id": owner, "upload_id": upload_id}, {"_id": 0})
    assert authority["finalisation"]["published_attempt_id"] == new_fence
    assert authority["finalisation"]["publication_manifest"] == [root_id]


async def _provider_call_guard():
    from services.higgins import provider
    with pytest.raises(AssertionError, match="prohibited"):
        await provider.generate("system", "prompt")


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))
