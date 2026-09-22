"""Authenticated case API (spec §8). Owner identity comes from the bearer device; IDs never authorise another owner's data."""
from __future__ import annotations

import asyncio
import contextlib
import hashlib
import json
import re
import uuid
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, File, Form, Header, Request, Response, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import TypeAdapter, ValidationError
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from core.config import HIBP_API_KEY, IPQS_API_KEY, SAFE_BROWSING_API_KEY
from core.db import db, now_utc
from core.redaction import redact_investigation_secrets
from services.email import email_configured
from services.storage import storage_configured
from routers.push import push_configured
from services.higgins import evidence as ev
from services.higgins import jobs
from services.higgins import provider
from services.higgins import repository as repo
from services.higgins import tools as toolbox
from services.higgins.capacity import SPEECH_SEGMENT_CHARACTERS, policy
from services.higgins.contracts import (CreateCase, CreateUpload, DeviceProfile, DeviceResult, EvidenceSubmission, ExpectedObservation, ExpectedRevision,
                                        RecheckRequest, RecheckResult, ReportRequest, SettingsPlan, SettingsPlanRequest, SpeechRequest, SubmitTurn, UploadMetadata)
from services.higgins.encryption import cipher, decrypt, encrypt
from services.higgins.repository import http

router = APIRouter()
NO_STORE = {"Cache-Control": "private, no-store", "Pragma": "no-cache"}
ACTIVE = ("queued", "investigating", "retry_wait", "waiting_device")


def owner_of(request: Request) -> str:
    return request.state.device["device_id"]


def _key(idempotency_key: Optional[str]) -> str:
    if not idempotency_key or not re.match(r"^[A-Za-z0-9._:-]{8,80}$", idempotency_key):
        raise http(400, "invalid_input", "An Idempotency-Key header (8–80 URL-safe characters) is required for this operation.")
    return idempotency_key


def _revision_check(case: dict, expected: int) -> None:
    if case["revision"] != expected:
        raise http(409, "conflict", f"The investigation changed (revision {case['revision']}). Reload it and resubmit with the current revision.")


async def _case_json(case: dict) -> dict:
    return {"case": (await repo.case_view(case)).wire()}


# ------------------------------------------------------------------ capabilities
@router.get("/ai/capabilities")
async def capabilities():
    config = provider.configuration()
    key = config["keyConfigured"]

    def modality(name: str, model: str, cap: str):
        supported = cap in provider.CAPABILITIES.get(model, set())
        status = "available" if key and supported else ("unconfigured" if not key else "unsupported")
        return {"name": name, "status": status, "model": model, "reason": None if status == "available" else ("GEMINI_API_KEY missing" if not key else f"model lacks {cap}")}
    integrations = [{"name": "safe_browsing", "status": "available" if SAFE_BROWSING_API_KEY else "unconfigured", "reason": None if SAFE_BROWSING_API_KEY else "SAFE_BROWSING_API_KEY"},
                    {"name": "phone_reputation", "status": "available" if IPQS_API_KEY else "unconfigured", "reason": None if IPQS_API_KEY else "IPQS_API_KEY"},
                    {"name": "breach_lookup", "status": "available" if HIBP_API_KEY else "unconfigured", "reason": None if HIBP_API_KEY else "HIBP_API_KEY"},
                    {"name": "guardian_email", "status": "available" if email_configured() else "unconfigured", "reason": None if email_configured() else "RESEND_API_KEY / RESEND_FROM_EMAIL"},
                    {"name": "push_delivery", "status": "available" if push_configured() else "unconfigured", "reason": None if push_configured() else "EXPO_PUSH_ENABLED / EXPO_PUSH_ACCESS_TOKEN"},
                    {"name": "family_voice_storage", "status": "available" if storage_configured() else "unconfigured", "reason": None if storage_configured() else "FAMILY_STORAGE_BUCKET / ACCESS_KEY_ID / SECRET_ACCESS_KEY"}]
    bounds = {**policy()["bounds"], "fileBytes": {"value": ev.MAX_FILE_BYTES, "unit": "bytes", "purpose": "per-file upload ceiling", "overflow": "413; item listed as not received"},
              "caseBytes": {"value": ev.MAX_CASE_BYTES, "unit": "bytes", "purpose": "aggregate active-case payload", "overflow": "413"},
              "documentPages": {"value": ev.MAX_PAGES, "unit": "pages", "purpose": "supported document budget", "overflow": "later pages recorded as omitted"},
              "lifetimeSeconds": {"value": policy()["lifetimeSeconds"], "unit": "seconds", "purpose": "temporary content ceiling; never extended", "overflow": "410"}}
    return JSONResponse({"schemaVersion": 1, "provider": "gemini", "modalities": [modality("text", provider.TEXT_MODEL, "text"), modality("vision", provider.VISION_MODEL, "vision"),
                         modality("transcription", provider.TRANSCRIPTION_MODEL, "audio_input"), modality("speech", provider.SPEECH_MODEL, "speech"),
                         modality("research", provider.TEXT_MODEL, "search")], "policyVersion": policy()["version"], "bounds": bounds, "integrations": integrations,
                         "models": config["models"], "researchCoordinator": "shared_case_engine"}, headers=NO_STORE)


# ------------------------------------------------------------------ cases
@router.post("/investigations", status_code=201)
async def create_case(body: CreateCase, request: Request, idempotency_key: Optional[str] = Header(default=None, alias="Idempotency-Key")):
    owner = owner_of(request)
    cipher()
    key = _key(idempotency_key)
    existing, payload_digest = await repo.idempotent(owner, "create", key, body.model_dump_json())
    if existing:
        case = await repo.get_case(owner, existing["result"]["caseId"])
        return JSONResponse(await _case_json(case), status_code=201, headers=NO_STORE)
    case = await repo.create_case(owner, body.gate, body.device_profile.wire() if body.device_profile else None)
    for item in body.submissions:
        if item.kind == "url":
            await ev.ingest_url(owner, case, item.client_item_id, item.value, label=item.label)
        else:
            await ev.ingest_text(owner, case, item.client_item_id, item.value, label=item.label or "submitted text")
    for index, finding in enumerate(body.initial_findings[:64]):
        await ev.ingest_text(owner, case, f"apollo-finding-{index}", finding, origin="apollo_inference", label="Apollo initial finding",
                             coverage=ev.Coverage(status="examined", unit="items", total=1, examined=1))
    question = redact_investigation_secrets(body.question)
    await repo.remember(owner, "create", key, payload_digest, {"caseId": case["case_id"]}, repo.utc(case["expires_at"]))
    # A non-blank opening question is the first turn; otherwise the client attaches evidence first.
    job = await _submit_turn(owner, case, SubmitTurn(expected_revision=0, turn_id=str(uuid.uuid4()), message=question), key + ":turn0") if question.strip() else None
    case = await repo.get_case(owner, case["case_id"])
    return JSONResponse({**await _case_json(case), "job": repo.job_view(job).wire() if job else None}, status_code=201, headers=NO_STORE)


@router.get("/investigations/{case_id}")
async def get_case(case_id: str, request: Request):
    case = await repo.get_case(owner_of(request), case_id)
    return JSONResponse(await _case_json(case), headers=NO_STORE)


@router.delete("/investigations/{case_id}")
async def delete_case(case_id: str, request: Request):
    owner = owner_of(request)
    if not await db.investigation_cases.find_one({"owner_id": owner, "case_id": case_id}, {"_id": 1}):
        raise http(404, "not_found", "No investigation with that reference belongs to this device.")
    await repo.revoke(owner, case_id, "deleted")
    status = await repo.run_cleanup(owner, case_id)
    return Response(status_code=204 if status == "complete" else 202, headers=NO_STORE)


