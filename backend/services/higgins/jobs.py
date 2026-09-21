"""Durable job execution: leases, fencing, events, retry classification, cancellation and recovery (spec §5, §12).

Work starts after a 202 and runs in-process; a crashed or restarted server recovers abandoned jobs once their lease expires.
"""
from __future__ import annotations

import asyncio
import random
from datetime import timedelta
from typing import Optional

from core.config import logger
from core.db import db, now_utc
from services.higgins import coordinator, provider
from services.higgins import repository as repo
from services.higgins.contracts import Failure

MAX_TRANSIENT_RETRIES = 2
_tasks: set[asyncio.Task] = set()

MESSAGES = {"rate_limited": "Gemini is rate-limiting requests. Higgins will retry shortly.", "provider_unavailable": "Gemini did not answer in time.",
            "provider_configuration": "The Gemini configuration on this server is invalid or lacks a required capability. Operator attention is needed.",
            "incomplete_output": "Gemini stopped before completing its answer.", "response_invalid": "Higgins' answer did not pass Apollo's interface checks after one repair.",
            "budget_exhausted": "The evidence exceeds the model's context budget for a single pass.", "transport_interrupted": "The investigation was superseded before it could be committed.",
            "evidence_expired": "Temporary evidence expired before the investigation finished."}


def launch(owner: str, case_id: str, job_id: str) -> None:
    task = asyncio.create_task(run(owner, case_id, job_id))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


async def _emit(owner: str, case: dict, job: dict, kind: str, payload: dict) -> None:
    fresh = await db.investigation_cases.find_one({"owner_id": owner, "case_id": case["case_id"]}, {"_id": 0, "revision": 1})
    await repo.emit(owner, case["case_id"], job["job_id"], kind, payload, (fresh or case)["revision"], repo.utc(case["expires_at"]))


async def _fail(owner: str, case: dict, job: dict, failure: Failure, *, partial: bool = False) -> None:
    await repo.set_job(owner, job["job_id"], job.get("fence"), {"$set": {"status": "failed", "failure": failure.wire(), "lease_until": None}})
    await repo.cas(owner, case["case_id"], {"epoch": job["epoch"], "active_job_id": job["job_id"], **({"lease_fence": job["fence"]} if job.get("fence") else {})},
                   {"$set": {"status": "partial" if partial or case.get("response_ciphertext") else "failed", "active_job_id": None, "active_turn_id": None, "lease_fence": None}}, bump=False)
    if partial:
        await _emit(owner, case, job, "partial", {"responseRevision": case.get("response_revision"), "reason": failure.wire(), "canContinue": failure.retryable or failure.code != "provider_configuration"})
    await _emit(owner, case, job, "failed", failure.wire())


