"""User login secrets never leave request boundaries or enter stored Higgins history."""
from pathlib import Path

from core.redaction import redact_user_secrets


def test_login_secrets_are_redacted_but_risk_context_remains():
    value = "Username: person@example.com password=Winter!42 PIN is 4488 OTP: 113355 recovery code ABCD-EFGH"
    safe = redact_user_secrets(value)
    for secret in ("person@example.com", "Winter!42", "4488", "113355", "ABCD-EFGH"):
        assert secret not in safe
    assert safe.count("[redacted]") == 5
    assert "password" in safe.lower() and "otp" in safe.lower()


def test_password_reset_phrase_is_not_mistaken_for_a_secret_value():
    assert redact_user_secrets("I received a password reset link") == "I received a password reset link"


def test_higgins_prompt_forbids_requesting_or_repeating_secrets():
    # The single Higgins prompt lives in the shared coordinator; Ask is a transport over it.
    from services.higgins.coordinator import SYSTEM
    assert "Never ask for passwords, codes or tokens" in SYSTEM
    ask_source = (Path(__file__).resolve().parents[1] / "routers" / "ask.py").read_text()
    assert "redact_investigation_secrets(body.message)" in ask_source