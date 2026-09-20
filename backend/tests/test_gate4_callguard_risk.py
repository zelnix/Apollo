# Call Gate purpose-limited reputation lookup.
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
    def test_call_risk_lookup_returns_higgins_warning_not_block(self, api):
        number = "+61293744000"
        r = api.post(f"{BASE_URL}/api/call/risk-check", json={"device_id": "callrisk0001", "number": number, "country": "AU"}, timeout=40)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["higgins"]["warning_only"] is True
        assert data["higgins"]["next_action"]
        assert "authenticate" in data["higgins"]["could_not_establish"].lower()
        assessment = data["assessment"]
        assert assessment["sources"][0]["evidence_kind"] == "external_verification"
        assert assessment["sources"][0]["checked_at"]
        assert assessment["findings"][0]["status"] in {"suspicious", "unresolved"}
        assert "does not authenticate" in assessment["sources"][0]["detail"].lower()
        assert assessment["processing"]["raw_retained_by_apollo"] is False

    def test_requires_auth(self):
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json", "X-Apollo-Raw": "1"})
        r = s.post(f"{BASE_URL}/api/call/risk-check", json={"device_id": "x" * 10, "number": "+18007132618"}, timeout=TIMEOUT)
        assert r.status_code == 401, r.text
