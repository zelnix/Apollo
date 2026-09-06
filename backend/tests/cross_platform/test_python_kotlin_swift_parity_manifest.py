"""Manifest of what each platform verifier must accept/reject on the shared fixtures.

Python executes here; Kotlin (RuleBundleVerifierTest) and Swift
(RuleBundleVerifierParityTests) consume the same files and must report the same
outcome per fixture. modified_fields_manifest.md is the human-readable copy.
"""
import json

import pytest

from app.services.rule_signer import RejectReason, verify_bundle
from tests.conftest import FROZEN_NOW, VECTORS

MANIFEST = {
    "jcs/valid_signature_bundle.json": None,
    "jcs/invalid_signature_bundle.json": RejectReason.SIGNATURE_INVALID,
    "jcs/modified_payload_bundle.json": RejectReason.SIGNATURE_INVALID,
    "jcs/modified_expiry_bundle.json": RejectReason.SIGNATURE_INVALID,
    "jcs/modified_bundle_version_bundle.json": RejectReason.SIGNATURE_INVALID,
    "jcs/modified_ruleset_id_bundle.json": RejectReason.SIGNATURE_INVALID,
    "jcs/modified_key_id_bundle.json": RejectReason.UNKNOWN_KEY,  # SIGNATURE_INVALID once key 002 is trusted
    "jcs/invalid_payload_hash_bundle.json": RejectReason.PAYLOAD_HASH_MISMATCH,
    "signing/valid_bundle.json": None,
    "signing/tampered_payload_bundle.json": RejectReason.PAYLOAD_HASH_MISMATCH,
    "signing/expired_bundle.json": RejectReason.EXPIRED,
    "signing/unknown_key_bundle.json": RejectReason.UNKNOWN_KEY,
    "signing/rollback_bundle.json": RejectReason.ROLLBACK,
}


def trusted():
    return json.loads((VECTORS / "signing" / "trusted_keys.json").read_text())["trustedKeys"]


@pytest.mark.parametrize("fixture,expected", MANIFEST.items())
def test_manifest(fixture, expected):
    bundle = json.loads((VECTORS / fixture).read_text())
    highest = 3 if fixture.endswith("rollback_bundle.json") else None
    result = verify_bundle(bundle, trusted(), FROZEN_NOW, highest_accepted_version=highest)
    assert result.accepted == (expected is None), fixture
    assert result.reason == expected, fixture


def test_modified_key_id_with_rollover_key_trusted_is_signature_invalid():
    bundle = json.loads((VECTORS / "jcs" / "modified_key_id_bundle.json").read_text())
    tk = json.loads((VECTORS / "signing" / "trusted_keys.json").read_text())
    registry = {**tk["trustedKeys"], **tk["rolloverKeys"]}
    assert verify_bundle(bundle, registry, FROZEN_NOW).reason == RejectReason.SIGNATURE_INVALID


def test_manifest_md_lists_every_fixture():
    md = (VECTORS / "signing" / "modified_fields_manifest.md").read_text()
    for fixture in MANIFEST:
        assert fixture.split("/")[-1] in md, fixture
