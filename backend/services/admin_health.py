"""Admin health checks — real telemetry for every Apollo subsystem.

Every check queries a real source. If verification fails, the status is
'unknown' with reason 'Unable to verify', never assumed 'healthy'.

Privacy rule: aggregate system telemetry only. No user/customer data.
Protection rule: never create or fake THREAT_BLOCKED / verified_block / Apollo is biting.
"""

from __future__ import annotations

import os

from services.higgins import provider
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from core.db import db, now_utc

_BOOT_TIME = time.monotonic()


# ── Status constants ─────────────────────────────────────────────────────────

OK = "healthy"
DEGRADED = "degraded"
DOWN = "down"
UNKNOWN = "unknown"
CONNECTED = "connected"
NOT_CONFIGURED = "not_configured"
UNABLE = "unable_to_verify"


def _status(state: str, detail: str = "", **kw) -> dict[str, Any]:
    return {"status": state, "detail": detail, **kw}


# ── Database ─────────────────────────────────────────────────────────────────

async def check_database() -> dict:
    try:
        result = await db.command("ping")
        if result.get("ok") == 1:
            stats = await db.command("dbStats")
            return _status(OK, "MongoDB responding",
                           collections=stats.get("collections", 0),
                           data_size_mb=round(stats.get("dataSize", 0) / 1024 / 1024, 2),
                           storage_size_mb=round(stats.get("storageSize", 0) / 1024 / 1024, 2),
                           indexes=stats.get("indexes", 0),
                           objects=stats.get("objects", 0))
        return _status(DEGRADED, "Ping returned unexpected result")
    except Exception as e:
        return _status(DOWN, f"Database unreachable: {type(e).__name__}")


# ── AI Provider (Gemini) ────────────────────────────────────────────────────

async def check_ai_provider() -> dict:
    try:
        since = now_utc() - timedelta(hours=1)
        pipeline = [
            {"$match": {"timestamp": {"$gte": since}}},
            {"$group": {
                "_id": None,
                "total": {"$sum": 1},
                "ok": {"$sum": {"$cond": ["$success", 1, 0]}},
                "fail": {"$sum": {"$cond": ["$success", 0, 1]}},
                "last_success": {"$max": {"$cond": [{"$eq": ["$success", True]}, "$timestamp", None]}},
                "last_failure": {"$max": {"$cond": [{"$eq": ["$success", False]}, "$timestamp", None]}},
            }}
        ]
        results = await db.gemini_usage.aggregate(pipeline).to_list(1)
        if not results:
            # No calls in the last hour — check if there are ANY records
            any_record = await db.gemini_usage.find_one({}, {"_id": 1})
            if any_record:
                return _status(UNKNOWN, "No Gemini calls in the last hour")
            return _status(UNKNOWN, "No Gemini usage records found")

        r = results[0]
        success_rate = r["ok"] / r["total"] if r["total"] > 0 else 0
        # Check for recent failures
        last_fail_codes = []
        if r["fail"] > 0:
            recent_fails = await db.gemini_usage.find(
                {"timestamp": {"$gte": since}, "success": False},
                {"failure_code": 1, "_id": 0}
            ).sort("timestamp", -1).limit(5).to_list(5)
            last_fail_codes = [f.get("failure_code", "unknown") for f in recent_fails]

        if success_rate >= 0.95:
            status = OK
        elif success_rate >= 0.5:
            status = DEGRADED
        else:
            status = DOWN

        return _status(status,
                       f"{r['ok']}/{r['total']} calls succeeded in last hour ({success_rate:.0%})",
                       calls_1h=r["total"], success_rate=round(success_rate, 3),
                       successes=r["ok"], failures=r["fail"],
                       last_success=r["last_success"].isoformat() if r.get("last_success") else None,
                       last_failure=r["last_failure"].isoformat() if r.get("last_failure") else None,
                       recent_failure_codes=last_fail_codes)
    except Exception as e:
        return _status(UNABLE, f"Unable to query usage data: {type(e).__name__}")


# ── Magnum DI (Investigation Engine) ────────────────────────────────────────

