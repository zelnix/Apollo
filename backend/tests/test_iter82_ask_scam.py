"""Iteration 82 — Ask Higgins from a scam alert card.

Verifies that the composed scam-style prompt (as produced by the frontend auto-feed
in `/app/frontend/app/(tabs)/ask.tsx`) is accepted by the Higgins chat endpoint
and returns a non-empty, scam-aware answer. This is the backend contract that
BUG 1's frontend auto-send relies on.
"""
from __future__ import annotations

import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8001").rstrip("/")


@pytest.fixture(scope="module")
def device_headers():
    r = requests.post(
        f"{BASE_URL}/api/devices/register",
        json={"platform": "web", "adapter_mode": "mock"},
        timeout=30,
    )
    assert r.status_code in (200, 201), r.text
    data = r.json()
    return {
        "Authorization": f"Bearer {data['device_token']}",
        "Content-Type": "application/json",
        "X-Apollo-Raw": "1",
    }


class TestAskHigginsScamAutoFeed:
    def test_scam_prompt_returns_plain_english_answer(self, device_headers):
        # Mirror the exact composition from ask.tsx useEffect auto-feed.
        title = "Fake MyGov SMS tries to steal your login"
        source = "Scamwatch (ACCC)"
        url = "https://www.scamwatch.gov.au/scam-alerts/example-mygov"
        summary = (
            "Scammers are sending text messages pretending to be from myGov asking "
            "people to click a link to review a tax refund. The link leads to a "
            "fake login page that captures usernames and passwords."
        )
        prompt = (
            "I just read this scam alert and I want to understand it:\n"
            f"• Title: {title}\n"
            f"• Source: {source}\n"
            f"• What the source says: {summary}\n"
            f"• Official source: {url}\n"
            "\n"
            "Can you explain what this scam is, how it works, and how I stay safe from it?"
        )
        body = {
            "turnId": f"turn-{uuid.uuid4().hex[:10]}",
            "message": prompt,
            "conversationId": f"conv-{uuid.uuid4().hex[:8]}",
            "previousTurnIds": [],
        }
        r = requests.post(
            f"{BASE_URL}/api/higgins/chat", json=body, headers=device_headers, timeout=120
        )
        assert r.status_code == 200, f"{r.status_code}: {r.text[:600]}"
        data = r.json()
        assert data["turnId"] == body["turnId"]
        assert data["conversationId"] == body["conversationId"]
        answer = data.get("answer") or ""
        assert isinstance(answer, str) and len(answer.strip()) > 40, (
            f"answer too short / empty: {answer!r}"
        )
        # It should look like an actual explanation, not an error payload.
        assert "temporarily unavailable" not in answer.lower()
        assert data.get("investigativeWorkStarted") is False
