"""Real-Mongo regressions for historical truth and evidence binding concurrency."""
from __future__ import annotations

import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import requests
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv(Path(__file__).resolve().parents[1] / '.env')
load_dotenv(Path(__file__).resolve().parents[2] / 'frontend' / '.env')
BASE = os.environ['EXPO_PUBLIC_BACKEND_URL'].rstrip('/')
API = f'{BASE}/api'
RAW = {'User-Agent': 'apollo-tests', 'X-Apollo-Raw': '1', 'Content-Type': 'application/json'}
mongo = MongoClient(os.environ['MONGO_URL'])[os.environ['DB_NAME']]


def register():
    response = requests.post(f'{API}/devices/register', json={'platform': 'web', 'adapter_mode': 'mock'}, headers=RAW, timeout=15)
    assert response.status_code == 201, response.text
    data = response.json()
    return data['device_id'], {**RAW, 'Authorization': f"Bearer {data['device_token']}"}


def evidence(evidence_id: str, at: str, event_id: str | None = None):
    return {'evidence_id': evidence_id, 'event_id': event_id, 'device_id': None, 'platform': 'android', 'os_version': None,
            'sdk_version': None, 'observed_at': at, 'mechanism': 'dns_filter', 'direction': 'outbound', 'protocol': 'dns',
            'destination_ip': None, 'destination_domain': 'evil.example', 'destination_port': 53, 'app_id': None,
            'process_name': None, 'attribution_confidence': 'unavailable', 'matched_rule_id': 'evil.example', 'threat_id': None,
            'requested_action': 'block', 'enforced_action': 'blocked', 'result': 'verified', 'rule_source': 'local_blocklist',
            'confidence': 'high', 'correlation_id': None}


def event(device_id: str, event_id: str, evidence_body: dict, at: str):
    return {'event_id': event_id, 'device_id': device_id, 'category': 'connection', 'state': 'biting', 'status': 'blocked',
            'headline': 'test', 'what_happened': 'test', 'why': ['test'], 'what_to_do': 'test', 'indicator_host': 'evil.example',
            'indicator_digest': None, 'verified_block': True, 'adapter_label': 'test', 'occurred_at': at, 'resolved_at': None,
            'enforcement_evidence': evidence_body}


def post(auth, body):
    return requests.post(f'{API}/patrol/events', headers=auth, json=body, timeout=20)


def test_historical_call_biting_is_revalidated_and_persistently_downgraded():
    device_id, auth = register(); event_id = f'evt_{uuid.uuid4().hex[:12]}'; now = datetime.now(timezone.utc)
    call_evidence = evidence(f'ev_{uuid.uuid4().hex[:12]}', now.isoformat(), event_id)
    call_evidence.update(mechanism='call_screening', protocol='unknown', direction='inbound', destination_domain='+61400000000', destination_port=None)
    doc = event(device_id, event_id, call_evidence, now.isoformat())
    doc.update(category='call', created_at=now, updated_at=now, occurred_at=now)
    doc['enforcement_evidence']['observed_at'] = now
    mongo.patrol_events.insert_one(doc)
    response = requests.get(f'{API}/patrol/events', params={'device_id': device_id}, headers=auth, timeout=20)
    row = next(item for item in response.json() if item['event_id'] == event_id)
    assert (row['state'], row['verified_block'], row['enforcement_evidence']) == ('barking', False, None)
    stored = mongo.patrol_events.find_one({'device_id': device_id, 'event_id': event_id})
    assert stored['state'] == 'barking' and stored['verified_block'] is False and 'enforcement_evidence' not in stored


def test_identical_evidence_replay_returns_current_resolved_record_without_overwrite():
    device_id, auth = register(); event_id = f'evt_{uuid.uuid4().hex[:12]}'; at = datetime.now(timezone.utc).isoformat()
    body = event(device_id, event_id, evidence(f'ev_{uuid.uuid4().hex[:12]}', at), at)
    assert post(auth, body).status_code == 200
    resolved_at = datetime.now(timezone.utc).isoformat()
    patch = requests.patch(f'{API}/patrol/events/{event_id}', params={'device_id': device_id}, headers=auth,
                           json={'status': 'resolved', 'resolved_at': resolved_at}, timeout=20)
    assert patch.status_code == 200, patch.text
    replay = post(auth, body)
    assert replay.status_code == 200, replay.text
    assert replay.json()['status'] == 'resolved' and replay.json()['resolved_at'] is not None
    stored = mongo.patrol_events.find_one({'device_id': device_id, 'event_id': event_id})
    assert stored['status'] == 'resolved' and stored['resolved_at'] is not None


def test_replacement_and_cross_event_reuse_conflict_with_concurrent_unique_bindings():
    device_id, auth = register(); at = datetime.now(timezone.utc).isoformat()
    event_id = f'evt_{uuid.uuid4().hex[:12]}'; evidence_id = f'ev_{uuid.uuid4().hex[:12]}'
    original = event(device_id, event_id, evidence(evidence_id, at), at)
    assert post(auth, original).status_code == 200
    replacement = event(device_id, event_id, evidence(f'ev_{uuid.uuid4().hex[:12]}', at), at)
    reused = event(device_id, f'evt_{uuid.uuid4().hex[:12]}', evidence(evidence_id, at), at)
    assert post(auth, replacement).status_code == 409
    assert post(auth, reused).status_code == 409

    same_event = f'evt_{uuid.uuid4().hex[:12]}'
    racers = [event(device_id, same_event, evidence(f'ev_{uuid.uuid4().hex[:12]}', at), at) for _ in range(2)]
    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = sorted(pool.map(lambda body: post(auth, body).status_code, racers))
    assert statuses == [200, 409]
    assert mongo.evidence_receipts.count_documents({'device_id': device_id, 'event_id': same_event}) == 1

    shared_evidence = f'ev_{uuid.uuid4().hex[:12]}'
    cross = [event(device_id, f'evt_{uuid.uuid4().hex[:12]}', evidence(shared_evidence, at), at) for _ in range(2)]
    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = sorted(pool.map(lambda body: post(auth, body).status_code, cross))
    assert statuses == [200, 409]
    assert mongo.evidence_receipts.count_documents({'device_id': device_id, 'evidence_id': shared_evidence}) == 1