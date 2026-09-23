"""Gate 3 purpose-limited page-crawl contract and SSRF boundary tests."""
from __future__ import annotations

import os
from pathlib import Path

import pytest
import requests

def _base_url() -> str:
    base = os.environ.get("EXPO_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    if not base:
        env_file = Path(__file__).resolve().parents[2] / "frontend" / ".env"
        if env_file.exists():
            for line in env_file.read_text().splitlines():
                if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                    base = line.split("=", 1)[1].strip()
                    break
                if line.startswith("EXPO_BACKEND_URL="):
                    base = line.split("=", 1)[1].strip()
                    break
    if not base:
        raise RuntimeError("EXPO_PUBLIC_BACKEND_URL (or EXPO_BACKEND_URL) is required")
    return base.rstrip("/")


BASE_URL = _base_url()


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", "User-Agent": "apollo-test"})
    return s


@pytest.mark.credentialed_integration
def test_page_crawl_reads_a_public_page_with_bounded_static_inspection(api):
    r = api.post(f"{BASE_URL}/api/page/crawl", json={"device_id": "gate3crawl0001", "url": "https://example.com"}, timeout=20)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["signals"]["visible_url"] == "https://example.com/"
    assert data["final_url"] == "https://example.com/"


def test_page_crawl_contract_is_stable_for_private_input(api):
    target = "http://127.0.0.1:8001/api/health"
    r = api.post(f"{BASE_URL}/api/page/crawl", json={"device_id": "gate3crawl0002", "url": target}, timeout=20)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["error"] == "invalid_target"
    assert data["signals"] is None and data["higgins_note"] is None
