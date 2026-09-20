"""P0 privacy/patrol policy regressions against live API."""
from __future__ import annotations

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
                if line.startswith("EXPO_BACKEND_URL="):
                    base = line.split("=", 1)[1].strip()
                    break
                if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                    base = line.split("=", 1)[1].strip()
                    break
    if not base:
        raise RuntimeError("EXPO_BACKEND_URL (or EXPO_PUBLIC_BACKEND_URL) must be set")
    return base.rstrip("/")


BASE_URL = _base_url()
API = f"{BASE_URL}/api"
RAW = {"User-Agent": "apollo-tests", "X-Apollo-Raw": "1", "Content-Type": "application/json"}


def _register_device() -> tuple[str, dict[str, str]]:
    r = requests.post(f"{API}/devices/register", json={"platform": "web", "adapter_mode": "mock"}, headers=RAW, timeout=15)
    assert r.status_code == 201, r.text
    j = r.json()
    return j["device_id"], {**RAW, "Authorization": f"Bearer {j['device_token']}"}


def _event(device_id: str, event_id: str, category: str, state: str, evidence: dict | None = None, occurred_at: str | None = None) -> dict:
    ts = occurred_at or datetime.now(timezone.utc).isoformat()
    return {
        "event_id": event_id,
        "device_id": device_id,
        "category": category,
        "state": state,
        "status": "blocked" if state == "biting" else "active",
        "headline": "Regression event",
        "what_happened": "Regression validation",
        "why": ["test"],
        "what_to_do": "Observe",
        "indicator_host": "evil.example",
        "indicator_digest": None,
        "verified_block": state == "biting",
        "adapter_label": "apollo-tests",
        "occurred_at": ts,
        "resolved_at": None,
        "enforcement_evidence": evidence,
    }


def _valid_evidence(evidence_id: str, observed_at: str, domain: str = "evil.example") -> dict:
    return {
        "evidence_id": evidence_id,
        "event_id": None,
        "device_id": None,
        "platform": "android",
        "os_version": None,
        "sdk_version": None,
        "observed_at": observed_at,
        "mechanism": "dns_filter",
        "direction": "outbound",
        "protocol": "dns",
        "destination_ip": None,
        "destination_domain": domain,
        "destination_port": 53,
        "app_id": None,
        "process_name": None,
        "attribution_confidence": "unavailable",
        "matched_rule_id": domain,
        "threat_id": None,
        "requested_action": "block",
        "enforced_action": "blocked",
        "result": "verified",
        "rule_source": "local_blocklist",
        "confidence": "high",
        "correlation_id": None,
    }


@pytest.mark.parametrize(
    "path,payload",
    [
        ("/page/crawl", {}),
        ("/message/extract", {}),
        ("/account/breach", {}),
        ("/call/risk-check", {}),
    ],
)
def test_purpose_limited_routes_still_require_device_auth(path: str, payload: dict):
    r = requests.post(f"{API}{path}", json=payload, headers=RAW, timeout=15)
    assert r.status_code == 401, r.text
    assert "device credential" in r.json().get("detail", "")


def test_message_analyse_accepts_explicit_submission_without_claiming_a_block():
    did, auth = _register_device()
    raw = {
        "device_id": did,
        "sender": "+61400000000",
        "text": "CommBank alert: verify a $4,820 payment at the supplied link.",
        "urls": ["https://example.com"],
        "local_state": "growling",
        "scenario": "M_RAW",
        "signals": ["urgency"],
        "claimed_brand": "CommBank",
        "second_opinion": True,
    }
    ok = requests.post(f"{API}/message/analyse", json=raw, headers=auth, timeout=75)
    assert ok.status_code == 200, ok.text
    data = ok.json()
    assert isinstance(data["urls"], list)
    assert data["assessment"]["processing"]["raw_retained_by_apollo"] is False
    assert data["assessment"]["risk"] in ("warning", "uncertain")
    assert "block" not in data["assessment"]["higgins"]["exact_response"].lower()
    assert data["assessment"]["higgins"]["next_action"]


def test_account_analyse_returns_evidence_grounded_assessment():
    did, auth = _register_device()
    raw = {
        "device_id": did,
        "kind": "mfa_prompt",
        "provider": "google",
        "sender": "alerts@example.com",
        "text": "Approve login now",
        "urls": ["https://example.com"],
        "local_state": "growling",
        "scenario": "AC_RAW",
        "second_opinion": True,
    }
    ok = requests.post(f"{API}/account/analyse", json=raw, headers=auth, timeout=75)
    assert ok.status_code == 200, ok.text
    data = ok.json()
    assert isinstance(data["urls"], list)
    assert data["assessment"]["processing"]["raw_retained_by_apollo"] is False
    assert data["assessment"]["higgins"]["next_action"]


def test_call_screening_event_cannot_claim_biting_without_packet_evidence():
    did, auth = _register_device()
    body = _event(did, f"evt_{uuid.uuid4().hex[:10]}", "call", "biting", evidence=None)
    r = requests.post(f"{API}/patrol/events", json=body, headers=auth, timeout=15)
    assert r.status_code == 422, r.text


def test_call_screening_non_biting_persists_normally():
    did, auth = _register_device()
    event_id = f"evt_{uuid.uuid4().hex[:10]}"
    body = _event(did, event_id, "call", "barking", evidence=None)
    r = requests.post(f"{API}/patrol/events", json=body, headers=auth, timeout=15)
    assert r.status_code == 200, r.text
    assert r.json()["verified_block"] is False

    rg = requests.get(f"{API}/patrol/events", params={"device_id": did}, headers=auth, timeout=15)
    assert rg.status_code == 200, rg.text
    assert any(e["event_id"] == event_id and e["state"] == "barking" for e in rg.json())


def test_evidence_receipt_idempotent_and_protects_reuse_with_changed_payload():
    did, auth = _register_device()
    evidence_id = f"ev_{uuid.uuid4().hex[:10]}"
    event_id = f"evt_{uuid.uuid4().hex[:10]}"
    ts = datetime.now(timezone.utc).isoformat()

    first = _event(did, event_id, "connection", "biting", evidence=_valid_evidence(evidence_id, ts, "evil.example"), occurred_at=ts)
    r1 = requests.post(f"{API}/patrol/events", json=first, headers=auth, timeout=15)
    assert r1.status_code == 200, r1.text
    assert r1.json()["verified_block"] is True

    r2 = requests.post(f"{API}/patrol/events", json=first, headers=auth, timeout=15)
    assert r2.status_code == 200, r2.text
    assert r2.json()["event_id"] == event_id

    listed = requests.get(f"{API}/patrol/events", params={"device_id": did}, headers=auth, timeout=15)
    assert listed.status_code == 200, listed.text
    assert sum(1 for e in listed.json() if e["event_id"] == event_id) == 1

    conflict = _event(did, f"evt_{uuid.uuid4().hex[:10]}", "connection", "biting", evidence=_valid_evidence(evidence_id, ts, "changed.example"), occurred_at=ts)
    r3 = requests.post(f"{API}/patrol/events", json=conflict, headers=auth, timeout=15)
    assert r3.status_code == 409, r3.text
