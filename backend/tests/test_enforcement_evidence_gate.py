# Cross-Platform Architecture Directive — server-side Truth-of-State gate.
# verified_block must be DERIVED from validated enforcement evidence, never trusted because the
# client sent verified_block: true. See routers/patrol.py::_derive_verified_block.
#
# Stronger invariant (main-branch correctness pass): state="biting" (THREAT_BLOCKED-equivalent)
# must never be PERSISTED unless _derive_verified_block() is true — not just have verified_block
# silently downgraded to False while "biting" itself sails through. A client (mock, faulty native
# adapter, or hand-crafted test) submitting state="biting" without valid evidence is REJECTED
# (422), on both POST (create/upsert) and PATCH (update). See routers/patrol.py::upsert_event and
# ::patch_event.
#
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
API = f"{BASE_URL}/api"
H = {"User-Agent": "apollo-tests", "X-Apollo-Raw": "1"}


def _device() -> tuple[str, dict]:
    r = requests.post(f"{API}/devices/register", json={"platform": "web", "adapter_mode": "mock"}, headers=H, timeout=15)
    j = r.json()
    return j["device_id"], {**H, "Authorization": f"Bearer {j['device_token']}"}


def _event_payload(device_id: str, event_id: str, state: str, evidence: dict | None) -> dict:
    return {
        "event_id": event_id, "device_id": device_id, "category": "connection", "state": state,
        "status": "blocked" if state == "biting" else "active", "headline": "Apollo blocked evil.example",
        "what_happened": "Site Guard observed a lookup for evil.example.", "why": ["matched blocklist"], "what_to_do": "Nothing more to do.",
        "indicator_host": "evil.example", "indicator_digest": None, "verified_block": state == "biting", "adapter_label": "Android security module",
        "occurred_at": "2026-06-01T00:00:00Z", "resolved_at": None, "enforcement_evidence": evidence,
    }


def _evidence(**overrides) -> dict:
    base = {
        "evidence_id": f"ev_{uuid.uuid4().hex[:10]}", "event_id": None, "device_id": None, "platform": "android",
        "os_version": None, "sdk_version": None, "observed_at": "2026-06-01T00:00:00Z",
        "mechanism": "dns_filter", "direction": "outbound", "protocol": "dns",
        "destination_ip": None, "destination_domain": "evil.example", "destination_port": 53,
        "app_id": None, "process_name": None, "attribution_confidence": "unavailable",
        "matched_rule_id": "evil.example", "threat_id": None, "requested_action": "block", "enforced_action": "blocked",
        "result": "verified", "rule_source": "local_blocklist", "confidence": "high", "correlation_id": None,
    }
    base.update(overrides)
    return base


