"""Apollo Admin Portal — Google-authenticated operations dashboard.

Privacy: monitors Apollo, not Apollo's users. No customer PII.
Protection: never manufactures THREAT_BLOCKED / verified_block / Apollo is biting.
Truthfulness: every status from a real source; 'Unknown' when unverifiable.
"""

from __future__ import annotations

import html as html_mod
import io
import os
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlencode

import httpx
import markdown
from dotenv import load_dotenv
from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, StreamingResponse

from core.db import db, now_utc
from services.admin_health import (
    OK, DEGRADED, DOWN, UNKNOWN, CONNECTED, NOT_CONFIGURED, UNABLE,
    get_dashboard_health, check_integrations, get_usage_and_costs,
    check_database, check_backend, check_ai_provider, check_magnum_di,
)

load_dotenv()

router = APIRouter(tags=["admin"])

ADMIN_EMAIL = (os.getenv("ADMIN_EMAIL", "")).strip().casefold()
SESSION_TTL_HOURS = 8
EMERGENT_SESSION_URL = "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data"
REPORT_DIR = Path(__file__).resolve().parent.parent

_SESSIONS = "admin_sessions"

# ── Nav items ────────────────────────────────────────────────────────────────

NAV = [
    ("Dashboard",       "/api/admin/portal",          "&#9632;"),
    ("Protection",      "/api/admin/protection",       "&#128737;"),
    ("Magnum DI",       "/api/admin/magnum-di",        "&#128270;"),
    ("Integrations",    "/api/admin/integrations",     "&#128279;"),
    ("Usage & Costs",   "/api/admin/usage",            "&#128176;"),
    ("Reconciliation",  "/api/admin/reconciliation",   "&#128209;"),
    ("System",          "/api/admin/system",           "&#9881;"),
    ("Releases",        "/api/admin/releases",         "&#128230;"),
    ("Diagnostics",     "/api/admin/diagnostics",      "&#128295;"),
    ("Audit",           "/api/admin/audit-log",        "&#128220;"),
    ("Admin",           "/api/admin/settings",         "&#128100;"),
]

REPORTS = {
    "gemini-usage-investigation": ("GEMINI_USAGE_INVESTIGATION.md", "Gemini Usage Investigation — Root Cause Analysis"),
    "gemini-usage-tracking": ("GEMINI_USAGE_TRACKING_REPORT.md", "Gemini Usage Tracking Report"),
}


# ── Session helpers ──────────────────────────────────────────────────────────

def _cookie_kw() -> dict:
    return dict(key="apollo_admin", httponly=True, samesite="lax", path="/",
                max_age=SESSION_TTL_HOURS * 3600,
                secure=os.getenv("COOKIE_SECURE", "false").lower() == "true")


async def _admin(request: Request) -> Optional[dict]:
    tok = request.cookies.get("apollo_admin")
    if not tok:
        return None
    row = await db[_SESSIONS].find_one({"token": tok})
    if not row:
        return None
    if row.get("expires_at") and row["expires_at"].replace(tzinfo=timezone.utc) < now_utc():
        await db[_SESSIONS].delete_one({"_id": row["_id"]})
        return None
    return row


def _login_redirect():
    return RedirectResponse("/api/admin/login", status_code=303)


def _origin(request: Request) -> str:
    proto = request.headers.get("x-forwarded-proto", "http")
    host = request.headers.get("x-forwarded-host") or request.headers.get("host", "localhost")
    return f"{proto}://{host}"


async def _audit_log(email: str, action: str, detail: str = ""):
    try:
        await db.admin_audit.insert_one({
            "email": email, "action": action, "detail": detail,
            "timestamp": now_utc(),
        })
    except Exception:
        pass


# ── Auth routes ──────────────────────────────────────────────────────────────

@router.get("/admin/login")
async def admin_login(request: Request):
    return RedirectResponse(
        "https://auth.emergentagent.com/?" + urlencode({"redirect": _origin(request) + "/api/admin/auth/callback"}),
        status_code=303)


@router.get("/admin/auth/callback", response_class=HTMLResponse)
async def admin_auth_callback():
    return _shell("Signing in…", "", """
    <div style="display:flex;align-items:center;justify-content:center;height:80vh;">
      <div style="text-align:center;">
        <div class="spinner"></div>
        <p style="margin-top:16px;color:var(--muted);">Authenticating with Google…</p>
        <p id="err" style="color:var(--red);display:none;margin-top:12px;"></p>
      </div>
    </div>
    <script>
    (async()=>{const p=new URLSearchParams(location.hash.slice(1)),sid=p.get('session_id'),err=document.getElementById('err');
    if(!sid){err.textContent='Missing session. Please try again.';err.style.display='block';return;}
    try{const r=await fetch('/api/admin/auth/exchange',{method:'POST',headers:{'content-type':'application/json'},
    credentials:'same-origin',body:JSON.stringify({session_id:sid})});
    if(r.ok){location.replace('/api/admin/portal');return;}
    err.textContent=r.status===403?'Access denied. This account is not authorised.':'Sign-in failed.';
    err.style.display='block';}catch(e){err.textContent='Network error.';err.style.display='block';}})();
    </script>""", show_nav=False)


@router.post("/admin/auth/exchange")
async def admin_auth_exchange(request: Request):
    body = await request.json()
    sid = body.get("session_id", "")
    if not sid or len(sid) > 4096:
        return HTMLResponse("Invalid session", status_code=400)
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get(EMERGENT_SESSION_URL, headers={"X-Session-ID": sid})
    if r.status_code != 200:
        return HTMLResponse("Invalid or expired sign-in", status_code=401)
    identity = r.json()
    email = (identity.get("email") or "").strip().casefold()
    if not ADMIN_EMAIL or not secrets.compare_digest(email, ADMIN_EMAIL):
        return HTMLResponse("Not authorised", status_code=403)
    token = secrets.token_urlsafe(32)
    now = now_utc()
    await db[_SESSIONS].insert_one({
        "token": token, "email": email, "name": identity.get("name", ""),
        "picture": identity.get("picture", ""), "created_at": now,
        "expires_at": now + timedelta(hours=SESSION_TTL_HOURS),
    })
    await _audit_log(email, "login")
    resp = JSONResponse({"ok": True})
    resp.set_cookie(value=token, **_cookie_kw())
    return resp


@router.post("/admin/logout")
async def admin_logout(request: Request):
    tok = request.cookies.get("apollo_admin")
    if tok:
        sess = await db[_SESSIONS].find_one({"token": tok})
        if sess:
            await _audit_log(sess.get("email", ""), "logout")
        await db[_SESSIONS].delete_one({"token": tok})
    resp = RedirectResponse("/api/admin/login", status_code=303)
    resp.delete_cookie("apollo_admin", path="/")
    return resp


# ── Dashboard ────────────────────────────────────────────────────────────────

@router.get("/admin/portal", response_class=HTMLResponse)
async def dashboard(request: Request):
    adm = await _admin(request)
    if not adm:
        return _login_redirect()
    h = await get_dashboard_health()
    overall = h["overall"]
    overall_color = _status_color(overall)
    attention = h.get("attention", [])
    subs = h.get("subsystems", {})
    platforms = h.get("platforms", {})
    gates = h.get("gates", {})

    # Status cards
    sub_cards = ""
    sub_order = [
        ("ai_provider", "AI Provider"),
        ("magnum_di", "Magnum DI"),
        ("higgins", "Higgins Chat"),
        ("protection", "Protection"),
        ("privacy_redaction", "Privacy / Redaction"),
        ("database", "Database"),
        ("backend", "Backend / API"),
    ]
    for key, label in sub_order:
        s = subs.get(key, {"status": UNKNOWN, "detail": "Not checked"})
        sub_cards += _status_card(label, s["status"], s.get("detail", ""))

    # Gate health
    gate_cards = ""
    if isinstance(gates, dict) and "error" not in gates:
        for g, info in sorted(gates.items()):
            gate_cards += _mini_status(g.title(), info.get("status", UNKNOWN), f"{info.get('count_24h', 0)} checks/24h")

    # Platform health
    plat_cards = ""
    if isinstance(platforms, dict) and "error" not in platforms:
        for p, info in sorted(platforms.items()):
            plat_cards += _mini_status(p.title(), info.get("status", UNKNOWN),
                                       f"{info.get('registered_devices', 0):,} devices")

    # Attention
    attn_html = ""
    if attention:
        items = "".join(f"<li>{html_mod.escape(a)}</li>" for a in attention)
        attn_html = f'<div class="alert alert-warning"><strong>Attention required</strong><ul>{items}</ul></div>'
    else:
        attn_html = '<div class="alert alert-ok">No issues requiring attention</div>'

    # Recent admin activity
    recent = await db.admin_audit.find({}, {"_id": 0}).sort("timestamp", -1).limit(10).to_list(10)
    activity_rows = ""
    for r in recent:
        ts = r.get("timestamp", "")
        activity_rows += f"<tr><td>{str(ts)[:19]}</td><td>{html_mod.escape(r.get('action',''))}</td><td>{html_mod.escape(str(r.get('detail',''))[:80])}</td></tr>"

    # Reports
    report_links = ""
    for slug, (_, title) in REPORTS.items():
        report_links += f'''<div class="report-row">
            <a href="/api/admin/reports/{slug}">{html_mod.escape(title)}</a>
            <a href="/api/admin/reports/{slug}/pdf" class="btn btn-sm" title="Download PDF">PDF</a>
        </div>'''

    body = f"""
    <div class="overall-banner" style="border-left:4px solid {overall_color};">
        <span class="dot" style="background:{overall_color};"></span>
        <span><strong>Apollo Status:</strong> {overall.upper()}</span>
        <span style="color:var(--muted);font-size:0.85em;margin-left:auto;">{h.get('timestamp','')[:19]} UTC</span>
    </div>
    {attn_html}

    <h2>Subsystem Health</h2>
    <div class="status-grid">{sub_cards}</div>

    <h2>Gate Health</h2>
    <div class="mini-grid">{gate_cards or '<span style="color:var(--muted);">No gate data available</span>'}</div>

    <h2>Platform Health</h2>
    <div class="mini-grid">{plat_cards or '<span style="color:var(--muted);">No platform data</span>'}</div>

    <h2>Reports</h2>
    <div class="report-list">{report_links}</div>

    <h2>Recent Admin Activity</h2>
    <table><thead><tr><th>Time</th><th>Action</th><th>Detail</th></tr></thead>
    <tbody>{activity_rows or '<tr><td colspan="3" style="color:var(--muted);">No recent activity</td></tr>'}</tbody></table>
    """
    return _shell("Dashboard", "/api/admin/portal", body, admin=adm)


