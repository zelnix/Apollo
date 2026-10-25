#!/usr/bin/env python3
"""
17 October Incident Analysis Script
=====================================
Run directly against the production MongoDB to classify all correlation IDs
and investigation calls for the 17 October 2026 incident.

Usage:
    MONGO_URL="mongodb://..." python3 incident_analysis.py
    
Or with the default .env:
    cd /app/backend && python3 scripts/incident_analysis.py

Output: Detailed report classifying every correlation ID by:
  Device | Investigation | Gate | Initiated By | Source | Environment |
  Calls | Total Tokens | Estimated Cost

Grouped totals by:
  - User — Check
  - Apollo — Mailbox Monitor
  - Apollo — Automatic
  - System — Test/Validation
  - Recovery/Resume
  - Unknown/Unattributed

CRITICAL: This script makes ZERO Gemini API calls. It is purely a database
read operation for offline forensic analysis.
"""
import asyncio
import os
import sys
from datetime import datetime, timezone, timedelta
from collections import defaultdict

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from motor.motor_asyncio import AsyncIOMotorClient

try:
    import pytz
    AWST = pytz.timezone("Australia/Perth")
except ImportError:
    AWST = None

MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017/apollo")

# ── Date range for the incident ──
INCIDENT_START = datetime(2026, 10, 17, 0, 0, 0, tzinfo=timezone.utc)
INCIDENT_END = datetime(2026, 10, 17, 23, 59, 59, tzinfo=timezone.utc)
# Burst window of interest (user-reported)
BURST_START = datetime(2026, 10, 17, 9, 8, 0, tzinfo=timezone.utc)
BURST_END = datetime(2026, 10, 17, 9, 15, 0, tzinfo=timezone.utc)


# ── Classification helpers ──

def initiator_label(source):
    """Convert trigger_source to user-friendly label."""
    mapping = {
        "user_initiated": "User — Check",
        "mailbox_monitor": "ApolloSG — Mailbox Monitor",
        "recovery_resume": "Recovery/Resume",
        "validation_test": "System — Test/Validation",
        "health_check": "System — Health Check",
        "chat": "User — Chat",
        "research": "ApolloSG — Research",
        "msg_check": "User — Message Check",
        "phone_check": "User — Phone Check",
        "scam_analysis": "ApolloSG — Automatic",
    }
    return mapping.get(source or "", source or "Unknown")


def initiator_category(source):
    """Broad grouping matching the user's requested classification."""
    if source in ("user_initiated", "chat", "msg_check", "phone_check"):
        return "User — Check"
    if source in ("mailbox_monitor",):
        return "ApolloSG — Mailbox Monitor"
    if source in ("recovery_resume",):
        return "Recovery/Resume"
    if source in ("scam_analysis", "research"):
        return "ApolloSG — Automatic"
    if source in ("validation_test", "health_check"):
        return "System — Test/Validation"
    if source is None or source == "" or source == "None":
        return "Unknown/Unattributed"
    return "Unknown/Unattributed"


def env_label(model_str):
    """Determine environment from model string."""
    if not model_str:
        return "Unknown"
    if model_str.startswith("mock:"):
        return "Mock"
    return "Production"


def fmt_tokens(n):
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}M"
    if n >= 1_000:
        return f"{n / 1_000:.1f}K"
    return str(n)


def to_awst(dt):
    if AWST and dt:
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(AWST).strftime("%d %b %Y %H:%M:%S AWST")
    return str(dt)[:19] + " UTC"


