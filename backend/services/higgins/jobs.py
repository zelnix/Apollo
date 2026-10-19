"""Durable job execution: leases, fencing, events, retry classification, cancellation and recovery (spec §5, §12).

Work starts after a 202 and runs in-process; a crashed or restarted server recovers abandoned jobs once their lease expires.
"""
from __future__ import annotations

import asyncio
import random
import time as _time
from datetime import datetime, timedelta, timezone
from typing import Optional

from core.config import logger
from core.db import db, now_utc
from services.higgins import coordinator, provider
from services.higgins import repository as repo
from services.higgins.capacity import WORK_SECONDS
from services.higgins.contracts import DiagnosticDetail, Failure, RetryAttempt

MAX_TRANSIENT_RETRIES = 3
MAX_AUTO_RESUME = 2   # bounded auto-resume after initial job failure
_tasks: set[asyncio.Task] = set()

# ── Higgins explanation messages keyed by failure classification ──
# Each maps a FailureCode to a Higgins-style user-facing explanation.
HIGGINS_EXPLANATIONS: dict[str, str] = {
    "rate_limited": "Magnum DI has temporarily reached the analysis service's request limit. It's waiting briefly before trying again.",
    "provider_unavailable": "Magnum DI's analysis service took longer than expected to respond. It's automatically trying again, so you don't need to do anything just yet.",
    "provider_configuration": "Magnum DI couldn't access one of its analysis services because it isn't configured correctly. This needs a technical fix rather than another immediate attempt.",
    "incomplete_output": "Magnum DI stopped before completing the answer. It's attempting to continue using the information already collected.",
    "response_invalid": "Magnum DI's answer didn't pass Apollo's quality checks. It's trying to generate a corrected response.",
    "budget_exhausted": "Magnum DI ran out of processing time before it could finish. It's attempting to continue the investigation using the information already collected.",
    "transport_interrupted": "The investigation connection was interrupted before results could be committed.",
    "evidence_expired": "Temporary evidence expired before the investigation could finish. A new investigation with fresh evidence may be needed.",
}

# Terminal message variants when automatic retries are exhausted.
HIGGINS_EXHAUSTED: dict[str, str] = {
    "rate_limited": "Magnum DI couldn't complete the investigation because the analysis service remained unavailable after several attempts. I'll show you any findings already collected. You can try again later.",
    "provider_unavailable": "Magnum DI couldn't complete the investigation because the analysis service remained unavailable after several attempts. I'll show you any findings already collected. You can try again later.",
    "provider_configuration": "Magnum DI couldn't access one of its analysis services because it isn't configured correctly. This needs a technical fix rather than another immediate attempt.",
    "incomplete_output": "Magnum DI couldn't produce a complete answer after several attempts. I'll show you the available findings.",
    "response_invalid": "Magnum DI's answer didn't pass Apollo's quality checks after several repair attempts.",
    "budget_exhausted": "Magnum DI ran out of processing time. I'll show you any findings already collected and the technical details so we can identify what needs fixing.",
    "evidence_expired": "Temporary evidence expired before the investigation could finish. A new investigation with fresh evidence is needed.",
}

# Fallback for unknown codes
HIGGINS_UNKNOWN = "Magnum DI couldn't complete the investigation, but I can't confirm exactly what interrupted it. I'll show you the available findings and the technical details so we can identify what needs fixing."


def launch(owner: str, case_id: str, job_id: str) -> None:
    task = asyncio.create_task(run(owner, case_id, job_id))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


async def _emit(owner: str, case: dict, job: dict, kind: str, payload: dict) -> None:
    fresh = await db.investigation_cases.find_one({"owner_id": owner, "case_id": case["case_id"]}, {"_id": 0, "revision": 1})
    await repo.emit(owner, case["case_id"], job["job_id"], kind, payload, (fresh or case)["revision"], repo.utc(case["expires_at"]))
    # Push notification for background assessment completion (Text Gate + Email Gate).
    # Only fires for "completed" events on cases created by background intake (gate: text/email).
    if kind == "completed":
        try:
            await _push_background_completion(owner, case)
        except Exception:
            pass  # Non-blocking