# ── Protection ───────────────────────────────────────────────────────────────

@router.get("/admin/protection", response_class=HTMLResponse)
async def protection(request: Request):
    adm = await _admin(request)
    if not adm:
        return _login_redirect()
    h = await get_dashboard_health()
    gates = h.get("gates", {})
    prot = h.get("subsystems", {}).get("protection", {"status": UNKNOWN, "detail": ""})

    gate_rows = ""
    if isinstance(gates, dict) and "error" not in gates:
        for g, info in sorted(gates.items()):
            c = _status_color(info.get("status", UNKNOWN))
            gate_rows += f"<tr><td><span class='dot' style='background:{c};'></span> {g.title()}</td><td style='text-align:right'>{info.get('count_24h',0)}</td><td>{info.get('status', UNKNOWN)}</td></tr>"

    # Aggregate investigation outcomes (not individual user data)
    try:
        since = now_utc() - timedelta(hours=24)
        pipeline = [
            {"$match": {"created_at": {"$gte": since}}},
            {"$group": {"_id": "$status", "count": {"$sum": 1}}}
        ]
        outcomes = {r["_id"]: r["count"] for r in await db.investigation_reports.aggregate(pipeline).to_list(20)}
    except Exception:
        outcomes = {}

    outcome_rows = ""
    for st, ct in sorted(outcomes.items(), key=lambda x: -x[1]):
        outcome_rows += f"<tr><td>{st or 'unknown'}</td><td style='text-align:right'>{ct:,}</td></tr>"

    body = f"""
    <div class="overall-banner" style="border-left:4px solid {_status_color(prot['status'])};">
        <span class="dot" style="background:{_status_color(prot['status'])};"></span>
        <span><strong>Protection:</strong> {prot.get('detail','')}</span>
    </div>

    <h2>Gate Activity (24h)</h2>
    <table><thead><tr><th>Gate</th><th style="text-align:right">Checks</th><th>Status</th></tr></thead>
    <tbody>{gate_rows or '<tr><td colspan="3" style="color:var(--muted);">No gate data</td></tr>'}</tbody></table>

    <h2>Investigation Outcomes (24h, aggregate)</h2>
    <table><thead><tr><th>Outcome</th><th style="text-align:right">Count</th></tr></thead>
    <tbody>{outcome_rows or '<tr><td colspan="2" style="color:var(--muted);">No investigations</td></tr>'}</tbody></table>

    <p style="color:var(--muted);font-size:0.82em;margin-top:16px;">
        Protection truth rule: This portal observes Apollo. Verified enforcement comes only from genuine native enforcement evidence.
        This portal never creates THREAT_BLOCKED, verified_block, or "Apollo is biting" status.
    </p>
    """
    return _shell("Protection", "/api/admin/protection", body, admin=adm)


# ── Magnum DI ────────────────────────────────────────────────────────────────

@router.get("/admin/magnum-di", response_class=HTMLResponse)
async def magnum_di(request: Request):
    adm = await _admin(request)
    if not adm:
        return _login_redirect()

    md_health = await check_magnum_di()
    ai_health = await check_ai_provider()

    # Aggregate investigation stats (no user data)
    try:
        since = now_utc() - timedelta(hours=24)
        pipeline = [
            {"$match": {"timestamp": {"$gte": since}, "success": True, "purpose": "investigation"}},
            {"$group": {"_id": None,
                        "calls": {"$sum": 1},
                        "avg_input": {"$avg": "$tokens.input"},
                        "max_input": {"$max": "$tokens.input"},
                        "avg_duration": {"$avg": "$duration_ms"},
                        "total_input": {"$sum": {"$ifNull": ["$tokens.input", 0]}},
                        "total_output": {"$sum": {"$ifNull": ["$tokens.output", 0]}},
                        "total_cost": {"$sum": {"$ifNull": ["$estimated_cost_usd", 0]}}}}
        ]
        inv_stats = (await db.gemini_usage.aggregate(pipeline).to_list(1)) or [{}]
        inv = inv_stats[0] if inv_stats else {}
    except Exception:
        inv = {}

    body = f"""
    <div class="overall-banner" style="border-left:4px solid {_status_color(md_health['status'])};">
        <span class="dot" style="background:{_status_color(md_health['status'])};"></span>
        <span><strong>Magnum DI:</strong> {md_health.get('detail','')}</span>
    </div>

    <h2>AI Provider</h2>
    {_status_card("Gemini API", ai_health['status'], ai_health.get('detail',''))}

    <h2>Investigation Engine (24h)</h2>
    <div class="stats-grid">
        {_stat_card(f"{inv.get('calls', 0):,}", "Gemini Calls")}
        {_stat_card(f"{inv.get('avg_input', 0):,.0f}", "Avg Input Tokens")}
        {_stat_card(f"{inv.get('max_input', 0):,}", "Max Input Tokens")}
        {_stat_card(f"{inv.get('avg_duration', 0):,.0f} ms", "Avg Duration")}
        {_stat_card(f"{inv.get('total_input', 0):,}", "Total Input Tokens")}
        {_stat_card(f"${inv.get('total_cost', 0):.4f}", "Estimated Cost")}
    </div>

    <h2>Reports</h2>
    <div class="report-list">
        <div class="report-row"><a href="/api/admin/reports/gemini-usage-investigation">Gemini Usage Investigation — Root Cause Analysis</a>
            <a href="/api/admin/reports/gemini-usage-investigation/pdf" class="btn btn-sm">PDF</a></div>
        <div class="report-row"><a href="/api/admin/reports/gemini-usage-tracking">Gemini Usage Tracking Report</a>
            <a href="/api/admin/reports/gemini-usage-tracking/pdf" class="btn btn-sm">PDF</a></div>
    </div>
    """
    return _shell("Magnum DI", "/api/admin/magnum-di", body, admin=adm)


# ── Integrations ─────────────────────────────────────────────────────────────

@router.get("/admin/integrations", response_class=HTMLResponse)
async def integrations(request: Request):
    adm = await _admin(request)
    if not adm:
        return _login_redirect()

    intg = await check_integrations()
    rows = ""
    for key, info in intg.items():
        st = info.get("status", UNKNOWN)
        c = _integration_color(st)
        extras = ""
        for k, v in info.items():
            if k not in ("name", "status", "detail"):
                extras += f"<span style='color:var(--muted);font-size:0.82em;'>{k}: {v}</span> "
        rows += f"""<tr>
            <td><span class="dot" style="background:{c};"></span> {html_mod.escape(info.get('name', key))}</td>
            <td><span class="badge" style="background:{c}22;color:{c};">{_integration_label(st)}</span></td>
            <td>{html_mod.escape(info.get('detail', ''))}</td>
            <td style="font-size:0.82em;color:var(--muted);">{extras}</td>
        </tr>"""

    body = f"""
    <h2>Configured Integrations</h2>
    <table><thead><tr><th>Integration</th><th>Status</th><th>Detail</th><th>Info</th></tr></thead>
    <tbody>{rows}</tbody></table>
    <p style="color:var(--muted);font-size:0.82em;margin-top:12px;">
        States: <span class="badge" style="background:#3fb95022;color:#3fb950;">Connected</span>
        <span class="badge" style="background:#d2992222;color:#d29922;">Degraded</span>
        <span class="badge" style="background:#8b949e22;color:#8b949e;">Not Configured</span>
        <span class="badge" style="background:#f8514922;color:#f85149;">Unable to Verify</span>
    </p>
    """
    return _shell("Integrations", "/api/admin/integrations", body, admin=adm)


# ── Usage & Costs ────────────────────────────────────────────────────────────

