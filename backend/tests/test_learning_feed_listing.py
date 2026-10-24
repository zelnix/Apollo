"""Approved listing-page parsing (ENISA, ACSC, Scamwatch).

ENISA retired its RSS feed, so `enisa-news` reads https://www.enisa.europa.eu/news as an approved listing page.
That page has ~175 linked texts; the 13 articles sat after the first 100 menu links and were cut off by the
item cap. Links are now filtered by the feed's allowed path BEFORE the cap, hrefs are trimmed (ENISA emits
trailing spaces) and repeated links are kept once.

Run: cd /app/backend && python -m pytest tests/test_learning_feed_listing.py -q
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from services.learning_feeds import MAX_ITEMS, _html_items

BASE = "https://www.enisa.europa.eu/news"


def _page(menu_links: int, articles: list[str]) -> bytes:
    menu = "".join(f'<a href="/topics/menu-{i}">Menu {i}</a>' for i in range(menu_links))
    body = "".join(f'<a href="/news/{slug} "><img alt=""></a><h3><a href="/news/{slug} ">{slug.title()}</a></h3>' for slug in articles)
    return f"<html><body><nav>{menu}</nav><main>{body}</main></body></html>".encode()


def test_articles_after_many_menu_links_are_not_cut_off():
    articles = [f"story-{i}" for i in range(13)]
    items = _html_items(_page(150, articles), BASE, ["/news/"])
    assert [item["url"] for item in items] == [f"{BASE}/{slug}" for slug in articles]  # trimmed, in page order
    assert all(item["title"] for item in items)


def test_repeated_article_links_are_kept_once():
    items = _html_items(_page(0, ["featured", "featured", "other"]), BASE, ["/news/"])
    assert [item["url"].rsplit("/", 1)[1] for item in items] == ["featured", "other"]


def test_cap_still_applies_after_filtering():
    items = _html_items(_page(5, [f"s-{i}" for i in range(MAX_ITEMS + 20)]), BASE, ["/news/"])
    assert len(items) == MAX_ITEMS


def test_without_prefixes_every_linked_text_is_returned():
    items = _html_items(_page(3, ["a"]), BASE)
    assert len(items) == 4


def test_links_back_to_the_listing_page_itself_are_dropped():
    # Scamwatch's listing page sits inside its own allowed path, so "Skip to content", year/category filters and
    # pagination links matched it and became drafts titled "2006", "Page 2", "Skip to content".
    listing = "https://www.scamwatch.gov.au/about-us/news-and-alerts/browse-news-and-alerts"
    page = (b'<a href="#main-content-skip">Skip to content</a><a href="/about-us/news-and-alerts/browse-news-and-alerts#edit-query">Skip to search</a>'
            b'<a href="/about-us/news-and-alerts/browse-news-and-alerts?f%5B0%5D=date%3A2006">2006</a>'
            b'<a href="/about-us/news-and-alerts/browse-news-and-alerts?page=1">Page 2</a>'
            b'<a href="/about-us/news-and-alerts/browse-news-and-alerts/">Browse</a>'
            b'<a href="/about-us/news-and-alerts/real-alert">Real alert</a>')
    items = _html_items(page, listing, ["/about-us/news-and-alerts/"])
    assert [item["title"] for item in items] == ["Real alert"]


@pytest.mark.anyio
async def test_startup_purge_removes_listing_self_links_but_keeps_real_alerts():
    import uuid
    from core.db import db
    from services.learning_feeds import purge_listing_page_links
    tag = uuid.uuid4().hex[:8]; feed_id = f"purge-{tag}"
    listing = f"https://www.scamwatch.gov.au/purge-{tag}/browse"
    junk, real = f"{listing}?f%5B0%5D=date%3A2006", f"https://www.scamwatch.gov.au/purge-{tag}/scam-alert-real"
    await db.learning_feeds.insert_one({"feed_id": feed_id, "format": "html", "url": listing, "enabled": True})
    for url, slug in ((junk, f"junk-{tag}"), (real, f"real-{tag}")):
        await db.learning_feed_items.insert_one({"feed_id": feed_id, "url": url, "fingerprint": slug})
        await db.learning_candidates.insert_one({"feed_id": feed_id, "url": url, "fingerprint": slug})
        await db.learning_articles.insert_one({"slug": slug, "source_type": "automated_feed", "status": "in_review", "citations": [{"url": url}]})
    await db.learning_articles.insert_one({"slug": f"curated-{tag}", "source_type": "owner_curated", "status": "published", "citations": [{"url": junk}]})
    try:
        removed = await purge_listing_page_links()
        assert removed["articles"] >= 1 and removed["candidates"] >= 1 and removed["feed_items"] >= 1
        assert await db.learning_articles.count_documents({"slug": {"$in": [f"real-{tag}", f"curated-{tag}"]}}) == 2
        assert await db.learning_articles.count_documents({"slug": f"junk-{tag}"}) == 0
        assert await db.learning_feed_items.count_documents({"feed_id": feed_id}) == 1
        assert await db.learning_candidates.count_documents({"feed_id": feed_id}) == 1
    finally:
        await db.learning_feeds.delete_many({"feed_id": feed_id})
        for collection in ("learning_feed_items", "learning_candidates"):
            await db[collection].delete_many({"feed_id": feed_id})
        await db.learning_articles.delete_many({"slug": {"$regex": f"-{tag}$"}})


def test_catalogue_points_enisa_at_its_listing_page():
    catalogue = json.loads((Path(__file__).resolve().parents[1] / "content" / "learning_catalogue_au.json").read_text())
    feed = next(row for row in catalogue["feeds"] if row["feedId"] == "enisa-news")
    assert feed["url"] == BASE and feed["format"] == "html"
    assert feed["parser"] == "approved_listing_page" and feed["allowedPathPrefixes"] == ["/news/"]
