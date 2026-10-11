"""Evidentiary Chain — Acceptance Tests

Tests the evidence model extensions (display_id, integrity_hash, provenance),
evidence content serving, vision image storage, and evidence popup API support.

Run: cd /app/backend && python -m pytest tests/test_evidentiary_chain.py -v
"""
import hashlib
import uuid

import httpx
import pytest

from services.higgins.contracts import EvidenceItem, EvidenceProvenance, Coverage, Transformation

BASE = "http://localhost:8001/api"


def register_device() -> dict:
    r = httpx.post(f"{BASE}/devices/register", json={"platform": "android", "adapter_mode": "standard", "app_version": "1.0.0"}, timeout=20)
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['device_token']}"}


def create_case(headers: dict, gate: str, question: str, submissions: list) -> dict:
    body = {"gate": gate, "question": question, "submissions": submissions,
            "initialFindingRefs": [], "initialFindings": [], "deviceProfile": None}
    key = str(uuid.uuid4())
    r = httpx.post(f"{BASE}/investigations", json=body, headers={**headers, "Idempotency-Key": key}, timeout=30)
    assert r.status_code == 201
    return r.json()["case"]


def sub(kind: str, value: str, label: str = "") -> dict:
    return {"clientItemId": str(uuid.uuid4()), "kind": kind, "value": value, "label": label}


# ================================================================
# 1. EVIDENCE MODEL TESTS
# ================================================================

class TestEvidenceModelExtensions:
    """Verify the evidence model supports the evidentiary chain fields."""

    def test_evidence_item_has_display_id(self):
        item = EvidenceItem(id="test", case_id="case", client_item_id="client",
                            display_id="E-001", origin="user_submission", kind="text",
                            collected_at="2026-01-01T00:00:00Z", expires_at="2026-12-31T23:59:59Z")
        assert item.display_id == "E-001"

    def test_evidence_item_has_integrity_hash(self):
        test_hash = hashlib.sha256(b"test content").hexdigest()
        item = EvidenceItem(id="test", case_id="case", client_item_id="client",
                            display_id="E-001", origin="user_submission", kind="image",
                            collected_at="2026-01-01T00:00:00Z", expires_at="2026-12-31T23:59:59Z",
                            integrity_hash=test_hash)
        assert item.integrity_hash == test_hash
        assert len(item.integrity_hash) == 64  # SHA-256 hex digest

    def test_evidence_item_has_provenance(self):
        prov = EvidenceProvenance(
            acquisition_method="vision_screening",
            source_description="User-submitted image after privacy screening",
        )
        item = EvidenceItem(id="test", case_id="case", client_item_id="client",
                            display_id="E-001", origin="user_submission", kind="image",
                            collected_at="2026-01-01T00:00:00Z", expires_at="2026-12-31T23:59:59Z",
                            provenance=prov)
        assert item.provenance is not None
        assert item.provenance.acquisition_method == "vision_screening"

    def test_provenance_serialization(self):
        prov = EvidenceProvenance(
            acquisition_method="user_upload",
            source_description="User submitted text message",
            original_filename="screenshot.jpg",
        )
        wire = prov.wire()
        assert wire["acquisitionMethod"] == "user_upload"
        assert wire["originalFilename"] == "screenshot.jpg"

    def test_transformation_includes_new_kinds(self):
        t1 = Transformation(kind="privacy_screening", description="On-device privacy screening applied")
        t2 = Transformation(kind="image_resize", description="Resized for processing")
        assert t1.kind == "privacy_screening"
        assert t2.kind == "image_resize"

    def test_evidence_item_wire_includes_new_fields(self):
        prov = EvidenceProvenance(acquisition_method="external_fetch", source_description="ASIC register lookup")
        item = EvidenceItem(id="test", case_id="case", client_item_id="client",
                            display_id="E-003", origin="external_source", kind="url",
                            collected_at="2026-01-01T00:00:00Z", expires_at="2026-12-31T23:59:59Z",
                            integrity_hash="abc123", provenance=prov)
        wire = item.wire()
        assert wire["displayId"] == "E-003"
        assert wire["integrityHash"] == "abc123"
        assert wire["provenance"]["acquisitionMethod"] == "external_fetch"


# ================================================================
# 2. EVIDENCE API TESTS
# ================================================================

