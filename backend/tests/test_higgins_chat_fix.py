"""Regression tests for the Higgins chat Gemini response_schema fix.

Context: Previously, ModelChatReply emitted `additionalProperties` into the JSON schema which
caused Gemini to reject the request (400 INVALID_ARGUMENT), surfaced as HTTP 503. The fix sets
`model_config = ConfigDict(extra='ignore', ...)` so chat.reply returns a real answer and the
HTTP endpoint responds 200.
"""
from __future__ import annotations

import os
import uuid

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8001").rstrip("/")


@pytest.fixture(scope="module")
def device_auth():
    """Register a device and return (headers, device_id)."""
    resp = requests.post(
        f"{BASE_URL}/api/devices/register",
        json={"platform": "web", "adapter_mode": "mock"},
        timeout=30,
    )
    assert resp.status_code in (200, 201), f"device register failed: {resp.status_code} {resp.text}"
    data = resp.json()
    assert "device_token" in data and "device_id" in data
    headers = {
        "Authorization": f"Bearer {data['device_token']}",
        "Content-Type": "application/json",
        "X-Apollo-Raw": "1",
    }
    return headers, data["device_id"]


# ---------- Primary bug: POST /api/higgins/chat must return 200 (not 503) ----------
class TestHigginsChatFix:
    def test_higgins_chat_returns_200_with_answer(self, device_auth):
        headers, _ = device_auth
        body = {
            "turnId": "turn-00000011",
            "message": "Why is Apollo barking?",
            "conversationId": "conv-0011",
            "previousTurnIds": [],
        }
        resp = requests.post(
            f"{BASE_URL}/api/higgins/chat", json=body, headers=headers, timeout=90
        )
        assert resp.status_code == 200, (
            f"expected 200 from higgins/chat, got {resp.status_code}: {resp.text[:600]}"
        )
        data = resp.json()
        # Must not be the 503 error payload
        assert "Higgins is temporarily unavailable" not in resp.text
        # Required fields per ChatReply contract
        for key in ("turnId", "conversationId", "answer", "investigationAvailable", "retention"):
            assert key in data, f"missing field {key} in response: {list(data.keys())}"
        assert isinstance(data["answer"], str) and data["answer"].strip(), "answer must be non-empty"
        assert data["turnId"] == body["turnId"]
        assert data["conversationId"] == body["conversationId"]
        # No investigation side effect
        assert data.get("investigativeWorkStarted") is False

    def test_higgins_chat_second_call_different_prompt(self, device_auth):
        """Second call to ensure fix is stable across varied prompts (not a one-off cache hit)."""
        headers, _ = device_auth
        body = {
            "turnId": f"turn-{uuid.uuid4().hex[:10]}",
            "message": "Give me one tip to stay safe from phone scams.",
            "conversationId": f"conv-{uuid.uuid4().hex[:8]}",
            "previousTurnIds": [],
        }
        resp = requests.post(
            f"{BASE_URL}/api/higgins/chat", json=body, headers=headers, timeout=90
        )
        assert resp.status_code == 200, (
            f"expected 200, got {resp.status_code}: {resp.text[:600]}"
        )
        data = resp.json()
        assert data["answer"].strip(), "answer must be non-empty"


# ---------- Regression: /api/message/analyse with second_opinion=true still OK ----------
class TestMessageAnalyseRegression:
    def test_message_analyse_higgins_source_gemini(self, device_auth):
        headers, device_id = device_auth
        body = {
            "device_id": device_id,
            "sender": "+61400000111",
            "text": "URGENT: Your Netflix account is suspended. Click http://netflix-verify.example to reactivate.",
            "urls": ["http://netflix-verify.example"],
            "local_state": "barking",
            "scenario": "M02",
            "signals": ["urgency"],
            "claimed_brand": "Netflix",
            "second_opinion": True,
        }
        resp = requests.post(
            f"{BASE_URL}/api/message/analyse", json=body, headers=headers, timeout=180
        )
        if resp.status_code == 404:
            pytest.skip("message/analyse endpoint not available in this build")
        assert resp.status_code == 200, (
            f"analyse failed: {resp.status_code} {resp.text[:600]}"
        )
        data = resp.json()
        assessment = data.get("assessment") or {}
        processing = assessment.get("processing") or {}
        higgins_source = processing.get("higgins_source")
        assert higgins_source == "gemini", (
            f"expected higgins_source='gemini', got {higgins_source!r}; "
            f"processing={processing}"
        )
