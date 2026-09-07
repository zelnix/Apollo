import json
from datetime import timedelta

from app.services.rule_signer import RejectReason, verify_bundle
from tests.conftest import FROZEN_NOW, VECTORS


def load(name):
    return json.loads((VECTORS / "signing" / name).read_text())


def trusted():
    return load("trusted_keys.json")["trustedKeys"]


def test_correctly_signed_older_bundle_rejected_when_rollback_prohibited():
    rollback = load("rollback_bundle.json")
    assert rollback["bundleVersion"] == 1
    # signature itself is valid (no version store) ...
    assert verify_bundle(rollback, trusted(), FROZEN_NOW).accepted
    # ... but once version 3 was accepted, version 1 is a rollback.
    result = verify_bundle(rollback, trusted(), FROZEN_NOW, highest_accepted_version=3)
    assert not result.accepted and result.reason == RejectReason.ROLLBACK


def test_same_trusted_bundle_is_accepted_idempotently():
    # Physical M1 finding: the exact bundle already accepted must verify again after restart/update/re-fetch (not a rollback).
    valid = load("valid_bundle.json")
    first = verify_bundle(valid, trusted(), FROZEN_NOW)
    assert first.accepted and len(first.envelope_hash) == 64
    again = verify_bundle(valid, trusted(), FROZEN_NOW, highest_accepted_version=3, highest_accepted_envelope_hash=first.envelope_hash)
    assert again.accepted and again.envelope_hash == first.envelope_hash
    # legacy store record (version only, no identity) also accepts the same version
    assert verify_bundle(valid, trusted(), FROZEN_NOW, highest_accepted_version=3).accepted


def test_same_version_with_different_signed_envelope_is_a_conflict():
    result = verify_bundle(load("valid_bundle.json"), trusted(), FROZEN_NOW, highest_accepted_version=3, highest_accepted_envelope_hash="0" * 64)
    assert not result.accepted and result.reason == RejectReason.VERSION_CONFLICT


def test_rejected_bundles_carry_no_identity_to_record():
    for name, reason in [("tampered_payload_bundle.json", RejectReason.PAYLOAD_HASH_MISMATCH), ("unknown_key_bundle.json", RejectReason.UNKNOWN_KEY), ("expired_bundle.json", RejectReason.EXPIRED)]:
        result = verify_bundle(load(name), trusted(), FROZEN_NOW)
        assert not result.accepted and result.reason == reason and result.envelope_hash is None


def test_frozen_clock_controls_expiry_and_not_before():
    valid = load("valid_bundle.json")
    assert verify_bundle(valid, trusted(), FROZEN_NOW).accepted
    assert verify_bundle(valid, trusted(), FROZEN_NOW + timedelta(days=400)).reason == RejectReason.EXPIRED
    assert verify_bundle(valid, trusted(), FROZEN_NOW - timedelta(days=30)).reason == RejectReason.NOT_YET_VALID
