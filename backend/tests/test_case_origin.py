"""Threat Case origin rule — the server places a case, and its evidence, only on the device that detected it.

Every Threat Case begins on the device that detected it. The privacy-protected summary the server keeps says what
was checked and the result; it never says where a copy is kept. Records written with the older location wording are
shown in the current wording. A detection on a second device is that device's own case.

Run: cd /app/backend && python -m pytest tests/test_case_origin.py -q
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone

import pytest

from core.db import db
from core.models import PatrolEventIn
from services import patrol_records
from services.higgins import presenter
from services.higgins.context_tools import SUMMARY_ONLY
from services.patrol_policy import SUMMARY_ADAPTER, refresh_summary, summary_narrative

PROHIBITED = re.compile(r"another device|other device|device where it happened|originating device|not available on this device"
                        r"|not stored on this device|recorded on another device|stay on this device|stored securely on your device"
                        r"|on the phone that found it|browser session", re.I)
CATEGORIES = ("email", "message", "call", "link", "website", "known_threat", "network", "device", "app", "file", "account")
STATES = ("resting", "sniffing", "ears_up", "growling", "barking", "biting")
AT = datetime(2026, 10, 26, 14, 10, tzinfo=timezone.utc)
LEGACY = {
    "headline": "Apollo flagged a text message for review",
    "what_happened": "Apollo checked a text message and found a possible concern. The full details are stored securely on your device.",
    "why": ["ApolloSG's on-device check identified a possible concern. For your privacy, detailed findings stay on this device."],
    "what_to_do": "Open the Check tab on your device to review the full details. A past check does not confirm current safety.",
}


def _texts(narrative: dict) -> list[str]:
    return [narrative["headline"], narrative["what_happened"], *narrative["why"], narrative["what_to_do"]]


def test_the_privacy_summary_never_places_a_case_on_another_device():
    for category in CATEGORIES:
        for state in STATES:
            for verified in (False, True):
                for text in _texts(summary_narrative(category, state, verified)):
                    assert not PROHIBITED.search(text), f"{category}/{state}/{verified}: {text}"


def test_records_written_with_the_older_wording_are_shown_in_the_current_wording():
    doc = {"category": "message", "state": "growling", "verified_block": False, "adapter_label": SUMMARY_ADAPTER, **LEGACY}
    shown = refresh_summary(doc)
    assert shown["what_happened"] == "Apollo checked a text message and found a possible concern."
    assert all(not PROHIBITED.search(text) for text in _texts(shown))
    # Server analysis (Triage, investigations) carries its own recorded wording and is left alone.
    analysed = {**doc, "adapter_label": "Higgins Triage (deterministic)"}
    assert refresh_summary(analysed) is analysed


def test_the_patrol_record_wire_never_returns_the_older_wording():
    row = {
        "record_id": "r1", "logical_issue_key": "k", "revision": 1, "source_event_id": "e1", "source_type": "device_assessment",
        "category": "message", "headline": LEGACY["headline"], "summary": LEGACY["what_happened"], "raw_state": "growling",
        "effective_state": "warning", "effective_reason": "x", "freshness": {}, "occurred_at": AT, "created_at": AT,
        "event": {"category": "message", "state": "growling", "verified_block": False, "adapter_label": SUMMARY_ADAPTER, **LEGACY},
    }
    wire = patrol_records._wire(row)
    for text in [wire["headline"], wire["summary"], *_texts(wire["event"])]:
        assert not PROHIBITED.search(text), text


def test_higgins_says_what_apollo_holds_not_where_another_copy_is():
    item = {"headline": "Apollo flagged a text message for review", "effectiveState": "warning", "evidence_availability": "summary_only",
            "summary": SUMMARY_ONLY, "structuredFacts": {}}
    for answer in (presenter.patrol_findings([item])["answer"], presenter.patrol_record(item)["answer"], SUMMARY_ONLY):
        assert "privacy-protected summary" in answer
        assert not PROHIBITED.search(answer), answer


def _event(device: str, event_id: str) -> PatrolEventIn:
    return PatrolEventIn.model_validate({
        "event_id": event_id, "device_id": device, "category": "link", "state": "growling", "status": "active",
        **summary_narrative("link", "growling", False), "indicator_host": "parcel-fee.top", "indicator_digest": "d" * 64,
        "local_indicator": None, "verified_block": False, "adapter_label": SUMMARY_ADAPTER, "occurred_at": AT,
        "resolved_at": None, "trust_allowed": False, "scent_id": "scent-shared"})


@pytest.fixture
async def devices():
    pair = (f"test-origin-a-{uuid.uuid4().hex[:10]}", f"test-origin-b-{uuid.uuid4().hex[:10]}")
    yield pair
    for device in pair:
        await db.patrol_records.delete_many({"owner_id": device})


async def test_an_independent_detection_on_a_second_device_is_its_own_threat_case(devices):
    first_device, second_device = devices
    event_id = str(uuid.uuid4())  # the same event id, scent and indicator on both devices
    first = await patrol_records.append(_event(first_device, event_id), False)
    second = await patrol_records.append(_event(second_device, event_id), False)
    assert first["owner_id"] == first_device and second["owner_id"] == second_device
    assert first["logical_issue_key"] != second["logical_issue_key"]
    assert second["revision"] == 1 and second["supersedes"] is None, "not a continuation of the first device's case"
    assert [r["sourceEventId"] for r in await patrol_records.current(first_device)] == [event_id]
    assert [r["event"]["device_id"] for r in await patrol_records.current(second_device)] == [second_device]
