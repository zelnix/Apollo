"""Content-aware Higgins fallback when Gemini is unavailable or malformed."""
from services.investigation import InvestigationEntities, InvestigationSource, _fallback


def _local(status: str = "supports") -> list[InvestigationSource]:
    return [InvestigationSource(source_id="local-1", label="Apollo on-device content analysis",
        status=status, detail="Local deterministic assessment completed.")]


def test_genuine_looking_fallback_never_invents_a_supplied_link():
    findings, higgins = _fallback(InvestigationEntities(), "resting", _local())
    rendered = f"{higgins.next_action} {higgins.exact_response}".lower()
    assert findings[0].status == "unresolved"
    assert higgins.action_kind == "review"
    assert "supplied link" not in rendered
    assert "no strong scam request" in higgins.exact_response.lower()


def test_money_request_without_link_uses_known_channel_action():
    entities = InvestigationEntities(transaction_claims=["$600"], requested_actions=["send"])
    _, higgins = _fallback(entities, "growling", _local("inconclusive"))
    assert higgins.action_kind == "call_known_number"
    assert higgins.action_label == "Call known number"
    assert "do not send money yet" in higgins.next_action.lower()
    assert "supplied link" not in higgins.next_action.lower()