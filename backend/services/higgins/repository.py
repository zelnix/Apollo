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
from pymongo.errors import DuplicateKeyError

from core.db import db, now_utc
from services.higgins.capacity import LIFETIME_SECONDS, WORK_SECONDS
from services.higgins.contracts import (Coverage, EvidenceItem, Failure, HigginsResponse, Inventory, InvestigationCase, Job,
                                        SourceReference, TurnCommit, failure_body)
from services.higgins.encryption import decrypt, encrypt

CHUNK_BYTES = 1024 * 1024
CONTENT = ("investigation_evidence", "investigation_content_chunks", "investigation_events", "investigation_turn_commits",
           "investigation_jobs", "investigation_device_requests", "investigation_settings_plans", "voice_cache")


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


async def ensure_indexes() -> None:
    await db.investigation_cases.create_index([("owner_id", 1), ("case_id", 1)], unique=True)
    await db.investigation_cases.create_index("expires_at")
    await db.investigation_cases.create_index([("cleanup_status", 1), ("expires_at", 1)])
    await db.investigation_idempotency.create_index([("owner_id", 1), ("operation", 1), ("key_digest", 1)], unique=True)
    await db.investigation_idempotency.create_index("expires_at", expireAfterSeconds=0)
    await db.investigation_evidence.create_index([("owner_id", 1), ("case_id", 1), ("evidence_id", 1)], unique=True)
    await db.investigation_evidence.create_index([("owner_id", 1), ("case_id", 1), ("client_item_id", 1)], unique=True)
    await db.investigation_evidence.create_index("expires_at", expireAfterSeconds=3600)
    await db.investigation_content_chunks.create_index([("owner_id", 1), ("case_id", 1), ("evidence_id", 1), ("chunk_index", 1)], unique=True)
    await db.investigation_content_chunks.create_index("expires_at", expireAfterSeconds=3600)
    await db.investigation_jobs.create_index([("owner_id", 1), ("case_id", 1), ("idempotency_key_digest", 1)], unique=True)
    await db.investigation_jobs.create_index([("owner_id", 1), ("job_id", 1)], unique=True)
    await db.investigation_jobs.create_index([("status", 1), ("lease_until", 1)])
    await db.investigation_jobs.create_index("expires_at", expireAfterSeconds=3600)
    await db.investigation_turn_commits.create_index([("owner_id", 1), ("case_id", 1), ("turn_id", 1)], unique=True)
    await db.investigation_turn_commits.create_index("expires_at", expireAfterSeconds=3600)
    await db.investigation_events.create_index([("owner_id", 1), ("job_id", 1), ("sequence", 1)], unique=True)
    await db.investigation_events.create_index("expires_at", expireAfterSeconds=3600)
    await db.investigation_cleanup.create_index([("owner_id", 1), ("case_id", 1), ("target_type", 1), ("target_id", 1)], unique=True)
    await db.investigation_cleanup.create_index("next_attempt_at")
    await db.investigation_device_requests.create_index([("owner_id", 1), ("case_id", 1), ("request_id", 1)], unique=True)
    await db.investigation_settings_plans.create_index([("owner_id", 1), ("case_id", 1), ("plan_id", 1)], unique=True)
    await db.investigation_uploads.create_index([("owner_id", 1), ("case_id", 1), ("upload_id", 1)], unique=True)
    await db.investigation_uploads.create_index("expires_at", expireAfterSeconds=0)
    await db.investigation_reports.create_index([("owner_id", 1), ("report_id", 1)], unique=True)


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


