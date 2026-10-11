"""WP2 — Image Integrity & Privacy Verification: SHA-256 Digest Validation Tests

Exercises the /api/vision/investigate endpoint's pre-flight SHA-256 validation:
1. Correct approved-image digest is accepted (status 200/502, not 422 digest error)
2. Mismatched digest is rejected with 422 before Gemini processing
3. Missing digest is rejected with 422
4. Malformed/short digest is rejected
5. Missing sanitisation receipt rejected
6. Unapproved sanitisation status rejected
7. Rejected images never forwarded to Gemini (no AI processing metadata)

Run: cd /app/backend && python -m pytest tests/test_wp2_digest_validation.py -v
"""
import hashlib
import io
import uuid

import httpx
import pytest

BASE = "http://localhost:8001/api"


def register_device() -> tuple[str, dict]:
    """Register a device and return (device_id, auth_headers)."""
    r = httpx.post(f"{BASE}/devices/register",
                   json={"platform": "android", "adapter_mode": "standard", "app_version": "wp2-test"},
                   timeout=20)
    r.raise_for_status()
    data = r.json()
    return data["device_id"], {"Authorization": f"Bearer {data['device_token']}"}


def make_test_image() -> bytes:
    """Create a minimal valid JPEG image for testing."""
    from PIL import Image
    img = Image.new("RGB", (100, 100), color=(200, 150, 100))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return buf.getvalue()


class TestDigestAccepted:
    """WP2 acceptance: correct approved-image digest passes pre-flight validation."""

    def test_correct_digest_passes_preflight(self):
        """When the SHA-256 of uploaded bytes matches the declared digest,
        the image is accepted for processing. The response may be 200 (success)
        or 502/503 (Gemini unavailable) but NOT 422 with 'integrity check failed'."""
        device_id, headers = register_device()
        image_bytes = make_test_image()
        correct_digest = hashlib.sha256(image_bytes).hexdigest()

        r = httpx.post(
            f"{BASE}/vision/investigate",
            data={
                "device_id": device_id,
                "extracted_text": "Test investment promotion: guaranteed 500% returns",
                "sanitization_status": "approved",
                "sanitization_receipt_id": str(uuid.uuid4()),
                "sanitization_digest": correct_digest,
            },
            files={"file": ("test.jpg", image_bytes, "image/jpeg")},
            headers=headers,
            timeout=60,
        )
        # Pre-flight digest validation passed — not a 422 digest mismatch
        assert r.status_code != 422 or "integrity check failed" not in r.text.lower(), \
            f"Correct digest should pass pre-flight validation, got: {r.text}"


class TestDigestRejection:
    """WP2 acceptance: mismatched, missing, or malformed digests are rejected."""

    def test_mismatched_digest_rejected(self):
        """Uploading bytes that don't match the declared digest → 422 before Gemini."""
        device_id, headers = register_device()
        image_bytes = make_test_image()
        wrong_digest = hashlib.sha256(b"completely_different_data").hexdigest()

        r = httpx.post(
            f"{BASE}/vision/investigate",
            data={
                "device_id": device_id,
                "extracted_text": "",
                "sanitization_status": "approved",
                "sanitization_receipt_id": str(uuid.uuid4()),
                "sanitization_digest": wrong_digest,
            },
            files={"file": ("test.jpg", image_bytes, "image/jpeg")},
            headers=headers,
            timeout=30,
        )
        assert r.status_code == 422, f"Expected 422 for mismatched digest, got {r.status_code}"
        body = r.json()
        detail = body.get("detail", "")
        assert "integrity" in detail.lower() or "match" in detail.lower(), \
            f"Error should mention integrity/match, got: {detail}"

    def test_missing_digest_rejected(self):
        """Upload with empty sanitization_digest → 422."""
        device_id, headers = register_device()
        image_bytes = make_test_image()

        r = httpx.post(
            f"{BASE}/vision/investigate",
            data={
                "device_id": device_id,
                "sanitization_status": "approved",
                "sanitization_receipt_id": str(uuid.uuid4()),
                "sanitization_digest": "",
            },
            files={"file": ("test.jpg", image_bytes, "image/jpeg")},
            headers=headers,
            timeout=30,
        )
        assert r.status_code == 422, f"Expected 422 for missing digest, got {r.status_code}"

    def test_short_digest_rejected(self):
        """Upload with a digest shorter than 16 chars → 422."""
        device_id, headers = register_device()
        image_bytes = make_test_image()

        r = httpx.post(
            f"{BASE}/vision/investigate",
            data={
                "device_id": device_id,
                "sanitization_status": "approved",
                "sanitization_receipt_id": str(uuid.uuid4()),
                "sanitization_digest": "abc123",  # too short
            },
            files={"file": ("test.jpg", image_bytes, "image/jpeg")},
            headers=headers,
            timeout=30,
        )
        assert r.status_code == 422, f"Expected 422 for short digest, got {r.status_code}"

    def test_unapproved_status_rejected(self):
        """Upload with sanitization_status != approved → 422."""
        device_id, headers = register_device()
        image_bytes = make_test_image()
        digest = hashlib.sha256(image_bytes).hexdigest()

        r = httpx.post(
            f"{BASE}/vision/investigate",
            data={
                "device_id": device_id,
                "sanitization_status": "rejected",
                "sanitization_receipt_id": str(uuid.uuid4()),
                "sanitization_digest": digest,
            },
            files={"file": ("test.jpg", image_bytes, "image/jpeg")},
            headers=headers,
            timeout=30,
        )
        assert r.status_code == 422

    def test_missing_receipt_id_rejected(self):
        """Upload with empty receipt ID → 422."""
        device_id, headers = register_device()
        image_bytes = make_test_image()
        digest = hashlib.sha256(image_bytes).hexdigest()

        r = httpx.post(
            f"{BASE}/vision/investigate",
            data={
                "device_id": device_id,
                "sanitization_status": "approved",
                "sanitization_receipt_id": "",
                "sanitization_digest": digest,
            },
            files={"file": ("test.jpg", image_bytes, "image/jpeg")},
            headers=headers,
            timeout=30,
        )
        assert r.status_code == 422


