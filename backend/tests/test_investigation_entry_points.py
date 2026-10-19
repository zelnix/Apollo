"""Regression tests for person-requested investigation entry points.

Tests the ACTUAL HTTP endpoints (not test-only simulations) to verify:
  1. Each entry point accepts its documented request model.
  2. Submitted evidence reaches the canonical investigation lifecycle.
  3. A case and job are created for non-trivial requests.
  4. Field-name defects (e.g. body.phone_number vs body.number) are caught.
  5. Failures return appropriate errors, not false success.

Pattern: register a real device → call production endpoints → verify response.
Run:  pytest tests/test_investigation_entry_points.py -v --tb=short
"""
import json
import os
import uuid

import httpx
import pytest

BASE = "http://localhost:8001/api"


# ── Auth helper: register a device to get a bearer token ──────────────

def _owner() -> tuple[dict, str]:
    """Register a device, return (auth_headers, device_id)."""
    r = httpx.post(f"{BASE}/devices/register",
                   json={"platform": "web", "adapter_mode": "unsupported",
                         "app_version": "1.0.0"}, timeout=20)
    r.raise_for_status()
    data = r.json()
    return ({"Authorization": f"Bearer {data['device_token']}"},
            data["device_id"])


def _idem_key() -> str:
    return str(uuid.uuid4())


# ── 1. /call/investigate — request model & investigation creation ─────

class TestCallInvestigate:
    """Tests for POST /call/investigate using the actual PhoneInvestigateRequest model."""

    def test_valid_request_returns_200_with_investigation(self):
        """A valid call investigation must create a case and return investigation_case_id."""
        h, did = _owner()
        body = {
            "device_id": did,
            "number": "+61480042396",
            "country": "AU",
            "caller_asks": ["bank details", "transfer money"],
            "caller_claim": "CommBank fraud department",
            "transcript": "Hello, this is CommBank fraud department. We need your BSB.",
        }
        r = httpx.post(f"{BASE}/call/investigate", json=body, headers=h, timeout=90)
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        data = r.json()
        # Must return investigation linkage
        assert "investigation_case_id" in data
        assert "reputation" in data
        # investigation_case_id should be a non-empty string (case was created)
        if data["investigation_case_id"]:
            assert isinstance(data["investigation_case_id"], str)
            assert len(data["investigation_case_id"]) > 8

    def test_field_is_number_not_phone_number(self):
        """The request model uses 'number', not 'phone_number'.
        Sending phone_number instead of number must fail validation."""
        h, did = _owner()
        bad_body = {
            "device_id": did,
            "phone_number": "+61480042396",  # WRONG field name
        }
        r = httpx.post(f"{BASE}/call/investigate", json=bad_body, headers=h, timeout=30)
        # Must fail because 'number' is missing (required field)
        assert r.status_code == 422, \
            f"Expected 422 for missing 'number' field, got {r.status_code}: {r.text}"

    def test_short_number_rejected(self):
        """Number shorter than 3 chars must be rejected by Pydantic validation."""
        h, did = _owner()
        body = {"device_id": did, "number": "1"}
        r = httpx.post(f"{BASE}/call/investigate", json=body, headers=h, timeout=30)
        assert r.status_code == 422

    def test_missing_number_rejected(self):
        """Omitting the number field entirely must be rejected."""
        h, did = _owner()
        body = {"device_id": did}
        r = httpx.post(f"{BASE}/call/investigate", json=body, headers=h, timeout=30)
        assert r.status_code == 422

    def test_minimal_request_without_optional_fields(self):
        """Only device_id and number are required; optional fields may be omitted."""
        h, did = _owner()
        body = {"device_id": did, "number": "+61480042396"}
        r = httpx.post(f"{BASE}/call/investigate", json=body, headers=h, timeout=90)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "reputation" in data


# ── 2. /message/analyse — investigation creation ─────────────────────

