"""Gate 3 purpose-limited screenshot extraction contract."""
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
    s.headers.update({"User-Agent": "apollo-test"})
    return s


def test_page_extract_rejects_invalid_image_without_persisting_it(api):
    r = api.post(f"{BASE_URL}/api/page/extract", data={"device_id": "gate3page0001"},
                 files={"file": ("page.txt", b"not an image", "text/plain")}, timeout=15)
    assert r.status_code == 415, r.text


def test_page_extract_schema_rejects_too_short_image(api):
    r = api.post(f"{BASE_URL}/api/page/extract", data={"device_id": "gate3page0002"}, timeout=15)
    assert r.status_code == 422, r.text
