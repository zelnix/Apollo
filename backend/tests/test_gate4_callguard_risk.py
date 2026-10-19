# Call Gate purpose-limited reputation lookup.
#
# Current response model (CallRiskResponse): number, valid, active, fraud_score,
# recent_abuse, risky, voip, line_type, carrier, country, decision, cached,
# checked_at, source, higgins (dict), assessment (phone_reputation_observation dict).
#
# The higgins dict contains: headline, found, why, could_not_establish,
# next_action, exact_response, warning_only.
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
TIMEOUT = 40


@pytest.fixture
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


class TestCallRiskCheck:
    def test_call_risk_lookup_returns_reputation_observation(self, api):
        """Risk-check returns a decision, higgins warning, and reputation observation."""
        number = "+61293744000"
        r = api.post(f"{BASE_URL}/api/call/risk-check",
                     json={"device_id": "callrisk0001", "number": number, "country": "AU"},
                     timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        data = r.json()
        # Higgins warning — always advisory, never a block
        assert data["higgins"]["warning_only"] is True
        assert data["higgins"]["next_action"]
        # Decision is one of allow, review, avoid, unknown
        assert data["decision"] in ("allow", "review", "avoid", "unknown")
        # Assessment is a phone_reputation_observation
        assessment = data["assessment"]
        assert assessment is not None
        assert assessment.get("type") == "phone_reputation_observation"
        assert assessment.get("source") in ("ipqualityscore", "not_configured", "unavailable")

    def test_requires_auth(self):
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json", "X-Apollo-Raw": "1"})
        r = s.post(f"{BASE_URL}/api/call/risk-check",
                   json={"device_id": "x" * 10, "number": "+18007132618"},
                   timeout=TIMEOUT)
        assert r.status_code == 401, r.text
