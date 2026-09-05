"""Apollo V1 backend regression tests.
Covers: health, intel status/check, device register, patrol events, trust, ask history.
"""
import json
import os
import time
import uuid
from datetime import datetime, timezone

import pytest
import requests

BASE_URL = "https://threat-patrol-1.preview.emergentagent.com"
API = f"{BASE_URL}/api"

DEVICE_ID = f"testdev-{uuid.uuid4().hex[:12]}"


@pytest.fixture(scope="module")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# --- health ---
def test_health(api_client):
    r = api_client.get(f"{API}/health")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "ok"
    assert body["service"] == "apollo-v1"


# --- intel/status ---
def test_intel_status(api_client):
    r = api_client.get(f"{API}/intel/status")
    assert r.status_code == 200, r.text
    body = r.json()
    assert "safe_browsing" in body
    assert body["safe_browsing"]["status"] in ("auth_error", "unreachable", "ok", "not_configured")
    # Per problem statement, key is rejected -> auth_error
    assert body["safe_browsing"]["status"] == "auth_error", f"expected auth_error, got {body['safe_browsing']}"
    assert body["blocklist"]["entries"] == 4, f"expected 4 blocklist entries, got {body['blocklist']}"


# --- device register ---
def test_device_register(api_client):
    payload = {"device_id": DEVICE_ID, "platform": "web", "adapter_mode": "mock", "app_version": "1.0.0"}
    r = api_client.post(f"{API}/devices/register", json=payload)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["device_id"] == DEVICE_ID
    assert body["registered"] is True
    # second call -> idempotent (registered False)
    r2 = api_client.post(f"{API}/devices/register", json=payload)
    assert r2.status_code == 200
    assert r2.json()["registered"] is False


# --- intel/check malicious ---
def test_intel_check_malicious(api_client):
    body = {"indicator_type": "url", "value": "http://testsafebrowsing.appspot.com/s/phishing.html", "device_id": DEVICE_ID}
    r = api_client.post(f"{API}/intel/check", json=body)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["verdict"] == "malicious", data
    names = {s["name"]: s for s in data["sources"]}
    assert names["apollo_blocklist"]["status"] == "match"
    assert data["cached"] is False


def test_intel_check_cached(api_client):
    body = {"indicator_type": "url", "value": "http://testsafebrowsing.appspot.com/s/phishing.html", "device_id": DEVICE_ID}
    r = api_client.post(f"{API}/intel/check", json=body)
    assert r.status_code == 200
    assert r.json()["cached"] is True


def test_intel_check_unknown(api_client):
    body = {"indicator_type": "url", "value": "https://www.abc.net.au", "device_id": DEVICE_ID}
    r = api_client.post(f"{API}/intel/check", json=body)
    assert r.status_code == 200, r.text
    data = r.json()
    # SB unavailable + blocklist clear -> unknown, partial coverage
    assert data["verdict"] == "unknown", data
    assert data["coverage"] == "partial"


def test_intel_check_invalid_scheme(api_client):
    body = {"indicator_type": "url", "value": "javascript:alert(1)"}
    r = api_client.post(f"{API}/intel/check", json=body)
    assert r.status_code == 422, r.text


# --- patrol events ---
EVT_ID = f"evt-{uuid.uuid4().hex[:12]}"


def _patrol_payload(event_id=None, status="active", state="barking"):
    return {
        "event_id": event_id or EVT_ID,
        "device_id": DEVICE_ID,
        "category": "link",
        "state": state,
        "status": status,
        "headline": "Don't open testsafebrowsing.appspot.com",
        "what_happened": "You checked a link Apollo recognises as unsafe.",
        "why": ["On Apollo's managed threat list"],
        "what_to_do": "Delete the message and don't tap the link.",
        "indicator_host": "testsafebrowsing.appspot.com",
        "adapter_label": "MOCK adapter — simulated",
        "occurred_at": datetime.now(timezone.utc).isoformat(),
    }


def test_patrol_upsert_and_idempotent(api_client):
    r1 = api_client.post(f"{API}/patrol/events", json=_patrol_payload())
    assert r1.status_code == 200, r1.text
    r2 = api_client.post(f"{API}/patrol/events", json=_patrol_payload())
    assert r2.status_code == 200
    # list should have exactly 1 with this event_id
    lst = api_client.get(f"{API}/patrol/events", params={"device_id": DEVICE_ID}).json()
    matching = [e for e in lst if e["event_id"] == EVT_ID]
    assert len(matching) == 1, f"expected 1, got {len(matching)}"


