"""Consumer snapshot for reviewed-source government alerts with explicit freshness."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from core.db import db, now_utc
from services import learning_feeds

STALE_AFTER = timedelta(hours=6)


def _aware(value: datetime | None) -> datetime | None:
    return value.replace(tzinfo=timezone.utc) if value and value.tzinfo is None else value


async def ensure_indexes() -> None:
    await db.learning_feed_items.create_index("fingerprint", unique=True)
    await db.learning_feed_items.create_index("expires_at", expireAfterSeconds=0)
    await db.learning_feed_state.create_index("feed_id", unique=True)


async def refresh_all() -> None:
    await learning_feeds.refresh_due()


async def snapshot(limit: int = 50) -> dict:
    now = now_utc(); feeds = await db.learning_feeds.find({"enabled": True}, {"_id": 0}).to_list(100)
    source_ids = {row["source_id"] for row in feeds}; sources = {row["source_id"]: row for row in await db.learning_sources.find({"source_id": {"$in": list(source_ids)}}, {"_id": 0}).to_list(100)}
    states = {row["feed_id"]: row for row in await db.learning_feed_state.find({}, {"_id": 0}).to_list(100)}
    feed_states = {}
    for feed in feeds:
        row = states.get(feed["feed_id"]); success = _aware(row.get("last_success_at")) if row else None
        latest_failed = bool(row and row.get("status") == "unavailable")
        status = "unavailable" if not success else "stale" if latest_failed or now - success > STALE_AFTER else "fresh"
        source = sources.get(feed["source_id"], {})
        feed_states[feed["feed_id"]] = {"status": status, "source": source.get("name"), "sourceUrl": (source.get("canonical_base_urls") or [None])[0],
            "sourceType": feed["content_type"], "lastSuccessAt": success, "lastCheckedAt": _aware(row.get("last_checked_at")) if row else None,
            "errorType": row.get("error") if latest_failed else None}
    rows = await db.learning_feed_items.find({}, {"_id": 0, "fingerprint": 0, "candidate_id": 0, "expires_at": 0}).sort("published_at", -1).limit(min(limit, 100)).to_list(min(limit, 100))
    items = []
    for row in rows:
        source = sources.get(row["source_id"], {}); published = _aware(row.get("published_at"))
        items.append({"title": row["title"], "url": row["url"], "summary": row["summary"], "source": source.get("name"),
            "sourceUrl": (source.get("canonical_base_urls") or [None])[0], "sourceType": row["content_type"], "sourceTrust": row["trust_status"],
            "publishedAt": published, "updatedAt": _aware(row.get("updated_at")), "lastCheckedAt": _aware(row["last_checked_at"]),
            "ageLabel": "Official advice" if row["content_type"] == "official_advice" or not published else "Today" if now.date() == published.date() else f"{max(1, (now.date() - published.date()).days)} days ago"})
    return {"coverage": "Configured recognised Australian government sources only. Feed candidates never publish learning articles without human review.",
            "generatedAt": now, "feeds": feed_states, "items": items}