# ------------------------------------------------------------------ evidence
@router.post("/investigations/{case_id}/evidence", status_code=201)
async def add_evidence(case_id: str, request: Request, file: Optional[UploadFile] = File(default=None), metadata: Optional[str] = Form(default=None)):
    owner = owner_of(request)
    case = await repo.get_case(owner, case_id, for_mutation=True)
    if file is not None:
        try:
            meta = UploadMetadata.model_validate_json(metadata or "")
        except ValidationError as exc:
            raise http(422, "invalid_input", "Multipart metadata did not match UploadMetadata.") from exc
        _revision_check(case, meta.expected_revision)
        data = await file.read(ev.MAX_FILE_BYTES + 1)
        if len(data) > ev.MAX_FILE_BYTES:
            raise http(413, "budget_exhausted", f"Files above {ev.MAX_FILE_BYTES // (1024 * 1024)} MiB are not accepted.")
        item = await ev.ingest_file(owner, case, meta.wire(), data)
    else:
        try:
            body = TypeAdapter(EvidenceSubmission).validate_python(await request.json())
        except (ValidationError, ValueError) as exc:
            raise http(422, "invalid_input", "Evidence submission did not match the schema.") from exc
        _revision_check(case, body.expected_revision)
        if body.kind == "text":
            item = await ev.ingest_text(owner, case, body.client_item_id, body.text, parent_id=body.parent_id, label=body.label)
        elif body.kind == "url":
            item = await ev.ingest_url(owner, case, body.client_item_id, body.url, parent_id=body.parent_id, label=body.label)
        else:
            item = await ev.ingest_observation(owner, case, body.client_item_id, body.device_result.wire(), parent_id=body.parent_id)
    updated = await repo.cas(owner, case_id, {"revision": case["revision"]}, {"$set": {}})
    return JSONResponse({"evidence": item.wire(), "caseRevision": (updated or case)["revision"]}, status_code=201, headers=NO_STORE)


@router.get("/investigations/{case_id}/evidence")
async def list_evidence(case_id: str, request: Request, cursor: Optional[str] = None):
    owner = owner_of(request)
    await repo.get_case(owner, case_id)
    rows = await repo.list_evidence(owner, case_id)
    start = int(cursor or 0)
    page = rows[start:start + 100]
    return JSONResponse({"items": [repo.evidence_view(r).wire() for r in page], "nextCursor": str(start + 100) if len(rows) > start + 100 else None, "total": len(rows)}, headers=NO_STORE)


@router.get("/investigations/{case_id}/sources")
async def list_sources(case_id: str, request: Request, cursor: Optional[str] = None):
    owner = owner_of(request)
    await repo.get_case(owner, case_id)
    rows = await repo.sources(owner, case_id)
    start = int(cursor or 0)
    return JSONResponse({"items": rows[start:start + 100], "nextCursor": str(start + 100) if len(rows) > start + 100 else None, "total": len(rows)}, headers=NO_STORE)


# ------------------------------------------------------------------ resumable uploads
@router.post("/investigations/{case_id}/uploads", status_code=201)
async def create_upload(case_id: str, body: CreateUpload, request: Request):
    owner = owner_of(request)
    case = await repo.get_case(owner, case_id, for_mutation=True)
    if body.declared_bytes > ev.MAX_FILE_BYTES:
        raise http(413, "budget_exhausted", f"Files above {ev.MAX_FILE_BYTES // (1024 * 1024)} MiB are not accepted.")
    immutable = body.wire(); immutable.pop("expectedRevision", None)
    request_digest = repo.digest(json.dumps(immutable, sort_keys=True))
    existing = await db.investigation_uploads.find_one(
        {"owner_id": owner, "case_id": case_id, "metadata.clientItemId": body.client_item_id}, {"_id": 0}
    )
    if existing:
        if existing.get("request_digest") != request_digest:
            raise http(409, "conflict", "This file identity was already reserved for different immutable input.")
        return JSONResponse({"uploadId": existing["upload_id"], "chunkBytes": repo.CHUNK_BYTES,
                             "expiresAt": repo.utc(existing["expires_at"]).isoformat(),
                             "evidenceRootId": existing["evidence_root_id"], "replayed": True}, status_code=201, headers=NO_STORE)
    _revision_check(case, body.expected_revision)
    upload_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"apollo-upload:{owner}:{case_id}:{body.client_item_id}"))
    evidence_root_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"apollo-evidence:{owner}:{case_id}:{body.client_item_id}"))
    expires = repo.utc(case["expires_at"])
    document = {"owner_id": owner, "case_id": case_id, "upload_id": upload_id, "evidence_root_id": evidence_root_id,
                "request_digest": request_digest, "metadata": body.wire(), "chunks": {}, "finalisation": None,
                "created_at": now_utc(), "expires_at": expires}
    try:
        await db.investigation_uploads.insert_one(document)
        replayed = False
    except DuplicateKeyError:
        existing = await db.investigation_uploads.find_one(
            {"owner_id": owner, "case_id": case_id, "metadata.clientItemId": body.client_item_id}, {"_id": 0}
        )
        if not existing or existing.get("request_digest") != request_digest:
            raise http(409, "conflict", "This file identity was concurrently reserved for different input.")
        upload_id, evidence_root_id, expires, replayed = existing["upload_id"], existing["evidence_root_id"], repo.utc(existing["expires_at"]), True
    return JSONResponse({"uploadId": upload_id, "chunkBytes": repo.CHUNK_BYTES, "expiresAt": expires.isoformat(),
                         "evidenceRootId": evidence_root_id, "replayed": replayed}, status_code=201, headers=NO_STORE)


@router.put("/investigations/{case_id}/uploads/{upload_id}/chunks/{index}", status_code=204)
async def put_chunk(case_id: str, upload_id: str, index: int, request: Request):
    owner = owner_of(request)
    await repo.get_case(owner, case_id, for_mutation=True)
    upload = await db.investigation_uploads.find_one({"owner_id": owner, "case_id": case_id, "upload_id": upload_id, "expires_at": {"$gt": now_utc()}}, {"_id": 0})
    if not upload:
        raise http(404, "not_found", "Unknown or expired upload.")
    if index < 0 or index * repo.CHUNK_BYTES >= upload["metadata"]["declaredBytes"]:
        raise http(413, "budget_exhausted", "Chunk index is outside the declared size.")
    data, received = bytearray(), 0
    async for piece in request.stream():  # stream-limited: never buffer more than one chunk
        received += len(piece)
        if received > repo.CHUNK_BYTES:
            raise http(413, "budget_exhausted", "Chunk exceeds the chunk budget.")
        data.extend(piece)
    chunk_digest = repo.digest(bytes(data).hex())
    try:
        await db.investigation_upload_chunks.insert_one({"owner_id": owner, "case_id": case_id, "upload_id": upload_id, "chunk_index": index, "digest": chunk_digest,
                                                          "ciphertext": encrypt(bytes(data)), "length": len(data), "expires_at": upload["expires_at"]})
    except DuplicateKeyError:
        existing = await db.investigation_upload_chunks.find_one({"owner_id": owner, "upload_id": upload_id, "chunk_index": index}, {"_id": 0, "digest": 1})
        if existing and existing["digest"] != chunk_digest:
            raise http(409, "conflict", "A different chunk was already stored at that index.")
    return Response(status_code=204, headers=NO_STORE)


LEASE_RENEWAL_SECONDS = 40


class LeaseLost(Exception):
    """Raised when a renewable-ownership fence stops matching mid-operation (another attempt took over, or the
    claim was otherwise superseded) — the wrapped work is cancelled promptly rather than left running unsupervised."""


