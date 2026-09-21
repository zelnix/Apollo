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
            "available_actions": [{"label": "Open official app", "instruction": "Open the service app from the home screen."}],
        },
    }


def test_structured_context_preserves_provenance_and_bounds():
    request = AskRequest(**payload())
    context = json.loads(_context_prompt(request.context) or "{}")
    assert context["findings"][0]["provenance"] == "observed"
    assert context["uncertainty"] == ["Sender is not authenticated"]
    assert context["available_actions"][0]["label"] == "Open official app"


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


def test_capability_overclaim_is_rejected_before_streaming():
    data = payload()
    data["context"]["gate"] = "file"
    data["context"]["issue_summary"] = "Disguised executable"
    request = AskRequest(**data)
    with pytest.raises(ValueError, match="structured handoff contract"):
        _guard_handoff_response("File Gate will tell you if it is safe.\nCHECKS: file, device", request.context)


def test_grounded_model_response_is_preserved_not_replaced():
    request = AskRequest(**payload())
    response = "Apollo observed a visible sender claim, but the sender is not confirmed and the reset link remains uncertain. Open the claimed service's official app yourself and review security activity there."
    assert _guard_handoff_response(response, request.context) == response


def test_truthful_file_uncertainty_is_not_mistaken_for_a_capability_claim():
    data = payload()
    data["context"]["gate"] = "file"
    request = AskRequest(**data)
    response = "The File Gate cannot determine that this file is safe, and its contents remain unknown. Keep it closed and verify it with the sender separately."
    assert _guard_handoff_response(response, request.context) == response


def test_semantic_uncertainty_and_supported_action_wording_are_accepted():
    data = payload()
    data["context"]["gate"] = "file"
    request = AskRequest(**data)
    response = "Only the signature was inspected, so the complete contents remain unverified. Delete the file unless you can verify the sender independently."
    assert _guard_handoff_response(response, request.context) == response


def test_simple_follow_up_does_not_have_to_repeat_initial_uncertainty_and_action():
    request = AskRequest(**payload())
    response = "The filename and signature disagree, so the document label is misleading."
    assert _guard_handoff_response(response, request.context, require_uncertainty=False, require_action=False) == response


def test_truncated_provider_output_is_rejected_before_it_reaches_the_user():
    request = AskRequest(**payload())
    with pytest.raises(ValueError, match="truncated_response"):
        _guard_handoff_response("The available evidence remains limited. At present, Apollo", request.context)


def test_invented_device_control_and_mascot_state_are_rejected():
    data = payload()
    data["context"]["gate"] = "device"
    request = AskRequest(**data)
    response = "Apollo is growling. Use the Settings icon in the top corner and enable the Background Patrolling toggle. The current state is unknown."
    with pytest.raises(ValueError, match="unsupported_capability_claim"):
        _guard_handoff_response(response, request.context)
