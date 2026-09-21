"""Owner-scoped encrypted persistence for investigation cases (spec §5).

Case control record is authoritative: revision, lifecycle epoch, active job and lease fence.
All content-bearing fields are Fernet ciphertext under the dedicated investigation key.
Expiry is enforced on every read; Mongo TTL is only a backstop.
"""
from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import HTTPException
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError, OperationFailure

from core.db import db, now_utc
from services.higgins.capacity import LIFETIME_SECONDS, WORK_SECONDS
from services.higgins.contracts import (Coverage, EvidenceItem, Failure, HigginsResponse, Inventory, InvestigationCase, Job,
                                        SourceReference, TurnCommit, failure_body)
from services.higgins.encryption import decrypt, encrypt

CHUNK_BYTES = 1024 * 1024
CONTENT = ("investigation_evidence", "investigation_content_chunks", "investigation_events", "investigation_turn_commits",
           "investigation_jobs", "investigation_device_requests", "investigation_settings_plans", "voice_cache", "investigation_uploads", "investigation_upload_chunks")


def utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def enc_json(value: Any) -> str:
    return encrypt(json.dumps(value, default=str, ensure_ascii=False))


def dec_json(value: str) -> Any:
    return json.loads(decrypt(value).decode("utf-8"))


def digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def http(status: int, code: str, message: str, **kw) -> HTTPException:
    return HTTPException(status, failure_body(code, message, **kw))


async def _ttl(collection, seconds: int) -> None:
    """Idempotent TTL backstop on expires_at; replaces an older definition with different options (R02: no extra hour)."""
    try:
        await collection.create_index("expires_at", expireAfterSeconds=seconds)
    except OperationFailure:
        await collection.drop_index("expires_at_1")
        await collection.create_index("expires_at", expireAfterSeconds=seconds)


async def ensure_indexes() -> None:
    await db.investigation_cases.create_index([("owner_id", 1), ("case_id", 1)], unique=True)
    await db.investigation_cases.create_index("expires_at")
    await db.investigation_cases.create_index([("cleanup_status", 1), ("expires_at", 1)])
    await db.investigation_idempotency.create_index([("owner_id", 1), ("operation", 1), ("key_digest", 1)], unique=True)
    await _ttl(db.investigation_idempotency, 0)
    await db.investigation_evidence.create_index([("owner_id", 1), ("case_id", 1), ("evidence_id", 1)], unique=True)
    await db.investigation_evidence.create_index([("owner_id", 1), ("case_id", 1), ("client_item_id", 1)], unique=True)
    await _ttl(db.investigation_evidence, 0)
    await db.investigation_content_chunks.create_index([("owner_id", 1), ("case_id", 1), ("evidence_id", 1), ("chunk_index", 1)], unique=True)
    await _ttl(db.investigation_content_chunks, 0)
    await db.investigation_jobs.create_index([("owner_id", 1), ("case_id", 1), ("idempotency_key_digest", 1)], unique=True)
    await db.investigation_jobs.create_index([("owner_id", 1), ("job_id", 1)], unique=True)
    await db.investigation_jobs.create_index([("status", 1), ("lease_until", 1)])
    await _ttl(db.investigation_jobs, 0)
    await _ttl(db.investigation_turn_commits, 0)
    await db.investigation_events.create_index([("owner_id", 1), ("job_id", 1), ("sequence", 1)], unique=True)
    await _ttl(db.investigation_events, 0)
    await db.investigation_cleanup.create_index([("owner_id", 1), ("case_id", 1), ("target_type", 1), ("target_id", 1)], unique=True)
    await db.investigation_cleanup.create_index("next_attempt_at")
    await db.investigation_device_requests.create_index([("owner_id", 1), ("case_id", 1), ("request_id", 1)], unique=True)
    await db.investigation_settings_plans.create_index([("owner_id", 1), ("case_id", 1), ("plan_id", 1)], unique=True)
    await db.investigation_uploads.create_index([("owner_id", 1), ("case_id", 1), ("upload_id", 1)], unique=True)
    await _ttl(db.investigation_uploads, 0)
    await db.investigation_upload_chunks.create_index([("owner_id", 1), ("upload_id", 1), ("chunk_index", 1)], unique=True)
    await _ttl(db.investigation_upload_chunks, 0)
    try:
        await db.investigation_turn_commits.drop_index("owner_id_1_case_id_1_turn_id_1")
    except OperationFailure:
        pass
    await db.investigation_turn_commits.create_index([("owner_id", 1), ("case_id", 1), ("commit_id", 1)], unique=True)
    await db.investigation_reports.create_index([("owner_id", 1), ("report_id", 1)], unique=True)


