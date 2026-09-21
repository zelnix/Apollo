"""Round 1 model-grounding prompt regressions."""
from services.investigation import SYSTEM


def test_empty_account_evidence_cannot_become_a_malicious_content_claim():
    lowered = SYSTEM.lower()
    assert "empty submission" in lowered
    assert "never infer hidden malicious code" in lowered
    assert "screenshot, pasted alert or short description" in lowered


def test_model_must_not_override_authoritative_apollo_state_language():
    assert "do not write apollo mascot state phrases" in SYSTEM.lower()
