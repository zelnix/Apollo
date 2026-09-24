"""Owner-scoped readiness observations; public liveness never depends on these checks."""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

from core.config import GEMINI_API_KEY
from core.db import db, now_utc
from services.higgins.encryption import cipher
from services.maintenance import worker_status

SCHEMA_VERSION = 1
COMPONENTS = ("device_auth", "database", "maintenance", "investigation_queue",
              "privacy_cleanup", "report_store", "higgins_configuration")
RECENT_SECONDS = 180
QUEUE_STUCK_SECONDS = 180


def _utc(value: datetime | str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00")) if isinstance(value, str) else value
        return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)
    except (ValueError, TypeError):
        return None


def _component(name: str, status: str = "healthy", code: str | None = None) -> dict:
    return {"id": name, "status": status, "code": code}


def _step(components: dict, name: str, now: datetime, *, required: bool = False, label: str | None = None) -> dict:
    step = components.get(name, {})
    result_id = label or name
    if step.get("status") == "failed":
        return _component(result_id, "unavailable" if required else "degraded", "component_failed")
    checked = _utc(step.get("last_success_at"))
    if not checked or checked < now - timedelta(seconds=RECENT_SECONDS):
        return _component(result_id, "unavailable" if required else "degraded", "component_stale")
    return _component(result_id)


async def readiness(owner: str) -> dict:
    """Only bounded facts and codes cross the API; all queries have small time budgets."""
    now = now_utc()
    result = {name: _component(name) for name in COMPONENTS}
    try:
        device = await asyncio.wait_for(db.devices.find_one({"device_id": owner}, {"_id": 0, "device_id": 1}), 2)
        if not device:
            result["device_auth"] = _component("device_auth", "unavailable", "auth_invalid")
        await asyncio.wait_for(db.command("ping"), 2)
    except Exception:  # no exception text/hostnames returned to the device
        result["database"] = _component("database", "unavailable", "db_unreachable")
    if result["database"]["status"] == "healthy":
        try:
            worker = await asyncio.wait_for(worker_status(), 3)
            if worker.get("stale") or worker.get("status") in ("missing", "stopped"):
                result["maintenance"] = _component("maintenance", "degraded", "worker_stale")
            elif worker.get("status") != "healthy":
                result["maintenance"] = _component("maintenance", "degraded", "component_failed")
            steps = worker.get("components") or {}
            result["privacy_cleanup"] = _step(steps, "temporary_content", now, required=True, label="privacy_cleanup")
            expiry = _step(steps, "case_expiry_and_deletion", now, required=True)
            if expiry["status"] != "healthy":
                result["privacy_cleanup"] = _component("privacy_cleanup", "unavailable", expiry["code"])
            result["investigation_queue"] = _step(steps, "job_and_device_inbox_recovery", now, label="investigation_queue")
            backlog = worker.get("pendingBacklog") or {}
            if backlog.get("expiredCases", 0) > 0:
                result["privacy_cleanup"] = _component("privacy_cleanup", "degraded" if backlog["expiredCases"] <= 25 else "unavailable", "cleanup_lagging")
            if backlog.get("status") == "unavailable":
                result["investigation_queue"] = _component("investigation_queue", "degraded", "queue_unavailable")
            oldest = await asyncio.wait_for(db.investigation_jobs.find_one(
                {"status": {"$in": ["queued", "running"]}}, {"_id": 0, "created_at": 1},
                sort=[("created_at", 1)]), 2)
            if oldest and (_utc(oldest.get("created_at")) or now) < now - timedelta(seconds=QUEUE_STUCK_SECONDS):
                result["investigation_queue"] = _component("investigation_queue", "degraded", "queue_stuck")
        except Exception:
            result["maintenance"] = _component("maintenance", "degraded", "worker_unavailable")
            result["investigation_queue"] = _component("investigation_queue", "degraded", "queue_unavailable")
            result["privacy_cleanup"] = _component("privacy_cleanup", "unavailable", "cleanup_unavailable")
        try:
            await asyncio.wait_for(db.investigation_reports.find_one({"owner_id": owner}, {"_id": 0, "report_id": 1}), 2)
            cipher()  # existing 0600 server-only investigation key; never sent to the device
        except Exception:
            result["report_store"] = _component("report_store", "degraded", "report_store_unavailable")
    else:
        for name in ("maintenance", "investigation_queue", "privacy_cleanup", "report_store"):
            result[name] = _component(name, "unavailable" if name == "privacy_cleanup" else "degraded", "db_unreachable")
    if not GEMINI_API_KEY:
        result["higgins_configuration"] = _component("higgins_configuration", "degraded", "provider_not_configured")
    if result["report_store"]["status"] != "healthy":
        result["higgins_configuration"] = _component("higgins_configuration", "degraded", "report_store_unavailable")
    critical = ("device_auth", "database", "privacy_cleanup")
    state = ("unavailable" if any(result[c]["status"] == "unavailable" for c in critical)
             else "degraded" if any(row["status"] != "healthy" for row in result.values()) else "healthy")
    return {"schemaVersion": SCHEMA_VERSION, "status": state, "checkedAt": now.isoformat(),
            "components": [result[name] for name in COMPONENTS]}