"""Gate 3 Phase C — POST /api/page/crawl ("Let Apollo read the page").

Backend fetches the page's live HTML server-side (SSRF-safe, see services/webcrawl.py),
extracts text/forms/buttons/links, sends to Gemini for PageSignals + higgins_note.
Content is never stored/cached. Backend calls Gemini live (a few seconds to ~20s per request)."""
from __future__ import annotations

import os
import time

import pytest
import requests

BASE_URL = (os.environ.get("EXPO_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://threat-patrol-1.preview.emergentagent.com").rstrip("/")
HEADERS = {"Content-Type": "application/json", "User-Agent": "Mozilla/5.0 apollo-test"}
GEMINI_TIMEOUT = 40
SSRF_TIMEOUT = 20

SIGNAL_KEYS = {
    "visible_url", "claimed_brand", "page_type", "asks_for",
    "virus_or_infection_claim", "phone_number_to_call", "remote_access_tool",
    "captcha_instructions", "wallet_connect_request", "urgency_or_threat_text",
    "prices_look_unrealistic", "payment_methods", "business_identity",
    "os_or_security_branding", "text_excerpt",
}


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update(HEADERS)
    return s


class TestPageCrawlHappyPath:
    def test_real_benign_url(self, api):
        body = {"device_id": "gate3crawl0001", "url": "https://example.com"}
        r = api.post(f"{BASE_URL}/api/page/crawl", json=body, timeout=GEMINI_TIMEOUT)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["error"] is None, data
        assert data["signals"] is not None
        assert SIGNAL_KEYS.issubset(data["signals"].keys()), f"missing: {SIGNAL_KEYS - data['signals'].keys()}"
        assert data["higgins_note"], "higgins_note should be a non-empty descriptive string"
        assert isinstance(data["higgins_note"], str)
        assert data["final_url"] is not None
        assert data["gemini_used"] is True
        # benign page should not hallucinate scam signals
        assert data["signals"]["virus_or_infection_claim"] is False, data["signals"]
        assert data["signals"]["asks_for"] == [] or isinstance(data["signals"]["asks_for"], list)
        assert data["signals"]["page_type"] in ("article", "other", "download"), data["signals"]

    def test_real_url_strava_docs(self, api):
        body = {"device_id": "gate3crawl0002", "url": "https://developers.strava.com/"}
        r = api.post(f"{BASE_URL}/api/page/crawl", json=body, timeout=GEMINI_TIMEOUT)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["error"] is None, data
        assert data["signals"] is not None
        assert data["gemini_used"] is True
        # brand should roughly match the real site (case-insensitive substring)
        brand = (data["signals"]["claimed_brand"] or "").lower()
        assert "strava" in brand or brand == "", data["signals"]
        assert data["signals"]["virus_or_infection_claim"] is False, data["signals"]


class TestPageCrawlSSRF:
    @pytest.mark.parametrize("target", [
        "http://127.0.0.1:8001/api/health",
        "http://localhost:8001/api/health",
        "http://169.254.169.254/",
    ])
    def test_private_target_blocked_fast(self, api, target):
        body = {"device_id": "gate3crawl0003", "url": target}
        start = time.time()
        r = api.post(f"{BASE_URL}/api/page/crawl", json=body, timeout=SSRF_TIMEOUT)
        elapsed = time.time() - start
        assert r.status_code == 200, r.text  # never a 500
        data = r.json()
        assert data["error"] is not None, data
        assert data["signals"] is None
        assert data["detail"], "should have a friendly detail message"
        assert elapsed < 15, f"SSRF block took too long: {elapsed}s"


class TestPageCrawlInvalid:
    def test_bad_tld_degrades_gracefully(self, api):
        body = {"device_id": "gate3crawl0004", "url": "https://this-domain-does-not-exist-apollo-test-12345.doesnotexist"}
        r = api.post(f"{BASE_URL}/api/page/crawl", json=body, timeout=SSRF_TIMEOUT)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["error"] is not None, data
        assert data["signals"] is None

    def test_non_http_scheme_rejected(self, api):
        body = {"device_id": "gate3crawl0005", "url": "ftp://example.com/file"}
        r = api.post(f"{BASE_URL}/api/page/crawl", json=body, timeout=SSRF_TIMEOUT)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["error"] is not None, data
        assert data["signals"] is None

    def test_missing_device_id_rejected(self, api):
        r = api.post(f"{BASE_URL}/api/page/crawl", json={"url": "https://example.com"}, timeout=15)
        assert r.status_code == 422, r.text

    def test_empty_url_rejected(self, api):
        r = api.post(f"{BASE_URL}/api/page/crawl", json={"device_id": "gate3crawl0006", "url": ""}, timeout=15)
        assert r.status_code == 422, r.text
