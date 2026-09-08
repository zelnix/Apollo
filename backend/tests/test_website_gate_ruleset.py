"""Gate Guard M2 Website Gate: an independent, additive ruleset (gd-m2-website-gate).

These tests exist to prove the additive claim, not just exercise new code:
  * the M2 ruleset can be signed/looked up without touching the M1 controlled ruleset's
    bundle, version, or `signing_guard` behavior at all;
  * a host that only exists in the M2 ruleset is invisible to a lookup that doesn't ask
    for it (rulesetId omitted -> M1 behavior, byte-for-byte unchanged);
  * an expired ruleset surfaces `localRulesExpired=True` distinctly from "no local rule
    matched", and still fails open (never auto-blocks) through cache/cloud.
"""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

from app.core.settings import get_settings
from app.domain.models.rule_bundle import SignRequest
from app.domain.models.rule_entry import RuleEntry


@pytest.mark.anyio
async def test_m2_ruleset_signs_independently_of_m1(client, admin_headers):
    """Signing the M2 ruleset must not require the M1 controlled configuration and must
    not bump the M1 bundle version."""
    m1_before = (await client.get("/api/rules/gd-m1-controlled-block/versions")).json()["versions"]
    m2_before = (await client.get("/api/rules/gd-m2-website-gate/versions")).json()["versions"]

    body = {
        "rulesetId": "gd-m2-website-gate",
        "confirm": True,
        "purpose": "m2-website-gate-block",
        "rules": [
            {"ruleId": "m2-block-001", "host": "bad-test.guarddog.example", "action": "block", "category": "test-malicious"},
            {"ruleId": "m2-allow-001", "host": "good-test.guarddog.example", "action": "allow", "category": "test-safe"},
        ],
    }
    r = await client.post("/api/rules/sign", json=body, headers=admin_headers)
    assert r.status_code == 200, r.text
    assert r.json()["rulesetId"] == "gd-m2-website-gate"
    expected_version = (m2_before[0]["bundleVersion"] if m2_before else 0) + 1
    assert r.json()["bundleVersion"] == expected_version

    m1_after = (await client.get("/api/rules/gd-m1-controlled-block/versions")).json()["versions"]
    assert m1_before == m1_after  # M1 untouched


@pytest.mark.anyio
async def test_lookup_default_ruleset_unchanged_and_m2_host_is_invisible_without_rulesetid(client, admin_headers):
    body = {
        "rulesetId": "gd-m2-website-gate",
        "confirm": True,
        "rules": [{"ruleId": "m2-block-001", "host": "bad-test.guarddog.example", "action": "block"}],
    }
    assert (await client.post("/api/rules/sign", json=body, headers=admin_headers)).status_code == 200

    # 1) default (no rulesetId) behavior is exactly the pre-M2 M1 behavior: the controlled host still
    #    resolves locally, block.
    r = await client.post("/api/intelligence/lookup", json={"url": f"https://{get_settings().controlled_host}/x"})
    assert r.json()["verdict"] == "block" and r.json()["source"] == "local-signed-rules"
    assert r.json()["localRulesExpired"] is False

    # 2) the M2-only host is invisible to a default lookup (M1 ruleset has no rule for it) -> fails open
    r = await client.post("/api/intelligence/lookup", json={"url": "https://bad-test.guarddog.example/x"})
    assert r.json()["verdict"] == "unknown" and r.json()["degraded"] is True

    # 3) the same host, with rulesetId explicitly targeting the M2 ruleset, resolves locally as block
    r = await client.post(
        "/api/intelligence/lookup",
        json={"url": "https://bad-test.guarddog.example/x", "rulesetId": "gd-m2-website-gate"},
    )
    assert r.json()["verdict"] == "block" and r.json()["source"] == "local-signed-rules"
    assert r.json()["localRulesExpired"] is False


@pytest.mark.anyio
async def test_expired_m2_ruleset_is_degraded_not_silently_unknown(client):
    """Signs an already-expired M2 bundle directly via the service (the HTTP route always computes
    `issued=now`, so this exercises the service's `now` seam instead, mirroring test_rule_signing.py's
    own pattern for historical/expired fixtures)."""
    rule_service = client.app.state.rule_service
    past = datetime(2020, 1, 1, tzinfo=timezone.utc)
    request = SignRequest(
        rulesetId="gd-m2-website-gate",
        confirm=True,
        expiresAt="2020-01-02T00:00:00Z",
        rules=[RuleEntry(ruleId="m2-block-001", host="bad-test.guarddog.example", action="block")],
    )
    await rule_service.sign_and_publish(request, now=past)

    action, rule_id, expired = await rule_service.local_verdict("bad-test.guarddog.example", "gd-m2-website-gate")
    assert action is None and rule_id is None and expired is True

    r = await client.post(
        "/api/intelligence/lookup",
        json={"url": "https://bad-test.guarddog.example/x", "rulesetId": "gd-m2-website-gate"},
    )
    body = r.json()
    # expired local rules never auto-block: falls through to cache/cloud, which (provider unconfigured
    # in this test) fails open to unknown/degraded -- but distinctly flagged as localRulesExpired.
    assert body["verdict"] == "unknown"
    assert body["degraded"] is True
    assert body["localRulesExpired"] is True


@pytest.mark.anyio
async def test_config_exposes_website_gate_ruleset_id_additively(client):
    r = await client.get("/api/config")
    body = r.json()
    assert body["gateGuard"]["websiteGateRulesetId"] == "gd-m2-website-gate"
    # M1 fields untouched
    assert body["rulesetId"] == get_settings().ruleset_id
