"""Tests for the authoritative data classification registry (Package 2).

Verifies:
1. All data categories are defined and have protection levels.
2. Field classification returns correct categories (including dual-classified).
3. Unknown fields default to RESTRICTED (not unrestricted security evidence).
4. Credential fields are PROHIBITED for all external transmission purposes.
5. Authorisation matrix covers all purpose × category combinations.
6. Security evidence is preserved for investigation purposes.
7. PII is minimised for research purposes.
8. Processing pathways are complete and reference valid categories/purposes.
9. Value pattern classification detects embedded personal data.
10. Integration with llm_boundary.py is consistent.
"""
import pytest
from core.data_classification import (
    DataCategory,
    ProtectionLevel,
    ProcessingPurpose,
    CATEGORY_PROTECTION,
    AUTHORISATION_MATRIX,
    FIELD_CATEGORIES,
    PROCESSING_PATHWAYS,
    classify_field,
    classify_value_patterns,
    is_permitted,
    is_prohibited,
    required_transformation,
    categories_for_purpose,
    prohibited_categories,
    dual_classified_fields,
    ProcessingPathway,
)


# ── 1. All categories have protection levels ────────────────────────────────

class TestCategoryProtection:
    def test_every_category_has_protection_level(self):
        for cat in DataCategory:
            assert cat in CATEGORY_PROTECTION, f"DataCategory.{cat.name} missing from CATEGORY_PROTECTION"

    def test_credential_is_prohibited(self):
        assert CATEGORY_PROTECTION[DataCategory.CREDENTIAL] == ProtectionLevel.PROHIBITED

    def test_unknown_is_restricted(self):
        """CRITICAL: Unknown data must default to RESTRICTED, never PERMITTED."""
        assert CATEGORY_PROTECTION[DataCategory.UNKNOWN] == ProtectionLevel.RESTRICTED

    def test_security_indicator_is_controlled(self):
        assert CATEGORY_PROTECTION[DataCategory.SECURITY_INDICATOR] == ProtectionLevel.CONTROLLED

    def test_pii_is_restricted(self):
        assert CATEGORY_PROTECTION[DataCategory.PII] == ProtectionLevel.RESTRICTED

    def test_medical_is_restricted(self):
        assert CATEGORY_PROTECTION[DataCategory.MEDICAL] == ProtectionLevel.RESTRICTED

    def test_financial_is_restricted(self):
        assert CATEGORY_PROTECTION[DataCategory.FINANCIAL] == ProtectionLevel.RESTRICTED

    def test_location_is_restricted(self):
        assert CATEGORY_PROTECTION[DataCategory.LOCATION] == ProtectionLevel.RESTRICTED


# ── 2. Field classification ─────────────────────────────────────────────────