@router.get("/admin/usage", response_class=HTMLResponse)
async def usage_costs(request: Request):
    adm = await _admin(request)
    if not adm:
        return _login_redirect()

    data = await get_usage_and_costs()
    summary = data["summary"]
    alerts = data.get("alerts", [])

    alert_html = ""
    for a in alerts:
        cls = "alert-critical" if a["level"] == "critical" else "alert-warning"
        alert_html += f'<div class="alert {cls}">{html_mod.escape(a["message"])}</div>'

    svc_rows = ""
    for s in data["services"]:
        indent_cls = " style='padding-left:32px;color:var(--muted);'" if s.get("indent") else ""
        svc_rows += f"""<tr>
            <td{indent_cls}>{html_mod.escape(s.get('service',''))}</td>
            <td>{html_mod.escape(str(s.get('usage_today','')))}</td>
            <td>{html_mod.escape(str(s.get('usage_month','')))}</td>
            <td>{html_mod.escape(str(s.get('cost_today','')))}</td>
            <td>{html_mod.escape(str(s.get('cost_month','')))}</td>
            <td>{html_mod.escape(str(s.get('projected_month','')))}</td>
            <td>{html_mod.escape(str(s.get('status','')))}</td>
        </tr>"""

    body = f"""
    {alert_html}
    <h2>Cost Summary</h2>
    <div class="stats-grid">
        {_stat_card(summary.get('cost_today','N/A'), "Cost Today")}
        {_stat_card(summary.get('cost_month','N/A'), "Month-to-Date")}
        {_stat_card(summary.get('projected_month','N/A'), "Projected Month-End")}
        {_stat_card(summary.get('budget','Not set'), "Monthly Budget")}
        {_stat_card(summary.get('budget_used_pct','N/A'), "Budget Used")}
    </div>

    <h2>Service Breakdown</h2>
    <table style="font-size:0.88em;">
        <thead><tr><th>Service</th><th>Usage Today</th><th>Usage This Month</th><th>Cost Today</th><th>Cost MTD</th><th>Projected</th><th>Status</th></tr></thead>
        <tbody>{svc_rows}</tbody>
    </table>

    <p style="color:var(--muted);font-size:0.82em;margin-top:16px;">
        Costs are estimated from tracked token usage at published model rates.
        Where billing data is unavailable, "Cost unavailable" is shown.
        Backend hosting, data transfer, and storage costs are not tracked here.
    </p>
    """
    return _shell("Usage & Costs", "/api/admin/usage", body, admin=adm)



# ── Reconciliation ───────────────────────────────────────────────────────────

