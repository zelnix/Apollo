"""Reputation checks, batch checks and feedback."""
from __future__ import annotations

import asyncio
from datetime import timedelta
from typing import Literal, Optional
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from core.config import SAFE_BROWSING_API_KEY
from core.db import db, now_utc
from core.models import ApolloState, IntelCheckRequest, IntelCheckResponse
from services.intel import expand_redirects, run_intel_check, safe_browsing_lookup, sanitize_url, _sb_probe

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
    if not body.expand or body.indicator_type != "url":
        return await run_intel_check(body.indicator_type, body.value)
    # Bounded as a whole: a slow redirect chain must never hold the check hostage — judge the link as given instead.
    try:
        chain = await asyncio.wait_for(expand_redirects(body.value), timeout=12)
    except asyncio.TimeoutError:
        chain = [body.value]
    final = chain[-1]
    # Judge the final destination; any confirmed-malicious hop along the way also counts.
    result = await run_intel_check("url", final)
    threat_types, sources, verdict = list(result.threat_types), list(result.sources), result.verdict
    for hop in chain[:-1]:
        try:
            r = await run_intel_check("url", hop)
        except HTTPException:
            continue
        if r.verdict == "malicious":
            verdict = "malicious"; threat_types = sorted(set(threat_types + r.threat_types))
    hosts = []
    for u in chain:
        try:
            hosts.append(sanitize_url(u)[1])
        except HTTPException:
            hosts.append(urlparse(u).hostname or u)
    return IntelCheckResponse(verdict=verdict, threat_types=threat_types, sources=sources, indicator_digest=result.indicator_digest, checked_at=result.checked_at, cached=result.cached,
                              coverage=result.coverage, redirect_chain=hosts if len(chain) > 1 else [], final_url=final if len(chain) > 1 else None)


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