async def backfill_work_epochs() -> None:
    """One-time, idempotent reconciliation for cases/jobs created before `work_epoch` existed. The field is missing
    entirely on old documents, so the exact-match Mongo filters used throughout this module (e.g. `cas(...,
    {"work_epoch": job.get("work_epoch", job["epoch"])}, ...)`) never match them even though the Python-side fallback
    treats a missing `work_epoch` as equal to `epoch`. This sets the DB field itself to the case's/job's own current
    `epoch`, which changes no behaviour (a case/job whose `work_epoch` already equals its `epoch` is exactly the
    pre-migration invariant) and revives nothing: status, leases and history are left untouched."""
    async for case in db.investigation_cases.find({"work_epoch": {"$exists": False}}, {"_id": 0, "owner_id": 1, "case_id": 1, "epoch": 1}):
        await db.investigation_cases.update_one({"owner_id": case["owner_id"], "case_id": case["case_id"], "work_epoch": {"$exists": False}},
                                                {"$set": {"work_epoch": case["epoch"]}})
    async for job in db.investigation_jobs.find({"work_epoch": {"$exists": False}}, {"_id": 0, "owner_id": 1, "job_id": 1, "epoch": 1}):
        await db.investigation_jobs.update_one({"owner_id": job["owner_id"], "job_id": job["job_id"], "work_epoch": {"$exists": False}},
                                               {"$set": {"work_epoch": job["epoch"]}})


# ------------------------------------------------------------------ idempotency
async def idempotent(owner: str, operation: str, key: str, payload: str) -> tuple[Optional[dict], str]:
    """Returns (existing record or None, payload digest). Changed payload under the same key → 409."""
    key_digest, payload_digest = digest(f"{owner}:{operation}:{key}"), digest(payload)
    existing = await db.investigation_idempotency.find_one({"owner_id": owner, "operation": operation, "key_digest": key_digest}, {"_id": 0})
    if existing and existing["payload_digest"] != payload_digest:
        raise http(409, "conflict", "This Idempotency-Key was already used for a different request. Send a new key for a new submission.")
    return existing, payload_digest


async def remember(owner: str, operation: str, key: str, payload_digest: str, result: dict, expires_at: datetime) -> None:
    try:
        await db.investigation_idempotency.insert_one({"owner_id": owner, "operation": operation, "key_digest": digest(f"{owner}:{operation}:{key}"),
                                                       "payload_digest": payload_digest, "result": result, "expires_at": expires_at})
    except DuplicateKeyError:
        pass


# ------------------------------------------------------------------ lifecycle guard (R02)
async def live_epoch(owner: str, case_id: str) -> Optional[str]:
    """Current epoch of a live (not deleted/expired) case, or None. Writers call this immediately before and after awaited work."""
    doc = await db.investigation_cases.find_one({"owner_id": owner, "case_id": case_id, "deleted": False, "expires_at": {"$gt": now_utc()},
                                                 "status": {"$nin": ["expired"]}}, {"_id": 0, "epoch": 1})
    return doc["epoch"] if doc else None


async def assert_live(owner: str, case_id: str, epoch: Optional[str] = None) -> str:
    current = await live_epoch(owner, case_id)
    if not current or (epoch and current != epoch):
        raise http(410, "evidence_expired", "This investigation was deleted, cancelled or expired before the operation finished; nothing was stored.")
    return current


