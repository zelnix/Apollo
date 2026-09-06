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


def test_same_version_is_rollback():
    assert verify_bundle(load("valid_bundle.json"), trusted(), FROZEN_NOW, highest_accepted_version=3).reason == RejectReason.ROLLBACK


def test_frozen_clock_controls_expiry_and_not_before():
    valid = load("valid_bundle.json")
    assert verify_bundle(valid, trusted(), FROZEN_NOW).accepted
    assert verify_bundle(valid, trusted(), FROZEN_NOW + timedelta(days=400)).reason == RejectReason.EXPIRED
    assert verify_bundle(valid, trusted(), FROZEN_NOW - timedelta(days=30)).reason == RejectReason.NOT_YET_VALID
