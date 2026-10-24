"""Protection explanations: Apollo Protections are canonical; Device Protections are taught once and reused.

Owner directive "Device Protections": backend-first lookup, Gemini only on a genuine cache miss, stored at the
broadest accurate scope, concurrent identical misses make one call, and Gemini never decides the person's state.
"""
import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from pymongo.errors import DuplicateKeyError

from services import protection_explanations as pe
from services.protection_knowledge import APOLLO_PROTECTIONS, DEVICE_SEEDS

TAUGHT = json.dumps({"what": "Samsung's caller ID and spam service in the Phone app.", "why": "It labels likely scam calls before you answer.",
                     "protects_against": "Known scam and spam calls.", "recommended": "Keep caller ID and spam protection on."})


class FakeCollection:
    """Just enough of Motor's collection for the explanation cache, including the unique _id."""

    def __init__(self):
        self.docs: dict[str, dict] = {}

    async def find_one(self, query, *_a, **_k):
        doc = self.docs.get(query["_id"])
        return dict(doc) if doc and all(doc.get(k) == v for k, v in query.items() if k != "_id") else None

    async def insert_one(self, doc):
        if doc["_id"] in self.docs:
            raise DuplicateKeyError("dup")
        self.docs[doc["_id"]] = dict(doc)

    async def update_one(self, query, update, **_k):
        doc = self.docs.get(query["_id"])
        if not doc or ("status" in query and doc.get("status") != query["status"]) or ("lease_until" in query and not doc["lease_until"] < query["lease_until"]["$lt"]):
            return SimpleNamespace(modified_count=0)
        doc.update(update.get("$set", {}))
        for key in update.get("$unset", {}):
            doc.pop(key, None)
        return SimpleNamespace(modified_count=1)

    async def delete_one(self, query):
        self.docs.pop(query["_id"], None)

    async def count_documents(self, query):
        return sum(1 for d in self.docs.values() if d.get("requested_by") == query["requested_by"])


@pytest.fixture
def store(monkeypatch):
    collection = FakeCollection()
    monkeypatch.setattr(pe, "db", SimpleNamespace(protection_explanations=collection))
    monkeypatch.setattr(pe, "_locks", {})
    return collection


@pytest.fixture
def gemini(monkeypatch):
    calls = AsyncMock(return_value=SimpleNamespace(text=TAUGHT))
    monkeypatch.setattr(pe.provider, "generate", calls)
    return calls


def request(**over):
    base = {"protectionId": "call:com.samsung.android.smartcallprovider", "title": "Samsung Smart Call", "platform": "android",
            "osVersion": "15", "oem": "samsung", "model": "SM-S921B", "scope": "oem"}
    return pe.DeviceExplanationRequest.model_validate({**base, **over})


def test_every_apollo_protection_has_one_canonical_explanation():
    assert set(APOLLO_PROTECTIONS) == {"site", "link", "text", "call", "network", "account", "email", "file", "app", "device"}
    for gate in APOLLO_PROTECTIONS:
        found = pe.apollo_explanation(gate)
        assert found["source"] == "apollo_reviewed" and found["version"] >= 1
        for field in ("what", "why", "protectsAgainst", "recommended"):
            assert len(found["explanation"][field]) > 20, (gate, field)
    assert pe.apollo_explanation("nope") is None


@pytest.mark.asyncio
async def test_a_reviewed_seed_is_served_without_gemini_or_the_cache(store, gemini):
    result = await pe.device_explanation("owner-a", request(protectionId="private_dns", title="Private DNS", scope="os"))
    assert result["source"] == "apollo_reviewed" and "lookups" in result["explanation"]["what"]
    gemini.assert_not_awaited()
    assert store.docs == {}


def test_the_pre_written_explanation_alone_is_available_without_a_device_description():
    found = pe.reviewed_device_explanation("screen_lock")
    assert found["source"] == "apollo_reviewed" and len(found["explanation"]["why"]) > 20
    # Anything not pre-written is never invented here — only the device route may teach it.
    assert pe.reviewed_device_explanation("call:com.hiya.star") is None


