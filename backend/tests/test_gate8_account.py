# Gate 8 — local-first account policy tests.
import os
import uuid
from datetime import datetime, timezone
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


@pytest.fixture
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture
def device_id():
    return f"gate8dev{uuid.uuid4().hex[:16]}"


def _analyse(api_client, device_id, **over):
    body = {"device_id": device_id, "kind": "security_alert", "provider": "microsoft", "sender": "", "text": "", "urls": [], "local_state": "ears_up", "scenario": "AC16", "second_opinion": False}
    body.update(over)
    return api_client.post(f"{BASE_URL}/api/account/analyse", json=body, timeout=40)


class TestAccountAnalyse:
    def test_raw_account_alert_cloud_processing_is_blocked(self, api_client, device_id):
        r = _analyse(
            api_client,
            device_id,
            text="Unusual sign-in. Verify now https://phishing.apollo.test/login",
            urls=["https://phishing.apollo.test/login"],
            local_state="barking",
            scenario="AC15",
            second_opinion=True,
        )
        assert r.status_code == 403, r.text

    def test_local_only_minimal_payload_succeeds(self, api_client, device_id):
        r = _analyse(
            api_client,
            device_id,
            sender="",
            text="[local-only]",
            urls=["https://myaccount.google.com/login?token=secret"],
            second_opinion=False,
            provider="google",
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["gemini_used"] is False
        assert isinstance(data["urls"], list)

    def test_validation(self, api_client, device_id):
        assert _analyse(api_client, device_id, local_state="not_a_state").status_code == 422


class TestBreachCheck:
    def test_breach_lookup_is_intentionally_disabled(self, api_client, device_id):
        r = api_client.post(f"{BASE_URL}/api/account/breach", json={"device_id": device_id, "identifier": "test@example.com"}, timeout=30)
        assert r.status_code == 403, r.text


class TestPatrolAccountEvents:
    def test_create_account_event(self, api_client, device_id):
        event_id = f"acct{uuid.uuid4().hex[:16]}"
        body = {"event_id": event_id, "device_id": device_id, "category": "account", "state": "barking", "status": "active", "headline": "Account: Login prompt you didn't start — Microsoft",
                "what_happened": "Don't approve this login.", "why": ["x"], "what_to_do": "Deny it.", "verified_block": False, "adapter_label": "Identity & Account Engine",
                "occurred_at": datetime.now(timezone.utc).isoformat(), "background": False, "claimed_brand": "Microsoft", "scenario": "AC01", "scent_id": event_id}
        r = api_client.post(f"{BASE_URL}/api/patrol/events", json=body)
        assert r.status_code == 200, r.text
        assert r.json()["category"] == "account"
