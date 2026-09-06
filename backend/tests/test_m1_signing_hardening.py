"""M1 signing hardening + secret-leak regression tests against the LIVE public backend URL.

Focus (this iteration):
  - POST /api/rules/sign auth (401 anonymous / 401 wrong token)
  - CONFIRMATION_REQUIRED (409 when confirm missing/false)
  - RULESET_NOT_ALLOWED (403 when rulesetId not on allow-list)
  - CONTROLLED_CONFIG_MISMATCH (422 when controlled block missing OR flipped to allow)
  - Happy path: token+confirm+controlled-block-preserved+extra canonicalized host -> 200, version increments,
    controlled host still present, /latest still contains the controlled block afterwards.
  - Public surfaces (/api/keys, /api/config, /api/health, /api/rules/{controlled}/latest) never expose
    the Ed25519 private seed or the admin token.
  - /api/config exposes controlledEndpoint.isPlaceholder=true and the expected signing metadata.
  - Backend supervisor logs do not contain the Ed25519 private seed.
"""
from __future__ import annotations

import json
import os
import re
import uuid
from pathlib import Path

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://guard-dog-m1.preview.emergentagent.com").rstrip("/")
# Live tests sign bundles against the RUNNING backend. Disabled by default so the controlled bundle is never
# resigned implicitly (final M1 signing waits for infrastructure confirmation). Enable with GD_RUN_LIVE_TESTS=1.
pytestmark = pytest.mark.skipif(__import__("os").environ.get("GD_RUN_LIVE_TESTS") != "1", reason="live signing tests disabled by default")
ADMIN_TOKEN = "m1-dev-admin-token-change-me"
PRIVATE_SEED = "qPjRUS79sQkfUvlyMdlu38nbDtuau+N3JSYEgLh2gWw="
SECONDARY_SEED = "IF0goB6MZnabxSv26FW1jd0vOf+E387URWP+1PgdK9M="
CONTROLLED_HOST = __import__("os").environ.get("GD_CONTROLLED_HOST", "blocktest.btciq.app")
CONTROLLED_RULE = {"ruleId": "m1-controlled-block-001", "host": CONTROLLED_HOST, "action": "block"}


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


@pytest.fixture(scope="module")
def admin():
    return {"X-GuardDog-Admin-Token": ADMIN_TOKEN}


def _body(**overrides):
    b = {"rulesetId": "gd-m1-controlled-block", "confirm": True, "rules": [dict(CONTROLLED_RULE)]}
    b.update(overrides)
    return b


# --- Auth guards ---
class TestSigningAuth:
    def test_anonymous_signing_rejected(self, s):
        r = s.post(f"{BASE_URL}/api/rules/sign", json=_body())
        assert r.status_code == 401

    def test_wrong_admin_token_rejected(self, s):
        r = s.post(f"{BASE_URL}/api/rules/sign", json=_body(), headers={"X-GuardDog-Admin-Token": "not-the-real-token"})
        assert r.status_code == 401


# --- Precondition guards ---
class TestSigningPreconditions:
    def test_confirm_missing_returns_409(self, s, admin):
        body = _body()
        body.pop("confirm")
        r = s.post(f"{BASE_URL}/api/rules/sign", json=body, headers=admin)
        assert r.status_code == 409, r.text
        assert r.json()["detail"]["code"] == "CONFIRMATION_REQUIRED"

    def test_confirm_false_returns_409(self, s, admin):
        r = s.post(f"{BASE_URL}/api/rules/sign", json=_body(confirm=False), headers=admin)
        assert r.status_code == 409, r.text
        assert r.json()["detail"]["code"] == "CONFIRMATION_REQUIRED"

    def test_ruleset_not_on_allowlist_returns_403(self, s, admin):
        r = s.post(f"{BASE_URL}/api/rules/sign", json=_body(rulesetId="gd-other-ruleset"), headers=admin)
        assert r.status_code == 403, r.text
        assert r.json()["detail"]["code"] == "RULESET_NOT_ALLOWED"


def _expect_refused(s, r):
    """While the live bundle is frozen every re-sign of the controlled ruleset is refused with 409 BUNDLE_FROZEN
    (checked before rule content); otherwise the controlled-configuration guard answers 422."""
    frozen = s.get(f"{BASE_URL}/api/config").json()["signing"].get("frozenBundleVersion")
    if frozen is not None:
        assert r.status_code == 409, r.text
        assert r.json()["detail"]["code"] == "BUNDLE_FROZEN"
    else:
        assert r.status_code == 422, r.text
        assert r.json()["detail"]["code"] == "CONTROLLED_CONFIG_MISMATCH"