@router.get("/admin/reconciliation", response_class=HTMLResponse)
async def reconciliation(request: Request):
    """Full usage reconciliation: traces every gemini_usage record, cross-references
    with investigation_reports, and surfaces timestamp-boundary discrepancies."""
    adm = await _admin(request)
    if not adm:
        return _login_redirect()

    now = now_utc()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    rolling_24h = now - timedelta(hours=24)

    # ── 1. Timestamp boundary analysis ──
    total_all_time = await db.gemini_usage.count_documents({})
    total_today = await db.gemini_usage.count_documents({"timestamp": {"$gte": today_start}})
    total_today_ok = await db.gemini_usage.count_documents({"timestamp": {"$gte": today_start}, "success": True})
    total_today_fail = await db.gemini_usage.count_documents({"timestamp": {"$gte": today_start}, "success": False})
    total_rolling = await db.gemini_usage.count_documents({"timestamp": {"$gte": rolling_24h}})

    inv_reports_24h = await db.investigation_reports.count_documents({"created_at": {"$gte": rolling_24h}})
    inv_reports_today = await db.investigation_reports.count_documents({"created_at": {"$gte": today_start}})
    inv_reports_all = await db.investigation_reports.count_documents({})

    earliest_rec = await db.gemini_usage.find_one({}, {"timestamp": 1}, sort=[("timestamp", 1)])
    latest_rec = await db.gemini_usage.find_one({}, {"timestamp": 1}, sort=[("timestamp", -1)])
    earliest_ts = str(earliest_rec["timestamp"])[:19] if earliest_rec else "N/A"
    latest_ts = str(latest_rec["timestamp"])[:19] if latest_rec else "N/A"

    boundary_html = f"""
    <h2>1. Timestamp Boundary Analysis</h2>
    <div class="alert alert-warning">
        <strong>Key insight:</strong> "Cost Today" uses <code>gemini_usage.timestamp &ge; midnight UTC</code>
        (calendar-day, success=True only). "Investigations in last 24h" uses
        <code>investigation_reports.created_at &ge; now &minus; 24h</code> (rolling window, different collection).
        These query <strong>different data</strong>: individual API calls vs completed investigation reports.
    </div>
    <table>
        <thead><tr><th>Metric</th><th>Value</th></tr></thead>
        <tbody>
            <tr><td>Report generated at (UTC)</td><td><code>{now.strftime('%Y-%m-%d %H:%M:%S')}</code></td></tr>
            <tr><td>"Today" boundary (midnight UTC)</td><td><code>{today_start.strftime('%Y-%m-%d %H:%M:%S')}</code></td></tr>
            <tr><td>Rolling 24h cutoff</td><td><code>{rolling_24h.strftime('%Y-%m-%d %H:%M:%S')}</code></td></tr>
            <tr><td>Earliest gemini_usage record</td><td><code>{earliest_ts}</code></td></tr>
            <tr><td>Latest gemini_usage record</td><td><code>{latest_ts}</code></td></tr>
        </tbody>
    </table>
    <div class="stats-grid">
        {_stat_card(f'{total_all_time:,}', 'All-time API calls')}
        {_stat_card(f'{total_today:,}', 'Calls since midnight')}
        {_stat_card(f'{total_today_ok:,}', 'Successful (today)')}
        {_stat_card(f'{total_today_fail:,}', 'Failed (today)')}
        {_stat_card(f'{total_rolling:,}', 'Rolling 24h calls')}
    </div>
    <div class="stats-grid">
        {_stat_card(f'{inv_reports_all:,}', 'Investigation reports (all)')}
        {_stat_card(f'{inv_reports_today:,}', 'Reports since midnight')}
        {_stat_card(f'{inv_reports_24h:,}', 'Reports in rolling 24h')}
    </div>
    """

    # ── 2. Calls by purpose (today) ──
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

    purpose_tbody = ""
    for r in purpose_rows:
        s_label = "Yes" if r["_id"]["success"] else "No"
        s_cls = "color:var(--green);" if r["_id"]["success"] else "color:var(--red);"
        purpose_tbody += f"""<tr>
            <td>{html_mod.escape(str(r['_id']['purpose'] or 'N/A'))}</td>
            <td style="{s_cls}">{s_label}</td>
            <td style="text-align:right;">{r['calls']:,}</td>
            <td style="text-align:right;">{r['input_tokens']:,}</td>
            <td style="text-align:right;">{r['output_tokens']:,}</td>
            <td style="text-align:right;">{r['thinking_tokens']:,}</td>
            <td style="text-align:right;">{r['cached_tokens']:,}</td>
            <td style="text-align:right;">${r['cost']:.4f}</td>
            <td>{str(r['first'])[:19]}</td>
            <td>{str(r['last'])[:19]}</td>
        </tr>"""

    purpose_html = f"""
    <h2>2. Calls by Purpose (Today, since midnight UTC)</h2>
    <table>
        <thead><tr><th>Purpose</th><th>Success</th><th>Calls</th><th>Input Tokens</th>
        <th>Output</th><th>Thinking</th><th>Cached</th><th>Est Cost</th>
        <th>First Call</th><th>Last Call</th></tr></thead>
        <tbody>{purpose_tbody or '<tr><td colspan="10" style="color:var(--muted);">No records found for today</td></tr>'}</tbody>
    </table>
    """

    # ── 3. Investigation calls grouped by correlation_id ──
    inv_corr_pipeline = [
        {"$match": {"timestamp": {"$gte": today_start}, "purpose": "investigation"}},
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
            "models": {"$addToSet": "$model"},
            "call_types": {"$addToSet": "$call_type"},
        }},
        {"$sort": {"cost": -1}}
    ]
    inv_groups = await db.gemini_usage.aggregate(inv_corr_pipeline).to_list(500)

    unique_corr = len(inv_groups)
    total_inv_calls = sum(g["calls"] for g in inv_groups)
    total_inv_input = sum(g["input_tokens"] for g in inv_groups)
    total_inv_cost = sum(g["cost"] for g in inv_groups)
    avg_input_per_call = total_inv_input / total_inv_calls if total_inv_calls > 0 else 0

    # Cross-reference with investigation_reports
    corr_ids = [g["_id"] for g in inv_groups if g["_id"]]
    report_map: dict[str, dict] = {}
    if corr_ids:
        for field in ["case_id", "correlation_id", "_id"]:
            try:
                found = await db.investigation_reports.find(
                    {field: {"$in": corr_ids}},
                    {"_id": 1, "case_id": 1, "correlation_id": 1, "status": 1,
                     "created_at": 1, "category": 1, "subject": 1}
                ).to_list(500)
                for f in found:
                    key = str(f.get(field, f.get("_id")))
                    if key not in report_map:
                        report_map[key] = f
            except Exception:
                pass

    # Also check any cases-like collections
    all_colls = await db.list_collection_names()
    case_colls = [c for c in all_colls if any(k in c.lower() for k in ["case", "invest", "magnum"])]

    extra_matches: dict[str, dict] = {}
    for coll_name in case_colls:
        if coll_name in ("gemini_usage", "investigation_reports"):
            continue
        for field in ["case_id", "correlation_id"]:
            try:
                found = await db[coll_name].find(
                    {field: {"$in": corr_ids[:100]}},
                    {"_id": 1, "case_id": 1, "correlation_id": 1, "status": 1,
                     "created_at": 1, "type": 1, "source": 1}
                ).to_list(200)
                for f in found:
                    key = str(f.get(field, f.get("_id")))
                    extra_matches[key] = {"collection": coll_name, **{k: v for k, v in f.items() if k != "_id"}}
            except Exception:
                pass

    # ── Source/trigger classification by correlation_id pattern ──
    def _classify_corr(cid: str) -> str:
        """Determine what code path created this correlation_id."""
        if not cid or cid == "NULL":
            return "unknown (no correlation_id)"
        if cid.startswith("case-"):
            return "coordinator (Magnum DI job)"
        if cid.startswith("msg-check-"):
            return "message check (investigation.py)"
        if cid.startswith("phone-check-"):
            return "phone check (investigation.py)"
        if cid == "health-check":
            return "health check probe"
        if cid == "research":
            return "research/grounding"
        if cid.startswith("chat-"):
            return "chat"
        if cid == "scam-analysis":
            return "scam analysis"
        return f"other ({cid[:20]})"

    source_buckets: dict[str, dict] = {}
    for g in inv_groups:
        cid = str(g["_id"] or "NULL")
        cat = _classify_corr(cid)
        b = source_buckets.setdefault(cat, {"calls": 0, "input": 0, "output": 0, "thinking": 0, "cost": 0.0, "unique_ids": 0})
        b["calls"] += g["calls"]
        b["input"] += g["input_tokens"]
        b["output"] += g["output_tokens"]
        b["thinking"] += g["thinking_tokens"]
        b["cost"] += g["cost"]
        b["unique_ids"] += 1

    source_tbody = ""
    for cat in sorted(source_buckets.keys(), key=lambda k: source_buckets[k]["cost"], reverse=True):
        b = source_buckets[cat]
        avg = b["input"] / b["calls"] if b["calls"] > 0 else 0
        source_tbody += f"""<tr>
            <td>{html_mod.escape(cat)}</td>
            <td style="text-align:right;">{b['unique_ids']:,}</td>
            <td style="text-align:right;">{b['calls']:,}</td>
            <td style="text-align:right;">{b['input']:,}</td>
            <td style="text-align:right;">{b['output']:,}</td>
            <td style="text-align:right;">{b['thinking']:,}</td>
            <td style="text-align:right;">${b['cost']:.4f}</td>
            <td style="text-align:right;">{avg:,.0f}</td>
        </tr>"""

    source_html = f"""
    <h2>2b. Investigation Calls by Source/Trigger</h2>
    <div class="alert alert-warning">
        <strong>Key question:</strong> How many of the investigation-labelled calls were user-initiated vs automated?<br/>
        Correlation IDs starting with <code>case-*</code> come from the Magnum DI coordinator (could be user OR mailbox-monitor triggered).<br/>
        <code>msg-check-*</code> = message analysis API, <code>phone-check-*</code> = phone analysis API,
        <code>health-check</code> = system health probe.<br/>
        <strong>The mailbox monitor creates <code>case-*</code> jobs automatically every 15 minutes for each monitored email.</strong>
    </div>
    <table>
        <thead><tr><th>Source Category</th><th>Unique IDs</th><th>Calls</th><th>Input Tokens</th>
        <th>Output</th><th>Thinking</th><th>Est Cost</th><th>Avg Input/Call</th></tr></thead>
        <tbody>{source_tbody or '<tr><td colspan="8" style="color:var(--muted);">No data</td></tr>'}</tbody>
    </table>
    """

    # ── Check mailbox-related investigation jobs ──
    mailbox_receipts = await db.mailbox_assessment_receipts.count_documents({"state": {"$in": ["submitted", "complete"]}, "updated_at": {"$gte": today_start}})
    mailbox_jobs_today = 0
    try:
        mailbox_jobs_today = await db.investigation_jobs.count_documents({
            "created_at": {"$gte": today_start},
            "idempotency_key": {"$regex": "^mailbox:"}
        })
    except Exception:
        pass

    mailbox_html = f"""
    <h2>2c. Mailbox Monitor Activity (Today)</h2>
    <div class="stats-grid">
        {_stat_card(str(mailbox_receipts), 'Assessment receipts (today)')}
        {_stat_card(str(mailbox_jobs_today), 'Jobs with mailbox: key (today)')}
    </div>
    <p style="font-size:0.88em;color:var(--muted);">
        The mailbox monitor scans Gmail every 15 min and creates investigation jobs for each email.
        Each job generates up to 12 Gemini calls (10 tool rounds + forced conclusion + validation repair).
        If {mailbox_receipts} emails were assessed today, they could account for up to {mailbox_receipts * 12:,} investigation calls.
    </p>
    """

    # Build reconciliation table rows
    recon_tbody = ""
    running_calls = 0
    running_input = 0
    running_output = 0
    running_thinking = 0
    running_cached = 0
    running_cost = 0.0

    for idx, g in enumerate(inv_groups):
        corr_id = str(g["_id"] or "NULL")
        short_corr = corr_id[:32] + "..." if len(corr_id) > 35 else corr_id
        models = ", ".join(g["models"][:2])
        types = ", ".join(g["call_types"][:3])

        # Determine source/trigger
        cat = _classify_corr(corr_id)
        source = cat
        rpt = report_map.get(corr_id)
        ext = extra_matches.get(corr_id)
        if rpt:
            source = f"{cat} → report ({rpt.get('status', '?')})"
        elif ext:
            source = f"{cat} → {ext.get('collection', '?')} ({ext.get('status', ext.get('type', '?'))})"

        running_calls += g["calls"]
        running_input += g["input_tokens"]
        running_output += g["output_tokens"]
        running_thinking += g["thinking_tokens"]
        running_cached += g["cached_tokens"]
        running_cost += g["cost"]

        recon_tbody += f"""<tr>
            <td>{idx + 1}</td>
            <td title="{html_mod.escape(corr_id)}" style="font-size:0.78em;word-break:break-all;max-width:180px;"><code>{html_mod.escape(short_corr)}</code></td>
            <td style="text-align:right;">{g['calls']:,}</td>
            <td style="text-align:right;">{g['ok']:,}</td>
            <td style="text-align:right;">{g['fail']:,}</td>
            <td style="text-align:right;">{g['input_tokens']:,}</td>
            <td style="text-align:right;">{g['output_tokens']:,}</td>
            <td style="text-align:right;">{g['thinking_tokens']:,}</td>
            <td style="text-align:right;">{g['cached_tokens']:,}</td>
            <td style="text-align:right;">${g['cost']:.4f}</td>
            <td style="font-size:0.82em;">{str(g['first_call'])[:19]}</td>
            <td style="font-size:0.82em;">{str(g['last_call'])[:19]}</td>
            <td style="font-size:0.82em;">{html_mod.escape(models)}</td>
            <td style="font-size:0.82em;">{html_mod.escape(source)}</td>
        </tr>"""

    # Totals row
    recon_tbody += f"""<tr style="font-weight:700;background:var(--card);">
        <td colspan="2" style="text-align:right;">TOTALS ({unique_corr} unique IDs)</td>
        <td style="text-align:right;">{running_calls:,}</td>
        <td></td><td></td>
        <td style="text-align:right;">{running_input:,}</td>
        <td style="text-align:right;">{running_output:,}</td>
        <td style="text-align:right;">{running_thinking:,}</td>
        <td style="text-align:right;">{running_cached:,}</td>
        <td style="text-align:right;">${running_cost:.4f}</td>
        <td colspan="4"></td>
    </tr>"""

    recon_html = f"""
    <h2>3. Investigation Calls — Reconciliation Table</h2>
    <div class="stats-grid">
        {_stat_card(f'{unique_corr:,}', 'Unique correlation IDs')}
        {_stat_card(f'{total_inv_calls:,}', 'Total investigation calls')}
        {_stat_card(f'{total_inv_input:,}', 'Total input tokens')}
        {_stat_card(f'${total_inv_cost:.4f}', 'Total est cost')}
        {_stat_card(f'{avg_input_per_call:,.0f}', 'Avg input tokens/call')}
        {_stat_card(f'{len(report_map):,}', 'Matched in inv_reports')}
    </div>
    <div style="overflow-x:auto;">
    <table style="font-size:0.82em;">
        <thead><tr><th>#</th><th>Correlation ID</th><th>Calls</th><th>OK</th><th>Fail</th>
        <th>Input</th><th>Output</th><th>Thinking</th><th>Cached</th><th>Est Cost</th>
        <th>First Call</th><th>Last Call</th><th>Model(s)</th><th>Source / Trigger</th></tr></thead>
        <tbody>{recon_tbody}</tbody>
    </table>
    </div>
    """

    # ── 4. Top consumers ──
    top_html = ""
    if inv_groups:
        top_html = "<h2>4. Top 10 Highest-Consuming Correlation IDs</h2>"
        for idx, g in enumerate(inv_groups[:10]):
            corr_id = str(g["_id"] or "NULL")
            avg = g["input_tokens"] / g["calls"] if g["calls"] > 0 else 0
            pct = (g["input_tokens"] / total_inv_input * 100) if total_inv_input > 0 else 0
            top_html += f"""<div class="s-card" style="margin-bottom:8px;">
                <div class="s-card-head"><strong>#{idx+1}</strong> &nbsp; <code style="font-size:0.82em;word-break:break-all;">{html_mod.escape(corr_id)}</code></div>
                <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:6px;margin-top:8px;">
                    <div><span style="color:var(--muted);font-size:0.78em;">Calls</span><br/><strong>{g['calls']:,}</strong></div>
                    <div><span style="color:var(--muted);font-size:0.78em;">Input tokens</span><br/><strong>{g['input_tokens']:,}</strong></div>
                    <div><span style="color:var(--muted);font-size:0.78em;">Avg input/call</span><br/><strong>{avg:,.0f}</strong></div>
                    <div><span style="color:var(--muted);font-size:0.78em;">Est cost</span><br/><strong>${g['cost']:.4f}</strong></div>
                    <div><span style="color:var(--muted);font-size:0.78em;">% of total input</span><br/><strong>{pct:.1f}%</strong></div>
                    <div><span style="color:var(--muted);font-size:0.78em;">Model(s)</span><br/><strong style="font-size:0.88em;">{html_mod.escape(', '.join(g['models']))}</strong></div>
                </div>
                <div style="font-size:0.8em;color:var(--muted);margin-top:6px;">
                    First: {str(g['first_call'])[:19]} &mdash; Last: {str(g['last_call'])[:19]}
                </div>
            </div>"""

    # ── 5. Failure analysis ──
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

    fail_tbody = ""
    for f in failures:
        fail_tbody += f"""<tr>
            <td>{html_mod.escape(str(f['_id']['purpose'] or 'N/A'))}</td>
            <td><code>{html_mod.escape(str(f['_id']['failure_code'] or 'N/A'))}</code></td>
            <td style="text-align:right;">{f['count']:,}</td>
            <td>{str(f['first'])[:19]}</td>
            <td>{str(f['last'])[:19]}</td>
        </tr>"""

    fail_html = f"""
    <h2>5. Failure Analysis (Today)</h2>
    <table>
        <thead><tr><th>Purpose</th><th>Failure Code</th><th>Count</th><th>First</th><th>Last</th></tr></thead>
        <tbody>{fail_tbody or '<tr><td colspan="5" style="color:var(--muted);">No failures recorded today</td></tr>'}</tbody>
    </table>
    """

    # ── 6. Compaction status ──
    compaction_pipeline = [
        {"$match": {"timestamp": {"$gte": today_start}, "purpose": "investigation"}},
        {"$group": {
            "_id": None,
            "with_flag": {"$sum": {"$cond": [{"$gt": ["$extra.compaction_active", None]}, 1, 0]}},
            "flag_true": {"$sum": {"$cond": [{"$eq": ["$extra.compaction_active", True]}, 1, 0]}},
            "flag_false": {"$sum": {"$cond": [{"$eq": ["$extra.compaction_active", False]}, 1, 0]}},
            "with_audit": {"$sum": {"$cond": [{"$gt": ["$extra.payload_audit", None]}, 1, 0]}},
        }}
    ]
    comp_data = (await db.gemini_usage.aggregate(compaction_pipeline).to_list(1)) or [{}]
    cd = comp_data[0] if comp_data else {}

    compaction_html = f"""
    <h2>6. Compaction & Payload Audit Status</h2>
    <div class="stats-grid">
        {_stat_card(str(cd.get('with_flag', 0)), 'With compaction flag')}
        {_stat_card(str(cd.get('flag_true', 0)), 'compaction_active=true')}
        {_stat_card(str(cd.get('flag_false', 0)), 'compaction_active=false')}
        {_stat_card(str(total_inv_calls - cd.get('with_flag', 0)), 'No compaction flag (legacy)')}
        {_stat_card(str(cd.get('with_audit', 0)), 'With payload audit data')}
    </div>
    """

    # ── 6b. Cost gap analysis ──
    # Count research calls for grounding cost estimation
    research_count_today = await db.gemini_usage.count_documents({
        "timestamp": {"$gte": today_start}, "purpose": "research", "success": True
    })
    grounding_est = research_count_today * 0.035  # $35/1k queries = $0.035/query
    total_estimated = total_inv_cost + sum(r["cost"] for r in purpose_rows if r["_id"]["success"])

    # Aggregate output+thinking tokens across ALL today's successful calls
    output_pipeline = [
        {"$match": {"timestamp": {"$gte": today_start}, "success": True}},
        {"$group": {
            "_id": None,
            "total_output": {"$sum": {"$ifNull": ["$tokens.output", 0]}},
            "total_thinking": {"$sum": {"$ifNull": ["$tokens.thinking", 0]}},
            "total_cached": {"$sum": {"$ifNull": ["$tokens.cached_input", 0]}},
        }}
    ]
    output_data = (await db.gemini_usage.aggregate(output_pipeline).to_list(1)) or [{}]
    od = output_data[0] if output_data else {}

    cost_gap_html = f"""
    <h2>6b. Cost Gap Analysis (Estimated vs Actual)</h2>
    <div class="alert alert-warning">
        <strong>Why Apollo's estimate may be lower than actual Google billing:</strong>
    </div>
    <table>
        <thead><tr><th>Component</th><th>Value</th><th>Estimated Impact</th></tr></thead>
        <tbody>
            <tr>
                <td>Apollo estimated cost (all purposes, success-only)</td>
                <td colspan="2" style="text-align:right;font-weight:700;">${total_estimated:.4f}</td>
            </tr>
            <tr>
                <td>Google Search grounding ({research_count_today} research calls &times; ~$0.035/query)</td>
                <td style="text-align:right;">{research_count_today} calls</td>
                <td style="text-align:right;color:var(--red);">+${grounding_est:.2f}</td>
            </tr>
            <tr>
                <td>Output tokens today</td>
                <td style="text-align:right;">{od.get('total_output', 0):,}</td>
                <td style="color:var(--muted);">Included in estimate</td>
            </tr>
            <tr>
                <td>Thinking tokens today</td>
                <td style="text-align:right;">{od.get('total_thinking', 0):,}</td>
                <td style="color:var(--muted);">Included in estimate</td>
            </tr>
            <tr>
                <td>Cached input tokens today</td>
                <td style="text-align:right;">{od.get('total_cached', 0):,}</td>
                <td style="color:var(--muted);">Discounted in estimate</td>
            </tr>
            <tr>
                <td>Pricing table drift (hardcoded rates may not match current Google pricing)</td>
                <td></td>
                <td style="text-align:right;color:var(--red);">+$1&ndash;3 (variable)</td>
            </tr>
            <tr style="font-weight:700;background:var(--card);">
                <td>Adjusted estimate</td>
                <td></td>
                <td style="text-align:right;">${total_estimated + grounding_est:.2f} + pricing drift</td>
            </tr>
        </tbody>
    </table>
    <p style="font-size:0.85em;color:var(--muted);margin-top:8px;">
        <strong>count_tokens() API calls:</strong> Apollo calls <code>count_tokens()</code> before every
        <code>generate_content()</code> for admission control. These calls are <strong>free</strong>
        (not billed by Google) but do add to API call volume.<br/>
        <strong>Failed calls (402):</strong> HTTP 402 billing failures do not consume tokens or incur charges.
    </p>
    """


    # ── 7. Historical comparison ──
    week_ago = now - timedelta(days=7)
    daily_pipeline = [
        {"$match": {"timestamp": {"$gte": week_ago}}},
        {"$group": {
            "_id": {"$dateToString": {"format": "%Y-%m-%d", "date": "$timestamp"}},
            "calls": {"$sum": 1},
            "ok": {"$sum": {"$cond": ["$success", 1, 0]}},
            "fail": {"$sum": {"$cond": ["$success", 0, 1]}},
            "input_tokens": {"$sum": {"$ifNull": ["$tokens.input", 0]}},
            "cost": {"$sum": {"$ifNull": ["$estimated_cost_usd", 0]}},
        }},
        {"$sort": {"_id": 1}}
    ]
    daily = await db.gemini_usage.aggregate(daily_pipeline).to_list(10)

    daily_tbody = ""
    for d in daily:
        daily_tbody += f"""<tr>
            <td>{d['_id']}</td>
            <td style="text-align:right;">{d['calls']:,}</td>
            <td style="text-align:right;">{d['ok']:,}</td>
            <td style="text-align:right;">{d['fail']:,}</td>
            <td style="text-align:right;">{d['input_tokens']:,}</td>
            <td style="text-align:right;">${d['cost']:.4f}</td>
        </tr>"""

    history_html = f"""
    <h2>7. Historical Comparison (Last 7 Days)</h2>
    <table>
        <thead><tr><th>Date</th><th>Total Calls</th><th>Successful</th><th>Failed</th><th>Input Tokens</th><th>Est Cost</th></tr></thead>
        <tbody>{daily_tbody or '<tr><td colspan="6" style="color:var(--muted);">No historical data</td></tr>'}</tbody>
    </table>
    """

    # ── 8. investigation_reports inspection ──
    latest_reports = await db.investigation_reports.find(
        {}, {"_id": 1, "case_id": 1, "correlation_id": 1, "status": 1, "created_at": 1}
    ).sort("created_at", -1).limit(20).to_list(20)

    reports_tbody = ""
    for r in latest_reports:
        reports_tbody += f"""<tr>
            <td style="font-size:0.82em;"><code>{html_mod.escape(str(r.get('_id', '')))}</code></td>
            <td style="font-size:0.82em;"><code>{html_mod.escape(str(r.get('case_id', r.get('correlation_id', ''))))}</code></td>
            <td>{html_mod.escape(str(r.get('status', '')))}</td>
            <td>{str(r.get('created_at', ''))[:19]}</td>
        </tr>"""

    schema_sample = await db.investigation_reports.find_one({})
    schema_keys = list(schema_sample.keys()) if schema_sample else []

    reports_html = f"""
    <h2>8. investigation_reports Collection Inspection</h2>
    <p style="color:var(--muted);font-size:0.88em;">Schema fields: <code>{html_mod.escape(', '.join(schema_keys) if schema_keys else 'empty collection')}</code></p>
    <table>
        <thead><tr><th>_id</th><th>Case / Correlation ID</th><th>Status</th><th>Created At</th></tr></thead>
        <tbody>{reports_tbody or '<tr><td colspan="4" style="color:var(--muted);">No investigation reports found</td></tr>'}</tbody>
    </table>
    """

    # ── 9. Dashboard reconciliation check ──
    success_by_purpose = [
        {"$match": {"timestamp": {"$gte": today_start}, "success": True}},
        {"$group": {"_id": "$purpose",
                    "calls": {"$sum": 1},
                    "input": {"$sum": {"$ifNull": ["$tokens.input", 0]}},
                    "cost": {"$sum": {"$ifNull": ["$estimated_cost_usd", 0]}}}},
        {"$sort": {"cost": -1}}
    ]
    by_purp = await db.gemini_usage.aggregate(success_by_purpose).to_list(20)
    total_ok_calls = sum(r["calls"] for r in by_purp)
    total_ok_input = sum(r["input"] for r in by_purp)
    total_ok_cost = sum(r["cost"] for r in by_purp)

    recon_check_tbody = ""
    for r in by_purp:
        recon_check_tbody += f"""<tr>
            <td>{html_mod.escape(str(r['_id'] or 'other'))}</td>
            <td style="text-align:right;">{r['calls']:,}</td>
            <td style="text-align:right;">{r['input']:,}</td>
            <td style="text-align:right;">${r['cost']:.4f}</td>
        </tr>"""
    recon_check_tbody += f"""<tr style="font-weight:700;background:var(--card);">
        <td>TOTAL (success-only, matches dashboard query)</td>
        <td style="text-align:right;">{total_ok_calls:,}</td>
        <td style="text-align:right;">{total_ok_input:,}</td>
        <td style="text-align:right;">${total_ok_cost:.4f}</td>
    </tr>"""

    recon_check_html = f"""
    <h2>9. Dashboard Reconciliation Check</h2>
    <p style="color:var(--muted);font-size:0.88em;">
        Dashboard "Cost Today" filter: <code>gemini_usage.timestamp &ge; {today_start.strftime('%Y-%m-%d %H:%M:%S')} UTC</code>,
        <code>success = true</code>
    </p>
    <table>
        <thead><tr><th>Purpose</th><th>Calls</th><th>Input Tokens</th><th>Est Cost</th></tr></thead>
        <tbody>{recon_check_tbody}</tbody>
    </table>
    <p style="margin-top:12px;font-size:0.88em;">
        Compare these DB-queried totals against the dashboard snapshot values.
        Minor differences are expected if new calls were recorded between the snapshot and this report.
    </p>
    """

    # ── Related collections inventory ──
    related_html = f"""
    <h2>10. Related Collections</h2>
    <p style="color:var(--muted);font-size:0.88em;">Collections matching case/investigation/magnum patterns:</p>
    <ul style="font-size:0.88em;padding-left:20px;">
    """
    for cn in sorted(case_colls):
        try:
            cnt = await db[cn].count_documents({})
            related_html += f"<li><code>{html_mod.escape(cn)}</code> &mdash; {cnt:,} documents</li>"
        except Exception:
            related_html += f"<li><code>{html_mod.escape(cn)}</code> &mdash; error</li>"
    if not case_colls:
        related_html += "<li style='color:var(--muted);'>No case/investigation-related collections found</li>"
    related_html += "</ul>"

    body = f"""
    <div class="topbar-row">
        <span style="font-size:0.88em;color:var(--muted);">Generated {now.strftime('%Y-%m-%d %H:%M:%S')} UTC</span>
        <a href="/api/admin/reconciliation/pdf" class="btn btn-sm">Download PDF</a>
    </div>
    {boundary_html}
    {purpose_html}
    {source_html}
    {mailbox_html}
    {recon_html}
    {top_html}
    {fail_html}
    {compaction_html}
    {cost_gap_html}
    {history_html}
    {reports_html}
    {recon_check_html}
    {related_html}
    """
    extra_css = "table { table-layout: auto; } td, th { white-space: nowrap; } td code { word-break: break-all; white-space: normal; }"
    await _audit_log(adm.get("email", ""), "view_reconciliation", f"investigation calls={total_inv_calls}")
    return _shell("Reconciliation", "/api/admin/reconciliation", body, admin=adm, extra_css=extra_css)


