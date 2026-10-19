"""P0 liveness and authenticated, bounded readiness without external provider calls."""
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from starlette.requests import Request
from starlette.responses import Response

from server import typed_failure_handler
from core.db import now_utc
from routers import health
from services import system_health


@pytest.mark.asyncio
async def test_public_liveness_does_not_touch_database(monkeypatch):
    monkeypatch.setattr(system_health, "db", SimpleNamespace(command=AsyncMock(side_effect=AssertionError("not for liveness"))))
    response = Response()
    result = await health.probe(response)
    assert result.schemaVersion == 1 and result.status == "ok" and result.service == "apollo-v1"
    assert response.headers["Cache-Control"] == "no-store"
    system_health.db.command.assert_not_awaited()


def test_readiness_requires_verified_owner_in_request_state():
    request = SimpleNamespace(state=SimpleNamespace(device=None))
    with pytest.raises(HTTPException) as exc:
        health._owner(request)
    assert exc.value.status_code == 401
    request.state.device = {"device_id": "verified"}
    assert health._owner(request) == "verified"


@pytest.mark.asyncio
async def test_malformed_health_check_id_fails_without_database_access():
    request = Request({"type": "http", "method": "GET", "path": "/api/health/higgins-checks/not-an-id", "headers": []})
    request.state.device = {"device_id": "verified"}
    with pytest.raises(HTTPException) as exc:
        await health.check_status(request, "not-an-id")
    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_unauthorised_detailed_health_response_is_not_cacheable():
    request = Request({"type": "http", "method": "GET", "path": "/api/health/readiness", "headers": []})
    response = await typed_failure_handler(request, HTTPException(status_code=401, detail="Unauthorized"))
    assert response.status_code == 401
    assert response.headers["Cache-Control"] == "no-store"


@pytest.mark.asyncio
async def test_stuck_investigation_and_cleanup_backlog_are_independent(monkeypatch):
    now = now_utc()
    worker = {"status": "healthy", "stale": False, "components": {
        name: {"status": "ok", "last_success_at": now}
        for name in ("temporary_content", "case_expiry_and_deletion", "job_and_device_inbox_recovery")},
        "pendingBacklog": {"expiredCases": 2, "investigationJobs": 4}}
    monkeypatch.setattr(system_health, "worker_status", AsyncMock(return_value=worker))
    monkeypatch.setattr(system_health, "GEMINI_API_KEY", "test-only-fixture")
    monkeypatch.setattr(system_health, "cipher", lambda: object())
    monkeypatch.setattr(system_health, "db", SimpleNamespace(
        devices=SimpleNamespace(find_one=AsyncMock(return_value={"device_id": "verified"})),
        investigation_reports=SimpleNamespace(find_one=AsyncMock(return_value=None)),
        investigation_jobs=SimpleNamespace(find_one=AsyncMock(return_value={"created_at": now - timedelta(minutes=5)})),
        command=AsyncMock(return_value={"ok": 1})))
    report = await system_health.readiness("verified")
    components = {item["id"]: item for item in report["components"]}
    assert report["status"] == "degraded"
    assert components["investigation_queue"] == {"id": "investigation_queue", "status": "degraded", "code": "queue_stuck"}
    assert components["privacy_cleanup"] == {"id": "privacy_cleanup", "status": "degraded", "code": "cleanup_lagging"}
    assert "verified" not in str(report) and "created_at" not in str(report)


@pytest.mark.asyncio
async def test_missing_provider_and_required_privacy_failure_cannot_report_healthy(monkeypatch):
    now = now_utc()
    worker = {"status": "healthy", "stale": False, "components": {
        "temporary_content": {"status": "failed", "last_success_at": now},
        "case_expiry_and_deletion": {"status": "ok", "last_success_at": now},
        "job_and_device_inbox_recovery": {"status": "ok", "last_success_at": now}},
        "pendingBacklog": {"expiredCases": 0}}
    monkeypatch.setattr(system_health, "worker_status", AsyncMock(return_value=worker))
    monkeypatch.setattr(system_health, "GEMINI_API_KEY", None)
    monkeypatch.setattr(system_health, "cipher", lambda: object())
    monkeypatch.setattr(system_health, "db", SimpleNamespace(
        devices=SimpleNamespace(find_one=AsyncMock(return_value={"device_id": "verified"})),
        investigation_reports=SimpleNamespace(find_one=AsyncMock(return_value=None)),
        investigation_jobs=SimpleNamespace(find_one=AsyncMock(return_value=None)),
        command=AsyncMock(return_value={"ok": 1})))
    report = await system_health.readiness("verified")
    components = {item["id"]: item for item in report["components"]}
    assert report["status"] == "unavailable"
    assert components["privacy_cleanup"]["code"] == "component_failed"
    assert components["higgins_configuration"]["code"] == "provider_not_configured"