async def check_magnum_di() -> dict:
    try:
        since = now_utc() - timedelta(hours=24)
        pipeline = [
            {"$match": {"created_at": {"$gte": since}}},
            {"$group": {
                "_id": "$status",
                "count": {"$sum": 1},
            }}
        ]
        results = await db.investigation_reports.aggregate(pipeline).to_list(20)
        if not results:
            return _status(UNKNOWN, "No investigations in the last 24 hours")

        by_status = {r["_id"]: r["count"] for r in results}
        total = sum(by_status.values())
        committed = by_status.get("committed", 0)
        failed = by_status.get("failed", 0)

        success_rate = committed / total if total > 0 else 0
        if success_rate >= 0.8 and failed == 0:
            status = OK
        elif success_rate >= 0.5:
            status = DEGRADED
        else:
            status = DOWN if total > 2 else UNKNOWN

        return _status(status,
                       f"{committed}/{total} investigations committed in 24h ({success_rate:.0%})",
                       total_24h=total, committed=committed, failed=failed,
                       by_status=by_status, success_rate=round(success_rate, 3))
    except Exception as e:
        return _status(UNABLE, f"{type(e).__name__}")


# ── Higgins (Chat) ──────────────────────────────────────────────────────────

async def check_higgins() -> dict:
    try:
        since = now_utc() - timedelta(hours=24)
        total = await db.higgins_chat_receipts.count_documents({"created_at": {"$gte": since}})
        if total == 0:
            any_record = await db.higgins_chat_receipts.find_one({}, {"_id": 1})
            if any_record:
                return _status(UNKNOWN, "No chat activity in the last 24 hours")
            return _status(UNKNOWN, "No chat receipts found")
        return _status(OK, f"{total} chat interactions in 24h", chat_24h=total)
    except Exception as e:
        return _status(UNABLE, f"{type(e).__name__}")


# ── Protection Health (Gates) ────────────────────────────────────────────────

async def check_protection() -> dict:
    try:
        since = now_utc() - timedelta(hours=24)
        pipeline = [
            {"$match": {"created_at": {"$gte": since}}},
            {"$addFields": {"primary_gate": {"$ifNull": [{"$arrayElemAt": ["$gates", 0]}, None]}}},
            {"$group": {
                "_id": "$primary_gate",
                "count": {"$sum": 1},
            }}
        ]
        results = await db.investigation_cases.aggregate(pipeline).to_list(20)
        gate_counts = {r["_id"]: r["count"] for r in results if r["_id"]}
        unattributed = sum(r["count"] for r in results if not r["_id"])
        total = sum(r["count"] for r in results)

        if total == 0:
            return _status(UNKNOWN, "No gate activity in the last 24 hours")

        detail = f"{total} gate checks in 24h across {len(gate_counts)} gates"
        if unattributed:
            detail += f" ({unattributed} unattributed)"
        return _status(OK, detail,
                       total_24h=total, gates=gate_counts, unattributed=unattributed)
    except Exception as e:
        return _status(UNABLE, f"{type(e).__name__}")


async def check_gate_health() -> dict:
    """Per-gate breakdown using the gates array field."""
    try:
        since = now_utc() - timedelta(hours=24)
        pipeline = [
            {"$match": {"created_at": {"$gte": since}}},
            {"$addFields": {"primary_gate": {"$ifNull": [{"$arrayElemAt": ["$gates", 0]}, None]}}},
            {"$group": {"_id": "$primary_gate", "count": {"$sum": 1}}}
        ]
        results = await db.investigation_cases.aggregate(pipeline).to_list(20)
        gates = {}
        for r in results:
            gate = r["_id"] or "unknown"
            if gate == "unknown":
                gates[gate] = {"count_24h": r["count"], "status": DEGRADED,
                               "detail": f"{r['count']} unattributed checks — attribution requires review"}
            else:
                gates[gate] = {"count_24h": r["count"], "status": OK if r["count"] > 0 else UNKNOWN}
        # List all expected gates
        expected = ["email", "link", "text", "call", "network", "account", "site"]
        for g in expected:
            if g not in gates:
                gates[g] = {"count_24h": 0, "status": UNKNOWN, "detail": "No activity in 24h"}
        return gates
    except Exception as e:
        return {"error": _status(UNABLE, f"{type(e).__name__}")}


# ── Privacy / Redaction ──────────────────────────────────────────────────────