# ------------------------------------------------------------------ cases
async def create_case(owner: str, gate: Optional[str], device_profile: Optional[dict]) -> dict:
    now = now_utc()
    doc = {"owner_id": owner, "case_id": str(uuid.uuid4()), "revision": 0, "epoch": uuid.uuid4().hex, "work_epoch": uuid.uuid4().hex, "gates": [gate] if gate else [], "status": "queued",
           "created_at": now, "updated_at": now, "expires_at": now + timedelta(seconds=LIFETIME_SECONDS), "active_job_id": None,
           "active_turn_id": None, "lease_fence": None, "response_ciphertext": None, "response_revision": None,
           "sources_ciphertext": enc_json([]), "device_profile_ciphertext": enc_json(device_profile) if device_profile else None,
           "pending_device_request_ids": [], "accepted_commits": [], "open_question_ciphertext": None,
           "cleanup_status": "not_due", "deleted": False, "attention": "none"}
    await db.investigation_cases.insert_one(dict(doc))
    return doc


async def get_case(owner: str, case_id: str, *, for_mutation: bool = False) -> dict:
    doc = await db.investigation_cases.find_one({"owner_id": owner, "case_id": case_id}, {"_id": 0})
    if not doc:
        raise http(404, "not_found", "No investigation with that reference belongs to this device.")
    if doc["deleted"] or doc["status"] == "expired":
        raise http(410, "evidence_expired", "This temporary investigation has been deleted or expired. Start a new check with the required evidence.")
    if utc(doc["expires_at"]) <= now_utc():
        await expire_case(owner, case_id)
        raise http(410, "evidence_expired", "The temporary investigation content expired at its original deadline. Submit the evidence again for a new check.")
    if for_mutation and doc["status"] in ("cancelled",):
        raise http(409, "conflict", "This investigation was cancelled. Start a new check.")
    return doc


async def cas(owner: str, case_id: str, expected: dict, update: dict, *, bump: bool = True) -> Optional[dict]:
    """Compare-and-swap on the authoritative case control record; None when the expectation no longer holds."""
    now = now_utc()
    update = {**update}
    update.setdefault("$set", {})["updated_at"] = now
    if bump:
        update["$inc"] = {**update.get("$inc", {}), "revision": 1}
    return await db.investigation_cases.find_one_and_update(
        {"owner_id": owner, "case_id": case_id, "deleted": False, "expires_at": {"$gt": now}, **expected}, update,
        projection={"_id": 0}, return_document=ReturnDocument.AFTER)


async def inventory(owner: str, case_id: str) -> Inventory:
    counts = Inventory()
    async for row in db.investigation_evidence.find({"owner_id": owner, "case_id": case_id}, {"_id": 0, "coverage": 1, "availability": 1}):
        counts.total += 1
        status = row.get("coverage", {}).get("status")
        if row.get("availability") == "purged":
            counts.purged += 1
        elif row.get("availability") != "available" or status == "unavailable":
            counts.unavailable += 1
        elif status == "examined":
            counts.examined += 1
        elif status == "partial":
            counts.partial += 1
    return counts


async def case_view(doc: dict) -> InvestigationCase:
    response = HigginsResponse.model_validate(dec_json(doc["response_ciphertext"])) if doc.get("response_ciphertext") else None
    return InvestigationCase(id=doc["case_id"], revision=doc["revision"], gates=doc["gates"], status=doc["status"], created_at=utc(doc["created_at"]),
                             updated_at=utc(doc["updated_at"]), expires_at=utc(doc["expires_at"]), response=response, active_job_id=doc.get("active_job_id"),
                             pending_device_request_ids=doc.get("pending_device_request_ids", []), inventory=await inventory(doc["owner_id"], doc["case_id"]),
                             cleanup_status=doc.get("cleanup_status", "not_due"))


def device_profile(doc: dict) -> Optional[dict]:
    return dec_json(doc["device_profile_ciphertext"]) if doc.get("device_profile_ciphertext") else None


# ------------------------------------------------------------------ sources (bounded list inside the case record)
async def sources(owner: str, case_id: str) -> list[dict]:
    doc = await db.investigation_cases.find_one({"owner_id": owner, "case_id": case_id}, {"_id": 0, "sources_ciphertext": 1})
    return dec_json(doc["sources_ciphertext"]) if doc and doc.get("sources_ciphertext") else []


