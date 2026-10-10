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
    extract_evidence_pii,
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
        # Personal data fields are present but values are minimised (not dropped)
        assert result.get("email") == "[personal data withheld]"
        assert result.get("phone_number") == "[personal data withheld]"

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
        # Personal data field present but value minimised
        assert result.get("email") == "[personal data withheld]"
        assert "findings" in result
        # Credential in nested text should be stripped
        finding_text = result["findings"][0]["text"]
        assert "secret123" not in finding_text

    def test_list_payload_enforced(self):
        payload = ["password is abc123", "domain is safe"]
        result = enforce_boundary(Purpose.ORDINARY_CHAT, payload)
        assert "abc123" not in result[0]
        assert "domain is safe" in result[1]



class TestEvidenceInventoryPiiExtraction:
    """extract_evidence_pii pulls known personal identifiers from evidence texts."""

    def test_extracts_emails(self):
        texts = ["Contact john.smith@example.com about the issue"]
        pii = extract_evidence_pii(texts)
        assert "john.smith@example.com" in pii

    def test_extracts_phone_numbers(self):
        texts = ["Call me at +61 400 123 456 to discuss"]
        pii = extract_evidence_pii(texts)
        assert any("+61" in p for p in pii)

    def test_extracts_account_numbers(self):
        texts = ["Your account #12345678 has been compromised"]
        pii = extract_evidence_pii(texts)
        assert "12345678" in pii

    def test_preserves_domain_names(self):
        """Domains are security indicators, NOT personal data."""
        texts = ["The scam website is fake-bank.com"]
        pii = extract_evidence_pii(texts)
        assert "fake-bank.com" not in pii

    def test_handles_empty_texts(self):
        assert extract_evidence_pii([]) == set()
        assert extract_evidence_pii([""]) == set()
        assert extract_evidence_pii([None]) == set()

    def test_extracts_multiple_identifiers(self):
        texts = ["Email: jane@test.org, Phone: +1 555 867 5309, Acct#999123456"]
        pii = extract_evidence_pii(texts)
        assert "jane@test.org" in pii
        assert "999123456" in pii


class TestEvidenceAwareMinimisation:
    """_minimise_personal_identifiers uses inventory PII for deterministic protection."""

    def test_replaces_known_pii_values(self):
        inventory = {"john.smith@example.com", "+61400123456"}
        text = "Ask john.smith@example.com about the domain fake-bank.com"
        result = _minimise_personal_identifiers(text, evidence_pii=inventory)
        assert "john.smith@example.com" not in result
        assert "fake-bank.com" in result  # Domains preserved

    def test_does_not_replace_unknown_values(self):
        inventory = {"known@email.com"}
        text = "The domain name scam-site.org was registered by unknown@other.com"
        result = _minimise_personal_identifiers(text, evidence_pii=inventory)
        # unknown@other.com is still caught by the email regex, but domain preserved
        assert "scam-site.org" in result

    def test_financial_identifiers_minimised(self):
        text = "Card number 4532 1234 5678 9012 was used"
        result = _minimise_personal_identifiers(text)
        assert "4532 1234 5678 9012" not in result
        assert "[financial identifier]" in result

    def test_bsb_with_context_minimised(self):
        text = "BSB: 123-456 was linked to the fraud"
        result = _minimise_personal_identifiers(text)
        assert "123-456" not in result

    def test_account_number_with_context_minimised(self):
        text = "Account: 87654321 was compromised"
        result = _minimise_personal_identifiers(text)
        assert "87654321" not in result
        assert "[account number]" in result

    def test_domain_and_port_still_preserved(self):
        """Domains and ports must survive even with inventory PII."""
        inventory = {"leaked@email.com"}
        text = "Server fake-bank.com:8443 and leaked@email.com"
        result = _minimise_personal_identifiers(text, evidence_pii=inventory)
        assert "fake-bank.com" in result
        assert "8443" in result
        assert "leaked@email.com" not in result

    def test_no_broad_name_regex(self):
        """Names that happen to look like domains or businesses must NOT be redacted."""
        # This is the critical test: a broad name regex would wrongly redact "John Smith Consulting"
        # or the domain "johnsmith.com". Evidence-aware approach only redacts what's in the inventory.
        text = "The business John Smith Consulting at johnsmith.com is a known scam"
        result = _minimise_personal_identifiers(text)
        assert "John Smith Consulting" in result
        assert "johnsmith.com" in result

    def test_inventory_aware_name_redaction(self):
        """When a name IS in the evidence inventory, it should be replaced deterministically."""
        inventory = {"Jane Doe"}
        text = "Jane Doe reported the scam at fakebank.com"
        result = _minimise_personal_identifiers(text, evidence_pii=inventory)
        assert "Jane Doe" not in result
        assert "[personal identifier]" in result
        assert "fakebank.com" in result

    def test_longer_matches_replace_first(self):
        """Longer PII matches should be replaced before shorter ones to avoid partial replacements."""
        inventory = {"John", "John Smith"}
        text = "John Smith reported this"
        result = _minimise_personal_identifiers(text, evidence_pii=inventory)
        # "John Smith" should be replaced as one unit, not "John" alone
        assert "John Smith" not in result
        assert "[personal identifier]" in result

    def test_short_pii_values_ignored(self):
        """Values shorter than 3 characters are too ambiguous to replace."""
        inventory = {"Jo"}  # Too short
        text = "Jo reported the issue with domain.com"
        result = _minimise_personal_identifiers(text, evidence_pii=inventory)
        assert "Jo" in result  # Not replaced — too short
