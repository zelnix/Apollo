# Call Guard add-on under local-first policy.
# Number cloud lookups are intentionally disabled (403).
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
TIMEOUT = 20


@pytest.fixture
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


class TestCallRiskCheck:
    def test_call_risk_lookup_is_intentionally_disabled(self, api):
        r = api.post(f"{BASE_URL}/api/call/risk-check", json={"device_id": "callrisk0001", "number": "+18007132618"}, timeout=TIMEOUT)
        assert r.status_code == 403, r.text
        assert "local-first privacy policy" in r.json().get("detail", "")

    def test_requires_auth(self):
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json", "X-Apollo-Raw": "1"})
        r = s.post(f"{BASE_URL}/api/call/risk-check", json={"device_id": "x" * 10, "number": "+18007132618"}, timeout=TIMEOUT)
        assert r.status_code == 403, r.text