async def _with_lease_renewal(collection, selector: dict, fence_field: str, fence: str, ts_field: str, coro):
    """Keeps a renewable-ownership fence alive for a potentially long-running step, AND stops that step promptly if
    ownership is lost. A heartbeat that only refreshes a timestamp while unrelated work keeps running underneath it
    is not a guard — this races the heartbeat's own write against the work and cancels the work the moment a
    renewal fails to match. The eventual authoritative write at the call site remains separately fenced regardless;
    this only bounds how long a superseded attempt can keep doing work it no longer owns."""
    lost = asyncio.Event()

    async def _heartbeat():
        while True:
            await asyncio.sleep(LEASE_RENEWAL_SECONDS)
            result = await collection.update_one({**selector, fence_field: fence}, {"$set": {ts_field: now_utc()}})
            if result.matched_count == 0:
                lost.set()
                return

    work = asyncio.ensure_future(coro)
    beat = asyncio.ensure_future(_heartbeat())
    try:
        done, _pending = await asyncio.wait({work, beat}, return_when=asyncio.FIRST_COMPLETED)
        if beat in done and work not in done:
            work.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await work
            raise LeaseLost(f"lost ownership of {selector} mid-operation")
        return await work
    finally:
        beat.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await beat


@router.post("/investigations/{case_id}/uploads/{upload_id}/complete", status_code=201)
async def complete_upload(case_id: str, upload_id: str, body: ExpectedRevision, request: Request):
    owner = owner_of(request)
    case = await repo.get_case(owner, case_id, for_mutation=True)
    upload = await db.investigation_uploads.find_one({"owner_id": owner, "case_id": case_id, "upload_id": upload_id}, {"_id": 0})
    if not upload:
        raise http(404, "not_found", "Unknown or expired upload.")
    if upload.get("evidence_id"):  # finalisation replay after a durable commit resolves to the same evidence
        row = await repo.get_evidence(owner, case_id, upload["evidence_id"])
        return JSONResponse({"evidence": repo.evidence_view(row).wire(), "caseRevision": case["revision"], "replayed": True}, status_code=201, headers=NO_STORE)
    _revision_check(case, body.expected_revision)
    declared = upload["metadata"]["declaredBytes"]
    expected_chunks = (declared + repo.CHUNK_BYTES - 1) // repo.CHUNK_BYTES
    rows = await db.investigation_upload_chunks.find({"owner_id": owner, "upload_id": upload_id}, {"_id": 0}).sort("chunk_index", 1).to_list(None)
    if [r["chunk_index"] for r in rows] != list(range(expected_chunks)):
        raise http(409, "conflict", "The upload has missing chunks; a file with gaps cannot be accepted as complete. Uploaded chunks are kept for resumption.")
    data = b"".join(decrypt(r["ciphertext"]) for r in rows)
    if len(data) != declared:
        raise http(409, "conflict", "Received bytes do not match the declared length. Uploaded chunks are kept for correction.")
    meta = {k: v for k, v in upload["metadata"].items() if k != "declaredBytes"}
    content_digest = hashlib.sha256(data).hexdigest()
    fin = upload.get("finalisation")  # exclusive, renewable-ownership state: {"state": "ingesting"|"committed", "digest", "started_at", "fence", "evidence_id"}
    if fin and fin["digest"] != content_digest:
        raise http(409, "conflict", "The chunks differ from the ones that were being finalised; a changed file cannot complete the same upload.")
    if not fin:
        fence = str(uuid.uuid4())
        claimed = await db.investigation_uploads.find_one_and_update({"owner_id": owner, "upload_id": upload_id, "finalisation": None},
                                                                     {"$set": {"finalisation": {"state": "ingesting", "digest": content_digest, "started_at": now_utc(), "fence": fence, "evidence_id": None}}})
        if claimed is None:  # a concurrent finaliser holds the claim; it (or a later retry) completes ingestion
            raise http(409, "conflict", "This upload is being finalised by another request; retry to obtain the result.")
    elif fin["state"] == "ingesting" and (now_utc() - repo.utc(fin["started_at"])).total_seconds() < 120:
        raise http(409, "conflict", "This upload is being finalised; retry shortly.")  # exclusivity window; after it the attempt is presumed dead and redone
    else:
        # Renewable-ownership takeover of a stale claim: the CAS matches the EXACT prior fence/started_at, so only one
        # concurrent retry wins a fresh fence. The superseded attempt's own commit below is always gated on ITS OWN
        # (now stale) fence and can never land after this — it discards its work instead of racing to finish.
        fence = str(uuid.uuid4())
        taken = await db.investigation_uploads.find_one_and_update(
            {"owner_id": owner, "upload_id": upload_id, "finalisation.state": "ingesting", "finalisation.fence": fin.get("fence"), "finalisation.started_at": fin["started_at"]},
            {"$set": {"finalisation.fence": fence, "finalisation.started_at": now_utc()}})
        if taken is None:
            current = await db.investigation_uploads.find_one({"owner_id": owner, "upload_id": upload_id}, {"_id": 0})
            if current and current.get("evidence_id"):
                row = await repo.get_evidence(owner, case_id, current["evidence_id"])
                return JSONResponse({"evidence": repo.evidence_view(row).wire(), "caseRevision": case["revision"], "replayed": True}, status_code=201, headers=NO_STORE)
            raise http(409, "conflict", "This upload is being finalised by another attempt; retry shortly.")
    # One immutable client item owns one deterministic evidence root. A committed root is authoritative even if the
    # upload projection was interrupted before it recorded evidence_id.
    root_id = upload.get("evidence_root_id") or str(uuid.uuid5(uuid.NAMESPACE_URL, f"apollo-evidence:{owner}:{case_id}:{meta['clientItemId']}"))
    partial = await db.investigation_evidence.find_one(
        {"owner_id": owner, "case_id": case_id, "evidence_id": root_id},
        {"_id": 0, "evidence_id": 1, "publication_state": 1, "ingestion_attempt_id": 1, "publication_owner": 1, "meta_ciphertext": 1},
    )
    if partial:
        if partial.get("publication_state") == "committed":
            published_meta = repo.dec_json(partial["meta_ciphertext"])
            if published_meta.get("contentDigest") != content_digest:
                raise http(409, "conflict", "A different file was already published under this immutable item identity.")
            committed = await db.investigation_uploads.find_one_and_update(
                {"owner_id": owner, "upload_id": upload_id, "finalisation.fence": fence},
                {"$set": {"finalisation.state": "committed", "finalisation.evidence_id": root_id, "evidence_id": root_id}})
            if committed is not None:
                await db.investigation_upload_chunks.delete_many({"owner_id": owner, "upload_id": upload_id})
            row = await repo.get_evidence(owner, case_id, root_id)
            return JSONResponse({"evidence": repo.evidence_view(row).wire(), "caseRevision": case["revision"], "replayed": True}, status_code=201, headers=NO_STORE)
        # A stale staging root is abandoned only by matching its exact attempt/owner. If it wins publication first,
        # abandonment matches nothing and the now-committed root is replayed on the next request—never deleted.
        abandoned = await repo.discard_incomplete_ingestion(
            owner, case_id, root_id, attempt_id=partial.get("ingestion_attempt_id"), publication_owner=partial.get("publication_owner")
        )
        if not abandoned:
            winner = await db.investigation_evidence.find_one(
                {"owner_id": owner, "case_id": case_id, "evidence_id": root_id}, {"_id": 0, "publication_state": 1, "meta_ciphertext": 1}
            )
            if winner and winner.get("publication_state") == "committed" and repo.dec_json(winner["meta_ciphertext"]).get("contentDigest") == content_digest:
                bound = await db.investigation_uploads.find_one_and_update(
                    {"owner_id": owner, "upload_id": upload_id, "finalisation.fence": fence},
                    {"$set": {"finalisation.state": "committed", "finalisation.evidence_id": root_id, "evidence_id": root_id}},
                )
                if bound is not None:
                    await db.investigation_upload_chunks.delete_many({"owner_id": owner, "upload_id": upload_id})
                row = await repo.get_evidence(owner, case_id, root_id)
                return JSONResponse({"evidence": repo.evidence_view(row).wire(), "caseRevision": case["revision"], "replayed": True}, status_code=201, headers=NO_STORE)
            raise http(409, "conflict", "The reserved evidence root is owned by another active ingestion attempt.")
    publication_owner = {"upload_id": upload_id, "fence": fence}
    try:
        item = await _with_lease_renewal(db.investigation_uploads, {"owner_id": owner, "upload_id": upload_id}, "finalisation.fence", fence, "finalisation.started_at",
                                         ev.ingest_file(owner, case, meta, data, evidence_root_id=root_id, ingestion_attempt_id=fence,
                                                        publication_owner=publication_owner, content_digest=content_digest))
    except LeaseLost:
        current = await db.investigation_uploads.find_one({"owner_id": owner, "upload_id": upload_id}, {"_id": 0})
        if current and current.get("evidence_id"):
            row = await repo.get_evidence(owner, case_id, current["evidence_id"])
            return JSONResponse({"evidence": repo.evidence_view(row).wire(), "caseRevision": case["revision"], "replayed": True}, status_code=201, headers=NO_STORE)
        raise http(409, "conflict", "This upload is being finalised by another attempt; retry to obtain the result.")
    # The root publication is authoritative. This upload projection is fenced, but a lost projection write must never
    # delete the already-published root; the next replay binds it by immutable digest.
    committed = await db.investigation_uploads.find_one_and_update(
        {"owner_id": owner, "upload_id": upload_id, "finalisation.fence": fence},
        {"$set": {"finalisation.state": "committed", "finalisation.evidence_id": item.id, "evidence_id": item.id}},
        return_document=ReturnDocument.AFTER)
    if committed is None:
        current = await db.investigation_uploads.find_one({"owner_id": owner, "upload_id": upload_id}, {"_id": 0})
        if current and current.get("evidence_id"):
            row = await repo.get_evidence(owner, case_id, current["evidence_id"])
            return JSONResponse({"evidence": repo.evidence_view(row).wire(), "caseRevision": case["revision"], "replayed": True}, status_code=201, headers=NO_STORE)
        row = await repo.get_evidence(owner, case_id, item.id)
        return JSONResponse({"evidence": repo.evidence_view(row).wire(), "caseRevision": case["revision"], "replayed": True}, status_code=201, headers=NO_STORE)
    # Upload state is released only after evidence is committed.
    await db.investigation_upload_chunks.delete_many({"owner_id": owner, "upload_id": upload_id})
    updated = await repo.cas(owner, case_id, {"revision": case["revision"]}, {"$set": {}})
    return JSONResponse({"evidence": item.wire(), "caseRevision": (updated or case)["revision"]}, status_code=201, headers=NO_STORE)


