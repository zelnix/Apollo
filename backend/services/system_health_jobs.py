"""Durable, owner-scoped admission and recovery for a single manual Higgins health check."""
from __future__ import annotations

import asyncio
import hashlib
import logging
import uuid
from datetime import datetime, timedelta, timezone

from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from core.db import db, now_utc
from services.higgins import health_check, report_store

COOLDOWN = timedelta(minutes=15)
STUCK = timedelta(minutes=2)
SCHEMA_VERSION = 1
logger = logging.getLogger(__name__)


class HealthRateLimit(Exception):
    def __init__(self, retry_at: str):
        self.retry_at = retry_at


def _utc(value):
    if value is None:
        return None
    return _aware(value).isoformat() if isinstance(value, datetime) else str(value)


def _aware(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def public(doc: dict, *, cached: bool = False) -> dict:
    """Closed response allowlist: no prompts, tokens, ids from Mongo or raw provider text."""
    done = doc.get("state") == "completed"
    return {"schemaVersion": SCHEMA_VERSION, "checkId": doc["check_id"], "state": doc["state"],
            "createdAt": _utc(doc.get("started_at")), "expiresAt": _utc(doc.get("expires_at")),
            "checkedAt": _utc(doc.get("checked_at")),
            "cached": cached,
            "investigation": {"status": doc.get("investigation_status", "pending"),
                              "code": doc.get("investigation_code")},
            "report": {"status": doc.get("report_status", "pending"),
                       "code": doc.get("report_code"),
                       "fixture": health_check.fixture(doc["check_id"]) if done else None},
            "cleanup": {"status": doc.get("cleanup_status", "pending")}}


def admitted(doc: dict) -> dict:
    """202 has only the four fields in the asynchronous health-resource contract."""
    return {"checkId": doc["check_id"], "state": doc["state"],
            "createdAt": _utc(doc["started_at"]), "expiresAt": _utc(doc["expires_at"])}


async def ensure_indexes() -> None:
    await db.health_checks.create_index([("owner_id", 1), ("key_digest", 1)], unique=True)
    await db.health_checks.create_index([("owner_id", 1), ("check_id", 1)], unique=True)
    await db.health_checks.create_index("expires_at", expireAfterSeconds=0)
    await db.health_check_claims.create_index("expires_at", expireAfterSeconds=0)


async def start(owner: str, key: str) -> tuple[dict, bool]:
    now = now_utc()
    digest = hashlib.sha256(f"{owner}:{key}".encode()).hexdigest()
    existing = await db.health_checks.find_one({"owner_id": owner, "key_digest": digest}, {"_id": 0})
    if existing and _aware(existing["expires_at"]) > now:
        return existing, False
    if existing:
        await db.health_checks.delete_one({"owner_id": owner, "key_digest": digest, "expires_at": {"$lte": now}})
    check_id, expires_at = str(uuid.uuid4()), now + COOLDOWN
    try:
        claim = await db.health_check_claims.find_one_and_update(
            {"_id": owner, "$or": [{"expires_at": {"$lte": now}}, {"expires_at": {"$exists": False}}]},
            {"$set": {"check_id": check_id, "expires_at": expires_at}},
            upsert=True, return_document=ReturnDocument.AFTER)
    except DuplicateKeyError:
        claim = await db.health_check_claims.find_one({"_id": owner}, {"_id": 0, "check_id": 1, "expires_at": 1})
        if not claim:
            raise HealthRateLimit(expires_at.isoformat()) from None
        earlier = await db.health_checks.find_one({"owner_id": owner, "check_id": claim["check_id"]}, {"_id": 0})
        if earlier and earlier.get("state") == "completed":
            return earlier, False  # reuse last success, but caller still reruns local/readiness
        if earlier and earlier.get("state") in ("queued", "running"):
            return earlier, False  # one provider-backed run per owner
        raise HealthRateLimit(_utc(claim.get("expires_at")) or expires_at.isoformat()) from None
    document = {"owner_id": owner, "key_digest": digest, "check_id": check_id, "state": "queued",
                "started_at": now, "expires_at": expires_at, "checked_at": None,
                "investigation_status": "pending", "investigation_code": None,
                "report_status": "pending", "report_code": None, "cleanup_status": "pending"}
    try:
        await db.health_checks.insert_one(document)
    except DuplicateKeyError:
        await db.health_check_claims.delete_one({"_id": owner, "check_id": check_id})
        same = await db.health_checks.find_one({"owner_id": owner, "key_digest": digest}, {"_id": 0})
        if same:
            return same, False
        raise
    except Exception:
        await db.health_check_claims.delete_one({"_id": owner, "check_id": check_id})
        raise
    return document, True


async def get(owner: str, check_id: str) -> dict | None:
    doc = await db.health_checks.find_one({"owner_id": owner, "check_id": check_id,
                                           "expires_at": {"$gt": now_utc()}}, {"_id": 0})
    if doc and doc["state"] in ("queued", "running") and _aware(doc["started_at"]) < now_utc() - STUCK:
        await _recover_one(doc)
        doc = await db.health_checks.find_one({"owner_id": owner, "check_id": check_id}, {"_id": 0})
    return doc


async def run(owner: str, check_id: str) -> None:
    doc = await db.health_checks.find_one_and_update(
        {"owner_id": owner, "check_id": check_id, "state": "queued"},
        {"$set": {"state": "running"}}, return_document=ReturnDocument.AFTER)
    if not doc:
        return
    patch = {"state": "failed", "checked_at": now_utc(),
             "investigation_status": "unavailable", "investigation_code": "provider_unavailable",
             "report_status": "unavailable", "report_code": "report_not_attempted", "cleanup_status": "complete"}
    try:
        response = await asyncio.wait_for(health_check.investigate(), timeout=60)
        patch.update(investigation_status="healthy", investigation_code=None)
        await asyncio.wait_for(health_check.report_round_trip(owner, check_id, response, doc["expires_at"]), timeout=12)
        patch.update(state="completed", report_status="healthy", report_code=None, cleanup_status="complete")
    except health_check.HealthFailure as exc:
        if patch["investigation_status"] == "healthy":
            patch.update(report_code=exc.code, cleanup_status="failed" if exc.code == "cleanup_not_confirmed" else "complete")
        else:
            patch["investigation_code"] = exc.code
    except asyncio.TimeoutError:
        if patch["investigation_status"] == "healthy":
            patch.update(report_code="report_timeout", cleanup_status="pending")
        else:
            patch["investigation_code"] = "provider_timeout"
    except asyncio.CancelledError:
        patch.update(investigation_code="investigation_queue_unavailable", report_code="report_not_attempted")
        raise
    except Exception:  # never log or return provider data or exception text
        patch["investigation_code" if patch["investigation_status"] != "healthy" else "report_code"] = "check_unavailable"
    finally:
        if patch["state"] != "completed":
            try:
                await db.health_report_artifacts.delete_many({"owner_id": owner, "check_id": check_id})
                remaining = await db.health_report_artifacts.find_one({"owner_id": owner, "check_id": check_id}, {"_id": 0, "report_id": 1})
                patch["cleanup_status"] = "failed" if remaining else "complete"
            except Exception:
                patch["cleanup_status"] = "failed"
            if patch["cleanup_status"] == "failed":
                patch["report_code"] = "cleanup_not_confirmed"
                logger.error("health_check_cleanup_not_confirmed")  # bounded operator signal, no owner/provider data
        patch["checked_at"] = now_utc()
        await db.health_checks.update_one({"owner_id": owner, "check_id": check_id, "state": "running"}, {"$set": patch})


async def _recover_one(doc: dict) -> None:
    owner, check_id = doc["owner_id"], doc["check_id"]
    await db.health_report_artifacts.delete_many({"owner_id": owner, "check_id": check_id})
    remaining = await db.health_report_artifacts.find_one({"owner_id": owner, "check_id": check_id}, {"_id": 0, "report_id": 1})
    await db.health_checks.update_one({"owner_id": owner, "check_id": check_id, "state": {"$in": ["queued", "running"]}},
                                      {"$set": {"state": "failed", "checked_at": now_utc(),
                                                "investigation_status": "unavailable", "investigation_code": "investigation_queue_unavailable",
                                                "report_status": "unavailable", "report_code": "cleanup_not_confirmed" if remaining else "report_not_attempted",
                                                "cleanup_status": "failed" if remaining else "complete"}})


async def recover_stale() -> None:
    cursor = db.health_checks.find({"state": {"$in": ["queued", "running"]},
                                     "started_at": {"$lt": now_utc() - STUCK}}, {"_id": 0,
                                     "owner_id": 1, "check_id": 1})
    for doc in await cursor.to_list(length=50):
        await _recover_one(doc)