class TestFieldClassification:
    def test_security_fields_classified(self):
        security_fields = ["domain", "host", "indicator_host", "threat_types",
                           "redirect_chain", "final_url", "headline", "what_happened"]
        for field in security_fields:
            cats = classify_field(field)
            assert DataCategory.SECURITY_INDICATOR in cats, f"{field} should be SECURITY_INDICATOR"

    def test_verdict_is_investigation_metadata(self):
        """Verdict is an assessment outcome (investigation metadata), not a security indicator."""
        cats = classify_field("verdict")
        assert DataCategory.INVESTIGATION_METADATA in cats

    def test_device_observation_fields(self):
        obs_fields = ["mechanism", "matched_rule_id", "enforced_action", "verified_block"]
        for field in obs_fields:
            cats = classify_field(field)
            assert DataCategory.DEVICE_OBSERVATION in cats, f"{field} should be DEVICE_OBSERVATION"

    def test_investigation_metadata_fields(self):
        meta_fields = ["evidence_id", "event_id", "case_id", "status", "occurred_at"]
        for field in meta_fields:
            cats = classify_field(field)
            assert DataCategory.INVESTIGATION_METADATA in cats, f"{field} should be INVESTIGATION_METADATA"

    def test_pii_fields_classified(self):
        pii_fields = ["name", "email", "phone_number", "address", "contacts"]
        for field in pii_fields:
            cats = classify_field(field)
            assert DataCategory.PII in cats, f"{field} should be PII"

    def test_credential_fields_classified(self):
        cred_fields = ["password", "passcode", "pin", "otp", "api_key",
                       "access_token", "refresh_token", "recovery_phrase"]
        for field in cred_fields:
            cats = classify_field(field)
            assert DataCategory.CREDENTIAL in cats, f"{field} should be CREDENTIAL"

    def test_unknown_field_defaults_to_unknown(self):
        """CRITICAL: Unknown fields must NOT default to security evidence."""
        cats = classify_field("completely_novel_field_xyz")
        assert DataCategory.UNKNOWN in cats
        assert DataCategory.SECURITY_INDICATOR not in cats

    def test_unknown_credential_like_field_detected(self):
        """Fields with credential indicators in name should be caught even if not listed."""
        cats = classify_field("my_custom_password_hash")
        assert DataCategory.CREDENTIAL in cats

    def test_unknown_token_field_detected(self):
        cats = classify_field("some_auth_token")
        assert DataCategory.CREDENTIAL in cats

    def test_financial_fields(self):
        fin_fields = ["bank_account", "card_number", "bsb", "transaction"]
        for field in fin_fields:
            cats = classify_field(field)
            assert DataCategory.FINANCIAL in cats, f"{field} should be FINANCIAL"

    def test_location_fields(self):
        loc_fields = ["gps_coordinates", "home_location", "movement_history"]
        for field in loc_fields:
            cats = classify_field(field)
            assert DataCategory.LOCATION in cats, f"{field} should be LOCATION"

    def test_medical_fields(self):
        med_fields = ["diagnosis", "treatment", "prescription", "health_data"]
        for field in med_fields:
            cats = classify_field(field)
            assert DataCategory.MEDICAL in cats, f"{field} should be MEDICAL"


# ── 3. Dual-classified fields ───────────────────────────────────────────────

class TestDualClassification:
    def test_sender_is_dual_classified(self):
        """Sender is both security evidence (for authentication analysis) and PII."""
        cats = classify_field("sender")
        assert DataCategory.SECURITY_INDICATOR in cats
        assert DataCategory.PII in cats

    def test_sender_email_is_dual_classified(self):
        cats = classify_field("sender_email")
        assert DataCategory.SECURITY_INDICATOR in cats
        assert DataCategory.PII in cats

    def test_caller_number_is_dual_classified(self):
        cats = classify_field("caller_number")
        assert DataCategory.SECURITY_INDICATOR in cats
        assert DataCategory.PII in cats

    def test_dual_classified_fields_function(self):
        dual = dual_classified_fields()
        assert "sender" in dual
        assert "sender_email" in dual
        assert "caller_number" in dual
        # Pure security fields should NOT be in dual list
        assert "domain" not in dual
        assert "verdict" not in dual


# ── 4. Credential prohibition ───────────────────────────────────────────────

