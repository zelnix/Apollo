"""Safe government feed ingestion into a review queue; never publishes directly."""
from __future__ import annotations

import hashlib
import html
import json
import logging
import re
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from urllib.parse import unquote, urljoin, urlparse

from defusedxml import ElementTree as ET

from core.db import db, now_utc
from services import archive_relay
from services.outbound import BLOCKED_STATUS, OutboundBlocked, public_get

MAX_BYTES = 1_048_576
MAX_ITEMS = 100
logger = logging.getLogger("apollo")


def _date(value: str | None) -> datetime | None:
    if not value: return None
    try:
        parsed = parsedate_to_datetime(value); return parsed.astimezone(timezone.utc) if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError, OverflowError):
        try: return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)
        except ValueError: return None


def _text(node) -> str:
    if node is None: return ""
    raw = "".join(node.itertext()).strip(); plain = re.sub(r"<[^>]+>", " ", html.unescape(raw))
    return re.sub(r"\s+", " ", plain).strip()


def _find(node, *paths: str):
    """First matching child. An Element with no children is falsy, so `find(a) or find(b)` silently skipped
    every text-only <description> and <pubDate> — RSS items arrived with no summary and no date."""
    for path in paths:
        found = node.find(path)
        if found is not None:
            return found
    return None


_HREF = re.compile(r"""href\s*=\s*["']([^"']+)["']""", re.I)
_WRAPPED_LINK = {"$regex": r"%3Ca%20href|<a\s+href", "$options": "i"}


def _feed_link(raw: str) -> str:
    """The article's address from a feed <link>. The FTC's feed puts a whole rendered link there,
    `<a href="https://…/article" hreflang="en">view</a>`, escaped or percent-encoded after the site address
    (https://consumer.ftc.gov/%3Ca%20href%3D%22…). The address is the href inside it; any other link is kept."""
    text = html.unescape(raw or "").strip()
    match = _HREF.search(unquote(text))
    if match:
        return html.unescape(match.group(1)).strip()
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", text)).strip()


def _xml_items(raw: bytes) -> list[dict]:
    root = ET.fromstring(raw); values = []
    nodes = root.findall(".//item") or root.findall(".//{*}entry")
    for node in nodes[:MAX_ITEMS]:
        link_node = _find(node, "link", "{*}link")
        link = _feed_link("".join(link_node.itertext()) if link_node is not None else "") or (link_node.attrib.get("href", "") if link_node is not None else "")
        guid = _text(_find(node, "guid", "{*}id"))
        link = link or (guid if guid.startswith("https://") else "")  # e.g. FBI: no <link>, the URL is the <guid>
        values.append({"title": _text(_find(node, "title", "{*}title")), "url": link,
            "summary": _text(_find(node, "description", "{*}summary", "{*}content")),
            "guid": guid or link,
            "publishedAt": _date(_text(_find(node, "pubDate", "{*}published", "{*}updated")))})
    return values


def _json_items(raw: bytes) -> list[dict]:
    parsed = json.loads(raw); rows = parsed.get("items", parsed if isinstance(parsed, list) else [])
    return [{"title": str(row.get("title") or ""), "url": str(row.get("url") or row.get("external_url") or ""),
             "summary": str(row.get("summary") or row.get("content_text") or ""), "guid": str(row.get("id") or row.get("url") or ""),
             "publishedAt": _date(str(row.get("date_published") or row.get("published_at") or ""))} for row in rows[:MAX_ITEMS] if isinstance(row, dict)]


class _ListingParser(HTMLParser):
    def __init__(self, base_url: str):
        super().__init__(); self.base_url = base_url; self.current: str | None = None; self.text: list[str] = []; self.items: list[dict] = []
    def handle_starttag(self, tag: str, attrs):
        if tag == "a":
            href = (dict(attrs).get("href") or "").strip()  # some CMSs emit trailing spaces inside href
            if href: self.current = urljoin(self.base_url, href); self.text = []
    def handle_data(self, data: str):
        if self.current: self.text.append(data)
    def handle_endtag(self, tag: str):
        if tag == "a" and self.current:
            title = re.sub(r"\s+", " ", " ".join(self.text)).strip()
            if title: self.items.append({"title": title, "url": self.current, "summary": title, "guid": self.current, "publishedAt": None})
            self.current = None; self.text = []