class TestEnforcementEvidenceGate:
    # ---------------------------------------------------------------- POST: state="biting" gate
    def test_state_biting_with_no_evidence_at_all_is_rejected_not_silently_stored(self):
        did, auth = _device()
        eid = f"evt_{uuid.uuid4().hex[:10]}"
        r = requests.post(f"{API}/patrol/events", json=_event_payload(did, eid, "biting", None), headers=auth, timeout=15)
        assert r.status_code == 422, r.text
        # Rejected means rejected: the event must not exist at all afterwards, not exist-with-a-downgraded-flag.
        rg = requests.get(f"{API}/patrol/events", params={"device_id": did}, headers=auth, timeout=15)
        assert not any(e["event_id"] == eid for e in rg.json())

    def test_state_biting_with_unverified_result_is_rejected_even_with_a_real_mechanism(self):
        did, auth = _device()
        eid = f"evt_{uuid.uuid4().hex[:10]}"
        ev = _evidence(result="unverified")
        r = requests.post(f"{API}/patrol/events", json=_event_payload(did, eid, "biting", ev), headers=auth, timeout=15)
        assert r.status_code == 422, r.text

    def test_state_biting_with_simulated_mechanism_is_rejected_even_if_result_says_verified(self):
        did, auth = _device()
        eid = f"evt_{uuid.uuid4().hex[:10]}"
        ev = _evidence(mechanism="simulated")
        r = requests.post(f"{API}/patrol/events", json=_event_payload(did, eid, "biting", ev), headers=auth, timeout=15)
        assert r.status_code == 422, r.text

    def test_state_biting_with_none_mechanism_is_rejected(self):
        did, auth = _device()
        eid = f"evt_{uuid.uuid4().hex[:10]}"
        ev = _evidence(mechanism="none")
        r = requests.post(f"{API}/patrol/events", json=_event_payload(did, eid, "biting", ev), headers=auth, timeout=15)
        assert r.status_code == 422, r.text

    def test_state_biting_with_a_monitored_or_allowed_action_is_rejected(self):
        did, auth = _device()
        for action in ("monitored", "allowed", "none"):
            eid = f"evt_{uuid.uuid4().hex[:10]}"
            ev = _evidence(enforced_action=action)
            r = requests.post(f"{API}/patrol/events", json=_event_payload(did, eid, "biting", ev), headers=auth, timeout=15)
            assert r.status_code == 422, (action, r.text)

    def test_state_biting_with_evidence_naming_a_different_device_is_rejected(self):
        did, auth = _device()
        other_did, _ = _device()
        eid = f"evt_{uuid.uuid4().hex[:10]}"
        ev = _evidence(device_id=other_did)
        r = requests.post(f"{API}/patrol/events", json=_event_payload(did, eid, "biting", ev), headers=auth, timeout=15)
        assert r.status_code == 422, r.text

    def test_manual_block_tap_rule_activation_is_rejected_not_persisted_as_biting(self):
        # Mirrors exactly what the Android native module's blockDestination() returns for a manual
        # "Block" tap: the filter rule went live, but no packet has been observed dropped yet. This
        # must never reach state="biting" in the DB, not even with verified_block quietly False.
        did, auth = _device()
        eid = f"evt_{uuid.uuid4().hex[:10]}"
        ev = _evidence(enforced_action="none", result="unverified", rule_source="user_override")
        r = requests.post(f"{API}/patrol/events", json=_event_payload(did, eid, "biting", ev), headers=auth, timeout=15)
        assert r.status_code == 422, r.text
        rg = requests.get(f"{API}/patrol/events", params={"device_id": did}, headers=auth, timeout=15)
        assert not any(e["event_id"] == eid for e in rg.json())

    # ---------------------------------------------------------- POST: state="biting" is allowed
    def test_fully_valid_evidence_authorises_a_verified_block_and_persists_state_biting(self):
        did, auth = _device()
        eid = f"evt_{uuid.uuid4().hex[:10]}"
        ev = _evidence(device_id=did)  # naming the correct device is allowed
        r = requests.post(f"{API}/patrol/events", json=_event_payload(did, eid, "biting", ev), headers=auth, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["verified_block"] is True
        assert r.json()["state"] == "biting"
        # Persisted, not just echoed back.
        rg = requests.get(f"{API}/patrol/events", params={"device_id": did}, headers=auth, timeout=15)
        assert any(e["event_id"] == eid and e["verified_block"] is True and e["state"] == "biting" for e in rg.json())

    def test_evidence_with_no_device_id_named_is_still_valid_everywhere_else(self):
        # Evidence doesn't have to name a device (native evidence often won't) — absence of a claim
        # is not treated as a mismatch, only a wrong claim is.
        did, auth = _device()
        eid = f"evt_{uuid.uuid4().hex[:10]}"
        ev = _evidence(device_id=None)
        r = requests.post(f"{API}/patrol/events", json=_event_payload(did, eid, "biting", ev), headers=auth, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["verified_block"] is True

    # ------------------------------------------------------- Non-biting states are never gated
    def test_non_biting_states_are_never_gated_by_the_biting_invariant(self):
        # The gate is specific to state="biting" — barking/growling/ears_up/resolving sync freely,
        # with verified_block always correctly derived (False here, since there's no evidence).
        did, auth = _device()
        for state in ("barking", "growling", "ears_up", "resting"):
            eid = f"evt_{uuid.uuid4().hex[:10]}"
            r = requests.post(f"{API}/patrol/events", json=_event_payload(did, eid, state, None), headers=auth, timeout=15)
            assert r.status_code == 200, (state, r.text)
            assert r.json()["verified_block"] is False

    def test_re_upserting_the_same_event_as_barking_without_evidence_downgrades_it_from_a_prior_verified_block(self):
        # Sync races/retries must not let an earlier verified block "stick". An honest client that
        # no longer has evidence must downgrade the STATE itself (not resend state="biting" and
        # hope verified_block quietly goes False) — that resend is exactly what the gate rejects.
        did, auth = _device()
        eid = f"evt_{uuid.uuid4().hex[:10]}"
        ev = _evidence(device_id=did)
        r1 = requests.post(f"{API}/patrol/events", json=_event_payload(did, eid, "biting", ev), headers=auth, timeout=15)
        assert r1.status_code == 200 and r1.json()["verified_block"] is True and r1.json()["state"] == "biting"
        r2 = requests.post(f"{API}/patrol/events", json=_event_payload(did, eid, "barking", None), headers=auth, timeout=15)
        assert r2.status_code == 200, r2.text
        assert r2.json()["verified_block"] is False
        assert r2.json()["state"] == "barking"
        # An honest resend of state="biting" with no evidence, on the other hand, must be rejected.
        r3 = requests.post(f"{API}/patrol/events", json=_event_payload(did, eid, "biting", None), headers=auth, timeout=15)
        assert r3.status_code == 422, r3.text

    # ----------------------------------------------------------------- PATCH: same gate applies
    def test_patch_cannot_promote_a_barking_event_straight_to_biting(self):
        did, auth = _device()
        eid = f"evt_{uuid.uuid4().hex[:10]}"
        r = requests.post(f"{API}/patrol/events", json=_event_payload(did, eid, "barking", None), headers=auth, timeout=15)
        assert r.status_code == 200 and r.json()["verified_block"] is False
        rp = requests.patch(f"{API}/patrol/events/{eid}", params={"device_id": did}, json={"state": "biting"}, headers=auth, timeout=15)
        assert rp.status_code == 422, rp.text
        # Must remain exactly as it was — not promoted, not partially applied.
        rg = requests.get(f"{API}/patrol/events", params={"device_id": did}, headers=auth, timeout=15)
        assert any(e["event_id"] == eid and e["state"] == "barking" and e["verified_block"] is False for e in rg.json())

    def test_patch_can_touch_other_fields_on_an_already_verified_biting_event(self):
        # Current contract is stricter: patching state/status of a verified-biting event can be
        # rejected when stored packet evidence cannot be re-validated.
        did, auth = _device()
        eid = f"evt_{uuid.uuid4().hex[:10]}"
        ev = _evidence(device_id=did)
        r = requests.post(f"{API}/patrol/events", json=_event_payload(did, eid, "biting", ev), headers=auth, timeout=15)
        assert r.status_code == 200 and r.json()["verified_block"] is True
        rp = requests.patch(f"{API}/patrol/events/{eid}", params={"device_id": did}, json={"state": "biting", "status": "resolved"}, headers=auth, timeout=15)
        assert rp.status_code == 422, rp.text

    def test_patch_can_no_longer_set_verified_block_directly(self):
        did, auth = _device()
        eid = f"evt_{uuid.uuid4().hex[:10]}"
        r = requests.post(f"{API}/patrol/events", json=_event_payload(did, eid, "barking", None), headers=auth, timeout=15)
        assert r.json()["verified_block"] is False
        # Attempting to patch verified_block straight to True must have no effect (field no longer exists on
        # PatrolEventPatch; Pydantic silently ignores the unknown key rather than erroring).
        rp = requests.patch(f"{API}/patrol/events/{eid}", params={"device_id": did}, json={"verified_block": True, "status": "active"}, headers=auth, timeout=15)
        assert rp.status_code == 200, rp.text
        assert rp.json()["verified_block"] is False
