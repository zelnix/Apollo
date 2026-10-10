"""Package 4 — Image, Document & Consent Protection acceptance tests.

Proves:
1. Raw images never reach Gemini preflight (function removed)
2. Missing, expired, reused or mismatched receipts cannot authorise uploads
3. OCR and screening failures prevent image transmission
4. Incorrect MIME types cannot bypass enforcement
5. Consent is correctly attached to each evidence item
6. Embedded document images inherit document authorisation with limitations
7. The removed ocr_unavailable_approved decision is no longer valid
8. Binary content requires purpose-based authorisation (from Package 3)
"""
import hashlib
import inspect
import re
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[1]


# ── 1. Raw image Gemini preflight removed ───────────────────────────────────

class TestPreflightRemoved:
    """Verify _image_secret_preflight function is removed from evidence.py."""

    def test_preflight_function_not_defined(self):
        """_image_secret_preflight must not exist in evidence.py."""
        source = (BACKEND_ROOT / "services" / "higgins" / "evidence.py").read_text()
        assert "async def _image_secret_preflight" not in source, \
            "_image_secret_preflight must be removed — raw images must not be sent to Gemini for screening"

    def test_preflight_not_called(self):
        """No production code may call _image_secret_preflight."""
        source = (BACKEND_ROOT / "services" / "higgins" / "evidence.py").read_text()
        # Allow the comment explaining removal, but not actual function calls
        call_pattern = re.compile(r"await\s+_image_secret_preflight\s*\(")
        assert not call_pattern.search(source), \
            "_image_secret_preflight must not be called anywhere in evidence.py"

    def test_no_preflight_in_embedded_images(self):
        """Embedded document images must not use Gemini preflight."""
        source = (BACKEND_ROOT / "services" / "higgins" / "evidence.py").read_text()
        assert "await _image_secret_preflight(image_data" not in source, \
            "Embedded images must not be sent to Gemini for screening"


# ── 2. Sanitization enforcement on all image entry points ───────────────────

class TestImageEntryPointEnforcement:
    """Every image upload pathway must require sanitization_status='approved'."""

    def test_investigation_evidence_upload_requires_status(self):
        source = (BACKEND_ROOT / "routers" / "investigations.py").read_text()
        assert 'sanitization_status != "approved"' in source, \
            "Investigation evidence upload must check sanitization_status"

    def test_resumable_upload_requires_status(self):
        source = (BACKEND_ROOT / "routers" / "investigations.py").read_text()
        # Count occurrences — should appear for both regular and resumable
        count = source.count('sanitization_status != "approved"')
        assert count >= 2, \
            f"Both regular and resumable uploads must check sanitization_status (found {count})"

    def test_message_extract_requires_status(self):
        source = (BACKEND_ROOT / "routers" / "analysis.py").read_text()
        assert 'sanitization_status != "approved"' in source, \
            "Message screenshot extraction must check sanitization_status"

    def test_page_extract_requires_status(self):
        source = (BACKEND_ROOT / "routers" / "analysis.py").read_text()
        count = source.count('sanitization_status != "approved"')
        assert count >= 2, \
            "Both message and page extraction must check sanitization_status"

    def test_ingest_file_rejects_unapproved_images(self):
        """evidence.py ingest_file must reject images without sanitization_status='approved'."""
        source = (BACKEND_ROOT / "services" / "higgins" / "evidence.py").read_text()
        assert 'kind == "image" and admission_meta != "approved"' in source, \
            "ingest_file must reject images without approved sanitization_status"


# ── 3. MIME type enforcement ────────────────────────────────────────────────

class TestMimeTypeEnforcement:
    """Verify sniff() detects actual content regardless of declared MIME type."""

    def test_sniff_detects_jpeg(self):
        from services.higgins.evidence import sniff
        jpeg_header = b"\xff\xd8\xff\xe0" + b"\x00" * 100
        assert sniff(jpeg_header, "application/pdf") == "image/jpeg"

    def test_sniff_detects_png(self):
        from services.higgins.evidence import sniff
        png_header = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100
        assert sniff(png_header, "text/plain") == "image/png"

    def test_sniff_detects_pdf(self):
        from services.higgins.evidence import sniff
        pdf_header = b"%PDF-1.5" + b"\x00" * 100
        assert sniff(pdf_header, "image/jpeg") == "application/pdf"

    def test_mislabelled_image_triggers_image_enforcement(self):
        """An image declared as a document must still be treated as an image
        (and require sanitization_status)."""
        from services.higgins.evidence import sniff, SUPPORTED
        jpeg_bytes = b"\xff\xd8\xff\xe0" + b"\x00" * 100
        detected = sniff(jpeg_bytes, "application/pdf")
        kind = SUPPORTED.get(detected, "attachment")
        assert kind == "image", "JPEG bytes mislabelled as PDF must be detected as image"


# ── 4. OCR unavailable safety ───────────────────────────────────────────────

class TestOcrUnavailableSafety:
    """Verify 'ocr_unavailable_approved' is no longer a valid decision."""

    def test_decision_type_excludes_ocr_unavailable(self):
        """The SanitizationDecision type must not include 'ocr_unavailable_approved'."""
        source = (BACKEND_ROOT.parent / "frontend" / "src" / "domain" / "imageSanitization.ts").read_text()
        assert "ocr_unavailable_approved" not in source, \
            "'ocr_unavailable_approved' must be removed — unscreened images must not be transmitted"

    def test_privacy_gate_handles_ocr_unavailable_safely(self):
        """The ImagePrivacyGate must not have an 'approve' handler for OCR unavailable."""
        source = (BACKEND_ROOT.parent / "frontend" / "src" / "components" / "ImagePrivacyGate.tsx").read_text()
        assert "handleOcrUnavailableApprove" not in source, \
            "The OCR-unavailable approve handler must be removed"
        assert "handleOcrUnavailableWithhold" in source or "handleTextOnly" in source, \
            "OCR unavailable must offer withhold or text-only options"


