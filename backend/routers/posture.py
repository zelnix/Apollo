"""Device posture reporting — receives posture snapshots and changes from the
client, stores them, and can trigger push alerts for critical posture changes
when the app is in the background.

POST /api/devices/posture — client reports its current posture snapshot + any changes
GET  /api/devices/posture — retrieve the latest posture report for this device
"""

import logging
from typing import Optional

from fastapi import APIRouter, Request
from pydantic import BaseModel

from core.db import db, now_utc
from routers.push import send_push, should_send_category, PUSH_THREAT

logger = logging.getLogger(__name__)
router = APIRouter(tags=["posture"])


# ------------------------------------------------------------------ models

class PostureCheckReport(BaseModel):
    id: str
    value: str
    severity: str
    observable: bool


class PostureChangeReport(BaseModel):
    id: str
    label: str
    previousValue: str
    currentValue: str
    severity: str
    detail: str


class PostureSnapshotReport(BaseModel):
    checks: list[PostureCheckReport]
    capturedAt: str
    platform: str


class PostureReportIn(BaseModel):
    snapshot: PostureSnapshotReport
    changes: list[PostureChangeReport] = []


# ------------------------------------------------------------------ endpoints

@router.post("/devices/posture")
async def report_device_posture(body: PostureReportIn, request: Request):
    """Client reports its device posture snapshot and any detected changes."""
    owner = request.state.device["device_id"]

    # Store the latest posture snapshot
    doc = {
        "device_id": owner,
        "snapshot": body.snapshot.model_dump(),
        "changes": [c.model_dump() for c in body.changes],
        "reported_at": now_utc().isoformat(),
    }
    await db.device_posture.update_one(
        {"device_id": owner},
        {"$set": doc},
        upsert=True,
    )

    # If there are critical changes, log them and potentially push-alert
    critical_changes = [c for c in body.changes if c.severity == "critical"]
    if critical_changes:
        logger.warning(
            "Device posture critical changes: device=%s changes=%s",
            owner[:8],
            [(c.id, c.currentValue) for c in critical_changes],
        )
        # Push alert for critical posture changes (maps to barking — always on)
        if await should_send_category(owner, "barking"):
            change_summary = "; ".join(f"{c.label}: {c.detail}" for c in critical_changes[:3])
            try:
                await send_push(
                    recipients=[owner],
                    data={
                        "title": "ApolloSG: Device security change detected",
                        "message": change_summary[:200],
                        "action_url": "/alerts",
                        **PUSH_THREAT,
                    },
                    owner_id=owner,
                    idempotency_key=f"posture-{owner}-{body.snapshot.capturedAt}",
                )
            except Exception as exc:
                logger.warning("posture push failed (non-blocking): %s", type(exc).__name__)

    warning_changes = [c for c in body.changes if c.severity == "warning"]
    if warning_changes:
        logger.info(
            "Device posture warning changes: device=%s changes=%s",
            owner[:8],
            [(c.id, c.currentValue) for c in warning_changes],
        )

    return {
        "received": True,
        "critical_count": len(critical_changes),
        "warning_count": len(warning_changes),
        "total_checks": len(body.snapshot.checks),
    }


@router.get("/devices/posture")
async def get_device_posture(request: Request):
    """Retrieve the latest posture report for this device."""
    owner = request.state.device["device_id"]
    doc = await db.device_posture.find_one({"device_id": owner}, {"_id": 0})
    if not doc:
        return {"device_id": owner, "snapshot": None, "changes": [], "reported_at": None}
    return doc
