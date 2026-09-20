"""Call Guard (Gate 4 add-on) — caller number risk lookup. Proxied entirely server-side; see
services/phonerisk.py for the Truth-of-State rules this endpoint must never violate on its own."""
from __future__ import annotations

from fastapi import APIRouter

from core.models import CallRiskRequest, CallRiskResponse
from services.phonerisk import check_phone_risk
from services.investigation import phone_risk_investigation

router = APIRouter()


@router.post("/call/risk-check", response_model=CallRiskResponse)
async def call_risk_check(body: CallRiskRequest):
    # Purpose-limited manual/background lookup: Apollo does not persist the submitted number.
    result = await check_phone_risk(body.number, body.country, persist_cache=False)
    return result.model_copy(update={"assessment": phone_risk_investigation(result).model_dump(mode="json")})
