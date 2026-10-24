"""Feed Health: sync status of every enabled government feed, judged against one 24-hour rule.

healthy — the latest sync attempt succeeded and the last success is under 24 hours old
stale   — no successful sync in the last 24 hours (including a feed that has never synced)
failing — the latest sync attempt failed; its error is shown in plain words
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from core.db import db, now_utc
from services import government_alerts

STALE_AFTER = timedelta(hours=24)
_ORDER = {"failing": 0, "stale": 1, "healthy": 2}

# Our own rejection reasons (stored as error_detail) and OutboundBlocked codes, in plain words.
_DETAIL_MESSAGES = {
    "dns_failed": "Apollo couldn't find the source's web address. The site may be down or renamed.",
    "private_target": "The source's address pointed somewhere Apollo won't connect to, so the sync was stopped.",
    "invalid_target": "The feed address isn't a valid web address.",
    "body_too_large": "The source sent more data than Apollo accepts.",
    "encoded_body_not_supported": "The source sent its feed in a format Apollo doesn't accept.",
    "feed URL outside source allowlist": "The feed address is outside the source's approved websites.",
    "feed redirect escaped source allowlist": "The source redirected Apollo to a website that isn't approved.",
    "feed response rejected": "The source answered, but not with a usable feed (an error page, the wrong format, or too much data).",
    "HTML source was not explicitly approved": "This web page hasn't been approved as a feed.",
}
_CODE_MESSAGES = {
    "SourceUnavailable": "This feed's government source is switched off or no longer recognised.",
    "FeedRefreshFailure": "The sync stopped unexpectedly.",
    "OutboundBlocked": "Apollo's safety checks refused the connection to this source.",
    "ValueError": "The source answered, but its response didn't pass Apollo's checks.",
    "ConnectTimeout": "The source took too long to answer.",
    "ReadTimeout": "The source took too long to answer.",
    "WriteTimeout": "The source took too long to answer.",
    "PoolTimeout": "The source took too long to answer.",
    "TimeoutException": "The source took too long to answer.",
    "TimeoutError": "The source took too long to answer.",
    "ConnectError": "Apollo couldn't connect to the source.",
    "ReadError": "The source closed the connection before the sync finished.",
    "RemoteProtocolError": "The source closed the connection before the sync finished.",
    "ParseError": "The source sent a feed Apollo couldn't read.",
    "JSONDecodeError": "The source sent a feed Apollo couldn't read.",
}


def _aware(value: datetime | None) -> datetime | None:
    return value.replace(tzinfo=timezone.utc) if value and value.tzinfo is None else value


def classify(state: dict | None, now: datetime) -> str:
    if state and state.get("status") == "unavailable":
        return "failing"
    success = _aware(state.get("last_success_at")) if state else None
    return "healthy" if success and now - success <= STALE_AFTER else "stale"


def error_message(code: str | None, detail: str | None) -> str:
    if detail and detail in _DETAIL_MESSAGES:
        return _DETAIL_MESSAGES[detail]
    return _CODE_MESSAGES.get(code or "", f"The last sync failed ({code or 'unknown error'}).")


async def snapshot() -> dict:
    now = now_utc()
    feeds = await db.learning_feeds.find({"enabled": True}, {"_id": 0}).to_list(100)
    states = {row["feed_id"]: row for row in await db.learning_feed_state.find({}, {"_id": 0}).to_list(500)}
    sources = {row["source_id"]: row for row in await db.learning_sources.find({"source_id": {"$in": [f["source_id"] for f in feeds]}}, {"_id": 0}).to_list(100)}
    rows = []
    for feed in feeds:
        state = states.get(feed["feed_id"])
        status = classify(state, now)
        code = state.get("error") if status == "failing" else None
        rows.append({
            "feedId": feed["feed_id"],
            "source": government_alerts._source_name(feed["source_id"], sources.get(feed["source_id"], {}).get("name")),
            "feedUrl": feed["url"],
            "contentType": feed["content_type"],
            "status": status,
            "lastSuccessAt": _aware(state.get("last_success_at")) if state else None,
            "lastCheckedAt": _aware(state.get("last_checked_at")) if state else None,
            "recordCount": state.get("item_count") if state else None,
            "lastError": {"message": error_message(code, state.get("error_detail")), "code": code,
                          "detail": state.get("error_detail"), "at": _aware(state.get("last_checked_at"))} if code else None,
        })
    rows.sort(key=lambda row: (_ORDER[row["status"]], row["source"].lower()))
    summary = {key: sum(row["status"] == key for row in rows) for key in _ORDER}
    return {"generatedAt": now, "staleAfterHours": int(STALE_AFTER.total_seconds() // 3600),
            "summary": {**summary, "total": len(rows)}, "feeds": rows}