@router.get("/admin/reconciliation/pdf")
async def reconciliation_pdf(request: Request):
    """Download the reconciliation report as PDF."""
    adm = await _admin(request)
    if not adm:
        return _login_redirect()

    now = now_utc()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    # Gather same data as the HTML page
    total_today_ok = await db.gemini_usage.count_documents({"timestamp": {"$gte": today_start}, "success": True})
    total_today_fail = await db.gemini_usage.count_documents({"timestamp": {"$gte": today_start}, "success": False})
    inv_reports_24h = await db.investigation_reports.count_documents({"created_at": {"$gte": now - timedelta(hours=24)}})

    # Purpose breakdown
    purpose_pipeline = [
        {"$match": {"timestamp": {"$gte": today_start}}},
        {"$group": {
            "_id": {"purpose": "$purpose", "success": "$success"},
            "calls": {"$sum": 1},
            "input_tokens": {"$sum": {"$ifNull": ["$tokens.input", 0]}},
            "cost": {"$sum": {"$ifNull": ["$estimated_cost_usd", 0]}},
        }},
        {"$sort": {"_id.purpose": 1}}
    ]
    purpose_rows = await db.gemini_usage.aggregate(purpose_pipeline).to_list(100)

    purpose_tbody = ""
    for r in purpose_rows:
        s = "Yes" if r["_id"]["success"] else "No"
        purpose_tbody += f"<tr><td>{r['_id']['purpose'] or 'N/A'}</td><td>{s}</td><td>{r['calls']:,}</td><td>{r['input_tokens']:,}</td><td>${r['cost']:.4f}</td></tr>"

    # Investigation correlation groups
    inv_corr_pipeline = [
        {"$match": {"timestamp": {"$gte": today_start}, "purpose": "investigation"}},
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
            "models": {"$addToSet": "$model"},
        }},
        {"$sort": {"cost": -1}}
    ]
    inv_groups = await db.gemini_usage.aggregate(inv_corr_pipeline).to_list(500)

    recon_tbody = ""
    r_calls = r_input = r_output = r_thinking = r_cached = 0
    r_cost = 0.0
    for idx, g in enumerate(inv_groups):
        corr_id = str(g["_id"] or "NULL")[:30]
        models = ", ".join(g["models"][:2])
        r_calls += g["calls"]
        r_input += g["input_tokens"]
        r_output += g["output_tokens"]
        r_thinking += g["thinking_tokens"]
        r_cached += g["cached_tokens"]
        r_cost += g["cost"]
        recon_tbody += (f"<tr><td>{idx+1}</td><td style='font-size:8px;'>{corr_id}</td>"
                        f"<td>{g['calls']}</td><td>{g['ok']}</td><td>{g['fail']}</td>"
                        f"<td>{g['input_tokens']:,}</td><td>{g['output_tokens']:,}</td>"
                        f"<td>{g['thinking_tokens']:,}</td><td>{g['cached_tokens']:,}</td>"
                        f"<td>${g['cost']:.4f}</td>"
                        f"<td style='font-size:8px;'>{str(g['first_call'])[:19]}</td>"
                        f"<td style='font-size:8px;'>{str(g['last_call'])[:19]}</td>"
                        f"<td style='font-size:8px;'>{models}</td></tr>")

    recon_tbody += (f"<tr style='font-weight:bold;'><td colspan='2'>TOTALS ({len(inv_groups)} IDs)</td>"
                    f"<td>{r_calls:,}</td><td></td><td></td>"
                    f"<td>{r_input:,}</td><td>{r_output:,}</td>"
                    f"<td>{r_thinking:,}</td><td>{r_cached:,}</td>"
                    f"<td>${r_cost:.4f}</td><td colspan='3'></td></tr>")

    pdf_body = f"""
    <h2>Timestamp Boundaries</h2>
    <p>Report: {now.strftime('%Y-%m-%d %H:%M:%S')} UTC<br/>
    "Today" boundary: {today_start.strftime('%Y-%m-%d %H:%M:%S')} UTC (midnight)<br/>
    gemini_usage today: {total_today_ok + total_today_fail:,} ({total_today_ok:,} ok, {total_today_fail:,} fail)<br/>
    investigation_reports (24h): {inv_reports_24h:,}</p>

    <h2>Calls by Purpose (Today)</h2>
    <table><thead><tr><th>Purpose</th><th>Success</th><th>Calls</th><th>Input Tokens</th><th>Est Cost</th></tr></thead>
    <tbody>{purpose_tbody or '<tr><td colspan="5">No data</td></tr>'}</tbody></table>

    <h2>Investigation Reconciliation Table</h2>
    <table style="font-size:8px;"><thead><tr>
    <th>#</th><th>Correlation ID</th><th>Calls</th><th>OK</th><th>Fail</th>
    <th>Input</th><th>Output</th><th>Thinking</th><th>Cached</th><th>Cost</th>
    <th>First</th><th>Last</th><th>Model</th></tr></thead>
    <tbody>{recon_tbody}</tbody></table>
    """

    full_html = _pdf_html("Usage Reconciliation Report", pdf_body)

    from xhtml2pdf import pisa
    pdf_buffer = io.BytesIO()
    pisa.CreatePDF(io.StringIO(full_html), dest=pdf_buffer)
    pdf_buffer.seek(0)

    await _audit_log(adm.get("email", ""), "download_reconciliation_pdf", "")
    return StreamingResponse(
        pdf_buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="apollo_reconciliation_{now.strftime("%Y%m%d_%H%M")}.pdf"'},
    )



