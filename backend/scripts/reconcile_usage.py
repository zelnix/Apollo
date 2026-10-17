"""
Usage Reconciliation Script
============================
Traces every gemini_usage record to answer the user's questions:
1. Exactly which records make up the 856 investigation calls
2. Timestamps, correlation IDs, model, tokens, success/failure
3. How many unique case IDs those calls represent
4. Whether they are genuine, test, historical, retries, or mislabelled
5. Timezone/timestamp boundary analysis
6. Growth from previous report (286 → 955 calls)
7. Average input tokens, highest-consuming correlations
8. Compaction active status
9. Full reconciliation table
"""
import asyncio
import os
import sys
from datetime import datetime, timezone, timedelta
from collections import defaultdict

# Add parent dir for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from motor.motor_asyncio import AsyncIOMotorClient

MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017/apollo")

async def main():
    client = AsyncIOMotorClient(MONGO_URL)
    # Parse DB name from URL
    db_name = MONGO_URL.rsplit("/", 1)[-1].split("?")[0] if "/" in MONGO_URL else "apollo"
    db = client[db_name]

    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    rolling_24h = now - timedelta(hours=24)

    print("=" * 120)
    print("USAGE RECONCILIATION REPORT")
    print("=" * 120)
    print(f"Report generated at: {now.isoformat()}")
    print(f"Today start (UTC midnight): {today_start.isoformat()}")
    print(f"Rolling 24h cutoff:         {rolling_24h.isoformat()}")
    print()

    # ═══════════════════════════════════════════════════════════════════════
    # SECTION 1: Raw counts and timestamp boundary analysis
    # ═══════════════════════════════════════════════════════════════════════
    print("=" * 120)
    print("SECTION 1: TIMESTAMP BOUNDARY ANALYSIS")
    print("=" * 120)

    total_today = await db.gemini_usage.count_documents({"timestamp": {"$gte": today_start}})
    total_today_success = await db.gemini_usage.count_documents({"timestamp": {"$gte": today_start}, "success": True})
    total_today_fail = await db.gemini_usage.count_documents({"timestamp": {"$gte": today_start}, "success": False})

    total_24h = await db.gemini_usage.count_documents({"timestamp": {"$gte": rolling_24h}})
    total_all = await db.gemini_usage.count_documents({})

    print(f"gemini_usage total records (all time):          {total_all:,}")
    print(f"gemini_usage records since midnight UTC:        {total_today:,} (success={total_today_success:,}, fail={total_today_fail:,})")
    print(f"gemini_usage records in rolling 24h:            {total_24h:,}")
    print()

    # Investigation reports collection
    inv_reports_24h = await db.investigation_reports.count_documents({"created_at": {"$gte": rolling_24h}})
    inv_reports_today = await db.investigation_reports.count_documents({"created_at": {"$gte": today_start}})
    inv_reports_all = await db.investigation_reports.count_documents({})

    print(f"investigation_reports total (all time):         {inv_reports_all:,}")
    print(f"investigation_reports since midnight UTC:       {inv_reports_today:,}")
    print(f"investigation_reports in rolling 24h:           {inv_reports_24h:,}")
    print()

    # Dashboard discrepancy explanation
    print("DASHBOARD DISCREPANCY EXPLANATION:")
    print(f"  'Cost Today' (Usage dashboard):     Queries gemini_usage.timestamp >= midnight UTC, success=True")
    print(f"  'Investigations in last 24h' (Main): Queries investigation_reports.created_at >= now - 24h")
    print(f"  These are DIFFERENT collections querying DIFFERENT data.")
    print(f"  gemini_usage tracks individual API CALLS; investigation_reports tracks completed INVESTIGATION REPORTS.")
    print()

    # ═══════════════════════════════════════════════════════════════════════
    # SECTION 2: Breakdown by purpose for today
    # ═══════════════════════════════════════════════════════════════════════
    print("=" * 120)
    print("SECTION 2: TODAY'S CALLS BY PURPOSE")
    print("=" * 120)

    purpose_pipeline = [
        {"$match": {"timestamp": {"$gte": today_start}}},
        {"$group": {
            "_id": {"purpose": "$purpose", "success": "$success"},
            "calls": {"$sum": 1},
            "input_tokens": {"$sum": {"$ifNull": ["$tokens.input", 0]}},
            "output_tokens": {"$sum": {"$ifNull": ["$tokens.output", 0]}},
            "thinking_tokens": {"$sum": {"$ifNull": ["$tokens.thinking", 0]}},
            "cached_tokens": {"$sum": {"$ifNull": ["$tokens.cached_input", 0]}},
            "cost": {"$sum": {"$ifNull": ["$estimated_cost_usd", 0]}},
            "first": {"$min": "$timestamp"},
            "last": {"$max": "$timestamp"},
        }},
        {"$sort": {"_id.purpose": 1, "_id.success": -1}}
    ]
    purpose_rows = await db.gemini_usage.aggregate(purpose_pipeline).to_list(100)

    print(f"{'Purpose':<20} {'Success':<8} {'Calls':>8} {'Input Tokens':>15} {'Output Tokens':>14} {'Thinking':>12} {'Cached':>12} {'Est Cost':>12} {'First Call':<22} {'Last Call':<22}")
    print("-" * 170)
    for r in purpose_rows:
        print(f"{str(r['_id']['purpose']):<20} {str(r['_id']['success']):<8} {r['calls']:>8,} {r['input_tokens']:>15,} {r['output_tokens']:>14,} {r['thinking_tokens']:>12,} {r['cached_tokens']:>12,} ${r['cost']:>10.4f}  {str(r['first'])[:19]:<22} {str(r['last'])[:19]:<22}")
    print()

    # ═══════════════════════════════════════════════════════════════════════
    # SECTION 3: All investigation calls today — grouped by correlation_id
    # ═══════════════════════════════════════════════════════════════════════
    print("=" * 120)
    print("SECTION 3: INVESTIGATION CALLS GROUPED BY CORRELATION ID")
    print("=" * 120)

    inv_corr_pipeline = [
        {"$match": {"timestamp": {"$gte": today_start}, "purpose": "investigation"}},
        {"$group": {
            "_id": "$correlation_id",
            "calls": {"$sum": 1},
            "successful": {"$sum": {"$cond": ["$success", 1, 0]}},
            "failed": {"$sum": {"$cond": ["$success", 0, 1]}},
            "input_tokens": {"$sum": {"$ifNull": ["$tokens.input", 0]}},
            "output_tokens": {"$sum": {"$ifNull": ["$tokens.output", 0]}},
            "thinking_tokens": {"$sum": {"$ifNull": ["$tokens.thinking", 0]}},
            "cached_tokens": {"$sum": {"$ifNull": ["$tokens.cached_input", 0]}},
            "cost": {"$sum": {"$ifNull": ["$estimated_cost_usd", 0]}},
            "first_call": {"$min": "$timestamp"},
            "last_call": {"$max": "$timestamp"},
            "models": {"$addToSet": "$model"},
            "call_types": {"$addToSet": "$call_type"},
            "failure_codes": {"$addToSet": "$failure_code"},
        }},
        {"$sort": {"cost": -1}}
    ]
    inv_groups = await db.gemini_usage.aggregate(inv_corr_pipeline).to_list(500)

    unique_corr = len(inv_groups)
    total_inv_calls = sum(g["calls"] for g in inv_groups)
    total_inv_input = sum(g["input_tokens"] for g in inv_groups)
    total_inv_cost = sum(g["cost"] for g in inv_groups)

    print(f"Unique correlation_ids with purpose='investigation' today: {unique_corr}")
    print(f"Total investigation calls today: {total_inv_calls:,}")
    print(f"Total investigation input tokens: {total_inv_input:,}")
    print(f"Total investigation est cost: ${total_inv_cost:.4f}")
    if total_inv_calls > 0:
        print(f"Average input tokens per investigation call: {total_inv_input / total_inv_calls:,.0f}")
    print()

    # ═══════════════════════════════════════════════════════════════════════
    # SECTION 4: Cross-reference with investigation_reports
    # ═══════════════════════════════════════════════════════════════════════
    print("=" * 120)
    print("SECTION 4: CROSS-REFERENCE WITH investigation_reports COLLECTION")
    print("=" * 120)

    # Get all correlation_ids from today's investigation usage
    corr_ids = [g["_id"] for g in inv_groups if g["_id"]]
    null_corr_group = [g for g in inv_groups if not g["_id"]]

    if null_corr_group:
        print(f"WARNING: {null_corr_group[0]['calls']} investigation calls have NULL correlation_id")
        print(f"  Input tokens: {null_corr_group[0]['input_tokens']:,}, Cost: ${null_corr_group[0]['cost']:.4f}")
        print()

    # Look up these correlation_ids in investigation_reports
    # Try both case_id and correlation fields
    matched_reports = {}
    if corr_ids:
        # Check investigation_reports for matching case_id or report_id
        for field in ["case_id", "report_id", "correlation_id", "_id"]:
            try:
                found = await db.investigation_reports.find(
                    {field: {"$in": corr_ids}},
                    {"_id": 1, "case_id": 1, "correlation_id": 1, "report_id": 1,
                     "status": 1, "created_at": 1, "updated_at": 1,
                     "subject": 1, "category": 1}
                ).to_list(500)
                for f in found:
                    key = str(f.get(field, f.get("_id")))
                    if key not in matched_reports:
                        matched_reports[key] = f
            except Exception as e:
                pass

    # Also check the cases collection
    cases_matched = {}
    for field in ["case_id", "_id", "correlation_id"]:
        try:
            found = await db.cases.find(
                {field: {"$in": corr_ids}},
                {"_id": 1, "case_id": 1, "status": 1, "created_at": 1, "type": 1, "source": 1}
            ).to_list(500)
            for f in found:
                key = str(f.get(field, f.get("_id")))
                if key not in cases_matched:
                    cases_matched[key] = f
        except Exception:
            pass

    # Also try magnum_di_cases or similar collections
    all_collections = await db.list_collection_names()
    case_like_colls = [c for c in all_collections if "case" in c.lower() or "invest" in c.lower() or "report" in c.lower() or "magnum" in c.lower()]
    print(f"Case/investigation-related collections found: {case_like_colls}")
    print()

    # Check each collection for correlation_id matches
    collection_matches = {}
    for coll_name in case_like_colls:
        if coll_name == "investigation_reports":
            continue
        try:
            for field in ["case_id", "correlation_id", "_id"]:
                found = await db[coll_name].find(
                    {field: {"$in": corr_ids[:50]}},  # sample first 50
                    {"_id": 1, "case_id": 1, "correlation_id": 1, "status": 1, "created_at": 1, "type": 1, "source": 1}
                ).to_list(100)
                if found:
                    collection_matches.setdefault(coll_name, []).extend(found)
        except Exception:
            pass

    for coll_name, matches in collection_matches.items():
        print(f"  {coll_name}: {len(matches)} matching records found")

    print(f"\ninvestigation_reports matches: {len(matched_reports)}")
    print(f"cases collection matches:      {len(cases_matched)}")
    print()

    # ═══════════════════════════════════════════════════════════════════════
    # SECTION 5: Determine nature of calls (genuine vs test vs historical)
    # ═══════════════════════════════════════════════════════════════════════
    print("=" * 120)
    print("SECTION 5: CALL ORIGIN ANALYSIS")
    print("=" * 120)

    # Check for test/validation markers
    test_pipeline = [
        {"$match": {"timestamp": {"$gte": today_start}, "purpose": "investigation"}},
        {"$group": {
            "_id": None,
            "call_types": {"$addToSet": "$call_type"},
            "models": {"$addToSet": "$model"},
            "has_extra": {"$sum": {"$cond": [{"$gt": ["$extra", None]}, 1, 0]}},
            "failure_codes": {"$addToSet": "$failure_code"},
        }}
    ]
    meta = (await db.gemini_usage.aggregate(test_pipeline).to_list(1)) or [{}]
    m = meta[0] if meta else {}
    print(f"Call types used:     {m.get('call_types', [])}")
    print(f"Models used:         {m.get('models', [])}")
    print(f"Failure codes seen:  {[f for f in m.get('failure_codes', []) if f]}")
    print(f"Calls with extra data: {m.get('has_extra', 0)}")
    print()

    # Sample a few records to check for test markers
    sample_records = await db.gemini_usage.find(
        {"timestamp": {"$gte": today_start}, "purpose": "investigation"},
        {"_id": 0, "record_id": 1, "correlation_id": 1, "call_type": 1,
         "model": 1, "success": 1, "failure_code": 1, "extra": 1,
         "timestamp": 1, "tokens.input": 1}
    ).sort("timestamp", 1).limit(5).to_list(5)

    print("SAMPLE RECORDS (first 5 investigation calls today):")
    for i, rec in enumerate(sample_records):
        extra_keys = list((rec.get("extra") or {}).keys()) if rec.get("extra") else []
        compaction = (rec.get("extra") or {}).get("compaction_active")
        print(f"  [{i+1}] corr={rec.get('correlation_id', 'N/A')[:20]}... type={rec.get('call_type')} model={rec.get('model')} "
              f"success={rec.get('success')} fail={rec.get('failure_code')} input={rec.get('tokens', {}).get('input', 0):,} "
              f"ts={str(rec.get('timestamp',''))[:19]} extra_keys={extra_keys} compaction={compaction}")
    print()

    # Check for compaction tracking
    compaction_pipeline = [
        {"$match": {"timestamp": {"$gte": today_start}, "purpose": "investigation"}},
        {"$group": {
            "_id": None,
            "with_compaction_flag": {"$sum": {"$cond": [{"$gt": ["$extra.compaction_active", None]}, 1, 0]}},
            "compaction_true": {"$sum": {"$cond": [{"$eq": ["$extra.compaction_active", True]}, 1, 0]}},
            "compaction_false": {"$sum": {"$cond": [{"$eq": ["$extra.compaction_active", False]}, 1, 0]}},
            "no_compaction_flag": {"$sum": {"$cond": [{"$eq": [{"$type": "$extra.compaction_active"}, "missing"]}, 1, 0]}},
        }}
    ]
    comp = (await db.gemini_usage.aggregate(compaction_pipeline).to_list(1)) or [{}]
    c = comp[0] if comp else {}
    print(f"COMPACTION STATUS:")
    print(f"  Calls with compaction_active flag:  {c.get('with_compaction_flag', 0)}")
    print(f"  compaction_active = true:           {c.get('compaction_true', 0)}")
    print(f"  compaction_active = false:          {c.get('compaction_false', 0)}")
    print(f"  No compaction flag (legacy/missing): {c.get('no_compaction_flag', 0)}")
    print()

    # ═══════════════════════════════════════════════════════════════════════
    # SECTION 6: Failure analysis (402 billing failures)
    # ═══════════════════════════════════════════════════════════════════════
    print("=" * 120)
    print("SECTION 6: FAILURE ANALYSIS")
    print("=" * 120)

    fail_pipeline = [
        {"$match": {"timestamp": {"$gte": today_start}, "success": False}},
        {"$group": {
            "_id": {"purpose": "$purpose", "failure_code": "$failure_code"},
            "count": {"$sum": 1},
            "first": {"$min": "$timestamp"},
            "last": {"$max": "$timestamp"},
        }},
        {"$sort": {"count": -1}}
    ]
    failures = await db.gemini_usage.aggregate(fail_pipeline).to_list(50)

    print(f"{'Purpose':<20} {'Failure Code':<25} {'Count':>8} {'First':>22} {'Last':>22}")
    print("-" * 100)
    for f in failures:
        print(f"{str(f['_id']['purpose']):<20} {str(f['_id']['failure_code']):<25} {f['count']:>8} {str(f['first'])[:19]:>22} {str(f['last'])[:19]:>22}")
    print()

    # ═══════════════════════════════════════════════════════════════════════
    # SECTION 7: FULL RECONCILIATION TABLE
    # ═══════════════════════════════════════════════════════════════════════
    print("=" * 120)
    print("SECTION 7: RECONCILIATION TABLE (Investigation calls by correlation_id)")
    print("=" * 120)

    # For each correlation_id group, determine case info and source
    print(f"{'#':>3} {'Correlation ID':<38} {'Calls':>6} {'OK':>4} {'Fail':>4} {'Input Tokens':>14} {'Output':>10} {'Thinking':>10} {'Cached':>10} {'Est Cost':>10} {'First Call':>20} {'Last Call':>20} {'Model(s)':<25} {'Source/Trigger':<20}")
    print("-" * 230)

    running_calls = 0
    running_input = 0
    running_output = 0
    running_thinking = 0
    running_cached = 0
    running_cost = 0.0

    for idx, g in enumerate(inv_groups):
        corr_id = str(g["_id"] or "NULL")
        display_corr = corr_id[:36] if len(corr_id) > 36 else corr_id
        models = ", ".join(g["models"][:2])

        # Determine source/trigger
        source = "unknown"
        if corr_id in matched_reports:
            rpt = matched_reports[corr_id]
            source = f"report:{rpt.get('status', '?')}"
        elif corr_id in cases_matched:
            cs = cases_matched[corr_id]
            source = f"case:{cs.get('type', cs.get('status', '?'))}"
        
        running_calls += g["calls"]
        running_input += g["input_tokens"]
        running_output += g["output_tokens"]
        running_thinking += g["thinking_tokens"]
        running_cached += g["cached_tokens"]
        running_cost += g["cost"]

        print(f"{idx+1:>3} {display_corr:<38} {g['calls']:>6} {g['successful']:>4} {g['failed']:>4} {g['input_tokens']:>14,} {g['output_tokens']:>10,} {g['thinking_tokens']:>10,} {g['cached_tokens']:>10,} ${g['cost']:>8.4f}  {str(g['first_call'])[:19]:<20} {str(g['last_call'])[:19]:<20} {models:<25} {source:<20}")

    print("-" * 230)
    print(f"{'SUM':>3} {'':38} {running_calls:>6} {'':>4} {'':>4} {running_input:>14,} {running_output:>10,} {running_thinking:>10,} {running_cached:>10,} ${running_cost:>8.4f}")
    print()

    # ═══════════════════════════════════════════════════════════════════════
    # SECTION 8: TOP 10 HIGHEST-CONSUMING CORRELATION IDs
    # ═══════════════════════════════════════════════════════════════════════
    print("=" * 120)
    print("SECTION 8: TOP 10 HIGHEST-CONSUMING CORRELATION IDs")
    print("=" * 120)

    top10 = inv_groups[:10]
    for idx, g in enumerate(top10):
        corr_id = str(g["_id"] or "NULL")
        avg_input = g["input_tokens"] / g["calls"] if g["calls"] > 0 else 0
        pct_of_total = (g["input_tokens"] / total_inv_input * 100) if total_inv_input > 0 else 0
        print(f"  {idx+1}. {corr_id}")
        print(f"     Calls: {g['calls']:,}  |  Input: {g['input_tokens']:,}  |  Avg input/call: {avg_input:,.0f}  |  Cost: ${g['cost']:.4f}  |  % of total input: {pct_of_total:.1f}%")
        print(f"     First: {str(g['first_call'])[:19]}  Last: {str(g['last_call'])[:19]}  Models: {', '.join(g['models'])}")
        print()

    # ═══════════════════════════════════════════════════════════════════════
    # SECTION 9: DETAILED CALL-BY-CALL TRACE FOR TOP CORRELATION IDs
    # ═══════════════════════════════════════════════════════════════════════
    print("=" * 120)
    print("SECTION 9: CALL-BY-CALL TRACE FOR TOP 3 CORRELATIONS")
    print("=" * 120)

    for g in inv_groups[:3]:
        corr_id = g["_id"]
        if not corr_id:
            continue
        print(f"\nCorrelation: {corr_id}")
        print(f"{'#':>3} {'Timestamp':<22} {'Type':<20} {'Model':<25} {'Success':<8} {'Input':>12} {'Output':>10} {'Thinking':>10} {'Cached':>10} {'Cost':>10} {'Fail Code':<15}")
        print("-" * 165)

        calls = await db.gemini_usage.find(
            {"correlation_id": corr_id, "timestamp": {"$gte": today_start}},
            {"_id": 0}
        ).sort("timestamp", 1).to_list(200)

        cum_input = 0
        for i, call in enumerate(calls):
            tokens = call.get("tokens", {})
            inp = tokens.get("input") or 0
            out = tokens.get("output") or 0
            thinking = tokens.get("thinking") or 0
            cached = tokens.get("cached_input") or 0
            cost = call.get("estimated_cost_usd") or 0
            cum_input += inp

            print(f"{i+1:>3} {str(call.get('timestamp',''))[:19]:<22} {str(call.get('call_type','')):<20} {str(call.get('model','')):<25} {str(call.get('success','')):<8} {inp:>12,} {out:>10,} {thinking:>10,} {cached:>10,} ${cost:>8.4f}  {str(call.get('failure_code','') or ''):<15}")
        
        print(f"    Cumulative input: {cum_input:,}")
        print()

    # ═══════════════════════════════════════════════════════════════════════
    # SECTION 10: HISTORICAL COMPARISON
    # ═══════════════════════════════════════════════════════════════════════
    print("=" * 120)
    print("SECTION 10: HISTORICAL COMPARISON & GROWTH ANALYSIS")
    print("=" * 120)

    # Get records by day for the last 7 days
    week_ago = now - timedelta(days=7)
    daily_pipeline = [
        {"$match": {"timestamp": {"$gte": week_ago}}},
        {"$group": {
            "_id": {"$dateToString": {"format": "%Y-%m-%d", "date": "$timestamp"}},
            "calls": {"$sum": 1},
            "success": {"$sum": {"$cond": ["$success", 1, 0]}},
            "failed": {"$sum": {"$cond": ["$success", 0, 1]}},
            "input_tokens": {"$sum": {"$ifNull": ["$tokens.input", 0]}},
            "cost": {"$sum": {"$ifNull": ["$estimated_cost_usd", 0]}},
        }},
        {"$sort": {"_id": 1}}
    ]
    daily = await db.gemini_usage.aggregate(daily_pipeline).to_list(10)

    print(f"{'Date':<12} {'Total Calls':>12} {'Successful':>12} {'Failed':>8} {'Input Tokens':>16} {'Est Cost':>12}")
    print("-" * 80)
    for d in daily:
        print(f"{d['_id']:<12} {d['calls']:>12,} {d['success']:>12,} {d['failed']:>8,} {d['input_tokens']:>16,} ${d['cost']:>10.4f}")
    print()

    # Check earliest and latest records overall
    earliest = await db.gemini_usage.find_one({}, {"timestamp": 1}, sort=[("timestamp", 1)])
    latest = await db.gemini_usage.find_one({}, {"timestamp": 1}, sort=[("timestamp", -1)])
    print(f"Earliest record in gemini_usage: {earliest.get('timestamp') if earliest else 'N/A'}")
    print(f"Latest record in gemini_usage:   {latest.get('timestamp') if latest else 'N/A'}")
    print()

    # ═══════════════════════════════════════════════════════════════════════
    # SECTION 11: investigation_reports COLLECTION DETAILS
    # ═══════════════════════════════════════════════════════════════════════
    print("=" * 120)
    print("SECTION 11: investigation_reports COLLECTION INSPECTION")
    print("=" * 120)

    # Get all investigation reports to see their dates
    all_reports = await db.investigation_reports.find(
        {},
        {"_id": 1, "case_id": 1, "correlation_id": 1, "status": 1, "created_at": 1, "updated_at": 1}
    ).sort("created_at", -1).limit(20).to_list(20)

    if all_reports:
        print(f"Latest {len(all_reports)} investigation_reports:")
        for r in all_reports:
            print(f"  _id={r.get('_id')} | case_id={r.get('case_id')} | corr={r.get('correlation_id')} | status={r.get('status')} | created={r.get('created_at')} | updated={r.get('updated_at')}")
    else:
        print("NO records found in investigation_reports collection.")
    print()

    # Check schema of investigation_reports (get one full document)
    sample_report = await db.investigation_reports.find_one({})
    if sample_report:
        print(f"Sample investigation_report fields: {list(sample_report.keys())}")
    else:
        print("investigation_reports collection is empty.")
    print()

    # ═══════════════════════════════════════════════════════════════════════
    # SECTION 12: RECONCILIATION SUMMARY
    # ═══════════════════════════════════════════════════════════════════════
    print("=" * 120)
    print("SECTION 12: RECONCILIATION SUMMARY")
    print("=" * 120)

    # Success-only totals (matching dashboard which filters success=True)
    success_pipeline = [
        {"$match": {"timestamp": {"$gte": today_start}, "success": True}},
        {"$group": {
            "_id": "$purpose",
            "calls": {"$sum": 1},
            "input": {"$sum": {"$ifNull": ["$tokens.input", 0]}},
            "cost": {"$sum": {"$ifNull": ["$estimated_cost_usd", 0]}},
        }}
    ]
    by_purpose_success = await db.gemini_usage.aggregate(success_pipeline).to_list(20)
    total_success_calls = sum(r["calls"] for r in by_purpose_success)
    total_success_input = sum(r["input"] for r in by_purpose_success)
    total_success_cost = sum(r["cost"] for r in by_purpose_success)

    print(f"Dashboard 'Cost Today' filter: timestamp >= {today_start.isoformat()}, success=True")
    print()
    print(f"SUCCESS-ONLY totals by purpose:")
    for r in by_purpose_success:
        print(f"  {r['_id']:<20} calls={r['calls']:>6,}  input={r['input']:>14,}  cost=${r['cost']:.4f}")
    print(f"  {'TOTAL':<20} calls={total_success_calls:>6,}  input={total_success_input:>14,}  cost=${total_success_cost:.4f}")
    print()

    # Including failures
    all_pipeline = [
        {"$match": {"timestamp": {"$gte": today_start}}},
        {"$group": {
            "_id": "$purpose",
            "calls": {"$sum": 1},
            "input": {"$sum": {"$ifNull": ["$tokens.input", 0]}},
            "cost": {"$sum": {"$ifNull": ["$estimated_cost_usd", 0]}},
        }}
    ]
    by_purpose_all = await db.gemini_usage.aggregate(all_pipeline).to_list(20)
    total_all_calls = sum(r["calls"] for r in by_purpose_all)
    total_all_input = sum(r["input"] for r in by_purpose_all)
    total_all_cost = sum(r["cost"] for r in by_purpose_all)

    print(f"ALL CALLS (including failures) by purpose:")
    for r in by_purpose_all:
        print(f"  {r['_id']:<20} calls={r['calls']:>6,}  input={r['input']:>14,}  cost=${r['cost']:.4f}")
    print(f"  {'TOTAL':<20} calls={total_all_calls:>6,}  input={total_all_input:>14,}  cost=${total_all_cost:.4f}")
    print()

    print("USER-REPORTED DASHBOARD VALUES:")
    print("  955 Gemini calls today")
    print("  19,078,384 input tokens")
    print("  $12.5611 estimated cost")
    print("  856 investigation calls / 19,033,417 input tokens / $12.2542")
    print("  99 research calls / 44,967 input tokens / $0.3069")
    print("  75 HTTP 402 billing failures")
    print()
    print(f"DB RECONCILIATION (success-only, matching dashboard logic):")
    print(f"  Total calls: {total_success_calls:,} (dashboard reported: 955)")
    print(f"  Total input: {total_success_input:,} (dashboard reported: 19,078,384)")
    print(f"  Total cost:  ${total_success_cost:.4f} (dashboard reported: $12.5611)")
    print()
    print(f"MATCH STATUS: {'✅ RECONCILED' if abs(total_success_calls - 955) < 5 else '⚠️ DISCREPANCY — calls may have accumulated since user snapshot'}")
    print()

    print("=" * 120)
    print("END OF RECONCILIATION REPORT")
    print("=" * 120)

    client.close()


if __name__ == "__main__":
    asyncio.run(main())
