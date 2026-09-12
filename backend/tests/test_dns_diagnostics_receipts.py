"""Out-of-band DNS/DoH capability diagnostic: nonce receipt collector.

Completely separate from M1/M2 rule distribution (see app/api/routes/dns_diagnostics.py's own
docstring). Uses the same in-process ASGI `client` fixture as the rest of the suite.
"""
from __future__ import annotations

import pytest


@pytest.mark.anyio
async def test_receipt_unknown_nonce_reports_not_received(client):
    r = await client.get("/api/dns-diagnostics/receipts/abc123def456")
    assert r.status_code == 200
    body = r.json()
    assert body == {"nonce": "abc123def456", "received": False, "receivedAt": None}


@pytest.mark.anyio
async def test_receipt_recorded_then_visible_on_poll(client):
    nonce = "dohprobe-nonce-001"
    before = await client.get(f"/api/dns-diagnostics/receipts/{nonce}")
    assert before.json()["received"] is False

    posted = await client.post(f"/api/dns-diagnostics/receipts/{nonce}")
    assert posted.status_code == 200
    assert posted.json() == {"nonce": nonce, "recorded": True}

    after = await client.get(f"/api/dns-diagnostics/receipts/{nonce}")
    body = after.json()
    assert body["received"] is True
    assert body["nonce"] == nonce
    assert body["receivedAt"]


@pytest.mark.anyio
async def test_receipt_first_arrival_time_is_kept_on_duplicate_post(client):
    nonce = "dohprobe-nonce-002"
    first = await client.post(f"/api/dns-diagnostics/receipts/{nonce}")
    first_receipt = (await client.get(f"/api/dns-diagnostics/receipts/{nonce}")).json()

    second = await client.post(f"/api/dns-diagnostics/receipts/{nonce}")
    second_receipt = (await client.get(f"/api/dns-diagnostics/receipts/{nonce}")).json()

    assert first.status_code == second.status_code == 200
    assert first_receipt["receivedAt"] == second_receipt["receivedAt"]


@pytest.mark.anyio
async def test_receipt_rejects_malformed_nonce(client):
    r = await client.get("/api/dns-diagnostics/receipts/ab")  # too short to match the nonce shape
    assert r.status_code == 400
    r2 = await client.get("/api/dns-diagnostics/receipts/has spaces")
    assert r2.status_code == 400
