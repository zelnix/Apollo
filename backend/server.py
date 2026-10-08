"""Apollo V1 backend — application entry point (`uvicorn server:app`).

Privacy posture:
- Explicit checks may use user-submitted text, links, chosen screenshots or mailbox items for one
  disclosed, purpose-limited assessment. Request-scoped raw copies are not persisted by Apollo.
- Credentials and secret URL parameters are removed before processing; outbound page fetches are bounded and SSRF-safe.
- Patrol receives only sanitised summaries/evidence, and reputation caches store HMAC digests rather than raw indicators.

Layout (Hardening Gate step 4 — split of the former monolith, zero behaviour change):
- core/      config (env), db (Motor + document base), models (shared schemas), auth (device bearer + admin key)
- services/  intel (blocklist, Safe Browsing, cache, redirects), email (guardian invitations)
- routers/   one APIRouter per domain; all mounted under /api behind `enforce_device_auth`, except
             routers/admin (mounted under /api/admin behind `require_admin_key`).
"""
from __future__ import annotations

import asyncio
import os
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from starlette.middleware.cors import CORSMiddleware

from core.auth import enforce_device_auth, require_admin_key
from core.config import ADMIN_HEADER, logger
from core.db import client, db, now_utc
from core.models import BlocklistEntry
from core.privacy_boundary import PrivacyBoundary
from services.patrol_policy import ensure_evidence_receipt_indexes
from services import patrol_records
from services.mailbox_monitor import ensure_indexes as ensure_mailbox_monitor_indexes, supervise_mailbox_monitor
from services.maintenance import ensure_indexes as ensure_maintenance_indexes, supervise_maintenance
from services.higgins.retention import migrate_and_index
from services.higgins import repository as investigation_repository
from services.higgins import report_store
from services import system_health_jobs
from services.higgins import context as higgins_context
from services import capability_registry, government_alerts, learning
from services import gmail as gmail_service
from services import family_assist
from routers import admin, analysis, ask, call, devices, family, family_assist as family_assist_router, family_weekly, gmail, health, intel, investigations, learning as learning_router, learning_admin, patrol, product, push, voice
from routers.family_weekly import weekly_checkin_loop

SEED_BLOCKLIST = [
    ("testsafebrowsing.appspot.com", "SOCIAL_ENGINEERING", "Google Safe Browsing public test pages"),
    ("malware.testing.google.test", "MALWARE", "Google malware test domain"),
    ("phishing.apollo.test", "SOCIAL_ENGINEERING", "Apollo internal phishing test domain"),
    ("malware.apollo.test", "MALWARE", "Apollo internal malware test domain"),
]