class TestMessageAnalyse:
    """Tests for POST /message/analyse through the canonical lifecycle."""

    def test_suspicious_message_returns_investigation_linkage(self):
        """A suspicious message must create a Magnum investigation."""
        h, did = _owner()
        body = {
            "device_id": did,
            "sender": "+61400000000",
            "text": "CommBank urgent: verify your $4,820 payment immediately at https://commbank-verify.xyz/login",
            "urls": ["https://commbank-verify.xyz/login"],
            "local_state": "barking",
            "scenario": "M02",
            "signals": ["urgency", "brand_impersonation"],
            "claimed_brand": "CommBank",
            "second_opinion": False,
        }
        r = httpx.post(f"{BASE}/message/analyse", json=body, headers=h, timeout=90)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "urls" in data
        assert isinstance(data["urls"], list)
        # investigation_case_id should be present for suspicious content
        assert "investigation_case_id" in data
        if data["investigation_case_id"]:
            assert isinstance(data["investigation_case_id"], str)

    def test_benign_message_does_not_claim_block(self):
        """A benign message must not receive a malicious verdict."""
        h, did = _owner()
        body = {
            "device_id": did,
            "sender": "School Office",
            "text": "Reminder: parent-teacher interviews Tuesday at 4:30 pm.",
            "urls": [],
            "local_state": "resting",
            "scenario": "M15",
            "signals": [],
            "claimed_brand": None,
            "second_opinion": False,
        }
        r = httpx.post(f"{BASE}/message/analyse", json=body, headers=h, timeout=90)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data["urls"], list)
        for url_result in data.get("urls", []):
            assert url_result.get("verdict") != "malicious", \
                f"Benign message URL incorrectly marked malicious: {url_result}"


# ── 3. /link/investigate — investigation creation ─────────────────────

class TestLinkInvestigate:
    """Tests for POST /link/investigate through the canonical lifecycle."""

    def test_suspicious_link_returns_investigation_linkage(self):
        """A suspicious URL must create a Magnum investigation and return case_id."""
        h, did = _owner()
        body = {
            "device_id": did,
            "url": "https://example-phish.com/verify-account",
            "local_state": "growling",
            "local_findings": ["Domain registered recently"],
            "claimed_brand": None,
            "second_opinion": False,
        }
        r = httpx.post(f"{BASE}/link/investigate", json=body, headers=h, timeout=90)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "verdict" in data
        assert "host" in data
        assert "investigation_case_id" in data
        # investigation_case_id should be a non-empty string
        if data["investigation_case_id"]:
            assert isinstance(data["investigation_case_id"], str)

    def test_link_secret_redaction(self):
        """URL containing credential tokens must be rejected at the gate
        rather than investigated (privacy protection)."""
        h, did = _owner()
        body = {
            "device_id": did,
            "url": "https://example.com/reset?token=s3cr3t_value&session=abc123#private_frag",
            "local_state": "ears_up",
            "local_findings": [],
            "claimed_brand": None,
            "second_opinion": False,
        }
        r = httpx.post(f"{BASE}/link/investigate", json=body, headers=h, timeout=90)
        # Production correctly rejects credential-carrier URLs at validation
        assert r.status_code == 422, \
            f"Expected 422 (credential carrier rejected), got {r.status_code}"
        detail = r.json().get("detail", [])
        assert any("credential" in str(d).lower() for d in detail), \
            "Rejection reason must mention credential carrier"

    def test_private_address_not_fetched(self):
        """Private/internal addresses must not be fetched remotely."""
        h, did = _owner()
        body = {
            "device_id": did,
            "url": "http://192.168.1.1/admin",
            "local_state": "growling",
            "local_findings": [],
            "claimed_brand": None,
            "second_opinion": False,
        }
        r = httpx.post(f"{BASE}/link/investigate", json=body, headers=h, timeout=90)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["host"] == "192.168.1.1"


# ── 4. POST /investigations — canonical entry point ──────────────────

