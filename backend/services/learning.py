"""Governed Learn with Higgins catalogue, workflow, preferences, and import boundary."""
from __future__ import annotations

import csv
import io
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

from core.db import db, now_utc

WORKFLOW = {"draft": {"in_review", "archived"}, "in_review": {"draft", "approved", "archived"},
            "approved": {"draft", "published", "archived"}, "published": {"draft", "archived"}, "archived": {"draft"}}
CONTENT_TYPES = {"guide", "checklist", "explainer", "recovery", "alert_context"}
EVIDENCE_QUALITY = {"official_guidance", "official_alert", "editorial_synthesis"}


async def ensure_indexes() -> None:
    await db.learning_articles.create_index("slug", unique=True)
    await db.learning_articles.create_index([("status", 1), ("category", 1), ("title", 1)])
    await db.learning_articles.create_index([("tags", 1), ("audience", 1)])
    await db.learning_article_versions.create_index([("slug", 1), ("version", 1)], unique=True)
    await db.learning_sources.create_index("source_id", unique=True)
    await db.learning_feeds.create_index("feed_id", unique=True)
    await db.learning_candidates.create_index("fingerprint", unique=True)
    await db.learning_candidates.create_index([("status", 1), ("created_at", -1)])
    await db.learning_feed_runs.create_index([("feed_id", 1), ("started_at", -1)])
    await db.learning_preferences.create_index("owner_id", unique=True)
    await db.learning_feedback.create_index([("slug", 1), ("created_at", -1)])


def _slug(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.strip().lower()).strip("-")
    if not 3 <= len(slug) <= 100:
        raise ValueError("slug must be 3-100 URL-safe characters")
    return slug


