# Cross-Platform Architecture Directive — server-side Truth-of-State gate.
# verified_block must be DERIVED from validated enforcement evidence, never trusted because the
# client sent verified_block: true. See routers/patrol.py::_derive_verified_block.
# Uses its own device registrations with explicit bearer headers (X-Apollo-Raw) — never the
# legacy-id auth shim in conftest.py — so evidence.device_id can be set independently of the
# authenticated caller for the mismatch test.
import os
import uuid
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
BASE_URL = (os.environ.get("EXPO_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://threat-patrol-1.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
H = {"User-Agent": "apollo-tests", "X-Apollo-Raw": "1"}


def _device() -> tuple[str, dict]:
    r = requests.post(f"{API}/devices/register", json={"platform": "web", "adapter_mode": "mock"}, headers=H, timeout=15)
    j = r.json()
    return j["device_id"], {**H, "Authorization": f"Bearer {j['device_token']}"}


def _event_payload(device_id: str, event_id: str, verified_block_claim: bool, evidence: dict | None) -> dict:
    return {
        "event_id": event_id, "device_id": device_id, "category": "connection", "state": "biting" if verified_block_claim else "barking",
        "status": "blocked" if verified_block_claim else "active", "headline": "Apollo blocked evil.example",
        "what_happened": "Site Guard observed a lookup for evil.example.", "why": ["matched blocklist"], "what_to_do": "Nothing more to do.",
        "indicator_host": "evil.example", "indicator_digest": None, "verified_block": verified_block_claim, "adapter_label": "Android security module",
        "occurred_at": "2026-06-01T00:00:00Z", "resolved_at": None, "enforcement_evidence": evidence,
    }


def _evidence(**overrides) -> dict:
    base = {
        "evidence_id": f"ev_{uuid.uuid4().hex[:10]}", "event_id": None, "device_id": None, "platform": "android",
        "os_version": "Android 15", "sdk_version": "1.0.0", "observed_at": "2026-06-01T00:00:00Z",
        "mechanism": "dns_filter", "direction": "outbound", "protocol": "dns",
        "destination_ip": None, "destination_domain": "evil.example", "destination_port": 53,
        "app_id": None, "process_name": None, "attribution_confidence": "unavailable",
        "matched_rule_id": "evil.example", "threat_id": None, "requested_action": "block", "enforced_action": "blocked",
        "result": "verified", "rule_source": "local_blocklist", "confidence": "high", "correlation_id": None,
    }
    base.update(overrides)
    return base


class TestEnforcementEvidenceGate:
    def test_client_claim_alone_is_ignored_without_any_evidence(self):
        did, auth = _device()
        eid = f"evt_{uuid.uuid4().hex[:10]}"
        r = requests.post(f"{API}/patrol/events", json=_event_payload(did, eid, True, None), headers=auth, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["verified_block"] is False

    def test_unverified_result_is_rejected_even_with_a_real_mechanism(self):
        did, auth = _device()
        eid = f"evt_{uuid.uuid4().hex[:10]}"
        ev = _evidence(result="unverified")
        r = requests.post(f"{API}/patrol/events", json=_event_payload(did, eid, True, ev), headers=auth, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["verified_block"] is False

    def test_simulated_mechanism_never_verifies_even_if_result_says_verified(self):
        did, auth = _device()
        eid = f"evt_{uuid.uuid4().hex[:10]}"
        ev = _evidence(mechanism="simulated")
        r = requests.post(f"{API}/patrol/events", json=_event_payload(did, eid, True, ev), headers=auth, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["verified_block"] is False

    def test_none_mechanism_never_verifies(self):
        did, auth = _device()
        eid = f"evt_{uuid.uuid4().hex[:10]}"
        ev = _evidence(mechanism="none")
        r = requests.post(f"{API}/patrol/events", json=_event_payload(did, eid, True, ev), headers=auth, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["verified_block"] is False

    def test_a_monitored_or_allowed_action_is_not_a_block(self):
        did, auth = _device()
        for action in ("monitored", "allowed", "none"):
            eid = f"evt_{uuid.uuid4().hex[:10]}"
            ev = _evidence(enforced_action=action)
            r = requests.post(f"{API}/patrol/events", json=_event_payload(did, eid, True, ev), headers=auth, timeout=15)
            assert r.status_code == 200, r.text
            assert r.json()["verified_block"] is False, action

    def test_evidence_naming_a_different_device_cannot_authorise_this_device(self):
        did, auth = _device()
        other_did, _ = _device()
        eid = f"evt_{uuid.uuid4().hex[:10]}"
        ev = _evidence(device_id=other_did)
        r = requests.post(f"{API}/patrol/events", json=_event_payload(did, eid, True, ev), headers=auth, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["verified_block"] is False

    def test_fully_valid_evidence_authorises_a_verified_block(self):
        did, auth = _device()
        eid = f"evt_{uuid.uuid4().hex[:10]}"
        ev = _evidence(device_id=did)  # naming the correct device is allowed
        r = requests.post(f"{API}/patrol/events", json=_event_payload(did, eid, True, ev), headers=auth, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["verified_block"] is True
        # Persisted, not just echoed back.
        rg = requests.get(f"{API}/patrol/events", params={"device_id": did}, headers=auth, timeout=15)
        assert any(e["event_id"] == eid and e["verified_block"] is True for e in rg.json())

    def test_evidence_with_no_device_id_named_is_still_valid_everywhere_else(self):
        # Evidence doesn't have to name a device (native evidence often won't) — absence of a claim
        # is not treated as a mismatch, only a wrong claim is.
        did, auth = _device()
        eid = f"evt_{uuid.uuid4().hex[:10]}"
        ev = _evidence(device_id=None)
        r = requests.post(f"{API}/patrol/events", json=_event_payload(did, eid, True, ev), headers=auth, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["verified_block"] is True

    def test_re_upserting_the_same_event_without_evidence_downgrades_verified_block(self):
        # Sync races/retries must not let an earlier verified block "stick" once re-submitted honestly.
        did, auth = _device()
        eid = f"evt_{uuid.uuid4().hex[:10]}"
        ev = _evidence(device_id=did)
        r1 = requests.post(f"{API}/patrol/events", json=_event_payload(did, eid, True, ev), headers=auth, timeout=15)
        assert r1.json()["verified_block"] is True
        r2 = requests.post(f"{API}/patrol/events", json=_event_payload(did, eid, True, None), headers=auth, timeout=15)
        assert r2.status_code == 200, r2.text
        assert r2.json()["verified_block"] is False

    def test_patch_can_no_longer_set_verified_block_directly(self):
        did, auth = _device()
        eid = f"evt_{uuid.uuid4().hex[:10]}"
        r = requests.post(f"{API}/patrol/events", json=_event_payload(did, eid, False, None), headers=auth, timeout=15)
        assert r.json()["verified_block"] is False
        # Attempting to patch verified_block straight to True must have no effect (field no longer exists on
        # PatrolEventPatch; Pydantic silently ignores the unknown key rather than erroring).
        rp = requests.patch(f"{API}/patrol/events/{eid}", params={"device_id": did}, json={"verified_block": True, "status": "active"}, headers=auth, timeout=15)
        assert rp.status_code == 200, rp.text
        assert rp.json()["verified_block"] is False
