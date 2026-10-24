"""Feed Health: the 24-hour status rule, plain-language errors, ordering and the device-authed endpoint.

Run: cd /app/backend && python -m pytest tests/test_feed_health.py -q
"""
from __future__ import annotations

import uuid
from datetime import timedelta

import pytest

from core.db import db, now_utc
from services import feed_health


def test_classify_applies_the_24_hour_rule():
    now = now_utc()
    assert feed_health.classify(None, now) == "stale"  # never synced = no sync in 24 hours
    assert feed_health.classify({"status": "fresh", "last_success_at": now - timedelta(hours=23, minutes=59)}, now) == "healthy"
    assert feed_health.classify({"status": "fresh", "last_success_at": now - timedelta(hours=24, minutes=1)}, now) == "stale"
    # A failed latest attempt is failing even when the previous success is recent.
    assert feed_health.classify({"status": "unavailable", "last_success_at": now - timedelta(hours=1)}, now) == "failing"
    assert feed_health.classify({"status": "unavailable"}, now) == "failing"
    # Naive datetimes from Mongo are read as UTC.
    assert feed_health.classify({"status": "fresh", "last_success_at": (now - timedelta(hours=2)).replace(tzinfo=None)}, now) == "healthy"


def test_error_messages_are_plain_language():
    assert "couldn't find" in feed_health.error_message("OutboundBlocked", "dns_failed")
    assert "not with a usable feed" in feed_health.error_message("ValueError", "feed response rejected")
    assert feed_health.error_message("ReadTimeout", None) == "The source took too long to answer."
    assert feed_health.error_message("ValueError", None).startswith("The source answered")
    assert feed_health.error_message("WeirdError", None) == "The last sync failed (WeirdError)."


@pytest.mark.anyio
async def test_snapshot_orders_failing_first_and_reports_counts_records_and_errors():
    tag = uuid.uuid4().hex[:8]; now = now_utc()
    feeds = {f"fh-{tag}-ok": ("fh-healthy", {"status": "fresh", "last_success_at": now - timedelta(hours=1), "last_checked_at": now - timedelta(hours=1), "item_count": 12}),
             f"fh-{tag}-old": ("fh-stale", {"status": "fresh", "last_success_at": now - timedelta(hours=30), "last_checked_at": now - timedelta(hours=30), "item_count": 4}),
             f"fh-{tag}-bad": ("fh-failing", {"status": "unavailable", "last_checked_at": now - timedelta(minutes=5), "error": "OutboundBlocked", "error_detail": "dns_failed"})}
    try:
        for feed_id, (source_id, state) in feeds.items():
            await db.learning_feeds.insert_one({"feed_id": feed_id, "source_id": source_id, "url": f"https://example.gov/{feed_id}", "content_type": "live_alert", "enabled": True})
            await db.learning_feed_state.insert_one({"feed_id": feed_id, **state})
        report = await feed_health.snapshot()
        mine = [row for row in report["feeds"] if row["feedId"].startswith(f"fh-{tag}")]
        assert [row["status"] for row in mine] == ["failing", "stale", "healthy"]
        bad, old, ok = mine
        assert bad["lastError"]["code"] == "OutboundBlocked" and "couldn't find" in bad["lastError"]["message"] and bad["recordCount"] is None
        assert old["lastError"] is None and old["recordCount"] == 4
        assert ok["recordCount"] == 12 and ok["lastSuccessAt"] is not None
        assert report["staleAfterHours"] == 24
        assert report["summary"]["total"] == sum(report["summary"][k] for k in ("healthy", "stale", "failing"))
    finally:
        await db.learning_feeds.delete_many({"feed_id": {"$in": list(feeds)}})
        await db.learning_feed_state.delete_many({"feed_id": {"$in": list(feeds)}})


def test_endpoint_requires_device_auth_and_returns_report():
    import os
    import requests
    base = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
    # X-Apollo-Raw stops the conftest auth shim from attaching a bearer token.
    assert requests.get(f"{base}/api/feeds/health", headers={"X-Apollo-Raw": "1"}, timeout=30).status_code == 401
    device = requests.post(f"{base}/api/devices/register", json={"platform": "web", "adapter_mode": "mock"},
                           headers={"User-Agent": "apollo-tests"}, timeout=30).json()
    token = device["device_token"]
    res = requests.get(f"{base}/api/feeds/health", headers={"Authorization": f"Bearer {token}", "X-Apollo-Raw": "1"}, timeout=30)
    assert res.status_code == 200
    body = res.json()
    assert set(body) == {"generatedAt", "staleAfterHours", "summary", "feeds"}
    assert all(row["status"] in ("healthy", "stale", "failing") for row in body["feeds"])