async def add_sources(owner: str, case_id: str, new: list[SourceReference]) -> dict[str, str]:
    """Canonical registration: returns {proposed id: stored id}; a repeated URL keeps its first ID."""
    current = await sources(owner, case_id)
    by_url = {s["url"]: s["id"] for s in current}
    mapping = {}
    for source in new:
        if source.url in by_url:
            mapping[source.id] = by_url[source.url]
        else:
            current.append(source.wire()); by_url[source.url] = source.id; mapping[source.id] = source.id
    await db.investigation_cases.update_one({"owner_id": owner, "case_id": case_id, "deleted": False}, {"$set": {"sources_ciphertext": enc_json(current)}})
    return mapping


# ------------------------------------------------------------------ evidence + chunks
async def insert_evidence(owner: str, item: EvidenceItem, meta: dict) -> None:
    epoch = await assert_live(owner, item.case_id)
    doc = {"epoch": epoch, "owner_id": owner, "case_id": item.case_id, "evidence_id": item.id, "client_item_id": item.client_item_id, "origin": item.origin,
           "kind": item.kind, "parent_id": item.parent_id, "related_evidence_ids": item.related_evidence_ids, "collected_at": item.collected_at,
           "observed_at": item.observed_at, "expires_at": item.expires_at, "availability": item.availability, "media_type": item.media_type,
           "byte_length": item.byte_length, "coverage": item.coverage.wire(), "simulation": item.simulation.wire() if item.simulation else None,
           "transformations": [t.wire() for t in item.transformations], "label": item.label, "meta_ciphertext": enc_json(meta)}
    try:
        await db.investigation_evidence.insert_one(doc)
    except DuplicateKeyError as exc:
        raise http(409, "conflict", "That client item ID was already submitted to this investigation with different content.") from exc
    await settle_write(owner, item.case_id, epoch, db.investigation_evidence, {"owner_id": owner, "case_id": item.case_id, "evidence_id": item.id})


async def discard_incomplete_ingestion(owner: str, case_id: str, evidence_id: str) -> None:
    """Removes an evidence item whose ingestion never committed (upload finalisation interrupted), including derived children and bytes."""
    children = [r["evidence_id"] async for r in db.investigation_evidence.find({"owner_id": owner, "case_id": case_id, "parent_id": evidence_id}, {"_id": 0, "evidence_id": 1})]
    ids = [evidence_id, *children]
    await db.investigation_content_chunks.delete_many({"owner_id": owner, "case_id": case_id, "evidence_id": {"$in": ids}})
    await db.investigation_evidence.delete_many({"owner_id": owner, "case_id": case_id, "evidence_id": {"$in": ids}})
    await db.investigation_cases.update_one({"owner_id": owner, "case_id": case_id}, {"$pull": {"evidence_ids": {"$in": ids}}})


async def settle_write(owner: str, case_id: str, epoch: str, collection, selector: dict) -> None:
    """Writer-lease/tombstone protocol (S05). Every content write carries the case epoch observed BEFORE the awaited insert. After the
    insert the epoch is re-read: if the case was deleted/expired/regenerated meanwhile, the row is a late write and is removed here
    (compensation). If this process dies before compensating, `sweep_tombstones` removes any row whose epoch is not the live epoch."""
    if await live_epoch(owner, case_id) != epoch:
        await collection.delete_many(selector)
        raise http(410, "evidence_expired", "This investigation was deleted, cancelled or expired while the write was in flight; the write was rolled back.")


async def sweep_tombstones() -> int:
    """Removes content rows whose case epoch no longer matches a live case (late writers that never compensated)."""
    removed = 0
    async for case in db.investigation_cases.find({}, {"_id": 0, "owner_id": 1, "case_id": 1, "epoch": 1, "deleted": 1, "expires_at": 1}):
        live = not case.get("deleted") and utc(case["expires_at"]) > now_utc()
        selector = {"owner_id": case["owner_id"], "case_id": case["case_id"], **({"epoch": {"$exists": True, "$ne": case["epoch"]}} if live else {})}
        for name in ("investigation_evidence", "investigation_content_chunks"):
            removed += (await db[name].delete_many(selector)).deleted_count
        if not live:
            removed += (await db.investigation_events.delete_many({"owner_id": case["owner_id"], "case_id": case["case_id"]})).deleted_count
    return removed


