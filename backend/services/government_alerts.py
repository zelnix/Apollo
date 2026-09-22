"""Cached, read-only recognised-government alert feeds with explicit freshness truth."""
from __future__ import annotations

import hashlib
import html
import re
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import urlparse

import httpx
from defusedxml import ElementTree as ET

from core.db import db, now_utc

MAX_BYTES = 1_048_576
MAX_ITEMS = 100
STALE_AFTER = timedelta(hours=6)
RETAIN_FOR = timedelta(days=90)
FEEDS = {
    "acsc_alerts": {"url": "https://www.cyber.gov.au/rss/alerts", "source": "Australian Cyber Security Centre", "source_url": "https://www.cyber.gov.au/about-us/view-all-content/alerts-and-advisories"},
    "acsc_advisories": {"url": "https://www.cyber.gov.au/rss/advisories", "source": "Australian Cyber Security Centre", "source_url": "https://www.cyber.gov.au/about-us/view-all-content/alerts-and-advisories"},
}


async def ensure_indexes() -> None:
    await db.government_alerts.create_index([("feed_id", 1), ("guid", 1)], unique=True)
    await db.government_alerts.create_index("published_at")
    await db.government_alerts.create_index("expires_at", expireAfterSeconds=0)
    await db.government_feed_state.create_index("feed_id", unique=True)


def _date(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = parsedate_to_datetime(value)
        return parsed.astimezone(timezone.utc) if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError, OverflowError):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)
        except ValueError:
            return None


def _text(node) -> str:
    if node is None:
        return ""
    raw = "".join(node.itertext()).strip()
    plain = re.sub(r"<[^>]+>", " ", html.unescape(raw))
    return re.sub(r"\s+", " ", plain).strip()


def parse_feed(raw: bytes, feed_id: str, cfg: dict[str, str], now: datetime) -> list[dict]:
    root = ET.fromstring(raw)
    items: list[dict] = []
    for node in root.findall(".//item")[:MAX_ITEMS]:
        title = _text(node.find("title"))[:300]
        link = _text(node.find("link"))[:1000]
        guid = (_text(node.find("guid")) or link or title)[:1000]
        parsed = urlparse(link)
        if not title or not guid or parsed.scheme != "https" or parsed.hostname not in {"www.cyber.gov.au", "cyber.gov.au"}:
            continue
        items.append({"feed_id": feed_id, "guid": hashlib.sha256(guid.encode()).hexdigest(), "title": title, "url": link,
                      "summary": _text(node.find("description"))[:1000], "source": cfg["source"], "source_url": cfg["source_url"],
                      "published_at": _date(_text(node.find("pubDate")) or _text(node.find("published"))), "stored_at": now, "expires_at": now + RETAIN_FOR})
    return items


async def _read_limited(response: httpx.Response) -> bytes:
    data = bytearray()
    async for chunk in response.aiter_bytes():
        data.extend(chunk)
        if len(data) > MAX_BYTES:
            raise ValueError("feed exceeds maximum size")
    return bytes(data)


async def refresh_one(feed_id: str, cfg: dict[str, str]) -> None:
    now = now_utc(); parsed = urlparse(cfg["url"])
    if parsed.scheme != "https" or parsed.hostname != "www.cyber.gov.au":
        raise RuntimeError("government feed URL failed allowlist")
    try:
        timeout = httpx.Timeout(5.0, connect=3.0)
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=False, headers={"Accept": "application/rss+xml, application/xml"}) as client:
            async with client.stream("GET", cfg["url"]) as response:
                response.raise_for_status()
                if 300 <= response.status_code < 400:
                    raise ValueError("redirect not permitted")
                raw = await _read_limited(response)
        items = parse_feed(raw, feed_id, cfg, now)
        if not items:
            raise ValueError("official feed contained no usable items")
        for item in items:
            await db.government_alerts.update_one({"feed_id": feed_id, "guid": item["guid"]}, {"$set": item}, upsert=True)
        await db.government_feed_state.update_one({"feed_id": feed_id}, {"$set": {"feed_id": feed_id, "checked_at": now, "last_success_at": now, "error": None, "item_count": len(items)}}, upsert=True)
    except (httpx.HTTPError, ValueError, ET.ParseError) as error:
        await db.government_feed_state.update_one({"feed_id": feed_id}, {"$set": {"feed_id": feed_id, "checked_at": now, "error": type(error).__name__}}, upsert=True)


async def refresh_all() -> None:
    for feed_id, cfg in FEEDS.items():
        await refresh_one(feed_id, cfg)


async def snapshot(limit: int = 50) -> dict:
    now = now_utc(); states = await db.government_feed_state.find({}, {"_id": 0}).to_list(len(FEEDS)); by_id = {row["feed_id"]: row for row in states}
    feed_states = {}
    for feed_id, cfg in FEEDS.items():
        row = by_id.get(feed_id); success = row.get("last_success_at") if row else None
        status = "unavailable" if not success else "stale" if now - success > STALE_AFTER else "fresh"
        feed_states[feed_id] = {"status": status, "source": cfg["source"], "source_url": cfg["source_url"], "last_success_at": success}
    rows = await db.government_alerts.find({}, {"_id": 0, "feed_id": 0, "guid": 0, "stored_at": 0, "expires_at": 0}).sort("published_at", -1).limit(min(limit, MAX_ITEMS)).to_list(min(limit, MAX_ITEMS))
    return {"coverage": "Configured official government feeds only — this list is not comprehensive.", "generated_at": now, "feeds": feed_states, "items": rows}