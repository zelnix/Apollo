"""Provider-free system-health contracts. A real Gemini call is separate owner acceptance."""
import json
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from cryptography.fernet import Fernet

from core.db import now_utc
from routers import health
from services import system_health, system_health_jobs
from services.higgins import encryption, health_check, provider, report_store


def _worker(*, stale=False, cleanup="ok"):
    now = now_utc()
    return {"status": "healthy", "stale": stale, "components": {
        name: {"status": cleanup if name == "temporary_content" else "ok", "last_success_at": now}
        for name in ("temporary_content", "case_expiry_and_deletion", "job_and_device_inbox_recovery")},
        "pendingBacklog": {"investigationJobs": 0, "expiredCases": 0}}


@pytest.mark.asyncio
async def test_probe_is_small_public_and_readiness_is_not_public():
    from starlette.responses import Response
    probe = await health.probe(Response())
    assert set(probe.model_dump()) == {"schemaVersion", "status", "service", "checkedAt"}
    assert probe.status == "ok" and probe.service == "apollo-v1"
    from core.auth import PUBLIC_PATHS
    assert "/api/health" in PUBLIC_PATHS
    assert "/api/health/readiness" not in PUBLIC_PATHS
    assert "/api/health/higgins-checks" not in PUBLIC_PATHS


@pytest.mark.asyncio
async def test_readiness_maps_only_bounded_codes(monkeypatch):
    monkeypatch.setattr(system_health, "worker_status", AsyncMock(return_value=_worker()))
    monkeypatch.setattr(system_health, "cipher", lambda: object())
    monkeypatch.setattr(system_health, "GEMINI_API_KEY", "test-only-fixture")
    monkeypatch.setattr(system_health, "db", SimpleNamespace(
        devices=SimpleNamespace(find_one=AsyncMock(return_value={"device_id": "owner"})),
        investigation_reports=SimpleNamespace(find_one=AsyncMock(return_value=None)),
        investigation_jobs=SimpleNamespace(find_one=AsyncMock(return_value=None)),
        command=AsyncMock(return_value={"ok": 1})))
    report = await system_health.readiness("owner")
    assert report["status"] == "healthy"
    assert len(report["components"]) == 7
    assert "owner" not in json.dumps(report) and "backlog" not in json.dumps(report)
    assert all(set(item) == {"id", "status", "code"} for item in report["components"])

    system_health.worker_status.return_value = _worker(cleanup="failed")
    failed = await system_health.readiness("owner")
    assert failed["status"] == "unavailable"
    assert next(row for row in failed["components"] if row["id"] == "privacy_cleanup")["code"] == "component_failed"
    system_health.worker_status.return_value = _worker(stale=True)
    stale = await system_health.readiness("owner")
    assert next(row for row in stale["components"] if row["id"] == "maintenance")["status"] == "degraded"


FAKE_RESPONSE = {
    "overview": "A fictional reminder cannot confirm the condition of any real device.",
    "explanationMarkdown": "A routine reminder may mean batteries need attention, but this is not a device observation.",
    "assessment": "uncertain", "attention": "none", "attentionReason": None,
    "findings": [{"text": "The fictional reminder alone cannot establish safety.", "basis": "inference", "confidence": "low",
                  "evidenceIds": [], "sourceIds": [], "supersedesFindingIds": []}],
    "uncertainties": ["No real device has been checked."], "scope": "Synthetic practice appliance only.",
    "sourceIds": [], "remainingEvidenceIds": [],
    "actions": [{"kind": "instruction", "label": "Check the manual", "instruction": "Read the fictional appliance's instructions.",
                 "capabilityId": None, "sourceIds": [], "desiredField": None, "desiredValue": None}],
    "recommendedActionIndex": 0, "question": None, "completion": "complete",
}


