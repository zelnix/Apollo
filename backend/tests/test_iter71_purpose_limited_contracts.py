"""Purpose-limited cloud investigation contract regressions for link/account APIs."""

import json
import os

import requests


def _base_url() -> str:
    base = os.environ.get("EXPO_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    if not base:
        raise RuntimeError("EXPO_BACKEND_URL or EXPO_PUBLIC_BACKEND_URL is required")
    return base.rstrip("/")


# Link Guard investigation contract: redaction, truth-of-state, and processing-retention fields.
def test_link_investigation_contract_redaction_and_truth_state():
    body = {
        "device_id": "iter71-link-redact-01",
        "url": "https://example.com/reset?token=secret-token&invoice=42#frag",
        "local_state": "growling",
        "local_findings": ["Sender identity was not independently verified."],
        "claimed_brand": "microsoft",
    }
    response = requests.post(f"{_base_url()}/api/link/investigate", json=body, timeout=120)
    assert response.status_code == 200, response.text
    data = response.json()
    rendered = json.dumps(data).lower()

    assert data["processing"]["raw_retained_by_apollo"] is False
    assert data["processing"]["maximum_processing_retention_minutes"] == 15
    assert "success, failure, timeout or cancellation" in data["processing"]["temporary_copy_policy"].lower()
    assert "token=secret-token" not in rendered
    assert "#frag" not in rendered
    assert "apollo is biting" not in rendered
    assert "packet blocked" not in rendered
    assert data["higgins"]["next_action"]
    assert data["higgins"]["exact_response"]


# Link Guard SSRF-safe handling: private targets stay unresolved/unavailable, never overclaimed.
def test_link_investigation_private_target_ssrf_unavailable():
    body = {
        "device_id": "iter71-link-ssrf-02",
        "url": "http://127.0.0.1:8001/api/health",
        "local_state": "growling",
        "local_findings": ["Private and internal addresses are never fetched."],
        "claimed_brand": None,
    }
    response = requests.post(f"{_base_url()}/api/link/investigate", json=body, timeout=120)
    assert response.status_code == 200, response.text
    data = response.json()

    page_sources = [source for source in data["sources"] if str(source.get("source_id", "")).startswith("page-")]
    assert page_sources, data
    assert page_sources[0]["status"] == "unavailable"
    assert any(tag in page_sources[0]["detail"] for tag in ["invalid_target", "private_target"])
    assert data["processing"]["raw_retained_by_apollo"] is False


# Link Guard response quality: uncertainty shown and one clear next action always present.
def test_link_investigation_uncertainty_and_action_are_present():
    body = {
        "device_id": "iter71-link-uncertain-03",
        "url": "https://commbank-secure-login-verify.xyz/account",
        "local_state": "barking",
        "local_findings": ["Lookalike host differs from official organisation domain."],
        "claimed_brand": "commbank",
    }
    response = requests.post(f"{_base_url()}/api/link/investigate", json=body, timeout=120)
    assert response.status_code == 200, response.text
    data = response.json()

    assert isinstance(data["higgins"]["could_not_establish"], list)
    assert len(data["higgins"]["could_not_establish"]) >= 1
    assert isinstance(data["higgins"]["next_action"], str) and data["higgins"]["next_action"].strip()
    assert isinstance(data["higgins"]["action_label"], str) and data["higgins"]["action_label"].strip()


# Account Guard purpose-limited contract regression: redaction + processing limits in assessment block.
def test_account_analyse_contract_redaction_and_processing_fields():
    body = {
        "device_id": "iter71-account-01",
        "kind": "security_alert",
        "provider": "microsoft",
        "sender": "Microsoft Security",
        "text": "We noticed a login attempt. Review activity now.",
        "urls": ["https://example.com/reset?otp=123456&code=abcd&safe=1#keep"],
        "local_state": "ears_up",
        "scenario": "A1",
        "second_opinion": True,
    }
    response = requests.post(f"{_base_url()}/api/account/analyse", json=body, timeout=120)
    assert response.status_code == 200, response.text
    data = response.json()
    rendered = json.dumps(data).lower()

    assert data["assessment"]["processing"]["raw_retained_by_apollo"] is False
    assert data["assessment"]["processing"]["maximum_processing_retention_minutes"] == 15
    assert "success, failure, timeout or cancellation" in data["assessment"]["processing"]["temporary_copy_policy"].lower()
    assert "otp=123456" not in rendered
    assert "code=abcd" not in rendered
    assert "#keep" not in rendered
    assert data["assessment"]["higgins"]["exact_response"]


# Account Guard breach contract regression: stable status payload with Higgins guidance and truthful wording.
def test_account_breach_contract_response_shape_and_truth_wording():
    body = {"device_id": "iter71-breach-01", "identifier": "person@example.com"}
    response = requests.post(f"{_base_url()}/api/account/breach", json=body, timeout=120)
    assert response.status_code == 200, response.text
    data = response.json()

    assert data["status"] in {"not_configured", "clear", "found", "unavailable"}
    assert isinstance(data["detail"], str) and data["detail"].strip()
    assert isinstance(data["higgins"], dict)
    assert isinstance(data["higgins"].get("headline"), str) and data["higgins"]["headline"].strip()
    assert isinstance(data["higgins"].get("exact_response"), str) and data["higgins"]["exact_response"].strip()
    assert "apollo is biting" not in data["higgins"]["exact_response"].lower()
    assert "packet blocked" not in data["higgins"]["exact_response"].lower()
