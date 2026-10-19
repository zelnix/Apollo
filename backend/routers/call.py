"""Call Guard (Gate 4 add-on) — caller number risk lookup and investigation.

/call/risk-check — automatic protection: quick IPQS reputation observation (no Gemini).
/call/investigate — person-requested: creates a shared Magnum DI investigation case.

The phone reputation is an observation, not an investigation conclusion.
Magnum DI owns the investigation. See services/higgins/coordinator.py.
"""
from __future__ import annotations

import logging
from typing import Any, Optional, List

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field

from core.models import CallRiskRequest, CallRiskResponse
from core.redaction import redact_investigation_secrets
from services.phonerisk import check_phone_risk
from services.investigation import purpose_limited_url

router = APIRouter()
logger = logging.getLogger("apollo.call")


class PhoneInvestigateRequest(BaseModel):
    device_id: str = Field(min_length=8, max_length=64)
    number: str = Field(min_length=3, max_length=40)
    country: Optional[str] = Field(default=None, min_length=2, max_length=2)
    caller_asks: Optional[List[str]] = Field(default=None, max_length=15)
    caller_claim: Optional[str] = Field(default=None, max_length=50)
    transcript: Optional[str] = Field(default=None, max_length=2000)


class PhoneInvestigateResponse(BaseModel):
    investigation_case_id: Optional[str] = None
    job: Optional[dict[str, Any]] = None
    reputation: Optional[dict[str, Any]] = None


def _reputation_observation(result: Any) -> dict[str, Any]:
    """Build a lightweight observation dict from phone reputation data.

    This is an observation, not an investigation conclusion.
    It provides useful context to Magnum DI and the frontend.
    """
    return {
        "type": "phone_reputation_observation",
        "number": result.number,
        "decision": result.decision,
        "fraud_score": result.fraud_score,
        "recent_abuse": result.recent_abuse,
        "risky": result.risky,
        "voip": result.voip,
        "line_type": result.line_type,
        "carrier": result.carrier,
        "country": result.country,
        "valid": result.valid,
        "active": result.active,
        "source": result.source,
        "cached": result.cached,
        "note": "This is a reputation observation, not an investigation conclusion. "
                "Reputation does not authenticate caller identity.",
    }


@router.post("/call/risk-check", response_model=CallRiskResponse)
async def call_risk_check(body: CallRiskRequest):
    """Automatic protection: quick reputation check. No Gemini. No investigation."""
    result = await check_phone_risk(body.number, body.country, persist_cache=False)
    observation = _reputation_observation(result)
    response = result.model_copy(update={"assessment": observation})
    # Ingest flagged numbers into the Live Caller ID reputation database.
    try:
        from services.caller_id_db import ingest_from_risk_check
        await ingest_from_risk_check(body.number, response.model_dump())
    except Exception:
        pass  # Non-blocking — database growth is best-effort
    return response


@router.post("/call/investigate", response_model=PhoneInvestigateResponse)
async def call_investigate(body: PhoneInvestigateRequest, request: Request):
    """Person-requested phone investigation → shared Magnum DI path.

    1. IPQS reputation check (observation, not investigation).
    2. Creates a Magnum DI investigation case with the number + reputation + user context.
    3. Returns immediately with case ID. Magnum DI investigates asynchronously.
    """
    owner = request.state.device["device_id"]

    # ── Step 1: Phone reputation observation ──
    risk_result = None
    risk_error = None
    try:
        risk_result = await check_phone_risk(body.number, body.country, persist_cache=True)
    except Exception as exc:
        risk_error = str(exc)

    observation = _reputation_observation(risk_result) if risk_result else {
        "type": "phone_reputation_observation",
        "number": body.number,
        "source": "unavailable",
        "error": risk_error or "unknown",
        "note": "Reputation lookup failed. Number will still be investigated by Magnum DI.",
    }

    # ── Step 2: Create Magnum DI investigation case ──
    effective_number = risk_result.number if risk_result else body.number
    question = f"Investigate this phone number: {effective_number}"
    context_parts = []
    if body.caller_asks:
        context_parts.append(f"Caller requested: {', '.join(body.caller_asks[:15])}")
    if body.caller_claim and body.caller_claim != "unknown":
        context_parts.append(f"Caller claimed to be: {body.caller_claim}")
    if body.transcript:
        safe = redact_investigation_secrets(body.transcript.strip()[:2000])
        context_parts.append(f"User description: {safe}")
    if context_parts:
        question += "\n\nCaller context reported by the person:\n" + "\n".join(f"- {p}" for p in context_parts)

    submissions = [{"client_item_id": "phone-number", "kind": "text", "value": effective_number, "label": "Submitted phone number"}]
    intel_evidence = [{
        "label": f"Phone reputation: {effective_number}",
        "summary": (f"Decision: {observation.get('decision', 'unknown')}, "
                    f"Fraud score: {observation.get('fraud_score', 'N/A')}, "
                    f"Source: {observation.get('source', 'unavailable')}, "
                    f"VOIP: {observation.get('voip', 'unknown')}, "
                    f"Line type: {observation.get('line_type', 'unknown')}"),
        **observation,
    }]
    initial_findings = []
    if body.caller_asks:
        initial_findings.append(f"Caller asked the person to: {', '.join(body.caller_asks[:15])}")
    if body.caller_claim and body.caller_claim != "unknown":
        initial_findings.append(f"Caller claimed to be: {body.caller_claim}")

    try:
        from routers.investigations import _launch_investigation
        case_id, job = await _launch_investigation(
            owner, "call", question, submissions,
            initial_findings=initial_findings,
            intel_evidence=intel_evidence,
            source_metadata={"type": "call", "number": body.phone_number[:30], "submitted_at": __import__("core.db", fromlist=["now_utc"]).now_utc().isoformat()},
        )
        return PhoneInvestigateResponse(
            investigation_case_id=case_id,
            job=job,
            reputation=observation,
        )
    except Exception as exc:
        logger.warning("call_investigate case creation failed: %s", type(exc).__name__)
        return PhoneInvestigateResponse(reputation=observation)


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