def evidence_view(row: dict) -> EvidenceItem:
    return EvidenceItem(id=row["evidence_id"], case_id=row["case_id"], client_item_id=row["client_item_id"], origin=row["origin"], kind=row["kind"],
                        parent_id=row.get("parent_id"), related_evidence_ids=row.get("related_evidence_ids", []), collected_at=utc(row["collected_at"]),
                        observed_at=utc(row["observed_at"]) if row.get("observed_at") else None, expires_at=utc(row["expires_at"]),
                        availability=row["availability"], media_type=row.get("media_type"), byte_length=row.get("byte_length"),
                        coverage=Coverage.model_validate(row["coverage"]), simulation=row.get("simulation"), transformations=row.get("transformations", []),
                        label=row.get("label", ""))


async def get_evidence(owner: str, case_id: str, evidence_id: str) -> dict:
    row = await db.investigation_evidence.find_one({"owner_id": owner, "case_id": case_id, "evidence_id": evidence_id}, {"_id": 0})
    if not row:
        raise http(404, "not_found", "Unknown evidence reference for this investigation.")
    if row["availability"] == "purged" or utc(row["expires_at"]) <= now_utc():
        raise http(410, "evidence_expired", "The temporary copy of that item has been deleted. Select it again to continue checking its contents.", missing=[evidence_id])
    return row


async def list_evidence(owner: str, case_id: str) -> list[dict]:
    return await db.investigation_evidence.find({"owner_id": owner, "case_id": case_id}, {"_id": 0}).sort("collected_at", 1).to_list(None)


async def evidence_meta(row: dict) -> dict:
    return dec_json(row["meta_ciphertext"]) if row.get("meta_ciphertext") else {}


async def update_evidence(owner: str, case_id: str, evidence_id: str, update: dict) -> None:
    await db.investigation_evidence.update_one({"owner_id": owner, "case_id": case_id, "evidence_id": evidence_id}, update)


async def store_bytes(owner: str, case_id: str, evidence_id: str, data: bytes, expires_at: datetime) -> int:
    epoch = await assert_live(owner, case_id)
    count = 0
    for index in range(0, max(len(data), 1), CHUNK_BYTES):
        chunk = data[index:index + CHUNK_BYTES]
        await db.investigation_content_chunks.update_one(
            {"owner_id": owner, "case_id": case_id, "evidence_id": evidence_id, "chunk_index": count},
            {"$set": {"ciphertext": encrypt(chunk), "length": len(chunk), "expires_at": expires_at, "epoch": epoch}}, upsert=True)
        count += 1
    if await live_epoch(owner, case_id) != epoch:  # scope ended during the write: undo, never leave publishable content
        await db.investigation_content_chunks.delete_many({"owner_id": owner, "case_id": case_id, "evidence_id": evidence_id})
        raise http(410, "evidence_expired", "This investigation ended while content was being stored; nothing was kept.")
    return count


async def read_bytes(owner: str, case_id: str, evidence_id: str) -> bytes:
    rows = await db.investigation_content_chunks.find({"owner_id": owner, "case_id": case_id, "evidence_id": evidence_id, "expires_at": {"$gt": now_utc()}},
                                                      {"_id": 0}).sort("chunk_index", 1).to_list(None)
    if not rows:
        raise http(410, "evidence_expired", "The temporary content copy is no longer available.", missing=[evidence_id])
    return b"".join(decrypt(row["ciphertext"]) for row in rows)


async def purge_evidence_content(owner: str, case_id: str, evidence_id: str) -> None:
    await db.investigation_content_chunks.delete_many({"owner_id": owner, "case_id": case_id, "evidence_id": evidence_id})
    await update_evidence(owner, case_id, evidence_id, {"$set": {"availability": "purged"}, "$unset": {"meta_ciphertext": ""}})


# ------------------------------------------------------------------ jobs / events
async def create_job(owner: str, case: dict, turn_id: str, key_digest: str, payload_digest: str, kind: str, payload: dict) -> dict:
    now = now_utc()
    deadline = min(utc(case["expires_at"]), now + timedelta(seconds=WORK_SECONDS))
    doc = {"owner_id": owner, "case_id": case["case_id"], "job_id": str(uuid.uuid4()), "turn_id": turn_id, "idempotency_key_digest": key_digest,
           "payload_digest": payload_digest, "kind": kind, "status": "queued", "attempt": 0, "created_at": now, "started_at": None, "deadline_at": deadline,
           "retry_at": None, "lease_until": None, "fence": None, "epoch": case["epoch"], "work_epoch": case.get("work_epoch", case["epoch"]), "input_revision": case["revision"], "last_sequence": 0,
           "failure": None, "payload_ciphertext": enc_json(payload), "checkpoint_ciphertext": None, "expires_at": utc(case["expires_at"])}
    await db.investigation_jobs.insert_one(dict(doc))
    return doc


