"""Call Guard (Gate 4 add-on) — caller number risk lookup. Proxied entirely server-side; see
services/phonerisk.py for the Truth-of-State rules this endpoint must never violate on its own."""
from __future__ import annotations

from typing import Optional, List
from fastapi import APIRouter
from pydantic import BaseModel, Field

from core.models import CallRiskRequest, CallRiskResponse
from services.phonerisk import check_phone_risk
from services.investigation import phone_risk_investigation, investigate_phone_number

router = APIRouter()


class PhoneInvestigateRequest(BaseModel):
    device_id: str = Field(min_length=8, max_length=64)
    number: str = Field(min_length=3, max_length=40)
    country: Optional[str] = Field(default=None, min_length=2, max_length=2)
    caller_asks: Optional[List[str]] = Field(default=None, max_length=15)
    caller_claim: Optional[str] = Field(default=None, max_length=50)
    transcript: Optional[str] = Field(default=None, max_length=2000)


@router.post("/call/risk-check", response_model=CallRiskResponse)
async def call_risk_check(body: CallRiskRequest):
    # Purpose-limited manual/background lookup: Apollo does not persist the submitted number.
    result = await check_phone_risk(body.number, body.country, persist_cache=False)
    response = result.model_copy(update={"assessment": phone_risk_investigation(result).model_dump(mode="json")})
    # #5: Ingest flagged numbers into the Live Caller ID reputation database.
    # This grows the PIR database organically from actual risk checks.
    try:
        from services.caller_id_db import ingest_from_risk_check
        await ingest_from_risk_check(body.number, response.model_dump())
    except Exception:
        pass  # Non-blocking — database growth is best-effort
    return response


@router.post("/call/investigate")
async def call_investigate(body: PhoneInvestigateRequest):
    """Full Higgins-powered phone number investigation with optional caller context."""
    result = await investigate_phone_number(
        number=body.number,
        country=body.country,
        caller_asks=body.caller_asks,
        caller_claim=body.caller_claim,
        transcript=body.transcript,
    )
    return result.model_dump(mode="json")


@router.get("/call/caller-id-db/count")
async def caller_id_count():
    """Return the number of entries in the Live Caller ID reputation database."""
    from services.caller_id_db import count
    return {"count": await count()}


@router.get("/call/caller-id-db/export")
async def caller_id_export(limit: int = 100000):
    """Export the reputation database for PIR server ingestion.
    Returns entries in the format Apple's PIR server expects."""
    from services.caller_id_db import export_for_pir
    entries = await export_for_pir(limit)
    return {"entries": entries, "count": len(entries)}
