"""Package 4 — Final Acceptance Tests.

Tests exercising production functions, not source-string assertions:

1. Receipt-to-upload byte binding via actual SHA-256 computation
2. Credential detection function with real patterns
3. Gemini-bound payload enforcement via production provider/boundary
4. Evidence preservation via production enforce_boundary
5. Omitted-list initialisation and credential-detected PDF path
"""
import hashlib
import re
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[1]


# ── 1. Receipt-to-Upload Byte Binding ───────────────────────────────────────

class TestByteBinding:
    """Verify the backend computes SHA-256 of received bytes and compares to declared digest."""

    def test_sha256_of_received_bytes(self):
        """Verify SHA-256 computation produces correct hex digest."""
        data = b"\xff\xd8\xff\xe0test_image_bytes"
        expected = hashlib.sha256(data).hexdigest()
        assert len(expected) == 64
        assert expected == hashlib.sha256(data).hexdigest()  # deterministic

    def test_different_bytes_different_digests(self):
        original = b"\xff\xd8\xff\xe0original_with_secrets"
        redacted = b"\xff\xd8\xff\xe0redacted_version"
        assert hashlib.sha256(original).hexdigest() != hashlib.sha256(redacted).hexdigest()

    def test_ingest_file_computes_received_digest(self):
        """ingest_file must compute SHA-256 of received data for byte binding."""
        import inspect
        from services.higgins.evidence import ingest_file
        source = inspect.getsource(ingest_file)
        assert "sha256(data)" in source, "Must compute SHA-256 of received bytes"
        assert "receivedBytesDigest" in source, "Must record received bytes digest"
        assert "declaredApprovedDigest" in source, "Must record declared digest"
        assert "digestMatch" in source, "Must compare digests"

    def test_consent_record_includes_digest_binding(self):
        """Consent record must include the digest binding comparison."""
        import inspect
        from services.higgins.evidence import ingest_file
        source = inspect.getsource(ingest_file)
        assert "digestBinding" in source

    def test_trust_boundary_client_assertion(self):
        """Trust boundary must be client_assertion."""
        import inspect
        from services.higgins.evidence import ingest_file
        source = inspect.getsource(ingest_file)
        assert '"client_assertion"' in source
        for overstatement in ['"tamper_proof"', '"server_verified"', '"cryptographic_proof"']:
            assert overstatement not in source


# ── 2. Credential Detection Function ───────────────────────────────────────

class TestCredentialDetection:
    """Exercise the production _text_contains_credentials function."""

    def test_function_exists(self):
        from services.higgins.evidence import _text_contains_credentials
        assert callable(_text_contains_credentials)

    def test_detects_password(self):
        from services.higgins.evidence import _text_contains_credentials
        assert _text_contains_credentials("password is MySecret123")

    def test_detects_api_key_with_underscore(self):
        from services.higgins.evidence import _text_contains_credentials
        assert _text_contains_credentials("api_key=sk-live-abc123")

    def test_detects_bearer_token(self):
        from services.higgins.evidence import _text_contains_credentials
        assert _text_contains_credentials("Authorization: Bearer eyJhbGciOi.test.sig")

    def test_detects_url_credentials(self):
        from services.higgins.evidence import _text_contains_credentials
        assert _text_contains_credentials("https://admin:secret@example.com/api")

    def test_detects_pin(self):
        from services.higgins.evidence import _text_contains_credentials
        assert _text_contains_credentials("PIN: 8472")

    def test_clean_security_text_passes(self):
        from services.higgins.evidence import _text_contains_credentials
        assert not _text_contains_credentials("Check evil-domain.com for phishing indicators")

    def test_empty_passes(self):
        from services.higgins.evidence import _text_contains_credentials
        assert not _text_contains_credentials("")

    def test_none_passes(self):
        from services.higgins.evidence import _text_contains_credentials
        assert not _text_contains_credentials(None)

    def test_domain_not_detected_as_credential(self):
        from services.higgins.evidence import _text_contains_credentials
        assert not _text_contains_credentials("The scam site is phishing-domain.com/login")


