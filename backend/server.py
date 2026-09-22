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
from services.mailbox_monitor import mailbox_monitor_loop
from services.higgins.retention import migrate_and_index, sweep_loop
from services.higgins import jobs as investigation_jobs
from services.higgins import repository as investigation_repository
from routers import admin, analysis, ask, call, devices, family, family_weekly, gmail, health, intel, investigations, patrol, push, voice
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
    await investigation_repository.backfill_work_epochs()
    await push.ensure_indexes()
    await db.devices.create_index("device_id", unique=True)
    await db.devices.create_index("token_hash", unique=True, partialFilterExpression={"token_hash": {"$type": "string"}})
    await db.reputation_cache.create_index("indicator_digest", unique=True)
    await db.reputation_cache.create_index("expires_at")  # plain index; expiry is checked at read time, never auto-deleted
    await db.domain_info_cache.create_index("domain", unique=True)
    await db.domain_info_cache.create_index("expires_at")  # plain index; expiry is checked at read time, never auto-deleted
    await db.gmail_connections.create_index("device_id", unique=True)
    await db.gmail_oauth_states.create_index("state", unique=True)
    await db.gmail_oauth_states.create_index("expires_at", expireAfterSeconds=0)  # real TTL cleanup — these are short-lived CSRF tokens, not a security "truth" cache
    # Generic IMAP credentials are no longer accepted or written. Legacy rows are retained for an explicit,
    # audited migration rather than destructively dropping user data on every process start.
    await db.mailbox_assessment_receipts.create_index([("provider", 1), ("device_id", 1), ("message_digest", 1)], unique=True)
    await db.phone_risk_cache.create_index("phone_e164", unique=True)
    await db.patrol_events.create_index([("device_id", 1), ("event_id", 1)], unique=True)
    await ensure_evidence_receipt_indexes()
    await db.trust_entries.create_index("trust_id", unique=True)
    await db.ask_messages.create_index([("device_id", 1), ("created_at", 1)])
    await db.ask_handoffs.create_index([("device_id", 1), ("handoff_id", 1)], unique=True)
    await db.blocklist.create_index("host", unique=True)
    await db.admin_audit.create_index([("at", -1)])
    await db.incident_notes.create_index("note_id")
    for host, threat, reason in SEED_BLOCKLIST:
        entry = BlocklistEntry(host=host, threat_type=threat, reason=reason, added_at=now_utc())
        await db.blocklist.update_one({"host": host}, {"$setOnInsert": entry.to_mongo()}, upsert=True)
    loop_task = asyncio.create_task(weekly_checkin_loop())
    mailbox_task = asyncio.create_task(mailbox_monitor_loop())
    cleanup_task = asyncio.create_task(sweep_loop())
    investigation_task = asyncio.create_task(investigation_jobs.sweep_loop())

    async def push_receipt_loop():
        while True:
            try:
                await push.reconcile_receipts()
                await family.sweep_voice_audio()
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001
                logger.warning("push receipt reconciliation failed")
            await asyncio.sleep(300)

    receipts_task = asyncio.create_task(push_receipt_loop())
    yield
    receipts_task.cancel()
    loop_task.cancel()
    mailbox_task.cancel()
    cleanup_task.cancel()
    investigation_task.cancel()
    client.close()


app = FastAPI(title="Apollo V1 API", lifespan=lifespan)
app.add_middleware(PrivacyBoundary)


@app.exception_handler(HTTPException)
async def typed_failure_handler(_: Request, exc: HTTPException):
    """Investigation routes raise the spec's `{"error": Failure}` body; legacy routes keep FastAPI's `{"detail": ...}`."""
    body = exc.detail if isinstance(exc.detail, dict) and "error" in exc.detail else {"detail": exc.detail}
    return JSONResponse(body, status_code=exc.status_code, headers=dict(exc.headers or {}))


@app.get("/health", include_in_schema=False)
async def deployment_health():
    """Root liveness probe for the deployment platform (unauthenticated, no DB). Device-facing health stays at /api/health."""
    return {"status": "ok"}


# Every device-facing router is mounted under /api behind the device bearer gate (public paths are listed in core.auth).
for r in (health, devices, intel, patrol, investigations, ask, family, family_weekly, voice, push, analysis, gmail, call):
    app.include_router(r.router, prefix="/api", dependencies=[Depends(enforce_device_auth)])
app.include_router(admin.router, prefix="/api/admin", tags=["admin"], dependencies=[Depends(require_admin_key)])

# CORS is not authentication (bearer tokens do that). The web preview is same-origin (/api on the same host), and native
# apps don't use CORS, so only explicitly configured browser origins are allowed (add the admin console's origin here).
_cors_origins = [o.strip() for o in os.environ.get("CORS_ORIGINS", "").split(",") if o.strip()]
app.add_middleware(CORSMiddleware, allow_credentials=False, allow_origins=_cors_origins, allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"], allow_headers=["Authorization", "Content-Type", "Accept", ADMIN_HEADER, "X-Admin-Actor"])