def test_common_protections_are_pre_written():
    for pid in ("screen_lock", "app_scanner", "private_dns", "os_updates", "find_my_device", "developer_options", "stolen_device_protection",
                "theft_protection", "samsung_auto_blocker", "firewall", "disk_encryption"):
        assert pid in DEVICE_SEEDS, pid


@pytest.mark.asyncio
async def test_a_genuine_miss_calls_gemini_once_then_everyone_at_that_scope_reuses_it(store, gemini):
    first = await pe.device_explanation("owner-a", request())
    assert first["source"] == "higgins_new" and first["scopeLabel"] == "Samsung devices on Android"
    # Another Samsung phone, a different model and OS version: same OEM-scoped explanation, no new call.
    again = await pe.device_explanation("owner-b", request(model="SM-A556B", osVersion="14"))
    assert again["source"] == "higgins_cached" and again["explanation"] == first["explanation"]
    gemini.assert_awaited_once()
    assert list(store.docs) == ["call:com.samsung.android.smartcallprovider|android/samsung"]


@pytest.mark.asyncio
async def test_concurrent_identical_misses_make_one_call(store, monkeypatch):
    async def slow(*_a, **_k):
        await asyncio.sleep(0.05)
        return SimpleNamespace(text=TAUGHT)
    calls = AsyncMock(side_effect=slow)
    monkeypatch.setattr(pe.provider, "generate", calls)
    results = await asyncio.gather(*[pe.device_explanation(f"owner-{i}", request()) for i in range(5)])
    assert calls.await_count == 1
    assert {r["explanation"]["what"] for r in results} == {"Samsung's caller ID and spam service in the Phone app."}


def test_scope_is_the_broadest_accurate_one_and_missing_facts_widen_it():
    assert pe.scope_key(request(scope="os"))[0].endswith("|android")
    assert pe.scope_key(request(scope="os_version"))[0].endswith("|android/v15")
    assert pe.scope_key(request(scope="oem_os_version"))[0].endswith("|android/samsung/v15")
    assert pe.scope_key(request(scope="model"))[0].endswith("|android/samsung/sm-s921b")
    # No maker known → never a maker-specific copy; no version → never a version-specific one.
    assert pe.scope_key(request(scope="oem", oem=None))[1] == "os"
    assert pe.scope_key(request(scope="oem_os_version", osVersion=None))[1] == "oem"


@pytest.mark.asyncio
async def test_a_failed_call_leaves_no_half_written_entry(store, monkeypatch):
    monkeypatch.setattr(pe.provider, "generate", AsyncMock(side_effect=pe.provider.ProviderFailure("provider_unavailable", retryable=True)))
    with pytest.raises(pe.provider.ProviderFailure):
        await pe.device_explanation("owner-a", request())
    assert store.docs == {}


@pytest.mark.asyncio
async def test_gemini_is_never_told_the_persons_state(store, gemini):
    await pe.device_explanation("owner-a", request())
    sent = json.loads(gemini.await_args.args[1])
    assert set(sent) == {"protection", "platform", "applies_to"}
    assert "never say whether it is on, off" in gemini.await_args.args[0]


@pytest.mark.asyncio
async def test_one_device_cannot_run_up_unlimited_misses(store, gemini, monkeypatch):
    monkeypatch.setattr(pe, "DAILY_NEW_PER_DEVICE", 1)
    await pe.device_explanation("owner-a", request())
    limited = await pe.device_explanation("owner-a", request(protectionId="call:com.hiya.star", title="Hiya"))
    assert limited["status"] == "limited"
    gemini.assert_awaited_once()


@pytest.mark.asyncio
async def test_a_preview_simulated_explanation_is_shown_but_never_stored(store, monkeypatch):
    simulated = AsyncMock(return_value=SimpleNamespace(text=TAUGHT, simulated=True))
    monkeypatch.setattr(pe.provider, "generate", simulated)
    result = await pe.device_explanation("owner-a", request())
    assert result["source"] == "preview_simulator"
    assert result["explanation"]["what"].startswith("Samsung's caller ID")
    simulated.assert_awaited_once()
    assert store.docs == {}, "a stand-in answer must never become Higgins' cached explanation"