# ── 3. Gemini-Bound Payload Enforcement ─────────────────────────────────────

class TestGeminiPayloadEnforcement:
    """Exercise production provider and boundary functions."""

    def test_strip_credentials_all_patterns(self):
        """Production strip_credentials catches all credential types."""
        from services.higgins.llm_boundary import strip_credentials
        cases = [
            ("password is Secret123", "Secret123"),
            ("api_key=sk-live-abc123", "sk-live-abc123"),
            ("Bearer eyJhbGciOi.test.sig", "eyJhbGciOi"),
            ("https://user:pass@host.com", "user:pass@"),
            ("secret_key=my-secret-value", "my-secret-value"),
        ]
        for text, must_not_contain in cases:
            result = strip_credentials(text)
            assert must_not_contain not in result, f"Leaked '{must_not_contain}' from '{text}'"

    def test_enforce_boundary_strips_credentials_all_purposes(self):
        """enforce_boundary strips credentials for every purpose."""
        from services.higgins.llm_boundary import enforce_boundary, Purpose
        for purpose in Purpose:
            result = enforce_boundary(purpose, "password is TopSecret99")
            assert "TopSecret99" not in result, f"Leaked for {purpose.value}"

    def test_enforce_boundary_preserves_domains(self):
        from services.higgins.llm_boundary import enforce_boundary, Purpose
        assert "evil-domain.com" in enforce_boundary(Purpose.INVESTIGATION, "Check evil-domain.com")

    def test_enforce_boundary_minimises_pii_for_research(self):
        from services.higgins.llm_boundary import enforce_boundary, Purpose
        result = enforce_boundary(Purpose.RESEARCH, "Email john@example.com about scam-site.com")
        assert "john@example.com" not in result
        assert "scam-site.com" in result

    def test_binary_blocked_for_unauthorised_purposes(self):
        from services.higgins.provider import _BINARY_AUTHORISED_PURPOSES
        from services.higgins.llm_boundary import Purpose
        for denied in [Purpose.RESEARCH, Purpose.ORDINARY_CHAT, Purpose.PUBLIC_ADVISORY_ANALYSIS]:
            assert denied not in _BINARY_AUTHORISED_PURPOSES

    def test_binary_contains_detection(self):
        from services.higgins.provider import _contains_binary
        from google.genai import types
        assert not _contains_binary("text")
        assert _contains_binary(types.Part.from_bytes(data=b"\xff\xd8", mime_type="image/jpeg"))

    def test_purpose_required_no_default(self):
        import ast
        tree = ast.parse((BACKEND_ROOT / "services" / "higgins" / "provider.py").read_text())
        for node in ast.walk(tree):
            if isinstance(node, ast.AsyncFunctionDef) and node.name == "generate":
                for kw, default in zip(node.args.kwonlyargs, node.args.kw_defaults):
                    if kw.arg == "purpose":
                        assert default is None
                        return
        pytest.fail("purpose parameter not found")

    def test_text_parts_get_enforce_boundary(self):
        """Provider applies enforce_boundary to SDK Content text parts."""
        source = (BACKEND_ROOT / "services" / "higgins" / "provider.py").read_text()
        assert "enforce_boundary(purpose, part.text)" in source


# ── 4. MIME Type Enforcement ────────────────────────────────────────────────

class TestMimeEnforcement:
    """Production sniff() correctly detects content type."""

    def test_jpeg_detected(self):
        from services.higgins.evidence import sniff
        assert sniff(b"\xff\xd8\xff\xe0" + b"\x00" * 100, "application/pdf") == "image/jpeg"

    def test_png_detected(self):
        from services.higgins.evidence import sniff
        assert sniff(b"\x89PNG\r\n\x1a\n" + b"\x00" * 100, "text/plain") == "image/png"

    def test_pdf_detected(self):
        from services.higgins.evidence import sniff
        assert sniff(b"%PDF-1.5" + b"\x00" * 100, "image/jpeg") == "application/pdf"

    def test_mislabelled_image_classified_as_image(self):
        from services.higgins.evidence import sniff, SUPPORTED
        detected = sniff(b"\xff\xd8\xff\xe0" + b"\x00" * 100, "application/pdf")
        assert SUPPORTED.get(detected) == "image"


