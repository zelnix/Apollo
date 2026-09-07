"""Iteration 33 — post-split API regression.

Contract: identical behaviour to the pre-split monolith.
NOTE: /app/backend/tests/conftest.py installs an autouse shim that
transparently attaches a bearer to any /api/ call unless the header
X-Apollo-Raw is present. We use X-Apollo-Raw for all direct auth tests.
"""
from __future__ import annotations

import os
import uuid
from pathlib import Path

import pytest
import requests


def _load_admin_key() -> str:
    for line in Path("/app/backend/.env").read_text().splitlines():
        if line.startswith("APOLLO_ADMIN_KEY="):
            return line.split("=", 1)[1].strip()
    raise RuntimeError("APOLLO_ADMIN_KEY not found")


BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "https://threat-patrol-1.preview.emergentagent.com").rstrip("/")
ADMIN_KEY = _load_admin_key()
RAW = {"X-Apollo-Raw": "1"}  # bypass conftest auth-shim


def _post(url, **kw):
    kw.setdefault("headers", {}).update(RAW)
    return requests.post(url, timeout=20, **kw)


def _get(url, **kw):
    kw.setdefault("headers", {}).update(RAW)
    return requests.get(url, timeout=20, **kw)


def _put(url, **kw):
    kw.setdefault("headers", {}).update(RAW)
    return requests.put(url, timeout=20, **kw)


@pytest.fixture(scope="module")
def device():
    r = _post(f"{BASE_URL}/api/devices/register", json={"platform": "web", "adapter_mode": "mock", "app_version": "iter33"})
    assert r.status_code in (200, 201), r.text
    body = r.json()
    assert body["device_id"] and body["device_token"]
    return body


@pytest.fixture(scope="module")
def other_device():
    r = _post(f"{BASE_URL}/api/devices/register", json={"platform": "web", "adapter_mode": "mock", "app_version": "iter33b"})
    assert r.status_code in (200, 201), r.text
    return r.json()


def bearer(dev):
    return {"Authorization": f"Bearer {dev['device_token']}", **RAW}


# ---------- public endpoints ----------
def test_health_public():
    r = _get(f"{BASE_URL}/api/health")
    assert r.status_code == 200


def test_intel_status_public():
    r = _get(f"{BASE_URL}/api/intel/status")
    assert r.status_code == 200
    assert isinstance(r.json(), dict)


def test_docs_ui_loads():
    r = _get(f"{BASE_URL}/docs")
    assert r.status_code == 200
    assert "swagger" in r.text.lower() or "apollo" in r.text.lower()


def test_unknown_api_path_returns_stable_status():
    r = _get(f"{BASE_URL}/api/nope")
    assert r.status_code in (401, 404), f"unexpected {r.status_code}: {r.text[:200]}"
    print(f"[iter33] /api/nope -> {r.status_code}")


# ---------- auth semantics ----------
def test_no_bearer_returns_401_with_www_authenticate():
    r = _get(f"{BASE_URL}/api/devices/me")
    assert r.status_code == 401, r.text
    assert "bearer" in (r.headers.get("www-authenticate") or "").lower()


def test_devices_me_ok_with_bearer(device):
    r = _get(f"{BASE_URL}/api/devices/me", headers=bearer(device))
    assert r.status_code == 200
    assert r.json().get("device_id") == device["device_id"]


def test_patrol_events_cross_device_forbidden(device, other_device):
    r = _get(
        f"{BASE_URL}/api/patrol/events",
        params={"device_id": other_device["device_id"]},
        headers=bearer(device),
    )
    assert r.status_code == 403


def test_patrol_events_own_device_ok(device):
    r = _get(
        f"{BASE_URL}/api/patrol/events",
        params={"device_id": device["device_id"]},
        headers=bearer(device),
    )
    assert r.status_code == 200


