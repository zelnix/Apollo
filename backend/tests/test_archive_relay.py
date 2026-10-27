"""Internet Archive relay for feeds whose source blocks cloud servers (cyber.gov.au).

Run: cd /app/backend && python -m pytest tests/test_archive_relay.py -q
"""
from __future__ import annotations

import json
import uuid
from datetime import timedelta
from pathlib import Path

import httpx
import pytest

from core.db import db, now_utc
from services import archive_relay, learning_feeds, scam_analysis

FEED = "https://www.cyber.gov.au/rss/alerts"
RSS = b"""<?xml version="1.0" encoding="utf-8"?><rss version="2.0"><channel><title>ASD's ACSC - Alerts RSS</title>
<item><title>Critical vulnerabilities in Fortinet products</title><link>https://www.cyber.gov.au/alert/critical-vulnerabilities-in-fortinet-products</link>
<description>Fortinet have announced critical vulnerabilities.</description><pubDate>Fri, 23 Oct 2026 16:11:47 +1100</pubDate></item>
<item><title>Duplicate node link</title><link>https://www.cyber.gov.au/node/1215</link><description>Same alert.</description></item>
<item><title>Off-site link</title><link>https://evil.example/alert/x</link><description>Not ACSC.</description></item>
</channel></rss>"""


def _ts(dt) -> str:
    return dt.strftime("%Y%m%d%H%M%S")


def _archive_response(url: str, status: int = 200) -> httpx.Response:
    return httpx.Response(status, headers={"content-type": "application/rss+xml; charset=utf-8"}, content=RSS, request=httpx.Request("GET", url))


@pytest.fixture
def archive(monkeypatch):
    """Fake Archive: configurable save result, latest copy and the URL the raw read ends on."""
    state = {"save": None, "latest": None, "served": None, "status": 200, "reads": []}

    async def save_now(url): return state["save"]
    async def latest_copy(url): return state["latest"]
    async def get(url, max_hops=3, **_options):
        state["reads"].append(url)
        return _archive_response(state["served"] or url, state["status"])

    monkeypatch.setattr(archive_relay, "_save_now", save_now)
    monkeypatch.setattr(archive_relay, "_latest_copy", latest_copy)
    monkeypatch.setattr(archive_relay, "public_get", get)
    return state


def test_capture_of_only_accepts_the_exact_feed_address():
    assert archive_relay.capture_of(f"https://web.archive.org/web/20261024034649/{FEED}", FEED).isoformat() == "2026-10-24T03:46:49+00:00"
    assert archive_relay.capture_of(f"https://web.archive.org/web/20261024034649id_/{FEED}", FEED) is not None
    assert archive_relay.capture_of("https://web.archive.org/web/20261024034649/http://www.cyber.gov.au/rss/alerts/", FEED) is not None
    assert archive_relay.capture_of("https://web.archive.org/web/20261024034649/https://www.cyber.gov.au/rss/advisories", FEED) is None
    assert archive_relay.capture_of("https://evil.example/web/20261024034649/" + FEED, FEED) is None
    assert archive_relay.capture_of(None, FEED) is None


@pytest.mark.anyio
async def test_fresh_save_is_read_as_original_bytes(archive):
    made = now_utc() - timedelta(seconds=30)
    archive["save"] = f"https://web.archive.org/web/{_ts(made)}/{FEED}"
    response, copy_at = await archive_relay.fetch(FEED)
    assert archive["reads"] == [f"https://web.archive.org/web/{_ts(made)}id_/{FEED}"]  # id_ = no Archive markup
    assert response.content == RSS and abs((copy_at - made).total_seconds()) < 1


@pytest.mark.anyio
async def test_refused_save_falls_back_to_a_recent_existing_copy(archive):
    archive["latest"] = f"https://web.archive.org/web/{_ts(now_utc() - timedelta(hours=3))}/{FEED}"
    _response, copy_at = await archive_relay.fetch(FEED)
    assert now_utc() - copy_at < timedelta(hours=4)


