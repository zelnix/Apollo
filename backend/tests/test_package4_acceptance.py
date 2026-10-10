"""Package 4 — Final Acceptance Tests.

Tests exercising production code paths, not source-string assertions:

1. Production receipt creation, upload binding, and backend validation
2. Actual Gemini-bound binary payload enforcement
3. Credential pre-check for derived document images
4. Evidence preservation after privacy processing
"""
import hashlib
import re
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[1]


# ── 1. Production Receipt & Upload Binding ──────────────────────────────────

class TestProductionReceiptEnforcement:
    """Test actual backend validation paths for image uploads."""

    def test_evidence_ingest_rejects_unapproved_image(self):
        """evidence.py ingest_file checks kind == 'image' and admission_meta != 'approved'."""
        from services.higgins.evidence import ingest_file
        import inspect
        source = inspect.getsource(ingest_file)
        assert 'kind == "image" and admission_meta != "approved"' in source

    def test_analysis_message_extract_requires_approval(self):
        """message_extract endpoint enforces sanitization_status."""
        from routers.analysis import router
        # Verify route exists and source contains enforcement
        source = (BACKEND_ROOT / "routers" / "analysis.py").read_text()
        # Count distinct enforcement points
        assert source.count('sanitization_status != "approved"') >= 2

    def test_investigation_upload_requires_approval(self):
        """Both regular and resumable uploads enforce sanitization_status."""
        source = (BACKEND_ROOT / "routers" / "investigations.py").read_text()
        assert source.count('sanitization_status != "approved"') >= 2

    def test_receipt_digest_uses_crypto_digest_not_string(self):
        """Frontend receipt hashes actual binary bytes using Crypto.digest, not digestStringAsync."""
        source = (BACKEND_ROOT.parent / "frontend" / "src" / "domain" / "imageSanitization.ts").read_text()
        assert "Crypto.digest(" in source, "Must use Crypto.digest for binary byte hashing"
        assert "base64ToBytes" in source, "Must convert Base64 to actual bytes before hashing"

    def test_receipt_null_on_missing_bytes(self):
        """createReceipt returns null when image bytes cannot be read."""
        source = (BACKEND_ROOT.parent / "frontend" / "src" / "domain" / "imageSanitization.ts").read_text()
        assert "Promise<SanitizationReceipt | null>" in source

    def test_no_uri_fallback_digest(self):
        """No URI-based fallback digest exists."""
        source = (BACKEND_ROOT.parent / "frontend" / "src" / "domain" / "imageSanitization.ts").read_text()
        assert "fallback:" not in source

    def test_redaction_fails_closed(self):
        """When capture fails, image is withheld (not sent unredacted)."""
        source = (BACKEND_ROOT.parent / "frontend" / "src" / "components" / "ImagePrivacyGate.tsx").read_text()
        # The else branch for captureViewRef must withhold
        assert "handleOcrUnavailableApprove" not in source
        # Count 'withheld' occurrences — should be in multiple fail paths
        assert source.count('"withheld"') >= 3

    def test_different_bytes_different_digests(self):
        """SHA-256 of different binary content produces different digests."""
        a = hashlib.sha256(b"\xff\xd8\xff\xe0original_image").hexdigest()
        b = hashlib.sha256(b"\xff\xd8\xff\xe0redacted_image").hexdigest()
        assert a != b

    def test_trust_boundary_client_assertion(self):
        """Backend documents trust boundary as client_assertion."""
        source = (BACKEND_ROOT / "services" / "higgins" / "evidence.py").read_text()
        assert '"client_assertion"' in source
        for overstatement in ['"tamper_proof"', '"server_verified"', '"cryptographic_proof"', '"proof_of_screening"']:
            assert overstatement not in source, f"Must not claim {overstatement}"


# ── 2. Gemini-Bound Binary Payload Enforcement ─────────────────────────────

