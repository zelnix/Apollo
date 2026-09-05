"""Apollo V1 iteration-3 backend tests: Family Sharing (guardians, pairing, shared events)."""
import os
import time
import uuid
from datetime import datetime, timezone

import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

BASE_URL = "https://threat-patrol-1.preview.emergentagent.com"
API = f"{BASE_URL}/api"
MONGO_URL = os.environ.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME")

DEVICE_A = f"dev-A-{uuid.uuid4().hex[:8]}"
DEVICE_B = f"dev-B-{uuid.uuid4().hex[:8]}"


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    yield sess
    # cleanup
    try:
        import asyncio
        async def _clean():
            c = AsyncIOMotorClient(MONGO_URL)
            db = c[DB_NAME]
            await db.guardians.delete_many({"device_id": {"$in": [DEVICE_A, DEVICE_B]}})
            await db.pair_codes.delete_many({"protected_device_id": {"$in": [DEVICE_A, DEVICE_B]}})
            await db.family_links.delete_many({"protected_device_id": {"$in": [DEVICE_A, DEVICE_B]}})
            await db.shared_events.delete_many({"guardian_device_id": {"$in": [DEVICE_A, DEVICE_B]}})
            await db.patrol_events.delete_many({"device_id": {"$in": [DEVICE_A, DEVICE_B]}})
            c.close()
        asyncio.run(_clean())
    except Exception as e:
        print(f"cleanup err: {e}")


# --- Guardians ---
class TestGuardians:
    guardian_ids = []

    def test_add_guardian(self, s):
        r = s.post(f"{API}/family/guardians", json={
            "device_id": DEVICE_A, "email": "delivered@resend.dev", "name": "Test", "owner_name": "Alex"
        })
        assert r.status_code == 200, r.text
        body = r.json()
        assert "guardian_id" in body
        assert body["confirmed"] is False
        TestGuardians.guardian_ids.append(body["guardian_id"])

    def test_list_guardians(self, s):
        r = s.get(f"{API}/family/guardians", params={"device_id": DEVICE_A})
        assert r.status_code == 200
        docs = r.json()
        assert any(g["guardian_id"] == TestGuardians.guardian_ids[0] for g in docs)
        assert docs[0]["email"] == "delivered@resend.dev"

    def test_add_second_and_third(self, s):
        for i in range(2):
            r = s.post(f"{API}/family/guardians", json={
                "device_id": DEVICE_A, "email": "delivered@resend.dev", "name": f"T{i}", "owner_name": "Alex"
            })
            assert r.status_code == 200, r.text
            TestGuardians.guardian_ids.append(r.json()["guardian_id"])

    def test_fourth_guardian_400(self, s):
        r = s.post(f"{API}/family/guardians", json={
            "device_id": DEVICE_A, "email": "delivered@resend.dev", "name": "T4", "owner_name": "Alex"
        })
        assert r.status_code == 400, r.text

    def test_invalid_email_422(self, s):
        # remove one first to make room, but 422 should occur regardless due to validation
        r = s.post(f"{API}/family/guardians", json={
            "device_id": DEVICE_A + "-nope", "email": "not-an-email", "name": "X", "owner_name": "Alex"
        })
        assert r.status_code == 422, r.text

    def test_delete_guardian(self, s):
        gid = TestGuardians.guardian_ids[0]
        r = s.delete(f"{API}/family/guardians/{gid}", params={"device_id": DEVICE_A})
        assert r.status_code == 200
        assert r.json()["removed"] is True
        # verify removed
        lst = s.get(f"{API}/family/guardians", params={"device_id": DEVICE_A}).json()
        assert not any(g["guardian_id"] == gid for g in lst)


