"""Per-device usage counts for the admin Devices list: how often each feature was used on a device.
Counts only. A Learn article or scam alert that was opened is kept as a short digest, so opening the same one again
does not count twice and no title or link is stored."""
from __future__ import annotations

import hashlib
import logging
from typing import Optional

from core.db import db

log = logging.getLogger(__name__)

COUNTERS = ("tc_flyby", "magnum_di", "ask_higgins", "device_checks")
READS = {"learn_read": "learn_read", "scam_alert_read": "scam_alerts_read"}


async def bump(device_id: str, counter: str) -> None:
    """Adds one to a count. Never fails the feature that was used: a missed count is only logged."""
    try:
        await db.devices.update_one({"device_id": device_id}, {"$inc": {f"stats.{counter}": 1}})
    except Exception as exc:  # noqa: BLE001
        log.warning("device_stat_failed counter=%s error=%s", counter, type(exc).__name__)


async def mark_read(device_id: str, kind: str, item: str) -> None:
    digest = hashlib.sha256(item.encode("utf-8")).hexdigest()[:16]
    await db.devices.update_one({"device_id": device_id}, {"$addToSet": {f"stats.{READS[kind]}": digest}})


def investigator(answered_by: Optional[str]) -> Optional[str]:
    """Which count an investigation's first answer adds to: TC FlyBy settled it, or Magnum DI answered it."""
    if answered_by == "magnum_di":
        return "magnum_di"
    if (answered_by or "").startswith("teddy"):
        return "tc_flyby"
    return None


def counts(device: dict) -> dict[str, int]:
    stats = device.get("stats") or {}
    out = {name: int(stats.get(name) or 0) for name in COUNTERS}
    out.update({name: len(stats.get(name) or []) for name in READS.values()})
    return out


async def totals() -> dict[str, int]:
    """Every device's counts added up."""
    group: dict = {"_id": None}
    group.update({name: {"$sum": {"$ifNull": [f"$stats.{name}", 0]}} for name in COUNTERS})
    group.update({name: {"$sum": {"$size": {"$ifNull": [f"$stats.{name}", []]}}} for name in READS.values()})
    rows = await db.devices.aggregate([{"$match": {"stats": {"$exists": True}}}, {"$group": group}]).to_list(1)
    row = rows[0] if rows else {}
    return {name: int(row.get(name) or 0) for name in (*COUNTERS, *READS.values())}
