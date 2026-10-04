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
    response = result.model_copy(update={"assessment": phone_risk_investigation(result).model_dump(mode="json")})
    # #5: Ingest flagged numbers into the Live Caller ID reputation database.
    # This grows the PIR database organically from actual risk checks.
    try:
        from services.caller_id_db import ingest_from_risk_check
        await ingest_from_risk_check(body.number, response.model_dump())
    except Exception:
        pass  # Non-blocking — database growth is best-effort
    return response


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