async def get_job(owner: str, case_id: str, job_id: str) -> dict:
    doc = await db.investigation_jobs.find_one({"owner_id": owner, "case_id": case_id, "job_id": job_id}, {"_id": 0})
    if not doc:
        raise http(404, "not_found", "Unknown job for this investigation.")
    return doc


def job_view(doc: dict) -> Job:
    return Job(id=doc["job_id"], case_id=doc["case_id"], turn_id=doc["turn_id"], status=doc["status"], started_at=utc(doc["started_at"]) if doc.get("started_at") else None,
               deadline_at=utc(doc["deadline_at"]), retry_at=utc(doc["retry_at"]) if doc.get("retry_at") else None, attempt=doc["attempt"],
               last_event_sequence=doc.get("last_sequence", 0), failure=Failure.model_validate(doc["failure"]) if doc.get("failure") else None)


async def acquire_lease(owner: str, job_id: str) -> Optional[dict]:
    """Take the job if queued/retry_wait or its lease expired. Returns the fenced job or None."""
    now = now_utc()
    fence = uuid.uuid4().hex
    return await db.investigation_jobs.find_one_and_update(
        {"owner_id": owner, "job_id": job_id, "status": {"$in": ["queued", "investigating", "retry_wait", "waiting_device"]},
         "$or": [{"lease_until": None}, {"lease_until": {"$lte": now}}], "deadline_at": {"$gt": now}},
        {"$set": {"status": "investigating", "lease_until": now + timedelta(seconds=30), "fence": fence, "started_at": now}, "$inc": {"attempt": 1}},
        projection={"_id": 0}, return_document=ReturnDocument.AFTER)


async def heartbeat(owner: str, job_id: str, fence: str) -> bool:
    result = await db.investigation_jobs.update_one({"owner_id": owner, "job_id": job_id, "fence": fence, "status": {"$in": ["investigating", "retry_wait"]}},
                                                    {"$set": {"lease_until": now_utc() + timedelta(seconds=30)}})
    return result.matched_count == 1


async def set_job(owner: str, job_id: str, fence: Optional[str], update: dict) -> bool:
    query = {"owner_id": owner, "job_id": job_id}
    if fence:
        query["fence"] = fence
    result = await db.investigation_jobs.update_one(query, update)
    return result.matched_count == 1


async def emit(owner: str, case_id: str, job_id: str, kind: str, payload: dict, revision: int, expires_at: datetime) -> int:
    job = await db.investigation_jobs.find_one_and_update({"owner_id": owner, "job_id": job_id}, {"$inc": {"last_sequence": 1}},
                                                          projection={"last_sequence": 1}, return_document=ReturnDocument.AFTER)
    if not job:  # job removed by cleanup: nothing may be published for it
        return 0
    sequence = job["last_sequence"]
    epoch = await live_epoch(owner, case_id)
    if not epoch:  # case ended between sequence allocation and insert: publish nothing
        return 0
    await db.investigation_events.insert_one({"owner_id": owner, "case_id": case_id, "job_id": job_id, "sequence": sequence, "type": kind, "revision": revision,
                                              "epoch": epoch, "at": now_utc(), "payload_ciphertext": enc_json(payload), "expires_at": expires_at})
    if await live_epoch(owner, case_id) != epoch:  # late write after cleanup: remove it (sweep_tombstones is the backstop)
        await db.investigation_events.delete_many({"owner_id": owner, "job_id": job_id, "sequence": sequence})
        return 0
    return sequence