@pytest.mark.asyncio
async def test_synthetic_provider_uses_one_existing_higgins_call_and_strict_validation(monkeypatch):
    fake = AsyncMock(return_value=SimpleNamespace(text=json.dumps(FAKE_RESPONSE), finish_reason="STOP"))
    monkeypatch.setattr(provider, "generate", fake)
    monkeypatch.setattr(health_check, "GEMINI_API_KEY", "test-only-fixture")
    result = await health_check.investigate()
    assert result["completion"] == "complete" and result["assessment"] == "uncertain"
    fake.assert_awaited_once()
    assert "fictional" in fake.call_args.args[1][0].parts[0].text.lower()
    for invalid in ({**FAKE_RESPONSE, "uncertainties": []},
                    {**FAKE_RESPONSE, "explanationMarkdown": "Visit https://secret.example"}):
        with pytest.raises(health_check.HealthFailure) as exc:
            health_check._validate_synthetic(invalid, provider_complete=True)
        assert exc.value.code == "invalid_provider_response"


class _Collection:
    def __init__(self):
        self.rows = []
        self.delete_one = AsyncMock(side_effect=self._delete)

    async def insert_one(self, doc):
        self.rows.append(dict(doc))
        return SimpleNamespace(inserted_id="test-id")

    async def find_one(self, query, _projection=None):
        return next((dict(row) for row in self.rows if all(
            row.get(k) == v or (isinstance(v, dict) and "$gt" in v and row.get(k) > v["$gt"])
            for k, v in query.items())), None)

    async def _delete(self, query):
        old = len(self.rows)
        self.rows = [r for r in self.rows if not all(r.get(k) == v for k, v in query.items())]
        return SimpleNamespace(deleted_count=old - len(self.rows))


@pytest.mark.asyncio
async def test_synthetic_report_uses_normal_encryption_and_is_deleted(monkeypatch, tmp_path):
    key_file = tmp_path / "report.key"
    key_file.write_bytes(Fernet.generate_key())
    key_file.chmod(0o600)
    monkeypatch.setenv("INVESTIGATION_KEY_FILE", str(key_file))
    encryption.cipher.cache_clear()
    collection = _Collection()
    monkeypatch.setattr(report_store, "db", SimpleNamespace(health_report_artifacts=collection))
    try:
        response = health_check._validate_synthetic(FAKE_RESPONSE, provider_complete=True)
        exported = await health_check.report_round_trip("owner", "check-id", response, now_utc() + timedelta(minutes=15))
        assert exported["historical"] is False and exported["reportId"] == "check-id"
        assert not collection.rows and collection.delete_one.await_count == 1
    finally:
        encryption.cipher.cache_clear()


@pytest.mark.asyncio
async def test_failed_report_read_is_cleaned_even_on_error(monkeypatch, tmp_path):
    key_file = tmp_path / "report.key"
    key_file.write_bytes(Fernet.generate_key())
    key_file.chmod(0o600)
    monkeypatch.setenv("INVESTIGATION_KEY_FILE", str(key_file))
    encryption.cipher.cache_clear()
    collection = _Collection()
    monkeypatch.setattr(report_store, "db", SimpleNamespace(health_report_artifacts=collection))
    read = report_store.read

    async def corrupt(owner, report_id, *, health_check=False):
        if collection.rows:
            collection.rows[0]["report_ciphertext"] = "corrupted"
        return await read(owner, report_id, health_check=health_check)

    monkeypatch.setattr(report_store, "read", corrupt)
    try:
        with pytest.raises(health_check.HealthFailure) as exc:
            response = health_check._validate_synthetic(FAKE_RESPONSE, provider_complete=True)
            await health_check.report_round_trip("owner", "check-id", response, now_utc() + timedelta(minutes=15))
        assert exc.value.code == "report_read_failed"
        assert collection.rows == []
    finally:
        encryption.cipher.cache_clear()


@pytest.mark.asyncio
async def test_recent_success_reuses_provider_free_result(monkeypatch):
    now = now_utc()
    existing = {"owner_id": "owner", "key_digest": "private", "check_id": "uuid", "state": "completed",
                "started_at": now, "checked_at": now, "expires_at": now + timedelta(minutes=10),
                "investigation_status": "healthy", "report_status": "healthy", "cleanup_status": "complete"}
    insert = AsyncMock(side_effect=AssertionError("must not create a second provider job"))
    monkeypatch.setattr(system_health_jobs, "db", SimpleNamespace(health_checks=SimpleNamespace(find_one=AsyncMock(return_value=existing), insert_one=insert)))
    first, created = await system_health_jobs.start("owner", "single-idempotency-key")
    assert first["check_id"] == "uuid" and not created
    assert system_health_jobs.public(first, cached=True)["cached"] is True
    insert.assert_not_awaited()


