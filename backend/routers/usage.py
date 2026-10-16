"""Gemini usage report API endpoints."""
from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Query

from services.gemini_usage import get_usage_report, MODEL_PRICING, PRICING_VERSION

router = APIRouter(tags=["usage"])


@router.get("/usage/gemini")
async def gemini_usage_report(
    days: Optional[int] = Query(default=None, description="Number of days to look back"),
    start: Optional[str] = Query(default=None, description="Start date (ISO 8601)"),
    end: Optional[str] = Query(default=None, description="End date (ISO 8601)"),
    model: Optional[str] = Query(default=None, description="Filter by model name"),
    purpose: Optional[str] = Query(default=None, description="Filter by purpose"),
):
    """Aggregated Gemini API usage report with token counts and estimated costs.

    Returns breakdowns by model and purpose. Costs are estimates based on
    published pricing — actual Google billing charges may differ.
    """
    start_dt = None
    end_dt = None

    if days is not None:
        start_dt = datetime.now(timezone.utc) - timedelta(days=days)
    elif start:
        start_dt = datetime.fromisoformat(start.replace("Z", "+00:00"))
    if end:
        end_dt = datetime.fromisoformat(end.replace("Z", "+00:00"))

    report = await get_usage_report(start=start_dt, end=end_dt, model=model, purpose=purpose)
    return report


@router.get("/usage/gemini/pricing")
async def gemini_pricing():
    """Current model pricing rates used for cost estimation."""
    return {
        "pricing_version": PRICING_VERSION,
        "disclaimer": "These are the rates used to ESTIMATE costs in usage reports. "
                      "Actual Google billing charges may differ.",
        "rates_usd_per_million_tokens": MODEL_PRICING,
    }