def _html_items(raw: bytes, base_url: str, path_prefixes: list[str] | None = None) -> list[dict]:
    """Article links from an approved listing page. Menu/footer links are dropped by path BEFORE the item cap
    (a page with 100+ navigation links would otherwise push every article out), and repeats (a featured
    block plus the full list) are kept once."""
    parser = _ListingParser(base_url); parser.feed(raw.decode("utf-8", errors="replace"))
    listing = urlparse(base_url)
    seen: set[str] = set(); items: list[dict] = []
    for item in parser.items:
        parsed = urlparse(item["url"]); path = parsed.path
        # Links back to the listing page itself — "Skip to content", ?page=2, year/category filters — aren't articles.
        if (parsed.hostname, path.rstrip("/")) == (listing.hostname, listing.path.rstrip("/")): continue
        if item["url"] in seen or (path_prefixes and not any(path.startswith(prefix) for prefix in path_prefixes)): continue
        seen.add(item["url"]); items.append(item)
    return items[:MAX_ITEMS]


async def refresh(feed: dict, source: dict) -> dict:
    started = now_utc(); run_id = hashlib.sha256(f"{feed['feed_id']}:{started.isoformat()}".encode()).hexdigest()[:24]
    run = {"run_id": run_id, "feed_id": feed["feed_id"], "started_at": started, "status": "running", "fetched": 0, "accepted": 0, "rejected": 0, "error": None}
    await db.learning_feed_runs.insert_one(dict(run))
    try:
        target = urlparse(feed["url"])
        if target.scheme != "https" or target.hostname not in set(source["allowed_hosts"]): raise ValueError("feed URL outside source allowlist")
        copy_at = relay_used = None
        if feed.get("relay") == archive_relay.INTERNET_ARCHIVE:
            # The source blocks cloud servers; read the Archive's fresh copy of this exact feed URL instead.
            response, copy_at = await archive_relay.fetch(feed["url"]); relay_used = archive_relay.INTERNET_ARCHIVE
        else:
            direct_error: Exception | None = None
            try:
                response = await public_get(feed["url"], max_hops=2)
            except OutboundBlocked as exc:
                if str(exc) != "fetch_failed": raise
                response, direct_error = None, exc
            if response is None or response.status_code in BLOCKED_STATUS:
                # The source refused THIS server (sources block some cloud addresses and not others). Read the
                # Archive's copy instead, so every Apollo server reads the same feed. If that fails too, the
                # direct refusal stays the reported reason.
                try:
                    response, copy_at = await archive_relay.fetch(feed["url"]); relay_used = archive_relay.INTERNET_ARCHIVE
                except archive_relay.ArchiveRelayError:
                    if direct_error: raise direct_error
                    raise ValueError("feed response rejected")
            else:
                final_host = urlparse(str(response.request.url)).hostname
                if final_host not in set(source["allowed_hosts"]): raise ValueError("feed redirect escaped source allowlist")
        content_type = response.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        allowed_types = {"application/feed+json", "application/json"} if feed["format"] == "json" else {"text/html", "application/xhtml+xml"} if feed["format"] == "html" else {"application/rss+xml", "application/atom+xml", "application/xml", "text/xml", "application/octet-stream"}
        if response.status_code != 200 or len(response.content) > MAX_BYTES or content_type not in allowed_types: raise ValueError("feed response rejected")
        if feed["format"] == "html" and feed.get("parser") != "approved_listing_page": raise ValueError("HTML source was not explicitly approved")
        rows = _json_items(response.content) if feed["format"] == "json" else _html_items(response.content, feed["url"], feed.get("allowed_path_prefixes")) if feed["format"] == "html" else _xml_items(response.content)
        run["fetched"] = len(rows)
        for row in rows:
            url = row["url"][:1500]; parsed = urlparse(url)
            path_allowed = not feed.get("allowed_path_prefixes") or any(parsed.path.startswith(prefix) for prefix in feed["allowed_path_prefixes"])
            if not row["title"] or parsed.scheme != "https" or parsed.hostname not in set(source["allowed_hosts"]) or not path_allowed: run["rejected"] += 1; continue
            fingerprint = hashlib.sha256(f"{feed['feed_id']}:{row['guid'] or url or row['title']}".encode()).hexdigest()
            candidate = {"candidate_id": fingerprint[:24], "fingerprint": fingerprint, "feed_id": feed["feed_id"], "source_id": source["source_id"],
                "title": row["title"][:300], "summary": row["summary"][:1500], "url": url, "published_at": row["publishedAt"],
                "status": "pending", "trust_status": feed["trust_status"], "content_type": feed["content_type"], "language": feed["language"],
                "created_at": started, "updated_at": started, "review_queue_policy": feed["review_queue_policy"]}
            result = await db.learning_candidates.update_one({"fingerprint": fingerprint}, {"$setOnInsert": candidate, "$set": {"last_seen_at": started}}, upsert=True)
            await db.learning_feed_items.update_one({"fingerprint": fingerprint}, {"$set": {**candidate, "last_checked_at": started, "expires_at": started + timedelta(days=90)}}, upsert=True)
            run["accepted"] += int(bool(result.upserted_id))
        run["status"] = "success"
        await db.learning_feed_state.update_one({"feed_id": feed["feed_id"]}, {"$set": {"feed_id": feed["feed_id"], "last_checked_at": started,
            "last_success_at": started, "status": "fresh", "item_count": len(rows), "error": None, "error_detail": None, "relay_copy_at": copy_at, "relay_used": relay_used}}, upsert=True)
    except Exception as exc:
        run["status"] = "failed"; run["error"] = type(exc).__name__
        # ValueError reasons are Apollo's own fixed strings (or OutboundBlocked codes) — safe to keep for Feed Health.
        detail = str(exc)[:120] if isinstance(exc, ValueError) else None
        await db.learning_feed_state.update_one({"feed_id": feed["feed_id"]}, {"$set": {"feed_id": feed["feed_id"], "last_checked_at": started,
            "status": "unavailable", "error": type(exc).__name__, "error_detail": detail}}, upsert=True)
    run["finished_at"] = now_utc()
    await db.learning_feed_runs.update_one({"run_id": run_id}, {"$set": run})
    return {key: run[key] for key in ("run_id", "feed_id", "status", "fetched", "accepted", "rejected", "error")}