# ------------------------------------------------------------------ turns / jobs
async def _submit_turn(owner: str, case: dict, body: SubmitTurn, key: str) -> dict:
    payload = {"message": redact_investigation_secrets(body.message), "answerToQuestionId": body.answer_to_question_id, "evidenceIds": body.evidence_ids, "turnId": body.turn_id}
    key_digest, payload_digest = repo.digest(f"{owner}:turn:{key}"), repo.digest(json.dumps(payload, sort_keys=True))
    existing = await db.investigation_jobs.find_one({"owner_id": owner, "case_id": case["case_id"], "idempotency_key_digest": key_digest}, {"_id": 0})
    if existing:
        if existing["payload_digest"] != payload_digest:
            raise http(409, "conflict", "This Idempotency-Key was already used for a different question.")
        return existing
    if case.get("active_job_id"):
        raise http(409, "conflict", "Higgins is still working on this investigation. Wait for the current turn or cancel it.")
    for evidence_id in body.evidence_ids:
        await repo.get_evidence(owner, case["case_id"], evidence_id)
    job = await repo.create_job(owner, case, body.turn_id, key_digest, payload_digest, "turn", payload)
    updated = await repo.cas(owner, case["case_id"], {"revision": case["revision"], "active_job_id": None},
                             {"$set": {"status": "queued", "active_job_id": job["job_id"], "active_turn_id": body.turn_id}})
    if not updated:
        await db.investigation_jobs.delete_one({"owner_id": owner, "job_id": job["job_id"]})
        raise http(409, "conflict", "Another turn was submitted first. Reload the investigation.")
    jobs.launch(owner, case["case_id"], job["job_id"])
    return job


@router.post("/investigations/{case_id}/turns", status_code=202)
async def submit_turn(case_id: str, body: SubmitTurn, request: Request, idempotency_key: Optional[str] = Header(default=None, alias="Idempotency-Key")):
    owner = owner_of(request)
    case = await repo.get_case(owner, case_id, for_mutation=True)
    key = _key(idempotency_key)
    existing = await db.investigation_jobs.find_one({"owner_id": owner, "case_id": case_id, "idempotency_key_digest": repo.digest(f"{owner}:turn:{key}")}, {"_id": 0})
    if not existing:
        _revision_check(case, body.expected_revision)
    job = await _submit_turn(owner, case, body, key)
    case = await repo.get_case(owner, case_id)
    return JSONResponse({"job": repo.job_view(job).wire(), "caseRevision": case["revision"]}, status_code=202, headers=NO_STORE)


@router.get("/investigations/{case_id}/turns")
async def list_turns(case_id: str, request: Request, cursor: Optional[str] = None):
    owner = owner_of(request)
    case = await repo.get_case(owner, case_id)
    turns = await repo.accepted_turns(owner, case)
    start = int(cursor or 0)
    return JSONResponse({"items": [t.wire() for t in turns[start:start + 50]], "nextCursor": str(start + 50) if len(turns) > start + 50 else None, "total": len(turns)}, headers=NO_STORE)


@router.get("/investigations/{case_id}/jobs/{job_id}")
async def get_job(case_id: str, job_id: str, request: Request):
    owner = owner_of(request)
    case = await repo.get_case(owner, case_id)
    job = await repo.get_job(owner, case_id, job_id)
    return JSONResponse({"job": repo.job_view(job).wire(), "caseRevision": case["revision"], "responseRevision": case.get("response_revision"),
                         "audioIds": job.get("audio_ids", [])}, headers=NO_STORE)


@router.get("/investigations/{case_id}/jobs/{job_id}/events")
async def job_events(case_id: str, job_id: str, request: Request, after: int = 0):
    owner = owner_of(request)
    await repo.get_case(owner, case_id)
    await repo.get_job(owner, case_id, job_id)

    async def stream():
        sequence = after
        idle = 0
        while idle < 600:
            events = await repo.events_after(owner, job_id, sequence)
            for event in events:
                sequence = event["sequence"]
                yield f"id: {sequence}\nevent: {event['type']}\ndata: {json.dumps(event)}\n\n"
                if event["type"] in ("completed", "failed", "cancelled", "expired", "device_request"):
                    return
            job = await db.investigation_jobs.find_one({"owner_id": owner, "job_id": job_id}, {"_id": 0, "status": 1})
            if not events and job and job["status"] in ("complete", "partial", "waiting_user", "failed", "cancelled", "waiting_device"):
                return
            if await request.is_disconnected():
                return
            idle += 1
            yield ": keepalive\n\n" if idle % 20 == 0 else ""
            await asyncio.sleep(0.5)
    return StreamingResponse(stream(), media_type="text/event-stream", headers={**NO_STORE, "X-Accel-Buffering": "no"})


