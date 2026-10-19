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
from urllib.parse import urljoin, urlparse

from defusedxml import ElementTree as ET

from core.db import db, now_utc
from services.outbound import public_get

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


def _xml_items(raw: bytes) -> list[dict]:
    root = ET.fromstring(raw); values = []
    nodes = root.findall(".//item") or root.findall(".//{*}entry")
    for node in nodes[:MAX_ITEMS]:
        link_node = node.find("link") or node.find("{*}link")
        link = _text(link_node) or (link_node.attrib.get("href", "") if link_node is not None else "")
        values.append({"title": _text(node.find("title") or node.find("{*}title")), "url": link,
            "summary": _text(node.find("description") or node.find("{*}summary") or node.find("{*}content")),
            "guid": _text(node.find("guid") or node.find("{*}id")) or link,
            "publishedAt": _date(_text(node.find("pubDate") or node.find("{*}published") or node.find("{*}updated")))})
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
            href = dict(attrs).get("href")
            if href: self.current = urljoin(self.base_url, href); self.text = []
    def handle_data(self, data: str):
        if self.current: self.text.append(data)
    def handle_endtag(self, tag: str):
        if tag == "a" and self.current:
            title = re.sub(r"\s+", " ", " ".join(self.text)).strip()
            if title: self.items.append({"title": title, "url": self.current, "summary": title, "guid": self.current, "publishedAt": None})
            self.current = None; self.text = []


def _html_items(raw: bytes, base_url: str) -> list[dict]:
    parser = _ListingParser(base_url); parser.feed(raw.decode("utf-8", errors="replace")); return parser.items[:MAX_ITEMS]


async def refresh(feed: dict, source: dict) -> dict:
    started = now_utc(); run_id = hashlib.sha256(f"{feed['feed_id']}:{started.isoformat()}".encode()).hexdigest()[:24]
    run = {"run_id": run_id, "feed_id": feed["feed_id"], "started_at": started, "status": "running", "fetched": 0, "accepted": 0, "rejected": 0, "error": None}
    await db.learning_feed_runs.insert_one(dict(run))
    try:
        target = urlparse(feed["url"])
        if target.scheme != "https" or target.hostname not in set(source["allowed_hosts"]): raise ValueError("feed URL outside source allowlist")
        response = await public_get(feed["url"], max_hops=2)
        final_host = urlparse(str(response.request.url)).hostname
        if final_host not in set(source["allowed_hosts"]): raise ValueError("feed redirect escaped source allowlist")
        content_type = response.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        allowed_types = {"application/feed+json", "application/json"} if feed["format"] == "json" else {"text/html", "application/xhtml+xml"} if feed["format"] == "html" else {"application/rss+xml", "application/atom+xml", "application/xml", "text/xml", "application/octet-stream"}
        if response.status_code != 200 or len(response.content) > MAX_BYTES or content_type not in allowed_types: raise ValueError("feed response rejected")
        if feed["format"] == "html" and feed.get("parser") != "approved_listing_page": raise ValueError("HTML source was not explicitly approved")
        rows = _json_items(response.content) if feed["format"] == "json" else _html_items(response.content, feed["url"]) if feed["format"] == "html" else _xml_items(response.content)
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
            "last_success_at": started, "status": "fresh", "item_count": len(rows), "error": None}}, upsert=True)
    except Exception as exc:
        run["status"] = "failed"; run["error"] = type(exc).__name__
        await db.learning_feed_state.update_one({"feed_id": feed["feed_id"]}, {"$set": {"feed_id": feed["feed_id"], "last_checked_at": started,
            "status": "unavailable", "error": type(exc).__name__}}, upsert=True)
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