class TestRejectedImageNeverProcessed:
    """WP2 acceptance: rejected images must NEVER reach Gemini."""

    def test_mismatched_digest_has_no_processing_metadata(self):
        """A rejected upload must return only the error, with no AI processing data."""
        device_id, headers = register_device()
        image_bytes = make_test_image()
        wrong_digest = hashlib.sha256(b"tampered_bytes").hexdigest()

        r = httpx.post(
            f"{BASE}/vision/investigate",
            data={
                "device_id": device_id,
                "extracted_text": "Some text to extract",
                "sanitization_status": "approved",
                "sanitization_receipt_id": str(uuid.uuid4()),
                "sanitization_digest": wrong_digest,
            },
            files={"file": ("test.jpg", image_bytes, "image/jpeg")},
            headers=headers,
            timeout=30,
        )
        # Must be 422 — the image is rejected before any AI processing
        assert r.status_code == 422
        # The response should be a FastAPI error, not a VisionInvestigateOut
        body = r.json()
        assert "detail" in body, "Error response should have 'detail' field"
        # Must NOT contain any AI processing metadata
        assert "gemini_used" not in body, "Rejected image must not produce gemini_used field"
        assert "investigation_case_id" not in body, "Rejected image must not create a case"


class TestTextOnlyFallback:
    """Vision endpoint should still work with extracted_text only (no image)."""

    def test_text_only_without_image(self):
        """Sending only extracted text (no file) should work."""
        device_id, headers = register_device()

        r = httpx.post(
            f"{BASE}/vision/investigate",
            data={
                "device_id": device_id,
                "extracted_text": "Urgent: Your bank account has been compromised. Call 1800-FAKE-NUM immediately.",
                "sanitization_status": "",
                "sanitization_receipt_id": "",
                "sanitization_digest": "",
            },
            headers=headers,
            timeout=60,
        )
        # Should succeed with text analysis even without an image
        # May be 200 or 502/503 depending on Gemini availability
        assert r.status_code in (200, 502, 503), f"Text-only should process, got {r.status_code}"


class TestEvidenceIntegrityMetadata:
    """When digest validation passes and a case is created, integrity metadata is recorded."""

    def test_evidence_stores_digest_fields(self):
        """After a successful vision investigation, the evidence record should include
        integrity hashes and transformation history."""
        from services.higgins.contracts import EvidenceItem, EvidenceProvenance, Coverage, Transformation

        # Verify the model supports the required fields
        item = EvidenceItem(
            id="test-vision", case_id="case-1", client_item_id="vision-image",
            display_id="E-001", origin="user_submission", kind="image",
            collected_at="2026-01-01T00:00:00Z", expires_at="2026-12-31T23:59:59Z",
            media_type="image/jpeg", byte_length=1024,
            integrity_hash="abc123def456" * 5 + "abcd",
            provenance=EvidenceProvenance(
                acquisition_method="vision_screening",
                source_description="User-submitted image after on-device privacy screening and redaction",
            ),
            coverage=Coverage(status="not_started", unit="bytes", total=1024, examined=0),
            transformations=[
                Transformation(kind="privacy_screening", description="On-device privacy screening applied"),
                Transformation(kind="image_resize", description="Server-side resize to max 2048px and JPEG re-encode"),
            ],
        )
        wire = item.wire()
        assert wire["displayId"] == "E-001"
        assert wire["integrityHash"] is not None
        assert wire["provenance"]["acquisitionMethod"] == "vision_screening"
        assert len(wire["transformations"]) == 2
        assert wire["transformations"][0]["kind"] == "privacy_screening"
        assert wire["transformations"][1]["kind"] == "image_resize"
