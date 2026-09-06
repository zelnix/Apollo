import json
import os

import pytest

from app.core import security
from app.core.settings import get_settings
from app.services.rule_signer import RejectReason, verify_bundle
from tests.conftest import FROZEN_NOW, VECTORS


def load(name: str) -> dict:
    return json.loads((VECTORS / "signing" / name).read_text())


def trusted() -> dict[str, str]:
    return load("trusted_keys.json")["trustedKeys"]


def test_valid_bundle_accepted():
    result = verify_bundle(load("valid_bundle.json"), trusted(), FROZEN_NOW, highest_accepted_version=2)
    assert result.accepted and result.bundle.bundleVersion == 3
    assert result.bundle.payload.rules[0].host == "m1-block-test.guarddog.example"
    assert result.bundle.payload.rules[0].action == "block"


@pytest.mark.parametrize(
    "fixture,reason",
    [
        ("tampered_payload_bundle.json", RejectReason.PAYLOAD_HASH_MISMATCH),
        ("expired_bundle.json", RejectReason.EXPIRED),
        ("unknown_key_bundle.json", RejectReason.UNKNOWN_KEY),
    ],
)
def test_rejections(fixture, reason):
    result = verify_bundle(load(fixture), trusted(), FROZEN_NOW)
    assert not result.accepted and result.reason == reason


def test_signature_covers_full_unsigned_envelope():
    bundle = load("valid_bundle.json")
    for field, value in [("expiresAt", "2030-01-01T00:00:00Z"), ("bundleVersion", 99), ("rulesetId", "gd-other"), ("schemaVersion", "1.0 ")]:
        mutated = {**bundle, field: value}
        result = verify_bundle(mutated, trusted(), FROZEN_NOW)
        assert not result.accepted, field


def test_schema_is_strict():
    bundle = load("valid_bundle.json")
    assert verify_bundle({**bundle, "extra": 1}, trusted(), FROZEN_NOW).reason == RejectReason.SCHEMA_INVALID
    assert verify_bundle({**bundle, "bundleVersion": "3"}, trusted(), FROZEN_NOW).reason == RejectReason.SCHEMA_INVALID
    assert verify_bundle({**bundle, "bundleVersion": 3.0}, trusted(), FROZEN_NOW).reason == RejectReason.SCHEMA_INVALID


@pytest.mark.skipif(os.environ.get("GD_CI_EPHEMERAL_KEY") == "1", reason="CI runs with an ephemeral signing key; the pinned key only exists in the controlled signing environment")
def test_pinned_public_key_matches_env_private_key():
    s = get_settings()
    assert security.public_key_b64(security.load_private_key(s.signing_private_key_b64)) == trusted()[s.signing_key_id]


@pytest.mark.anyio
async def test_backend_signs_and_serves_controlled_block_bundle(client):
    r = await client.get("/api/rules/gd-m1-controlled-block/latest")
    assert r.status_code == 200
    bundle = r.json()
    keys = {k["keyId"]: k["publicKeyB64"] for k in (await client.get("/api/keys")).json()}
    from datetime import datetime, timezone

    result = verify_bundle(bundle, keys, datetime.now(timezone.utc))
    assert result.accepted
    assert bundle["payload"]["rules"][0]["host"] == get_settings().controlled_host
    assert bundle["payload"]["rules"][0]["action"] == "block"


@pytest.mark.anyio
async def test_sign_endpoint_requires_admin_and_increments_version(client, admin_headers):
    body = {
        "rulesetId": "gd-m1-controlled-block",
        "confirm": True,
        "rules": [
            {"ruleId": "m1-controlled-block-001", "host": get_settings().controlled_host, "action": "block"},
            {"ruleId": "r-2", "host": "Evil.Example.", "action": "block"},
        ],
    }
    assert (await client.post("/api/rules/sign", json=body)).status_code == 401
    r = await client.post("/api/rules/sign", json=body, headers=admin_headers)
    assert r.status_code == 200
    assert r.json()["bundleVersion"] == 2
    assert r.json()["payload"]["rules"][1]["host"] == "evil.example"
    versions = (await client.get("/api/rules/gd-m1-controlled-block/versions")).json()["versions"]
    assert [v["bundleVersion"] for v in versions] == [2, 1]
