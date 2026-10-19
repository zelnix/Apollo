"""Least-privilege Learn with Higgins administration API."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from core.auth import require_admin_permission
from core.db import db, now_utc
from routers.admin import audit
from services import learning

router = APIRouter()
view = Depends(require_admin_permission("learning_content_view"))
edit = Depends(require_admin_permission("learning_content_edit"))
review = Depends(require_admin_permission("learning_content_review"))
publish = Depends(require_admin_permission("learning_content_publish"))
source_manage = Depends(require_admin_permission("learning_source_manage"))
feed_manage = Depends(require_admin_permission("learning_feed_manage"))


class ArticleIn(BaseModel):
    model_config = {"extra": "forbid"}
    slug: str | None = Field(default=None, max_length=100)
    title: str = Field(min_length=3, max_length=160)
    summary: str = Field(min_length=30, max_length=600)
    category: str = Field(min_length=2, max_length=80)
    topic: str = Field(min_length=2, max_length=120)
    audience: str = Field(default="general", max_length=80)
    language: str = Field(default="en-AU", max_length=16)
    contentType: str = Field(default="guide", max_length=40)
    riskContext: str = Field(default="general", max_length=80)
    tags: list[str] = Field(min_length=2, max_length=20)
    sections: list[dict[str, Any]] = Field(min_length=3, max_length=20)
    citations: list[dict[str, Any]] = Field(min_length=1, max_length=20)
    sourceType: str = Field(default="owner_curated", max_length=40)
    evidenceQuality: str = Field(default="official_guidance", max_length=40)
    reviewAfter: str | None = None
    status: str = "draft"


class ImportIn(BaseModel):
    sources: list[dict[str, Any]] = Field(default_factory=list, max_length=100)
    feeds: list[dict[str, Any]] = Field(default_factory=list, max_length=100)
    articles: list[dict[str, Any]] = Field(default_factory=list, max_length=500)


class CsvImportIn(BaseModel):
    csv: str = Field(min_length=10, max_length=1_000_000)


class SourceIn(BaseModel):
    sourceId: str | None = None; name: str; organisation: str; canonicalBaseUrls: list[str]; sourceType: str
    governmentAuthority: bool = False; allowedHosts: list[str]; citationDisplay: str; active: bool = True


class FeedIn(BaseModel):
    feedId: str; sourceId: str; url: str; format: str = "rss"; contentType: str = "live_alert"; language: str = "en-AU"
    parser: str = "standard"; allowedPathPrefixes: list[str] = Field(default_factory=list, max_length=20)
    refreshIntervalMinutes: int = Field(default=60, ge=15, le=1440); reviewQueuePolicy: str = "always_review"; enabled: bool = True


def actor(request: Request, supplied: str | None) -> str:
    return (supplied or (getattr(request.state, "admin", {}) or {}).get("actor") or "console")[:80]


@router.get("/learning/articles", dependencies=[view])
async def articles(status: str | None = None, review_status: str | None = None, source_id: str | None = None,
                   limit: int = Query(default=100, ge=1, le=500)):
    query: dict[str, Any] = {}
    if status: query["status"] = status
    if review_status: query["review_status"] = review_status
    if source_id: query["source_ids"] = source_id
    return await db.learning_articles.find(query, {"_id": 0}).sort("updated_at", -1).to_list(limit)


@router.get("/learning/articles/{slug}", dependencies=[view])
async def article(slug: str):
    row = await db.learning_articles.find_one({"slug": slug}, {"_id": 0})
    if not row: raise HTTPException(404, "Learning article not found")
    versions = await db.learning_article_versions.find({"slug": slug}, {"_id": 0, "snapshot": 0}).sort("version", -1).to_list(100)
    return {"article": row, "versions": versions}


@router.get("/learning/articles/{slug}/preview", dependencies=[view])
async def preview_article(slug: str):
    row = await db.learning_articles.find_one({"slug": slug}, {"_id": 0})
    if not row: raise HTTPException(404, "Learning article not found")
    return {"preview": {key: row.get(key) for key in ("slug", "title", "summary", "category", "topic", "audience", "language", "content_type", "risk_context", "tags", "sections", "citations", "source_names", "quality_checks", "status", "review_status", "review_after")}}


@router.post("/learning/articles", dependencies=[edit], status_code=201)
async def create_article(body: ArticleIn, request: Request, x_actor: str | None = Header(default=None, alias="X-Admin-Actor")):
    try: row = await learning.upsert_article(body.model_dump(mode="json"), actor(request, x_actor))
    except ValueError as exc: raise HTTPException(422, str(exc)) from exc
    await audit(request, "learning.article.create", row["slug"], {"version": row["version"]}, actor(request, x_actor)); return row


@router.put("/learning/articles/{slug}", dependencies=[edit])
async def update_article(slug: str, body: ArticleIn, request: Request, x_actor: str | None = Header(default=None, alias="X-Admin-Actor")):
    try: row = await learning.upsert_article({**body.model_dump(mode="json"), "slug": slug}, actor(request, x_actor))
    except ValueError as exc: raise HTTPException(422, str(exc)) from exc
    await audit(request, "learning.article.update", slug, {"version": row["version"]}, actor(request, x_actor)); return row


async def _move(slug: str, target: str, request: Request, supplied: str | None):
    who = actor(request, supplied)
    try: row = await learning.transition(slug, target, who)
    except LookupError as exc: raise HTTPException(404, str(exc)) from exc
    except ValueError as exc: raise HTTPException(409, str(exc)) from exc
    await audit(request, f"learning.article.{target}", slug, {"version": row["version"]}, who); return row


@router.post("/learning/articles/{slug}/review", dependencies=[review])
async def review_article(slug: str, request: Request, x_actor: str | None = Header(default=None, alias="X-Admin-Actor")): return await _move(slug, "in_review", request, x_actor)
@router.post("/learning/articles/{slug}/approve", dependencies=[review])
async def approve_article(slug: str, request: Request, x_actor: str | None = Header(default=None, alias="X-Admin-Actor")): return await _move(slug, "approved", request, x_actor)
@router.post("/learning/articles/{slug}/publish", dependencies=[publish])
async def publish_article(slug: str, request: Request, x_actor: str | None = Header(default=None, alias="X-Admin-Actor")): return await _move(slug, "published", request, x_actor)
@router.delete("/learning/articles/{slug}", dependencies=[publish])
async def archive_article(slug: str, request: Request, x_actor: str | None = Header(default=None, alias="X-Admin-Actor")): return await _move(slug, "archived", request, x_actor)


@router.post("/learning/articles/{slug}/rollback/{version}", dependencies=[publish])
async def rollback_article(slug: str, version: int, request: Request, x_actor: str | None = Header(default=None, alias="X-Admin-Actor")):
    who = actor(request, x_actor)
    try: row = await learning.restore_version(slug, version, who)
    except LookupError as exc: raise HTTPException(404, str(exc)) from exc
    await audit(request, "learning.article.rollback", slug, {"fromVersion": version, "newVersion": row["version"]}, who); return row


@router.post("/learning/import", dependencies=[edit, source_manage, feed_manage])
async def import_content(body: ImportIn, request: Request, x_actor: str | None = Header(default=None, alias="X-Admin-Actor")):
    try: result = await learning.import_package(body.model_dump(mode="json"), actor(request, x_actor))
    except ValueError as exc: raise HTTPException(422, str(exc)) from exc
    await audit(request, "learning.import", "catalogue", result, actor(request, x_actor)); return result


@router.post("/learning/import/csv", dependencies=[edit])
async def import_csv(body: CsvImportIn, request: Request, x_actor: str | None = Header(default=None, alias="X-Admin-Actor")):
    who = actor(request, x_actor)
    try: articles = learning.csv_articles(body.csv); result = await learning.import_package({"articles": articles}, who)
    except ValueError as exc: raise HTTPException(422, str(exc)) from exc
    await audit(request, "learning.import.csv", "catalogue", result, who); return result


@router.get("/learning/sources", dependencies=[view])
async def sources(): return await db.learning_sources.find({}, {"_id": 0}).sort("name", 1).to_list(500)
@router.post("/learning/sources", dependencies=[source_manage])
async def save_source(body: SourceIn, request: Request, x_actor: str | None = Header(default=None, alias="X-Admin-Actor")):
    result = await learning.import_package({"sources": [body.model_dump(mode="json")]}, actor(request, x_actor)); await audit(request, "learning.source.save", body.sourceId or body.name, result, actor(request, x_actor)); return result


@router.get("/learning/feeds", dependencies=[view])
async def feeds():
    return {"registry": await db.learning_feeds.find({}, {"_id": 0}).sort("feed_id", 1).to_list(500),
            "states": await db.learning_feed_state.find({}, {"_id": 0}).to_list(500),
            "recentRuns": await db.learning_feed_runs.find({}, {"_id": 0}).sort("started_at", -1).limit(200).to_list(200)}
@router.post("/learning/feeds", dependencies=[feed_manage])
async def save_feed(body: FeedIn, request: Request, x_actor: str | None = Header(default=None, alias="X-Admin-Actor")):
    result = await learning.import_package({"feeds": [body.model_dump(mode="json")]}, actor(request, x_actor)); await audit(request, "learning.feed.save", body.feedId, result, actor(request, x_actor)); return result
@router.post("/learning/feeds/refresh", dependencies=[feed_manage])
async def refresh_feeds(request: Request, feed_id: str | None = None, x_actor: str | None = Header(default=None, alias="X-Admin-Actor")):
    result = await learning.refresh_feeds(feed_id); await audit(request, "learning.feed.refresh", feed_id or "all", result, actor(request, x_actor)); return result
@router.post("/learning/feeds/{feed_id}/pause", dependencies=[feed_manage])
async def pause_feed(feed_id: str, request: Request, x_actor: str | None = Header(default=None, alias="X-Admin-Actor")):
    result = await db.learning_feeds.update_one({"feed_id": feed_id}, {"$set": {"enabled": False, "updated_at": now_utc(), "updated_by": actor(request, x_actor)}})
    if not result.matched_count: raise HTTPException(404, "Feed not found")
    await audit(request, "learning.feed.pause", feed_id, {}, actor(request, x_actor)); return {"enabled": False}
@router.post("/learning/feeds/{feed_id}/resume", dependencies=[feed_manage])
async def resume_feed(feed_id: str, request: Request, x_actor: str | None = Header(default=None, alias="X-Admin-Actor")):
    result = await db.learning_feeds.update_one({"feed_id": feed_id}, {"$set": {"enabled": True, "updated_at": now_utc(), "updated_by": actor(request, x_actor)}})
    if not result.matched_count: raise HTTPException(404, "Feed not found")
    await audit(request, "learning.feed.resume", feed_id, {}, actor(request, x_actor)); return {"enabled": True}


@router.get("/learning/candidates", dependencies=[review])
async def candidates(status: str = "pending", limit: int = Query(default=100, ge=1, le=500)):
    return await db.learning_candidates.find({"status": status}, {"_id": 0}).sort("created_at", -1).to_list(limit)


@router.get("/learning/review-queue", dependencies=[review])
async def review_queue(limit: int = Query(default=100, ge=1, le=500)):
    now = now_utc()
    return {"inReview": await db.learning_articles.find({"status": "in_review"}, {"_id": 0}).sort("updated_at", 1).limit(limit).to_list(limit),
            "overdue": await db.learning_articles.find({"status": "published", "review_after": {"$lte": now}}, {"_id": 0}).sort("review_after", 1).limit(limit).to_list(limit)}
@router.post("/learning/candidates/{candidate_id}/reject", dependencies=[review])
async def reject_candidate(candidate_id: str, request: Request, x_actor: str | None = Header(default=None, alias="X-Admin-Actor")):
    result = await db.learning_candidates.update_one({"candidate_id": candidate_id, "status": "pending"}, {"$set": {"status": "rejected", "reviewed_at": now_utc(), "reviewed_by": actor(request, x_actor)}})
    if not result.matched_count: raise HTTPException(404, "Candidate not found")
    await audit(request, "learning.candidate.reject", candidate_id, {}, actor(request, x_actor)); return {"status": "rejected"}


@router.post("/learning/candidates/{candidate_id}/promote", dependencies=[review, edit])
async def promote_candidate(candidate_id: str, body: ArticleIn, request: Request, x_actor: str | None = Header(default=None, alias="X-Admin-Actor")):
    candidate = await db.learning_candidates.find_one({"candidate_id": candidate_id, "status": "pending"}, {"_id": 0})
    if not candidate: raise HTTPException(404, "Candidate not found")
    who = actor(request, x_actor)
    try:
        row = await learning.upsert_article({**body.model_dump(mode="json"), "citations": [*body.citations, {"sourceId": candidate["source_id"], "label": candidate["title"], "url": candidate["url"]}]}, who)
    except ValueError as exc: raise HTTPException(422, str(exc)) from exc
    await db.learning_candidates.update_one({"candidate_id": candidate_id}, {"$set": {"status": "promoted", "article_slug": row["slug"], "reviewed_at": now_utc(), "reviewed_by": who}})
    await audit(request, "learning.candidate.promote", candidate_id, {"slug": row["slug"]}, who); return row


@router.get("/learning/console", dependencies=[view])
async def console_summary():
    return JSONResponse(jsonable_encoder({"screens": ["dashboard", "articles", "article_editor", "source_registry", "feed_registry", "feed_health", "candidate_queue", "review_queue", "preview"],
        "counts": {"articles": await db.learning_articles.count_documents({}), "published": await db.learning_articles.count_documents({"status": "published"}),
                   "reviewQueue": await db.learning_articles.count_documents({"status": "in_review"}), "candidates": await db.learning_candidates.count_documents({"status": "pending"}),
                   "sources": await db.learning_sources.count_documents({"active": True}), "feeds": await db.learning_feeds.count_documents({"enabled": True})}}))