async def run(owner: str, case_id: str, job_id: str) -> None:
    job = await repo.acquire_lease(owner, job_id)
    if not job:
        return
    case = await db.investigation_cases.find_one({"owner_id": owner, "case_id": case_id}, {"_id": 0})
    if not case or case["deleted"] or case["epoch"] != job["epoch"] or repo.utc(case["expires_at"]) <= now_utc():
        await repo.set_job(owner, job_id, job["fence"], {"$set": {"status": "cancelled", "lease_until": None}})
        return
    accepted = await repo.accepted_commit_for(owner, case, job["turn_id"])
    if accepted:  # crash after acceptance: repair job/event projections from the authoritative commit, no second conclusion
        commit = repo.dec_json(accepted["commit_ciphertext"])
        await repo.set_job(owner, job_id, job["fence"], {"$set": {"status": case["status"] if case["status"] in ("complete", "partial", "waiting_user") else "complete", "lease_until": None, "checkpoint_ciphertext": None}})
        sources = await repo.sources(owner, case_id)
        await _emit(owner, case, job, "response", {"response": commit["response"], "sources": [s for s in sources if s["id"] in set(commit["response"]["sourceIds"])]})
        await _emit(owner, case, job, "completed", {"turnId": job["turn_id"], "responseRevision": commit["committedRevision"], "providerComplete": True,
                                                    "completion": commit["response"]["completion"], "caseStatus": case["status"], "cleanupStatus": case.get("cleanup_status", "not_due"), "repaired": True})
        return
    fenced = await repo.cas(owner, case_id, {"epoch": job["epoch"], "active_job_id": job_id}, {"$set": {"lease_fence": job["fence"], "status": "investigating"}}, bump=False)
    if not fenced:
        await repo.set_job(owner, job_id, job["fence"], {"$set": {"status": "cancelled", "lease_until": None}})
        return
    case = fenced
    stop = asyncio.Event()

    async def heartbeat():
        while not stop.is_set():
            await asyncio.sleep(10)
            if not await repo.heartbeat(owner, job_id, job["fence"]):
                stop.set()

    async def progress(phase: str, message: str) -> None:
        if stop.is_set():
            raise asyncio.CancelledError()
        await _emit(owner, case, job, "progress", {"phase": phase, "message": message})

    beat = asyncio.create_task(heartbeat())
    transient = 0
    try:
        while True:
            remaining = (repo.utc(job["deadline_at"]) - now_utc()).total_seconds()
            if remaining <= 5:
                await _fail(owner, case, job, Failure(code="budget_exhausted", message="The work slice deadline was reached before Higgins finished. Retry to continue.", retryable=True), partial=True)
                return
            try:
                outcome = await asyncio.wait_for(coordinator.run_turn(owner, case, job, progress), timeout=remaining)
            except asyncio.TimeoutError:
                await _fail(owner, case, job, Failure(code="provider_unavailable", message=MESSAGES["provider_unavailable"], retryable=True), partial=True)
                return
            except provider.ProviderFailure as exc:
                if exc.retryable and transient < MAX_TRANSIENT_RETRIES:
                    transient += 1
                    delay = min(remaining - 5, (2 ** transient) + random.uniform(0, 1.5))
                    if delay <= 0:
                        await _fail(owner, case, job, Failure(code=exc.code, message=MESSAGES.get(exc.code, exc.code), retryable=True), partial=True)
                        return
                    retry_at = now_utc() + timedelta(seconds=delay)
                    failure = Failure(code=exc.code, message=MESSAGES.get(exc.code, exc.code), retryable=True, retry_after_seconds=int(delay))
                    await repo.set_job(owner, job_id, job["fence"], {"$set": {"status": "retry_wait", "retry_at": retry_at, "failure": failure.wire()}})
                    await repo.cas(owner, case_id, {"epoch": job["epoch"], "active_job_id": job_id}, {"$set": {"status": "retry_wait"}}, bump=False)
                    await _emit(owner, case, job, "retry_scheduled", {"retryAt": retry_at.isoformat(), "failure": failure.wire()})
                    await asyncio.sleep(delay)
                    if stop.is_set():
                        return
                    await repo.set_job(owner, job_id, job["fence"], {"$set": {"status": "investigating", "retry_at": None}})
                    await repo.cas(owner, case_id, {"epoch": job["epoch"], "active_job_id": job_id}, {"$set": {"status": "investigating"}}, bump=False)
                    continue
                code = exc.code if exc.code in MESSAGES else "provider_unavailable"
                await _fail(owner, case, job, Failure(code=code, message=MESSAGES[code], retryable=exc.retryable), partial=True)
                return
            break
        if outcome.kind == "waiting_device":
            await repo.set_job(owner, job_id, job["fence"], {"$set": {"status": "waiting_device", "lease_until": None}})
            await repo.cas(owner, case_id, {"epoch": job["epoch"], "active_job_id": job_id},
                           {"$set": {"status": "waiting_device"}, "$addToSet": {"pending_device_request_ids": outcome.request["id"]}}, bump=False)
            await _emit(owner, case, job, "device_request", outcome.request)
            return
        if outcome.kind == "invalid":
            await _fail(owner, case, job, Failure(code="response_invalid", message=MESSAGES["response_invalid"] + " Details: " + "; ".join(outcome.errors)[:600], retryable=True), partial=True)
            return
        if outcome.kind == "superseded":
            await repo.set_job(owner, job_id, job["fence"], {"$set": {"status": "cancelled", "lease_until": None}})
            pass  # unaccepted bundles of this attempt are reclaimed by the sweeper; accepted history is never touched here
            return
        commit, updated = outcome.commit, outcome.case
        await repo.set_job(owner, job_id, job["fence"], {"$set": {"status": updated["status"], "lease_until": None, "checkpoint_ciphertext": None}})
        sources = await repo.sources(owner, case_id)
        await _emit(owner, case, job, "response", {"response": commit.response.wire(), "sources": [s for s in sources if s["id"] in set(commit.response.source_ids)]})
        if commit.response.question:
            await _emit(owner, case, job, "question", commit.response.question.wire())
        await _emit(owner, case, job, "completed", {"turnId": commit.turn_id, "responseRevision": commit.committed_revision, "providerComplete": True,
                                                    "completion": commit.response.completion, "caseStatus": updated["status"], "cleanupStatus": updated.get("cleanup_status", "not_due")})
    except asyncio.CancelledError:
        if stop.is_set():
            await repo.set_job(owner, job_id, job["fence"], {"$set": {"status": "cancelled", "lease_until": None}})
        raise
    except Exception:  # noqa: BLE001 — never log content; surface a typed failure
        logger.error("investigation_job_failed job=%s", job_id)
        try:
            await _fail(owner, case, job, Failure(code="provider_unavailable", message="An internal error interrupted the investigation. Retry to continue.", retryable=True), partial=True)
        except Exception:  # noqa: BLE001
            pass
    finally:
        stop.set()
        beat.cancel()