class TestCredentialProhibition:
    """Credentials must be PROHIBITED for ALL external transmission purposes."""

    def test_credential_prohibited_for_investigation(self):
        assert is_prohibited(ProcessingPurpose.INVESTIGATION, DataCategory.CREDENTIAL)

    def test_credential_prohibited_for_research(self):
        assert is_prohibited(ProcessingPurpose.RESEARCH, DataCategory.CREDENTIAL)

    def test_credential_prohibited_for_vision(self):
        assert is_prohibited(ProcessingPurpose.VISION_PREFLIGHT, DataCategory.CREDENTIAL)

    def test_credential_prohibited_for_reputation(self):
        assert is_prohibited(ProcessingPurpose.REPUTATION_LOOKUP, DataCategory.CREDENTIAL)

    def test_credential_prohibited_for_breach(self):
        assert is_prohibited(ProcessingPurpose.BREACH_CHECK, DataCategory.CREDENTIAL)

    def test_credential_prohibited_for_family(self):
        assert is_prohibited(ProcessingPurpose.FAMILY_SHARING, DataCategory.CREDENTIAL)

    def test_credential_prohibited_for_chat(self):
        assert is_prohibited(ProcessingPurpose.ORDINARY_CHAT, DataCategory.CREDENTIAL)

    def test_credential_prohibited_for_all_matrix_purposes(self):
        """Exhaustive: credential must be prohibited for every purpose in the matrix."""
        for purpose in AUTHORISATION_MATRIX:
            assert is_prohibited(purpose, DataCategory.CREDENTIAL), \
                f"CREDENTIAL must be PROHIBITED for {purpose.value}"


# ── 5. Authorisation matrix completeness ────────────────────────────────────

class TestAuthorisationMatrix:
    def test_all_purposes_have_entries(self):
        """Every matrix purpose must define entries for all data categories."""
        expected_categories = {
            DataCategory.PII, DataCategory.MEDICAL, DataCategory.FINANCIAL,
            DataCategory.LOCATION, DataCategory.SENSITIVE_PERSONAL,
            DataCategory.CREDENTIAL, DataCategory.SECURITY_INDICATOR,
            DataCategory.DEVICE_OBSERVATION, DataCategory.INVESTIGATION_METADATA,
            DataCategory.DEVICE_IDENTITY, DataCategory.CONVERSATION,
            DataCategory.DERIVED_CONTENT, DataCategory.UNKNOWN,
        }
        for purpose, entries in AUTHORISATION_MATRIX.items():
            for cat in expected_categories:
                assert cat in entries, \
                    f"Missing {cat.value} in AUTHORISATION_MATRIX[{purpose.value}]"

    def test_every_entry_has_note(self):
        """Every authorisation entry must include a transformation/handling note."""
        for purpose, entries in AUTHORISATION_MATRIX.items():
            for cat, (level, note) in entries.items():
                assert note and len(note) > 0, \
                    f"Empty note for {purpose.value}/{cat.value}"

    def test_unknown_always_restricted_or_prohibited(self):
        """UNKNOWN data must never be PERMITTED or CONTROLLED."""
        for purpose, entries in AUTHORISATION_MATRIX.items():
            if DataCategory.UNKNOWN in entries:
                level, _ = entries[DataCategory.UNKNOWN]
                assert level in (ProtectionLevel.RESTRICTED, ProtectionLevel.PROHIBITED), \
                    f"UNKNOWN must be RESTRICTED/PROHIBITED for {purpose.value}, got {level.value}"


# ── 6. Security evidence preservation ───────────────────────────────────────

class TestSecurityEvidencePreservation:
    def test_security_indicators_permitted_for_investigation(self):
        assert is_permitted(ProcessingPurpose.INVESTIGATION, DataCategory.SECURITY_INDICATOR)

    def test_device_observations_permitted_for_investigation(self):
        assert is_permitted(ProcessingPurpose.INVESTIGATION, DataCategory.DEVICE_OBSERVATION)

    def test_investigation_metadata_permitted_for_investigation(self):
        assert is_permitted(ProcessingPurpose.INVESTIGATION, DataCategory.INVESTIGATION_METADATA)

    def test_security_indicators_permitted_for_research(self):
        """Research must preserve domain names and scam identifiers."""
        assert is_permitted(ProcessingPurpose.RESEARCH, DataCategory.SECURITY_INDICATOR)


# ── 7. PII minimisation for research ───────────────────────────────────────

