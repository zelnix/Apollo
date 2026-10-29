"""Temporary diagnostic log endpoint — captures frontend console.warn traces for investigation debugging."""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter

router = APIRouter(tags=["debug"])
log = logging.getLogger("apollo.debug_log")

# In-memory ring buffer — last 200 entries
_LOG: list[dict[str, Any]] = []
_MAX = 200


@router.post("/debug/log")
async def capture(body: dict[str, Any]) -> dict[str, str]:
    entry = {"ts": datetime.now(timezone.utc).isoformat(), **body}
    _LOG.append(entry)
    if len(_LOG) > _MAX:
        _LOG.pop(0)
    tag = body.get("tag", "?")
    msg = body.get("msg", "?")
    log.info("FE_DEBUG [%s] %s %s", tag, msg, {k: v for k, v in body.items() if k not in ("tag", "msg")})
    return {"status": "ok"}


@router.get("/debug/log")
async def read(tag: str | None = None, last: int = 100) -> list[dict[str, Any]]:
    entries = _LOG[-last:]
    if tag:
        entries = [e for e in entries if e.get("tag") == tag]
    return entries


@router.delete("/debug/log")
async def clear() -> dict[str, str]:
    _LOG.clear()
    return {"status": "cleared"}