async def main():
    client = AsyncIOMotorClient(MONGO_URL)
    db_name = MONGO_URL.rsplit("/", 1)[-1].split("?")[0] if "/" in MONGO_URL else "apollo"
    db = client[db_name]

    print("=" * 130)
    print("APOLLO — 17 OCTOBER INCIDENT ANALYSIS REPORT")
    print("=" * 130)
    print(f"Report generated:     {to_awst(datetime.now(timezone.utc))}")
    print(f"Incident window:      {to_awst(INCIDENT_START)} — {to_awst(INCIDENT_END)}")
    print(f"Burst focus:          {to_awst(BURST_START)} — {to_awst(BURST_END)}")
    print(f"Database:             {db_name}")
    print(f"Gemini calls:         ZERO (offline analysis only)")
    print()

    # ═══════════════════════════════════════════════════════════════════════
    # SECTION 1: Aggregate all gemini_usage by correlation_id
    # ═══════════════════════════════════════════════════════════════════════
    print("=" * 130)
    print("SECTION 1: OVERALL STATISTICS")
    print("=" * 130)

    total_records = await db.gemini_usage.count_documents(
        {"timestamp": {"$gte": INCIDENT_START, "$lte": INCIDENT_END}}
    )
    total_success = await db.gemini_usage.count_documents(
        {"timestamp": {"$gte": INCIDENT_START, "$lte": INCIDENT_END}, "success": True}
    )
    total_failed = await db.gemini_usage.count_documents(
        {"timestamp": {"$gte": INCIDENT_START, "$lte": INCIDENT_END}, "success": False}
    )

    print(f"Total gemini_usage records:  {total_records:,}")
    print(f"  Successful:                {total_success:,}")
    print(f"  Failed:                    {total_failed:,}")

    # By purpose
    purpose_pipeline = [
        {"$match": {"timestamp": {"$gte": INCIDENT_START, "$lte": INCIDENT_END}}},
        {"$group": {
            "_id": "$purpose",
            "calls": {"$sum": 1},
            "ok": {"$sum": {"$cond": ["$success", 1, 0]}},
            "fail": {"$sum": {"$cond": ["$success", 0, 1]}},
            "input_tokens": {"$sum": {"$ifNull": ["$tokens.input", 0]}},
            "output_tokens": {"$sum": {"$ifNull": ["$tokens.output", 0]}},
            "thinking_tokens": {"$sum": {"$ifNull": ["$tokens.thinking", 0]}},
            "cost": {"$sum": {"$ifNull": ["$estimated_cost_usd", 0]}},
        }},
        {"$sort": {"cost": -1}},
    ]
    by_purpose = await db.gemini_usage.aggregate(purpose_pipeline).to_list(50)

    print(f"\nBy Purpose:")
    print(f"  {'Purpose':<20} {'Calls':>8} {'OK':>6} {'Fail':>6} {'Input Tokens':>15} {'Output':>12} {'Thinking':>12} {'Est Cost':>12}")
    print(f"  {'-'*100}")
    for p in by_purpose:
        total = p["input_tokens"] + p["output_tokens"] + p["thinking_tokens"]
        print(f"  {str(p['_id']):<20} {p['calls']:>8,} {p['ok']:>6,} {p['fail']:>6,} {p['input_tokens']:>15,} {p['output_tokens']:>12,} {p['thinking_tokens']:>12,} ${p['cost']:>10.4f}")
    print()

    # ═══════════════════════════════════════════════════════════════════════
    # SECTION 2: Aggregate by correlation_id
    # ═══════════════════════════════════════════════════════════════════════
    print("=" * 130)
    print("SECTION 2: ALL CORRELATION IDs")
    print("=" * 130)

    corr_pipeline = [
        {"$match": {"timestamp": {"$gte": INCIDENT_START, "$lte": INCIDENT_END}}},
        {"$group": {
            "_id": "$correlation_id",
            "calls": {"$sum": 1},
            "ok": {"$sum": {"$cond": ["$success", 1, 0]}},
            "fail": {"$sum": {"$cond": ["$success", 0, 1]}},
            "input_tokens": {"$sum": {"$ifNull": ["$tokens.input", 0]}},
            "output_tokens": {"$sum": {"$ifNull": ["$tokens.output", 0]}},
            "thinking_tokens": {"$sum": {"$ifNull": ["$tokens.thinking", 0]}},
            "cached_tokens": {"$sum": {"$ifNull": ["$tokens.cached_input", 0]}},
            "cost": {"$sum": {"$ifNull": ["$estimated_cost_usd", 0]}},
            "first_call": {"$min": "$timestamp"},
            "last_call": {"$max": "$timestamp"},
            "purposes": {"$addToSet": "$purpose"},
            "models": {"$addToSet": "$model"},
            "sources": {"$addToSet": "$extra.trigger_source"},
        }},
        {"$sort": {"cost": -1}},
    ]
    all_corr_groups = await db.gemini_usage.aggregate(corr_pipeline).to_list(5000)

    # Separate investigation (case-*) from non-investigation
    inv_groups = []
    non_inv_groups = []
    for g in all_corr_groups:
        cid = g["_id"] or ""
        if cid.startswith("case-"):
            inv_groups.append(g)
        else:
            non_inv_groups.append(g)

    print(f"Total unique correlation_ids:  {len(all_corr_groups):,}")
    print(f"  Investigation (case-*):      {len(inv_groups):,}")
    print(f"  Non-investigation:           {len(non_inv_groups):,}")
    print()

    # ═══════════════════════════════════════════════════════════════════════
    # SECTION 3: Cross-reference with investigation_cases
    # ═══════════════════════════════════════════════════════════════════════
    print("=" * 130)
    print("SECTION 3: INVESTIGATION CASE ATTRIBUTION")
    print("=" * 130)

    case_ids = [g["_id"][5:] for g in inv_groups]  # strip "case-"
    cases_map = {}
    jobs_map = {}

    if case_ids:
        async for c in db.investigation_cases.find({"case_id": {"$in": case_ids}}, {"_id": 0}):
            cases_map[c["case_id"]] = c

        async for j in db.investigation_jobs.find(
            {"case_id": {"$in": case_ids}},
            {"_id": 0, "case_id": 1, "source": 1, "created_at": 1, "status": 1, "auto_resume_count": 1}
        ).sort("created_at", 1):
            if j["case_id"] not in jobs_map:
                jobs_map[j["case_id"]] = j

    print(f"Cases found in investigation_cases: {len(cases_map):,} / {len(case_ids):,}")
    print(f"Jobs found in investigation_jobs:   {len(jobs_map):,}")
    print()

    # ═══════════════════════════════════════════════════════════════════════
    # SECTION 4: FULL CLASSIFICATION TABLE
    # ═══════════════════════════════════════════════════════════════════════
    print("=" * 130)
    print("SECTION 4: FULL INVESTIGATION CLASSIFICATION TABLE")
    print("=" * 130)
    print(f"{'#':>4} {'Device':<20} {'Investigation':<35} {'Gate':<15} {'Initiated By':<25} {'Source':<18} {'Env':<6} {'Calls':>6} {'Total Tokens':>14} {'Est Cost':>12}")
    print("-" * 175)

    report_rows = []
    by_initiator = defaultdict(lambda: {"investigations": 0, "calls": 0, "tokens": 0, "cost": 0.0})

    for g in inv_groups:
        case_id = g["_id"][5:]
        case = cases_map.get(case_id, {})
        job = jobs_map.get(case_id, {})

        # Device
        device = "No device"
        dev_profile = case.get("device_profile")
        if dev_profile:
            device = dev_profile.get("deviceName") or dev_profile.get("model") or dev_profile.get("brand", "No device")

        # Gate
        gates = case.get("gates", [])
        gate_str = ", ".join(gates) if gates else "None/System"

        # Source/Initiated By
        source = job.get("source") or (g["sources"][0] if g["sources"] and g["sources"][0] else None)
        init_label = initiator_label(source)
        init_cat = initiator_category(source)

        # Environment
        env = env_label(g["models"][0] if g["models"] else None)

        # Resumed
        resumed = (job.get("auto_resume_count") or 0) > 0

        # Description
        case_id_short = case_id[:8]
        desc = f"{gate_str} — #{case_id_short}" if gate_str != "None/System" else f"Investigation — #{case_id_short}"
        if resumed:
            desc += " [RESUMED]"

        # Totals
        total_tokens = g["input_tokens"] + g["output_tokens"] + g["thinking_tokens"]

        row = {
            "case_id": case_id,
            "device": device,
            "desc": desc,
            "gate": gate_str,
            "initiator": init_label,
            "initiator_cat": init_cat,
            "source": source,
            "env": env,
            "calls": g["calls"],
            "total_tokens": total_tokens,
            "cost": g["cost"],
            "first_call": g["first_call"],
            "last_call": g["last_call"],
            "resumed": resumed,
        }
        report_rows.append(row)

        b = by_initiator[init_cat]
        b["investigations"] += 1
        b["calls"] += g["calls"]
        b["tokens"] += total_tokens
        b["cost"] += g["cost"]

    for idx, r in enumerate(report_rows, 1):
        print(f"{idx:>4} {r['device']:<20} {r['desc']:<35} {r['gate']:<15} {r['initiator']:<25} {str(r['source'] or '—'):<18} {r['env']:<6} {r['calls']:>6,} {r['total_tokens']:>14,} ${r['cost']:>10.4f}")

    print("-" * 175)
    total_inv_calls = sum(r["calls"] for r in report_rows)
    total_inv_tokens = sum(r["total_tokens"] for r in report_rows)
    total_inv_cost = sum(r["cost"] for r in report_rows)
    print(f"{'':>4} {'TOTAL':.<20} {len(report_rows):,} investigations{'':<20} {'':<15} {'':<25} {'':<18} {'':<6} {total_inv_calls:>6,} {total_inv_tokens:>14,} ${total_inv_cost:>10.4f}")
    print()

    # ═══════════════════════════════════════════════════════════════════════
    # SECTION 5: GROUPED TOTALS BY INITIATED BY
    # ═══════════════════════════════════════════════════════════════════════
    print("=" * 130)
    print("SECTION 5: GROUPED TOTALS BY INITIATED BY")
    print("=" * 130)
    print(f"{'Category':<30} {'Investigations':>15} {'Gemini Calls':>14} {'Total Tokens':>14} {'Est Cost':>14} {'% of Cost':>10}")
    print("-" * 100)

    # Ensure all requested categories appear
    REQUIRED_CATS = [
        "User — Check",
        "ApolloSG — Mailbox Monitor",
        "ApolloSG — Automatic",
        "System — Test/Validation",
        "Recovery/Resume",
        "Unknown/Unattributed",
    ]
    for cat in REQUIRED_CATS:
        if cat not in by_initiator:
            by_initiator[cat] = {"investigations": 0, "calls": 0, "tokens": 0, "cost": 0.0}

    for cat in REQUIRED_CATS:
        b = by_initiator[cat]
        pct = (b["cost"] / total_inv_cost * 100) if total_inv_cost > 0 else 0
        print(f"  {cat:<28} {b['investigations']:>15,} {b['calls']:>14,} {b['tokens']:>14,} ${b['cost']:>12.4f} {pct:>9.1f}%")

    # Any extra categories not in the required list
    for cat, b in sorted(by_initiator.items()):
        if cat not in REQUIRED_CATS:
            pct = (b["cost"] / total_inv_cost * 100) if total_inv_cost > 0 else 0
            print(f"  {cat:<28} {b['investigations']:>15,} {b['calls']:>14,} {b['tokens']:>14,} ${b['cost']:>12.4f} {pct:>9.1f}%")

    print("-" * 100)
    total_all_cats_cost = sum(b["cost"] for b in by_initiator.values())
    total_all_cats_calls = sum(b["calls"] for b in by_initiator.values())
    total_all_cats_tokens = sum(b["tokens"] for b in by_initiator.values())
    total_all_cats_inv = sum(b["investigations"] for b in by_initiator.values())
    print(f"  {'TOTAL':<28} {total_all_cats_inv:>15,} {total_all_cats_calls:>14,} {total_all_cats_tokens:>14,} ${total_all_cats_cost:>12.4f} {'100.0':>9}%")
    print()

    # Non-investigation calls
    non_inv_calls = sum(g["calls"] for g in non_inv_groups)
    non_inv_tokens = sum(g["input_tokens"] + g["output_tokens"] + g["thinking_tokens"] for g in non_inv_groups)
    non_inv_cost = sum(g["cost"] for g in non_inv_groups)
    print(f"  Non-investigation calls:     {non_inv_calls:,} calls, {fmt_tokens(non_inv_tokens)} tokens, ${non_inv_cost:.4f}")
    print(f"  Grand total (all calls):     {total_records:,} calls, ${total_inv_cost + non_inv_cost:.4f}")
    print()

    # ═══════════════════════════════════════════════════════════════════════
    # SECTION 6: NON-INVESTIGATION CALLS
    # ═══════════════════════════════════════════════════════════════════════
    print("=" * 130)
    print("SECTION 6: NON-INVESTIGATION CORRELATION IDs")
    print("=" * 130)
    print(f"{'#':>4} {'Correlation ID':<40} {'Purpose':<20} {'Source':<18} {'Calls':>6} {'Tokens':>14} {'Est Cost':>12}")
    print("-" * 120)

    for idx, g in enumerate(non_inv_groups, 1):
        cid = str(g["_id"] or "NULL")[:38]
        purposes = ", ".join(g["purposes"][:3])
        srcs = ", ".join(str(s) for s in g["sources"][:2] if s) or "—"
        total_tokens = g["input_tokens"] + g["output_tokens"] + g["thinking_tokens"]
        print(f"{idx:>4} {cid:<40} {purposes:<20} {srcs:<18} {g['calls']:>6,} {total_tokens:>14,} ${g['cost']:>10.4f}")

    print("-" * 120)
    print(f"{'':>4} {'TOTAL':<40} {'':<20} {'':<18} {non_inv_calls:>6,} {non_inv_tokens:>14,} ${non_inv_cost:>10.4f}")
    print()

    # ═══════════════════════════════════════════════════════════════════════
    # SECTION 7: TEMPORAL BURST ANALYSIS (09:08-09:15 UTC focus)
    # ═══════════════════════════════════════════════════════════════════════
    print("=" * 130)
    print("SECTION 7: TEMPORAL BURST ANALYSIS (minute-by-minute)")
    print("=" * 130)

    burst_pipeline = [
        {"$match": {"timestamp": {"$gte": INCIDENT_START, "$lte": INCIDENT_END}}},
        {"$group": {
            "_id": {"$dateToString": {"format": "%Y-%m-%dT%H:%M", "date": "$timestamp"}},
            "calls": {"$sum": 1},
            "cost": {"$sum": {"$ifNull": ["$estimated_cost_usd", 0]}},
            "input_tokens": {"$sum": {"$ifNull": ["$tokens.input", 0]}},
            "purposes": {"$addToSet": "$purpose"},
            "sources": {"$addToSet": "$extra.trigger_source"},
            "corr_ids": {"$addToSet": "$correlation_id"},
        }},
        {"$sort": {"_id": 1}},
    ]
    burst_data = await db.gemini_usage.aggregate(burst_pipeline).to_list(5000)

    # Show minutes with >= 3 calls
    active_minutes = [b for b in burst_data if b["calls"] >= 3]

    print(f"Active minutes (>=3 calls): {len(active_minutes)} of {len(burst_data)} total minutes")
    print()
    print(f"  {'Minute (UTC)':<20} {'AWST':<12} {'Calls':>6} {'Input Tokens':>14} {'Est Cost':>10} {'Purposes':<30} {'Sources':<25} {'CorrIDs':>8}")
    print(f"  {'-'*135}")

    for b in active_minutes:
        minute_utc = b["_id"]
        try:
            dt_utc = datetime.strptime(minute_utc, "%Y-%m-%dT%H:%M").replace(tzinfo=timezone.utc)
            awst_str = dt_utc.astimezone(AWST).strftime("%H:%M") if AWST else "—"
        except Exception:
            awst_str = "—"

        is_burst = b["calls"] >= 10
        marker = " ***" if is_burst else ""
        purposes = ", ".join(b["purposes"][:3])
        sources = ", ".join(str(s) for s in b["sources"][:3] if s) or "—"
        print(f"  {minute_utc:<20} {awst_str:<12} {b['calls']:>6,} {b['input_tokens']:>14,} ${b['cost']:>8.4f}  {purposes:<30} {sources:<25} {len(b['corr_ids']):>8}{marker}")

    # Specific burst window analysis
    burst_window_pipeline = [
        {"$match": {"timestamp": {"$gte": BURST_START, "$lte": BURST_END}}},
        {"$group": {
            "_id": None,
            "calls": {"$sum": 1},
            "cost": {"$sum": {"$ifNull": ["$estimated_cost_usd", 0]}},
            "input_tokens": {"$sum": {"$ifNull": ["$tokens.input", 0]}},
            "corr_ids": {"$addToSet": "$correlation_id"},
            "sources": {"$addToSet": "$extra.trigger_source"},
        }},
    ]
    burst_window = await db.gemini_usage.aggregate(burst_window_pipeline).to_list(1)

    if burst_window:
        bw = burst_window[0]
        print()
        print(f"  BURST WINDOW (09:08-09:15 UTC / 17:08-17:15 AWST):")
        print(f"    Calls:          {bw['calls']:,}")
        print(f"    Input tokens:   {bw['input_tokens']:,}")
        print(f"    Estimated cost: ${bw['cost']:.4f}")
        print(f"    Correlation IDs: {len(bw['corr_ids'])}")
        print(f"    Sources:        {[s for s in bw['sources'] if s]}")
    print()

    # ═══════════════════════════════════════════════════════════════════════
    # SECTION 8: FAILURE ANALYSIS
    # ═══════════════════════════════════════════════════════════════════════
    print("=" * 130)
    print("SECTION 8: FAILURE ANALYSIS")
    print("=" * 130)

    fail_pipeline = [
        {"$match": {"timestamp": {"$gte": INCIDENT_START, "$lte": INCIDENT_END}, "success": False}},
        {"$group": {
            "_id": {"purpose": "$purpose", "failure_code": "$failure_code"},
            "count": {"$sum": 1},
            "first": {"$min": "$timestamp"},
            "last": {"$max": "$timestamp"},
        }},
        {"$sort": {"count": -1}},
    ]
    failures = await db.gemini_usage.aggregate(fail_pipeline).to_list(50)

    if failures:
        print(f"{'Purpose':<20} {'Failure Code':<30} {'Count':>8} {'First (UTC)':>22} {'Last (UTC)':>22}")
        print("-" * 110)
        for f in failures:
            print(f"{str(f['_id']['purpose']):<20} {str(f['_id']['failure_code']):<30} {f['count']:>8} {str(f['first'])[:19]:>22} {str(f['last'])[:19]:>22}")
    else:
        print("No failures recorded in this period.")
    print()

    # ═══════════════════════════════════════════════════════════════════════
    # SECTION 9: RECONCILIATION SUMMARY
    # ═══════════════════════════════════════════════════════════════════════
    print("=" * 130)
    print("SECTION 9: RECONCILIATION SUMMARY")
    print("=" * 130)

    total_attributed = total_inv_calls + non_inv_calls
    total_attributed_cost = total_inv_cost + non_inv_cost
    discrepancy_calls = total_records - total_attributed
    discrepancy_cost = (total_inv_cost + non_inv_cost)

    print(f"  Investigation-attributed:  {total_inv_calls:>8,} calls  ${total_inv_cost:>10.4f}")
    print(f"  Non-investigation:         {non_inv_calls:>8,} calls  ${non_inv_cost:>10.4f}")
    print(f"  Sum (all attributed):      {total_attributed:>8,} calls  ${total_attributed_cost:>10.4f}")
    print(f"  Overall DB records:        {total_records:>8,} calls")
    print(f"  Discrepancy:               {discrepancy_calls:>+8,} calls")
    print()

    # Success-only totals (matching dashboard display)
    success_pipeline = [
        {"$match": {"timestamp": {"$gte": INCIDENT_START, "$lte": INCIDENT_END}, "success": True}},
        {"$group": {
            "_id": "$purpose",
            "calls": {"$sum": 1},
            "input": {"$sum": {"$ifNull": ["$tokens.input", 0]}},
            "cost": {"$sum": {"$ifNull": ["$estimated_cost_usd", 0]}},
        }},
    ]
    by_purpose_success = await db.gemini_usage.aggregate(success_pipeline).to_list(20)
    total_success_calls = sum(r["calls"] for r in by_purpose_success)
    total_success_cost = sum(r["cost"] for r in by_purpose_success)

    print(f"  Dashboard-equivalent (success-only):")
    for r in by_purpose_success:
        print(f"    {str(r['_id']):<20} {r['calls']:>6,} calls  ${r['cost']:.4f}")
    print(f"    {'TOTAL':<20} {total_success_calls:>6,} calls  ${total_success_cost:.4f}")
    print()

    print(f"  User-reported dashboard values on 17 Oct:")
    print(f"    955 Gemini calls, $12.5611 estimated")
    print(f"    856 investigation calls / $12.2542")
    print(f"    99 research calls / $0.3069")
    print(f"    75 HTTP 402 failures")
    print()
    match_status = "RECONCILED" if abs(total_success_calls - 955) < 10 else "DISCREPANCY"
    print(f"  Match status: {match_status} (DB={total_success_calls:,} vs reported=955)")
    print()

    # ═══════════════════════════════════════════════════════════════════════
    # SECTION 10: COST GAP ANALYSIS
    # ═══════════════════════════════════════════════════════════════════════
    print("=" * 130)
    print("SECTION 10: ESTIMATED vs ACTUAL COST GAP")
    print("=" * 130)

    # Count research calls (Google Search grounding)
    research_count = 0
    for p in by_purpose:
        if p["_id"] == "research":
            research_count = p["calls"]
    
    grounding_cost = research_count * 0.035  # $35/1k queries
    print(f"  ApolloSG estimated total:                ${total_success_cost:.4f}")
    print(f"  Google Search grounding ({research_count} research):  +${grounding_cost:.4f}  (at $35/1k queries)")
    print(f"  Pricing table drift (estimated):       +$1.00 — $3.00")
    print(f"  Estimated actual range:                ${total_success_cost + grounding_cost + 1:.2f} — ${total_success_cost + grounding_cost + 3:.2f}")
    print(f"  Actual credit reduction (user-reported): ~$19.00")
    print()

    print("=" * 130)
    print("END OF 17 OCTOBER INCIDENT ANALYSIS REPORT")
    print("=" * 130)

    client.close()


if __name__ == "__main__":
    asyncio.run(main())
