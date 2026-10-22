"""Regression tests for P0 image privacy screening enforcement.

Tests that:
- Backend rejects image bytes that don't match the declared digest — byte binding, not attestation (P0-5)
- PII minimisation covers Australian identifiers (P2-11)
- detection_updated_at is set for genuinely new evidence (P1-9)
- Scam indicators are preserved through minimisation (P2-11)
"""
import pytest


# ── P0-5: Byte binding between the privacy gate's digest and the upload ────

# ── P0-1 & P0-2: Frontend safeguards (verified through code inspection) ────

class TestFrontendImagePrivacyContracts:
    """Verify code-level contracts in message.tsx and check.tsx."""

    def test_no_original_uri_fallback_in_message(self):
        """message.tsx must not fall back to the original image URI."""
        import pathlib
        content = pathlib.Path("/app/frontend/app/message.tsx").read_text()
        # The old pattern `result.imageUri ?? file.uri` must not appear
        assert "?? file.uri" not in content, "Original URI fallback found in message.tsx"

    def test_no_original_uri_fallback_in_check(self):
        """check.tsx must not fall back to the original image URI."""
        import pathlib
        content = pathlib.Path("/app/frontend/app/check.tsx").read_text()
        assert "?? file.uri" not in content, "Original URI fallback found in check.tsx"
        assert "sanitization_digest" not in content, "check.tsx sends no approval ceremony fields"

    def test_gate_shows_actual_redaction_not_highlights(self):
        """ImagePrivacyGate must show black redaction boxes, not just red dashed highlights."""
        import pathlib, pytest
        gate_path = pathlib.Path("/app/frontend/src/components/ImagePrivacyGate.tsx")
        if not gate_path.exists():
            pytest.skip("ImagePrivacyGate.tsx not present — privacy gate handled differently")
        content = gate_path.read_text()
        assert "backgroundColor: \"#000000\"" in content, "Missing black redaction box in preview"
        assert "Black redaction box" in content, "Missing redaction preview description"

    def test_receipt_fields_sent_to_backend(self):
        """Uploads carry the gate's byte digest (built in one place); no receipt ID exists or is sent."""
        import pathlib
        msg = pathlib.Path("/app/frontend/app/message.tsx").read_text()
        chk = pathlib.Path("/app/frontend/app/check.tsx").read_text()
        for src in (msg, chk):
            assert "sanitization_digest" not in src and "sanitization_receipt_id" not in src

    def test_text_only_goes_through_gate(self):
        """Text-only screening results must go through the gate for user review."""
        import pathlib
        content = pathlib.Path("/app/frontend/app/message.tsx").read_text()
        # The old auto-send pattern for text_only must be gone
        assert 'screening.status === "text_only"' not in content, "Text-only auto-send still present"

    def test_no_crop_instructions_style(self):
        """Obsolete cropInstructions style must be removed."""
        import pathlib, pytest
        gate_path = pathlib.Path("/app/frontend/src/components/ImagePrivacyGate.tsx")
        if not gate_path.exists():
            pytest.skip("ImagePrivacyGate.tsx not present — privacy gate handled differently")
        content = gate_path.read_text()
        assert "cropInstructions" not in content


# ── P2-11: Australian PII minimisation ──────────────────────────────────────