# ── System ───────────────────────────────────────────────────────────────────

@router.get("/admin/system", response_class=HTMLResponse)
async def system_page(request: Request):
    adm = await _admin(request)
    if not adm:
        return _login_redirect()

    be = await check_backend()
    db_health = await check_database()

    try:
        migration_count = await db.apollo_migrations.count_documents({})
    except Exception:
        migration_count = "?"

    body = f"""
    <h2>Backend</h2>
    {_status_card("Backend Process", be['status'], be.get('detail',''))}
    <div class="stats-grid">
        {_stat_card(f"{be.get('uptime_hours', 0):.1f}h", "Uptime")}
        {_stat_card(str(be.get('pid','?')), "PID")}
        {_stat_card(str(migration_count), "Migrations Applied")}
    </div>

    <h2>Database</h2>
    {_status_card("MongoDB", db_health['status'], db_health.get('detail',''))}
    <div class="stats-grid">
        {_stat_card(str(db_health.get('collections','?')), "Collections")}
        {_stat_card(f"{db_health.get('data_size_mb','?')} MB", "Data Size")}
        {_stat_card(f"{db_health.get('storage_size_mb','?')} MB", "Storage Size")}
        {_stat_card(str(db_health.get('indexes','?')), "Indexes")}
        {_stat_card(f"{db_health.get('objects', 0):,}" if isinstance(db_health.get('objects'), int) else '?', "Documents")}
    </div>

    <h2>Environment</h2>
    <table>
        <tr><td>Gemini Text Model</td><td><code>{html_mod.escape(os.getenv('GEMINI_TEXT_MODEL','gemini-3.8-flash'))}</code></td></tr>
        <tr><td>Gemini Vision Model</td><td><code>{html_mod.escape(os.getenv('GEMINI_VISION_MODEL','gemini-3.8-flash'))}</code></td></tr>
        <tr><td>Admin Email</td><td><code>{html_mod.escape(ADMIN_EMAIL or 'not set')}</code></td></tr>
        <tr><td>Cookie Secure</td><td><code>{os.getenv('COOKIE_SECURE','false')}</code></td></tr>
    </table>
    """
    return _shell("System", "/api/admin/system", body, admin=adm)


