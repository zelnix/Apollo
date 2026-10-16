"""Gemini API usage tracking and cost estimation.

Persists actual token counts from every Gemini generation call.
Calculates estimated costs using model-specific pricing rates.
Provides aggregated usage reports by model, purpose and time period.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Optional

from core.db import db

# ── Collection ───────────────────────────────────────────────────────────────
COLLECTION = "gemini_usage"


# ── Model pricing (USD per 1M tokens) ───────────────────────────────────────
# Source: https://ai.google.dev/gemini-api/docs/pricing (retrieved Oct 2026)
# Rates effective through 31 Dec 2026 unless noted.
# IMPORTANT: These are ESTIMATES for reconciliation. Actual Google billing
# charges may differ due to caching, tiered pricing, or rate changes.

PRICING_VERSION = "2026-10-16"

# Each entry: { input, output, thinking, cached_input } in USD per 1M tokens.
# "thinking" tokens are billed at the output rate for most models.
# "cached_input" is the discounted rate for context-cached input tokens.
MODEL_PRICING: dict[str, dict[str, float]] = {
    "gemini-3.8-flash": {
        "input": 0.75,
        "output": 3.75,
        "thinking": 3.75,      # same as output
        "cached_input": 0.075,  # ~10x discount
    },
    "gemini-3.5-flash": {
        "input": 1.50,
        "output": 9.00,
        "thinking": 9.00,
        "cached_input": 0.15,
    },
    "gemini-3.7-flash": {
        "input": 0.75,
        "output": 3.75,
        "thinking": 3.75,
        "cached_input": 0.075,
    },
    "gemini-3.6-flash": {
        "input": 0.75,
        "output": 3.75,
        "thinking": 3.75,
        "cached_input": 0.075,
    },
    "gemini-2.5-flash": {
        "input": 0.30,
        "output": 2.50,
        "thinking": 2.50,
        "cached_input": 0.030,
    },
    "gemini-2.5-pro": {
        "input": 1.25,
        "output": 10.00,
        "thinking": 10.00,
        "cached_input": 0.125,
    },
    "gemini-3.1-pro-preview": {
        "input": 1.25,
        "output": 10.00,
        "thinking": 10.00,
        "cached_input": 0.125,
    },
    "gemini-3-flash-preview": {
        "input": 0.75,
        "output": 3.75,
        "thinking": 3.75,
        "cached_input": 0.075,
    },
}

# Fallback pricing for unknown models
_DEFAULT_PRICING = {
    "input": 1.00,
    "output": 5.00,
    "thinking": 5.00,
    "cached_input": 0.10,
}


def _get_pricing(model: str) -> dict[str, float]:
    """Get pricing for a model, falling back to conservative defaults."""
    return MODEL_PRICING.get(model, _DEFAULT_PRICING)


def estimate_cost_usd(model: str, tokens: dict[str, int | None]) -> float:
    """Calculate estimated cost in USD from actual token counts.

    Returns 0.0 if no usable token data is present.
    Does NOT treat missing values as zero — they are excluded from the calculation.
    """
    pricing = _get_pricing(model)
    cost = 0.0
    has_any = False

    input_tokens = tokens.get("input")
    cached_tokens = tokens.get("cached_input")
    output_tokens = tokens.get("output")
    thinking_tokens = tokens.get("thinking")

    if input_tokens is not None and input_tokens > 0:
        has_any = True
        # Subtract cached tokens from input if both are present
        billable_input = input_tokens
        if cached_tokens is not None and cached_tokens > 0:
            billable_input = max(0, input_tokens - cached_tokens)
            cost += (cached_tokens / 1_000_000) * pricing["cached_input"]
        cost += (billable_input / 1_000_000) * pricing["input"]

    if output_tokens is not None and output_tokens > 0:
        has_any = True
        # Subtract thinking tokens from output if counted separately
        billable_output = output_tokens
        if thinking_tokens is not None and thinking_tokens > 0:
            billable_output = max(0, output_tokens - thinking_tokens)
            cost += (thinking_tokens / 1_000_000) * pricing["thinking"]
        cost += (billable_output / 1_000_000) * pricing["output"]
    elif thinking_tokens is not None and thinking_tokens > 0:
        # Thinking tokens reported without output total
        has_any = True
        cost += (thinking_tokens / 1_000_000) * pricing["thinking"]

    return cost if has_any else 0.0


def _extract_tokens(usage_metadata: dict[str, Any] | None) -> dict[str, int | None]:
    """Extract token counts from Gemini usage_metadata, preserving None for missing values."""
    if not usage_metadata:
        return {"input": None, "output": None, "total": None, "thinking": None, "cached_input": None}

    return {
        "input": usage_metadata.get("prompt_token_count") or usage_metadata.get("input_tokens"),
        "output": usage_metadata.get("candidates_token_count") or usage_metadata.get("output_tokens"),
        "total": usage_metadata.get("total_token_count") or usage_metadata.get("total_tokens"),
        "thinking": usage_metadata.get("thoughts_token_count") or usage_metadata.get("thinking_tokens"),
        "cached_input": usage_metadata.get("cached_content_token_count") or usage_metadata.get("cached_tokens"),
    }


async def record_usage(
    *,
    record_id: str | None = None,
    correlation_id: str | None = None,
    model: str,
    purpose: str,
    call_type: str,
    success: bool,
    failure_code: str | None = None,
    usage_metadata: dict[str, Any] | None = None,
    duration_ms: int | None = None,
    extra: dict[str, Any] | None = None,
) -> str:
    """Persist a single Gemini API call's usage to the database.

    Returns the record_id used (generated if not provided).
    Prevents duplicates via upsert on record_id.
    """
    if record_id is None:
        record_id = str(uuid.uuid4())

    tokens = _extract_tokens(usage_metadata)
    cost = estimate_cost_usd(model, tokens)
    now = datetime.now(timezone.utc)

    doc = {
        "record_id": record_id,
        "correlation_id": correlation_id,
        "timestamp": now,
        "model": model,
        "purpose": purpose,
        "call_type": call_type,
        "success": success,
        "failure_code": failure_code,
        "tokens": tokens,
        "estimated_cost_usd": cost if cost > 0 else None,
        "pricing_version": PRICING_VERSION,
        "pricing_rates": _get_pricing(model),
        "duration_ms": duration_ms,
        "usage_metadata_available": usage_metadata is not None,
    }
    if extra:
        doc["extra"] = extra

    await db[COLLECTION].update_one(
        {"record_id": record_id},
        {"$set": doc, "$setOnInsert": {"created_at": now}},
        upsert=True,
    )
    return record_id


async def get_usage_report(
    *,
    start: datetime | None = None,
    end: datetime | None = None,
    model: str | None = None,
    purpose: str | None = None,
) -> dict[str, Any]:
    """Aggregated usage report with breakdowns by model and purpose.

    Returns calls, tokens, estimated cost, and breakdowns.
    """
    match: dict[str, Any] = {}
    if start or end:
        ts_filter: dict[str, Any] = {}
        if start:
            ts_filter["$gte"] = start
        if end:
            ts_filter["$lte"] = end
        match["timestamp"] = ts_filter
    if model:
        match["model"] = model
    if purpose:
        match["purpose"] = purpose

    pipeline = [
        {"$match": match} if match else {"$match": {}},
        {
            "$group": {
                "_id": {"model": "$model", "purpose": "$purpose"},
                "total_calls": {"$sum": 1},
                "successful_calls": {"$sum": {"$cond": ["$success", 1, 0]}},
                "failed_calls": {"$sum": {"$cond": ["$success", 0, 1]}},
                "total_input_tokens": {"$sum": {"$ifNull": ["$tokens.input", 0]}},
                "total_output_tokens": {"$sum": {"$ifNull": ["$tokens.output", 0]}},
                "total_thinking_tokens": {"$sum": {"$ifNull": ["$tokens.thinking", 0]}},
                "total_cached_tokens": {"$sum": {"$ifNull": ["$tokens.cached_input", 0]}},
                "total_estimated_cost": {"$sum": {"$ifNull": ["$estimated_cost_usd", 0]}},
                "calls_with_usage_data": {"$sum": {"$cond": ["$usage_metadata_available", 1, 0]}},
                "calls_without_usage_data": {"$sum": {"$cond": ["$usage_metadata_available", 0, 1]}},
                "first_call": {"$min": "$timestamp"},
                "last_call": {"$max": "$timestamp"},
            }
        },
        {"$sort": {"total_estimated_cost": -1}},
    ]

    rows = await db[COLLECTION].aggregate(pipeline).to_list(200)

    # Build summary
    total_calls = sum(r["total_calls"] for r in rows)
    total_cost = sum(r["total_estimated_cost"] for r in rows)
    total_input = sum(r["total_input_tokens"] for r in rows)
    total_output = sum(r["total_output_tokens"] for r in rows)
    total_thinking = sum(r["total_thinking_tokens"] for r in rows)
    total_cached = sum(r["total_cached_tokens"] for r in rows)
    with_usage = sum(r["calls_with_usage_data"] for r in rows)
    without_usage = sum(r["calls_without_usage_data"] for r in rows)

    breakdowns = []
    for r in rows:
        breakdowns.append({
            "model": r["_id"]["model"],
            "purpose": r["_id"]["purpose"],
            "calls": r["total_calls"],
            "successful": r["successful_calls"],
            "failed": r["failed_calls"],
            "input_tokens": r["total_input_tokens"],
            "output_tokens": r["total_output_tokens"],
            "thinking_tokens": r["total_thinking_tokens"],
            "cached_tokens": r["total_cached_tokens"],
            "estimated_cost_usd": round(r["total_estimated_cost"], 6),
            "period": {
                "first": r["first_call"].isoformat() if r["first_call"] else None,
                "last": r["last_call"].isoformat() if r["last_call"] else None,
            },
        })

    return {
        "disclaimer": "Costs are ESTIMATES based on published model pricing. "
                      "Actual Google billing charges may differ due to caching discounts, "
                      "tiered pricing, promotional credits or rate changes.",
        "pricing_version": PRICING_VERSION,
        "period": {
            "start": start.isoformat() if start else None,
            "end": end.isoformat() if end else None,
        },
        "summary": {
            "total_calls": total_calls,
            "total_input_tokens": total_input,
            "total_output_tokens": total_output,
            "total_thinking_tokens": total_thinking,
            "total_cached_tokens": total_cached,
            "estimated_total_cost_usd": round(total_cost, 6),
            "calls_with_usage_data": with_usage,
            "calls_without_usage_data": without_usage,
        },
        "by_model_and_purpose": breakdowns,
    }


async def ensure_indexes():
    """Create indexes for efficient querying."""
    coll = db[COLLECTION]
    await coll.create_index("record_id", unique=True)
    await coll.create_index("correlation_id")
    await coll.create_index("timestamp")
    await coll.create_index([("model", 1), ("purpose", 1), ("timestamp", 1)])