@pytest.mark.anyio
async def test_copies_over_a_day_old_or_missing_or_of_another_address_are_refused(archive):
    archive["latest"] = f"https://web.archive.org/web/{_ts(now_utc() - timedelta(hours=30))}/{FEED}"
    with pytest.raises(archive_relay.ArchiveRelayError, match="archive_copy_too_old"):
        await archive_relay.fetch(FEED)
    archive["latest"] = None
    with pytest.raises(archive_relay.ArchiveRelayError, match="archive_unavailable"):
        await archive_relay.fetch(FEED)
    archive["save"] = f"https://web.archive.org/web/{_ts(now_utc())}/{FEED}"
    archive["served"] = f"https://web.archive.org/web/{_ts(now_utc())}id_/https://www.cyber.gov.au/rss/advisories"
    with pytest.raises(archive_relay.ArchiveRelayError, match="archive_wrong_capture"):
        await archive_relay.fetch(FEED)


@pytest.mark.anyio
async def test_relayed_refresh_stores_only_official_links_and_records_the_copy_time(monkeypatch):
    tag = uuid.uuid4().hex[:8]; feed_id = f"relay-{tag}"; source_id = f"relay-src-{tag}"
    made = now_utc() - timedelta(minutes=5)

    async def fake_fetch(url):
        assert url == FEED
        return _archive_response(f"https://web.archive.org/web/{_ts(made)}id_/{FEED}"), made
    monkeypatch.setattr(archive_relay, "fetch", fake_fetch)
    source = {"source_id": source_id, "allowed_hosts": ["www.cyber.gov.au", "cyber.gov.au"]}
    feed = {"feed_id": feed_id, "source_id": source_id, "url": FEED, "format": "rss", "relay": "internet_archive", "content_type": "live_alert",
            "language": "en-AU", "allowed_path_prefixes": ["/alert/"], "trust_status": "recognised_government", "review_queue_policy": "always_review"}
    try:
        result = await learning_feeds.refresh(feed, source)
        assert result["status"] == "success" and result["fetched"] == 3 and result["accepted"] == 1 and result["rejected"] == 2
        state = await db.learning_feed_state.find_one({"feed_id": feed_id})
        assert state["status"] == "fresh" and abs((state["relay_copy_at"].replace(tzinfo=made.tzinfo) - made).total_seconds()) < 1
        items = await db.learning_feed_items.find({"feed_id": feed_id}).to_list(10)
        assert [item["url"] for item in items] == ["https://www.cyber.gov.au/alert/critical-vulnerabilities-in-fortinet-products"]
    finally:
        for collection in ("learning_feed_state", "learning_feed_items", "learning_candidates", "learning_feed_runs"):
            await db[collection].delete_many({"feed_id": feed_id})


@pytest.mark.anyio
async def test_relayed_items_are_analysed_without_trying_the_blocked_article_page(monkeypatch):
    async def must_not_fetch(url): raise AssertionError("blocked source must not be fetched")
    monkeypatch.setattr(scam_analysis, "_fetch_article_text", must_not_fetch)
    analysis = await scam_analysis.analyze_item({"title": "Critical vulnerabilities in Fortinet products", "summary": "Patch now.",
                                                 "url": FEED, "_article_unreachable": True})
    assert analysis["tier"] == "general_education" and analysis["method"] == "deterministic_source_rules"


def test_catalogue_reads_acsc_rss_through_the_archive():
    catalogue = json.loads((Path(__file__).resolve().parents[1] / "content" / "learning_catalogue_au.json").read_text())
    feed = next(row for row in catalogue["feeds"] if row["feedId"] == "acsc-alerts")
    assert feed["url"] == FEED and feed["format"] == "rss" and feed["relay"] == "internet_archive"
    assert feed["allowedPathPrefixes"] == ["/alert/"] and feed["refreshIntervalMinutes"] >= 240