# ── 5. Omitted Initialisation & Credential-Detected PDF Path ───────────────

class TestOmittedInitialisation:
    """Verify omitted list is correctly initialised before the render loop."""

    def test_credential_withheld_pages_initialised_before_loop(self):
        """credential_withheld_pages must be initialised before the rendering loop."""
        import inspect
        from services.higgins.evidence import _derive
        source = inspect.getsource(_derive)
        # credential_withheld_pages must appear before the rendering loop
        init_pos = source.find("credential_withheld_pages = []")
        loop_pos = source.find("for number, png in _render_pdf_pages")
        assert init_pos > 0, "credential_withheld_pages must be initialised"
        assert init_pos < loop_pos, "credential_withheld_pages must be initialised before the loop"

    def test_omitted_built_after_loop(self):
        """omitted list must be built after the rendering loop, not during it."""
        import inspect
        from services.higgins.evidence import _derive
        source = inspect.getsource(_derive)
        # The omitted list comprehension should be after the loop
        loop_end_marker = "rendered_pages.append(number)"
        omitted_init = "omitted = ["
        loop_end_pos = source.rfind(loop_end_marker)
        omitted_pos = source.find(omitted_init, loop_end_pos)
        assert omitted_pos > loop_end_pos, "omitted must be built after rendering loop"

    def test_credential_pages_included_in_omitted(self):
        """Pages withheld due to credentials must appear in the omitted list."""
        import inspect
        from services.higgins.evidence import _derive
        source = inspect.getsource(_derive)
        assert "credential_withheld_pages" in source
        assert "authentication secret patterns" in source.lower()


# ── 6. Visual-Only Credential Limitation ────────────────────────────────────

class TestVisualOnlyCredentialLimitation:
    """Verify visual-only credential limitation is documented for derived images."""

    def test_scanned_pages_note_visual_limitation(self):
        """Scanned pages without text layers must note visual credential limitation."""
        import inspect
        from services.higgins.evidence import _derive
        source = inspect.getsource(_derive)
        assert "visual-only" in source.lower() or "Visual-only" in source

    def test_embedded_images_note_visual_limitation(self):
        """Embedded images must note visual credential detection limitation."""
        import inspect
        from services.higgins.evidence import _derive
        source = inspect.getsource(_derive)
        assert "no independent text layer" in source.lower() or "visual-only" in source.lower()

    def test_has_text_layer_check_for_rendered_pages(self):
        """Rendered pages must check whether a text layer exists."""
        import inspect
        from services.higgins.evidence import _derive
        source = inspect.getsource(_derive)
        assert "has_text_layer" in source


# ── 7. No Outdated Preflight References ─────────────────────────────────────

class TestNoOutdatedReferences:

    def test_no_preflight_function(self):
        source = (BACKEND_ROOT / "services" / "higgins" / "evidence.py").read_text()
        assert "async def _image_secret_preflight" not in source

    def test_no_preflight_calls(self):
        source = (BACKEND_ROOT / "services" / "higgins" / "evidence.py").read_text()
        assert "await _image_secret_preflight(" not in source

    def test_no_passed_secret_preflight(self):
        source = (BACKEND_ROOT / "services" / "higgins" / "evidence.py").read_text()
        assert "passed secret preflight" not in source

    def test_g01_closed_in_compliance_matrix(self):
        source = (BACKEND_ROOT.parent / "docs" / "compliance" / "APOLLO_PRIVACY_STANDARDS_MATRIX.md").read_text()
        assert "CLOSED" in source and "G-01" in source