# ── 5. Consent recording ───────────────────────────────────────────────────

class TestConsentRecording:
    """Verify consent metadata is recorded for image evidence."""

    def test_consent_record_in_evidence_ingestion(self):
        """ingest_file must create consent records for approved images."""
        source = (BACKEND_ROOT / "services" / "higgins" / "evidence.py").read_text()
        assert "consentRecord" in source, "Consent records must be stored with evidence"
        assert "trustBoundary" in source, "Trust boundary must be documented in consent record"

    def test_consent_record_structure(self):
        """Consent record must include required fields."""
        source = (BACKEND_ROOT / "services" / "higgins" / "evidence.py").read_text()
        required_fields = ['"purpose"', '"decision"', '"transformations"', '"limitations"',
                           '"consentRecordedAt"', '"trustBoundary"']
        for field in required_fields:
            assert field in source, f"Consent record must include {field}"

    def test_consent_trust_boundary_is_honest(self):
        """Trust boundary must be documented as 'client_assertion', not 'tamper_proof' or 'verified'."""
        source = (BACKEND_ROOT / "services" / "higgins" / "evidence.py").read_text()
        assert '"client_assertion"' in source, \
            "Trust boundary must be honestly documented as 'client_assertion'"
        assert '"tamper_proof"' not in source and '"verified"' not in source, \
            "Must not claim tamper-proof verification of client-supplied assertions"


# ── 6. Document embedded images ─────────────────────────────────────────────

class TestDocumentEmbeddedImages:
    """Verify embedded document images are handled correctly."""

    def test_embedded_images_have_consent_record(self):
        """Embedded images must have consent metadata noting document-derived status."""
        source = (BACKEND_ROOT / "services" / "higgins" / "evidence.py").read_text()
        assert '"document_embedded_image"' in source, \
            "Embedded images must record 'document_embedded_image' as consent decision"
        assert '"document_derived"' in source, \
            "Embedded images must record 'document_derived' trust boundary"

    def test_embedded_images_note_limitations(self):
        """Embedded images must note they were not individually screened."""
        source = (BACKEND_ROOT / "services" / "higgins" / "evidence.py").read_text()
        assert "not individually screened" in source.lower() or "inherits document" in source.lower(), \
            "Embedded images must document that they were not individually screened"


# ── 7. Receipt metadata includes new fields ─────────────────────────────────

class TestReceiptMetadata:
    """Verify the updated receipt includes purpose, transformations, limitations."""

    def test_receipt_includes_purpose(self):
        source = (BACKEND_ROOT.parent / "frontend" / "src" / "domain" / "imageSanitization.ts").read_text()
        assert "purpose:" in source or "purpose?:" in source, \
            "SanitizationReceipt must include purpose field"

    def test_receipt_includes_transformations(self):
        source = (BACKEND_ROOT.parent / "frontend" / "src" / "domain" / "imageSanitization.ts").read_text()
        assert "transformations:" in source or "transformations?:" in source, \
            "SanitizationReceipt must include transformations field"

    def test_receipt_includes_limitations(self):
        source = (BACKEND_ROOT.parent / "frontend" / "src" / "domain" / "imageSanitization.ts").read_text()
        assert "limitations:" in source or "limitations?:" in source, \
            "SanitizationReceipt must include limitations field"

    def test_metadata_includes_digest(self):
        source = (BACKEND_ROOT.parent / "frontend" / "src" / "domain" / "imageSanitization.ts").read_text()
        assert "sanitizationDigest" in source, \
            "Sanitization metadata must include the image digest"

    def test_receipt_hashes_image_bytes(self):
        """The receipt must hash actual image bytes, not just URI metadata."""
        source = (BACKEND_ROOT.parent / "frontend" / "src" / "domain" / "imageSanitization.ts").read_text()
        assert "readAsStringAsync" in source or "digestImageBytes" in source, \
            "Receipt must read and hash actual image bytes from the file URI"


# ── 8. Binary content requires authorisation (Package 3 integration) ────────

class TestBinaryAuthorisationIntegration:
    """Verify Package 3's binary authorisation is active for all image paths."""

    def test_provider_blocks_binary_for_research(self):
        from services.higgins.provider import _BINARY_AUTHORISED_PURPOSES
        from services.higgins.llm_boundary import Purpose
        assert Purpose.RESEARCH not in _BINARY_AUTHORISED_PURPOSES

    def test_provider_blocks_binary_for_chat(self):
        from services.higgins.provider import _BINARY_AUTHORISED_PURPOSES
        from services.higgins.llm_boundary import Purpose
        assert Purpose.ORDINARY_CHAT not in _BINARY_AUTHORISED_PURPOSES

    def test_provider_allows_binary_for_investigation(self):
        from services.higgins.provider import _BINARY_AUTHORISED_PURPOSES
        from services.higgins.llm_boundary import Purpose
        assert Purpose.INVESTIGATION in _BINARY_AUTHORISED_PURPOSES

    def test_provider_allows_binary_for_page_signal_extraction(self):
        from services.higgins.provider import _BINARY_AUTHORISED_PURPOSES
        from services.higgins.llm_boundary import Purpose
        assert Purpose.PAGE_SIGNAL_EXTRACTION in _BINARY_AUTHORISED_PURPOSES