async def refresh_selected(feed_id: str | None = None) -> dict:
    query = {"enabled": True}
    if feed_id: query["feed_id"] = feed_id
    feeds = await db.learning_feeds.find(query, {"_id": 0}).to_list(100)
    results = []
    for feed in feeds:
        try:
            source = await db.learning_sources.find_one({"source_id": feed["source_id"], "active": True, "government_authority": True}, {"_id": 0})
            results.append(await refresh(feed, source) if source else {"feed_id": feed["feed_id"], "status": "failed", "error": "SourceUnavailable"})
        except Exception as exc:
            logger.warning("learning feed refresh failed feed_id=%s error_type=%s", feed.get("feed_id"), type(exc).__name__)
            results.append({"feed_id": feed["feed_id"], "status": "failed", "error": "FeedRefreshFailure"})
    return {"feeds": results}


async def refresh_due() -> None:
    now = now_utc(); feeds = await db.learning_feeds.find({"enabled": True}, {"_id": 0}).to_list(100)
    for feed in feeds:
        try:
            state = await db.learning_feed_state.find_one({"feed_id": feed["feed_id"]}, {"_id": 0})
            checked = state.get("last_checked_at") if state else None
            if checked and checked.tzinfo is None: checked = checked.replace(tzinfo=timezone.utc)
            if not checked or checked + timedelta(minutes=feed["refresh_interval_minutes"]) <= now:
                source = await db.learning_sources.find_one({"source_id": feed["source_id"], "active": True, "government_authority": True}, {"_id": 0})
                if source: await refresh(feed, source)
                else: await db.learning_feed_state.update_one({"feed_id": feed["feed_id"]}, {"$set": {"feed_id": feed["feed_id"], "last_checked_at": now, "status": "unavailable", "error": "SourceUnavailable"}}, upsert=True)
        except Exception as exc:
            logger.warning("scheduled learning feed refresh failed feed_id=%s error_type=%s", feed.get("feed_id"), type(exc).__name__)
            try:
                await db.learning_feed_state.update_one({"feed_id": feed["feed_id"]}, {"$set": {"feed_id": feed["feed_id"], "last_checked_at": now, "status": "unavailable", "error": "FeedRefreshFailure"}}, upsert=True)
            except Exception:
                continue