@router.post("/investigations/{case_id}/jobs/{job_id}/resume", status_code=202)
async def resume_job(case_id: str, job_id: str, body: ExpectedRevision, request: Request, idempotency_key: Optional[str] = Header(default=None, alias="Idempotency-Key")):
    owner = owner_of(request)
    case = await repo.get_case(owner, case_id, for_mutation=True)
    job = await repo.get_job(owner, case_id, job_id)
    _key(idempotency_key)
    if job["status"] in ACTIVE:
        return JSONResponse({"job": repo.job_view(job).wire(), "caseRevision": case["revision"]}, status_code=202, headers=NO_STORE)
    if job["status"] != "failed":
        raise http(409, "conflict", "Only a failed turn can be resumed; this turn already completed.")
    for evidence_id in repo.dec_json(job["payload_ciphertext"]).get("evidenceIds", []):
        await repo.get_evidence(owner, case_id, evidence_id)
    if case.get("active_job_id") and case["active_job_id"] != job_id:
        raise http(409, "conflict", "Another turn is active.")
    deadline = min(repo.utc(case["expires_at"]), now_utc() + timedelta(seconds=policy()["workSeconds"]))
    await db.investigation_jobs.update_one({"owner_id": owner, "job_id": job_id}, {"$set": {"status": "queued", "failure": None, "lease_until": None, "fence": None,
                                                                                            "deadline_at": deadline, "epoch": case["epoch"], "work_epoch": case.get("work_epoch", case["epoch"]), "retry_at": None}})
    await repo.cas(owner, case_id, {"revision": case["revision"]}, {"$set": {"status": "queued", "active_job_id": job_id, "active_turn_id": job["turn_id"]}}, bump=False)
    jobs.launch(owner, case_id, job_id)
    return JSONResponse({"job": repo.job_view(await repo.get_job(owner, case_id, job_id)).wire(), "caseRevision": case["revision"]}, status_code=202, headers=NO_STORE)


@router.post("/investigations/{case_id}/jobs/{job_id}/cancel", status_code=202)
async def cancel_job(case_id: str, job_id: str, body: ExpectedRevision, request: Request):
    owner = owner_of(request)
    case = await repo.get_case(owner, case_id)
    job = await repo.get_job(owner, case_id, job_id)
    if job["status"] not in ACTIVE:
        return JSONResponse({"status": job["status"], "cleanupStatus": "not_required", "cancelled": False}, status_code=200, headers=NO_STORE)
    _revision_check(case, body.expected_revision)
    # The case control record is authoritative. Match the exact job and work epoch observed above so a completed job
    # followed by a newer turn can never have that newer turn cleared by this stale cancellation request.
    updated = await repo.cas(owner, case_id, {
        "revision": case["revision"], "active_job_id": job_id,
        "work_epoch": job.get("work_epoch", job["epoch"]),
    }, {"$set": {"work_epoch": uuid.uuid4().hex, "active_job_id": None, "active_turn_id": None, "lease_fence": None,
                  "status": "partial" if case.get("response_ciphertext") else "queued"}})
    if not updated:
        current_job = await repo.get_job(owner, case_id, job_id)
        if current_job["status"] not in ACTIVE:
            return JSONResponse({"status": current_job["status"], "cleanupStatus": "not_required", "cancelled": False}, status_code=200, headers=NO_STORE)
        raise http(409, "conflict", "This turn is no longer the active work for the case; it was not cancelled.")
    cancelled = await db.investigation_jobs.find_one_and_update(
        {"owner_id": owner, "job_id": job_id, "work_epoch": job.get("work_epoch", job["epoch"]), "status": {"$in": list(ACTIVE)}},
        {"$set": {"status": "cancelled", "lease_until": None, "checkpoint_ciphertext": None}},
    )
    if not cancelled:
        current_job = await repo.get_job(owner, case_id, job_id)
        return JSONResponse({"status": current_job["status"], "cleanupStatus": "not_required", "cancelled": False}, status_code=200, headers=NO_STORE)
    await db.voice_cache.delete_many({"device_id": owner, "scope_id": case_id, "job_id": job_id})
    await repo.emit(owner, case_id, job_id, "cancelled", {"cleanupStatus": "complete"}, updated["revision"], repo.utc(case["expires_at"]))
    return JSONResponse({"status": "cancelled", "cleanupStatus": "complete", "cancelled": True}, status_code=202, headers=NO_STORE)


def _canonical_result(body: DeviceResult, requested: list[str]) -> DeviceResult:
    """Normalises a device result before hashing/storage: only requested fields, stable key order, no observed-at drift."""
    values = {k: body.values[k] for k in sorted(body.values) if not requested or k in requested}
    return body.model_copy(update={"values": values})


def _result_digest(body: DeviceResult) -> str:
    return repo.digest(json.dumps(body.wire(), sort_keys=True, separators=(",", ":")))


# ------------------------------------------------------------------ device results
@router.post("/investigations/{case_id}/device-results", status_code=202)
async def device_results(case_id: str, body: DeviceResult, request: Request):
    owner = owner_of(request)
    case = await repo.get_case(owner, case_id, for_mutation=True)
    pending = await db.investigation_device_requests.find_one({"owner_id": owner, "case_id": case_id, "request_id": body.request_id}, {"_id": 0})
    if not pending:
        raise http(409, "conflict", "No outstanding device request with that ID for this investigation.")
    if pending["request"]["capabilityId"] != body.capability_id:
        raise http(409, "conflict", "The result does not match the requested capability.")
    device = repo.device_profile(case) or {}
    if body.simulation and device.get("evidenceOrigin") == "native":
        raise http(409, "conflict", "A native device profile cannot submit simulated observations.")
    body = _canonical_result(body, pending["request"]["fields"])  # canonicalise BEFORE hashing, for first submission and replay alike
    digest = _result_digest(body)
    submission = pending.get("submission")  # recoverable record: {"state": claimed|stored|resumed, "digest", "result_ciphertext", "evidence_id"}
    if submission:
        if submission["digest"] != digest:
            raise http(409, "conflict", "A different result was already recorded for this device request.")
        if submission["state"] == "resumed":
            return JSONResponse({"accepted": True, "received": True, "consumed": True, "duplicate": True, "evidenceId": submission.get("evidence_id"), "jobId": pending["job_id"]}, status_code=202, headers=NO_STORE)
        # Identical retry of an interrupted submission: finish it (idempotent) instead of acknowledging without evidence.
        item_id = await _finish_device_submission(owner, case, pending)
        current = await db.investigation_device_requests.find_one({"owner_id": owner, "case_id": case_id, "request_id": body.request_id}, {"_id": 0, "submission.state": 1})
        consumed = (current or {}).get("submission", {}).get("state") == "resumed"
        return JSONResponse({"accepted": consumed, "received": True, "consumed": consumed, "duplicate": True, "evidenceId": item_id, "jobId": pending["job_id"]}, status_code=202, headers=NO_STORE)
    if repo.utc(datetime.fromisoformat(pending["request"]["expiresAt"])) <= now_utc():
        raise http(409, "conflict", "This device request expired before its result arrived. Higgins will ask again if the observation still matters.")
    job = await repo.get_job(owner, case_id, pending["job_id"])
    if job.get("status") in ("cancelled", "failed", "expired", "complete", "partial") or case.get("status") in ("cancelled", "expired"):
        raise http(409, "conflict", "This device request was superseded (the investigation was cancelled, finished or expired); its result cannot restart work.")
    # Atomic claim of (owner, case, request). The claim persists the canonical result itself, so a crash at ANY later point is
    # recoverable: an identical retry or the sweeper finishes ingestion and resumes the job; a changed retry gets 409.
    claimed = await db.investigation_device_requests.find_one_and_update(
        {"owner_id": owner, "case_id": case_id, "request_id": body.request_id, "submission": None},
        {"$set": {"submission": {"state": "claimed", "digest": digest, "result_ciphertext": repo.enc_json(body.wire()), "evidence_id": None, "claimed_at": now_utc(), "fence": str(uuid.uuid4())}}})
    if claimed is None:
        current = await db.investigation_device_requests.find_one({"owner_id": owner, "case_id": case_id, "request_id": body.request_id}, {"_id": 0})
        if not current or not current.get("submission") or current["submission"]["digest"] != digest:
            raise http(409, "conflict", "A different result was already recorded for this device request.")
        item_id = await _finish_device_submission(owner, case, current)
        refreshed = await db.investigation_device_requests.find_one({"owner_id": owner, "case_id": case_id, "request_id": body.request_id}, {"_id": 0, "submission.state": 1})
        consumed = (refreshed or {}).get("submission", {}).get("state") == "resumed"
        return JSONResponse({"accepted": consumed, "received": True, "consumed": consumed, "duplicate": True, "evidenceId": item_id, "jobId": pending["job_id"]}, status_code=202, headers=NO_STORE)
    pending = await db.investigation_device_requests.find_one({"owner_id": owner, "case_id": case_id, "request_id": body.request_id}, {"_id": 0})
    item_id = await _finish_device_submission(owner, case, pending)
    refreshed = await db.investigation_device_requests.find_one({"owner_id": owner, "case_id": case_id, "request_id": body.request_id}, {"_id": 0, "submission.state": 1})
    consumed = (refreshed or {}).get("submission", {}).get("state") == "resumed"
    return JSONResponse({"accepted": consumed, "received": True, "consumed": consumed, "evidenceId": item_id, "jobId": pending["job_id"]}, status_code=202, headers=NO_STORE)


