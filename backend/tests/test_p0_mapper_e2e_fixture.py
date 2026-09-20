"""P0 E2E fixture: real frontend mapper -> patrolPayload -> enforceEgress -> live API.

This exercises the frontend egress boundary and backend evidence receipt idempotency together.
"""
from __future__ import annotations

import copy
import json
import os
import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest
import requests


def _base_url() -> str:
    base = os.environ.get("EXPO_BACKEND_URL") or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    if not base:
        env_file = Path(__file__).resolve().parents[2] / "frontend" / ".env"
        if env_file.exists():
            for line in env_file.read_text().splitlines():
                if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                    base = line.split("=", 1)[1].strip()
                    break
                if line.startswith("EXPO_BACKEND_URL="):
                    base = line.split("=", 1)[1].strip()
                    break
    if not base:
        raise RuntimeError("EXPO_PUBLIC_BACKEND_URL (or EXPO_BACKEND_URL) is required")
    return base.rstrip("/")


BASE_URL = _base_url()
API = f"{BASE_URL}/api"


def _register_device() -> tuple[str, str]:
    r = requests.post(
        f"{API}/devices/register",
        json={"platform": "web", "adapter_mode": "mock"},
        headers={"User-Agent": "apollo-tests", "X-Apollo-Raw": "1"},
        timeout=15,
    )
    assert r.status_code == 201, r.text
    body = r.json()
    return body["device_id"], body["device_token"]


def _frontend_payload(device_id: str, event_id: str, evidence_id: str, observed_at: str) -> dict:
    js = r'''
import { toPatrolEnforcementEvidence } from './src/domain/enforcementEvidenceSync.ts';
import { patrolPayload } from './src/domain/patrolPayload.ts';
import { enforceEgress } from './src/domain/privacy.ts';

const deviceId = process.env.DEVICE_ID;
const eventId = process.env.EVENT_ID;
const evidenceId = process.env.EVIDENCE_ID;
const observedAt = process.env.OBSERVED_AT;

const sdkEvidence = {
  evidenceId,
  eventId,
  deviceId,
  platform: 'android',
  osVersion: null,
  sdkVersion: null,
  observedAt,
  mechanism: 'dns_filter',
  direction: 'outbound',
  protocol: 'dns',
  destination: { ip: null, domain: 'evil.example', port: 53 },
  attribution: { appId: null, processName: null, confidence: 'unavailable' },
  matchedRuleId: 'evil.example',
  threatId: null,
  requestedAction: 'block',
  enforcedAction: 'blocked',
  result: 'verified',
  ruleSource: 'local_blocklist',
  confidence: 'high',
  sourceMetadata: {},
  correlationId: null,
};

const event = {
  event_id: eventId,
  device_id: deviceId,
  category: 'connection',
  state: 'biting',
  status: 'blocked',
  headline: 'private marker +61400000000',
  what_happened: 'https://evil.example/reset?token=secret',
  why: ['private marker'],
  what_to_do: 'call +61400000000',
  indicator_host: 'evil.example',
  indicator_digest: 'a'.repeat(64),
  verified_block: true,
  adapter_label: 'native',
  occurred_at: observedAt,
  resolved_at: null,
  trust_allowed: false,
  enforcement_evidence: toPatrolEnforcementEvidence(sdkEvidence),
};

const payload = enforceEgress('patrol_sync', patrolPayload(event, deviceId));
console.log(JSON.stringify(payload));
'''
    proc = subprocess.run(
        ["node", "--input-type=module", "-e", js],
        cwd="/app/frontend",
        env={
            **os.environ,
            "DEVICE_ID": device_id,
            "EVENT_ID": event_id,
            "EVIDENCE_ID": evidence_id,
            "OBSERVED_AT": observed_at,
        },
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr
    return json.loads(proc.stdout.strip())


def test_frontend_mapper_payload_hits_live_patrol_once_and_rejects_changed_reuse():
    device_id, token = _register_device()
    auth = {"Authorization": f"Bearer {token}", "Content-Type": "application/json", "X-Apollo-Raw": "1"}
    observed_at = datetime.now(timezone.utc).isoformat()
    event_id = f"evt_{uuid.uuid4().hex[:10]}"
    evidence_id = f"ev_{uuid.uuid4().hex[:10]}"

    payload = _frontend_payload(device_id, event_id, evidence_id, observed_at)

    r1 = requests.post(f"{API}/patrol/events", headers=auth, json=payload, timeout=20)
    assert r1.status_code == 200, r1.text
    assert r1.json()["event_id"] == event_id
    assert r1.json()["verified_block"] is True

    rg1 = requests.get(f"{API}/patrol/events", headers=auth, params={"device_id": device_id}, timeout=20)
    assert rg1.status_code == 200, rg1.text
    assert sum(1 for row in rg1.json() if row["event_id"] == event_id) == 1

    r2 = requests.post(f"{API}/patrol/events", headers=auth, json=payload, timeout=20)
    assert r2.status_code == 200, r2.text
    rg2 = requests.get(f"{API}/patrol/events", headers=auth, params={"device_id": device_id}, timeout=20)
    assert rg2.status_code == 200, rg2.text
    assert sum(1 for row in rg2.json() if row["event_id"] == event_id) == 1

    changed = copy.deepcopy(payload)
    changed["event_id"] = f"evt_{uuid.uuid4().hex[:10]}"
    changed["enforcement_evidence"]["destination_domain"] = "changed.example"
    changed["enforcement_evidence"]["matched_rule_id"] = "changed.example"
    changed["indicator_host"] = "changed.example"
    r3 = requests.post(f"{API}/patrol/events", headers=auth, json=changed, timeout=20)
    assert r3.status_code == 409, r3.text