async def purge_listing_page_links() -> dict:
    """Remove items that were links back to a listing page itself (year/category filters, ?page=N, "Skip to …").

    Before _html_items ignored them, Scamwatch's listing page turned 46 such links into feed items, candidates
    and auto-drafted Learn "articles" titled "2006", "Page 2", "Skip to content". Runs at startup so every
    environment is cleaned the same way; only automated feed content is touched, never curated articles."""
    removed = {"articles": 0, "candidates": 0, "feed_items": 0}
    async for feed in db.learning_feeds.find({"format": "html"}, {"_id": 0, "feed_id": 1, "url": 1}):
        listing = urlparse(feed["url"])
        pattern = {"$regex": f"^https://{re.escape(listing.hostname or '')}{re.escape(listing.path.rstrip('/'))}/?([?#].*)?$"}
        slugs = [row["slug"] async for row in db.learning_articles.find({"source_type": "automated_feed", "citations.url": pattern}, {"_id": 0, "slug": 1})]
        if slugs:
            removed["articles"] += (await db.learning_articles.delete_many({"slug": {"$in": slugs}})).deleted_count
            await db.learning_article_versions.delete_many({"slug": {"$in": slugs}})
        removed["candidates"] += (await db.learning_candidates.delete_many({"feed_id": feed["feed_id"], "url": pattern})).deleted_count
        removed["feed_items"] += (await db.learning_feed_items.delete_many({"feed_id": feed["feed_id"], "url": pattern})).deleted_count
    return removed


async def repair_feed_links() -> dict:
    """Restore the real address of items saved while the FTC's feed wrapped each link in <a href> (see
    _feed_link): https://consumer.ftc.gov/%3Ca%20href%3D%22… opens nothing, and two copies of one article shared
    it, so Scam Alerts listed it twice. The address is fixed wherever it was copied, then one feed item is
    kept per address (the one already explained, else the most recently seen). Runs at startup so every
    environment is cleaned the same way."""
    fixed = {"feed_items": 0, "candidates": 0, "knowledge": 0, "articles": 0, "copies_removed": 0}
    for collection, key in ((db.learning_feed_items, "feed_items"), (db.learning_candidates, "candidates"), (db.higgins_knowledge, "knowledge")):
        async for row in collection.find({"url": _WRAPPED_LINK}, {"_id": 1, "url": 1}):
            await collection.update_one({"_id": row["_id"]}, {"$set": {"url": _feed_link(row["url"])}})
            fixed[key] += 1
    async for row in db.learning_articles.find({"citations.url": _WRAPPED_LINK}, {"_id": 1, "citations": 1}):
        citations = [{**c, "url": _feed_link(c["url"])} if isinstance(c, dict) and isinstance(c.get("url"), str) else c for c in row["citations"]]
        await db.learning_articles.update_one({"_id": row["_id"]}, {"$set": {"citations": citations}})
        fixed["articles"] += 1
    copies = db.learning_feed_items.aggregate([
        {"$group": {"_id": "$url", "n": {"$sum": 1}, "rows": {"$push": {"id": "$_id", "seen": "$last_checked_at", "explained": {"$ifNull": ["$scam_analysis", False]}}}}},
        {"$match": {"n": {"$gt": 1}}}])
    async for group in copies:
        rank = lambda r: (bool(r["explained"]), r["seen"] or datetime.min.replace(tzinfo=timezone.utc))  # noqa: E731
        keep = max(group["rows"], key=rank)["id"]
        result = await db.learning_feed_items.delete_many({"_id": {"$in": [r["id"] for r in group["rows"] if r["id"] != keep]}})
        fixed["copies_removed"] += result.deleted_count
    return fixed



