"""Phase 6A M2.1 freeze regression: verifies that additively appending the dedicated Row-4.1
DNS-capability rule (m2-block-dns-capability-001 -> dnsprobe.blocktest.btciq.app) to the
gd-m2-website-gate ruleset -- the same operation backend/scripts/add_dns_capability_rule.py performs
against the live backend -- carries every existing rule forward unchanged, produces a properly
signed envelope, and leaves the frozen M1 ruleset + /api/config completely unaffected.

Uses the same in-process ASGI `client`/`admin_headers` fixtures (fresh, isolated DB per test) as the
rest of this suite -- NOT a live HTTP call to an external backend URL (there is no running server to
call in the CI `executable-suites` job) and NOT a hardcoded absolute bundle version or pinned public
key, since every test run here starts from an empty ruleset and CI signs with an ephemeral key.
"""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

from app.services.rule_signer import payload_hash, verify_bundle

M2_RULESET_ID = "gd-m2-website-gate"
M1_RULESET_ID = "gd-m1-controlled-block"

# Mirrors the real production gd-m2-website-gate rules -- rows 1.1-3.5 of the Phase 6A harness
# depend on m2-block-blocktest-001 staying exactly this shape (see
# backend/scripts/add_dns_capability_rule.py's own docstring) -- plus the new dedicated row-4.1 rule.
BASE_RULES = [
    {"ruleId": "m2-block-blocktest-001", "host": "blocktest.btciq.app", "action": "block", "category": "test-malicious"},
    {"ruleId": "m2-kotlin-test-allow-001", "host": "good-test.guarddog.example", "action": "allow", "category": "test-safe"},
    {"ruleId": "m2-kotlin-test-block-001", "host": "bad-test.guarddog.example", "action": "block", "category": "test-malicious"},
]
DNS_CAPABILITY_RULE = {
    "ruleId": "m2-block-dns-capability-001",
    "host": "dnsprobe.blocktest.btciq.app",
    "action": "block",
    "category": "test-malicious",
}


async def _sign(client, admin_headers, rules):
    body = {"rulesetId": M2_RULESET_ID, "confirm": True, "purpose": "m2-website-gate-block", "rules": rules}
    r = await client.post("/api/rules/sign", json=body, headers=admin_headers)
    assert r.status_code == 200, r.text
    return r.json()


async def _public_key_for(client, key_id: str) -> str:
    r = await client.get("/api/keys")
    for k in r.json():
        if k["keyId"] == key_id:
            return k["publicKeyB64"]
    pytest.fail(f"keyId {key_id} not found in /api/keys")


@pytest.mark.anyio
async def test_dns_capability_rule_added_additively_without_disturbing_existing_rules(client, admin_headers):
    base = await _sign(client, admin_headers, BASE_RULES)
    m1_before = (await client.get(f"/api/rules/{M1_RULESET_ID}/versions")).json()["versions"]

    updated = await _sign(client, admin_headers, [*BASE_RULES, DNS_CAPABILITY_RULE])
    assert updated["bundleVersion"] == base["bundleVersion"] + 1

    latest = (await client.get(f"/api/rules/{M2_RULESET_ID}/latest")).json()
    assert latest["bundleVersion"] == updated["bundleVersion"]
    rules = {r["ruleId"]: r for r in latest["payload"]["rules"]}
    assert set(rules.keys()) == {
        "m2-block-blocktest-001",
        "m2-kotlin-test-allow-001",
        "m2-kotlin-test-block-001",
        "m2-block-dns-capability-001",
    }

    new_rule = rules["m2-block-dns-capability-001"]
    assert new_rule["host"] == "dnsprobe.blocktest.btciq.app"
    assert new_rule["action"] == "block"

    old_rule = rules["m2-block-blocktest-001"]
    assert old_rule["host"] == "blocktest.btciq.app"
    assert old_rule["action"] == "block"

    # Envelope integrity: signed, hash matches, and the signature verifies against whichever key
    # (ephemeral in CI, pinned locally) actually signed it -- fetched dynamically, never pinned.
    assert latest["signature"] and latest["keyId"]
    assert latest["payloadHash"] == payload_hash(latest["payload"])
    pubkey = await _public_key_for(client, latest["keyId"])
    result = verify_bundle(latest, {latest["keyId"]: pubkey}, datetime.now(timezone.utc))
    assert result.accepted, f"bundle failed verification: {result.reason}"

    # M1 completely untouched by any of this.
    m1_after = (await client.get(f"/api/rules/{M1_RULESET_ID}/versions")).json()["versions"]
    assert m1_before == m1_after


@pytest.mark.anyio
async def test_config_exposes_website_gate_ruleset_id(client):
    r = await client.get("/api/config")
    body = r.json()
    assert body["gateGuard"]["websiteGateRulesetId"] == "gd-m2-website-gate"