class TestResearchMinimisation:
    def test_pii_controlled_for_research(self):
        """PII must be CONTROLLED (minimised) not PERMITTED for research."""
        matrix = AUTHORISATION_MATRIX[ProcessingPurpose.RESEARCH]
        level, _ = matrix[DataCategory.PII]
        assert level == ProtectionLevel.CONTROLLED

    def test_medical_prohibited_for_research(self):
        assert is_prohibited(ProcessingPurpose.RESEARCH, DataCategory.MEDICAL)

    def test_location_prohibited_for_research(self):
        assert is_prohibited(ProcessingPurpose.RESEARCH, DataCategory.LOCATION)

    def test_device_identity_prohibited_for_research(self):
        assert is_prohibited(ProcessingPurpose.RESEARCH, DataCategory.DEVICE_IDENTITY)

    def test_conversation_prohibited_for_research(self):
        assert is_prohibited(ProcessingPurpose.RESEARCH, DataCategory.CONVERSATION)


# ── 8. Processing pathways ──────────────────────────────────────────────────

class TestProcessingPathways:
    def test_pathways_exist(self):
        assert len(PROCESSING_PATHWAYS) >= 13, "Expected at least 13 processing pathways"

    def test_all_pathways_have_valid_purpose(self):
        for pw in PROCESSING_PATHWAYS:
            assert isinstance(pw.purpose, ProcessingPurpose), \
                f"Pathway {pw.pathway_id} has invalid purpose"

    def test_all_pathways_have_valid_categories(self):
        for pw in PROCESSING_PATHWAYS:
            for cat in pw.data_categories:
                assert isinstance(cat, DataCategory), \
                    f"Pathway {pw.pathway_id} has invalid category {cat}"

    def test_all_pathways_have_implementation_files(self):
        for pw in PROCESSING_PATHWAYS:
            assert len(pw.implementation_files) > 0, \
                f"Pathway {pw.pathway_id} has no implementation files"

    def test_all_pathways_have_transformations(self):
        for pw in PROCESSING_PATHWAYS:
            assert len(pw.transformations) > 0, \
                f"Pathway {pw.pathway_id} has no transformations documented"

    def test_all_pathways_have_prohibited_disclosures(self):
        for pw in PROCESSING_PATHWAYS:
            assert len(pw.prohibited_disclosures) > 0, \
                f"Pathway {pw.pathway_id} has no prohibited disclosures documented"

    def test_all_pathways_have_evidence_preservation(self):
        for pw in PROCESSING_PATHWAYS:
            assert len(pw.evidence_preservation) > 0, \
                f"Pathway {pw.pathway_id} has no evidence preservation documented"

    def test_pathway_ids_unique(self):
        ids = [pw.pathway_id for pw in PROCESSING_PATHWAYS]
        assert len(ids) == len(set(ids)), "Duplicate pathway IDs found"

    def test_screenshot_pathways_require_privacy_gate(self):
        """Screenshot pathways must reference the privacy gate."""
        screenshot_ids = {"PW-02", "PW-03"}
        for pw in PROCESSING_PATHWAYS:
            if pw.pathway_id in screenshot_ids:
                assert "privacy gate" in pw.authorisation_required.lower() or \
                       "ImagePrivacyGate" in pw.authorisation_required, \
                    f"Pathway {pw.pathway_id} must require privacy gate"

    def test_investigation_pathway_includes_encryption(self):
        """The main investigation pathway must include encryption."""
        pw06 = next(pw for pw in PROCESSING_PATHWAYS if pw.pathway_id == "PW-06")
        assert any("encrypt" in t.lower() for t in pw06.transformations), \
            "Investigation pathway must include encryption"


# ── 9. Value pattern classification ─────────────────────────────────────────

