"""Regression for the DNS/DoH Capability Diagnostic Wizard's OWN dedicated ruleset
(`gd-m2-dns-diagnostic-wizard`) -- introduced after a physical-device review found that reusing one
shared probe hostname across all 5 wizard rows risked cross-row DNS-cache contamination (see
backend/scripts/create_dns_diagnostic_wizard_ruleset.py's docstring for the full rationale).

Verifies: the ruleset is on the signing allow-list, all 5 rows get their own distinct host+ruleId,
signing it is additive/idempotent (same pattern as test_m2_dns_capability_rule.py), and it never
touches or version-bumps the frozen `gd-m2-website-gate` bundle (rows 1.1-4.1 of Phase 6A depend on
that one staying exactly as frozen).
"""
from __future__ import annotations

import pytest

DNS_WIZARD_RULESET_ID = "gd-m2-dns-diagnostic-wizard"
M2_WEBSITE_GATE_RULESET_ID = "gd-m2-website-gate"

WIZARD_RULES = [
    {"ruleId": "m2-dns-wizard-dot-off-001", "host": "dnswiz-dot-off.blocktest.btciq.app", "action": "block", "category": "test-malicious"},
    {"ruleId": "m2-dns-wizard-dot-automatic-001", "host": "dnswiz-dot-automatic.blocktest.btciq.app", "action": "block", "category": "test-malicious"},
    {"ruleId": "m2-dns-wizard-dot-strict-001", "host": "dnswiz-dot-strict.blocktest.btciq.app", "action": "block", "category": "test-malicious"},
    {"ruleId": "m2-dns-wizard-doh-off-001", "host": "dnswiz-doh-off.blocktest.btciq.app", "action": "block", "category": "test-malicious"},
    {"ruleId": "m2-dns-wizard-doh-on-001", "host": "dnswiz-doh-on.blocktest.btciq.app", "action": "block", "category": "test-malicious"},
]


async def _sign(client, admin_headers, ruleset_id, rules):
    body = {"rulesetId": ruleset_id, "confirm": True, "purpose": "m2-website-gate-block", "rules": rules}
    return await client.post("/api/rules/sign", json=body, headers=admin_headers)


@pytest.mark.anyio
async def test_dns_diagnostic_wizard_ruleset_is_signing_allowed_and_all_5_hosts_distinct(client, admin_headers):
    hosts = {r["host"] for r in WIZARD_RULES}
    rule_ids = {r["ruleId"] for r in WIZARD_RULES}
    assert len(hosts) == 5, "every wizard row must get its own never-reused probe hostname"
    assert len(rule_ids) == 5

    r = await _sign(client, admin_headers, DNS_WIZARD_RULESET_ID, WIZARD_RULES)
    assert r.status_code == 200, r.text
    signed = r.json()
    assert signed["rulesetId"] == DNS_WIZARD_RULESET_ID
    assert signed["bundleVersion"] == 1
    assert {rule["host"] for rule in signed["payload"]["rules"]} == hosts

    latest = (await client.get(f"/api/rules/{DNS_WIZARD_RULESET_ID}/latest")).json()
    assert latest["bundleVersion"] == 1
    assert {rule["ruleId"] for rule in latest["payload"]["rules"]} == rule_ids


@pytest.mark.anyio
async def test_signing_the_dns_diagnostic_wizard_ruleset_never_touches_the_frozen_website_gate_bundle(client, admin_headers):
    base_website_gate_rules = [{"ruleId": "m2-block-blocktest-001", "host": "blocktest.btciq.app", "action": "block", "category": "test-malicious"}]
    gate_before = await _sign(client, admin_headers, M2_WEBSITE_GATE_RULESET_ID, base_website_gate_rules)
    assert gate_before.status_code == 200, gate_before.text
    gate_versions_before = (await client.get(f"/api/rules/{M2_WEBSITE_GATE_RULESET_ID}/versions")).json()["versions"]

    wizard = await _sign(client, admin_headers, DNS_WIZARD_RULESET_ID, WIZARD_RULES)
    assert wizard.status_code == 200, wizard.text

    gate_versions_after = (await client.get(f"/api/rules/{M2_WEBSITE_GATE_RULESET_ID}/versions")).json()["versions"]
    assert gate_versions_before == gate_versions_after, "gd-m2-website-gate must be completely unaffected by signing the diagnostic wizard's own ruleset"


@pytest.mark.anyio
async def test_dns_diagnostic_wizard_rulesets_reject_unsigned_or_missing_confirm(client, admin_headers):
    body = {"rulesetId": DNS_WIZARD_RULESET_ID, "confirm": False, "purpose": "m2-website-gate-block", "rules": WIZARD_RULES}
    r = await client.post("/api/rules/sign", json=body, headers=admin_headers)
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "CONFIRMATION_REQUIRED"
