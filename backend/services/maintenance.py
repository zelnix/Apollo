"""Supervised, idempotent background maintenance for durable Apollo work.

The API liveness probe remains independent. This worker records its own component-level
heartbeat so recovery/retention failures are visible without making the HTTP process unhealthy.
"""
from __future__ import annotations

import asyncio
import os
import socket
import uuid
from collections.abc import Awaitable, Callable
from datetime import timedelta

from core.config import logger
from core.db import db, now_utc
from routers.family import sweep_voice_audio
from services.higgins import jobs, repository
from services.higgins.retention import sweep as sweep_temporary_content

WORKER_NAME = "apollo-maintenance"
WORKER_INTERVAL_SECONDS = 20
WORKER_STALE_SECONDS = 75
INSTANCE_ID = os.getenv("HOSTNAME") or f"{socket.gethostname()}-{uuid.uuid4().hex[:8]}"

MaintenanceStep = tuple[str, Callable[[], Awaitable[object]]]


def maintenance_steps() -> tuple[MaintenanceStep, ...]:
    return (
        ("temporary_content", sweep_temporary_content),
        ("case_expiry_and_deletion", repository.sweep),
        ("tombstones", repository.sweep_tombstones),
        ("job_and_device_inbox_recovery", jobs.recover),
        ("family_audio", sweep_voice_audio),
    )


async def ensure_indexes() -> None:
    await db.worker_heartbeats.create_index([("worker", 1), ("instance_id", 1)], unique=True)
    await db.worker_heartbeats.create_index("last_heartbeat_at")
    await db.family_audio_cleanup.create_index([("state", 1), ("created_at", 1)])
    await db.investigation_reports.create_index([("owner_id", 1), ("saved_at", -1)])


async def _record(patch: dict) -> None:
    await db.worker_heartbeats.update_one(
        {"worker": WORKER_NAME, "instance_id": INSTANCE_ID},
        {"$set": {"worker": WORKER_NAME, "instance_id": INSTANCE_ID, **patch}},
        upsert=True,
    )


async def run_maintenance_cycle(steps: tuple[MaintenanceStep, ...] | None = None) -> dict[str, str]:
    """Run every independent maintenance component once; one failure never skips the others."""
    started = now_utc()
    await _record({"status": "running", "last_started_at": started, "last_heartbeat_at": started})
    outcomes: dict[str, str] = {}
    failures = 0
    for name, operation in steps or maintenance_steps():
        try:
            await operation()
            outcomes[name] = "ok"
            await _record({f"components.{name}.status": "ok", f"components.{name}.last_success_at": now_utc()})
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - content-free type only; next cycle retries
            failures += 1
            outcomes[name] = "failed"
            await _record({f"components.{name}.status": "failed", f"components.{name}.last_failure_at": now_utc(),
                           f"components.{name}.failure_type": type(exc).__name__})
            logger.error("maintenance_component_failed component=%s type=%s", name, type(exc).__name__)
    finished = now_utc()
    await _record({"status": "degraded" if failures else "healthy", "last_heartbeat_at": finished,
                   "last_completed_at": finished, "last_cycle_failures": failures, "cycle_seconds": (finished - started).total_seconds()})
    return outcomes


async def maintenance_loop() -> None:
    """Run immediately after startup, then forever until supervised shutdown."""
    try:
        while True:
            await run_maintenance_cycle()
            await asyncio.sleep(WORKER_INTERVAL_SECONDS)
    except asyncio.CancelledError:
        await _record({"status": "stopped", "stopped_at": now_utc(), "last_heartbeat_at": now_utc()})
        raise


async def worker_status() -> dict:
    cutoff = now_utc() - timedelta(seconds=WORKER_STALE_SECONDS)
    row = await db.worker_heartbeats.find_one(
        {"worker": WORKER_NAME},
        {"_id": 0, "worker": 1, "instance_id": 1, "status": 1, "last_heartbeat_at": 1,
         "last_completed_at": 1, "last_cycle_failures": 1, "components": 1},
        sort=[("last_heartbeat_at", -1)],
    )
    if not row:
        return {"status": "missing", "stale": True, "lastHeartbeatAt": None, "components": {}}
    heartbeat = row.get("last_heartbeat_at")
    normalised_heartbeat = repository.utc(heartbeat) if heartbeat else None
    return {
        "status": row.get("status", "unknown"),
        "stale": not normalised_heartbeat or normalised_heartbeat <= cutoff,
        "lastHeartbeatAt": normalised_heartbeat.isoformat() if normalised_heartbeat else None,
        "lastCompletedAt": repository.utc(row["last_completed_at"]).isoformat() if row.get("last_completed_at") else None,
        "lastCycleFailures": row.get("last_cycle_failures", 0),
        "components": row.get("components", {}),
    }