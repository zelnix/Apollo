"""Apollo V1 backend — application entry point (`uvicorn server:app`).

Privacy posture:
- Receives only minimal security indicators (a user-submitted link, a host name,
  or an event summary). Never page content, contacts, messages or device data.
- Reputation cache stores an HMAC digest of the indicator, never the raw value.
- All deletes are soft deletes (deleted_at).

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

from fastapi import Depends, FastAPI
from starlette.middleware.cors import CORSMiddleware

from core.auth import enforce_device_auth, require_admin_key
from core.config import ADMIN_HEADER
from core.db import client, db, now_utc
from core.models import BlocklistEntry
from routers import admin, analysis, ask, devices, family, family_weekly, health, intel, patrol, push, voice
from routers.family_weekly import weekly_checkin_loop

SEED_BLOCKLIST = [
    ("testsafebrowsing.appspot.com", "SOCIAL_ENGINEERING", "Google Safe Browsing public test pages"),
    ("malware.testing.google.test", "MALWARE", "Google malware test domain"),
    ("phishing.apollo.test", "SOCIAL_ENGINEERING", "Apollo internal phishing test domain"),
    ("malware.apollo.test", "MALWARE", "Apollo internal malware test domain"),
]


@asynccontextmanager
async def lifespan(_: FastAPI):
    await db.devices.create_index("device_id", unique=True)
    await db.devices.create_index("token_hash", unique=True, partialFilterExpression={"token_hash": {"$type": "string"}})
    await db.reputation_cache.create_index("indicator_digest", unique=True)
    await db.reputation_cache.create_index("expires_at")  # plain index; expiry is checked at read time, never auto-deleted
    await db.patrol_events.create_index([("device_id", 1), ("event_id", 1)], unique=True)
    await db.trust_entries.create_index("trust_id", unique=True)
    await db.ask_messages.create_index([("device_id", 1), ("created_at", 1)])
    await db.blocklist.create_index("host", unique=True)
    for host, threat, reason in SEED_BLOCKLIST:
        entry = BlocklistEntry(host=host, threat_type=threat, reason=reason, added_at=now_utc())
        await db.blocklist.update_one({"host": host}, {"$setOnInsert": entry.to_mongo()}, upsert=True)
    loop_task = asyncio.create_task(weekly_checkin_loop())
    yield
    loop_task.cancel()
    client.close()


app = FastAPI(title="Apollo V1 API", lifespan=lifespan)

# Every device-facing router is mounted under /api behind the device bearer gate (public paths are listed in core.auth).
for r in (health, devices, intel, patrol, ask, family, family_weekly, voice, push, analysis):
    app.include_router(r.router, prefix="/api", dependencies=[Depends(enforce_device_auth)])
app.include_router(admin.router, prefix="/api/admin", tags=["admin"], dependencies=[Depends(require_admin_key)])

# CORS is not authentication (bearer tokens do that). The web preview is same-origin (/api on the same host), and native
# apps don't use CORS, so only explicitly configured browser origins are allowed (add the admin console's origin here).
_cors_origins = [o.strip() for o in os.environ.get("CORS_ORIGINS", "").split(",") if o.strip()]
app.add_middleware(CORSMiddleware, allow_credentials=False, allow_origins=_cors_origins, allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"], allow_headers=["Authorization", "Content-Type", "Accept", ADMIN_HEADER])