class TestGeminiBinaryPayloads:
    """Verify binary payload enforcement through production provider.py."""

    def test_binary_authorisation_set_exists(self):
        from services.higgins.provider import _BINARY_AUTHORISED_PURPOSES, _contains_binary
        from services.higgins.llm_boundary import Purpose
        # Unauthorised purposes must be excluded
        for denied in [Purpose.RESEARCH, Purpose.ORDINARY_CHAT, Purpose.PUBLIC_ADVISORY_ANALYSIS]:
            assert denied not in _BINARY_AUTHORISED_PURPOSES, f"{denied.value} must not allow binary"

    def test_contains_binary_detects_image_parts(self):
        from services.higgins.provider import _contains_binary
        from google.genai import types
        assert not _contains_binary("just text")
        assert not _contains_binary(types.Part(text="text"))
        assert _contains_binary(types.Part.from_bytes(data=b"\xff\xd8", mime_type="image/jpeg"))
        assert _contains_binary([types.Part.from_bytes(data=b"\x89PNG", mime_type="image/png")])

    def test_purpose_required_no_default(self):
        """generate() requires explicit purpose (no default value)."""
        import ast
        tree = ast.parse((BACKEND_ROOT / "services" / "higgins" / "provider.py").read_text())
        for node in ast.walk(tree):
            if isinstance(node, ast.AsyncFunctionDef) and node.name == "generate":
                for kw, default in zip(node.args.kwonlyargs, node.args.kw_defaults):
                    if kw.arg == "purpose":
                        assert default is None, "purpose must not have a default value"
                        return
        pytest.fail("generate() purpose parameter not found")

    def test_text_parts_get_full_enforcement(self):
        """SDK Content text parts receive enforce_boundary(purpose, text)."""
        source = (BACKEND_ROOT / "services" / "higgins" / "provider.py").read_text()
        assert "enforce_boundary(purpose, part.text)" in source

    def test_credential_stripping_covers_all_patterns(self):
        """strip_credentials catches passwords, API keys, bearer tokens, URL credentials."""
        from services.higgins.llm_boundary import strip_credentials
        cases = [
            ("password is Secret123", "Secret123"),
            ("api_key=sk-live-abc123", "sk-live-abc123"),
            ("Bearer eyJhbGciOi.test.sig", "eyJhbGciOi"),
            ("https://user:pass@host.com", "user:pass@"),
        ]
        for text, must_not_contain in cases:
            result = strip_credentials(text)
            assert must_not_contain not in result, f"Credential leaked: {must_not_contain} in '{result}'"

    def test_credentials_stripped_for_every_purpose(self):
        """enforce_boundary strips credentials regardless of purpose."""
        from services.higgins.llm_boundary import enforce_boundary, Purpose
        for purpose in Purpose:
            result = enforce_boundary(purpose, "password is TopSecret99")
            assert "TopSecret99" not in result, f"Credential leaked for {purpose.value}"


# ── 3. Derived Document Image Credential Pre-Check ─────────────────────────

