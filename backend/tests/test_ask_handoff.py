"""Structured Higgins handoff contract regressions."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest
from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.models import AskRequest
from routers.ask import _context_prompt, _guard_handoff_response


def payload() -> dict:
    return {
        "device_id": "device-123",
        "message": "What should I do?",
        "handoff_id": "handoff-123",
        "conversation_id": "handoff-123",
        "context": {
            "gate": "account",
            "issue_summary": "Claimed password reset",
            "assessment_state": "ears_up",
            "findings": [{"summary": "Visible sender claims Google", "provenance": "observed", "status": "uncertain"}],
            "uncertainty": ["Sender is not authenticated"],
            "confirmed_protective_actions": [],
            "user_reported_actions": ["Requested a reset"],
        },
    }


def test_structured_context_preserves_provenance_and_bounds():
    request = AskRequest(**payload())
    context = json.loads(_context_prompt(request.context) or "{}")
    assert context["findings"][0]["provenance"] == "observed"
    assert context["uncertainty"] == ["Sender is not authenticated"]


def test_context_rejects_unrestricted_event_objects():
    unsafe = payload()
    unsafe["context"]["event"] = {"raw_message": "private"}
    with pytest.raises(ValidationError):
        AskRequest(**unsafe)


def test_context_secrets_are_redacted_again_at_backend_boundary():
    secret = payload()
    secret["context"]["findings"][0]["summary"] = "My PIN is 4488"
    request = AskRequest(**secret)
    assert "4488" not in (_context_prompt(request.context) or "")


def test_capability_overclaim_is_replaced_before_streaming():
    data = payload()
    data["context"]["gate"] = "file"
    data["context"]["issue_summary"] = "Disguised executable"
    request = AskRequest(**data)
    guarded = _guard_handoff_response("File Gate will tell you if it is safe.\nCHECKS: file, device", request.context)
    assert "tell you if it is safe" not in guarded
    assert "CHECKS:" not in guarded
    assert "No protective action was confirmed" in guarded
    assert guarded.count("Next action:") == 1