DEVICE_SUBMISSION_STALE_SECONDS = 120


async def _claim_submission_stage(owner: str, case_id: str, request_id: str, from_state: str, busy_state: str) -> Optional[str]:
    """Fenced exclusive claim for one in-flight stage of device-submission recovery (renewable ownership): wins
    immediately when `submission.state == from_state` (normal progression, or a fresh sweeper/retry pass on an
    untouched claim), or by taking over a `busy_state` claim stuck past `DEVICE_SUBMISSION_STALE_SECONDS` — matched
    by CAS on the EXACT prior fence/timestamp, so the timed-out attempt's own completion write below (always gated
    on ITS OWN fence) can never land after this. Returns a fresh fence on success, else None (another live attempt
    currently owns this stage; the caller backs off instead of racing it)."""
    fence, now = uuid.uuid4().hex, now_utc()
    won = await db.investigation_device_requests.find_one_and_update(
        {"owner_id": owner, "case_id": case_id, "request_id": request_id, "submission.state": from_state},
        {"$set": {"submission.state": busy_state, "submission.fence": fence, "submission.stage_started_at": now}})
    if won:
        return fence
    current = await db.investigation_device_requests.find_one({"owner_id": owner, "case_id": case_id, "request_id": request_id}, {"_id": 0, "submission": 1})
    sub = (current or {}).get("submission") or {}
    if sub.get("state") == busy_state and sub.get("stage_started_at") and (now - repo.utc(sub["stage_started_at"])).total_seconds() >= DEVICE_SUBMISSION_STALE_SECONDS:
        taken = await db.investigation_device_requests.find_one_and_update(
            {"owner_id": owner, "case_id": case_id, "request_id": request_id, "submission.state": busy_state,
             "submission.fence": sub.get("fence"), "submission.stage_started_at": sub["stage_started_at"]},
            {"$set": {"submission.fence": fence, "submission.stage_started_at": now}})
        if taken:
            return fence
    return None


async def _finish_device_submission(owner: str, case: dict, pending: dict) -> Optional[str]:
    """Idempotently advances a claimed device submission: claimed → stored (evidence durable) → resumed (job queued
    + launched), each transition gated by a renewable, fenced claim (`_claim_submission_stage`) so the request path,
    an identical retry, and the recovery sweeper can run concurrently without a superseded attempt's write landing
    after a takeover, and without two live attempts both ingesting or both resuming the same job."""
    case_id, request_id = pending["case_id"], pending["request_id"]
    sub = pending["submission"]
    result = repo.dec_json(sub["result_ciphertext"])
    if sub["state"] in ("claimed", "storing"):
        # `from_state="claimed"` covers the untouched-claim path; a doc already sitting in "storing" (e.g. the
        # sweeper picking up a crashed attempt) falls through to the staleness-takeover branch of the SAME call.
        fence = await _claim_submission_stage(owner, case_id, request_id, "claimed", "storing")
        if not fence:
            refreshed = (await db.investigation_device_requests.find_one({"owner_id": owner, "case_id": case_id, "request_id": request_id}, {"_id": 0, "submission": 1}) or {}).get("submission") or {}
            return refreshed.get("evidence_id") if refreshed.get("state") in ("stored", "resuming", "resumed") else None
        selector = {"owner_id": owner, "case_id": case_id, "request_id": request_id}
        existing = await db.investigation_evidence.find_one({"owner_id": owner, "case_id": case_id, "client_item_id": f"observation-{request_id}"}, {"_id": 0, "evidence_id": 1})
        if existing and not await db.investigation_content_chunks.find_one({"owner_id": owner, "case_id": case_id, "evidence_id": existing["evidence_id"]}, {"_id": 0, "chunk_index": 1}):
            # A metadata row exists but its content never finished storing (a crash between the metadata insert and
            # the byte write) — that is NOT completed ingestion. Discard it and re-ingest fresh from the submission
            # payload this claim already durably retained (`result`), never leaving a resumed investigation pointed
            # at evidence with no actual content.
            await repo.discard_incomplete_ingestion(owner, case_id, existing["evidence_id"])
            existing = None
        try:
            item_id = existing["evidence_id"] if existing else (await _with_lease_renewal(
                db.investigation_device_requests, selector, "submission.fence", fence, "submission.stage_started_at",
                ev.ingest_observation(owner, case, f"observation-{request_id}", result))).id
        except LeaseLost:
            refreshed = (await db.investigation_device_requests.find_one(selector, {"_id": 0, "submission": 1}) or {}).get("submission") or {}
            return refreshed.get("evidence_id") if refreshed.get("state") in ("stored", "resuming", "resumed") else None
        committed = await db.investigation_device_requests.find_one_and_update(
            {**selector, "submission.fence": fence},
            {"$set": {"submission.state": "stored", "submission.evidence_id": item_id, "evidence_id": item_id}})
        if not committed:  # fenced out mid-ingestion: our write never lands; defer entirely to the current owner
            refreshed = (await db.investigation_device_requests.find_one(selector, {"_id": 0, "submission": 1}) or {}).get("submission") or {}
            sub = refreshed or sub
        else:
            sub = {**sub, "state": "stored", "evidence_id": item_id}
    if sub["state"] in ("stored", "resuming"):
        fence = await _claim_submission_stage(owner, case_id, request_id, "stored", "resuming")
        if not fence:
            refreshed = (await db.investigation_device_requests.find_one({"owner_id": owner, "case_id": case_id, "request_id": request_id}, {"_id": 0, "submission": 1}) or {}).get("submission") or {}
            return refreshed.get("evidence_id", sub.get("evidence_id"))
        selector = {"owner_id": owner, "case_id": case_id, "request_id": request_id}

        async def _resume() -> bool:
            job = await repo.get_job(owner, case_id, pending["job_id"])
            if job.get("status") not in ("waiting_device", "queued", "investigating", "retry_wait"):
                return request_id in job.get("consumed_device_request_ids", [])
            checkpoint = repo.dec_json(job["checkpoint_ciphertext"]) if job.get("checkpoint_ciphertext") else {"contents": [], "rounds": 0}
            if not any(r.get("evidenceId") == sub["evidence_id"] for r in checkpoint.get("deviceResults", [])):
                checkpoint.setdefault("deviceResults", []).append({**result, "evidenceId": sub["evidence_id"]})
            # Atomic condition on the job's OWN state and lease — never overwrite a job that a live coordinator turn
            # currently holds under an unexpired lease, or one that already moved to a terminal state elsewhere.
            resumed_job = await db.investigation_jobs.find_one_and_update(
                {"owner_id": owner, "job_id": job["job_id"], "status": {"$in": ["waiting_device", "queued", "retry_wait"]},
                 "consumed_device_request_ids": {"$ne": request_id},
                 "$or": [{"lease_until": None}, {"lease_until": {"$lte": now_utc()}}]},
                {"$set": {"checkpoint_ciphertext": repo.enc_json(checkpoint), "status": "queued", "lease_until": None},
                 "$addToSet": {"consumed_device_request_ids": request_id}})
            if resumed_job is None:
                current_job = await repo.get_job(owner, case_id, job["job_id"])
                return request_id in current_job.get("consumed_device_request_ids", [])
            await repo.cas(owner, case_id, {
                "work_epoch": job.get("work_epoch", job["epoch"]), "active_job_id": job["job_id"],
                "status": {"$in": ["waiting_device", "queued"]}, "pending_device_request_ids": request_id,
            }, {"$set": {"status": "queued"}, "$pull": {"pending_device_request_ids": request_id}})
            return True
        # No multi-document transactions here (standalone MongoDB): the job/case writes above are protected instead by
        # holding the SAME renewed fence for their whole duration — no other attempt can also be in "resuming" while
        # this one is alive and heartbeating — AND each write is itself conditioned on the job's/case's own state, so
        # a write that arrives after the fence is lost (heartbeat cancelled work promptly, but a write already in
        # flight could still land) still cannot corrupt a state it no longer matches.
        try:
            consumed = await _with_lease_renewal(db.investigation_device_requests, selector, "submission.fence", fence, "submission.stage_started_at", _resume())
        except LeaseLost:
            refreshed = (await db.investigation_device_requests.find_one(selector, {"_id": 0, "submission": 1}) or {}).get("submission") or {}
            return refreshed.get("evidence_id", sub.get("evidence_id"))
        committed = await db.investigation_device_requests.find_one_and_update(
            {**selector, "submission.fence": fence},
            {"$set": ({"submission.state": "resumed", "fulfilled": True, "result_digest": sub["digest"], "consumed_at": now_utc()}
                      if consumed else {"submission.state": "stored", "submission.deferred_at": now_utc()})})
        if committed and consumed:
            # Wake only after the inbox projection says fulfilled. If the process dies here, the queued job is found
            # by recovery; if it dies before here, inbox recovery finishes the acknowledgement and then wakes it.
            jobs.launch(owner, case_id, pending["job_id"])
        if not committed:  # fenced out: another attempt owns the outcome; do not claim credit for the resume ourselves
            refreshed = (await db.investigation_device_requests.find_one({"owner_id": owner, "case_id": case_id, "request_id": request_id}, {"_id": 0, "submission": 1}) or {}).get("submission") or {}
            sub = refreshed or sub
    return sub.get("evidence_id")


