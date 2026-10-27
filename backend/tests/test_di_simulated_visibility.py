"""A simulated answer is always visible as simulated — in every environment, never withheld.

Production once ran on the preview simulator unnoticed because the DI endpoint dropped simulated
records outside preview mode and the answer itself was stored as a Gemini one. Now:
  - the DI endpoint returns every record, a simulated one carrying its SIMULATED notice;
  - the simulator's result is marked `simulated`, and so is the turn's provider record.

Run: cd /app/backend && python -m pytest tests/test_di_simulated_visibility.py -q
"""
from __future__ import annotations

import json

import pytest
from starlette.requests import Request

from routers import investigations
from services.higgins import provider
from services.higgins.contracts import ProviderResult
from services.higgins.llm_boundary import Purpose
from services.higgins.preview.preview_simulator import simulate_generate


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
                 "environment": "Preview", "notice": "SIMULATED — No AI call was made"}]

    monkeypatch.setattr("services.higgins.di_record.get_di_records", _records)
    return owner, case_id


async def _transactions(owner: str, case_id: str) -> list[dict]:
    response = await investigations.get_di_transactions(case_id, _request(owner))
    return json.loads(bytes(response.body))["transactions"]


@pytest.mark.anyio
@pytest.mark.parametrize("handler", [lambda *a, **k: None, None], ids=["preview", "production"])
async def test_a_simulated_transaction_is_returned_labelled_in_every_environment(case, monkeypatch, handler):
    monkeypatch.setattr(provider, "_preview_generate", handler)
    records = await _transactions(*case)
    assert len(records) == 1
    assert records[0]["simulated"] is True
    assert records[0]["notice"].startswith("SIMULATED")


@pytest.mark.anyio
async def test_the_simulator_marks_its_own_result_as_simulated(monkeypatch):
    async def _no_usage(**_kwargs):
        return None

    monkeypatch.setattr("services.higgins.preview.preview_simulator._record_usage", _no_usage)
    result = await simulate_generate("", "Is this message genuine?", model="gemini-3.1-flash-lite", provider="gemini", capability="text",
                                     json_output=True, web_search=False, timeout=10, response_schema=None,
                                     purpose=Purpose.INVESTIGATION, correlation_id=None, trigger_source=None,
                                     payload_audit={})
    assert result.simulated is True
    assert result.metadata["simulated"] is True and result.metadata["provider"] != "Gemini"


def test_a_turn_records_whether_the_simulator_answered():
    base = {"model": "gemini-3.1-flash-lite", "finish_reason": "STOP", "provider_complete": True}
    assert ProviderResult(**base).wire()["simulated"] is False
    assert ProviderResult(**base, simulated=True).wire()["simulated"] is True