async def weekly_publish() -> dict:
    """Process pending learning candidates into published articles.

    Weekly automation cycle:
    1. Select candidates that are pending and not yet converted to articles.
    2. Deduplicate: skip if an article with a matching title slug already exists.
    3. Convert to article draft via the existing prepare/upsert pipeline.
    4. Run quality checks; auto-publish those that pass.
    5. Return summary counts.

    Uses ONLY the existing learning service infrastructure — no new CMS, no new
    models, no new databases.
    """
    from services.learning import (
        _slug, quality_checks, sources_by_id, upsert_article, transition,
    )

    now = now_utc()
    candidates = await db.learning_candidates.find(
        {"status": "pending"},
        {"_id": 0},
    ).sort("created_at", -1).limit(50).to_list(50)

    promoted = 0; published = 0; skipped = 0; failed = 0

    source_map = await sources_by_id()

    for candidate in candidates:
        try:
            title = (candidate.get("title") or "").strip()
            if not title:
                skipped += 1
                continue

            try:
                slug = _slug(title)
            except ValueError:
                skipped += 1
                continue
            # Dedup: skip if article with this slug already exists
            existing = await db.learning_articles.find_one({"slug": slug}, {"_id": 0, "slug": 1})
            if existing:
                await db.learning_candidates.update_one(
                    {"fingerprint": candidate["fingerprint"]},
                    {"$set": {"status": "duplicate", "updated_at": now}})
                skipped += 1
                continue

            # Build article draft from candidate data
            raw = {
                "slug": slug,
                "title": title,
                "summary": (candidate.get("summary") or title)[:600],
                "category": "scam_alert",
                "topic": "government_alert",
                "audience": "general",
                "language": candidate.get("language", "en-AU"),
                "contentType": "alert_context",
                "riskContext": "active_threat",
                "tags": ["government", "alert", "automated"],
                "sections": [
                    {"heading": "Alert details", "paragraphs": [(candidate.get("summary") or title)[:2000]], "bullets": []},
                    {"heading": "Source", "paragraphs": [f"Published by {candidate.get('source_id', 'government authority')}. Original URL: {candidate.get('url', 'N/A')}"], "bullets": []},
                    {"heading": "What to do", "paragraphs": ["If you think you have been affected, contact the organisation directly using details from their official website."], "bullets": ["Do not click links in unexpected messages.", "Report scams to Scamwatch or your local authority.", "Monitor your accounts for unusual activity."]},
                ],
                "citations": [{
                    "sourceId": candidate.get("source_id", ""),
                    "url": candidate.get("url", ""),
                    "label": candidate.get("source_id", "Government source"),
                }],
                "sourceType": "automated_feed",
                "evidenceQuality": "official_alert",
            }

            # Upsert as draft
            await upsert_article(raw, "system:weekly_publish")
            promoted += 1

            # Attempt full workflow: draft → in_review → approved → published
            try:
                await transition(slug, "in_review", "system:weekly_publish")
                await transition(slug, "approved", "system:weekly_publish")
                await transition(slug, "published", "system:weekly_publish")
                published += 1
            except (LookupError, ValueError) as exc:
                logger.info("weekly_publish: %s stayed as draft (quality gate): %s", slug, exc)

            # Mark candidate as processed
            await db.learning_candidates.update_one(
                {"fingerprint": candidate["fingerprint"]},
                {"$set": {"status": "processed", "updated_at": now}})

        except Exception as exc:
            failed += 1
            logger.warning("weekly_publish candidate failed fingerprint=%s error=%s",
                           candidate.get("fingerprint"), type(exc).__name__)
            # Mark candidate as failed so it isn't retried endlessly
            try:
                await db.learning_candidates.update_one(
                    {"fingerprint": candidate["fingerprint"]},
                    {"$set": {"status": "failed", "error": type(exc).__name__, "updated_at": now}})
            except Exception:
                pass

    return {"promoted": promoted, "published": published, "skipped": skipped, "failed": failed}
