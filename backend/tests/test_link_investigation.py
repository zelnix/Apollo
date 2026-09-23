"""Link Guard purpose-limited investigation contract."""
import json
import os
from pathlib import Path

import requests


def _base_url() -> str:
    base = os.environ.get("EXPO_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    if not base:
        env_file = Path(__file__).resolve().parents[2] / "frontend" / ".env"
        for line in env_file.read_text().splitlines():
            if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                base = line.split("=", 1)[1].strip()
                break
    if not base:
        raise RuntimeError("EXPO_PUBLIC_BACKEND_URL is required")
    return base.rstrip("/")


def test_link_investigation_redacts_secrets_and_returns_higgins():
    body = {"device_id": "linkinvest0001", "url": "https://example.com/reset?token=secret&invoice=42#fragment",
            "local_state": "ears_up", "local_findings": ["The destination needs independent verification."],
            "claimed_brand": None, "second_opinion": False}
    response = requests.post(f"{_base_url()}/api/link/investigate", json=body, timeout=90)
    assert response.status_code == 200, response.text
    data = response.json()
    rendered = json.dumps(data).lower()
    assert data["higgins"]["next_action"]
    assert data["processing"]["model_used"] is False
    assert data["processing"]["raw_retained_by_apollo"] is False
    assert data["processing"]["maximum_processing_retention_minutes"] == 15
    assert "token=secret" not in rendered and "fragment" not in rendered
    assert "packet blocked" not in data["higgins"]["exact_response"].lower()


def test_link_investigation_keeps_private_target_unresolved():
    body = {"device_id": "linkinvest0002", "url": "http://127.0.0.1:8001/api/health",
            "local_state": "growling", "local_findings": ["Private and internal addresses are never fetched."],
            "claimed_brand": None, "second_opinion": False}
    response = requests.post(f"{_base_url()}/api/link/investigate", json=body, timeout=90)
    assert response.status_code == 200, response.text
    data = response.json()
    page_sources = [source for source in data["sources"] if source["source_id"].startswith("page-")]
    assert page_sources and page_sources[0]["status"] == "unavailable"
    assert "invalid_target" in page_sources[0]["detail"]