# ------------------------------------------------------------------ cases
async def create_case(owner: str, gate: Optional[str], device_profile: Optional[dict]) -> dict:
    now = now_utc()
    doc = {"owner_id": owner, "case_id": str(uuid.uuid4()), "revision": 0, "epoch": uuid.uuid4().hex, "gates": [gate] if gate else [], "status": "queued",
           "created_at": now, "updated_at": now, "expires_at": now + timedelta(seconds=LIFETIME_SECONDS), "active_job_id": None,
           "active_turn_id": None, "lease_fence": None, "response_ciphertext": None, "response_revision": None,
           "sources_ciphertext": enc_json([]), "device_profile_ciphertext": enc_json(device_profile) if device_profile else None,
           "pending_device_request_ids": [], "accepted_turn_ids": [], "open_question_ciphertext": None,
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


async def add_sources(owner: str, case_id: str, new: list[SourceReference]) -> None:
    current = await sources(owner, case_id)
    known = {s["url"] for s in current}
    current.extend(s.wire() for s in new if s.url not in known)
    await db.investigation_cases.update_one({"owner_id": owner, "case_id": case_id, "deleted": False}, {"$set": {"sources_ciphertext": enc_json(current)}})


# ------------------------------------------------------------------ evidence + chunks
async def insert_evidence(owner: str, item: EvidenceItem, meta: dict) -> None:
    doc = {"owner_id": owner, "case_id": item.case_id, "evidence_id": item.id, "client_item_id": item.client_item_id, "origin": item.origin,
           "kind": item.kind, "parent_id": item.parent_id, "related_evidence_ids": item.related_evidence_ids, "collected_at": item.collected_at,
           "observed_at": item.observed_at, "expires_at": item.expires_at, "availability": item.availability, "media_type": item.media_type,
           "byte_length": item.byte_length, "coverage": item.coverage.wire(), "simulation": item.simulation.wire() if item.simulation else None,
           "transformations": [t.wire() for t in item.transformations], "label": item.label, "meta_ciphertext": enc_json(meta)}
    try:
        await db.investigation_evidence.insert_one(doc)
    except DuplicateKeyError as exc:
        raise http(409, "conflict", "That client item ID was already submitted to this investigation with different content.") from exc


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
    count = 0
    for index in range(0, max(len(data), 1), CHUNK_BYTES):
        chunk = data[index:index + CHUNK_BYTES]
        await db.investigation_content_chunks.update_one(
            {"owner_id": owner, "case_id": case_id, "evidence_id": evidence_id, "chunk_index": count},
            {"$set": {"ciphertext": encrypt(chunk), "length": len(chunk), "expires_at": expires_at}}, upsert=True)
        count += 1
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
           "retry_at": None, "lease_until": None, "fence": None, "epoch": case["epoch"], "input_revision": case["revision"], "last_sequence": 0,
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
    result = await db.investigation_jobs.update_one({"owner_id": owner, "job_id": job_id, "fence": fence, "status": "investigating"},
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
    sequence = job["last_sequence"] if job else 1
    await db.investigation_events.insert_one({"owner_id": owner, "case_id": case_id, "job_id": job_id, "sequence": sequence, "type": kind, "revision": revision,
                                              "at": now_utc(), "payload_ciphertext": enc_json(payload), "expires_at": expires_at})
    return sequence


async def events_after(owner: str, job_id: str, after: int) -> list[dict]:
    rows = await db.investigation_events.find({"owner_id": owner, "job_id": job_id, "sequence": {"$gt": after}}, {"_id": 0}).sort("sequence", 1).to_list(None)
    return [{"sequence": r["sequence"], "jobId": r["job_id"], "caseId": r["case_id"], "revision": r["revision"], "at": utc(r["at"]).isoformat(),
             "type": r["type"], "payload": dec_json(r["payload_ciphertext"])} for r in rows]


# ------------------------------------------------------------------ authoritative turn commit
async def stage_turn(owner: str, commit: TurnCommit, expires_at: datetime) -> None:
    await db.investigation_turn_commits.update_one({"owner_id": owner, "case_id": commit.case_id, "turn_id": commit.turn_id},
                                                    {"$set": {"commit_ciphertext": enc_json(commit.wire()), "staged": True, "expires_at": expires_at, "committed_at": commit.committed_at}}, upsert=True)


async def accept_turn(owner: str, case: dict, job: dict, commit: TurnCommit, status: str, attention: str, open_question: Optional[dict]) -> Optional[dict]:
    """Single CAS on the case control record makes answer + history authoritative together (spec §5)."""
    updated = await cas(owner, case["case_id"], {"epoch": job["epoch"], "active_job_id": job["job_id"], "lease_fence": job["fence"]},
                        {"$set": {"response_ciphertext": enc_json(commit.response.wire()), "response_revision": commit.committed_revision, "status": status,
                                  "active_job_id": None, "active_turn_id": None, "lease_fence": None, "attention": attention,
                                  "open_question_ciphertext": enc_json(open_question) if open_question else None},
                         "$addToSet": {"accepted_turn_ids": commit.turn_id}})
    if updated:
        await db.investigation_turn_commits.update_one({"owner_id": owner, "case_id": case["case_id"], "turn_id": commit.turn_id}, {"$set": {"staged": False}})
    else:
        await db.investigation_turn_commits.delete_one({"owner_id": owner, "case_id": case["case_id"], "turn_id": commit.turn_id, "staged": True})
    return updated


async def accepted_turns(owner: str, case: dict) -> list[TurnCommit]:
    rows = await db.investigation_turn_commits.find({"owner_id": owner, "case_id": case["case_id"], "staged": False, "turn_id": {"$in": case.get("accepted_turn_ids", [])},
                                                     "expires_at": {"$gt": now_utc()}}, {"_id": 0}).sort("committed_at", 1).to_list(None)
    return [TurnCommit.model_validate(dec_json(r["commit_ciphertext"])) for r in rows]


# ------------------------------------------------------------------ lifecycle: cancel / delete / expire / cleanup
async def revoke(owner: str, case_id: str, status: str) -> Optional[dict]:
    """Change the lifecycle epoch so no in-flight worker can commit; then schedule cleanup."""
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
        await db.investigation_uploads.delete_many({"owner_id": owner, "case_id": case_id})
        await db.investigation_cases.update_one({"owner_id": owner, "case_id": case_id}, {"$set": {"cleanup_status": "complete", "accepted_turn_ids": [], "pending_device_request_ids": []}})
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
    # Staged bundles never accepted within a work slice are reclaimed.
    await db.investigation_turn_commits.delete_many({"staged": True, "committed_at": {"$lte": now - timedelta(seconds=WORK_SECONDS)}})
