"""Scams feed three-tier contract + device data inventory/delete regression.

Review request iteration 79:
- GET /api/higgins/scams returns {coverage, generatedAt, feeds, alerts, emerging, pendingCount,
  lastAnalysedAt, growling} with no 'items' key.
- Every alert.tier == 'specific_scam'; every emerging.tier == 'emerging_pattern'; no
  general_education leaks into either list.
- Each alert.higgins.whatHappened and severityReason are non-empty and non-generic.
- facts dict present with all 7 keys.
- At least some AU HIGH/EXTREME alerts have growling==true; top-level growling is one of them
  or null.
- GET /api/devices/data-inventory and POST /api/devices/delete-data still device-authed and
  behave correctly (inventory shape, delete shape, token invalidated after purge).
"""
from __future__ import annotations

import os
import re

import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/frontend/.env")
BASE_URL = (os.environ.get("EXPO_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL must be set"

TIMEOUT = 30

GENERIC_PHRASES = [
    "scammers may steal your money",
    "fraudsters create fake websites",
    "be careful online",
    "always verify before clicking",
]


def _register_device():
    r = requests.post(
        f"{BASE_URL}/api/devices/register",
        json={"platform": "web", "adapter_mode": "mock"},
        timeout=TIMEOUT,
    )
    assert r.status_code == 201, (r.status_code, r.text)
    body = r.json()
    assert "device_token" in body and "device_id" in body
    return body


@pytest.fixture(scope="module")
def device():
    return _register_device()


@pytest.fixture(scope="module")
def auth_headers(device):
    return {"Authorization": f"Bearer {device['device_token']}"}


# ---------------------------------------------------------------------- /api/higgins/scams


class TestScamsFeedContract:
    def test_scams_returns_200_with_contract_keys(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/higgins/scams", headers=auth_headers, timeout=TIMEOUT)
        assert r.status_code == 200, (r.status_code, r.text[:400])
        body = r.json()
        for key in ("coverage", "generatedAt", "feeds", "alerts", "emerging", "pendingCount", "lastAnalysedAt", "growling"):
            assert key in body, f"missing key {key}; got keys={list(body.keys())}"
        assert "items" not in body, "legacy 'items' key should no longer be present"
        assert isinstance(body["alerts"], list)
        assert isinstance(body["emerging"], list)
        assert isinstance(body["feeds"], dict)
        assert isinstance(body["pendingCount"], int)

    def test_alerts_only_specific_scam_tier(self, auth_headers):
        body = requests.get(f"{BASE_URL}/api/higgins/scams", headers=auth_headers, timeout=TIMEOUT).json()
        for a in body["alerts"]:
            assert a.get("tier") == "specific_scam", f"non-specific tier in alerts: {a.get('tier')} / {a.get('title')}"

    def test_emerging_only_emerging_pattern_tier(self, auth_headers):
        body = requests.get(f"{BASE_URL}/api/higgins/scams", headers=auth_headers, timeout=TIMEOUT).json()
        for a in body["emerging"]:
            assert a.get("tier") == "emerging_pattern", f"non-emerging tier in emerging: {a.get('tier')} / {a.get('title')}"

    def test_no_general_education_in_either_list(self, auth_headers):
        body = requests.get(f"{BASE_URL}/api/higgins/scams", headers=auth_headers, timeout=TIMEOUT).json()
        for a in body["alerts"] + body["emerging"]:
            assert a.get("tier") != "general_education"

    def test_alert_fields_shape_and_non_generic(self, auth_headers):
        body = requests.get(f"{BASE_URL}/api/higgins/scams", headers=auth_headers, timeout=TIMEOUT).json()
        alerts = body["alerts"]
        if not alerts:
            pytest.skip(f"no specific alerts right now (pendingCount={body['pendingCount']}); shape test skipped")
        fact_keys = {"who", "what", "how", "where", "when", "whatCriminalsWant", "evidence"}
        for a in alerts:
            higgins = a.get("higgins") or {}
            wh = (higgins.get("whatHappened") or "").strip()
            sr = (a.get("severityReason") or "").strip()
            assert wh, f"empty higgins.whatHappened on {a.get('title')}"
            assert sr, f"empty severityReason on {a.get('title')}"
            low = wh.lower()
            for g in GENERIC_PHRASES:
                assert g not in low, f"generic filler phrase in whatHappened: {g!r} / {a.get('title')}"
            facts = a.get("facts")
            assert isinstance(facts, dict), f"facts missing on {a.get('title')}"
            assert fact_keys.issubset(set(facts.keys())), f"facts keys incomplete: {set(facts.keys())}"

    def test_au_high_or_extreme_growling_and_top_level(self, auth_headers):
        body = requests.get(f"{BASE_URL}/api/higgins/scams", headers=auth_headers, timeout=TIMEOUT).json()
        alerts = body["alerts"]
        if not alerts:
            pytest.skip("no specific alerts to evaluate growling")
        au_high = [
            a for a in alerts
            if a.get("severity") in ("HIGH", "EXTREME")
            and (a.get("region") == "AU" or a.get("australianRelevance") == "confirmed")
        ]
        if au_high:
            assert any(a.get("growling") for a in au_high), "expected at least one AU HIGH/EXTREME alert to be growling"
        top = body["growling"]
        if top is not None:
            # top-level growling should match one of the specific alerts
            urls = {a.get("url") for a in alerts}
            assert top.get("url") in urls, "top-level growling is not one of the specific alerts"
            assert top.get("tier") == "specific_scam"

    def test_scams_requires_device_auth(self):
        # X-Apollo-Raw bypasses the conftest auth shim so the server really sees no bearer.
        r = requests.get(f"{BASE_URL}/api/higgins/scams", headers={"X-Apollo-Raw": "1"}, timeout=TIMEOUT)
        assert r.status_code == 401


# ---------------------------------------------- /api/devices/data-inventory + /delete-data


class TestDeviceDataLifecycle:
    def test_inventory_shape(self):
        dev = _register_device()
        headers = {"Authorization": f"Bearer {dev['device_token']}"}
        r = requests.get(f"{BASE_URL}/api/devices/data-inventory", headers=headers, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["device_id"] == dev["device_id"]
        assert isinstance(body["total"], int)
        assert isinstance(body["categories"], list) and body["categories"]
        for c in body["categories"]:
            assert set(c.keys()) >= {"key", "label", "count"}
            assert isinstance(c["count"], int)

    def test_delete_data_returns_contract_and_invalidates_token(self):
        dev = _register_device()
        headers = {"Authorization": f"Bearer {dev['device_token']}"}
        r = requests.post(f"{BASE_URL}/api/devices/delete-data", headers=headers, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["device_id"] == dev["device_id"]
        assert isinstance(body["total"], int)
        assert isinstance(body["removed"], dict) and body["removed"]
        assert "deleted_at" in body and re.match(r"^\d{4}-\d{2}-\d{2}T", body["deleted_at"])
        # Token must now be 401
        r2 = requests.get(f"{BASE_URL}/api/devices/data-inventory", headers=headers, timeout=TIMEOUT)
        assert r2.status_code == 401, f"token should be revoked after delete-data; got {r2.status_code}"

    def test_inventory_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/devices/data-inventory", headers={"X-Apollo-Raw": "1"}, timeout=TIMEOUT)
        assert r.status_code == 401

    def test_delete_requires_auth(self):
        r = requests.post(f"{BASE_URL}/api/devices/delete-data", headers={"X-Apollo-Raw": "1"}, timeout=TIMEOUT)
        assert r.status_code == 401