def _tokens(value: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", value.lower())


def quality_checks(article: dict[str, Any], known_sources: set[str]) -> dict[str, Any]:
    sections = article.get("sections") or []
    text = " ".join([str(article.get("title") or ""), str(article.get("summary") or "")] +
                    [" ".join([str(section.get("heading") or ""), *map(str, section.get("paragraphs") or []), *map(str, section.get("bullets") or [])]) for section in sections if isinstance(section, dict)])
    words = _tokens(text); sentences = max(1, len(re.findall(r"[.!?]", text)))
    long_words = sum(1 for word in words if len(word) >= 10)
    reading_score = round((len(words) / sentences) + (long_words / max(1, len(words))) * 20, 1)
    prohibited = [pattern for pattern in (r"guaranteed safe", r"100% safe", r"Apollo checked this", r"cannot be hacked") if re.search(pattern, text, re.I)]
    citations = article.get("citations") or []
    citation_errors = [str(citation.get("sourceId")) for citation in citations if not isinstance(citation, dict) or citation.get("sourceId") not in known_sources or not str(citation.get("url") or "").startswith("https://")]
    completeness = {"summary": len(str(article.get("summary") or "")) >= 30, "sections": len(sections) >= 3,
                    "citations": len(citations) >= 1, "tags": len(article.get("tags") or []) >= 2,
                    "practical_actions": any(section.get("bullets") for section in sections if isinstance(section, dict))}
    passed = all(completeness.values()) and not prohibited and not citation_errors and len(words) >= 80
    return {"passed": passed, "readingLevelSignal": reading_score, "wordCount": len(words), "prohibitedPatterns": prohibited,
            "citationErrors": citation_errors, "completeness": completeness}


def _summary(row: dict[str, Any]) -> dict[str, Any]:
    return {"slug": row.get("slug"), "title": row.get("title"), "summary": row.get("summary"), "category": row.get("category"),
            "topic": row.get("topic"), "audience": row.get("audience"), "language": row.get("language"), "contentType": row.get("content_type"),
            "riskContext": row.get("risk_context"), "tags": row.get("tags", []), "sourceNames": row.get("source_names", []),
            "sourceUrls": row.get("source_urls", []), "sourceType": row.get("source_type"), "evidenceQuality": row.get("evidence_quality"),
            "publishedAt": row.get("published_at"), "updatedAt": row.get("updated_at"), "reviewAfter": row.get("review_after"),
            "reviewStatus": row.get("review_status")}


async def list_articles(category: str | None, audience: str | None, tag: str | None, risk_context: str | None,
                        content_type: str | None, language: str | None, search: str | None, cursor: str | None, limit: int) -> dict:
    query: dict[str, Any] = {"status": "published", "deleted_at": None}
    for field, value in (("category", category), ("audience", audience), ("risk_context", risk_context), ("content_type", content_type), ("language", language)):
        if value: query[field] = value
    if tag: query["tags"] = tag
    if search:
        safe = re.escape(search.strip()[:80]); query["$or"] = [{"title": {"$regex": safe, "$options": "i"}}, {"summary": {"$regex": safe, "$options": "i"}}, {"tags": {"$regex": safe, "$options": "i"}}, {"topic": {"$regex": safe, "$options": "i"}}]
    if cursor: query["slug"] = {"$gt": cursor}
    rows = await db.learning_articles.find(query, {"_id": 0, "sections": 0, "body": 0}).sort("slug", 1).limit(limit + 1).to_list(limit + 1)
    facets = await db.learning_articles.find({"status": "published", "deleted_at": None}, {"_id": 0, "category": 1, "audience": 1, "tags": 1, "risk_context": 1, "content_type": 1, "language": 1}).to_list(1000)
    def values(field: str) -> list[str]:
        return sorted({str(v) for row in facets for v in (row.get(field, []) if isinstance(row.get(field), list) else [row.get(field)]) if v})
    return {"items": [_summary(row) for row in rows[:limit]], "nextCursor": rows[limit - 1]["slug"] if len(rows) > limit else None,
            "filters": {field: values(field) for field in ("category", "audience", "tags", "risk_context", "content_type", "language")},
            "groups": values("category")}


async def get_article(slug: str) -> dict | None:
    row = await db.learning_articles.find_one({"slug": slug, "status": "published", "deleted_at": None}, {"_id": 0})
    if not row: return None
    review_after = row.get("review_after")
    if isinstance(review_after, datetime) and review_after.tzinfo is None: review_after = review_after.replace(tzinfo=timezone.utc)
    row["review_status"] = "due" if review_after and review_after <= now_utc() else row.get("review_status", "current")
    return {**_summary(row), "sections": row.get("sections", []), "citations": row.get("citations", [])}


async def article_preferences(owner: str) -> dict[str, Any]:
    row = await db.learning_preferences.find_one({"owner_id": owner}, {"_id": 0, "owner_id": 0})
    return row or {"topics": [], "audiences": [], "contentTypes": [], "updatedAt": None}


async def save_preferences(owner: str, value: dict[str, Any]) -> dict[str, Any]:
    safe = {"topics": list(dict.fromkeys(value.get("topics", [])))[:20], "audiences": list(dict.fromkeys(value.get("audiences", [])))[:10],
            "contentTypes": [item for item in dict.fromkeys(value.get("contentTypes", [])) if item in CONTENT_TYPES][:10], "updatedAt": now_utc()}
    await db.learning_preferences.update_one({"owner_id": owner}, {"$set": {"owner_id": owner, **safe}}, upsert=True)
    return safe


async def record_feedback(owner: str, slug: str, helpful: bool, reason: str | None) -> None:
    await db.learning_feedback.insert_one({"feedback_id": secrets.token_hex(12), "owner_id": owner, "slug": slug,
        "helpful": helpful, "reason": (reason or "")[:500] or None, "created_at": now_utc()})


async def sources_by_id() -> dict[str, dict[str, Any]]:
    rows = await db.learning_sources.find({"active": True}, {"_id": 0}).to_list(500)
    return {row["source_id"]: row for row in rows}


async def prepare_article(raw: dict[str, Any], *, actor: str, existing: dict[str, Any] | None = None) -> dict[str, Any]:
    now = now_utc(); source_map = await sources_by_id(); slug = _slug(str(raw.get("slug") or raw.get("title") or ""))
    citations = raw.get("citations") or []
    source_ids = list(dict.fromkeys(str(c.get("sourceId")) for c in citations if isinstance(c, dict) and c.get("sourceId")))
    review_after = raw.get("reviewAfter") or raw.get("review_after") or now + timedelta(days=180)
    if isinstance(review_after, str): review_after = datetime.fromisoformat(review_after.replace("Z", "+00:00"))
    edited_published = bool(existing and existing.get("status") == "published")
    doc = {
        "slug": slug, "title": str(raw.get("title") or "").strip()[:160], "summary": str(raw.get("summary") or "").strip()[:600],
        "category": str(raw.get("category") or "").strip()[:80], "topic": str(raw.get("topic") or "").strip()[:120],
        "audience": str(raw.get("audience") or "general")[:80], "language": str(raw.get("language") or "en-AU")[:16],
        "content_type": str(raw.get("contentType") or raw.get("content_type") or "guide")[:40],
        "risk_context": str(raw.get("riskContext") or raw.get("risk_context") or "general")[:80],
        "tags": list(dict.fromkeys(str(tag).strip().lower()[:40] for tag in raw.get("tags", []) if str(tag).strip()))[:20],
        "sections": raw.get("sections") if isinstance(raw.get("sections"), list) else [], "citations": citations,
        "source_ids": source_ids, "source_names": [source_map[s]["name"] for s in source_ids if s in source_map],
        "source_urls": [str(c.get("url")) for c in citations if isinstance(c, dict) and c.get("url")],
        "source_type": str(raw.get("sourceType") or raw.get("source_type") or "owner_curated")[:40],
        "evidence_quality": str(raw.get("evidenceQuality") or raw.get("evidence_quality") or "official_guidance")[:40],
        "status": "draft" if edited_published else str((existing or {}).get("status") or "draft"),
        "review_status": "pending" if edited_published else str((existing or {}).get("review_status") or "pending"),
        "review_after": review_after, "published_at": None if edited_published else (existing or {}).get("published_at"),
        "published_by": None if edited_published else (existing or {}).get("published_by"),
        "updated_at": now, "updated_by": actor[:80], "deleted_at": None,
    }
    if not doc["title"] or not doc["summary"] or not doc["category"] or doc["content_type"] not in CONTENT_TYPES or doc["evidence_quality"] not in EVIDENCE_QUALITY:
        raise ValueError("article metadata is incomplete or unsupported")
    doc["quality_checks"] = quality_checks(doc, set(source_map))
    return doc


async def save_version(doc: dict[str, Any], actor: str, action: str) -> int:
    latest = await db.learning_article_versions.find_one({"slug": doc["slug"]}, {"_id": 0, "version": 1}, sort=[("version", -1)])
    version = int((latest or {}).get("version", 0)) + 1
    await db.learning_article_versions.insert_one({"slug": doc["slug"], "version": version, "snapshot": doc,
        "actor": actor[:80], "action": action, "created_at": now_utc()})
    return version


async def upsert_article(raw: dict[str, Any], actor: str, *, import_mode: bool = False) -> dict[str, Any]:
    slug = _slug(str(raw.get("slug") or raw.get("title") or "")); existing = await db.learning_articles.find_one({"slug": slug}, {"_id": 0})
    doc = await prepare_article({**raw, "slug": slug}, actor=actor, existing=existing)
    if import_mode and doc["status"] not in {"draft", "in_review"}: doc["status"] = "draft"
    version = await save_version(doc, actor, "import" if import_mode else "edit")
    doc["version"] = version; doc.setdefault("created_at", (existing or {}).get("created_at", now_utc()))
    await db.learning_articles.update_one({"slug": slug}, {"$set": doc}, upsert=True)
    return await db.learning_articles.find_one({"slug": slug}, {"_id": 0})


async def transition(slug: str, target: str, actor: str) -> dict[str, Any]:
    row = await db.learning_articles.find_one({"slug": slug, "deleted_at": None}, {"_id": 0})
    if not row: raise LookupError("article not found")
    if target not in WORKFLOW.get(row["status"], set()): raise ValueError(f"cannot move {row['status']} to {target}")
    if target in {"approved", "published"}:
        checks = quality_checks(row, set(await sources_by_id()))
        if not checks["passed"]: raise ValueError("quality checks must pass before approval or publication")
    now = now_utc(); changes: dict[str, Any] = {"status": target, "updated_at": now, "updated_by": actor[:80]}
    if target == "in_review": changes.update({"review_status": "in_review", "reviewed_by": None, "reviewed_at": None})
    if target == "approved": changes.update({"review_status": "approved", "reviewed_by": actor[:80], "reviewed_at": now})
    if target == "published": changes.update({"published_at": now, "published_by": actor[:80], "review_status": "current"})
    if target == "archived": changes.update({"deleted_at": now, "review_status": "archived"})
    await db.learning_articles.update_one({"slug": slug}, {"$set": changes})
    updated = await db.learning_articles.find_one({"slug": slug}, {"_id": 0}); updated["version"] = await save_version(updated, actor, target)
    await db.learning_articles.update_one({"slug": slug}, {"$set": {"version": updated["version"]}})
    return updated


async def restore_version(slug: str, version: int, actor: str) -> dict[str, Any]:
    current = await db.learning_articles.find_one({"slug": slug}, {"_id": 0})
    archived = await db.learning_article_versions.find_one({"slug": slug, "version": version}, {"_id": 0})
    if not current or not archived: raise LookupError("article or version not found")
    snapshot = {**archived["snapshot"], "status": "draft", "review_status": "pending", "published_at": None,
                "published_by": None, "updated_at": now_utc(), "updated_by": actor[:80], "deleted_at": None}
    next_version = await save_version(snapshot, actor, f"rollback_from_{version}"); snapshot["version"] = next_version
    await db.learning_articles.replace_one({"slug": slug}, snapshot)
    return snapshot


async def import_package(payload: dict[str, Any], actor: str) -> dict[str, int]:
    source_count = feed_count = article_count = 0
    for raw in payload.get("sources", []):
        source_id = _slug(str(raw.get("sourceId") or raw.get("name") or ""))
        doc = {"source_id": source_id, "name": str(raw.get("name") or "")[:160], "organisation": str(raw.get("organisation") or "")[:160],
               "canonical_base_urls": [str(v)[:1000] for v in raw.get("canonicalBaseUrls", [])][:20], "source_type": str(raw.get("sourceType") or "official_guidance")[:40],
               "government_authority": bool(raw.get("governmentAuthority")), "allowed_hosts": [str(v).lower()[:253] for v in raw.get("allowedHosts", [])][:30],
               "citation_display": str(raw.get("citationDisplay") or raw.get("name") or "")[:160], "active": bool(raw.get("active", True)),
               "updated_at": now_utc(), "updated_by": actor[:80]}
        if not doc["name"] or not doc["canonical_base_urls"] or not doc["allowed_hosts"]: raise ValueError(f"source {source_id} is incomplete")
        await db.learning_sources.update_one({"source_id": source_id}, {"$set": doc, "$setOnInsert": {"created_at": now_utc()}}, upsert=True); source_count += 1
    for raw in payload.get("feeds", []):
        feed_id = _slug(str(raw.get("feedId") or "")); source_id = _slug(str(raw.get("sourceId") or ""))
        if not await db.learning_sources.find_one({"source_id": source_id, "active": True, "government_authority": True}): raise ValueError(f"feed {feed_id} requires an active government source")
        doc = {"feed_id": feed_id, "source_id": source_id, "url": str(raw.get("url") or "")[:1500], "format": str(raw.get("format") or "rss")[:20],
               "content_type": str(raw.get("contentType") or "live_alert")[:40], "language": str(raw.get("language") or "en-AU")[:16],
               "parser": str(raw.get("parser") or "standard")[:40], "refresh_interval_minutes": max(15, min(int(raw.get("refreshIntervalMinutes") or 60), 1440)),
               "allowed_path_prefixes": [str(value)[:300] for value in raw.get("allowedPathPrefixes", [])][:20],
               "review_queue_policy": str(raw.get("reviewQueuePolicy") or "always_review")[:40], "trust_status": "recognised_government",
               "enabled": bool(raw.get("enabled", True)), "updated_at": now_utc(), "updated_by": actor[:80]}
        await db.learning_feeds.update_one({"feed_id": feed_id}, {"$set": doc, "$setOnInsert": {"created_at": now_utc()}}, upsert=True); feed_count += 1
    for raw in payload.get("articles", []):
        await upsert_article(raw, actor, import_mode=True); article_count += 1
    return {"sources": source_count, "feeds": feed_count, "articles": article_count}


def csv_articles(raw: str) -> list[dict[str, Any]]:
    values = []
    for row in csv.DictReader(io.StringIO(raw)):
        values.append({**row, "tags": [tag.strip() for tag in row.get("tags", "").split("|") if tag.strip()],
                       "sections": [{"heading": "Guidance", "paragraphs": [row.get("body", "")], "bullets": []}],
                       "citations": [{"sourceId": row.get("source_id"), "url": row.get("source_url"), "label": row.get("source_name")} ]})
    return values


async def refresh_feeds(feed_id: str | None = None) -> dict:
    from services import learning_feeds
    return await learning_feeds.refresh_selected(feed_id)