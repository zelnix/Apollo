import json

import pytest

from app.core.settings import get_settings
from app.services.rule_signer import RejectReason, verify_bundle
from tests.conftest import FROZEN_NOW, VECTORS


def load(name):
    return json.loads((VECTORS / "signing" / name).read_text())


@pytest.mark.anyio
async def test_keys_endpoint_exposes_public_metadata_only(client):
    keys = (await client.get("/api/keys")).json()
    ids = {k["keyId"] for k in keys}
    assert get_settings().signing_key_id in ids
    for k in keys:
        assert set(k) == {"keyId", "algorithm", "publicKeyB64", "status", "purpose", "introducedAt", "retiredAt"}
        assert "private" not in json.dumps(k).lower()


def test_key_rollover_unknown_then_introduced_then_retired():
    tk = load("trusted_keys.json")
    unknown = load("unknown_key_bundle.json")
    registry = dict(tk["trustedKeys"])
    assert verify_bundle(unknown, registry, FROZEN_NOW).reason == RejectReason.UNKNOWN_KEY
    registry.update(tk["rolloverKeys"])  # introduce second key: no API/bridge change
    assert verify_bundle(unknown, registry, FROZEN_NOW).accepted
    assert verify_bundle(load("valid_bundle.json"), registry, FROZEN_NOW).accepted  # current key still accepted
    registry.pop(get_settings().signing_key_id)  # retire old key
    assert verify_bundle(load("valid_bundle.json"), registry, FROZEN_NOW).reason == RejectReason.UNKNOWN_KEY
    assert verify_bundle(unknown, registry, FROZEN_NOW).accepted


@pytest.mark.anyio
async def test_retire_secondary_key_via_api(client, admin_headers):
    s = get_settings()
    r = await client.post(f"/api/keys/{s.secondary_key_id}/retire", headers=admin_headers)
    assert r.status_code == 200 and r.json()["status"] == "retired"
    r = await client.post(f"/api/keys/{s.signing_key_id}/retire", headers=admin_headers)
    assert r.status_code == 409
