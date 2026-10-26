"""Device-reported Triage outcome telemetry (outcome + cause codes only). See services/triage/telemetry.py."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, Field

from services.triage import telemetry

router = APIRouter()


class TriageTelemetryIn(BaseModel):
    source_type: str = Field(min_length=1, max_length=40)
    outcome: str = Field(min_length=1, max_length=40)
    causes: list[str] = Field(default_factory=list, max_length=10)
    gap_codes: list[str] = Field(default_factory=list, max_length=10)
    catalogue_version: Optional[int] = None
    lookup_check: Optional[str] = Field(default=None, max_length=40)
    lookup_attempts: Optional[int] = Field(default=None, ge=0, le=10)
    lookup_outcome: Optional[str] = Field(default=None, max_length=40)


@router.post("/triage/telemetry", status_code=204, response_class=Response)
async def report_triage_outcome(body: TriageTelemetryIn, request: Request) -> Response:
    lookup = ({"check": body.lookup_check, "attempts": body.lookup_attempts, "outcome": body.lookup_outcome}
              if body.lookup_check else None)
    await telemetry.record(request.state.device, origin="device", source_type=body.source_type, outcome=body.outcome,
                           causes=body.causes, gap_codes=body.gap_codes, catalogue_version=body.catalogue_version, lookup=lookup)
    return Response(status_code=204)