# Settings destinations the client may advertise (mirrors frontend/src/settings/guidance.ts keywords). The plan binds to the
# most specific destination the DEVICE advertised for this target; a generic app-settings page is the last resort, never a default
# for unrelated targets.
SETTINGS_DESCRIPTOR_KEYWORDS: dict[str, tuple[str, ...]] = {
    "open_settings.notifications": ("notification", "alert"),
    "open_settings.vpn": ("vpn", "dns filter", "site gate"),
    "open_settings.accessibility": ("accessibility",),
    "open_settings.notification_access": ("notification access", "notification listener", "text gate"),
    "open_settings.security": ("security", "lock screen", "screen lock", "play protect"),
    "open_settings.unknown_sources": ("unknown source", "install unknown", "sideload"),
    "open_settings.overlay": ("overlay", "display over", "draw over"),
    "open_settings.developer": ("developer", "usb debugging"),
    "open_settings.apps": ("uninstall", "installed app", "app list", "app info"),
    "open_settings.safari_extensions": ("safari", "content blocker", "extension", "site gate"),
}


def _settings_descriptor_for(target: str, advertised: list[str]) -> Optional[str]:
    """Picks the MOST SPECIFIC advertised destination for `target` — the longest matching keyword phrase wins,
    never simple declaration order, so a broad word like "notification" can't shadow a more specific phrase like
    "notification access" that also appears in the same target text."""
    t = target.lower()
    best: Optional[tuple[int, str]] = None
    for descriptor, keywords in SETTINGS_DESCRIPTOR_KEYWORDS.items():
        if descriptor not in advertised:
            continue
        match_len = max((len(k) for k in keywords if k in t), default=0)
        if match_len and (best is None or match_len > best[0]):
            best = (match_len, descriptor)
    if best:
        return best[1]
    return "open_settings.app" if "open_settings.app" in advertised else None


# ------------------------------------------------------------------ settings plans
@router.post("/investigations/{case_id}/settings-plan")
async def settings_plan(case_id: str, body: SettingsPlanRequest, request: Request):
    owner = owner_of(request)
    case = await repo.get_case(owner, case_id)
    _revision_check(case, body.expected_revision)
    ctx = toolbox.ToolContext(owner, case, {"job_id": "settings"}, body.device.wire())
    research = await toolbox.research_settings(ctx, {"target": body.target})
    if research.get("status") != "ok":
        raise http(503, "provider_unavailable", "Settings research is unavailable right now; the investigation text remains usable.", retryable=True)
    capability = body.capability_id if body.capability_id in body.device.capability_ids else None
    settings_capability = _settings_descriptor_for(body.target, body.device.capability_ids)
    mode = "permission_request" if capability and capability.startswith("permission.") else ("settings_link" if settings_capability else "instructions")
    steps = [line.strip("-• ").strip() for line in research["answer"].splitlines() if line.strip() and not line.lower().startswith("limitations")]
    plan = SettingsPlan(id=str(uuid.uuid4()), case_id=case_id, target=body.target, device=body.device, match=research["match"], mode=mode, instructions=steps[:20],
                        source_ids=[s["sourceId"] for s in research.get("sources", [])], execution_descriptor_id=capability or settings_capability,
                        expected_observation=ExpectedObservation(capability_id=capability, field=body.expected_field, expected_value=body.expected_value) if capability and body.expected_value is not None else None)
    await db.investigation_settings_plans.insert_one({"owner_id": owner, "case_id": case_id, "plan_id": plan.id, "plan_ciphertext": repo.enc_json(plan.wire()), "created_at": now_utc(),
                                                      "expires_at": repo.utc(case["expires_at"])})
    return JSONResponse({"plan": plan.wire(), "researchNote": research.get("note")}, headers=NO_STORE)


@router.post("/investigations/{case_id}/settings-plan/{plan_id}/recheck")
async def recheck(case_id: str, plan_id: str, body: RecheckRequest, request: Request):
    owner = owner_of(request)
    await repo.get_case(owner, case_id)
    row = await db.investigation_settings_plans.find_one({"owner_id": owner, "case_id": case_id, "plan_id": plan_id}, {"_id": 0})
    if not row:
        raise http(404, "not_found", "Unknown settings plan.")
    plan = SettingsPlan.model_validate(repo.dec_json(row["plan_ciphertext"]))
    if not plan.expected_observation:
        return JSONResponse(RecheckResult(plan_id=plan_id, checked_at=now_utc(), outcome="cannot_observe", evidence_ids=[],
                                          explanation="Apollo cannot observe this setting on this device; only you can confirm it. Your confirmation is recorded as user-reported, not observed.").wire(), headers=NO_STORE)
    outcome, explanation, used = "cannot_observe", "No fresh observation of the target capability was supplied.", []
    for evidence_id in body.device_result_ids:
        evidence = await repo.get_evidence(owner, case_id, evidence_id)
        result = (await repo.evidence_meta(evidence)).get("deviceResult") or {}
        if result.get("capabilityId") != plan.expected_observation.capability_id:
            continue
        used.append(evidence_id)
        if repo.utc(evidence["collected_at"]) <= repo.utc(row["created_at"]) or (evidence.get("observed_at") and repo.utc(evidence["observed_at"]) <= repo.utc(row["created_at"])):
            outcome, explanation = "cannot_observe", "The only matching observation predates the plan; a fresh observation taken after the change is required."
            continue
        if evidence.get("simulation") and (repo.device_profile(await repo.get_case(owner, case_id)) or {}).get("evidenceOrigin") == "native":
            continue  # a preview fixture never becomes native proof
        if result.get("status") != "observed":
            outcome, explanation = "cannot_observe", f"The device reported '{result.get('status')}' for this capability; the setting could not be read."
        elif result.get("values", {}).get(plan.expected_observation.field) == plan.expected_observation.expected_value:
            outcome, explanation = "correct", "A fresh observation shows the setting now matches the expected value."
        else:
            outcome, explanation = "not_yet_correct", "A fresh observation shows the setting is still not at the expected value. Reopen Settings and check the exact item named in the instructions."
    return JSONResponse(RecheckResult(plan_id=plan_id, checked_at=now_utc(), outcome=outcome, evidence_ids=used, explanation=explanation).wire(), headers=NO_STORE)