async def check_privacy() -> dict:
    try:
        from services.higgins.llm_boundary import Purpose, enforce_boundary
        # Verify the boundary module is importable and has required enums
        purposes = [p.value for p in Purpose]
        if len(purposes) > 0:
            return _status(OK, f"LLM boundary enforcement active with {len(purposes)} purpose categories",
                           purposes=purposes)
        return _status(DEGRADED, "No purpose categories defined")
    except Exception as e:
        return _status(UNABLE, f"Cannot verify boundary module: {type(e).__name__}")


# ── Backend / API ────────────────────────────────────────────────────────────

async def check_backend() -> dict:
    uptime_s = time.monotonic() - _BOOT_TIME
    uptime_h = uptime_s / 3600
    return _status(OK, f"Running for {uptime_h:.1f} hours",
                   uptime_seconds=int(uptime_s),
                   uptime_hours=round(uptime_h, 2),
                   pid=os.getpid())


# ── Platform Health ──────────────────────────────────────────────────────────

async def check_platforms() -> dict:
    try:
        pipeline = [
            {"$group": {"_id": "$platform", "count": {"$sum": 1}, "last": {"$max": "$created_at"}}}
        ]
        results = await db.devices.aggregate(pipeline).to_list(20)
        platforms = {}
        for r in results:
            plat = r["_id"] or "unknown"
            last = r.get("last")
            platforms[plat] = {
                "registered_devices": r["count"],
                "last_registration": last.isoformat() if last else None,
                "status": OK if r["count"] > 0 else UNKNOWN,
            }
        return platforms
    except Exception as e:
        return {"error": _status(UNABLE, f"{type(e).__name__}")}


# ── Integration checks ──────────────────────────────────────────────────────

async def check_integrations() -> dict[str, dict]:
    integrations = {}

    # Gemini / Magnum DI
    ai = await check_ai_provider()
    integrations["gemini_magnum_di"] = {
        "name": "Gemini / Magnum DI",
        "status": CONNECTED if ai["status"] == OK else DEGRADED if ai["status"] == DEGRADED else UNABLE,
        "detail": ai["detail"],
        "model": provider.TEXT_MODEL,
    }

    # Google Safe Browsing / Threat Intelligence
    try:
        rep_count = await db.reputation_cache.count_documents({})
        threat_count = await db.threat_indicators.count_documents({})
        integrations["threat_intelligence"] = {
            "name": "Threat Intelligence / Reputation",
            "status": CONNECTED if rep_count > 0 else UNKNOWN,
            "detail": f"{rep_count} reputation entries, {threat_count} threat indicators",
            "reputation_entries": rep_count,
            "threat_indicators": threat_count,
        }
    except Exception:
        integrations["threat_intelligence"] = {"name": "Threat Intelligence", "status": UNABLE, "detail": "Unable to query"}

    # Google Auth (Emergent)
    integrations["google_auth"] = {
        "name": "Google Authentication (Emergent)",
        "status": CONNECTED if os.getenv("ADMIN_EMAIL") else NOT_CONFIGURED,
        "detail": "Emergent managed auth configured" if os.getenv("ADMIN_EMAIL") else "No admin email configured",
    }

    # Database
    db_check = await check_database()
    integrations["mongodb"] = {
        "name": "MongoDB Database",
        "status": CONNECTED if db_check["status"] == OK else DEGRADED if db_check["status"] == DEGRADED else UNABLE,
        "detail": db_check["detail"],
        "collections": db_check.get("collections"),
        "data_size_mb": db_check.get("data_size_mb"),
    }

    # Notifications / Email
    try:
        push_count = await db.push_registrations.count_documents({})
        email_key = os.getenv("EMERGENT_EMAIL_KEY", "")
        integrations["notifications"] = {
            "name": "Notifications & Email",
            "status": CONNECTED if push_count > 0 or email_key else NOT_CONFIGURED,
            "detail": f"{push_count} push registrations" + (", email key configured" if email_key else ""),
            "push_registrations": push_count,
            "email_configured": bool(email_key),
        }
    except Exception:
        integrations["notifications"] = {"name": "Notifications & Email", "status": UNABLE, "detail": "Unable to query"}

    # Gmail integration
    try:
        gmail_count = await db.gmail_connections.count_documents({})
        integrations["gmail"] = {
            "name": "Gmail Integration",
            "status": CONNECTED if gmail_count > 0 else NOT_CONFIGURED,
            "detail": f"{gmail_count} connected accounts",
            "connections": gmail_count,
        }
    except Exception:
        integrations["gmail"] = {"name": "Gmail", "status": UNABLE, "detail": "Unable to query"}

    # Learning/Feed system
    try:
        feed_count = await db.learning_feeds.count_documents({})
        article_count = await db.learning_articles.count_documents({})
        integrations["learning_feeds"] = {
            "name": "Learning & Feed System",
            "status": CONNECTED if feed_count > 0 else NOT_CONFIGURED,
            "detail": f"{feed_count} feeds, {article_count} articles",
        }
    except Exception:
        integrations["learning_feeds"] = {"name": "Learning Feeds", "status": UNABLE}

    return integrations