async def events_after(owner: str, job_id: str, after: int) -> list[dict]:
    rows = await db.investigation_events.find({"owner_id": owner, "job_id": job_id, "sequence": {"$gt": after}}, {"_id": 0}).sort("sequence", 1).to_list(None)
    return [{"sequence": r["sequence"], "jobId": r["job_id"], "caseId": r["case_id"], "revision": r["revision"], "at": utc(r["at"]).isoformat(),
             "type": r["type"], "payload": dec_json(r["payload_ciphertext"])} for r in rows]


# ------------------------------------------------------------------ authoritative turn commit (R01)
async def stage_turn(owner: str, commit: TurnCommit, job: dict, expires_at: datetime) -> str:
    """Immutable bundle per attempt: commit_id + payload digest. Never overwritten; visibility comes only from the case reference."""
    commit_id = uuid.uuid4().hex
    body = commit.wire()
    await db.investigation_turn_commits.insert_one({"owner_id": owner, "case_id": commit.case_id, "turn_id": commit.turn_id, "commit_id": commit_id,
                                                    "digest": digest(json.dumps(body, sort_keys=True, default=str)), "job_id": job["job_id"], "fence": job["fence"],
                                                    "epoch": job["epoch"], "commit_ciphertext": enc_json(body), "committed_at": commit.committed_at, "expires_at": expires_at})
    return commit_id


async def accept_turn(owner: str, case: dict, job: dict, commit: TurnCommit, commit_id: str, status: str, attention: str, open_question: Optional[dict]) -> Optional[dict]:
    """Single CAS on the case control record makes answer + history authoritative together (spec §5)."""
    if any(ref["turn_id"] == commit.turn_id for ref in case.get("accepted_commits", [])):
        await db.investigation_turn_commits.delete_one({"owner_id": owner, "case_id": case["case_id"], "commit_id": commit_id})
        return None  # logical turn already accepted by another attempt; this attempt removes only its own bundle
    updated = await cas(owner, case["case_id"], {"epoch": job["epoch"], "work_epoch": job.get("work_epoch", job["epoch"]), "active_job_id": job["job_id"], "lease_fence": job["fence"],
                                                 "accepted_commits.turn_id": {"$ne": commit.turn_id}},
                        {"$set": {"response_ciphertext": enc_json(commit.response.wire()), "response_revision": commit.committed_revision, "status": status,
                                  "active_job_id": None, "active_turn_id": None, "lease_fence": None, "attention": attention,
                                  "open_question_ciphertext": enc_json(open_question) if open_question else None},
                         "$push": {"accepted_commits": {"turn_id": commit.turn_id, "commit_id": commit_id, "job_id": job["job_id"], "revision": commit.committed_revision}}})
    if not updated:  # losing attempt removes only its own unaccepted bundle
        await db.investigation_turn_commits.delete_one({"owner_id": owner, "case_id": case["case_id"], "commit_id": commit_id})
    return updated


async def accepted_commit_for(owner: str, case: dict, turn_id: str) -> Optional[dict]:
    ref = next((r for r in case.get("accepted_commits", []) if r["turn_id"] == turn_id), None)
    if not ref:
        return None
    return await db.investigation_turn_commits.find_one({"owner_id": owner, "case_id": case["case_id"], "commit_id": ref["commit_id"]}, {"_id": 0})


async def accepted_turns(owner: str, case: dict) -> list[TurnCommit]:
    ids = [r["commit_id"] for r in case.get("accepted_commits", [])]
    rows = await db.investigation_turn_commits.find({"owner_id": owner, "case_id": case["case_id"], "commit_id": {"$in": ids}, "expires_at": {"$gt": now_utc()}}, {"_id": 0}).to_list(None)
    by_id = {r["commit_id"]: r for r in rows}
    return [TurnCommit.model_validate(dec_json(by_id[i]["commit_ciphertext"])) for i in ids if i in by_id]


