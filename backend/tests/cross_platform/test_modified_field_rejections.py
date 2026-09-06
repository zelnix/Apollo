"""Every single-field modification of a signed envelope must be rejected (full-envelope coverage)."""
import json

import pytest

from app.services.rule_signer import verify_bundle
from tests.conftest import FROZEN_NOW, VECTORS


def load():
    return json.loads((VECTORS / "signing" / "valid_bundle.json").read_text()), json.loads(
        (VECTORS / "signing" / "trusted_keys.json").read_text()
    )["trustedKeys"]


@pytest.mark.parametrize(
    "field,value",
    [
        ("schemaVersion", "1.0"),  # same value, sanity: still accepted (checked separately)
        ("rulesetId", "gd-m1-controlled-blocks"),
        ("bundleVersion", 4),
        ("issuedAt", "2026-06-02T00:00:00Z"),
        ("expiresAt", "2027-06-02T00:00:00Z"),
        ("keyId", "gd-m1-test-ed25519-001x"),
        ("payloadHash", "f" * 64),
    ],
)
def test_single_field_modification(field, value):
    bundle, keys = load()
    mutated = {**bundle, field: value}
    result = verify_bundle(mutated, keys, FROZEN_NOW)
    if mutated == bundle:
        assert result.accepted
    else:
        assert not result.accepted, field


@pytest.mark.parametrize("path,value", [("host", "x.example"), ("action", "allow"), ("ruleId", "z"), ("category", "other")])
def test_payload_rule_modification(path, value):
    bundle, keys = load()
    mutated = json.loads(json.dumps(bundle))
    mutated["payload"]["rules"][0][path] = value
    assert not verify_bundle(mutated, keys, FROZEN_NOW).accepted


def test_added_rule_rejected():
    bundle, keys = load()
    mutated = json.loads(json.dumps(bundle))
    mutated["payload"]["rules"].append({"ruleId": "injected", "host": "injected.example", "action": "block", "matchType": "exact", "category": "x"})
    assert not verify_bundle(mutated, keys, FROZEN_NOW).accepted
