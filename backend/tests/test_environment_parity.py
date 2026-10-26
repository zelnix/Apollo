"""Preview ≠ production fixes: same Learn library from code, RSS dates/summaries, Archive fallback, parity fingerprint.

Run: cd /app/backend && python -m pytest tests/test_environment_parity.py -q
"""
from __future__ import annotations

import json
import uuid
from datetime import timedelta
from pathlib import Path

import httpx
import pytest

from core.db import db, now_utc
from services import archive_relay, learning, learning_feeds, parity
from services.outbound import OutboundBlocked

CONTENT = Path(__file__).resolve().parents[1] / "content"


def test_rss_items_keep_their_summary_and_date():
    raw = b"""<rss version="2.0"><channel><item><title>T</title><link>https://www.cyber.gov.au/alert/a</link>
    <description>What happened.</description><pubDate>Fri, 23 Oct 2026 16:11:47 +1100</pubDate></item></channel></rss>"""
    item = learning_feeds._xml_items(raw)[0]
    assert item["summary"] == "What happened."
    assert item["publishedAt"].isoformat() == "2026-10-23T05:11:47+00:00"
    atom = b"""<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>A</title><link href="https://x.gov/a"/><id>x</id>
    <summary>Sum</summary><updated>2026-10-01T00:00:00Z</updated></entry></feed>"""
    entry = learning_feeds._xml_items(atom)[0]
    assert entry["url"] == "https://x.gov/a" and entry["summary"] == "Sum" and entry["publishedAt"] is not None
    fbi = b"""<rss><channel><item><title>F</title><description>d</description>
    <guid>https://www.fbi.gov/news/press-releases/f</guid></item></channel></rss>"""
    assert learning_feeds._xml_items(fbi)[0]["url"] == "https://www.fbi.gov/news/press-releases/f"  # URL only in <guid>


def test_a_link_the_feed_wraps_in_page_code_reads_as_the_articles_own_address():
    # The FTC's feed puts a rendered <a href> in <link>: percent-encoded after the site address, or escaped.
    article = "https://consumer.ftc.gov/consumer-alerts/2026/09/what-know-ahead-open-enrollment-avoid-health-insurance-scams"
    encoded = ("https://consumer.ftc.gov/%3Ca%20href%3D%22https%3A//consumer.ftc.gov/consumer-alerts/2026/09/"
               "what-know-ahead-open-enrollment-avoid-health-insurance-scams%22%20hreflang%3D%22en%22%3Eview%3C/a%3E")
    escaped = f'&lt;a href="{article}" hreflang="en"&gt;view&lt;/a&gt;'
    for link in (encoded, escaped):
        raw = f"<rss><channel><item><title>T</title><link>{link}</link></item></channel></rss>".encode()
        assert learning_feeds._xml_items(raw)[0]["url"] == article
    assert learning_feeds._feed_link(" https://www.cyber.gov.au/alert/a ") == "https://www.cyber.gov.au/alert/a"


@pytest.mark.anyio
async def test_every_curated_catalogue_article_passes_the_publication_quality_gate():
    await learning.seed_catalogue_sources_feeds()
    sources = set(await learning.sources_by_id())
    articles = json.loads((CONTENT / "learning_catalogue_au.json").read_text())["articles"]
    assert len(articles) == 43
    for raw in articles:
        doc = await learning.prepare_article(learning.expand_catalogue_article(raw), actor="test")
        assert learning.quality_checks(doc, sources)["passed"], raw["slug"]
        assert doc["language"] == "en-AU"  # the Learn screen lists en-AU articles


def test_every_seeded_article_has_a_stored_thumbnail():
    thumbs = json.loads((CONTENT / "learning_thumbnails.json").read_text())["thumbnails"]
    slugs = [a["slug"] for a in json.loads((CONTENT / "learning_catalogue_au.json").read_text())["articles"]]
    slugs += [a["slug"] for a in json.loads((CONTENT / "learning_seed_articles.json").read_text())["articles"]]
    assert sorted(slugs) == sorted(thumbs)
    assert all(path.startswith("apollo-scam-guard/learning/") for path in thumbs.values())


@pytest.mark.anyio
async def test_seeding_creates_publishes_and_never_overwrites(monkeypatch):
    slug = f"parity-test-{uuid.uuid4().hex[:8]}"
    raw = learning.expand_catalogue_article(json.loads((CONTENT / "learning_catalogue_au.json").read_text())["articles"][0])
    raw = {**raw, "slug": slug, "title": f"Parity test {slug}"}
    real_content = learning._content
    monkeypatch.setattr(learning, "_content", lambda name: {"thumbnails": {slug: "apollo-scam-guard/learning/x.jpg"}} if name == "learning_thumbnails.json" else real_content(name))
    try:
        first = await learning._seed_published([raw], "system:catalogue_seed")
        row = await db.learning_articles.find_one({"slug": slug})
        assert first == {"articles_seeded": 1, "articles_published": 1, "articles_skipped": 0}
        assert row["status"] == "published" and row["thumbnail_path"] == "apollo-scam-guard/learning/x.jpg"
        await db.learning_articles.update_one({"slug": slug}, {"$set": {"status": "archived", "title": "Edited by admin"}})
        second = await learning._seed_published([raw], "system:catalogue_seed")
        row = await db.learning_articles.find_one({"slug": slug})
        assert second["articles_skipped"] == 1 and row["status"] == "archived" and row["title"] == "Edited by admin"
    finally:
        await db.learning_articles.delete_many({"slug": slug}); await db.learning_article_versions.delete_many({"slug": slug})


