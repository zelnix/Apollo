"""Prompt/validation intent tests for the shared coordinator (replaces legacy keyword prompt tests)."""
from services.higgins.coordinator import SYSTEM
from services.higgins.validation import validate

BASE = {"overview": "o", "explanationMarkdown": "e", "assessment": "concern_found", "attention": "review", "attentionReason": "x",
        "findings": [], "uncertainties": [], "scope": "", "sourceIds": [], "remainingEvidenceIds": [], "actions": [], "completion": "complete"}


def test_empty_evidence_cannot_become_an_observed_malicious_content_claim():
    bad = {**BASE, "findings": [{"text": "The message contains malicious content", "basis": "observation", "confidence": "high", "evidenceIds": [], "sourceIds": []}]}
    response, errors = validate(bad, revision=1, evidence_ids=set(), source_ids=set(), capability_ids=set(), pending_question=None, provider_complete=True)
    assert response is None and any("basis 'observation' requires" in e for e in errors)


def test_prompt_allows_revising_apollo_findings_but_forbids_invented_protective_actions():
    assert "raise, lower or qualify concern" in SYSTEM
    assert "cannot invent an observation" in SYSTEM
    assert "Never say Apollo blocked" in SYSTEM