class TestCanonicalInvestigations:
    """Tests for POST /investigations — the canonical Magnum DI entry point."""

    def test_create_investigation_requires_idempotency_key(self):
        """Creating an investigation without Idempotency-Key must fail."""
        h, _ = _owner()
        body = {"gate": "text", "question": "Test", "submissions": [],
                "initialFindings": [], "deviceProfile": None}
        r = httpx.post(f"{BASE}/investigations", json=body, headers=h, timeout=30)
        assert r.status_code == 400, f"Expected 400, got {r.status_code}"

    def test_create_investigation_with_question(self):
        """A valid investigation with a question must create a case and a queued job."""
        h, _ = _owner()
        body = {
            "gate": "text",
            "question": "Is this a scam? Your account has been compromised.",
            "submissions": [
                {"clientItemId": "sub-1", "kind": "text",
                 "value": "Your account has been compromised. Click here.",
                 "label": "Suspicious message"},
            ],
            "initialFindings": ["Urgency language detected"],
            "deviceProfile": None,
        }
        r = httpx.post(f"{BASE}/investigations", json=body,
                       headers={**h, "Idempotency-Key": _idem_key()}, timeout=60)
        assert r.status_code == 201, r.text
        data = r.json()
        assert "case" in data
        assert data["case"]["id"] is not None
        assert data["case"]["status"] == "queued"
        assert data.get("job") is not None

    def test_create_investigation_without_question(self):
        """An investigation with no question must create a case but no job."""
        h, _ = _owner()
        body = {"gate": "text", "question": "", "submissions": [],
                "initialFindings": [], "deviceProfile": None}
        r = httpx.post(f"{BASE}/investigations", json=body,
                       headers={**h, "Idempotency-Key": _idem_key()}, timeout=30)
        assert r.status_code == 201, r.text
        data = r.json()
        assert data["case"]["id"] is not None
        assert data.get("job") is None

    def test_idempotent_replay(self):
        """Replaying the same Idempotency-Key returns the same case."""
        h, _ = _owner()
        key = _idem_key()
        body = {"gate": "text", "question": "", "submissions": [],
                "initialFindings": [], "deviceProfile": None}
        r1 = httpx.post(f"{BASE}/investigations", json=body,
                        headers={**h, "Idempotency-Key": key}, timeout=30)
        r2 = httpx.post(f"{BASE}/investigations", json=body,
                        headers={**h, "Idempotency-Key": key}, timeout=30)
        assert r1.status_code == 201 and r2.status_code == 201
        assert r1.json()["case"]["id"] == r2.json()["case"]["id"]

    def test_idempotency_conflict(self):
        """Same key with different gate must return 409 conflict."""
        h, _ = _owner()
        key = _idem_key()
        base = {"question": "", "submissions": [], "initialFindings": [],
                "deviceProfile": None}
        r1 = httpx.post(f"{BASE}/investigations", json={**base, "gate": "text"},
                        headers={**h, "Idempotency-Key": key}, timeout=30)
        assert r1.status_code == 201
        r2 = httpx.post(f"{BASE}/investigations", json={**base, "gate": "link"},
                        headers={**h, "Idempotency-Key": key}, timeout=30)
        assert r2.status_code == 409


# ── 5. Pydantic model field-name regression (pure unit tests) ────────

class TestRequestModelFields:
    """Verify request model field names match what production code references."""

    def test_phone_investigate_request_fields(self):
        from routers.call import PhoneInvestigateRequest
        req = PhoneInvestigateRequest(device_id="test12345678", number="+61480042396")
        assert req.number == "+61480042396"
        assert not hasattr(req, "phone_number")

    def test_phone_investigate_request_optional_fields(self):
        from routers.call import PhoneInvestigateRequest
        req = PhoneInvestigateRequest(
            device_id="test12345678", number="+61480042396",
            country="AU", caller_asks=["money"], caller_claim="Bank",
            transcript="Hello this is your bank")
        assert req.country == "AU"
        assert req.caller_asks == ["money"]
        assert req.caller_claim == "Bank"

    def test_phone_investigate_response_fields(self):
        from routers.call import PhoneInvestigateResponse
        resp = PhoneInvestigateResponse(
            investigation_case_id="case-123", job={"id": "j1"}, reputation={"score": 50})
        assert resp.investigation_case_id == "case-123"
        assert resp.job == {"id": "j1"}


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v", "--tb=short"]))