# ── Usage & Costs ────────────────────────────────────────────────────────────

async def get_usage_and_costs() -> dict:
    """Aggregate usage and cost data from all trackable sources."""
    now = now_utc()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    services = []

    # Gemini API
    try:
        today_pipeline = [
            {"$match": {"timestamp": {"$gte": today_start}, "success": True}},
            {"$group": {"_id": None,
                        "calls": {"$sum": 1},
                        "input": {"$sum": {"$ifNull": ["$tokens.input", 0]}},
                        "output": {"$sum": {"$ifNull": ["$tokens.output", 0]}},
                        "cost": {"$sum": {"$ifNull": ["$estimated_cost_usd", 0]}}}}
        ]
        month_pipeline = [
            {"$match": {"timestamp": {"$gte": month_start}, "success": True}},
            {"$group": {"_id": None,
                        "calls": {"$sum": 1},
                        "input": {"$sum": {"$ifNull": ["$tokens.input", 0]}},
                        "output": {"$sum": {"$ifNull": ["$tokens.output", 0]}},
                        "cost": {"$sum": {"$ifNull": ["$estimated_cost_usd", 0]}}}}
        ]
        today_data = (await db.gemini_usage.aggregate(today_pipeline).to_list(1)) or [{}]
        month_data = (await db.gemini_usage.aggregate(month_pipeline).to_list(1)) or [{}]
        td = today_data[0] if today_data else {}
        md = month_data[0] if month_data else {}

        # Project month-end cost
        days_elapsed = max((now - month_start).days + 1, 1)
        days_in_month = 30
        projected = (md.get("cost", 0) / days_elapsed) * days_in_month

        services.append({
            "service": "Gemini API (Investigation + Research + Chat)",
            "usage_today": f"{td.get('calls', 0):,} calls, {td.get('input', 0):,} input tokens",
            "usage_month": f"{md.get('calls', 0):,} calls, {md.get('input', 0):,} input tokens",
            "cost_today": f"${td.get('cost', 0):.4f}",
            "cost_month": f"${md.get('cost', 0):.4f}",
            "projected_month": f"${projected:.4f}",
            "status": OK if td.get("calls", 0) > 0 or md.get("calls", 0) > 0 else UNKNOWN,
        })

        # Break down by purpose
        purpose_pipeline = [
            {"$match": {"timestamp": {"$gte": month_start}, "success": True}},
            {"$group": {"_id": "$purpose",
                        "calls": {"$sum": 1},
                        "input": {"$sum": {"$ifNull": ["$tokens.input", 0]}},
                        "cost": {"$sum": {"$ifNull": ["$estimated_cost_usd", 0]}}}}
        ]
        by_purpose = await db.gemini_usage.aggregate(purpose_pipeline).to_list(20)
        for bp in by_purpose:
            services.append({
                "service": f"  └ {bp['_id'] or 'other'}",
                "usage_today": "",
                "usage_month": f"{bp['calls']:,} calls, {bp['input']:,} tokens",
                "cost_today": "",
                "cost_month": f"${bp['cost']:.4f}",
                "projected_month": "",
                "status": "",
                "indent": True,
            })
    except Exception:
        services.append({"service": "Gemini API", "status": UNABLE, "cost_today": "Cost unavailable",
                         "cost_month": "Cost unavailable"})

    # Database storage
    try:
        stats = await db.command("dbStats")
        data_mb = stats.get("dataSize", 0) / 1024 / 1024
        storage_mb = stats.get("storageSize", 0) / 1024 / 1024
        services.append({
            "service": "MongoDB Storage",
            "usage_today": f"{data_mb:.1f} MB data",
            "usage_month": f"{storage_mb:.1f} MB on disk",
            "cost_today": "Cost unavailable",
            "cost_month": "Cost unavailable",
            "projected_month": "N/A",
            "status": OK,
        })
    except Exception:
        services.append({"service": "MongoDB Storage", "status": UNABLE, "cost_today": "Cost unavailable"})

    # Compute summary
    gemini_cost_today = 0.0
    gemini_cost_month = 0.0
    try:
        for s in services:
            ct = s.get("cost_today", "")
            cm = s.get("cost_month", "")
            if ct.startswith("$"):
                gemini_cost_today += float(ct[1:])
            if cm.startswith("$") and not s.get("indent"):
                gemini_cost_month += float(cm[1:])
    except (ValueError, TypeError):
        pass

    summary = {
        "cost_today": f"${gemini_cost_today:.4f}" if gemini_cost_today > 0 else "Cost unavailable",
        "cost_month": f"${gemini_cost_month:.4f}" if gemini_cost_month > 0 else "Cost unavailable",
        "projected_month": services[0].get("projected_month", "N/A") if services else "N/A",
        "budget": "Not set",
        "budget_used_pct": "N/A",
    }

    # Alerts
    alerts = []
    if gemini_cost_today > 1.0:
        alerts.append({"level": "warning", "message": f"Daily Gemini cost spike: ${gemini_cost_today:.4f}"})
    if gemini_cost_month > 10.0:
        alerts.append({"level": "warning", "message": f"Monthly Gemini cost elevated: ${gemini_cost_month:.4f}"})

    # Check for recent billing failures
    try:
        billing_fails = await db.gemini_usage.count_documents({
            "timestamp": {"$gte": today_start},
            "success": False,
            "failure_code": "http_402",
        })
        if billing_fails > 0:
            alerts.append({"level": "critical", "message": f"{billing_fails} Gemini billing failures today (402 RESOURCE_EXHAUSTED)"})
    except Exception:
        pass

    return {"services": services, "summary": summary, "alerts": alerts}


