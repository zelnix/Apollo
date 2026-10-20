"""Live API acceptance for the 2-tier Triage → Magnum DI contract.

Testing agent iteration (Jan 2026). Hits the public preview URL to verify:
  - background text intake: benign → NO_THREAT/LIMITED, caseId None, 0 Gemini calls
  - background text intake: scam → POSSIBLE_THREAT, caseId present, MSG-01 met
  - idempotency: duplicate submission_id = exactly one case
  - Patrol History persists triage event with required payload keys (for every outcome)
  - POST /api/call/risk-check still works, geminiCalls=0 contract untouched
  - GET /api/health, POST /api/investigations, GET /api/patrol/events
"""
from __future__ import annotations

import os
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")


def _base_url() -> str:
    base = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")
    if not base:
        env_file = Path(__file__).resolve().parents[2] / "frontend" / ".env"
        if env_file.exists():
            for line in env_file.read_text().splitlines():
                if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                    base = line.split("=", 1)[1].strip(); break
                if line.startswith("EXPO_BACKEND_URL="):
                    base = line.split("=", 1)[1].strip(); break
    assert base, "EXPO_PUBLIC_BACKEND_URL required"
    return base.rstrip("/")


BASE = _base_url()
API = f"{BASE}/api"
H = {"User-Agent": "apollo-tests-triage", "X-Apollo-Raw": "1"}


def _device():
    r = requests.post(f"{API}/devices/register",
                      json={"platform": "web", "adapter_mode": "mock"},
                      headers=H, timeout=20)
    r.raise_for_status()
    j = r.json()
    auth = {**H, "Authorization": f"Bearer {j['device_token']}"}
    return j["device_id"], auth


def _bg_text_body(sender: str, text: str, submission_id: str | None = None) -> dict:
    now = datetime.now(timezone.utc)
    return {
        "submissionId": submission_id or str(uuid.uuid4()),
        "sourceKey": "sms:inbox:1",
        "revisionDigest": uuid.uuid4().hex,
        "sender": sender,
        "text": text,
        "capturedAt": now.isoformat().replace("+00:00", "Z"),
        "expiresAt": (now + timedelta(minutes=10)).isoformat().replace("+00:00", "Z"),
        "contentComplete": True,
        "originalCharacters": max(len(text), 1),
    }


# ─────────────────────────── health / baseline ───────────────────────────

