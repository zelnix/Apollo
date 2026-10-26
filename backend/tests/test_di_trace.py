"""The DI tab's decision path and Magnum DI record: recorded data only, Magnum DI named, never the provider or model.

Run: cd /app/backend && python -m pytest tests/test_di_trace.py -q
"""
from __future__ import annotations

import re
from datetime import datetime, timezone

import pytest

from services.higgins import di_record
from services.record_classification import generate_higgins_briefing
from services.triage.catalogue import LIMITED_CAUTION, plain_codes
from services.triage.contract import Outcome
from services.triage.engine import evaluate

AT = datetime(2026, 6, 10, 9, 0, tzinfo=timezone.utc)


class _One:
    def __init__(self, doc):
        self.doc = doc

    async def find_one(self, *_args, **_kwargs):
        return self.doc


def _routing(resolved: bool) -> dict:
    teddy = {"ranAt": AT, "answeredBy": "teddy_official" if resolved else "magnum_di", "resolved": resolved,
             "outcome": "concerning" if resolved else None, "basis": "impersonation" if resolved else None, "messageType": "sms",
             "pattern": None, "checks": [{"kind": "claim", "status": "checked", "route": "google_search"}],
             "searchCalls": 1, "searchQueries": 2, "cacheHits": 0, "teddyTokens": {"input": 5}, "simulated": False,
             "searchModel": "gemini-3.1-flash-lite", "magnumNeeded": not resolved, "magnumSearch": False, "reusedOnRetry": 0,
             "gaps": [], "issues": [] if resolved else [{"capability": "reasoning", "text": "Weigh the request."}]}
    routing = {"teddy": teddy, "answeredBy": teddy["answeredBy"], "outcome": "concerning", "completion": "complete",
               "fidelity": {"status": "PASS", "mode": "plain", "attempts": 1, "attemptFailures": [], "at": AT}}
    if not resolved:
        routing["magnum"] = {"search": True, "searchQueries": 3, "itemsSent": 4, "inputTokens": 10, "outputTokens": 5, "simulated": False, "at": AT}
    return routing


@pytest.fixture
def cases(monkeypatch):
    def setup(routing: dict, triage: dict | None = None):
        monkeypatch.setattr(di_record.db, "investigation_cases", _One({"routing": routing}), raising=False)
        monkeypatch.setattr(di_record.db, "triage_investigations", _One({"record": triage} if triage else None), raising=False)
    return setup


@pytest.mark.anyio
async def test_a_flyby_settled_case_records_every_stage_without_the_model(cases):
    triage = evaluate({"source_type": "message"}, investigation_id="tri-1").wire()
    cases(_routing(resolved=True), triage)
    trace = await di_record.decision_trace("owner-1", "case-1")
    assert trace["triage"]["investigationId"] == "tri-1"
    assert trace["flyby"]["resolved"] is True and trace["flyby"]["ranAt"] == AT.isoformat()
    assert trace["flyby"]["checks"][0]["route"] == "web_search"
    assert "searchModel" not in trace["flyby"] and "teddyTokens" not in trace["flyby"]
    assert trace["magnum"] is None
    assert trace["settledReason"]["by"] == "TC FlyBy"
    assert trace["higgins"] == {"status": "PASS", "mode": "plain", "attempts": 1}
    shown = repr(trace).lower().replace("'geminicalls'", "")  # a field name on the Triage record, never displayed
    assert "gemini" not in shown and "google" not in shown


@pytest.mark.anyio
async def test_an_escalated_case_records_why_and_what_magnum_di_was_given(cases):
    cases(_routing(resolved=False))
    trace = await di_record.decision_trace("owner-1", "case-1")
    assert trace["triage"] is None
    assert trace["flyby"]["issues"] == [{"capability": "reasoning", "text": "Weigh the request."}]
    assert trace["magnum"] == {"webSearch": True, "searchQueries": 3, "itemsSent": 4, "simulated": False, "at": AT.isoformat()}
    assert trace["settledReason"]["by"] == "Magnum DI"


def test_the_di_record_never_carries_the_model_or_provider_tool_name():
    wired = di_record.wire({"correlation_id": "case-1", "model_requested": "gemini-3.1-flash-lite", "simulated": True,
                            "request": {"tools": ["google_search"], "investigationPrompt": "x"}, "created_at": AT})
    assert "modelRequested" not in wired
    assert wired["request"]["tools"] == ["web_search"]
    assert wired["notice"] == "SIMULATED — the preview simulator answered; Magnum DI was not engaged"
    assert "gemini" not in repr(wired).lower() and "AI call" not in repr(wired)


def test_a_limited_triage_is_plain_english_and_never_nothing_to_worry_about():
    investigation = evaluate({"source_type": "message", "unresolved_concern": True})
    assert investigation.outcome is Outcome.LIMITED
    assert not re.search(r"\b[A-Z]+_[A-Z]+", investigation.reason)
    record = {"category": "message", "raw_state": "ears_up", "headline": "Triage: limited — ApolloSG couldn't reach a reliable decision",
              "summary": "ApolloSG couldn't obtain enough evidence to decide: EMAIL_HEADERS_UNAVAILABLE",
              "event": {"why": ["Coverage gap: EMAIL_HEADERS_UNAVAILABLE"], "triage_investigation": investigation.wire()}}
    briefing = generate_higgins_briefing(record, "informational")
    assert briefing["meaning"] == LIMITED_CAUTION
    assert "EMAIL_HEADERS_UNAVAILABLE" not in repr(briefing)
    assert briefing["evidence_points"] == ["Couldn't check: The technical sender information wasn't available."]
    assert "nothing to worry" not in repr(briefing).lower()


def test_plain_codes_translates_lists_of_gap_codes():
    assert plain_codes("Coverage gap: EMAIL_HEADERS_UNAVAILABLE, BROWSER_VISIBILITY_UNAVAILABLE") == (
        "Couldn't check: The technical sender information wasn't available. Apollo can't see inside the browser session on this device.")
    assert plain_codes("Nothing coded here.") == "Nothing coded here."
