"""The DI tab must show the preview simulator's transaction in a preview deployment, and must never
show a simulated transaction in production.

Run: cd /app/backend && python -m pytest tests/test_di_simulated_visibility.py -q
"""
from __future__ import annotations

import pytest
from starlette.requests import Request

from routers import investigations
from services.higgins import provider


def _request(device_id: str) -> Request:
    request = Request({"type": "http", "method": "GET", "path": "/", "headers": []})
    request.state.device = {"device_id": device_id}
    return request


@pytest.fixture
def case(monkeypatch):
    """One case owned by a device, with one simulated DI transaction recorded against it."""
    owner, case_id = "owner-di-visibility", "case-vis-1"

    class _Cases:
        async def find_one(self, *_args, **_kwargs):
            return {"_id": 1}

    monkeypatch.setattr(investigations.db, "investigation_cases", _Cases(), raising=False)

    async def _records(_owner, _case_id):
        return [{"investigationId": _case_id, "simulated": True, "mode": "Simulated",
                 "environment": "Preview", "notice": "SIMULATED — No Gemini API call was made"}]

    monkeypatch.setattr("services.higgins.di_record.get_di_records", _records)
    return owner, case_id


async def _transactions(owner: str, case_id: str) -> list[dict]:
    import json
    response = await investigations.get_di_transactions(case_id, _request(owner))
    return json.loads(bytes(response.body))["transactions"]


@pytest.mark.anyio
async def test_preview_deployment_shows_the_simulated_transaction(case, monkeypatch):
    monkeypatch.setattr(provider, "_preview_generate", lambda *a, **k: None)
    assert provider.get_provider_mode() == "preview"
    records = await _transactions(*case)
    assert len(records) == 1 and records[0]["simulated"] is True


@pytest.mark.anyio
async def test_production_withholds_a_simulated_transaction(case, monkeypatch):
    monkeypatch.setattr(provider, "_preview_generate", None)
    assert provider.get_provider_mode() == "live"
    assert await _transactions(*case) == []