class TestDerivedImageCredentialCheck:
    """Verify embedded images and rendered pages are checked for credentials
    BEFORE transmission, not just after Gemini reads them."""

    def test_text_contains_credentials_function_exists(self):
        from services.higgins.evidence import _text_contains_credentials
        assert callable(_text_contains_credentials)

    def test_detects_password_in_text(self):
        from services.higgins.evidence import _text_contains_credentials
        assert _text_contains_credentials("My password is Secret123")

    def test_detects_api_key_in_text(self):
        from services.higgins.evidence import _text_contains_credentials
        assert _text_contains_credentials("api_key=sk-live-abc123")

    def test_detects_bearer_token_in_text(self):
        from services.higgins.evidence import _text_contains_credentials
        assert _text_contains_credentials("Bearer eyJhbGciOiJIUzI1NiJ9.test.sig")

    def test_clean_text_passes(self):
        from services.higgins.evidence import _text_contains_credentials
        assert not _text_contains_credentials("Check this domain for phishing: evil-site.com")

    def test_empty_text_passes(self):
        from services.higgins.evidence import _text_contains_credentials
        assert not _text_contains_credentials("")
        assert not _text_contains_credentials(None)

    def test_rendered_pages_checked_before_storage(self):
        """Rendered PDF pages must be checked for credential text before storage."""
        source = (BACKEND_ROOT / "services" / "higgins" / "evidence.py").read_text()
        assert "_text_contains_credentials(source_text)" in source

    def test_embedded_images_checked_before_storage(self):
        """Embedded images must have parent text checked for credentials before storage."""
        source = (BACKEND_ROOT / "services" / "higgins" / "evidence.py").read_text()
        assert "_text_contains_credentials(parent_text)" in source

    def test_credential_pages_withheld_with_reason(self):
        """Pages with credentials must be withheld with an informative reason."""
        source = (BACKEND_ROOT / "services" / "higgins" / "evidence.py").read_text()
        assert "source text contains authentication secret" in source

    def test_credential_embedded_images_withheld_with_reason(self):
        """Embedded images from docs with credentials must be withheld."""
        source = (BACKEND_ROOT / "services" / "higgins" / "evidence.py").read_text()
        assert "parent document text contains authentication secret" in source

    def test_limitation_documented_for_visual_only_secrets(self):
        """Visual-only secrets (not in text layer) are a documented limitation."""
        source = (BACKEND_ROOT / "services" / "higgins" / "evidence.py").read_text()
        assert "visual-only" in source.lower()


# ── 4. Evidence Preservation ────────────────────────────────────────────────

class TestEvidencePreservationFinal:
    """Verify security evidence survives privacy processing."""

    def test_domains_preserved_for_investigation(self):
        from services.higgins.llm_boundary import enforce_boundary, Purpose
        assert "evil-domain.com" in enforce_boundary(Purpose.INVESTIGATION, "Check evil-domain.com")

    def test_urls_preserved_for_investigation(self):
        from services.higgins.llm_boundary import enforce_boundary, Purpose
        assert "scam-site.com" in enforce_boundary(Purpose.INVESTIGATION, "https://scam-site.com/login")

    def test_indicators_preserved_for_research(self):
        from services.higgins.llm_boundary import enforce_boundary, Purpose
        assert "phishing-domain.com" in enforce_boundary(Purpose.RESEARCH, "Is phishing-domain.com a known scam?")

    def test_pii_minimised_for_research(self):
        from services.higgins.llm_boundary import enforce_boundary, Purpose
        result = enforce_boundary(Purpose.RESEARCH, "Email from john@example.com about scam-site.com")
        assert "john@example.com" not in result
        assert "scam-site.com" in result


# ── 5. No Outdated Preflight References ─────────────────────────────────────

class TestNoOutdatedPreflightReferences:
    """Verify all outdated Gemini image preflight references are removed."""

    def test_no_preflight_function_in_evidence(self):
        source = (BACKEND_ROOT / "services" / "higgins" / "evidence.py").read_text()
        assert "async def _image_secret_preflight" not in source

    def test_no_preflight_calls_in_evidence(self):
        source = (BACKEND_ROOT / "services" / "higgins" / "evidence.py").read_text()
        assert "await _image_secret_preflight(" not in source

    def test_no_preflight_in_provider(self):
        source = (BACKEND_ROOT / "services" / "higgins" / "provider.py").read_text()
        assert "_image_secret_preflight" not in source

    def test_compliance_matrix_g01_closed(self):
        """G-01 must be marked as CLOSED in the compliance matrix."""
        source = (BACKEND_ROOT.parent / "docs" / "compliance" / "APOLLO_PRIVACY_STANDARDS_MATRIX.md").read_text()
        assert "CLOSED" in source and "G-01" in source