class TestEvidenceAPI:
    """Test the evidence listing and content APIs."""

    def test_evidence_list_has_display_ids(self):
        h = register_device()
        case = create_case(h, "email", "Check this email", [
            sub("text", "From: test@example.com"),
            sub("url", "https://example.com"),
        ])
        r = httpx.get(f"{BASE}/investigations/{case['id']}/evidence", headers=h, timeout=20)
        assert r.status_code == 200
        items = r.json()["items"]
        for item in items:
            assert "displayId" in item, "Evidence item missing displayId"

    def test_single_evidence_endpoint(self):
        h = register_device()
        case = create_case(h, "text", "Test", [sub("text", "Evidence content")])
        r = httpx.get(f"{BASE}/investigations/{case['id']}/evidence", headers=h, timeout=20)
        items = r.json()["items"]
        assert len(items) >= 1
        eid = items[0]["id"]
        r2 = httpx.get(f"{BASE}/investigations/{case['id']}/evidence/{eid}", headers=h, timeout=20)
        assert r2.status_code == 200
        assert r2.json()["evidence"]["id"] == eid

    def test_evidence_content_endpoint(self):
        h = register_device()
        case = create_case(h, "text", "Test", [sub("text", "Hello evidence world")])
        r = httpx.get(f"{BASE}/investigations/{case['id']}/evidence", headers=h, timeout=20)
        items = r.json()["items"]
        eid = items[0]["id"]
        r2 = httpx.get(f"{BASE}/investigations/{case['id']}/evidence/{eid}/content", headers=h, timeout=20)
        assert r2.status_code == 200
        assert b"Hello evidence world" in r2.content

    def test_evidence_cross_owner_isolation(self):
        h1, h2 = register_device(), register_device()
        case = create_case(h1, "text", "Private", [sub("text", "Secret evidence")])
        r = httpx.get(f"{BASE}/investigations/{case['id']}/evidence", headers=h2, timeout=20)
        assert r.status_code == 404


# ================================================================
# 3. VISION GATE CONTRACT
# ================================================================

class TestVisionGateEvidence:
    """Verify vision cases include the evidentiary chain fields."""

    def test_vision_case_evidence_has_display_ids(self):
        h = register_device()
        case = create_case(h, "vision", "Investigate this image", [
            sub("text", "Screenshot showing suspicious NAB login page at nab-secure.evil.site"),
        ])
        evidence = httpx.get(f"{BASE}/investigations/{case['id']}/evidence", headers=h, timeout=20).json()
        for item in evidence["items"]:
            assert "displayId" in item


# ================================================================
# 4. EVIDENCE MODEL SERIALIZATION
# ================================================================

class TestEvidenceChainSerialization:
    """Verify evidence model wire format for the frontend popup."""

    def test_full_evidence_wire_roundtrip(self):
        prov = EvidenceProvenance(
            acquisition_method="vision_screening",
            source_description="Privacy-screened image",
            original_filename="photo.jpg",
        )
        item = EvidenceItem(
            id="e1", case_id="case1", client_item_id="c1", display_id="E-001",
            origin="user_submission", kind="image",
            collected_at="2026-06-01T10:00:00Z", expires_at="2026-12-31T23:59:59Z",
            media_type="image/jpeg", byte_length=145000,
            integrity_hash=hashlib.sha256(b"test image data").hexdigest(),
            provenance=prov,
            coverage=Coverage(status="examined", unit="bytes", total=145000, examined=145000),
            transformations=[
                Transformation(kind="privacy_screening", description="On-device privacy screening applied"),
                Transformation(kind="image_resize", description="Resized to 1024px max dimension"),
            ],
            label="Investigated screenshot",
        )
        wire = item.wire()
        # Verify all evidentiary chain fields present
        assert wire["displayId"] == "E-001"
        assert wire["integrityHash"] is not None and len(wire["integrityHash"]) == 64
        assert wire["provenance"]["acquisitionMethod"] == "vision_screening"
        assert wire["provenance"]["originalFilename"] == "photo.jpg"
        assert wire["mediaType"] == "image/jpeg"
        assert wire["byteLength"] == 145000
        assert len(wire["transformations"]) == 2
        assert wire["transformations"][0]["kind"] == "privacy_screening"
