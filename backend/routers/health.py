"""Public liveness, authenticated readiness and manual owner-scoped Higgins diagnostics."""
from __future__ import annotations

import re
from datetime import timezone
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from core.db import now_utc
from services import system_health, system_health_jobs

router = APIRouter(tags=["health"])
NO_STORE = {"Cache-Control": "no-store"}


class Probe(BaseModel):
    schemaVersion: int
    status: str
    service: str
    checkedAt: str


class Component(BaseModel):
    id: str
    status: str
    code: str | None


class Readiness(BaseModel):
    schemaVersion: int
    status: str
    checkedAt: str
    components: list[Component]


def _owner(request: Request) -> str:
    """Router-wide bearer gate has already set this verified device identity."""
    device = getattr(request.state, "device", None)
    if not device or not device.get("device_id"):
        raise HTTPException(status_code=401, detail="Device credential is required.")
    return device["device_id"]


@router.get("/health", response_model=Probe)
async def probe(response: Response):
    response.headers["Cache-Control"] = "no-store"
    return Probe(schemaVersion=1, status="ok", service="apollo-v1", checkedAt=now_utc().astimezone(timezone.utc).isoformat())


@router.get("/health/readiness", response_model=Readiness)
async def readiness(request: Request):
    report = await system_health.readiness(_owner(request))
    return JSONResponse(Readiness.model_validate(report).model_dump(),
                        status_code=503 if report["status"] == "unavailable" else 200, headers=NO_STORE)


@router.post("/health/higgins-checks")
async def start_check(request: Request, tasks: BackgroundTasks, idempotency_key: str = Header(..., alias="Idempotency-Key")):
    owner = _owner(request)
    if not re.fullmatch(r"[A-Za-z0-9_-]{16,128}", idempotency_key):
        raise HTTPException(status_code=400, detail="Invalid idempotency key.")
    if request.headers.get("content-length") not in (None, "0"):
        raise HTTPException(status_code=400, detail="Health checks accept no submitted content.")
    async for part in request.stream():
        if part:
            raise HTTPException(status_code=400, detail="Health checks accept no submitted content.")
    if (await system_health.readiness(owner))["status"] == "unavailable":
        return JSONResponse({"error": {"code": "readiness_unavailable"}}, status_code=503, headers=NO_STORE)
    try:
        doc, new = await system_health_jobs.start(owner, idempotency_key)
    except system_health_jobs.HealthRateLimit as exc:
        return JSONResponse({"error": {"code": "rate_limited", "retryAt": exc.retry_at}}, status_code=429, headers=NO_STORE)
    if new:
        tasks.add_task(system_health_jobs.run, owner, doc["check_id"])
    if doc["state"] in ("queued", "running"):
        return JSONResponse(system_health_jobs.admitted(doc), status_code=202, headers=NO_STORE)
    return JSONResponse(system_health_jobs.public(doc, cached=not new), status_code=200, headers=NO_STORE)


@router.get("/health/higgins-checks/{check_id}")
async def check_status(request: Request, check_id: str):
    owner = _owner(request)
    try:
        parsed = str(UUID(check_id))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid check ID.") from None
    doc = await system_health_jobs.get(owner, parsed)
    if not doc:
        raise HTTPException(status_code=404, detail="Unknown health check.")
    return JSONResponse(system_health_jobs.public(doc), headers=NO_STORE)