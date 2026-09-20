"""Content-aware Higgins fallback when Gemini is unavailable or malformed."""
from services.investigation import InvestigationEntities, InvestigationSource, _fallback
from services.investigation import deterministic_entities, safe_number_geography


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


PAYPAL_TEXT = """ALERT — Unauthorized Charge Flagged.
PayPal: Our security monitoring system just flagged a suspicious transaction linked to your account.
Merchant: NovaTech Electronics Pty Ltd.
Amount: A$412.50
Date: Sep 20, 2026
Ref ID: #PL-582911
If you recognize this charge, no action is needed. If this wasn't you, contact our fraud response line at +61 (1800) 316556 within 4 hours to freeze the transaction before funds are released. Accounts left unverified past this window will be locked automatically.
— Security Team (AU)
+61 (1800) 316556
PayPal ©2026 Payment Services. All rights reserved."""


def test_paypal_acceptance_extracts_callback_trap_without_claiming_account_truth():
    entities = deterministic_entities("+5591981395859", PAYPAL_TEXT, [], "PayPal")
    assert "+5591981395859" in entities.sender_phone_numbers
    assert "+61 (1800) 316556" in entities.callback_details
    assert "NovaTech Electronics Pty Ltd." in entities.mentioned_names
    assert "A$412.50" in entities.transaction_claims
    assert "alleged-charge callback trap" in entities.suspected_deception
    assert "call the number supplied in the message" in entities.requested_actions
    findings, higgins = _fallback(entities, "barking", _local("inconclusive"))
    rendered = f"{higgins.headline} {higgins.exact_response} {higgins.next_action}".lower()
    assert findings[0].status == "suspicious"
    assert higgins.action_kind == "check_account"
    assert "paypal app" in rendered and "callback" in rendered
    assert "could not authenticate" in rendered
    assert "charge does not exist" not in rendered and "charge is absent" not in rendered


def test_country_code_never_becomes_caller_location_evidence():
    safe = safe_number_geography("A sender number originating from Brazil")
    assert "does not establish" in safe
    assert "actual location or identity" in safe
    assert "does not establish" in safe_number_geography("The discrepancy between the sender's location and the claimed organisation suggests fraud")