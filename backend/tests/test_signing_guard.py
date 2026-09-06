"""Signing guard tests: signing is an admin/test workflow, never an anonymous public API."""
import dataclasses
import logging

import pytest

from app.core.logging import SecretRedactionFilter
from app.core.settings import get_settings
from app.main import build_services

CONTROLLED = {"ruleId": "m1-controlled-block-001", "host": get_settings().controlled_host, "action": "block", "category": "controlled-test"}


def body(**overrides):
    b = {"rulesetId": "gd-m1-controlled-block", "confirm": True, "rules": [CONTROLLED]}
    b.update(overrides)
    return b


@pytest.mark.anyio
async def test_anonymous_signing_is_impossible(client):
    r = await client.post("/api/rules/sign", json=body())
    assert r.status_code == 401
    r = await client.post("/api/rules/sign", json=body(), headers={"X-GuardDog-Admin-Token": "wrong"})
    assert r.status_code == 401


@pytest.mark.anyio
async def test_confirmation_required(client, admin_headers):
    r = await client.post("/api/rules/sign", json=body(confirm=False), headers=admin_headers)
    assert r.status_code == 409 and r.json()["detail"]["code"] == "CONFIRMATION_REQUIRED"
    r = await client.post("/api/rules/sign", json={k: v for k, v in body().items() if k != "confirm"}, headers=admin_headers)
    assert r.status_code == 409


@pytest.mark.anyio
async def test_ruleset_allowlist(client, admin_headers):
    r = await client.post("/api/rules/sign", json=body(rulesetId="gd-production-anything"), headers=admin_headers)
    assert r.status_code == 403 and r.json()["detail"]["code"] == "RULESET_NOT_ALLOWED"


@pytest.mark.anyio
async def test_controlled_block_cannot_be_silently_replaced(client, admin_headers):
    r = await client.post("/api/rules/sign", json=body(rules=[{"ruleId": "x", "host": "evil.example", "action": "block"}]), headers=admin_headers)
    assert r.status_code == 422 and r.json()["detail"]["code"] == "CONTROLLED_CONFIG_MISMATCH"
    r = await client.post("/api/rules/sign", json=body(rules=[{**CONTROLLED, "action": "allow"}]), headers=admin_headers)
    assert r.status_code == 422 and r.json()["detail"]["code"] == "CONTROLLED_CONFIG_MISMATCH"
    # Adding other rules alongside the controlled block is fine (controlled host normalized from a variant).
    r = await client.post(
        "/api/rules/sign",
        json=body(rules=[{**CONTROLLED, "host": get_settings().controlled_host.upper() + "."}, {"ruleId": "x", "host": "evil.example", "action": "block"}]),
        headers=admin_headers,
    )
    assert r.status_code == 200 and r.json()["bundleVersion"] == 2
    latest = (await client.get("/api/rules/gd-m1-controlled-block/latest")).json()
    assert any(rule["host"] == get_settings().controlled_host and rule["action"] == "block" for rule in latest["payload"]["rules"])


@pytest.mark.anyio
async def test_signing_disabled_deployment(client, admin_headers):
    s = client.app.state.settings
    client.app.state.settings = dataclasses.replace(s, signing_enabled=False)
    try:
        r = await client.post("/api/rules/sign", json=body(), headers=admin_headers)
        assert r.status_code == 403 and r.json()["detail"]["code"] == "SIGNING_DISABLED"
    finally:
        client.app.state.settings = s
    assert (await client.get("/api/rules/gd-m1-controlled-block/latest")).status_code == 200  # distribution unaffected



@pytest.mark.anyio
async def test_frozen_bundle_refuses_resign_of_controlled_ruleset_only(client, admin_headers):
    s = client.app.state.settings
    before = (await client.get("/api/rules/gd-m1-controlled-block/latest")).json()["bundleVersion"]
    client.app.state.settings = dataclasses.replace(s, frozen_bundle_version=before)
    try:
        r = await client.post("/api/rules/sign", json=body(), headers=admin_headers)
        assert r.status_code == 409 and r.json()["detail"]["code"] == "BUNDLE_FROZEN"
        assert (await client.get("/api/config")).json()["signing"]["frozenBundleVersion"] == before
    finally:
        client.app.state.settings = s
    assert (await client.get("/api/rules/gd-m1-controlled-block/latest")).json()["bundleVersion"] == before
    assert (await client.get("/api/config")).json()["signing"]["frozenBundleVersion"] is None


def test_private_key_material_never_printed_or_logged():
    s = get_settings()
    text = repr(s)
    assert s.signing_private_key_b64 not in text and s.admin_token not in text
    record = logging.LogRecord("guarddog.x", logging.INFO, "", 0, "seed=%s token=%s", (s.signing_private_key_b64, s.admin_token), None)
    SecretRedactionFilter(s.secrets()).filter(record)
    assert s.signing_private_key_b64 not in record.getMessage() and s.admin_token not in record.getMessage()


@pytest.mark.anyio
async def test_public_surfaces_never_expose_private_key(client):
    s = get_settings()
    for path in ("/api/keys", "/api/config", "/api/health", "/api/rules/gd-m1-controlled-block/latest"):
        text = (await client.get(path)).text
        assert s.signing_private_key_b64 not in text and s.admin_token not in text, path
    assert build_services  # module wiring imported (sanity)