class TestValuePatternClassification:
    def test_detects_email(self):
        cats = classify_value_patterns("Contact john@example.com for details")
        assert DataCategory.PII in cats

    def test_detects_phone(self):
        cats = classify_value_patterns("Call +61 412 345 678 for help")
        assert DataCategory.PII in cats

    def test_detects_credit_card(self):
        cats = classify_value_patterns("Card number 4111 1111 1111 1111")
        assert DataCategory.FINANCIAL in cats

    def test_detects_bsb(self):
        cats = classify_value_patterns("BSB: 063-000")
        assert DataCategory.FINANCIAL in cats

    def test_detects_account_number(self):
        cats = classify_value_patterns("Account: 12345678")
        assert DataCategory.FINANCIAL in cats

    def test_detects_gps_coordinates(self):
        cats = classify_value_patterns("Location: -33.8688, 151.2093")
        assert DataCategory.LOCATION in cats

    def test_detects_credential_pattern(self):
        cats = classify_value_patterns("password is MySecret123")
        assert DataCategory.CREDENTIAL in cats

    def test_detects_bearer_token(self):
        cats = classify_value_patterns("Authorization: Bearer eyJhbGciOi.something.here")
        assert DataCategory.CREDENTIAL in cats

    def test_plain_text_returns_unknown(self):
        cats = classify_value_patterns("This is a normal sentence about security.")
        assert DataCategory.UNKNOWN in cats

    def test_domain_not_classified_as_pii(self):
        """Domain names must NOT be misclassified as PII."""
        cats = classify_value_patterns("Check example.com for more info")
        assert DataCategory.PII not in cats


# ── 10. Integration with llm_boundary ───────────────────────────────────────

class TestLLMBoundaryIntegration:
    """Verify llm_boundary.py uses the authoritative classification."""

    def test_llm_boundary_classify_field_uses_registry(self):
        from services.higgins.llm_boundary import classify_field as llm_classify, Classification
        # Security field
        assert llm_classify("domain") == Classification.SECURITY_EVIDENCE
        # PII field
        assert llm_classify("name") == Classification.PERSONAL_DATA
        # Credential field
        assert llm_classify("password") == Classification.CREDENTIAL
        # Financial (sensitive PII)
        assert llm_classify("card_number") == Classification.SENSITIVE_PII
        # Unknown field → defaults to PERSONAL_DATA (restricted)
        assert llm_classify("unknown_novel_field") == Classification.PERSONAL_DATA

    def test_llm_boundary_security_fields_superset(self):
        """LLM boundary's SECURITY_FIELDS should include all security-related fields from registry."""
        from services.higgins.llm_boundary import SECURITY_FIELDS
        for field, cats in FIELD_CATEGORIES.items():
            if DataCategory.SECURITY_INDICATOR in cats and len(cats) == 1:
                assert field in SECURITY_FIELDS, \
                    f"Security field '{field}' missing from llm_boundary SECURITY_FIELDS"

    def test_llm_boundary_credential_strip_still_works(self):
        from services.higgins.llm_boundary import strip_credentials
        text = "password is MySecret123"
        result = strip_credentials(text)
        assert "MySecret123" not in result

    def test_llm_boundary_enforce_boundary_still_works(self):
        from services.higgins.llm_boundary import enforce_boundary, Purpose
        text = "Check example.com with password is secret123"
        result = enforce_boundary(Purpose.RESEARCH, text)
        assert "secret123" not in result
        assert "example.com" in result  # Domain preserved

    def test_unknown_defaults_changed_from_security_evidence(self):
        """CRITICAL REGRESSION TEST: Unknown fields must no longer default to SECURITY_EVIDENCE.
        The old code returned SECURITY_EVIDENCE for unknowns; the new code returns PERSONAL_DATA."""
        from services.higgins.llm_boundary import classify_field as llm_classify, Classification
        result = llm_classify("completely_unknown_field_abc")
        assert result != Classification.SECURITY_EVIDENCE, \
            "Unknown fields must NOT default to SECURITY_EVIDENCE"
        assert result == Classification.PERSONAL_DATA, \
            "Unknown fields must default to PERSONAL_DATA (restricted)"