async def _push_background_completion(owner: str, case: dict) -> None:
    """Send a push notification when a background investigation completes.
    Only fires for background-originated cases (text gate auto-assessment, email monitoring).
    The email path also has its own push via _finalise_receipt, so we only push for text here."""
    gate = case.get("gate", "")
    if gate not in ("text",):
        return  # Email gate push is handled by mailbox_monitor._send_assessment_push
    device = await db.devices.find_one({"device_id": owner}, {"push_token": 1})
    if not device or not device.get("push_token"):
        return
    from routers.push import send_push
    await send_push(
        recipients=[device["push_token"]],
        data={
            "title": "Apollo: message assessed",
            "body": "Apollo completed a background assessment of a captured message. Open Apollo to review.",
            "type": "text_assessment",
            "caseId": case.get("case_id"),
        },
        owner_id=owner,
    )


async def _fail(owner: str, case: dict, job: dict, failure: Failure, *, partial: bool = False) -> None:
    # Populate case/job IDs in diagnostics if present
    if failure.diagnostics:
        failure.diagnostics.case_id = case.get("case_id")
        failure.diagnostics.job_id = job.get("job_id")
    # Merge any existing retry history from the job document
    existing_history = job.get("retry_history", [])
    if existing_history:
        merged = [RetryAttempt(**h) if isinstance(h, dict) else h for h in existing_history]
        failure.retry_history = merged + failure.retry_history

    await repo.set_job(owner, job["job_id"], job.get("fence"), {
        "$set": {"status": "failed", "failure": failure.wire(), "lease_until": None,
                 "retry_history": [h.wire() if hasattr(h, 'wire') else h for h in failure.retry_history]}})
    await repo.cas(owner, case["case_id"], {"epoch": job["epoch"], "work_epoch": job.get("work_epoch", job["epoch"]), "active_job_id": job["job_id"], **({"lease_fence": job["fence"]} if job.get("fence") else {})},
                   {"$set": {"status": "partial" if partial or case.get("response_ciphertext") else "failed", "active_job_id": None, "active_turn_id": None, "lease_fence": None}}, bump=False)
    if partial:
        await _emit(owner, case, job, "partial", {"responseRevision": case.get("response_revision"), "reason": failure.wire(), "canContinue": failure.retryable or failure.code != "provider_configuration"})
    await _emit(owner, case, job, "failed", failure.wire())