@asynccontextmanager
async def lifespan(_: FastAPI):
    await migrate_and_index()
    await investigation_repository.ensure_indexes()
    await report_store.ensure_indexes()
    await system_health_jobs.ensure_indexes()
    await higgins_context.ensure_indexes()
    await government_alerts.ensure_indexes()
    await learning.ensure_indexes()
    try:
        await learning.seed_catalogue_sources_feeds()
    except Exception:  # noqa: BLE001 — seeding must never block startup
        pass
    await capability_registry.ensure_indexes()
    await investigation_repository.backfill_work_epochs()
    await ensure_maintenance_indexes()
    await ensure_mailbox_monitor_indexes()
    await push.ensure_indexes()
    await family_assist.ensure_indexes()
    await db.devices.create_index("device_id", unique=True)
    await db.devices.create_index("token_hash", unique=True, partialFilterExpression={"token_hash": {"$type": "string"}})
    await db.reputation_cache.create_index("indicator_digest", unique=True)
    await db.reputation_cache.create_index("expires_at")  # plain index; expiry is checked at read time, never auto-deleted
    await db.domain_info_cache.create_index("domain", unique=True)
    await db.domain_info_cache.create_index("expires_at")  # plain index; expiry is checked at read time, never auto-deleted
    # Multi-account: one row per (device, Gmail account). Drop the legacy device_id-unique index
    # (it capped a device to a single account) and migrate to a compound unique index.
    try:
        existing = await db.gmail_connections.index_information()
        if "device_id_1" in existing and not existing["device_id_1"].get("key") == [("device_id", 1), ("email", 1)]:
            await db.gmail_connections.drop_index("device_id_1")
    except Exception as exc:  # noqa: BLE001
        logger.info("gmail index migration skipped: %s", type(exc).__name__)
    # Backfill: legacy rows without an email get a placeholder so the compound index accepts them.
    await db.gmail_connections.update_many({"email": {"$exists": False}}, {"$set": {"email": ""}})
    await db.gmail_connections.create_index([("device_id", 1), ("email", 1)], unique=True)
    # Legacy: cleanup_unreadable_connections was removed from automatic startup
    # to avoid destroying user data in production. If cleanup is needed, run it
    # as an explicit admin operation.
    # OAuth state index migration — tolerant of first-deploy (empty collection) and Atlas environments.
    try:
        oauth_indexes = await db.gmail_oauth_states.index_information()
        for index_name, definition in oauth_indexes.items():
            if definition.get("key") == [("state", 1)]:
                await db.gmail_oauth_states.drop_index(index_name)
                continue
            if definition.get("key") == [("expires_at", 1)] and definition.get("partialFilterExpression") != {"retention_class": "oauth_csrf_temporary"}:
                await db.gmail_oauth_states.drop_index(index_name)
        # Legacy records without state_digest are left in place; they'll expire via TTL index.
        # Destructive delete_many removed: production deploys must not delete existing OAuth state records.
        pass
    except Exception:  # noqa: BLE001
        logger.warning("OAuth state index migration skipped (first deploy or index already migrated)")
    await db.gmail_oauth_states.create_index("state_digest", unique=True)
    # Plain index on expires_at; expiry is checked at read time, never auto-deleted.
    # A TTL index (expireAfterSeconds=0) would hard-delete OAuth CSRF state records
    # automatically, which is destructive on deployment restarts.
    # Migration: the old TTL index "oauth_csrf_expiry_ttl" must be dropped first
    # because MongoDB rejects a new index on the same key+filter with different options.
    try:
        await db.gmail_oauth_states.drop_index("oauth_csrf_expiry_ttl")
        logger.info("Dropped legacy TTL index oauth_csrf_expiry_ttl")
    except Exception:  # noqa: BLE001
        pass  # Index doesn't exist (first deploy or already migrated)
    await db.gmail_oauth_states.create_index("expires_at",
                                              name="oauth_csrf_expiry_plain",
                                              partialFilterExpression={"retention_class": "oauth_csrf_temporary"})
    # Generic IMAP credentials are no longer accepted or written. Legacy rows are retained for an explicit,
    # audited migration rather than destructively dropping user data on every process start.
    await db.mailbox_assessment_receipts.create_index([("provider", 1), ("device_id", 1), ("message_digest", 1)], unique=True)
    await db.phone_risk_cache.create_index("phone_e164", unique=True)
    await db.patrol_events.create_index([("device_id", 1), ("event_id", 1)], unique=True)
    await ensure_evidence_receipt_indexes()
    await patrol_records.ensure_indexes()
    await db.trust_entries.create_index("trust_id", unique=True)
    await db.ask_messages.create_index([("device_id", 1), ("created_at", 1)])
    await db.ask_handoffs.create_index([("device_id", 1), ("handoff_id", 1)], unique=True)
    await db.blocklist.create_index("host", unique=True)
    await db.admin_audit.create_index([("at", -1)])
    await db.incident_notes.create_index("note_id")
    await db.family_audio_cleanup.create_index("cleanup_id", unique=True)
    await db.incident_notes.create_index([("guardian_device_id", 1), ("protected_device_id", 1), ("submission_id", 1)], unique=True,
                                         partialFilterExpression={"submission_id": {"$type": "string"}})
    for host, threat, reason in SEED_BLOCKLIST:
        entry = BlocklistEntry(host=host, threat_type=threat, reason=reason, added_at=now_utc())
        await db.blocklist.update_one({"host": host}, {"$setOnInsert": entry.to_mongo()}, upsert=True)
    loop_task = asyncio.create_task(weekly_checkin_loop())
    mailbox_task = asyncio.create_task(supervise_mailbox_monitor(), name="apollo-mailbox-supervisor")
    async def government_alert_loop():
        while True:
            try:
                await government_alerts.refresh_all()
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001
                logger.warning("government alert refresh failed")
            await asyncio.sleep(3600)
    government_alert_task = asyncio.create_task(government_alert_loop(), name="apollo-government-alerts")
    async def family_assist_loop():
        while True:
            try:
                await family_assist.maintenance_once()
            except asyncio.CancelledError:
                raise
            except Exception:  # no session/media payload logging
                logger.warning("family assist maintenance failed")
            await asyncio.sleep(15)
    family_assist_task = asyncio.create_task(family_assist_loop(), name="apollo-family-assist")
    async def push_receipt_loop():
        while True:
            try:
                await push.reconcile_receipts()
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001
                logger.warning("push receipt reconciliation failed")
            await asyncio.sleep(300)

    receipts_task = asyncio.create_task(push_receipt_loop())
    maintenance_task = asyncio.create_task(supervise_maintenance(), name="apollo-maintenance-supervisor")
    yield
    maintenance_task.cancel()
    receipts_task.cancel()
    loop_task.cancel()
    mailbox_task.cancel()
    government_alert_task.cancel()
    family_assist_task.cancel()
    await asyncio.gather(maintenance_task, receipts_task, loop_task, mailbox_task, government_alert_task, family_assist_task, return_exceptions=True)
    client.close()


