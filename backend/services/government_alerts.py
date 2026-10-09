"""Consumer snapshot for reviewed-source government alerts with explicit freshness."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from core.db import db, now_utc
from services import learning_feeds, scam_analysis, scam_intel

STALE_AFTER = timedelta(hours=6)

# Display names for official sources whose stored name is an unexplained acronym. Apollo never shows a
# bare acronym to the person — the full authority name is spelled out (abbreviation kept in brackets).
SOURCE_DISPLAY_NAME = {
    "ncsc-uk": "UK National Cyber Security Centre",
    "ic3": "FBI Internet Crime Complaint Center (IC3)",
    "enisa": "European Union Agency for Cybersecurity (ENISA)",
}


def _source_name(source_id: str, fallback: str | None) -> str:
    return SOURCE_DISPLAY_NAME.get(source_id, fallback or source_id)


def _aware(value: datetime | None) -> datetime | None:
    return value.replace(tzinfo=timezone.utc) if value and value.tzinfo is None else value


async def ensure_indexes() -> None:
    await db.learning_feed_items.create_index("fingerprint", unique=True)
    await db.learning_feed_items.create_index("expires_at", expireAfterSeconds=0)
    await db.learning_feed_state.create_index("feed_id", unique=True)


async def refresh_all() -> None:
    await learning_feeds.refresh_due()
    try:
        from services import scam_analysis
        await scam_analysis.analyze_pending(limit=25)
    except Exception:  # noqa: BLE001 — analysis is best-effort; ingestion must never fail because of it
        pass


RECENCY_CUTOFF = timedelta(days=455)  # ~15 months: a specific alert older than this is not "recent"


def _parse_reported(value: str | None) -> datetime | None:
    """Parse the AI's structured reportedDate ('YYYY-MM-DD' or 'YYYY-MM') into an aware datetime."""
    value = (value or "").strip()
    for fmt in ("%Y-%m-%d", "%Y-%m"):
        try:
            return datetime.strptime(value, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def _month_year(dt: datetime | None) -> str:
    return dt.strftime("%B %Y") if dt else "Date not stated"


def _alert(row: dict, source: dict, analysis: dict, now: datetime) -> dict:
    """Build one consumer alert from a feed item + its cached AI analysis. Only facts the analysis
    extracted from the source are shown; nothing is invented here."""
    published = _aware(row.get("published_at"))
    reported = _parse_reported(analysis.get("reportedDate"))
    effective = published or reported  # when this specific scam was reported
    region = scam_intel.region_for(row["source_id"])
    sections = analysis.get("sections") or {}
    severity = analysis.get("severity", "LOW")
    relevance = analysis.get("australianRelevance", "unknown")
    source_name = _source_name(row["source_id"], source.get("name"))
    fresh = bool(effective and (now - effective) <= RECENCY_CUTOFF)
    # A specific High/Extreme campaign growls when there's real Australian exposure. Confirmed-AU campaigns
    # growl regardless of date (official AU sources are often undated listings); overseas "potential"
    # techniques must still be recent so a stale overseas bulletin can't hold Apollo growling.
    growling = (analysis.get("tier") == "specific_scam" and severity in ("HIGH", "EXTREME")
                and (relevance == "confirmed" or (relevance == "potential" and fresh)))
    higgins = {
        "whatHappened": sections.get("whatHappened") or (row.get("summary") or row.get("title") or ""),
        "whyGrowling": analysis.get("severityReason") or "",
        "whereHappening": sections.get("whereHappening") or "",
        "whatItMeansForAustralia": sections.get("whatItMeansForYou") or "",
        "whatToWatch": sections.get("whatToWatch") or "",
        "whatToDo": sections.get("whatToDo") or "",
        "source": source_name,
        "publishedAt": (published or reported).isoformat() if (published or reported) else None,
        "dateLabel": _month_year(effective),
        "url": row.get("url"),
    }
    return {
        "title": row["title"], "url": row["url"], "summary": row["summary"], "source": source_name,
        "sourceUrl": (source.get("canonical_base_urls") or [None])[0], "sourceType": row["content_type"], "sourceTrust": row["trust_status"],
        "publishedAt": published, "updatedAt": _aware(row.get("updated_at")), "lastCheckedAt": _aware(row["last_checked_at"]),
        "reportedDate": analysis.get("reportedDate") or "", "effectiveDate": effective, "dateLabel": _month_year(effective),
        "ageLabel": _month_year(effective),
        "region": region, "regionLabel": scam_intel.REGION_LABEL.get(region, region),
        "tier": analysis.get("tier", "general_education"), "facts": analysis.get("facts") or {},
        "severity": severity, "severityReason": analysis.get("severityReason") or "", "severityConfidence": analysis.get("confidence") or "low",
        "sourceSeverity": row.get("source_severity"),
        "australianRelevance": relevance, "australianRelevanceReason": analysis.get("australianRelevanceReason") or "",
        "growling": growling, "higgins": higgins,
    }


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
        feed_states[feed["feed_id"]] = {"status": status, "source": _source_name(feed["source_id"], source.get("name")), "sourceUrl": (source.get("canonical_base_urls") or [None])[0],
            "sourceType": feed["content_type"], "lastSuccessAt": success, "lastCheckedAt": _aware(row.get("last_checked_at")) if row else None,
            "errorType": row.get("error") if latest_failed else None}
    # Scan a wide window of items (not just `limit`) so a consumer alert with no publish date but a
    # recent reported date is never hidden behind more-recent general-education items; `limit` caps OUTPUT.
    rows = await db.learning_feed_items.find({}, {"_id": 0, "fingerprint": 0, "candidate_id": 0, "expires_at": 0}).sort("published_at", -1).limit(200).to_list(200)
    alerts: list[dict] = []; emerging: list[dict] = []; pending = 0; stale = 0
    for row in rows:
        analysis = row.get("scam_analysis")
        if not analysis or analysis.get("analysisVersion") != scam_analysis.ANALYSIS_VERSION:
            pending += 1  # not yet analysed — never shown as a scam alert until its facts are verified
            continue
        source = sources.get(row["source_id"], {})
        built = _alert(row, source, analysis, now)
        # Only recent reports belong in the feed: drop specific/emerging items whose stated date is older
        # than the recency cutoff. Items with no determinable date are kept (staleness can't be proven).
        if built["effectiveDate"] and (now - built["effectiveDate"]) > RECENCY_CUTOFF:
            stale += 1
            continue
        if built["tier"] == "specific_scam":
            alerts.append(built)
        elif built["tier"] == "emerging_pattern":
            emerging.append(built)
        # general_education is intentionally excluded from the alerts feed (it belongs in Learn with Higgins).
    # Most recent first; undated items sort last.
    _key = lambda it: it["effectiveDate"] or datetime.min.replace(tzinfo=timezone.utc)
    alerts.sort(key=_key, reverse=True); emerging.sort(key=_key, reverse=True)
    alerts = alerts[:limit]; emerging = emerging[:limit]
    growling = next((it for it in alerts if it["growling"]), None)
    last_analysed = max((_aware(r.get("scam_analysis", {}).get("analyzedAt")) for r in rows if r.get("scam_analysis")), default=None)
    last_sourced = max((v.get("lastSuccessAt") for v in feed_states.values() if v.get("lastSuccessAt")), default=None)
    return {"coverage": "Specific scam campaigns reported by recognised government and official cyber-authority sources (Australia, USA, UK, EU), each read and explained from the source itself. General scam education lives in Learn with Higgins.",
            "generatedAt": now, "feeds": feed_states, "alerts": alerts, "emerging": emerging, "pendingCount": pending,
            "lastAnalysedAt": last_analysed, "lastSourcedAt": last_sourced, "growling": growling}