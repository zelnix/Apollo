"""Durable job execution: leases, fencing, events, retry classification, cancellation and recovery (spec §5, §12).

Work starts after a 202 and runs in-process; a crashed or restarted server recovers abandoned jobs once their lease expires.

RETRY POLICY (one investigation = one Gemini call): when the call fails in a way another try could
fix, Magnum DI tries exactly once more after a short pause. If that fails too, the investigation
stops and the person is asked to resubmit in about five minutes — the case keeps everything they
submitted, so resubmitting is one tap. There is no automatic resume: only the person resubmits.
"""
from __future__ import annotations

import asyncio
import random
import time as _time
from datetime import timedelta
from typing import Optional

from core.config import logger
from core.db import db, now_utc
from core.redaction import redact_investigation_secrets
from services.higgins import coordinator, provider
from services.higgins import repository as repo
from services.higgins.evidence import EVIDENCE_WORD_LIMIT
from services.higgins.contracts import DiagnosticDetail, Failure, RetryAttempt

RETRY_DELAY_SECONDS = 4          # pause before the one retry
RESUBMIT_AFTER_SECONDS = 300     # after both attempts: "please resubmit in about 5 minutes"
_tasks: set[asyncio.Task] = set()

# Shown while the one retry is pending, keyed by failure code.
HIGGINS_RETRYING: dict[str, str] = {
    "rate_limited": "The analysis service is busy right now, so Magnum DI is trying once more in a few seconds. You don't need to do anything.",
    "provider_unavailable": "The analysis service didn't answer in time, so Magnum DI is trying once more in a few seconds. You don't need to do anything.",
    "response_invalid": "Magnum DI's answer didn't pass Apollo's checks, so it wasn't used. Magnum DI is trying once more in a few seconds.",
}
HIGGINS_RETRYING_DEFAULT = "Magnum DI hit a temporary problem and is trying once more in a few seconds."

# Why the investigation stopped, for the resubmit message.
_RESUBMIT_REASONS: dict[str, str] = {
    "rate_limited": "the analysis service was too busy to answer",
    "provider_unavailable": "the analysis service didn't answer in time",
    "incomplete_output": "the answer stopped before it was complete",
    "response_invalid": "the answer didn't pass Apollo's checks (Gemini's actual reply is kept in the technical details)",
    "budget_exhausted": "the investigation ran out of time before it could finish",
    "transport_interrupted": "the connection dropped before the answer arrived",
    "call_limit": "both of its attempts were already used",
}

PROVIDER_CONFIGURATION_MESSAGE = ("Magnum DI couldn't access one of its analysis services because it isn't configured correctly. "
                                  "This needs a technical fix rather than another attempt.")


def resubmit_message(reason: str, calls_made: int) -> str:
    """Higgins says plainly why the investigation stopped and when to resubmit. Nothing is substituted."""
    why = _RESUBMIT_REASONS.get(reason, "something interrupted the investigation")
    opening = f"Magnum DI tried twice, but {why}" if calls_made >= coordinator.MAX_GEMINI_CALLS else f"Magnum DI stopped because {why}"
    return (f"{opening}. No conclusion has been made up in its place. Please resubmit in about "
            f"{RESUBMIT_AFTER_SECONDS // 60} minutes — everything you submitted is kept, so it's one tap.")


def evidence_too_large_message(words: int) -> str:
    """Higgins explains the size limit plainly, and points to the person's own AI assistant.
    No evidence was sent, shortened or left out quietly — nothing was investigated."""
    return (
        f"There is too much written material in this case for Apollo's standard investigation — about {words:,} words, "
        f"and ApolloSG's limit is {EVIDENCE_WORD_LIMIT:,} words for one investigation. "
        "I haven't sent any of it to be investigated, and nothing has been shortened or left out behind your back. "
        "For documents this long, open them in your own AI assistant — such as Gemini, Claude or Copilot on your "
        "device — where you can work through the whole document yourself. "
        "If you'd like Apollo to investigate, remove some of the material from this case and run the check again."
    )


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
    from routers.push import send_push, PUSH_GROWL
    case_id = case.get("case_id", "")
    await send_push(
        recipients=[owner],
        data={
            "title": "ApolloSG: message assessed",
            "message": "ApolloSG completed a background assessment of a captured message. Open ApolloSG to review.",
            "action_url": f"/patrol/{case_id}?focus=alert" if case_id else "/patrol",
            **PUSH_GROWL,
        },
        owner_id=owner,
        idempotency_key=f"bg-completion-{case_id}" if case_id else None,
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
        "$set": {"status": "failed", "failure": failure.wire(), "lease_until": None, "resubmit_at": failure.resubmit_at,
                 "retry_history": [h.wire() if hasattr(h, 'wire') else h for h in failure.retry_history]}})
    if await repo.cas(owner, case["case_id"], {"epoch": job["epoch"], "work_epoch": job.get("work_epoch", job["epoch"]), "active_job_id": job["job_id"], **({"lease_fence": job["fence"]} if job.get("fence") else {})},
                      {"$set": {"status": "partial" if partial or case.get("response_ciphertext") else "failed", "active_job_id": None, "active_turn_id": None, "lease_fence": None}}, bump=False):
        await repo.start_deletion_clock(owner, case["case_id"])  # a failed check has finished too: its 24 hours start now
    if partial:
        await _emit(owner, case, job, "partial", {"responseRevision": case.get("response_revision"), "reason": failure.wire(), "canContinue": failure.retryable or failure.code != "provider_configuration"})
    await _emit(owner, case, job, "failed", failure.wire())


