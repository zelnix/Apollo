"""LLM Evidence Boundary acceptance tests.

Proves:
1. Local raw evidence remains available locally without unnecessary LLM transmission.
2. Actual Gemini-bound payload excludes unauthorised personal data and credentials.
3. Security meaning survives redaction and minimisation.
4. Ordinary chat and investigation enforce different evidence permissions.
5. Research tools and TTS observe the same outbound privacy restrictions.
6. Credential patterns are stripped from all outbound payloads.

Tests the actual llm_boundary module functions — no live Gemini calls needed.
"""
import pytest
from services.higgins.llm_boundary import (
    Purpose,
    Classification,
    enforce_boundary,
    strip_credentials,
    validate_outbound_payload,
    classify_field,
    _minimise_personal_identifiers,
)


class TestCredentialStripping:
    """Credentials must never reach any external call."""

    def test_strips_bearer_token(self):
        text = "Authorization: Bearer eyJhbGciOiJSUzI1NiJ9.eyJ0b2tlbiI6InRlc3QifQ.signature"
        result = strip_credentials(text)
        assert "eyJhbGciOiJSUzI1NiJ9" not in result

    def test_strips_password_in_text(self):
        text = "The user's password is SuperSecret123! and their PIN is 4567"
        result = strip_credentials(text)
        assert "SuperSecret123!" not in result

    def test_strips_url_embedded_credentials(self):
        text = "Connect to https://admin:s3cret@internal.example.com/api"
        result = strip_credentials(text)
        assert "admin:s3cret" not in result

    def test_strips_query_string_tokens(self):
        text = "Visit https://example.com/callback?access_token=abc123def456&state=ok"
        result = strip_credentials(text)
        assert "abc123def456" not in result

    def test_preserves_security_indicators(self):
        """Security-relevant text must survive credential stripping."""
        text = "Domain fake-bank.example.com was registered 2 days ago. TLS certificate mismatch."
        result = strip_credentials(text)
        assert "fake-bank.example.com" in result
        assert "registered 2 days ago" in result
        assert "TLS certificate mismatch" in result

    def test_preserves_threat_context(self):
        """Phishing language and indicators must be preserved."""
        text = "This page impersonates ANZ Bank and requests login credentials."
        result = strip_credentials(text)
        assert "impersonates ANZ Bank" in result
        assert "requests login" in result


class TestPurposeBasedBoundary:
    """Different purposes permit different evidence levels."""

    def test_ordinary_chat_excludes_personal_data_fields(self):
        payload = {
            "domain": "example.com",
            "category": "website",
            "confidence": "high",
            "email": "user@personal.com",
            "phone_number": "+61400123456",
        }
        result = enforce_boundary(Purpose.ORDINARY_CHAT, payload)
        assert "domain" in result
        assert "category" in result
        assert "email" not in result
        assert "phone_number" not in result

    def test_investigation_permits_personal_data_fields(self):
        """Investigation has broader evidence permissions (for authorised cases)."""
        payload = {
            "domain": "example.com",
            "email": "user@personal.com",
            "confidence": "high",
        }
        result = enforce_boundary(Purpose.INVESTIGATION, payload)
        assert "domain" in result
        assert "email" in result  # Permitted for investigation

    def test_research_minimises_personal_identifiers(self):
        text = "Is example.com safe? The user John at john@example.com reported it."
        result = enforce_boundary(Purpose.RESEARCH, text)
        assert "example.com" in result
        assert "john@example.com" not in result
        assert "[email]" in result

    def test_tts_strips_credentials(self):
        text = "Your new password is TempPass123. The site was blocked."
        result = enforce_boundary(Purpose.TTS, text)
        assert "TempPass123" not in result
        assert "blocked" in result


class TestValidation:
    """Validate that outbound payloads are checked before external calls."""

    def test_clean_payload_passes(self):
        text = "Apollo found that example.com has a suspicious TLS certificate."
        violations = validate_outbound_payload(Purpose.ORDINARY_CHAT, text)
        assert len(violations) == 0

    def test_credential_payload_fails(self):
        text = "The user's password is SuperSecret123!"
        violations = validate_outbound_payload(Purpose.ORDINARY_CHAT, text)
        assert len(violations) > 0
        assert "Credential pattern" in violations[0]

    def test_bearer_token_fails_validation(self):
        text = "Bearer eyJhbGciOiJSUzI1NiJ9.long.token"
        violations = validate_outbound_payload(Purpose.RESEARCH, text)
        assert len(violations) > 0


class TestFieldClassification:
    """Fields are classified correctly for permit/deny decisions."""

    def test_security_fields_classified_correctly(self):
        for field in ["domain", "indicator_host", "confidence", "threat_types", "verdict"]:
            assert classify_field(field) == Classification.SECURITY_EVIDENCE

    def test_personal_data_fields_classified_correctly(self):
        for field in ["email", "phone_number", "address", "name"]:
            assert classify_field(field) == Classification.PERSONAL_DATA

    def test_credential_fields_classified_correctly(self):
        for field in ["password_hash", "api_token", "secret_key"]:
            assert classify_field(field) == Classification.CREDENTIAL


class TestPersonalDataMinimisation:
    """Personal identifiers are minimised when not essential."""

    def test_email_minimised(self):
        text = "Contact john.doe@example.com for more info"
        result = _minimise_personal_identifiers(text)
        assert "john.doe@example.com" not in result
        assert "[email]" in result

    def test_phone_minimised(self):
        text = "Call +61 400 123 456 for support"
        result = _minimise_personal_identifiers(text)
        assert "+61 400 123 456" not in result
        assert "[phone number]" in result

    def test_domain_preserved(self):
        """Domain names are security indicators, not personal data."""
        text = "The suspicious domain fake-bank.example.com was registered recently"
        result = _minimise_personal_identifiers(text)
        assert "fake-bank.example.com" in result

    def test_port_numbers_not_minimised(self):
        """Port numbers (short digit sequences) should not be treated as phone numbers."""
        text = "Connection on port 8443"
        result = _minimise_personal_identifiers(text)
        assert "8443" in result


class TestNestedPayloads:
    """Boundary enforcement works on nested structures."""

    def test_nested_dict_enforced(self):
        payload = {
            "findings": [
                {"text": "Password is secret123", "domain": "example.com"}
            ],
            "email": "user@test.com",
        }
        result = enforce_boundary(Purpose.ORDINARY_CHAT, payload)
        assert "email" not in result
        assert "findings" in result
        # Credential in nested text should be stripped
        finding_text = result["findings"][0]["text"]
        assert "secret123" not in finding_text

    def test_list_payload_enforced(self):
        payload = ["password is abc123", "domain is safe"]
        result = enforce_boundary(Purpose.ORDINARY_CHAT, payload)
        assert "abc123" not in result[0]
        assert "domain is safe" in result[1]