# ------------------------------------------------------------------ lifecycle: cancel / delete / expire / cleanup
async def revoke(owner: str, case_id: str, status: str) -> Optional[dict]:
    """Deletion/expiry ONLY: change the content lifecycle epoch (all content rows become tombstones) and schedule cleanup.
    Cancelling a turn never calls this; cancellation rotates `work_epoch` (worker fence) and leaves submitted evidence intact."""
    doc = await db.investigation_cases.find_one_and_update({"owner_id": owner, "case_id": case_id},
        {"$set": {"status": status, "epoch": uuid.uuid4().hex, "active_job_id": None, "lease_fence": None, "cleanup_status": "pending",
                  "deleted": status == "expired" or status == "deleted", "updated_at": now_utc()},
         "$unset": {"response_ciphertext": "", "sources_ciphertext": "", "device_profile_ciphertext": "", "open_question_ciphertext": ""}, "$inc": {"revision": 1}},
        projection={"_id": 0}, return_document=ReturnDocument.AFTER)
    if doc:
        await db.investigation_jobs.update_many({"owner_id": owner, "case_id": case_id, "status": {"$in": ["queued", "investigating", "retry_wait", "waiting_device", "waiting_user"]}},
                                                {"$set": {"status": "cancelled", "lease_until": None}})
        await db.investigation_cleanup.update_one({"owner_id": owner, "case_id": case_id, "target_type": "case", "target_id": case_id},
                                                  {"$set": {"next_attempt_at": now_utc(), "attempts": 0, "state": "pending"}}, upsert=True)
    return doc


async def run_cleanup(owner: str, case_id: str) -> str:
    try:
        for name in CONTENT:
            field = "device_id" if name == "voice_cache" else "owner_id"
            scope = {"scope_id": case_id} if name == "voice_cache" else {"case_id": case_id}
            await db[name].delete_many({field: owner, **scope})
        await db.investigation_cases.update_one({"owner_id": owner, "case_id": case_id}, {"$set": {"cleanup_status": "complete", "accepted_commits": [], "pending_device_request_ids": []}})
        await db.investigation_cleanup.update_one({"owner_id": owner, "case_id": case_id, "target_type": "case", "target_id": case_id}, {"$set": {"state": "complete"}})
        return "complete"
    except Exception:  # noqa: BLE001 — retried by the sweeper; never logs content
        await db.investigation_cleanup.update_one({"owner_id": owner, "case_id": case_id, "target_type": "case", "target_id": case_id},
                                                  {"$set": {"next_attempt_at": now_utc() + timedelta(seconds=60), "state": "pending"}, "$inc": {"attempts": 1}})
        await db.investigation_cases.update_one({"owner_id": owner, "case_id": case_id}, {"$set": {"cleanup_status": "failed"}})
        return "failed"


async def expire_case(owner: str, case_id: str) -> None:
    if await revoke(owner, case_id, "expired"):
        await run_cleanup(owner, case_id)


async def sweep() -> None:
    now = now_utc()
    async for doc in db.investigation_cases.find({"expires_at": {"$lte": now}, "cleanup_status": {"$in": ["not_due"]}}, {"_id": 0, "owner_id": 1, "case_id": 1}):
        await expire_case(doc["owner_id"], doc["case_id"])
    async for task in db.investigation_cleanup.find({"state": "pending", "next_attempt_at": {"$lte": now}}, {"_id": 0}):
        await run_cleanup(task["owner_id"], task["case_id"])
    # Unreferenced bundles older than a work slice are reclaimed; every referenced bundle is excluded.
    async for stale in db.investigation_turn_commits.find({"committed_at": {"$lte": now - timedelta(seconds=WORK_SECONDS)}}, {"_id": 0, "owner_id": 1, "case_id": 1, "commit_id": 1}):
        case = await db.investigation_cases.find_one({"owner_id": stale["owner_id"], "case_id": stale["case_id"], "accepted_commits.commit_id": stale["commit_id"]}, {"_id": 1})
        if not case:
            await db.investigation_turn_commits.delete_one({"owner_id": stale["owner_id"], "case_id": stale["case_id"], "commit_id": stale["commit_id"]})
    # Revisit completed cleanups: any late writer content for deleted/expired cases is removed again.
    async for gone in db.investigation_cases.find({"deleted": True, "cleanup_status": "complete", "updated_at": {"$gte": now - timedelta(hours=1)}}, {"_id": 0, "owner_id": 1, "case_id": 1}):
        for name in CONTENT:
            field = "device_id" if name == "voice_cache" else "owner_id"
            scope = {"scope_id": gone["case_id"]} if name == "voice_cache" else {"case_id": gone["case_id"]}
            await db[name].delete_many({field: gone["owner_id"], **scope})
