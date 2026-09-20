"""Gate 3 screenshot extraction route under local-first policy.

Cloud screenshot processing stays intentionally disabled (403).
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


def test_page_extract_is_intentionally_disabled(api):
    r = api.post(f"{BASE_URL}/api/page/extract", json={"device_id": "gate3page0001", "image_base64": "A" * 200}, timeout=15)
    assert r.status_code == 403, r.text
    assert "local-first privacy policy" in r.json().get("detail", "")


def test_page_extract_contract_disabled_even_for_invalid_image(api):
    r = api.post(f"{BASE_URL}/api/page/extract", json={"device_id": "gate3page0002", "image_base64": "abc"}, timeout=15)
    assert r.status_code == 403, r.text