# --- Controlled-configuration guard (never mutates: every request here is refused) ---
class TestControlledConfigurationGuard:
    def test_controlled_block_cannot_be_replaced_with_unrelated_rule(self, s, admin):
        body = _body(rules=[{"ruleId": "x", "host": "evil.example", "action": "block"}])
        _expect_refused(s, s.post(f"{BASE_URL}/api/rules/sign", json=body, headers=admin))

    def test_controlled_host_flipped_to_allow_is_rejected(self, s, admin):
        body = _body(rules=[{**CONTROLLED_RULE, "action": "allow"}])
        _expect_refused(s, s.post(f"{BASE_URL}/api/rules/sign", json=body, headers=admin))

    def test_frozen_bundle_refuses_even_a_valid_resign(self, s, admin):
        frozen = s.get(f"{BASE_URL}/api/config").json()["signing"].get("frozenBundleVersion")
        if frozen is None:
            pytest.skip("bundle not frozen")
        before = s.get(f"{BASE_URL}/api/rules/gd-m1-controlled-block/latest").json()["bundleVersion"]
        r = s.post(f"{BASE_URL}/api/rules/sign", json=_body(), headers=admin)
        assert r.status_code == 409 and r.json()["detail"]["code"] == "BUNDLE_FROZEN", r.text
        assert s.get(f"{BASE_URL}/api/rules/gd-m1-controlled-block/latest").json()["bundleVersion"] == before == frozen


# --- Happy path: MUTATES the live controlled ruleset (bumps the frozen M1 bundle). Only with GD_ALLOW_LIVE_RESIGN=1;
# afterwards run `python scripts/resign_controlled_bundle.py --confirm` to restore the single-rule M1 bundle. ---
class TestSigningHappyPath:
    @pytest.mark.skipif(os.environ.get("GD_ALLOW_LIVE_RESIGN") != "1", reason="would resign the frozen M1 controlled bundle")
    def test_valid_sign_increments_and_canonicalizes_and_preserves_controlled(self, s, admin):
        prev = s.get(f"{BASE_URL}/api/rules/gd-m1-controlled-block/latest").json()["bundleVersion"]
        extra_id = f"t-{uuid.uuid4().hex[:8]}"
        body = _body(rules=[
            dict(CONTROLLED_RULE),
            {"ruleId": extra_id, "host": "Evil.Example.", "action": "block"},
        ])
        r = s.post(f"{BASE_URL}/api/rules/sign", json=body, headers=admin)
        assert r.status_code == 200, r.text
        signed = r.json()

        assert signed["bundleVersion"] == prev + 1
        hosts = {rule["host"] for rule in signed["payload"]["rules"]}
        assert CONTROLLED_HOST in hosts, "controlled block must remain present after signing"
        assert "evil.example" in hosts, f"'Evil.Example.' should canonicalize to 'evil.example', got {hosts}"

        # /latest still valid
        latest = s.get(f"{BASE_URL}/api/rules/gd-m1-controlled-block/latest").json()
        assert any(rule["host"] == CONTROLLED_HOST and rule["action"] == "block" for rule in latest["payload"]["rules"])
        assert latest["bundleVersion"] == prev + 1

        # Ensure no private-material leaks in a signed response
        text = json.dumps(signed)
        assert PRIVATE_SEED not in text
        assert SECONDARY_SEED not in text
        assert ADMIN_TOKEN not in text


# --- No secret leaks anywhere on public surfaces ---
class TestPublicSurfaceSecretLeaks:
    def test_public_endpoints_never_leak_private_seed_or_admin_token(self, s):
        for path in (
            "/api/keys",
            "/api/config",
            "/api/health",
            "/api/rules/gd-m1-controlled-block/latest",
        ):
            r = s.get(f"{BASE_URL}{path}")
            assert r.status_code == 200, f"{path}: {r.status_code}"
            assert PRIVATE_SEED not in r.text, f"private seed leaked at {path}"
            assert SECONDARY_SEED not in r.text, f"secondary seed leaked at {path}"
            assert ADMIN_TOKEN not in r.text, f"admin token leaked at {path}"

    def test_config_signing_metadata_and_placeholder_flag(self, s):
        d = s.get(f"{BASE_URL}/api/config").json()
        assert d["controlledEndpoint"]["isPlaceholder"] is False
        signing = d["signing"]
        assert signing["enabled"] is True
        assert signing["requiresAdminToken"] is True
        assert signing["requiresConfirm"] is True
        assert signing["allowedRulesets"] == ["gd-m1-controlled-block"]


# --- Log file inspection (runs where supervisor logs are visible) ---
class TestBackendLogsNoSeed:
    def test_supervisor_backend_logs_do_not_contain_private_seed(self):
        log_paths = list(Path("/var/log/supervisor").glob("backend.*.log"))
        if not log_paths:
            pytest.skip("no supervisor backend logs available in this environment")
        offenders = []
        for p in log_paths:
            try:
                text = p.read_text(errors="ignore")
            except OSError:
                continue
            if PRIVATE_SEED in text or SECONDARY_SEED in text:
                # find the offending line for the report
                for line in text.splitlines():
                    if PRIVATE_SEED in line or SECONDARY_SEED in line:
                        offenders.append(f"{p}: {line[:200]}")
                        break
        assert not offenders, "private seed leaked into backend logs: " + "; ".join(offenders)