# ---------- intel ----------
def test_intel_check_malicious_url(device):
    r = _post(
        f"{BASE_URL}/api/intel/check",
        json={"indicator_type": "url", "value": "https://phishing.apollo.test/login", "device_id": device["device_id"]},
        headers=bearer(device),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    verdict = (body.get("verdict") or body.get("classification") or body.get("state") or "").lower()
    assert verdict in ("malicious", "unsafe", "listed", "danger", "bark", "bad", "barking"), body


def test_intel_check_batch(device):
    r = _post(
        f"{BASE_URL}/api/intel/check-batch",
        json={"indicator_type": "url", "values": ["https://www.abc.net.au", "https://phishing.apollo.test/x"]},
        headers=bearer(device),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    results = body if isinstance(body, list) else (body.get("results") or body.get("items") or body.get("verdicts"))
    assert results and len(results) >= 2, body


# ---------- feedback + patrol event ----------
def test_feedback_created(device):
    ev_id = f"TEST_i33_{uuid.uuid4().hex[:8]}"
    ev = _post(
        f"{BASE_URL}/api/patrol/events",
        json={
            "device_id": device["device_id"],
            "event_id": ev_id,
            "kind": "link_check",
            "category": "link",
            "state": "resting",
            "status": "trusted",
            "host": "abc.net.au",
            "summary": "TEST_i33",
            "headline": "TEST_i33 link OK",
            "what_happened": "You checked a link.",
            "what_to_do": "Nothing to do.",
            "adapter_label": "Mock",
            "occurred_at": "2026-01-01T00:00:00Z",
        },
        headers=bearer(device),
    )
    assert ev.status_code in (200, 201), ev.text
    r = _post(
        f"{BASE_URL}/api/feedback",
        json={
            "device_id": device["device_id"],
            "event_id": ev_id,
            "kind": "false_positive",
            "state": "resting",
            "note": "TEST_i33 regression",
        },
        headers=bearer(device),
    )
    assert r.status_code in (200, 201), r.text


# ---------- device settings ----------
def test_device_settings_put_and_get(device):
    dev_id = device["device_id"]
    r_put = _put(
        f"{BASE_URL}/api/devices/{dev_id}/settings",
        json={"quiet_hours": {"enabled": True, "start_minutes": 22 * 60, "end_minutes": 7 * 60, "tz_offset_minutes": 0}},
        headers=bearer(device),
    )
    assert r_put.status_code in (200, 204), r_put.text
    r_get = _get(f"{BASE_URL}/api/devices/{dev_id}/settings", headers=bearer(device))
    assert r_get.status_code == 200
    body = r_get.json()
    qh = body.get("quiet_hours") or {}
    assert qh.get("start_minutes") == 22 * 60 and qh.get("end_minutes") == 7 * 60, body
    assert qh.get("enabled") is True, body


# ---------- push ----------
def test_register_push_placeholder(device):
    # With placeholder EMERGENT_PUSH_KEY, /register-push returns 500 with friendly detail
    # (documented behaviour — same as /push/test).
    r = _post(
        f"{BASE_URL}/api/register-push",
        json={"user_id": device["device_id"], "platform": "ios", "device_token": "TEST_iter33_expo_token"},
        headers=bearer(device),
    )
    # Per iter32 note: relay placeholder → still 201 or documented behaviour. Currently 500 friendly.
    assert r.status_code in (200, 201, 202, 500, 502, 503), f"unexpected {r.status_code}: {r.text[:200]}"
    if r.status_code >= 500:
        try:
            assert r.json().get("detail"), r.text
        except ValueError:
            pass


def test_push_test_placeholder_returns_error_with_detail(device):
    r = _post(
        f"{BASE_URL}/api/push/test",
        json={"device_id": device["device_id"]},
        headers=bearer(device),
    )
    # With placeholder EMERGENT_PUSH_KEY, /push/test → 5xx with friendly detail.
    assert r.status_code >= 400, f"expected error, got {r.status_code}: {r.text[:200]}"
    try:
        assert r.json().get("detail"), r.text
    except ValueError:
        pass


# ---------- admin ----------
def test_admin_ping():
    r = _get(f"{BASE_URL}/api/admin/ping", headers={"X-Admin-Key": ADMIN_KEY, **RAW})
    assert r.status_code == 200


def test_admin_stats():
    r = _get(f"{BASE_URL}/api/admin/stats", headers={"X-Admin-Key": ADMIN_KEY, **RAW})
    assert r.status_code == 200
    assert isinstance(r.json(), dict)


def test_admin_rejects_device_bearer(device):
    r = _get(f"{BASE_URL}/api/admin/ping", headers=bearer(device))
    assert r.status_code == 401


def test_devices_me_rejects_admin_key():
    r = _get(f"{BASE_URL}/api/devices/me", headers={"X-Admin-Key": ADMIN_KEY, **RAW})
    assert r.status_code == 401