# ── Releases ─────────────────────────────────────────────────────────────────

@router.get("/admin/releases", response_class=HTMLResponse)
async def releases(request: Request):
    adm = await _admin(request)
    if not adm:
        return _login_redirect()

    try:
        recent_migrations = await db.apollo_migrations.find(
            {}, {"_id": 0, "name": 1, "applied_at": 1}
        ).sort("applied_at", -1).limit(20).to_list(20)
    except Exception:
        recent_migrations = []

    mig_rows = ""
    for m in recent_migrations:
        mig_rows += f"<tr><td>{html_mod.escape(str(m.get('name','')))}</td><td>{str(m.get('applied_at',''))[:19]}</td></tr>"

    body = f"""
    <h2>Application Versions</h2>
    <table>
        <tr><td>Frontend</td><td><code>1.0.0</code></td></tr>
        <tr><td>Backend</td><td><code>Expo + FastAPI</code></td></tr>
        <tr><td>Gemini Model</td><td><code>{html_mod.escape(os.getenv('GEMINI_TEXT_MODEL','gemini-3.8-flash'))}</code></td></tr>
    </table>

    <h2>Recent Migrations</h2>
    <table><thead><tr><th>Migration</th><th>Applied</th></tr></thead>
    <tbody>{mig_rows or '<tr><td colspan="2" style="color:var(--muted);">No migrations found</td></tr>'}</tbody></table>
    """
    return _shell("Releases", "/api/admin/releases", body, admin=adm)


# ── Diagnostics ──────────────────────────────────────────────────────────────

@router.get("/admin/diagnostics", response_class=HTMLResponse)
async def diagnostics(request: Request):
    adm = await _admin(request)
    if not adm:
        return _login_redirect()

    lines = _read_logs(300)

    # Recent Gemini errors
    try:
        recent_errors = await db.gemini_usage.find(
            {"success": False}, {"_id": 0, "timestamp": 1, "failure_code": 1, "purpose": 1, "model": 1}
        ).sort("timestamp", -1).limit(20).to_list(20)
    except Exception:
        recent_errors = []

    err_rows = ""
    for e in recent_errors:
        err_rows += f"<tr><td>{str(e.get('timestamp',''))[:19]}</td><td>{e.get('purpose','')}</td><td>{e.get('failure_code','')}</td><td>{e.get('model','')}</td></tr>"

    body = f"""
    <h2>Recent Gemini Errors</h2>
    <table><thead><tr><th>Time</th><th>Purpose</th><th>Error</th><th>Model</th></tr></thead>
    <tbody>{err_rows or '<tr><td colspan="4" style="color:var(--muted);">No recent errors</td></tr>'}</tbody></table>

    <h2>Backend Logs (last 300 lines)</h2>
    <pre class="log-box">{lines}</pre>
    """
    return _shell("Diagnostics", "/api/admin/diagnostics", body, admin=adm)


# ── Audit ────────────────────────────────────────────────────────────────────

@router.get("/admin/audit-log", response_class=HTMLResponse)
async def audit(request: Request):
    adm = await _admin(request)
    if not adm:
        return _login_redirect()

    rows_data = await db.admin_audit.find({}, {"_id": 0}).sort("timestamp", -1).limit(100).to_list(100)
    rows = ""
    for r in rows_data:
        rows += f"<tr><td>{str(r.get('timestamp',''))[:19]}</td><td>{html_mod.escape(r.get('email',''))}</td><td>{html_mod.escape(r.get('action',''))}</td><td>{html_mod.escape(str(r.get('detail',''))[:120])}</td></tr>"

    body = f"""
    <h2>Admin Audit Log</h2>
    <table><thead><tr><th>Time</th><th>Account</th><th>Action</th><th>Detail</th></tr></thead>
    <tbody>{rows or '<tr><td colspan="4" style="color:var(--muted);">No audit records</td></tr>'}</tbody></table>
    """
    return _shell("Audit", "/api/admin/audit", body, admin=adm)


# ── Admin Settings ───────────────────────────────────────────────────────────

@router.get("/admin/settings", response_class=HTMLResponse)
async def admin_settings(request: Request):
    adm = await _admin(request)
    if not adm:
        return _login_redirect()

    session_count = await db[_SESSIONS].count_documents({})

    body = f"""
    <h2>Admin Account</h2>
    <table>
        <tr><td>Email</td><td><code>{html_mod.escape(adm.get('email',''))}</code></td></tr>
        <tr><td>Name</td><td>{html_mod.escape(adm.get('name',''))}</td></tr>
        <tr><td>Session created</td><td>{str(adm.get('created_at',''))[:19]}</td></tr>
        <tr><td>Session expires</td><td>{str(adm.get('expires_at',''))[:19]}</td></tr>
        <tr><td>Active sessions</td><td>{session_count}</td></tr>
    </table>
    <form method="post" action="/api/admin/logout" style="margin-top:16px;">
        <button class="btn">Sign out</button>
    </form>
    """
    return _shell("Admin", "/api/admin/settings", body, admin=adm)


# ── Reports (HTML + PDF) ────────────────────────────────────────────────────

@router.get("/admin/reports/{report_name}", response_class=HTMLResponse)
async def admin_report(request: Request, report_name: str):
    adm = await _admin(request)
    if not adm:
        return _login_redirect()
    if report_name not in REPORTS:
        return HTMLResponse("Report not found", status_code=404)
    filename, title = REPORTS[report_name]
    md_file = REPORT_DIR / filename
    if not md_file.exists():
        return HTMLResponse("Report file not found", status_code=404)
    html_body = _render_md(md_file)
    body = f"""
    <div class="topbar-row">
        <a href="/api/admin/portal" style="color:var(--accent);text-decoration:none;">&larr; Dashboard</a>
        <a href="/api/admin/reports/{report_name}/pdf" class="btn btn-sm">Download PDF</a>
    </div>
    <article>{html_body}</article>
    """
    await _audit_log(adm.get("email", ""), "view_report", report_name)
    return _shell(title, f"/api/admin/reports/{report_name}", body, admin=adm)


@router.get("/admin/reports/{report_name}/pdf")
async def admin_report_pdf(request: Request, report_name: str):
    adm = await _admin(request)
    if not adm:
        return _login_redirect()
    if report_name not in REPORTS:
        return HTMLResponse("Report not found", status_code=404)
    filename, title = REPORTS[report_name]
    md_file = REPORT_DIR / filename
    if not md_file.exists():
        return HTMLResponse("Report file not found", status_code=404)

    html_body = _render_md(md_file)
    full_html = _pdf_html(title, html_body)

    from xhtml2pdf import pisa
    pdf_buffer = io.BytesIO()
    pisa_status = pisa.CreatePDF(io.StringIO(full_html), dest=pdf_buffer)
    if pisa_status.err:
        return HTMLResponse("PDF generation failed", status_code=500)
    pdf_buffer.seek(0)

    safe_name = report_name.replace("/", "_")
    await _audit_log(adm.get("email", ""), "download_pdf", report_name)
    return StreamingResponse(
        pdf_buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="apollo_{safe_name}.pdf"'},
    )


# ── Helpers ──────────────────────────────────────────────────────────────────

def _render_md(path: Path) -> str:
    text = path.read_text(encoding="utf-8")
    text = text.replace("\u2705", "[DONE]").replace("\u23f3", "[PENDING]")
    text = text.replace("\u274c", "[NO]")
    return markdown.markdown(text, extensions=["tables", "fenced_code", "toc"])


