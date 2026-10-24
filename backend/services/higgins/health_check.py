"""Deterministic Higgins health check — no Gemini call and no synthetic investigation.

Health is read from state Apollo already holds: whether the Gemini key is configured and how Apollo's
real investigation calls have been going (the gemini_usage records). The report round trip still
exercises the production encrypted report store with a fixed, server-owned report.
"""
from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timedelta, timezone

from core.config import GEMINI_API_KEY
from core.db import db, now_utc
from services.higgins import report_store

RECENT_WINDOW = timedelta(hours=24)
RECENT_CALLS = 5
FIXED_RESPONSE = {"overview": "The health check completed from Apollo's own records.",
                  "explanationMarkdown": "Higgins read whether Apollo's AI service is set up and how recent investigations went. No AI call was made.",
                  "assessment": "uncertain", "attention": "none", "scope": "AI service set-up and recent investigation outcomes only.",
                  "sourceIds": [], "findings": [], "uncertainties": ["No real device was assessed."], "actions": []}


class HealthFailure(Exception):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


async def provider_status() -> dict:
    """Whether the Gemini key is set and how Apollo's last real Gemini call went. Read from records; no call is made."""
    last = await db.gemini_usage.find_one({"extra.simulated": {"$ne": True}}, {"_id": 0, "timestamp": 1, "success": 1, "failure_code": 1, "purpose": 1},
                                          sort=[("timestamp", -1)])
    call = None
    if last:
        at = last.get("timestamp")
        call = {"at": (at.replace(tzinfo=at.tzinfo or timezone.utc).isoformat() if isinstance(at, datetime) else None),
                "worked": bool(last.get("success")), "failureCode": last.get("failure_code"), "purpose": last.get("purpose")}
    return {"keyConfigured": bool(GEMINI_API_KEY), "lastCall": call}


async def investigate() -> dict:
    """Deterministic provider status from existing records. Never calls Gemini."""
    if not GEMINI_API_KEY:
        raise HealthFailure("provider_not_configured")
    recent = await db.gemini_usage.find({"correlation_id": {"$regex": "^case-"}, "timestamp": {"$gte": now_utc() - RECENT_WINDOW}},
                                        {"_id": 0, "success": 1, "failure_code": 1}).sort("timestamp", -1).limit(RECENT_CALLS).to_list(RECENT_CALLS)
    if recent and recent[0].get("failure_code") == "provider_configuration":
        raise HealthFailure("provider_unavailable")
    if len(recent) == RECENT_CALLS and not any(row.get("success") for row in recent):
        raise HealthFailure("provider_unavailable")
    return dict(FIXED_RESPONSE)


def fixture(check_id: str) -> dict:
    """Safe, fixed report-shaped fixture; provider-generated words never persist after a run."""
    return report_store.build_report(dict(FIXED_RESPONSE), case_id=f"health-{check_id}", gates=["device"],
                                     revision=1, sources=[], report_id=check_id, health_check=True)


async def report_round_trip(owner: str, check_id: str, response: dict, expires_at: datetime) -> dict:
    """Use production encrypted report code; always delete and confirm absence, even after failure."""
    report_id = str(uuid.uuid4())
    report = report_store.build_report(response, case_id=f"health-{check_id}", gates=["device"],
                                       revision=1, sources=[], report_id=report_id, health_check=True)
    digest = hashlib.sha256(json.dumps(report, sort_keys=True).encode()).digest()
    failure: HealthFailure | None = None
    try:
        try:
            await report_store.write(owner, report, health_check=True, expires_at=expires_at)
        except Exception:
            raise HealthFailure("report_write_failed") from None
        try:
            reopened = await report_store.read(owner, report_id, health_check=True)
            if reopened is None or hashlib.sha256(json.dumps(reopened, sort_keys=True).encode()).digest() != digest:
                raise HealthFailure("report_read_failed")
        except HealthFailure:
            raise
        except Exception:
            raise HealthFailure("report_read_failed") from None
    except HealthFailure as exc:
        failure = exc
    finally:
        try:
            await report_store.delete(owner, report_id, health_check=True)
            if await report_store.read(owner, report_id, health_check=True) is not None:
                raise HealthFailure("cleanup_not_confirmed")
        except Exception:
            failure = HealthFailure("cleanup_not_confirmed")
    if failure:
        raise failure
    return fixture(check_id)