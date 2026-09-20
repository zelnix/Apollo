"""Gate 3 page-crawl route under local-first policy.

The route remains present for contract stability but cloud page crawling is intentionally disabled.
"""
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


def test_page_crawl_is_intentionally_disabled(api):
    r = api.post(f"{BASE_URL}/api/page/crawl", json={"device_id": "gate3crawl0001", "url": "https://example.com"}, timeout=20)
    assert r.status_code == 403, r.text
    assert "local-first privacy policy" in r.json().get("detail", "")


@pytest.mark.parametrize("target", ["http://127.0.0.1:8001/api/health", "https://example.com"]) 
def test_page_crawl_contract_is_stable_for_private_and_public_inputs(api, target):
    r = api.post(f"{BASE_URL}/api/page/crawl", json={"device_id": "gate3crawl0002", "url": target}, timeout=20)
    assert r.status_code == 403, r.text
