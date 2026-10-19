"""Field registry + the single outbound privacy decision (Apollo Privacy Simplification).

Outcome tests only: credentials never leave, security evidence survives, unrelated personal data is withheld
outside an authorised investigation. The former purpose/authorisation-matrix policy engine was removed because
no production code used it."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from core.data_classification import DataCategory, FIELD_CATEGORIES, classify_field
from services.higgins.llm_boundary import Purpose, enforce_boundary, field_decision


def test_registry_knows_security_indicators_and_credentials():
    assert DataCategory.SECURITY_INDICATOR in classify_field("domain")
    assert DataCategory.CREDENTIAL in classify_field("password")
    assert classify_field("api_token") == frozenset({DataCategory.CREDENTIAL})  # credential-looking names
    assert classify_field("unknown_novel_field") == frozenset({DataCategory.UNKNOWN})
    assert len(FIELD_CATEGORIES) > 50


def test_dual_classified_security_indicators_are_evidence():
    for field in ("sender", "caller_number", "domain"):
        assert field_decision(field) == "evidence", field


def test_decisions():
    assert field_decision("password") == "credential"
    assert field_decision("name") == "personal"
    assert field_decision("card_number") == "personal"
    assert field_decision("unknown_novel_field") == "personal"  # never silently treated as evidence


def test_credential_fields_never_leave_for_any_purpose():
    for purpose in Purpose:
        out = enforce_boundary(purpose, {"password": "hunter22", "domain": "evil.example"})
        assert "password" not in out and out["domain"] == "evil.example", purpose


def test_personal_fields_withheld_outside_investigation_but_kept_for_it():
    payload = {"name": "Jane Citizen", "sender": "+61 400 111 222"}
    assert enforce_boundary(Purpose.RESEARCH, payload)["name"] == "[personal data withheld]"
    inv = enforce_boundary(Purpose.INVESTIGATION, payload)
    assert inv["name"] == "Jane Citizen" and inv["sender"] == "+61 400 111 222"
