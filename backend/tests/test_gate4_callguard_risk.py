# Call Guard add-on — POST /api/call/risk-check (IPQualityScore phone fraud/spam risk scoring).
# Hits the real backend (which hits the real IPQS API with the configured key) — same convention as
# test_gate3_page_crawl.py's live Gemini calls. Uses IPQS's own documented test number.
import os
import uuid

import pytest
import requests

BASE_URL = (os.environ.get("EXPO_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://threat-patrol-1.preview.emergentagent.com").rstrip("/")
TIMEOUT = 20


@pytest.fixture
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture
def device_id():
    return f"callrisk{uuid.uuid4().hex[:16]}"


class TestCallRiskCheck:
    def test_valid_e164_number_returns_score(self, api, device_id):
        r = api.post(f"{BASE_URL}/api/call/risk-check", json={"device_id": device_id, "number": "+18007132618"}, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["number"] == "+18007132618"
        assert data["decision"] in ("allow", "review", "avoid")
        assert data["source"] == "ipqualityscore"
        assert data["fraud_score"] is None or (isinstance(data["fraud_score"], int) and 0 <= data["fraud_score"] <= 100)
        assert "checked_at" in data

    def test_local_number_without_country_is_rejected(self, api, device_id):
        r = api.post(f"{BASE_URL}/api/call/risk-check", json={"device_id": device_id, "number": "4155552671"}, timeout=TIMEOUT)
        assert r.status_code == 422, r.text

    def test_local_number_with_country_is_accepted(self, api, device_id):
        r = api.post(f"{BASE_URL}/api/call/risk-check", json={"device_id": device_id, "number": "8007132618", "country": "US"}, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        assert r.json()["number"] == "+18007132618"

    def test_garbage_number_is_rejected(self, api, device_id):
        r = api.post(f"{BASE_URL}/api/call/risk-check", json={"device_id": device_id, "number": "not-a-number"}, timeout=TIMEOUT)
        assert r.status_code == 422, r.text

    def test_second_lookup_is_served_from_cache(self, api, device_id):
        # Mongo's cache persists across test runs, so the FIRST call here may already be a hit from an
        # earlier run — only assert what this test can actually guarantee: back-to-back calls agree,
        # and the second of the two is definitely served from cache.
        body = {"device_id": device_id, "number": "+442071838750"}
        first = api.post(f"{BASE_URL}/api/call/risk-check", json=body, timeout=TIMEOUT)
        assert first.status_code == 200, first.text
        second = api.post(f"{BASE_URL}/api/call/risk-check", json=body, timeout=TIMEOUT)
        assert second.status_code == 200, second.text
        assert second.json()["cached"] is True
        assert second.json()["fraud_score"] == first.json()["fraud_score"]

    def test_missing_device_id_rejected(self, api):
        r = api.post(f"{BASE_URL}/api/call/risk-check", json={"number": "+18007132618"}, timeout=TIMEOUT)
        assert r.status_code == 422, r.text

    def test_requires_auth(self):
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json", "X-Apollo-Raw": "1"})
        r = s.post(f"{BASE_URL}/api/call/risk-check", json={"device_id": "x" * 10, "number": "+18007132618"}, timeout=TIMEOUT)
        assert r.status_code in (401, 403), r.text