async def run(owner: str, case_id: str, job_id: str) -> None:
    job = await repo.acquire_lease(owner, job_id)
    if not job:
        return
    case = await db.investigation_cases.find_one({"owner_id": owner, "case_id": case_id}, {"_id": 0})
    if not case or case["deleted"] or case["epoch"] != job["epoch"] or case.get("work_epoch", case["epoch"]) != job.get("work_epoch", job["epoch"]) or repo.utc(case["expires_at"]) <= now_utc():
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
    fenced = await repo.cas(owner, case_id, {"epoch": job["epoch"], "work_epoch": job.get("work_epoch", job["epoch"]), "active_job_id": job_id}, {"$set": {"lease_fence": job["fence"], "status": "investigating"}}, bump=False)
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
    retry_history: list[RetryAttempt] = []
    # Recover any existing retry history from the job document
    for rh in job.get("retry_history", []):
        retry_history.append(RetryAttempt(**rh) if isinstance(rh, dict) else rh)
    job_start = _time.monotonic()
    try:
        while True:
            remaining = (repo.utc(job["deadline_at"]) - now_utc()).total_seconds()
            if remaining <= 5:
                diag = DiagnosticDetail(
                    component="magnum_di", service="Investigation Engine", operation="investigation",
                    original_error_code="deadline_exceeded",
                    original_message=f"Investigation deadline reached after {int(_time.monotonic() - job_start)}s processing.",
                    timestamp=now_utc().isoformat(), duration_ms=int((_time.monotonic() - job_start) * 1000),
                    final_status="exhausted" if transient >= MAX_TRANSIENT_RETRIES else "failed")
                await _fail(owner, case, job, Failure(code="budget_exhausted",
                    message=HIGGINS_EXPLANATIONS["budget_exhausted"], retryable=True,
                    diagnostics=diag, retry_history=retry_history), partial=True)
                return
            turn_start = _time.monotonic()
            try:
                outcome = await asyncio.wait_for(coordinator.run_turn(owner, case, job, progress), timeout=remaining)
            except asyncio.TimeoutError:
                duration_ms = int((_time.monotonic() - turn_start) * 1000)
                diag = DiagnosticDetail(
                    component="magnum_di", service="Investigation Engine", operation="investigation",
                    original_error_code="investigation_deadline_exceeded",
                    original_message=f"Investigation turn timed out after {duration_ms}ms (deadline: {int(remaining)}s remaining).",
                    timestamp=now_utc().isoformat(), duration_ms=duration_ms,
                    final_status="failed")
                retry_history.append(RetryAttempt(attempt=transient + 1, kind="provider_retry",
                    failure_code="investigation_deadline", failure_message="Turn exceeded remaining deadline",
                    timestamp=now_utc().isoformat(), duration_ms=duration_ms, outcome="failed"))
                await _fail(owner, case, job, Failure(code="provider_unavailable",
                    message=HIGGINS_EXPLANATIONS["provider_unavailable"], retryable=True,
                    diagnostics=diag, retry_history=retry_history), partial=True)
                return
            except provider.ProviderFailure as exc:
                duration_ms = int((_time.monotonic() - turn_start) * 1000)
                diag = DiagnosticDetail(
                    component="provider_adapter", service="Gemini", operation=exc.operation or "response_generation",
                    original_error_code=exc.code,
                    http_status=exc.http_status,
                    original_message=exc.original_message,
                    exception_type=exc.exception_type,
                    timestamp=now_utc().isoformat(), duration_ms=duration_ms)
                if exc.retryable and transient < MAX_TRANSIENT_RETRIES:
                    transient += 1
                    delay = min(remaining - 5, (2 ** transient) + random.uniform(0, 1.5))
                    if delay <= 0:
                        diag.final_status = "exhausted"
                        retry_history.append(RetryAttempt(attempt=transient, kind="provider_retry",
                            failure_code=exc.code, failure_message=exc.original_message,
                            timestamp=now_utc().isoformat(), duration_ms=duration_ms, outcome="exhausted"))
                        msg = HIGGINS_EXHAUSTED.get(exc.code, HIGGINS_UNKNOWN)
                        await _fail(owner, case, job, Failure(code=exc.code, message=msg, retryable=True,
                            diagnostics=diag, retry_history=retry_history), partial=True)
                        return
                    retry_history.append(RetryAttempt(attempt=transient, kind="provider_retry",
                        failure_code=exc.code, failure_message=exc.original_message,
                        timestamp=now_utc().isoformat(), duration_ms=duration_ms, outcome="retrying"))
                    retry_at = now_utc() + timedelta(seconds=delay)
                    explanation = HIGGINS_EXPLANATIONS.get(exc.code, HIGGINS_UNKNOWN)
                    failure = Failure(code=exc.code, message=explanation, retryable=True,
                        retry_after_seconds=int(delay), diagnostics=diag, retry_history=retry_history)
                    await repo.set_job(owner, job_id, job["fence"], {"$set": {"status": "retry_wait", "retry_at": retry_at, "failure": failure.wire(),
                        "retry_history": [h.wire() if hasattr(h, 'wire') else h for h in retry_history]}})
                    await repo.cas(owner, case_id, {"epoch": job["epoch"], "work_epoch": job.get("work_epoch", job["epoch"]), "active_job_id": job_id}, {"$set": {"status": "retry_wait"}}, bump=False)
                    await _emit(owner, case, job, "retry_scheduled", {"retryAt": retry_at.isoformat(), "failure": failure.wire()})
                    await asyncio.sleep(delay)
                    if stop.is_set():
                        return
                    await repo.set_job(owner, job_id, job["fence"], {"$set": {"status": "investigating", "retry_at": None}})
                    await repo.cas(owner, case_id, {"epoch": job["epoch"], "work_epoch": job.get("work_epoch", job["epoch"]), "active_job_id": job_id}, {"$set": {"status": "investigating"}}, bump=False)
                    continue
                # Non-retryable or retries exhausted
                code = exc.code if exc.code in HIGGINS_EXHAUSTED else "provider_unavailable"
                diag.final_status = "failed"
                retry_history.append(RetryAttempt(attempt=transient + 1, kind="provider_retry",
                    failure_code=exc.code, failure_message=exc.original_message,
                    timestamp=now_utc().isoformat(), duration_ms=duration_ms, outcome="failed"))
                msg = HIGGINS_EXHAUSTED.get(code, HIGGINS_UNKNOWN)
                await _fail(owner, case, job, Failure(code=code, message=msg, retryable=exc.retryable,
                    diagnostics=diag, retry_history=retry_history), partial=True)
                return
            break
        if outcome.kind == "waiting_device":
            await repo.set_job(owner, job_id, job["fence"], {"$set": {"status": "waiting_device", "lease_until": None}})
            await repo.cas(owner, case_id, {"epoch": job["epoch"], "work_epoch": job.get("work_epoch", job["epoch"]), "active_job_id": job_id},
                           {"$set": {"status": "waiting_device"}, "$addToSet": {"pending_device_request_ids": outcome.request["id"]}}, bump=False)
            await _emit(owner, case, job, "device_request", outcome.request)
            return
        if outcome.kind == "invalid":
            diag = DiagnosticDetail(component="magnum_di", service="Investigation Engine", operation="validation",
                original_error_code="response_invalid",
                original_message="Answer failed quality checks: " + "; ".join(outcome.errors)[:400],
                timestamp=now_utc().isoformat(), final_status="failed")
            await _fail(owner, case, job, Failure(code="response_invalid",
                message=HIGGINS_EXHAUSTED["response_invalid"],
                retryable=True, diagnostics=diag, retry_history=retry_history), partial=True)
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
    except Exception as _exc:  # noqa: BLE001 — surface a typed failure with diagnostics
        logger.error("investigation_job_failed job=%s err_type=%s", job_id, type(_exc).__name__)
        duration_ms = int((_time.monotonic() - job_start) * 1000)
        diag = DiagnosticDetail(
            component="magnum_di", service="Investigation Engine", operation="investigation",
            original_error_code=type(_exc).__name__,
            original_message=provider._sanitise_diagnostic(str(_exc)) if str(_exc) else None,
            exception_type=type(_exc).__name__,
            timestamp=now_utc().isoformat(), duration_ms=duration_ms,
            final_status="failed")
        retry_history.append(RetryAttempt(attempt=transient + 1, kind="provider_retry",
            failure_code=type(_exc).__name__, failure_message=provider._sanitise_diagnostic(str(_exc)[:200]) if str(_exc) else "Unknown internal error",
            timestamp=now_utc().isoformat(), duration_ms=duration_ms, outcome="failed"))
        try:
            await _fail(owner, case, job, Failure(code="provider_unavailable",
                message=HIGGINS_UNKNOWN, retryable=True,
                diagnostics=diag, retry_history=retry_history), partial=True)
        except Exception:  # noqa: BLE001
            pass
    finally:
        stop.set()
        beat.cancel()


