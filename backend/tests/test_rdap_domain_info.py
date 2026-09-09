"""RDAP domain-info feature (additive to /api/intel/check).

Covers:
- domain_info shape + correctness for a well-known domain (google.com).
- Mongo cache (domain_info_cache, 48h TTL) reuse on second identical call.
- domain_info included when expand=true (redirect-following path).
- Best-effort behaviour for a domain with no resolvable TLD/registry (never fails/hangs the request).
- Non-URL indicator_type ("domain") also gets a domain_info lookup.
"""
import os
import time

import pytest
import requests

BASE_URL = (os.environ.get("EXPO_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    # register a real device + bearer token (this suite is auth-required, no shim)
    r = sess.post(f"{API}/devices/register", json={"platform": "web", "adapter_mode": "mock"}, timeout=15)
    assert r.status_code == 201, r.text
    token = r.json()["device_token"]
    sess.headers.update({"Authorization": f"Bearer {token}"})
    return sess


class TestDomainInfoBasic:
    def test_google_domain_info_shape(self, s):
        r = s.post(f"{API}/intel/check", json={"indicator_type": "url", "value": "https://google.com"}, timeout=15)
        assert r.status_code == 200, r.text
        di = r.json().get("domain_info")
        assert di is not None
        assert di["domain"] == "google.com"
        assert di["registrar"] == "MarkMonitor Inc."
        assert di["registered_at"] is not None
        assert di["rdap_server"] == "https://rdap.verisign.com/com/v1/"
        assert di["available"] is True
        assert di["error"] is None
        assert di["newly_registered"] is False
        assert isinstance(di["age_days"], int) and di["age_days"] > 1000

    def test_second_call_cached_same_data(self, s):
        r1 = s.post(f"{API}/intel/check", json={"indicator_type": "url", "value": "https://google.com"}, timeout=15)
        t0 = time.time()
        r2 = s.post(f"{API}/intel/check", json={"indicator_type": "url", "value": "https://google.com"}, timeout=15)
        elapsed = time.time() - t0
        assert r1.status_code == 200 and r2.status_code == 200
        assert r1.json()["domain_info"] == r2.json()["domain_info"]
        assert elapsed < 3, f"cached call took too long: {elapsed}s"

    def test_expand_true_includes_domain_info(self, s):
        r = s.post(f"{API}/intel/check", json={"indicator_type": "url", "value": "https://apple.com", "expand": True}, timeout=30)
        assert r.status_code == 200, r.text
        di = r.json().get("domain_info")
        assert di is not None
        assert di["domain"] == "apple.com"
        assert di["available"] is True

    def test_domain_indicator_type_lookup(self, s):
        r = s.post(f"{API}/intel/check", json={"indicator_type": "domain", "value": "microsoft.com"}, timeout=15)
        assert r.status_code == 200, r.text
        di = r.json().get("domain_info")
        assert di is not None
        assert di["domain"] == "microsoft.com"
        assert di["available"] is True


class TestDomainInfoBestEffort:
    def test_bad_tld_never_fails_request(self, s):
        t0 = time.time()
        r = s.post(f"{API}/intel/check", json={"indicator_type": "url", "value": "https://example.doesnotexist123"}, timeout=15)
        elapsed = time.time() - t0
        assert r.status_code == 200, r.text
        assert elapsed < 10, f"request took too long: {elapsed}s"
        data = r.json()
        assert data["verdict"] in ("clean", "malicious", "unknown")
        di = data.get("domain_info")
        # best-effort: either omitted, or present with available=False
        if di is not None:
            assert di["available"] is False