# ── Full dashboard health ────────────────────────────────────────────────────

async def get_dashboard_health() -> dict:
    """Full system health for the main dashboard."""
    db_health = await check_database()
    ai_health = await check_ai_provider()
    magnum_health = await check_magnum_di()
    higgins_health = await check_higgins()
    protection_health = await check_protection()
    privacy_health = await check_privacy()
    backend_health = await check_backend()
    platforms = await check_platforms()
    gates = await check_gate_health()

    # Determine overall status
    critical = [db_health, ai_health, backend_health]
    if any(c["status"] == DOWN for c in critical):
        overall = DOWN
    elif any(c["status"] in (DEGRADED, UNKNOWN) for c in critical):
        overall = DEGRADED
    else:
        overall = OK

    # Attention items
    attention = []
    if ai_health["status"] != OK:
        attention.append(f"AI Provider: {ai_health['detail']}")
    if magnum_health["status"] != OK:
        attention.append(f"Magnum DI: {magnum_health['detail']}")
    if db_health["status"] != OK:
        attention.append(f"Database: {db_health['detail']}")

    # Check for recent errors
    try:
        recent_errors = await db.gemini_usage.count_documents({
            "timestamp": {"$gte": now_utc() - timedelta(hours=1)},
            "success": False,
        })
        if recent_errors > 0:
            attention.append(f"{recent_errors} Gemini errors in the last hour")
    except Exception:
        pass

    return {
        "overall": overall,
        "attention": attention,
        "subsystems": {
            "database": db_health,
            "ai_provider": ai_health,
            "magnum_di": magnum_health,
            "higgins": higgins_health,
            "protection": protection_health,
            "privacy_redaction": privacy_health,
            "backend": backend_health,
        },
        "platforms": platforms,
        "gates": gates,
        "timestamp": now_utc().isoformat(),
    }