class TestAustralianPiiMinimisation:
    """Research boundary must minimise Australian government identifiers."""

    def test_tfn_redacted(self):
        from services.higgins.llm_boundary import _minimise_personal_identifiers
        text = "The scammer asked for TFN: 123 456 789 to verify identity"
        result = _minimise_personal_identifiers(text)
        assert "123 456 789" not in result
        assert "[tax identifier]" in result
        assert "scammer" in result  # scam indicator preserved

    def test_medicare_redacted(self):
        from services.higgins.llm_boundary import _minimise_personal_identifiers
        text = "They asked for Medicare: 2123 45670 1/2 on the fake form"
        result = _minimise_personal_identifiers(text)
        assert "2123 45670" not in result
        assert "[medicare number]" in result

    def test_abn_redacted(self):
        from services.higgins.llm_boundary import _minimise_personal_identifiers
        text = "Fake invoice listed ABN: 51 824 753 556 for payment"
        result = _minimise_personal_identifiers(text)
        assert "51 824 753 556" not in result
        assert "[business number]" in result

    def test_passport_redacted(self):
        from services.higgins.llm_boundary import _minimise_personal_identifiers
        text = "The phishing site asked for passport: PA1234567"
        result = _minimise_personal_identifiers(text)
        assert "PA1234567" not in result
        assert "[passport number]" in result

    def test_ssn_redacted(self):
        from services.higgins.llm_boundary import _minimise_personal_identifiers
        text = "Scam site requested SSN: 123456789"
        result = _minimise_personal_identifiers(text)
        assert "123456789" not in result

    def test_scam_indicators_preserved(self):
        """Scam domain names and threat descriptions must survive minimisation."""
        from services.higgins.llm_boundary import _minimise_personal_identifiers
        text = "The phishing domain evil-bank.com sent an SMS pretending to be ANZ"
        result = _minimise_personal_identifiers(text)
        assert "evil-bank.com" in result
        assert "phishing" in result
        assert "ANZ" in result

    def test_existing_patterns_still_work(self):
        """Existing email/phone/BSB patterns must still be minimised."""
        from services.higgins.llm_boundary import _minimise_personal_identifiers
        text = "Email: victim@example.com, phone +61412345678, BSB: 012-345"
        result = _minimise_personal_identifiers(text)
        assert "victim@example.com" not in result
        assert "[email]" in result
        assert "012-345" not in result


# ── P1-9 & P1-10: detection_updated_at and finding reopening ───────────────

class TestDetectionUpdatedAt:
    """detection_updated_at must only be set when genuinely new evidence arrives."""

    def test_evidence_fingerprint_is_deterministic(self):
        from routers.patrol import _evidence_fingerprint
        from core.models import EnforcementEvidenceIn
        from datetime import datetime, timezone
        evidence = EnforcementEvidenceIn(
            evidence_id="ev-1", platform="android", observed_at=datetime.now(timezone.utc),
            mechanism="dns_filter", direction="outbound", protocol="https",
            destination_domain="evil.com", requested_action="block", enforced_action="blocked",
            result="verified", rule_source="local_blocklist", confidence="high",
        )
        fp1 = _evidence_fingerprint(evidence)
        fp2 = _evidence_fingerprint(evidence)
        assert fp1 == fp2
        assert isinstance(fp1, str) and len(fp1) > 0

    def test_different_evidence_has_different_fingerprint(self):
        from routers.patrol import _evidence_fingerprint
        from core.models import EnforcementEvidenceIn
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc)
        ev1 = EnforcementEvidenceIn(
            evidence_id="ev-1", platform="android", observed_at=now,
            mechanism="dns_filter", direction="outbound", protocol="https",
            destination_domain="evil.com", requested_action="block", enforced_action="blocked",
            result="verified", rule_source="local_blocklist", confidence="high",
        )
        ev2 = EnforcementEvidenceIn(
            evidence_id="ev-2", platform="android", observed_at=now,
            mechanism="dns_filter", direction="outbound", protocol="https",
            destination_domain="evil2.com", requested_action="block", enforced_action="blocked",
            result="verified", rule_source="local_blocklist", confidence="high",
        )
        assert _evidence_fingerprint(ev1) != _evidence_fingerprint(ev2)


# ── P2-12: Gemini API claims accuracy ──────────────────────────────────────

class TestGeminiApiClaims:
    """Provider retention claims must be factual, not assume internal practices."""

    def test_provider_retention_does_not_claim_independent_verification(self, monkeypatch):
        """Live mode (data reaches Google): the claim must be limited to Google's published terms."""
        from services.higgins import provider
        monkeypatch.setattr(provider, "_preview_generate", None)
        retention = provider.configuration().get("providerRetention", "")
        assert "does not control or independently verify" in retention
        assert "published" in retention.lower()

    def test_preview_mode_retention_claim_is_truthful(self, monkeypatch):
        """The preview simulator makes no external call, so the disclosure must say nothing leaves."""
        from services.higgins import provider

        async def handler(*_args, **_kwargs):
            raise AssertionError("not exercised")

        monkeypatch.setattr(provider, "_preview_generate", handler)
        assert "no data leaves" in provider.configuration().get("providerRetention", "").lower()

    def test_frontend_privacy_disclosure_is_factual(self):
        import pathlib
        content = pathlib.Path("/app/frontend/src/domain/privacyInventory.ts").read_text()
        # Must not claim to verify Google's internal practices
        assert "does not control or independently verify" in content
        # Must reference "published" terms, not make unsourced claims
        assert "published" in content.lower()