@pytest.mark.anyio
async def test_startup_seed_is_idempotent_and_gives_curated_articles_thumbnails():
    await learning.seed_catalogue_sources_feeds()
    await learning.seed_catalogue_articles()
    again = await learning.seed_catalogue_articles()
    assert again["articles_seeded"] == 0 and again["articles_skipped"] == 43
    slugs = [a["slug"] for a in json.loads((CONTENT / "learning_catalogue_au.json").read_text())["articles"]]
    assert await db.learning_articles.count_documents({"slug": {"$in": slugs}, "thumbnail_path": {"$nin": [None, ""]}}) == 43


def _rss_response(url: str, status: int = 200) -> httpx.Response:
    body = b"<rss><channel><item><title>Alert</title><link>https://www.scamwatch.gov.au/news/a</link><description>d</description></item></channel></rss>"
    return httpx.Response(status, headers={"content-type": "application/rss+xml"}, content=body, request=httpx.Request("GET", url))


@pytest.mark.parametrize("direct", ["refused_403", "never_answered"])
@pytest.mark.anyio
async def test_a_source_that_refuses_this_server_is_read_through_the_archive(monkeypatch, direct):
    tag = uuid.uuid4().hex[:8]; feed_id = f"fallback-{tag}"; url = "https://www.scamwatch.gov.au/rss"

    async def public_get(target, max_hops=3):
        if direct == "never_answered": raise OutboundBlocked("fetch_failed")
        return _rss_response(target, 403)

    async def archive_fetch(target):
        return _rss_response(f"https://web.archive.org/web/20261024000000id_/{target}"), now_utc() - timedelta(minutes=1)
    monkeypatch.setattr(learning_feeds, "public_get", public_get)
    monkeypatch.setattr(archive_relay, "fetch", archive_fetch)
    feed = {"feed_id": feed_id, "source_id": "s", "url": url, "format": "rss", "content_type": "live_alert", "language": "en-AU",
            "trust_status": "recognised_government", "review_queue_policy": "always_review"}
    try:
        result = await learning_feeds.refresh(feed, {"source_id": "s", "allowed_hosts": ["www.scamwatch.gov.au"]})
        state = await db.learning_feed_state.find_one({"feed_id": feed_id})
        assert result["status"] == "success" and result["accepted"] == 1
        assert state["relay_used"] == "internet_archive"
    finally:
        for collection in ("learning_feed_state", "learning_feed_items", "learning_candidates", "learning_feed_runs"):
            await db[collection].delete_many({"feed_id": feed_id})


@pytest.mark.anyio
async def test_when_the_archive_also_fails_the_direct_refusal_is_reported(monkeypatch):
    tag = uuid.uuid4().hex[:8]; feed_id = f"fallback-{tag}"

    async def public_get(target, max_hops=3): raise OutboundBlocked("fetch_failed")
    async def archive_fetch(target): raise archive_relay.ArchiveRelayError("archive_unavailable")
    monkeypatch.setattr(learning_feeds, "public_get", public_get)
    monkeypatch.setattr(archive_relay, "fetch", archive_fetch)
    feed = {"feed_id": feed_id, "source_id": "s", "url": "https://www.cyber.gov.au/rss", "format": "rss"}
    try:
        result = await learning_feeds.refresh(feed, {"source_id": "s", "allowed_hosts": ["www.cyber.gov.au"]})
        state = await db.learning_feed_state.find_one({"feed_id": feed_id})
        assert result["status"] == "failed" and state["error"] == "OutboundBlocked" and state["error_detail"] == "fetch_failed"
    finally:
        for collection in ("learning_feed_state", "learning_feed_runs"):
            await db[collection].delete_many({"feed_id": feed_id})


@pytest.mark.anyio
async def test_parity_fingerprint_reports_presence_of_credentials_never_values(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "secret-value-123")
    value = await parity.snapshot()
    assert set(value) == {"code", "learn", "feeds", "settings", "models", "credentialsSet", "fileStorage"}
    assert set(value["models"]) == {"magnum_di", "tc_flyby", "ask_higgins"} and value["models"]["tc_flyby"] == value["models"]["magnum_di"]
    assert value["credentialsSet"]["GEMINI_API_KEY"] is True
    assert "secret-value-123" not in json.dumps(value, default=str)
    assert value["learn"]["curatedCount"] >= 43 and len(value["code"]) == 16


def test_parity_check_lists_every_nested_difference():
    import importlib.util
    spec = importlib.util.spec_from_file_location("parity_check", Path(__file__).resolve().parents[1] / "scripts" / "parity_check.py")
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    a = {"code": "x", "learn": {"published": 110, "curatedCount": 49}, "fileStorage": "failing"}
    b = {"code": "x", "learn": {"published": 45, "curatedCount": 49}, "fileStorage": "ok"}
    assert module.differences(a, b) == ['fileStorage: preview="failing"  production="ok"', "learn.published: preview=110  production=45"]