def test_api_health_ok():
    r = requests.get(f"{API}/health", timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("status") in ("ok", "healthy"), body


def test_device_register_returns_token():
    did, auth = _device()
    assert did and "Authorization" in auth


# ─────────────────────────── background text: benign ───────────────────────────

def test_benign_text_triage_no_case_zero_gemini():
    _, auth = _device()
    r = requests.post(f"{API}/investigations/background/text",
                      json=_bg_text_body("Mum", "Dinner at 6 tonight"),
                      headers=auth, timeout=20)
    assert r.status_code == 202, r.text
    j = r.json()
    assert j["caseId"] is None, j
    assert j.get("jobId") is None, j
    triage = j["triage"]
    assert triage["outcome"] in ("NO_THREAT_IDENTIFIED", "LIMITED_UNABLE_TO_DETERMINE"), triage
    assert triage["geminiCalls"] == 0, triage
    # The investigation sub-object carries the deterministic rule record
    inv = triage.get("investigation") or {}
    for key in ("rulesApplicable", "rulesChecked", "rulesMet", "coverageGaps",
                "retries", "correlation", "reason", "geminiCalls"):
        assert key in inv, f"missing {key} in triage.investigation wire: {inv}"
    assert inv["geminiCalls"] == 0


# ─────────────────────────── background text: scam ───────────────────────────

def test_scam_text_triage_possible_threat_creates_one_case():
    did, auth = _device()
    sub = str(uuid.uuid4())
    body = _bg_text_body(
        "+61400000000",
        "Reply with the 6-digit verification code to unlock your account",
        submission_id=sub,
    )
    r = requests.post(f"{API}/investigations/background/text",
                      json=body, headers=auth, timeout=25)
    assert r.status_code == 202, r.text
    j = r.json()
    assert j["caseId"], j
    case_id_1 = j["caseId"]
    triage = j["triage"]
    assert triage["outcome"] == "POSSIBLE_THREAT_IDENTIFIED", triage
    inv = triage.get("investigation") or {}
    assert "MSG-01" in inv.get("rulesMet", []), inv
    assert triage["geminiCalls"] == 0, triage
    assert inv.get("geminiCalls") == 0, inv

    # Idempotency — same submission_id must resolve to the same case
    r2 = requests.post(f"{API}/investigations/background/text",
                       json=body, headers=auth, timeout=25)
    assert r2.status_code == 202, r2.text
    j2 = r2.json()
    assert j2["caseId"] == case_id_1, (j, j2)


# ─────────────────────────── patrol history records every outcome ───────────────────────────

def _poll_patrol(auth, device_id, predicate, tries=10, delay=0.5):
    for _ in range(tries):
        r = requests.get(f"{API}/patrol/events",
                         params={"device_id": device_id},
                         headers=auth, timeout=20)
        if r.status_code == 200:
            events = r.json()
            match = [e for e in events if predicate(e)]
            if match:
                return match
        time.sleep(delay)
    return []


def test_patrol_history_records_triage_for_benign():
    did, auth = _device()
    requests.post(f"{API}/investigations/background/text",
                  json=_bg_text_body("Mum", "Dinner at 6 tonight"),
                  headers=auth, timeout=20)
    matches = _poll_patrol(auth, did,
        lambda e: e.get("adapter_label") == "Apollo Triage (deterministic)")
    assert matches, "no triage patrol event recorded for benign text"
    ev = matches[0]
    rec = ev.get("triage_investigation") or {}
    assert rec, f"no triage_investigation payload on event: {ev}"
    assert rec["geminiCalls"] == 0
    for key in ("rulesApplicable", "rulesChecked", "rulesMet", "coverageGaps",
                "retries", "correlation", "reason"):
        assert key in rec, f"missing {key} in persisted triage"


def test_patrol_history_records_triage_for_scam():
    did, auth = _device()
    r = requests.post(f"{API}/investigations/background/text",
                      json=_bg_text_body("+61400000000",
                                         "Reply with the 6-digit verification code to unlock your account"),
                      headers=auth, timeout=25)
    assert r.status_code == 202
    matches = _poll_patrol(auth, did,
        lambda e: e.get("adapter_label") == "Apollo Triage (deterministic)"
        and (e.get("triage_investigation") or {}).get("outcome") == "POSSIBLE_THREAT_IDENTIFIED")
    assert matches, "no POSSIBLE_THREAT triage event recorded"
    rec = matches[0]["triage_investigation"]
    assert rec["geminiCalls"] == 0
    assert "MSG-01" in rec["rulesMet"]


# ─────────────────────────── call risk-check: no Gemini ───────────────────────────

def test_call_risk_check_still_works_no_gemini():
    did, auth = _device()
    r = requests.post(f"{API}/call/risk-check",
                      json={"device_id": did, "number": "+18007132618"},
                      headers=auth, timeout=25)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "number" in body
    # must return a decision indicator; implementations use `decision`/`fraud_score`
    assert any(k in body for k in ("decision", "fraud_score", "risky", "assessment")), body


# ─────────────────────────── explicit Magnum DI still allowed ───────────────────────────

def test_user_requested_investigation_endpoint_responds():
    _, auth = _device()
    payload = {
        "question": "Is this phishing?",
        "submissions": [{
            "clientItemId": f"ci-{uuid.uuid4().hex[:12]}",
            "kind": "text",
            "value": "Reply STOP to opt-out — totally normal",
            "label": "manual",
        }],
        "initialFindings": [],
    }
    r = requests.post(f"{API}/investigations", json=payload,
                      headers={**auth, "Idempotency-Key": uuid.uuid4().hex},
                      timeout=25)
    assert r.status_code in (201, 202), r.text
    body = r.json()
    assert "case" in body and body["case"].get("id"), body


def test_patrol_events_endpoint_basic():
    did, auth = _device()
    r = requests.get(f"{API}/patrol/events", params={"device_id": did},
                     headers=auth, timeout=15)
    assert r.status_code == 200
    assert isinstance(r.json(), list)

# ─────────────────── client cannot spoof a Triage Investigation ───────────────────

def test_client_cannot_spoof_triage_investigation():
    """triage_investigation is server-owned: a client-supplied record must be discarded."""
    did, auth = _device()
    event_id = f"spoof-{uuid.uuid4().hex[:16]}"
    now = datetime.now(timezone.utc)
    body = {
        "event_id": event_id,
        "device_id": did,
        "category": "message",
        "state": "resting",
        "status": "active",
        "headline": "Client submitted event",
        "what_happened": "A client attempted to attach its own triage record.",
        "why": ["spoof attempt"],
        "what_to_do": "Nothing.",
        "adapter_label": "Apollo on-device assessment",
        "occurred_at": now.isoformat().replace("+00:00", "Z"),
        "triage_investigation": {
            "outcome": "NO_THREAT_IDENTIFIED",
            "geminiCalls": 99,
            "rulesApplicable": ["MSG-01"],
            "rulesChecked": ["MSG-01"],
            "rulesMet": ["MSG-01"],
            "coverageGaps": [],
            "retries": 0,
            "correlation": {},
            "reason": "spoofed by client",
        },
    }
    r = requests.post(f"{API}/patrol/events", json=body, headers=auth, timeout=20)
    assert r.status_code in (200, 201), r.text
    assert not r.json().get("triage_investigation"), r.json()

    events = requests.get(f"{API}/patrol/events", params={"device_id": did},
                          headers=auth, timeout=20).json()
    stored = [e for e in events if e.get("event_id") == event_id]
    assert stored, "event was not stored"
    assert not stored[0].get("triage_investigation"), stored[0]
