"""Reputation checks, batch checks and feedback."""
from __future__ import annotations

from datetime import timedelta
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from core.config import SAFE_BROWSING_API_KEY
from core.db import db, now_utc
from core.models import ApolloState, IntelCheckRequest, IntelCheckResponse
from services.intel import assess_indicator, run_intel_check, safe_browsing_lookup, _sb_probe

router = APIRouter()


@router.get("/intel/status")
async def intel_status():
    if not SAFE_BROWSING_API_KEY:
        sb = {"status": "not_configured", "detail": "Add SAFE_BROWSING_API_KEY to enable Google Safe Browsing."}
    else:
        stale = _sb_probe["checked_at"] is None or now_utc() - _sb_probe["checked_at"] > timedelta(minutes=10)
        if stale:
            await safe_browsing_lookup("http://testsafebrowsing.appspot.com/s/phishing.html")
        sb = {"status": _sb_probe["status"], "detail": _sb_probe["detail"]}
    count = await db.blocklist.count_documents({"deleted_at": None})
    return {"safe_browsing": sb, "blocklist": {"status": "ok", "entries": count}, "checked_at": now_utc()}


@router.post("/intel/check", response_model=IntelCheckResponse)
async def intel_check(body: IntelCheckRequest):
    return await assess_indicator(body.indicator_type, body.value, body.expand)


class FeedbackIn(BaseModel):
    device_id: str = Field(min_length=8, max_length=64)
    event_id: str = Field(min_length=8, max_length=64)
    kind: Literal["false_positive", "missed_threat", "override"]
    state: ApolloState
    host: Optional[str] = Field(default=None, max_length=253)
    sources: list[str] = Field(default_factory=list, max_length=10)
    note: str = Field(default="", max_length=300)


@router.post("/feedback", status_code=201)
async def submit_feedback(body: FeedbackIn):
    """Report Mistake / user override. Reviewed by humans — never auto-whitelists a site globally."""
    await db.feedback.insert_one({**body.model_dump(), "created_at": now_utc()})
    return {"received": True}


class IntelBatchRequest(BaseModel):
    indicator_type: Literal["url", "domain"] = "url"
    values: list[str] = Field(min_length=1, max_length=200)


class IntelBatchItem(BaseModel):
    value: str
    result: Optional[IntelCheckResponse] = None
    error: Optional[str] = None


@router.post("/intel/check-batch", response_model=list[IntelBatchItem])
async def intel_check_batch(body: IntelBatchRequest):
    """Benchmark support: check many indicators in one round-trip. Same privacy rules as /intel/check."""
    out: list[IntelBatchItem] = []
    for value in body.values:
        try:
            out.append(IntelBatchItem(value=value, result=await run_intel_check(body.indicator_type, value)))
        except HTTPException as exc:
            out.append(IntelBatchItem(value=value, error=str(exc.detail)))
    return out
