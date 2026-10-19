"""Disposable report store shape, TTL and normal-report isolation contracts."""
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from services.higgins import health_check, report_store


@pytest.mark.asyncio
async def test_temporary_collection_has_owner_uniqueness_and_ttl(monkeypatch):
    create_index = AsyncMock()
    monkeypatch.setattr(report_store, "db", SimpleNamespace(health_report_artifacts=SimpleNamespace(create_index=create_index)))
    await report_store.ensure_indexes()
    assert any(call.kwargs.get("expireAfterSeconds") == 0 for call in create_index.call_args_list)
    assert any(call.kwargs.get("unique") is True for call in create_index.call_args_list)


def test_render_fixture_is_disposable_normal_report_shape():
    report = health_check.fixture("test-check-id")
    validated = report_store.SavedReport.model_validate(report)
    assert validated.reportId == "test-check-id"
    assert validated.historical is False
    assert validated.findings == [] and validated.sources == []
    assert "synthetic" in validated.retentionNotice.lower()
    assert "provider" not in str(report).lower()