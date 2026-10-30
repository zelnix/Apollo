"""Threat Domain List delivery: a list with zero Threat Domain Entries is valid — published, signed and served like
any other, never padded with placeholder domains — and the diagnostic reports it as a PASS with its entry count.
Runs in-process against a fake collection layer: no network, no shared database state."""
import asyncio
from datetime import datetime, timedelta, timezone

import pytest

from routers import guarddog
from services.rule_signing import is_signing_enabled, sign_bundle, verify_bundle_signature


class _Cursor:
    def __init__(self, docs):
        self._docs = docs

    def sort(self, key, direction):
        self._docs = sorted(self._docs, key=lambda d: d[key], reverse=direction < 0)
        return self

    def __aiter__(self):
        self._it = iter(self._docs)
        return self

    async def __anext__(self):
        try:
            return next(self._it)
        except StopIteration:
            raise StopAsyncIteration


class _Collection:
    def __init__(self, docs=None):
        self.docs = list(docs or [])

    def find(self, query, projection=None):
        now = datetime.now(timezone.utc)
        if "status" in query:  # threat_indicators: active, unexpired, hostname scope
            return _Cursor([d for d in self.docs if d["status"] == "active" and d["scope"] == "hostname" and d["evidence_expiry_deadline"] > now])
        return _Cursor(list(self.docs))

    async def find_one(self, query, projection=None):
        return next((d for d in self.docs if all(d.get(k) == v for k, v in query.items())), None)

    async def update_one(self, query, update, upsert=False):
        doc = await self.find_one(query)
        if doc is None:
            self.docs.append({**query, **update["$set"]})
        else:
            doc.update(update["$set"])

    async def insert_one(self, doc):
        self.docs.append(doc)


class _Db:
    def __init__(self, indicators=None):
        self.threat_indicators = _Collection(indicators)
        self.rule_bundle_state = _Collection()
        self.rule_bundle_publications = _Collection()


def _indicator(i, host):
    return {"indicator_id": f"x{i}", "hostname": host, "status": "active", "scope": "hostname", "source": "test-feed",
            "evidence_expiry_deadline": datetime.now(timezone.utc) + timedelta(days=30)}


def _run(coro):
    return asyncio.run(coro)


@pytest.fixture
def fake_db(monkeypatch):
    def install(indicators=None):
        db = _Db(indicators)
        monkeypatch.setattr(guarddog, "db", db)
        return db
    return install


def test_zero_entry_list_is_published_with_no_placeholder_entries(fake_db):
    db = fake_db([])
    bundle = _run(guarddog.get_rules())
    assert bundle["payload"]["rules"] == []
    assert bundle["schemaVersion"] == "2.0" and bundle["rulesetId"] == "apollo-rules-v1" and bundle["bundleVersion"] >= 1
    assert db.rule_bundle_state.docs[0]["rule_count"] == 0
    assert db.rule_bundle_publications.docs[0]["indicator_ids"] == []


@pytest.mark.skipif(not is_signing_enabled(), reason="RULE_SIGNING_PRIVATE_KEY not configured")
def test_zero_entry_list_is_signed_and_verifies(fake_db):
    fake_db([])
    served = _run(guarddog.get_rules())
    signature = served.pop("signature")
    assert verify_bundle_signature(served, signature)
    assert sign_bundle(served) == signature


def test_diagnostic_passes_a_zero_entry_list_and_shows_the_count(fake_db):
    fake_db([])
    report = _run(guarddog.rules_diagnostic())
    checks = {c["check"]: c for c in report["checks"]}
    assert checks["bundle_generation"]["passed"] is True
    assert "0 Threat Domain Entries" in checks["bundle_generation"]["detail"]
    entries = checks["threat_domain_entries"]
    assert entries["passed"] is True and entries["entry_count"] == 0
    assert "valid list" in entries["detail"]
    assert "empty rules" not in str(report).lower() and "EMPTY_RULES" not in str(report)


def test_diagnostic_counts_a_populated_list(fake_db):
    fake_db([_indicator(1, "bad-one.example"), _indicator(2, "bad-two.example")])
    report = _run(guarddog.rules_diagnostic())
    entries = next(c for c in report["checks"] if c["check"] == "threat_domain_entries")
    assert entries["passed"] is True and entries["entry_count"] == 2
    assert entries["detail"] == "2 Threat Domain Entries, all in the right format."


def test_diagnostic_fails_a_malformed_entry(monkeypatch):
    async def bundle():
        return {"schemaVersion": "2.0", "rulesetId": "apollo-rules-v1", "bundleVersion": 9, "issuedAt": "2026-06-01T09:00:00Z",
                "expiresAt": "2028-05-31T09:00:00Z", "payload": {"rules": [
                    {"ruleId": "ti-1", "host": "bad.example", "action": "block", "matchType": "exact"},
                    {"ruleId": "ti-2", "host": "", "action": "block", "matchType": "exact"},
                    {"ruleId": "ti-3", "host": "bad3.example", "action": "quarantine", "matchType": "exact"}]}}
    monkeypatch.setattr(guarddog, "_get_or_publish_bundle", bundle)
    report = _run(guarddog.rules_diagnostic())
    entries = next(c for c in report["checks"] if c["check"] == "threat_domain_entries")
    assert entries["passed"] is False and entries["entry_count"] == 3
    assert entries["detail"].startswith("2 of 3 Threat Domain Entries aren't in the right format")
    assert report["diagnostic"] == "issues_found"


def test_going_from_none_to_some_and_back_publishes_new_versions(fake_db):
    db = fake_db([])
    v_empty = _run(guarddog.get_rules())["bundleVersion"]
    db.threat_indicators.docs.append(_indicator(1, "bad-one.example"))
    populated = _run(guarddog.get_rules())
    assert populated["bundleVersion"] == v_empty + 1 and len(populated["payload"]["rules"]) == 1
    db.threat_indicators.docs.clear()
    cleared = _run(guarddog.get_rules())
    assert cleared["bundleVersion"] == v_empty + 2 and cleared["payload"]["rules"] == []
    # Unchanged content is the same immutable version (no VERSION_CONFLICT on devices).
    assert _run(guarddog.get_rules())["bundleVersion"] == cleared["bundleVersion"]