async def _fail_resubmit(owner: str, case: dict, job: dict, code: str, diag: Optional[DiagnosticDetail],
                         history: list[RetryAttempt], *, reason: Optional[str] = None) -> None:
    """Stop the investigation and ask the person to resubmit in about five minutes. The case keeps
    every evidence item, so resubmitting (the resume endpoint) sends the same material again."""
    calls = await repo.gemini_calls_made(owner, job["job_id"])
    if diag:
        diag.final_status = "exhausted" if calls >= coordinator.MAX_GEMINI_CALLS else "failed"
    await _fail(owner, case, job, Failure(code=code, message=resubmit_message(reason or code, calls), retryable=True,
                                          retry_after_seconds=RESUBMIT_AFTER_SECONDS,
                                          resubmit_at=now_utc() + timedelta(seconds=RESUBMIT_AFTER_SECONDS),
                                          diagnostics=diag, retry_history=history), partial=True)


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
    # This run's own retry history; _fail() prepends what the job document already recorded.
    retry_history: list[RetryAttempt] = []
    job_start = _time.monotonic()

    async def retry_once(code: str, message: Optional[str], duration_ms: Optional[int], remaining: float) -> bool:
        """The single retry: only while this investigation has used fewer than MAX_GEMINI_CALLS."""
        if await repo.gemini_calls_made(owner, job_id) >= coordinator.MAX_GEMINI_CALLS:
            return False
        delay = min(remaining - 5, RETRY_DELAY_SECONDS + random.uniform(0, 1.5))
        if delay <= 0:
            return False
        retry_history.append(RetryAttempt(attempt=len(retry_history) + 1, kind="provider_retry", failure_code=code,
                                          failure_message=message, timestamp=now_utc().isoformat(), duration_ms=duration_ms, outcome="retrying"))
        retry_at = now_utc() + timedelta(seconds=delay)
        failure = Failure(code=code, message=HIGGINS_RETRYING.get(code, HIGGINS_RETRYING_DEFAULT), retryable=True,
                          retry_after_seconds=max(1, int(delay)), retry_history=retry_history)
        history = [*job.get("retry_history", []), *(h.wire() for h in retry_history)]
        await repo.set_job(owner, job_id, job["fence"], {"$set": {"status": "retry_wait", "retry_at": retry_at, "failure": failure.wire(), "retry_history": history}})
        await repo.cas(owner, case_id, {"epoch": job["epoch"], "work_epoch": job.get("work_epoch", job["epoch"]), "active_job_id": job_id}, {"$set": {"status": "retry_wait"}}, bump=False)
        await _emit(owner, case, job, "retry_scheduled", {"retryAt": retry_at.isoformat(), "failure": failure.wire()})
        await asyncio.sleep(delay)
        if stop.is_set():
            raise asyncio.CancelledError()
        await repo.set_job(owner, job_id, job["fence"], {"$set": {"status": "investigating", "retry_at": None}})
        await repo.cas(owner, case_id, {"epoch": job["epoch"], "work_epoch": job.get("work_epoch", job["epoch"]), "active_job_id": job_id}, {"$set": {"status": "investigating"}}, bump=False)
        return True

    try:
        while True:
            remaining = (repo.utc(job["deadline_at"]) - now_utc()).total_seconds()
            if remaining <= 5:
                diag = DiagnosticDetail(
                    component="magnum_di", service="Investigation Engine", operation="investigation",
                    original_error_code="deadline_exceeded",
                    original_message=f"Investigation deadline reached after {int(_time.monotonic() - job_start)}s processing.",
                    timestamp=now_utc().isoformat(), duration_ms=int((_time.monotonic() - job_start) * 1000))
                await _fail_resubmit(owner, case, job, "budget_exhausted", diag, retry_history)
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
                    timestamp=now_utc().isoformat(), duration_ms=duration_ms)
                retry_history.append(RetryAttempt(attempt=len(retry_history) + 1, kind="provider_retry",
                    failure_code="investigation_deadline", failure_message="Turn exceeded remaining deadline",
                    timestamp=now_utc().isoformat(), duration_ms=duration_ms, outcome="failed"))
                await _fail_resubmit(owner, case, job, "provider_unavailable", diag, retry_history)
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
                if exc.code == "provider_configuration":
                    # Another attempt cannot help until the configuration is fixed.
                    diag.final_status = "failed"
                    retry_history.append(RetryAttempt(attempt=len(retry_history) + 1, kind="provider_retry", failure_code=exc.code,
                        failure_message=exc.original_message, timestamp=now_utc().isoformat(), duration_ms=duration_ms, outcome="failed"))
                    await _fail(owner, case, job, Failure(code="provider_configuration", message=PROVIDER_CONFIGURATION_MESSAGE,
                        retryable=False, diagnostics=diag, retry_history=retry_history), partial=True)
                    return
                if exc.retryable and await retry_once(exc.code, exc.original_message, duration_ms, remaining):
                    continue
                retry_history.append(RetryAttempt(attempt=len(retry_history) + 1, kind="provider_retry", failure_code=exc.code,
                    failure_message=exc.original_message, timestamp=now_utc().isoformat(), duration_ms=duration_ms, outcome="failed"))
                code = exc.code if exc.code in _RESUBMIT_REASONS else "provider_unavailable"
                await _fail_resubmit(owner, case, job, code, diag, retry_history)
                return
            if outcome.kind == "invalid" and await retry_once("response_invalid", "; ".join(outcome.errors)[:200] or None,
                                                              int((_time.monotonic() - turn_start) * 1000), remaining):
                continue
            break
        if outcome.kind == "call_limit_reached":
            # Both Gemini attempts were already used (e.g. a recovered job): nothing more is sent.
            diag = DiagnosticDetail(component="magnum_di", service="ApolloSG", operation="gemini_call_limit",
                original_error_code="call_limit_reached", original_message="; ".join(outcome.errors)[:400],
                timestamp=now_utc().isoformat())
            await _fail_resubmit(owner, case, job, "provider_unavailable", diag, retry_history, reason="call_limit")
            return
        if outcome.kind == "waiting_device":
            await repo.set_job(owner, job_id, job["fence"], {"$set": {"status": "waiting_device", "lease_until": None}})
            await repo.cas(owner, case_id, {"epoch": job["epoch"], "work_epoch": job.get("work_epoch", job["epoch"]), "active_job_id": job_id},
                           {"$set": {"status": "waiting_device"}, "$addToSet": {"pending_device_request_ids": outcome.request["id"]}}, bump=False)
            await _emit(owner, case, job, "device_request", outcome.request)
            return
        if outcome.kind == "invalid":
            # The provider replied, but the reply failed Apollo's validation. Nothing is substituted:
            # the real reply is carried verbatim (redacted, truncated) into the technical details so
            # Support/DI can see exactly what Gemini returned.
            raw = (outcome.provider_text or "").strip()
            provider_response = provider._sanitise_diagnostic(redact_investigation_secrets(raw))[:4000] if raw else None
            diag = DiagnosticDetail(component="magnum_di", service="Gemini", operation="validation",
                original_error_code="response_invalid",
                original_message="Answer failed Apollo's validation: " + "; ".join(outcome.errors)[:400],
                provider_response=provider_response,
                provider_model=outcome.model,
                provider_finish_reason=outcome.finish_reason,
                timestamp=now_utc().isoformat())
            retry_history.append(RetryAttempt(attempt=len(retry_history) + 1, kind="provider_retry", failure_code="response_invalid",
                failure_message="; ".join(outcome.errors)[:200] or None, timestamp=now_utc().isoformat(), outcome="failed"))
            await _fail_resubmit(owner, case, job, "response_invalid", diag, retry_history)
            return
        if outcome.kind == "evidence_too_large":
            # Deliberate stop before any Gemini call: the evidence exceeds Apollo's word limit.
            words = outcome.evidence_words or 0
            diag = DiagnosticDetail(component="magnum_di", service="ApolloSG", operation="evidence_size_check",
                original_error_code="evidence_too_large",
                original_message="; ".join(outcome.errors)[:400],
                timestamp=now_utc().isoformat(), final_status="failed")
            await _fail(owner, case, job, Failure(code="evidence_too_large",
                message=evidence_too_large_message(words),
                retryable=False, diagnostics=diag, retry_history=retry_history), partial=False)
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
            timestamp=now_utc().isoformat(), duration_ms=duration_ms)
        retry_history.append(RetryAttempt(attempt=len(retry_history) + 1, kind="provider_retry",
            failure_code=type(_exc).__name__, failure_message=provider._sanitise_diagnostic(str(_exc)[:200]) if str(_exc) else "Unknown internal error",
            timestamp=now_utc().isoformat(), duration_ms=duration_ms, outcome="failed"))
        try:
            await _fail_resubmit(owner, case, job, "provider_unavailable", diag, retry_history, reason="unknown")
        except Exception:  # noqa: BLE001
            pass
    finally:
        stop.set()
        beat.cancel()


async def recover() -> None:
    """Startup/sweeper: relaunch jobs whose lease expired while processing, or that never started; reconcile jobs past their work deadline.
    An accepted turn is authoritative: a job whose turn was already accepted is repaired (via run()), never failed for a passed deadline.
    
    COST SAFETY: Stale mailbox-monitor jobs older than STALE_AUTO_JOB_HOURS are failed rather than relaunched
    to prevent billing-restoration backlog explosions. A failed job is never resumed automatically — only the
    person resubmits — and a relaunched job can only use the Gemini call slots it has left.
    """
    from services.gemini_usage import check_automated_budget, AUTOMATED_SOURCES
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
        await _fail_resubmit(job["owner_id"], case, job, "budget_exhausted", None, [])
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
