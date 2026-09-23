"""Owner-scoped capability/Gate registry routes."""
from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from services import capability_registry

router = APIRouter()
NO_STORE = {"Cache-Control": "private, no-store", "Pragma": "no-cache"}


class GateObservation(BaseModel):
    id: str = Field(pattern=r"^(site|text|call|email|link|file|app|device|account|network)$")
    state: Literal["running", "ready", "permission_required", "degraded", "unavailable", "offline", "not_applicable"]
    reason: str | None = Field(default=None, max_length=160)


class CapabilityObservation(BaseModel):
    id: str = Field(min_length=1, max_length=100)
    state: Literal["running", "ready", "permission_required", "degraded", "unavailable", "offline", "not_applicable"]
    reason: str | None = Field(default=None, max_length=160)


class CapabilitySnapshot(BaseModel):
    model_config = {"extra": "forbid"}
    platform: Literal["android", "ios", "windows", "macos", "web", "mock"]
    adapter: str = Field(min_length=1, max_length=80)
    online: bool | None = None
    gates: list[GateObservation] = Field(max_length=10)
    capabilities: list[CapabilityObservation] = Field(default_factory=list, max_length=100)
    protection: dict[str, Any] | None = None


@router.post("/product/capabilities/snapshot", status_code=202)
async def record_snapshot(body: CapabilitySnapshot, request: Request):
    await capability_registry.save_snapshot(request.state.device["device_id"], body.model_dump(mode="json"))
    return JSONResponse({"accepted": True}, status_code=202, headers=NO_STORE)


@router.get("/product/capabilities")
async def get_capabilities(request: Request):
    return JSONResponse(jsonable_encoder(await capability_registry.product_capabilities(request.state.device["device_id"])), headers=NO_STORE)