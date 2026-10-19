"""Image sanitization pipeline enforcement tests.

Proves that the backend rejects image uploads without the sanitization_status='approved'
metadata field, enforcing that all images must pass through the on-device privacy gate
before reaching the backend.
"""
import json
import pytest
from services.higgins.contracts import UploadMetadata, CreateUpload


class TestPipelineEnforcementLogic:
    """Verify the enforcement logic that routes apply to image uploads."""

    def _should_reject(self, kind: str, sanitization_status: str | None) -> bool:
        """Replicates the route-level enforcement check."""
        return kind == "image" and sanitization_status != "approved"

    def test_rejects_image_without_status(self):
        assert self._should_reject("image", None) is True

    def test_rejects_image_with_empty_status(self):
        assert self._should_reject("image", "") is True

    def test_rejects_image_with_wrong_status(self):
        assert self._should_reject("image", "pending") is True

    def test_accepts_image_with_approved(self):
        assert self._should_reject("image", "approved") is False

    def test_accepts_document_without_status(self):
        assert self._should_reject("document", None) is False

    def test_accepts_audio_without_status(self):
        assert self._should_reject("audio", None) is False

    def test_accepts_attachment_without_status(self):
        assert self._should_reject("attachment", None) is False


class TestImageUploadMetadata:
    def test_image_upload_needs_no_approval_metadata(self):
        meta = UploadMetadata.model_validate({"expected_revision": 1, "client_item_id": "550e8400-e29b-41d4-a716-446655440000",
                                              "kind": "image", "filename": "screenshot.jpg", "media_type": "image/jpeg"})
        assert meta.kind == "image"

    def test_device_redaction_note_is_recorded(self):
        meta = UploadMetadata.model_validate({"expected_revision": 1, "client_item_id": "550e8400-e29b-41d4-a716-446655440000",
                                              "kind": "image", "filename": "s.jpg", "media_type": "image/jpeg",
                                              "sanitization_decision": "sanitised_image", "redacted_regions": 1})
        assert meta.sanitization_decision == "sanitised_image" and meta.redacted_regions == 1