async def recover() -> None:
    """Startup/sweeper: relaunch jobs whose lease expired while processing, or that never started; reconcile jobs past their work deadline.
    An accepted turn is authoritative: a job whose turn was already accepted is repaired (via run()), never failed for a passed deadline.
    
    COST SAFETY: Stale mailbox-monitor jobs older than STALE_AUTO_JOB_HOURS are failed rather than relaunched
    to prevent billing-restoration backlog explosions.
    """
    from services.gemini_usage import check_automated_budget, AUTOMATED_SOURCES, TriggerSource
    STALE_AUTO_JOB_HOURS = 2  # Mailbox-monitor jobs older than this are considered stale

    now = now_utc()
    stale_cutoff = now - timedelta(hours=STALE_AUTO_JOB_HOURS)

    async for job in db.investigation_jobs.find({"status": {"$in": ["queued", "investigating", "retry_wait"]}, "deadline_at": {"$lte": now},
                                                 "$or": [{"lease_until": None}, {"lease_until": {"$lte": now}}]}, {"_id": 0}):
        case = await db.investigation_cases.find_one({"owner_id": job["owner_id"], "case_id": job["case_id"]}, {"_id": 0})
        if not case:
            continue
        if await repo.accepted_commit_for(job["owner_id"], case, job["turn_id"]):
            launch(job["owner_id"], job["case_id"], job["job_id"])  # run() repairs projections from the accepted commit
            continue
        await _fail(job["owner_id"], case, job, Failure(code="budget_exhausted", message="The work slice ended before Magnum DI finished. Retry to continue from the last completed step.", retryable=True), partial=True)
    # Device submissions interrupted after the claim (crash before storage or before resume): finish them idempotently.
    # "storing"/"resuming" are the fenced in-flight sub-states `_claim_submission_stage` uses for renewable ownership;
    # a submission stuck there past its staleness window is taken over by the same call, never left stranded.
    from routers.investigations import _finish_device_submission  # local import: router depends on this module
    async for pending in db.investigation_device_requests.find({"submission.state": {"$in": ["claimed", "storing", "stored", "resuming"]}}, {"_id": 0}):
        case = await db.investigation_cases.find_one({"owner_id": pending["owner_id"], "case_id": pending["case_id"], "deleted": False}, {"_id": 0})
        if not case:
            # Case deleted while submission was in-flight — abandon so it's not retried every sweep.
            await db.investigation_device_requests.update_one(
                {"owner_id": pending["owner_id"], "case_id": pending["case_id"], "request_id": pending["request_id"]},
                {"$set": {"submission.state": "abandoned"}})
            logger.warning("device submission recovery: case gone, abandoned request=%s", pending["request_id"])
            continue
        try:
            await _finish_device_submission(pending["owner_id"], case, pending)
        except Exception as exc:  # noqa: BLE001
            from fastapi.exceptions import HTTPException
            if isinstance(exc, HTTPException) and exc.status_code == 404:
                # Job was deleted/expired/swept — mark abandoned so the sweep stops retrying.
                await db.investigation_device_requests.update_one(
                    {"owner_id": pending["owner_id"], "case_id": pending["case_id"], "request_id": pending["request_id"]},
                    {"$set": {"submission.state": "abandoned"}})
                logger.warning("device submission recovery: job gone (404), abandoned request=%s", pending["request_id"])
            else:
                logger.exception("device submission recovery failed request=%s", pending["request_id"])

    # ── Phase 1b: Relaunch jobs with valid deadlines but expired leases ──
    # COST SAFETY: Check stale automated jobs and budget before relaunching
    async for job in db.investigation_jobs.find({"status": {"$in": ["queued", "investigating", "retry_wait"]}, "deadline_at": {"$gt": now},
                                                 "$or": [{"lease_until": None}, {"lease_until": {"$lte": now}}]}, {"_id": 0, "owner_id": 1, "case_id": 1, "job_id": 1, "source": 1, "created_at": 1}):
        job_source = job.get("source", "user_initiated")
        job_created = job.get("created_at", now)

        # Stale automated jobs: fail instead of relaunching
        if job_source in AUTOMATED_SOURCES and job_created < stale_cutoff:
            case = await db.investigation_cases.find_one({"owner_id": job["owner_id"], "case_id": job["case_id"]}, {"_id": 0})
            if case:
                await _fail(job["owner_id"], case, job, Failure(
                    code="budget_exhausted",
                    message="This automated investigation was too old to safely relaunch after a service interruption.",
                    retryable=False), partial=True)
                logger.info("stale_auto_job_expired job=%s source=%s age_hours=%.1f",
                            job["job_id"], job_source, (now - job_created).total_seconds() / 3600)
            continue

        # Budget check for automated jobs before relaunching
        if job_source in AUTOMATED_SOURCES:
            budget_ok, spent, limit = await check_automated_budget()
            if not budget_ok:
                logger.warning("auto_budget_skip_relaunch job=%s spent=$%.2f limit=$%.2f", job["job_id"], spent, limit)
                continue  # leave in current state, don't relaunch

        launch(job["owner_id"], job["case_id"], job["job_id"])

    # ── Phase 2: Auto-resume failed retryable jobs that haven't exhausted their resume allowance ──
    # Only resume jobs that: (1) are marked failed with retryable=True, (2) haven't exceeded MAX_AUTO_RESUME,
    # (3) belong to non-expired, non-deleted, non-complete cases, (4) aren't config/auth failures.
    NON_RESUMABLE_CODES = {"provider_configuration", "evidence_expired"}
    async for job in db.investigation_jobs.find(
        {"status": "failed", "failure.retryable": True,
         "auto_resume_count": {"$lt": MAX_AUTO_RESUME},
         "deadline_at": {"$gt": now}},
        {"_id": 0}
    ):
        if job.get("failure", {}).get("code") in NON_RESUMABLE_CODES:
            continue

        job_source = job.get("source", "user_initiated")
        job_created = job.get("created_at", now)

        # Stale automated jobs: skip auto-resume
        if job_source in AUTOMATED_SOURCES and job_created < stale_cutoff:
            logger.info("stale_auto_job_skip_resume job=%s source=%s", job["job_id"], job_source)
            continue

        # Budget check for automated auto-resume
        if job_source in AUTOMATED_SOURCES:
            budget_ok, spent, limit = await check_automated_budget()
            if not budget_ok:
                logger.warning("auto_budget_skip_resume job=%s spent=$%.2f limit=$%.2f", job["job_id"], spent, limit)
                continue

        case = await db.investigation_cases.find_one(
            {"owner_id": job["owner_id"], "case_id": job["case_id"], "deleted": False},
            {"_id": 0, "case_id": 1, "status": 1, "expires_at": 1, "epoch": 1})
        if not case or case["status"] in ("complete", "cancelled") or repo.utc(case["expires_at"]) <= now:
            continue
        # Extend the deadline for the resume attempt
        new_deadline = now + timedelta(seconds=WORK_SECONDS)
        # Record source as recovery_resume for resumed jobs
        resume_source = TriggerSource.RECOVERY_RESUME if job_source in AUTOMATED_SOURCES else job_source
        await db.investigation_jobs.update_one(
            {"owner_id": job["owner_id"], "job_id": job["job_id"], "status": "failed"},
            {"$set": {"status": "queued", "deadline_at": new_deadline, "lease_until": None, "failure": None, "source": resume_source},
             "$inc": {"auto_resume_count": 1}})
        # Record the resume in retry history
        existing_history = job.get("retry_history", [])
        existing_history.append(RetryAttempt(
            attempt=len(existing_history) + 1, kind="job_resume",
            failure_code=job.get("failure", {}).get("code"),
            failure_message="Automatic resume after failed attempt",
            timestamp=now.isoformat(), outcome="retrying").wire())
        await db.investigation_jobs.update_one(
            {"owner_id": job["owner_id"], "job_id": job["job_id"]},
            {"$set": {"retry_history": existing_history}})
        # Re-activate the case
        await db.investigation_cases.update_one(
            {"owner_id": job["owner_id"], "case_id": job["case_id"], "status": {"$in": ["partial", "failed"]}},
            {"$set": {"status": "queued", "active_job_id": job["job_id"]}})
        launch(job["owner_id"], job["case_id"], job["job_id"])
        logger.info("auto_resume job=%s case=%s source=%s resume_count=%d", job["job_id"], job["case_id"], resume_source, job.get("auto_resume_count", 0) + 1)


async def sweep_loop() -> None:
    while True:
        try:
            await repo.sweep()
            await repo.sweep_tombstones()
            await recover()
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            logger.error("investigation_sweep_failed")
        await asyncio.sleep(20)
