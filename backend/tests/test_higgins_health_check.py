"""Synthetic input and provider-cost protections; all provider calls are deterministic fakes."""
import json
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import BackgroundTasks, HTTPException
from starlette.requests import Request

from core.db import now_utc
from routers import health
from services import system_health_jobs
from services.higgins import health_check, provider


@pytest.mark.asyncio
async def test_missing_owner_key_never_calls_provider(monkeypatch):
    mock = AsyncMock(side_effect=AssertionError("provider must not be called"))
    monkeypatch.setattr(health_check, "GEMINI_API_KEY", None)
    monkeypatch.setattr(provider, "generate", mock)
    with pytest.raises(health_check.HealthFailure) as exc:
        await health_check.investigate()
    assert exc.value.code == "provider_not_configured"
    mock.assert_not_awaited()


@pytest.mark.asyncio
async def test_post_rejects_submitted_content_before_admitting_provider(monkeypatch):
    claim = AsyncMock(side_effect=AssertionError("body cannot reach provider job"))
    monkeypatch.setattr(system_health_jobs, "start", claim)
    request = Request({"type": "http", "method": "POST", "path": "/api/health/higgins-checks",
                       "headers": [(b"content-length", b"12")]})
    request.state.device = {"device_id": "verified-owner"}
    with pytest.raises(HTTPException) as exc:
        await health.start_check(request, BackgroundTasks(), idempotency_key="fixed-provider-key-123")
    assert exc.value.status_code == 400
    claim.assert_not_awaited()


@pytest.mark.asyncio
async def test_chunked_content_is_rejected_before_provider_admission(monkeypatch):
    async def payload():
        return {"type": "http.request", "body": b"never pass a user prompt", "more_body": False}
    claim = AsyncMock(side_effect=AssertionError("body cannot reach provider job"))
    monkeypatch.setattr(system_health_jobs, "start", claim)
    request = Request({"type": "http", "method": "POST", "path": "/api/health/higgins-checks", "headers": []}, receive=payload)
    request.state.device = {"device_id": "verified-owner"}
    with pytest.raises(HTTPException) as exc:
        await health.start_check(request, BackgroundTasks(), idempotency_key="fixed-provider-key-123")
    assert exc.value.status_code == 400
    claim.assert_not_awaited()


@pytest.mark.asyncio
async def test_authenticated_admission_is_minimal_202_and_does_not_run_provider_inline(monkeypatch):
    async def empty_body():
        return {"type": "http.request", "body": b"", "more_body": False}

    check_id = "00000000-0000-4000-8000-000000000001"
    now = now_utc()
    job = {"owner_id": "verified-owner", "check_id": check_id, "state": "queued",
           "started_at": now, "expires_at": now + timedelta(minutes=15)}
    monkeypatch.setattr(health.system_health, "readiness", AsyncMock(return_value={"status": "healthy"}))
    monkeypatch.setattr(system_health_jobs, "start", AsyncMock(return_value=(job, True)))
    request = Request({"type": "http", "method": "POST", "path": "/api/health/higgins-checks", "headers": []}, receive=empty_body)
    request.state.device = {"device_id": "verified-owner"}
    tasks = BackgroundTasks()
    response = await health.start_check(request, tasks, idempotency_key="single-provider-test-key")
    assert response.status_code == 202 and response.headers["Cache-Control"] == "no-store"
    assert set(json.loads(response.body)) == {"checkId", "state", "createdAt", "expiresAt"}
    assert len(tasks.tasks) == 1 and tasks.tasks[0].func is system_health_jobs.run


@pytest.mark.asyncio
async def test_provider_timeout_keeps_report_unattempted_and_cleans_artifacts(monkeypatch):
    now = now_utc()
    update = AsyncMock()
    artifact_delete = AsyncMock()
    monkeypatch.setattr(system_health_jobs, "db", SimpleNamespace(
        health_checks=SimpleNamespace(find_one_and_update=AsyncMock(return_value={"expires_at": now + timedelta(minutes=15)}), update_one=update),
        health_report_artifacts=SimpleNamespace(delete_many=artifact_delete, find_one=AsyncMock(return_value=None))))
    generator = AsyncMock(side_effect=TimeoutError())
    monkeypatch.setattr(health_check, "investigate", generator)
    await system_health_jobs.run("verified-owner", "check-id")
    patch = update.call_args.args[1]["$set"]
    assert patch["state"] == "failed" and patch["investigation_code"] == "provider_timeout"
    assert patch["report_code"] == "report_not_attempted" and patch["cleanup_status"] == "complete"
    generator.assert_awaited_once()
    artifact_delete.assert_awaited_once()


@pytest.mark.asyncio
async def test_cancellation_still_performs_content_free_cleanup(monkeypatch):
    now = now_utc()
    update = AsyncMock()
    artifact_delete = AsyncMock()
    monkeypatch.setattr(system_health_jobs, "db", SimpleNamespace(
        health_checks=SimpleNamespace(find_one_and_update=AsyncMock(return_value={"expires_at": now + timedelta(minutes=15)}), update_one=update),
        health_report_artifacts=SimpleNamespace(delete_many=artifact_delete, find_one=AsyncMock(return_value=None))))
    async def cancelled():
        raise __import__("asyncio").CancelledError()
    monkeypatch.setattr(health_check, "investigate", cancelled)
    with pytest.raises(__import__("asyncio").CancelledError):
        await system_health_jobs.run("verified-owner", "check-id")
    artifact_delete.assert_awaited_once()
    assert update.call_args.args[1]["$set"]["state"] == "failed"