async def recover() -> None:
    """Startup/sweeper: relaunch jobs whose lease expired while processing, or that never started; reconcile jobs past their work deadline.
    An accepted turn is authoritative: a job whose turn was already accepted is repaired (via run()), never failed for a passed deadline."""
    now = now_utc()
    async for job in db.investigation_jobs.find({"status": {"$in": ["queued", "investigating", "retry_wait"]}, "deadline_at": {"$lte": now},
                                                 "$or": [{"lease_until": None}, {"lease_until": {"$lte": now}}]}, {"_id": 0}):
        case = await db.investigation_cases.find_one({"owner_id": job["owner_id"], "case_id": job["case_id"]}, {"_id": 0})
        if not case:
            continue
        if await repo.accepted_commit_for(job["owner_id"], case, job["turn_id"]):
            launch(job["owner_id"], job["case_id"], job["job_id"])  # run() repairs projections from the accepted commit
            continue
        await _fail(job["owner_id"], case, job, Failure(code="budget_exhausted", message="The work slice ended before Higgins finished. Retry to continue from the last completed step.", retryable=True), partial=True)
    # Device results whose evidence was stored but whose job was never resumed (crash between ingestion and launch).
    async for pending in db.investigation_device_requests.find({"fulfilled": True, "continuation.resumed": False, "continuation.evidence_id": {"$ne": None}}, {"_id": 0}):
        job = await db.investigation_jobs.find_one({"owner_id": pending["owner_id"], "job_id": pending["job_id"]}, {"_id": 0})
        if job and job.get("status") in ("queued", "investigating", "waiting_device", "retry_wait"):
            checkpoint = repo.dec_json(job["checkpoint_ciphertext"]) if job.get("checkpoint_ciphertext") else {"contents": [], "rounds": 0}
            if not any(r.get("evidenceId") == pending["continuation"]["evidence_id"] for r in checkpoint.get("deviceResults", [])):
                evidence = await db.investigation_evidence.find_one({"owner_id": pending["owner_id"], "evidence_id": pending["continuation"]["evidence_id"]}, {"_id": 0})
                result = ((await repo.evidence_meta(evidence)).get("deviceResult") if evidence else None) or {}
                checkpoint.setdefault("deviceResults", []).append({**result, "evidenceId": pending["continuation"]["evidence_id"]})
            await db.investigation_jobs.update_one({"owner_id": pending["owner_id"], "job_id": job["job_id"]}, {"$set": {"checkpoint_ciphertext": repo.enc_json(checkpoint), "status": "queued", "lease_until": None}})
            await db.investigation_cases.update_one({"owner_id": pending["owner_id"], "case_id": pending["case_id"], "status": "waiting_device"}, {"$set": {"status": "queued"}, "$pull": {"pending_device_request_ids": pending["request_id"]}})
            launch(pending["owner_id"], pending["case_id"], job["job_id"])
        await db.investigation_device_requests.update_one({"owner_id": pending["owner_id"], "request_id": pending["request_id"]}, {"$set": {"continuation.resumed": True}})
    async for job in db.investigation_jobs.find({"status": {"$in": ["queued", "investigating", "retry_wait"]}, "deadline_at": {"$gt": now},
                                                 "$or": [{"lease_until": None}, {"lease_until": {"$lte": now}}]}, {"_id": 0, "owner_id": 1, "case_id": 1, "job_id": 1}):
        launch(job["owner_id"], job["case_id"], job["job_id"])


async def sweep_loop() -> None:
    while True:
        try:
            await repo.sweep()
            await recover()
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            logger.error("investigation_sweep_failed")
        await asyncio.sleep(20)
