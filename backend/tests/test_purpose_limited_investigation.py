"""Purpose limitation, grounding and request-scoped deletion regressions.

Tests that observation utilities (URL sanitisation, entity extraction, screenshot
processing) work correctly. Investigation tests use the shared Magnum DI path
via services/higgins/coordinator.py, not the removed legacy investigation engine.
"""
from __future__ import annotations

import sys
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.investigation import deterministic_entities, purpose_limited_url


def test_server_redacts_secret_url_values_but_keeps_assessment_context():
    safe = purpose_limited_url("https://user:pass@example.com/reset?token=secret&invoice=42#fragment")
    assert safe == "https://example.com/reset?token=%5Bredacted%5D&invoice=42"
    assert "user" not in safe and "pass" not in safe and "secret" not in safe and "fragment" not in safe


def test_deterministic_extraction_finds_actual_concern():
    entities = deterministic_entities("Bank Alerts", "Pay $600 today, call 02 8000 1234 and share the code.", [], "CommBank", locale="en-AU")
    assert entities.claimed_organisations == ["CommBank"]
    assert any("8000" in p for p in entities.callback_details)


def test_unsupported_observation_cannot_become_a_finding():
    """A DNS failure, unreachable page or empty reputation is a limitation, not proof. With no prompt
    to state that, the enforcement is the validator: an 'observation' finding must cite real evidence."""
    from services.higgins.validation import validate
    body = {"overview": "o", "explanationMarkdown": "e", "assessment": "concern_found", "attention": "review",
            "attentionReason": "r", "findings": [{"text": "The site is inactive.", "basis": "observation",
            "confidence": "high", "evidenceIds": [], "sourceIds": [], "supersedesFindingIds": []}],
            "uncertainties": ["dns"], "scope": "s", "sourceIds": [], "remainingEvidenceIds": [], "actions": [],
            "recommendedActionIndex": None, "question": None, "completion": "complete"}
    response, errors = validate(body, revision=1, evidence_ids=set(), source_ids=set(), capability_ids=set(),
                               pending_question=None, provider_complete=True)
    assert response is None and any("observation" in e for e in errors)