# --- Confirm token (fetch from Mongo) ---
class TestConfirmToken:
    def test_confirm_valid_token(self, s):
        # create a fresh guardian on a fresh device to fetch token
        dev = f"dev-conf-{uuid.uuid4().hex[:8]}"
        r = s.post(f"{API}/family/guardians", json={
            "device_id": dev, "email": "delivered@resend.dev", "name": "Conf", "owner_name": "Alex"
        })
        assert r.status_code == 200
        gid = r.json()["guardian_id"]
        # read token directly from Mongo
        import asyncio
        async def _get_token():
            c = AsyncIOMotorClient(MONGO_URL)
            db = c[DB_NAME]
            d = await db.guardians.find_one({"guardian_id": gid})
            c.close()
            return d["confirm_token"] if d else None
        token = asyncio.run(_get_token())
        assert token, "confirm_token missing in DB"
        r2 = s.get(f"{API}/family/confirm/{token}")
        assert r2.status_code == 200
        assert "now receiving" in r2.text
        # cleanup
        s.delete(f"{API}/family/guardians/{gid}", params={"device_id": dev})

    def test_confirm_invalid_token(self, s):
        r = s.get(f"{API}/family/confirm/thisisnotarealtoken1234")
        assert r.status_code == 200
        assert "no longer valid" in r.text


# --- Pairing / linking ---
class TestPairing:
    code = None

    def test_create_pair(self, s):
        r = s.post(f"{API}/family/pair", json={"device_id": DEVICE_A, "owner_name": "Alex"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert "code" in body
        assert len(body["code"]) == 6
        TestPairing.code = body["code"]

    def test_link_device(self, s):
        r = s.post(f"{API}/family/link", json={"device_id": DEVICE_B, "code": TestPairing.code})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["linked"] is True
        assert body["owner_name"] == "Alex"

    def test_reuse_code_404(self, s):
        r = s.post(f"{API}/family/link", json={"device_id": DEVICE_B, "code": TestPairing.code})
        assert r.status_code == 404, r.text

    def test_link_own_device_400(self, s):
        r = s.post(f"{API}/family/pair", json={"device_id": DEVICE_A, "owner_name": "Alex"})
        c2 = r.json()["code"]
        r2 = s.post(f"{API}/family/link", json={"device_id": DEVICE_A, "code": c2})
        assert r2.status_code == 400, r2.text

    def test_links_i_watch(self, s):
        r = s.get(f"{API}/family/links", params={"device_id": DEVICE_B})
        assert r.status_code == 200
        body = r.json()
        assert any(l.get("owner_name") == "Alex" for l in body["i_watch"])

    def test_links_watching_me(self, s):
        r = s.get(f"{API}/family/links", params={"device_id": DEVICE_A})
        assert r.status_code == 200
        assert r.json()["watching_me"] >= 1


# --- Shared events (patrol fanout) ---
class TestSharedEvents:
    def test_barking_event_shared(self, s):
        event_id = f"evt-{uuid.uuid4().hex[:12]}"
        payload = {
            "event_id": event_id, "device_id": DEVICE_A, "category": "known_threat",
            "state": "barking", "status": "active",
            "headline": "Threat detected", "what_happened": "A link was flagged.",
            "why": ["blocklisted"], "what_to_do": "Ignore.",
            "indicator_host": "phish.example", "adapter_label": "MOCK",
            "occurred_at": datetime.now(timezone.utc).isoformat(),
        }
        r = s.post(f"{API}/patrol/events", json=payload)
        assert r.status_code == 200, r.text
        # Wait for async fanout
        time.sleep(2.5)
        r2 = s.get(f"{API}/family/shared-events", params={"device_id": DEVICE_B})
        assert r2.status_code == 200
        events = r2.json()
        match = [e for e in events if e["event_id"] == event_id]
        assert len(match) == 1, f"expected shared event, got {events}"
        assert match[0]["headline"] == "Threat detected"
        assert match[0]["from_label"] == "Alex"

    def test_resting_event_not_shared(self, s):
        event_id = f"evt-{uuid.uuid4().hex[:12]}"
        payload = {
            "event_id": event_id, "device_id": DEVICE_A, "category": "known_threat",
            "state": "resting", "status": "resolved",
            "headline": "All clear", "what_happened": "Nothing here.",
            "why": ["ok"], "what_to_do": "Nothing.",
            "indicator_host": "clean.example", "adapter_label": "MOCK",
            "occurred_at": datetime.now(timezone.utc).isoformat(),
        }
        r = s.post(f"{API}/patrol/events", json=payload)
        assert r.status_code == 200
        time.sleep(2.0)
        r2 = s.get(f"{API}/family/shared-events", params={"device_id": DEVICE_B})
        events = r2.json()
        assert not any(e["event_id"] == event_id for e in events), "resting event should NOT be shared"
