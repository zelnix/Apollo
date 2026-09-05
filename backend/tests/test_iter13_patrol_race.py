"""Iteration 13 — POST /api/patrol/events must be idempotent under concurrent races.
Fix verification for DuplicateKeyError 500 seen in iteration 12."""
import os
import uuid
import asyncio
from datetime import datetime, timezone

import aiohttp
import pytest
import requests

BASE_URL = "https://threat-patrol-1.preview.emergentagent.com"
API = f"{BASE_URL}/api"

DEVICE_ID = f"race-{uuid.uuid4().hex[:12]}"
EVENT_ID = f"evt-{uuid.uuid4().hex[:12]}"


def _payload(headline: str, state: str = "barking"):
    return {
        "event_id": EVENT_ID,
        "device_id": DEVICE_ID,
        "category": "known_threat",
        "state": state,
        "status": "active",
        "headline": headline,
        "what_happened": "test race",
        "why": ["race"],
        "what_to_do": "test",
        "indicator_host": "example.com",
        "indicator_digest": None,
        "local_indicator": None,
        "verified_block": False,
        "adapter_label": "MOCK",
        "occurred_at": datetime.now(timezone.utc).isoformat(),
        "resolved_at": None,
        "trust_allowed": False,
        "claimed_brand": None,
        "scenario": "T00",
    }


@pytest.mark.asyncio
async def test_concurrent_upsert_same_event_id():
    """Two concurrent POSTs same event_id+device_id but different headlines → both 200, one row."""
    async with aiohttp.ClientSession() as session:
        async def post(headline: str):
            async with session.post(f"{API}/patrol/events", json=_payload(headline)) as r:
                return r.status, await r.json()

        results = await asyncio.gather(
            post("Headline A"),
            post("Headline B"),
            return_exceptions=True,
        )

    # Both must be 200, no 500s
    for res in results:
        assert not isinstance(res, Exception), f"exception: {res}"
        status, body = res
        assert status == 200, f"expected 200, got {status}: {body}"

    # GET must show exactly one event with this event_id
    r = requests.get(f"{API}/patrol/events", params={"device_id": DEVICE_ID}, timeout=10)
    assert r.status_code == 200
    events = [e for e in r.json() if e["event_id"] == EVENT_ID]
    assert len(events) == 1, f"expected 1 event, got {len(events)}: {events}"
    # headline is whichever finished last
    assert events[0]["headline"] in ("Headline A", "Headline B")


def test_sequential_upsert_updates_fields():
    """Sequential repeats — 200 + updated fields visible in GET."""
    seq_event_id = f"seq-{uuid.uuid4().hex[:12]}"
    seq_device = f"seqdev-{uuid.uuid4().hex[:12]}"

    def pl(headline):
        p = _payload(headline)
        p["event_id"] = seq_event_id
        p["device_id"] = seq_device
        return p

    r1 = requests.post(f"{API}/patrol/events", json=pl("First"), timeout=10)
    assert r1.status_code == 200, r1.text

    r2 = requests.post(f"{API}/patrol/events", json=pl("Second updated"), timeout=10)
    assert r2.status_code == 200, r2.text

    lst = requests.get(f"{API}/patrol/events", params={"device_id": seq_device}, timeout=10).json()
    match = [e for e in lst if e["event_id"] == seq_event_id]
    assert len(match) == 1
    assert match[0]["headline"] == "Second updated"


def test_stress_5x_concurrent_no_500():
    """5 concurrent requests, none may 500."""
    import concurrent.futures

    stress_event = f"stress-{uuid.uuid4().hex[:12]}"
    stress_device = f"stressdev-{uuid.uuid4().hex[:12]}"

    def send(i: int):
        p = _payload(f"Concurrent {i}")
        p["event_id"] = stress_event
        p["device_id"] = stress_device
        return requests.post(f"{API}/patrol/events", json=p, timeout=15).status_code

    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as ex:
        statuses = list(ex.map(send, range(5)))

    assert all(s == 200 for s in statuses), f"got non-200: {statuses}"

    lst = requests.get(f"{API}/patrol/events", params={"device_id": stress_device}, timeout=10).json()
    match = [e for e in lst if e["event_id"] == stress_event]
    assert len(match) == 1
