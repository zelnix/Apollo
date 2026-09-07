# Gate 8 — Network & Accounts backend tests.
# POST /api/account/analyse (link intel + official-domain match + optional Gemini), POST /api/account/breach
# (HIBP when configured, truthful not_configured otherwise), and Patrol events with category "account".
import os
import uuid
from datetime import datetime, timezone

import pytest
import requests

BASE_URL = (os.environ.get("EXPO_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://threat-patrol-1.preview.emergentagent.com").rstrip("/")


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
    def test_off_domain_malicious_link_flagged(self, api_client, device_id):
        r = _analyse(api_client, device_id, text="Unusual sign-in. Verify now https://phishing.apollo.test/login", urls=["https://phishing.apollo.test/login", "https://account.microsoft.com/security"], local_state="barking", scenario="AC15")
        assert r.status_code == 200, r.text
        by = {u["host"]: u for u in r.json()["urls"]}
        assert by["phishing.apollo.test"]["verdict"] == "malicious" and by["phishing.apollo.test"]["official"] is False
        assert by["account.microsoft.com"]["official"] is True

    def test_official_domain_match_is_suffix_safe(self, api_client, device_id):
        d = _analyse(api_client, device_id, provider="google", urls=["https://myaccount.google.com/x", "https://google.com.evil.top/x"]).json()
        by = {u["host"]: u["official"] for u in d["urls"]}
        assert by["myaccount.google.com"] is True and by["google.com.evil.top"] is False

    def test_password_values_are_scrubbed(self, api_client, device_id):
        # The validator rewrites "password: xyz" before anything is processed; the endpoint must still succeed.
        r = _analyse(api_client, device_id, text="Reset done. password: hunter2 — keep it safe")
        assert r.status_code == 200, r.text

    def test_validation(self, api_client, device_id):
        assert _analyse(api_client, device_id, local_state="not_a_state").status_code == 422
        # device_id validity is now enforced by device authentication (401/403), not by field length — see test_device_auth.py

    def test_second_opinion_never_errors(self, api_client, device_id):
        r = _analyse(api_client, device_id, kind="mfa_prompt", local_state="barking", scenario="AC01", second_opinion=True)
        assert r.status_code == 200, r.text
        d = r.json()
        if d["gemini_used"]:
            assert set(d["explanation"]) >= {"summary", "why", "recommendation"}


class TestBreachCheck:
    def test_breach_lookup_is_truthful_about_configuration(self, api_client, device_id):
        r = api_client.post(f"{BASE_URL}/api/account/breach", json={"device_id": device_id, "identifier": "test@example.com"}, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] in ("not_configured", "clear", "found", "unavailable")
        assert d["detail"]
        if d["status"] == "not_configured":
            assert "isn't connected" in d["detail"]

    def test_breach_validation(self, api_client, device_id):
        assert api_client.post(f"{BASE_URL}/api/account/breach", json={"device_id": device_id, "identifier": "a"}).status_code == 422


class TestPatrolAccountEvents:
    def test_create_account_event(self, api_client, device_id):
        event_id = f"acct{uuid.uuid4().hex[:16]}"
        body = {"event_id": event_id, "device_id": device_id, "category": "account", "state": "barking", "status": "active", "headline": "Account: Login prompt you didn't start — Microsoft",
                "what_happened": "Don't approve this login.", "why": ["x"], "what_to_do": "Deny it.", "verified_block": False, "adapter_label": "Identity & Account Engine",
                "occurred_at": datetime.now(timezone.utc).isoformat(), "background": False, "claimed_brand": "Microsoft", "scenario": "AC01", "scent_id": event_id}
        r = api_client.post(f"{BASE_URL}/api/patrol/events", json=body)
        assert r.status_code == 200, r.text
        assert r.json()["category"] == "account"