def test_patrol_patch(api_client):
    r = api_client.patch(
        f"{API}/patrol/events/{EVT_ID}",
        params={"device_id": DEVICE_ID},
        json={"status": "resolved", "state": "resting"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "resolved"


def test_patrol_soft_delete(api_client):
    r = api_client.delete(f"{API}/patrol/events", params={"device_id": DEVICE_ID})
    assert r.status_code == 200, r.text
    lst = api_client.get(f"{API}/patrol/events", params={"device_id": DEVICE_ID}).json()
    assert lst == [], f"expected empty after soft delete, got {lst}"


# --- trust ---
TRUST_ID = f"trust-{uuid.uuid4().hex[:12]}"


def test_trust_add_list_revoke(api_client):
    payload = {
        "device_id": DEVICE_ID,
        "indicator_type": "url",
        "indicator_digest": "a" * 32,
        "indicator_host": "commbank-secure-login-verify.xyz",
        "trust_id": TRUST_ID,
    }
    r = api_client.post(f"{API}/trust", json=payload)
    assert r.status_code == 200, r.text
    lst = api_client.get(f"{API}/trust", params={"device_id": DEVICE_ID}).json()
    assert any(t["trust_id"] == TRUST_ID for t in lst)
    d = api_client.delete(f"{API}/trust/{TRUST_ID}", params={"device_id": DEVICE_ID})
    assert d.status_code == 200
    assert d.json()["revoked"] is True
    lst2 = api_client.get(f"{API}/trust", params={"device_id": DEVICE_ID}).json()
    assert not any(t["trust_id"] == TRUST_ID for t in lst2)


# --- ask stream (SSE) ---
def test_ask_stream_sse(api_client):
    # clear history first
    api_client.delete(f"{API}/ask/history", params={"device_id": DEVICE_ID})
    body = {"device_id": DEVICE_ID, "message": "What is phishing in one sentence?"}
    r = requests.post(f"{API}/ask/stream", json=body, stream=True, timeout=45)
    assert r.status_code == 200, r.text[:400]
    got_delta = False
    got_done = False
    got_error = False
    started = time.time()
    for line in r.iter_lines(decode_unicode=True):
        if not line:
            continue
        if line.startswith("data:"):
            payload = json.loads(line[5:].strip())
            if "delta" in payload:
                got_delta = True
            if payload.get("done"):
                got_done = True
                break
            if "error" in payload:
                got_error = True
                break
        if time.time() - started > 40:
            break
    r.close()
    assert not got_error, "Ask stream returned error event"
    assert got_delta, "No delta events received from SSE"
    assert got_done, "No done event received from SSE"


def test_ask_history(api_client):
    r = api_client.get(f"{API}/ask/history", params={"device_id": DEVICE_ID})
    assert r.status_code == 200
    hist = r.json()
    roles = {m["role"] for m in hist}
    assert "user" in roles, hist
    assert "apollo" in roles, hist


# --- intel/check-batch (iteration 2) ---
def test_intel_check_batch_mixed(api_client):
    body = {
        "indicator_type": "url",
        "values": [
            "http://testsafebrowsing.appspot.com/s/phishing.html",  # blocklisted -> malicious
            "https://www.abc.net.au",                                 # unknown (partial)
            "javascript:alert(1)",                                    # invalid -> error
        ],
    }
    r = api_client.post(f"{API}/intel/check-batch", json=body)
    assert r.status_code == 200, r.text
    data = r.json()
    assert isinstance(data, list) and len(data) == 3, data
    by_val = {item["value"]: item for item in data}
    # blocklisted
    m = by_val["http://testsafebrowsing.appspot.com/s/phishing.html"]
    assert m["result"] is not None and m["result"]["verdict"] == "malicious", m
    assert not m.get("error")
    # unknown
    u = by_val["https://www.abc.net.au"]
    assert u["result"] is not None and u["result"]["verdict"] == "unknown", u
    # invalid -> error field set, result None
    inv = by_val["javascript:alert(1)"]
    assert inv["result"] is None and inv["error"], inv