def _pdf_html(title: str, body: str) -> str:
    return f"""<!DOCTYPE html><html><head><meta charset="utf-8"><title>{title}</title>
<style>
body {{ font-family: Helvetica, Arial, sans-serif; font-size: 11px; line-height: 1.5; color: #222; padding: 20px; }}
h1 {{ font-size: 18px; margin: 0 0 8px; }} h2 {{ font-size: 14px; margin: 20px 0 8px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }}
h3 {{ font-size: 12px; margin: 14px 0 6px; }}
table {{ width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 10px; }}
th, td {{ padding: 4px 6px; border: 1px solid #ccc; text-align: left; }}
th {{ background: #f0f0f0; font-weight: bold; }}
code {{ background: #f5f5f5; padding: 1px 3px; font-size: 10px; }}
pre {{ background: #f5f5f5; padding: 8px; font-size: 9px; overflow-wrap: break-word; }}
strong {{ color: #000; }}
.footer {{ margin-top: 24px; font-size: 9px; color: #999; border-top: 1px solid #ccc; padding-top: 8px; }}
</style></head><body>
<h1>{title}</h1>
<p style="font-size:9px;color:#666;">Generated: {now_utc().strftime('%Y-%m-%d %H:%M UTC')} — Apollo Admin Portal</p>
{body}
<div class="footer">Apollo Admin Portal — Confidential</div>
</body></html>"""


def _status_color(status: str) -> str:
    return {"healthy": "#3fb950", "degraded": "#d29922", "down": "#f85149",
            "connected": "#3fb950"}.get(status, "#8b949e")


def _integration_color(status: str) -> str:
    return {CONNECTED: "#3fb950", DEGRADED: "#d29922", NOT_CONFIGURED: "#8b949e",
            UNABLE: "#f85149", OK: "#3fb950", DOWN: "#f85149"}.get(status, "#8b949e")


def _integration_label(status: str) -> str:
    return {CONNECTED: "Connected", DEGRADED: "Degraded", NOT_CONFIGURED: "Not Configured",
            UNABLE: "Unable to Verify", OK: "Connected", DOWN: "Down"}.get(status, "Unknown")


def _status_card(label: str, status: str, detail: str) -> str:
    c = _status_color(status)
    return f"""<div class="s-card"><div class="s-card-head"><span class="dot" style="background:{c};"></span><strong>{html_mod.escape(label)}</strong></div>
    <div class="s-card-status" style="color:{c};">{status.replace('_',' ').title()}</div>
    <div class="s-card-detail">{html_mod.escape(detail)}</div></div>"""


def _mini_status(label: str, status: str, detail: str) -> str:
    c = _status_color(status)
    return f"""<div class="m-card"><span class="dot" style="background:{c};"></span><strong>{html_mod.escape(label)}</strong><br/><span style="font-size:0.82em;color:var(--muted);">{html_mod.escape(detail)}</span></div>"""


def _stat_card(value: str, label: str) -> str:
    return f'<div class="stat-card"><div class="stat-value">{html_mod.escape(str(value))}</div><div class="stat-label">{html_mod.escape(label)}</div></div>'


def _read_logs(count: int = 200) -> str:
    for p in ["/var/log/supervisor/backend-stdout.log", "/var/log/backend.log", "/tmp/backend.log"]:
        try:
            with open(p) as f:
                return html_mod.escape("".join(f.readlines()[-count:]))
        except (FileNotFoundError, PermissionError):
            continue
    return "(No log file found)"


def _shell(title: str, active_path: str, body: str, *, admin: dict | None = None,
           show_nav: bool = True, extra_css: str = "") -> str:
    nav_html = ""
    if show_nav and admin:
        for label, path, icon in NAV:
            act = " active" if path == active_path else ""
            nav_html += f'<a class="nav-item{act}" href="{path}"><span class="nav-icon">{icon}</span>{label}</a>'
        pic = admin.get("picture", "")
        name = admin.get("name", admin.get("email", "Admin"))
        nav_html += f"""<div class="nav-footer">
            {'<img src="' + pic + '" class="nav-avatar" />' if pic else ''}
            <span class="nav-user">{html_mod.escape(name)}</span>
            <form method="post" action="/api/admin/logout" style="margin:0;"><button class="btn btn-sm" style="width:100%;margin-top:8px;">Sign out</button></form>
        </div>"""

    sidebar = f'<nav class="sidebar">{nav_html}</nav>' if show_nav and admin else ""
    main_cls = "main" if show_nav and admin else "main-full"

    return f"""<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html_mod.escape(title)} — Apollo Admin</title>
<style>
:root {{ --bg:#0d1117; --fg:#c9d1d9; --muted:#8b949e; --border:#30363d;
         --accent:#58a6ff; --card:#161b22; --green:#3fb950; --red:#f85149; --yellow:#d29922; }}
*{{box-sizing:border-box;margin:0;padding:0;}}
body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;background:var(--bg);color:var(--fg);line-height:1.6;display:flex;min-height:100vh;}}
.sidebar{{width:220px;background:var(--card);border-right:1px solid var(--border);padding:16px 0;display:flex;flex-direction:column;position:fixed;top:0;left:0;bottom:0;overflow-y:auto;z-index:10;}}
.nav-item{{display:flex;align-items:center;gap:10px;padding:9px 20px;color:var(--muted);text-decoration:none;font-size:0.9em;transition:background 0.15s;}}
.nav-item:hover{{background:rgba(255,255,255,0.04);color:var(--fg);}}
.nav-item.active{{color:#fff;background:rgba(88,166,255,0.1);border-right:2px solid var(--accent);}}
.nav-icon{{width:20px;text-align:center;font-size:1.05em;}}
.nav-footer{{margin-top:auto;padding:16px 20px;border-top:1px solid var(--border);}}
.nav-avatar{{width:28px;height:28px;border-radius:50%;}}
.nav-user{{font-size:0.82em;color:var(--muted);display:block;margin-top:4px;word-break:break-all;}}
.main{{margin-left:220px;padding:24px 32px;flex:1;max-width:960px;}}
.main-full{{padding:24px 32px;flex:1;max-width:960px;margin:0 auto;}}
h2{{font-size:1.15rem;margin:28px 0 12px;padding-bottom:6px;border-bottom:1px solid var(--border);color:#fff;}}
h3{{font-size:1rem;margin:20px 0 6px;color:var(--accent);}}
a{{color:var(--accent);text-decoration:none;}} a:hover{{text-decoration:underline;}}
table{{width:100%;border-collapse:collapse;margin:0 0 16px;font-size:0.88em;}}
th,td{{padding:7px 10px;border:1px solid var(--border);text-align:left;}}
th{{background:var(--card);color:#fff;font-weight:600;font-size:0.85em;}}
td{{background:var(--bg);}}
tr:hover td{{background:var(--card);}}
code{{background:var(--card);padding:2px 6px;border-radius:4px;font-size:0.88em;}}
pre{{background:var(--card);padding:12px;border-radius:8px;overflow-x:auto;margin:0 0 16px;border:1px solid var(--border);font-size:0.82em;}}
.btn{{display:inline-block;padding:6px 14px;border-radius:6px;background:var(--card);border:1px solid var(--border);color:var(--fg);cursor:pointer;font-size:0.88em;text-decoration:none;}}
.btn:hover{{border-color:var(--accent);color:#fff;}}
.btn-sm{{padding:4px 10px;font-size:0.8em;}}
.stats-grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin:12px 0 20px;}}
.stat-card{{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:14px;text-align:center;}}
.stat-value{{font-size:1.25rem;font-weight:700;color:#fff;}}
.stat-label{{font-size:0.78em;color:var(--muted);margin-top:4px;}}
.status-grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px;margin:12px 0;}}
.s-card{{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:14px;}}
.s-card-head{{display:flex;align-items:center;gap:8px;margin-bottom:6px;}}
.s-card-status{{font-size:0.9em;font-weight:600;margin-bottom:4px;}}
.s-card-detail{{font-size:0.82em;color:var(--muted);}}
.mini-grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;margin:12px 0;}}
.m-card{{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:10px;}}
.dot{{width:8px;height:8px;border-radius:50%;display:inline-block;flex-shrink:0;}}
.badge{{display:inline-block;padding:2px 8px;border-radius:10px;font-size:0.78em;font-weight:600;}}
.overall-banner{{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:14px 18px;display:flex;align-items:center;gap:12px;margin-bottom:16px;}}
.alert{{padding:12px 16px;border-radius:8px;margin-bottom:12px;font-size:0.9em;}}
.alert-ok{{background:rgba(63,185,80,0.08);border:1px solid rgba(63,185,80,0.2);color:var(--green);}}
.alert-warning{{background:rgba(210,153,34,0.08);border:1px solid rgba(210,153,34,0.2);color:var(--yellow);}}
.alert-critical{{background:rgba(248,81,73,0.08);border:1px solid rgba(248,81,73,0.2);color:var(--red);}}
.alert ul{{margin:6px 0 0;padding-left:20px;}}
.report-list{{display:flex;flex-direction:column;gap:8px;}}
.report-row{{display:flex;align-items:center;justify-content:space-between;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:10px 14px;}}
.topbar-row{{display:flex;justify-content:space-between;align-items:center;padding:10px 0;margin-bottom:12px;border-bottom:1px solid var(--border);}}
.log-box{{max-height:60vh;overflow-y:auto;white-space:pre-wrap;word-break:break-all;line-height:1.4;}}
.spinner{{width:32px;height:32px;border:3px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite;margin:0 auto;}}
@keyframes spin{{to{{transform:rotate(360deg);}}}}
article table{{width:100%;}} article h1{{font-size:1.5rem;}} article h2{{font-size:1.2rem;}} article h3{{font-size:1rem;}}
@media(max-width:700px){{.sidebar{{width:180px;}} .main{{margin-left:180px;padding:16px;}} }}
{extra_css}
</style></head><body>
{sidebar}
<div class="{main_cls}">{body}</div>
</body></html>"""
