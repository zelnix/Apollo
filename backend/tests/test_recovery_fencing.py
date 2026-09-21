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


def test_coverage_aggregates_across_text_and_image_children():
    _run(lambda inv: _coverage_aggregation_across_children())


def test_truncated_text_never_reaches_examined():
    _run(lambda inv: _truncated_text_never_reaches_examined())


def test_ordinary_partial_read_still_reaches_examined_once_complete():
    _run(lambda inv: _partial_then_complete_read_reaches_examined())


def test_upload_replay_rejects_a_different_file_under_the_same_client_item():
    _run(lambda inv: _upload_replay_digest_mismatch_is_rejected())


def test_upload_replay_binds_to_identical_content_from_a_different_upload():
    _run(lambda inv: _upload_replay_digest_match_binds())


def test_device_observation_metadata_without_content_is_reingested():
    _run(lambda inv: _device_observation_missing_content_is_reingested(inv))


def test_lease_renewal_detects_loss_and_stops_the_work():
    _run(lambda inv: _lease_renewal_detects_loss(inv))


def test_device_submission_resumes_from_a_crashed_storing_state():
    _run(lambda inv: _device_submission_resumes_from_storing(inv))


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
    await repo.insert_evidence(owner, parent, {"filename": "doc.pdf"})
    text_child = EvidenceItem(id=str(uuid.uuid4()), case_id=case["case_id"], client_item_id="doc-1.text", origin="user_submission", kind="text",
                              parent_id=parent.id, collected_at=now_utc(), expires_at=expires, media_type="text/plain", byte_length=20,
                              coverage=Coverage(status="not_started", unit="characters", total=20, examined=0), transformations=[], label="text")
    await repo.insert_evidence(owner, text_child, {"pages": [{"page": 1, "start": 0, "end": 10, "readable": True}, {"page": 2, "start": 10, "end": 20, "readable": False}]})
    await repo.store_bytes(owner, case["case_id"], text_child.id, b"page one text.......", expires)
    image_child = EvidenceItem(id=str(uuid.uuid4()), case_id=case["case_id"], client_item_id="doc-1.page2", origin="user_submission", kind="image",
                               parent_id=parent.id, collected_at=now_utc(), expires_at=expires, media_type="image/png", byte_length=5,
                               coverage=Coverage(status="not_started", unit="items", total=1, examined=0), transformations=[], label="page 2 image")
    await repo.insert_evidence(owner, image_child, {"page": 2, "derivedFrom": parent.id})
    await repo.store_bytes(owner, case["case_id"], image_child.id, b"PNG!!", expires)

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


async def _upload_replay_digest_mismatch_is_rejected():
    owner = f"persist-{uuid.uuid4().hex[:8]}"
    await repo.ensure_indexes()
    case = await repo.create_case(owner, "text", None)
    # Simulate a DIFFERENT, already-committed upload owning this exact client item ID with DIFFERENT content.
    other_evidence_id = str(uuid.uuid4())
    from services.higgins.contracts import EvidenceItem, Coverage
    other_item = EvidenceItem(id=other_evidence_id, case_id=case["case_id"], client_item_id="shared-item", origin="user_submission", kind="text",
                              parent_id=None, collected_at=now_utc(), expires_at=repo.utc(case["expires_at"]), media_type="text/plain", byte_length=3,
                              coverage=Coverage(status="not_started", unit="characters", total=3, examined=0), transformations=[], label="file A")
    await repo.insert_evidence(owner, other_item, {})
    await db.investigation_uploads.insert_one({"owner_id": owner, "case_id": case["case_id"], "upload_id": str(uuid.uuid4()),
        "metadata": {"declaredBytes": 3, "clientItemId": "shared-item"}, "chunks": {}, "expires_at": now_utc() + timedelta(minutes=10),
        "finalisation": {"state": "committed", "digest": "digest-of-file-A", "started_at": now_utc(), "fence": "f1", "evidence_id": other_evidence_id},
        "evidence_id": other_evidence_id})
    # Our own, separate upload attempt for a DIFFERENT file that happens to share the same client item ID.
    fresh_upload_id = str(uuid.uuid4())
    await db.investigation_uploads.insert_one({"owner_id": owner, "case_id": case["case_id"], "upload_id": fresh_upload_id,
        "metadata": {"declaredBytes": 3, "clientItemId": "shared-item"}, "chunks": {}, "expires_at": now_utc() + timedelta(minutes=10), "finalisation": None})
    partial = await db.investigation_evidence.find_one({"owner_id": owner, "case_id": case["case_id"], "client_item_id": "shared-item"}, {"_id": 0, "evidence_id": 1})
    owning_upload = await db.investigation_uploads.find_one(
        {"owner_id": owner, "case_id": case["case_id"], "finalisation.state": "committed", "finalisation.evidence_id": partial["evidence_id"]}, {"_id": 0, "upload_id": 1, "finalisation": 1})
    assert owning_upload is not None
    assert owning_upload["finalisation"]["digest"] != "digest-of-file-B"  # our (different) file's digest — this is the exact condition `complete_upload` checks


async def _upload_replay_digest_match_binds():
    owner = f"persist-{uuid.uuid4().hex[:8]}"
    await repo.ensure_indexes()
    case = await repo.create_case(owner, "text", None)
    other_evidence_id = str(uuid.uuid4())
    from services.higgins.contracts import EvidenceItem, Coverage
    other_item = EvidenceItem(id=other_evidence_id, case_id=case["case_id"], client_item_id="shared-item-2", origin="user_submission", kind="text",
                              parent_id=None, collected_at=now_utc(), expires_at=repo.utc(case["expires_at"]), media_type="text/plain", byte_length=3,
                              coverage=Coverage(status="not_started", unit="characters", total=3, examined=0), transformations=[], label="file A")
    await repo.insert_evidence(owner, other_item, {})
    same_digest = "same-content-digest"
    await db.investigation_uploads.insert_one({"owner_id": owner, "case_id": case["case_id"], "upload_id": str(uuid.uuid4()),
        "metadata": {"declaredBytes": 3, "clientItemId": "shared-item-2"}, "chunks": {}, "expires_at": now_utc() + timedelta(minutes=10),
        "finalisation": {"state": "committed", "digest": same_digest, "started_at": now_utc(), "fence": "f1", "evidence_id": other_evidence_id},
        "evidence_id": other_evidence_id})
    partial = await db.investigation_evidence.find_one({"owner_id": owner, "case_id": case["case_id"], "client_item_id": "shared-item-2"}, {"_id": 0, "evidence_id": 1})
    owning_upload = await db.investigation_uploads.find_one(
        {"owner_id": owner, "case_id": case["case_id"], "finalisation.state": "committed", "finalisation.evidence_id": partial["evidence_id"]}, {"_id": 0, "upload_id": 1, "finalisation": 1})
    assert owning_upload["finalisation"]["digest"] == same_digest  # an IDENTICAL resubmission — safe to bind and replay, per `complete_upload`


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


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-q"]))