# ------------------------------------------------------------------ speech
def _segments(text: str) -> list[str]:
    text = re.sub(r"[*_`#>\[\]()]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    sentences = re.split(r"(?<=[.!?])\s+", text)
    segments, current = [], ""
    for sentence in sentences:
        if len(current) + len(sentence) + 1 > SPEECH_SEGMENT_CHARACTERS and current:
            segments.append(current)
            current = ""
        current = f"{current} {sentence}".strip()
    if current:
        segments.append(current)
    return segments


async def _speech_job(owner: str, case: dict, job: dict, text: str) -> None:
    audio_ids = []
    try:
        for index, segment in enumerate(_segments(text)):
            fresh = await db.investigation_cases.find_one({"owner_id": owner, "case_id": case["case_id"]}, {"_id": 0, "epoch": 1, "work_epoch": 1, "deleted": 1, "expires_at": 1})
            if not fresh or fresh["deleted"] or fresh["epoch"] != job["epoch"] or fresh.get("work_epoch", fresh["epoch"]) != job.get("work_epoch", job["epoch"]) or repo.utc(fresh["expires_at"]) <= now_utc():
                await repo.set_job(owner, job["job_id"], None, {"$set": {"status": "cancelled"}})
                return
            await repo.emit(owner, case["case_id"], job["job_id"], "progress", {"phase": "respond", "message": f"Preparing narration segment {index + 1}."}, case["revision"], repo.utc(case["expires_at"]))
            audio, _meta = await provider.speech_bytes(segment)
            if await repo.live_epoch(owner, case["case_id"]) != job["epoch"]:  # late provider result after deletion/cancel/expiry is discarded
                await repo.set_job(owner, job["job_id"], None, {"$set": {"status": "cancelled"}})
                return
            audio_id = str(uuid.uuid4())
            await db.voice_cache.insert_one({"device_id": owner, "scope_id": case["case_id"], "job_id": job["job_id"], "audio_id": audio_id, "segment": index,
                                             "audio_ciphertext": encrypt(audio), "created_at": now_utc(), "expires_at": repo.utc(case["expires_at"]), "content_version": 1})
            audio_ids.append(audio_id)
            await db.investigation_jobs.update_one({"owner_id": owner, "job_id": job["job_id"]}, {"$set": {"audio_ids": audio_ids}})
        await repo.set_job(owner, job["job_id"], None, {"$set": {"status": "complete"}})
        await repo.emit(owner, case["case_id"], job["job_id"], "completed", {"turnId": job["turn_id"], "responseRevision": case.get("response_revision"), "providerComplete": True,
                                                                             "completion": "complete", "caseStatus": case["status"], "cleanupStatus": "not_due", "audioIds": audio_ids}, case["revision"], repo.utc(case["expires_at"]))
    except provider.ProviderFailure as exc:
        failure = {"code": exc.code, "message": f"Narration stopped at segment {len(audio_ids) + 1}. The text remains available; retry to continue.", "retryable": exc.retryable, "retryAfterSeconds": None, "missingEvidenceIds": []}
        await repo.set_job(owner, job["job_id"], None, {"$set": {"status": "failed", "failure": failure}})
        await repo.emit(owner, case["case_id"], job["job_id"], "failed", failure, case["revision"], repo.utc(case["expires_at"]))


@router.post("/investigations/{case_id}/speech", status_code=202)
async def speech(case_id: str, body: SpeechRequest, request: Request):
    owner = owner_of(request)
    case = await repo.get_case(owner, case_id)
    if not case.get("response_ciphertext") or case.get("response_revision") != body.response_revision:
        raise http(409, "conflict", "That response revision is not the current accepted answer.")
    response = repo.dec_json(case["response_ciphertext"])
    text = response["overview"] if body.section == "overview" else response["explanationMarkdown"]
    job = await repo.create_job(owner, case, f"speech-{body.response_revision}-{body.section}", repo.digest(f"speech:{uuid.uuid4()}"), repo.digest(text), "speech", {"section": body.section})
    task = asyncio.create_task(_speech_job(owner, case, {**job, "status": "investigating"}, text))
    jobs._tasks.add(task)
    task.add_done_callback(jobs._tasks.discard)
    return JSONResponse({"job": repo.job_view(job).wire(), "segments": len(_segments(text))}, status_code=202, headers=NO_STORE)


@router.get("/investigations/{case_id}/speech/{audio_id}")
async def speech_audio(case_id: str, audio_id: str, request: Request):
    owner = owner_of(request)
    await repo.get_case(owner, case_id)
    doc = await db.voice_cache.find_one({"device_id": owner, "scope_id": case_id, "audio_id": audio_id, "expires_at": {"$gt": now_utc()}}, {"_id": 0})
    if not doc:
        raise http(410, "evidence_expired", "This temporary audio has expired or was deleted.")
    return Response(decrypt(doc["audio_ciphertext"]), media_type="audio/wav", headers=NO_STORE)


# ------------------------------------------------------------------ saved reports
@router.post("/investigations/{case_id}/reports", status_code=201)
async def save_report(case_id: str, body: ReportRequest, request: Request):
    owner = owner_of(request)
    case = await repo.get_case(owner, case_id)
    if case.get("response_revision") != body.response_revision or not case.get("response_ciphertext"):
        raise http(409, "conflict", "That response revision is not the current accepted answer.")
    response = repo.dec_json(case["response_ciphertext"])
    sources = await repo.sources(owner, case_id)
    report_id = str(uuid.uuid4())
    report = {"reportId": report_id, "caseId": case_id, "gates": case["gates"], "savedAt": now_utc().isoformat(), "overview": redact_investigation_secrets(response["overview"]),
              "explanationMarkdown": redact_investigation_secrets(response["explanationMarkdown"]), "assessment": response["assessment"], "attention": response["attention"],
              "findings": [redact_investigation_secrets(f["text"]) for f in response["findings"]], "uncertainties": response["uncertainties"],
              "sources": [{"url": s["url"], "title": s["title"], "authority": s["authority"]} for s in sources if s["id"] in set(response["sourceIds"])], "historical": True}
    await db.investigation_reports.insert_one({"owner_id": owner, "report_id": report_id, "report_ciphertext": repo.enc_json(report), "saved_at": now_utc()})
    return JSONResponse({"reportId": report_id}, status_code=201, headers=NO_STORE)


@router.get("/investigations/reports/list")
async def list_reports(request: Request):
    owner = owner_of(request)
    rows = await db.investigation_reports.find({"owner_id": owner}, {"_id": 0}).sort("saved_at", -1).to_list(50)
    return JSONResponse({"items": [repo.dec_json(r["report_ciphertext"]) for r in rows]}, headers=NO_STORE)


@router.get("/investigations/reports/{report_id}")
async def get_report(report_id: str, request: Request):
    owner = owner_of(request)
    row = await db.investigation_reports.find_one({"owner_id": owner, "report_id": report_id}, {"_id": 0})
    if not row:
        raise http(404, "not_found", "Unknown report.")
    return JSONResponse(repo.dec_json(row["report_ciphertext"]), headers=NO_STORE)
