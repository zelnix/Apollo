"""One input → one Threat Case, and "Limited by cause" telemetry.

Run: cd /app/backend && python -m pytest tests/test_case_identity_and_limited_causes.py -q
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from core.db import db
from core.models import PatrolEventIn
from services import patrol_records
from services.triage import evaluate, telemetry

AT = datetime(2026, 6, 10, 9, 0, tzinfo=timezone.utc)


def _event(owner: str, event_id: str, **extra) -> PatrolEventIn:
    return PatrolEventIn.model_validate({
        "event_id": event_id, "device_id": owner, "category": "link", "state": "growling", "status": "active",
        "headline": "Apollo flagged a website link for review", "what_happened": "x", "why": [], "what_to_do": "y",
        "indicator_host": "example.top", "indicator_digest": "d" * 64, "local_indicator": None, "verified_block": False,
        "adapter_label": "mock", "occurred_at": AT, "resolved_at": None, "trust_allowed": False, **extra})


@pytest.fixture
async def owner():
    device = f"test-identity-{uuid.uuid4().hex[:12]}"
    yield device
    await db.patrol_records.delete_many({"owner_id": device})
    await db.patrol_events.delete_many({"device_id": device})


async def test_an_event_bound_to_its_case_later_stays_one_threat_case(owner):
    event_id = str(uuid.uuid4())
    first = await patrol_records.append(_event(owner, event_id), False)
    second = await patrol_records.append(_event(owner, event_id, investigation_case_id="case-1"), False)
    third = await patrol_records.append(_event(owner, event_id, investigation_case_id="case-1", state="barking"), False)
    assert first["logical_issue_key"] == second["logical_issue_key"] == third["logical_issue_key"]
    assert [first["revision"], second["revision"], third["revision"]] == [1, 2, 3]
    cards = [r for r in await patrol_records.current(owner) if r["sourceEventId"] == event_id]
    assert len(cards) == 1 and cards[0]["revision"] == 3
    assert len(await patrol_records.timeline(owner, cards[0]["recordId"])) == 3


async def test_a_new_event_for_an_existing_case_joins_that_case(owner):
    a = await patrol_records.append(_event(owner, str(uuid.uuid4()), investigation_case_id="case-2"), False)
    b = await patrol_records.append(_event(owner, str(uuid.uuid4()), investigation_case_id="case-2", indicator_digest="e" * 64), False)
    assert a["logical_issue_key"] == b["logical_issue_key"]


async def test_records_already_split_across_two_keys_read_as_one_case(owner):
    event_id = str(uuid.uuid4())
    base = {"owner_id": owner, "source_event_id": event_id, "duplicate_of": None, "category": "link", "headline": "h",
            "source_type": "device_assessment",
            "summary": "s", "raw_state": "growling", "effective_state": "warning", "effective_reason": "r",
            "freshness": {}, "occurred_at": AT, "event": {"event_id": event_id}}
    await db.patrol_records.insert_many([
        {**base, "record_id": str(uuid.uuid4()), "logical_issue_key": "legacy-a", "revision": 1, "source_fingerprint": "f1",
         "created_at": AT},
        {**base, "record_id": str(uuid.uuid4()), "logical_issue_key": "legacy-b", "revision": 1, "source_fingerprint": "f2",
         "created_at": AT + timedelta(seconds=1), "occurred_at": AT + timedelta(seconds=1), "investigation_case_id": "case-3"},
    ])
    cards = [r for r in await patrol_records.current(owner) if r["sourceEventId"] == event_id]
    assert len(cards) == 1 and cards[0]["logicalIssueKey"] == "legacy-b", "the latest revision of the one case"
    assert len(await patrol_records.timeline(owner, cards[0]["recordId"])) == 2


def test_server_triage_causes_mirror_the_device():
    limited = evaluate({"source_type": "link", "reputation": {"status": "unavailable"}, "local_level": "clean",
                        "visibility": {"browser": False, "websocket": False}}).wire()
    assert limited["outcome"] == "LIMITED_UNABLE_TO_DETERMINE"
    assert telemetry.causes_for(limited) == ["reputation_unavailable"]
    assert telemetry.causes_for(limited, "timeout") == ["reputation_timeout"]
    assert telemetry.causes_for({"outcome": "NO_THREAT_IDENTIFIED", "coverageGaps": []}) == []
    assert telemetry.causes_for({"outcome": "LIMITED_UNABLE_TO_DETERMINE", "coverageGaps": [
        {"code": "INSUFFICIENT_EVIDENCE"}, {"code": "DETERMINISTIC_CHECK_ERROR"}, {"code": "EMAIL_HEADERS_UNAVAILABLE"}]}) == [
        "insufficient_evidence", "rule_execution_error", "gap_email_headers_unavailable"]


async def test_limited_by_cause_counts_real_phones_separately_from_test_traffic(monkeypatch):
    collection = f"test_triage_telemetry_{uuid.uuid4().hex[:8]}"
    monkeypatch.setattr(telemetry, "COLLECTION", collection)
    phone = {"device_id": "p1", "platform": "android", "adapter_mode": "native"}
    preview = {"device_id": "w1", "platform": "web", "adapter_mode": "mock"}
    try:
        await telemetry.record(phone, origin="device", source_type="link", outcome="LIMITED_UNABLE_TO_DETERMINE",
                               causes=["reputation_timeout"], gap_codes=["INTELLIGENCE_PROVIDER_UNAVAILABLE"],
                               lookup={"check": "reputation_lookup", "attempts": 3, "outcome": "failed"})
        await telemetry.record(phone, origin="device", source_type="call", outcome="LIMITED_UNABLE_TO_DETERMINE",
                               causes=["number_risk_moderate"], gap_codes=["INSUFFICIENT_EVIDENCE"])
        await telemetry.record(phone, origin="device", source_type="link", outcome="NO_THREAT_IDENTIFIED", causes=[], gap_codes=[],
                               lookup={"check": "reputation_lookup", "attempts": 2, "outcome": "recovered"})
        await telemetry.record(preview, origin="device", source_type="link", outcome="LIMITED_UNABLE_TO_DETERMINE",
                               causes=["reputation_auth_failure"], gap_codes=["INTELLIGENCE_PROVIDER_UNAVAILABLE"])
        # Content never gets in: a non-code cause or an unknown outcome is dropped.
        await telemetry.record(phone, origin="device", source_type="link", outcome="SAFE", causes=[], gap_codes=[])
        await telemetry.record(phone, origin="device", source_type="link", outcome="LIMITED_UNABLE_TO_DETERMINE",
                               causes=["https://evil.example/login"], gap_codes=["not a code"])

        phones = await telemetry.limited_by_cause(phones_only=True)
        assert phones["outcomes"] == {"NO_THREAT_IDENTIFIED": 1, "POSSIBLE_THREAT_IDENTIFIED": 0, "LIMITED_UNABLE_TO_DETERMINE": 3}
        assert sorted(phones["by_cause"]) == [("not_reported", "link", 1), ("number_risk_moderate", "call", 1), ("reputation_timeout", "link", 1)]
        assert phones["lookup_retries"] == {"failed": 1, "recovered": 1}
        everything = await telemetry.limited_by_cause()
        assert ("reputation_auth_failure", "link", 1) in everything["by_cause"]
        stored = await db[collection].find({}, {"_id": 0}).to_list(20)
        assert "evil" not in repr(stored)
    finally:
        await db[collection].drop()