app = FastAPI(title="Apollo V1 API", lifespan=lifespan)
app.add_middleware(PrivacyBoundary)


@app.exception_handler(HTTPException)
async def typed_failure_handler(request: Request, exc: HTTPException):
    """Investigation routes raise the spec's `{"error": Failure}` body; legacy routes keep FastAPI's `{"detail": ...}`."""
    body = exc.detail if isinstance(exc.detail, dict) and "error" in exc.detail else {"detail": exc.detail}
    headers = dict(exc.headers or {})
    if request.url.path.startswith("/api/health/"):
        headers["Cache-Control"] = "no-store"
    return JSONResponse(body, status_code=exc.status_code, headers=headers)


@app.get("/health", include_in_schema=False)
async def deployment_health():
    """Root liveness probe for the deployment platform (unauthenticated, no DB). Device-facing health stays at /api/health."""
    return {"status": "ok"}


# Every device-facing router is mounted under /api behind the device bearer gate (public paths are listed in core.auth).
for r in (health, devices, intel, patrol, investigations, ask, learning_router, product, family, family_assist_router, family_weekly, voice, push, analysis, gmail, call):
    app.include_router(r.router, prefix="/api", dependencies=[Depends(enforce_device_auth)])
app.include_router(family_assist_router.ws_router, prefix="/api")
app.include_router(admin.router, prefix="/api/admin", tags=["admin"], dependencies=[Depends(require_admin_key)])
app.include_router(learning_admin.router, prefix="/api/admin", tags=["learning-admin"], dependencies=[Depends(require_admin_key)])

# GuardDog production trust endpoints (unauthenticated — public trust artifacts and controlled verification).
from routers import guarddog as guarddog_router
app.include_router(guarddog_router.router)

# CORS is not authentication (bearer tokens do that). The web preview is same-origin (/api on the same host), and native
# apps don't use CORS, so only explicitly configured browser origins are allowed (add the admin console's origin here).
_cors_origins = [o.strip() for o in os.environ.get("CORS_ORIGINS", "").split(",") if o.strip()]
app.add_middleware(CORSMiddleware, allow_credentials=False, allow_origins=_cors_origins, allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"], allow_headers=["Authorization", "Content-Type", "Accept", "Idempotency-Key", ADMIN_HEADER, "X-Admin-Actor"])