def test_higgins_admission_and_terminal_response_match_documented_shape():
    now = now_utc()
    job = {"check_id": "00000000-0000-4000-8000-000000000001", "state": "queued", "started_at": now,
           "expires_at": now + timedelta(minutes=15), "checked_at": None,
           "investigation_status": "pending", "report_status": "pending", "cleanup_status": "pending"}
    accepted = system_health_jobs.admitted(job)
    assert set(accepted) == {"checkId", "state", "createdAt", "expiresAt"}
    assert accepted["state"] == "queued"
    job.update(state="completed", checked_at=now, investigation_status="healthy",
               report_status="healthy", cleanup_status="complete")
    terminal = system_health_jobs.public(job)
    assert terminal["schemaVersion"] == 1
    assert terminal["cleanup"] == {"status": "complete"}
    assert "cleanupStatus" not in terminal["report"]
    assert terminal["createdAt"] == accepted["createdAt"]
    assert terminal["expiresAt"] == accepted["expiresAt"]


@pytest.mark.asyncio
async def test_active_claim_reuses_one_owner_job_across_different_keys(monkeypatch):
    from pymongo.errors import DuplicateKeyError
    now = now_utc()
    running = {"owner_id": "owner", "check_id": "running-id", "state": "running",
               "started_at": now, "expires_at": now + timedelta(minutes=15)}
    find_one = AsyncMock(side_effect=[None, running])
    claim = SimpleNamespace(find_one_and_update=AsyncMock(side_effect=DuplicateKeyError("active")),
                            find_one=AsyncMock(return_value={"check_id": "running-id", "expires_at": now + timedelta(minutes=15)}))
    monkeypatch.setattr(system_health_jobs, "db", SimpleNamespace(
        health_checks=SimpleNamespace(find_one=find_one, insert_one=AsyncMock(side_effect=AssertionError("duplicate job"))),
        health_check_claims=claim))
    first, new = await system_health_jobs.start("owner", "a-different-idempotency-key")
    assert not new and first["check_id"] == "running-id"
    claim.find_one_and_update.assert_awaited_once()


@pytest.mark.asyncio
async def test_job_poll_is_strictly_owner_scoped(monkeypatch):
    find_one = AsyncMock(return_value=None)
    monkeypatch.setattr(system_health_jobs, "db", SimpleNamespace(health_checks=SimpleNamespace(find_one=find_one)))
    assert await system_health_jobs.get("different-owner", "other-check") is None
    query = find_one.call_args.args[0]
    assert query["owner_id"] == "different-owner" and query["check_id"] == "other-check"
    assert "_id" not in system_health_jobs.public({"_id": "secret", "check_id": "safe", "state": "queued"})


@pytest.mark.asyncio
async def test_normal_and_disposable_reports_share_one_encrypted_store_with_explicit_db(monkeypatch, tmp_path):
    key_file = tmp_path / "report.key"
    key_file.write_bytes(Fernet.generate_key())
    key_file.chmod(0o600)
    monkeypatch.setenv("INVESTIGATION_KEY_FILE", str(key_file))
    encryption.cipher.cache_clear()
    normal = _Collection()
    external = SimpleNamespace(investigation_reports=normal)
    default = _Collection()
    monkeypatch.setattr(report_store, "db", SimpleNamespace(investigation_reports=default))
    try:
        report = health_check.fixture("normal-test")
        await report_store.write("owner", report, database=external)
        assert not default.rows and len(normal.rows) == 1
        assert "Synthetic health" not in normal.rows[0]["report_ciphertext"]
        assert (await report_store.read("owner", report["reportId"], database=external))["overview"] == report["overview"]
        assert await report_store.read("another-owner", report["reportId"], database=external) is None
        assert await report_store.delete("owner", report["reportId"], database=external)
        assert not normal.rows
    finally:
        encryption.cipher.cache_clear()