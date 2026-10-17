"""Admin portal — Google-authenticated web dashboard for Apollo admin.

Routes (all under /api/admin):
    GET  /login            → redirect to Emergent Google sign-in
    GET  /auth/callback    → relay page (reads fragment, POSTs to exchange)
    POST /auth/exchange    → verify Emergent session, create cookie session
    GET  /portal           → main dashboard
    GET  /reports/:name    → rendered Markdown reports
    GET  /usage/live       → live Gemini usage JSON from DB
    GET  /logs             → recent backend log tail
    POST /logout           → destroy session
"""

from __future__ import annotations

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
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

from core.db import db

load_dotenv()

router = APIRouter(tags=["admin"])

ADMIN_EMAIL = (os.getenv("ADMIN_EMAIL", "")).strip().casefold()
SESSION_TTL_HOURS = 8
EMERGENT_SESSION_URL = "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data"
REPORT_DIR = Path(__file__).resolve().parent.parent  # /app/backend

_SESSIONS = "admin_sessions"


# ── Session helpers ──────────────────────────────────────────────────────────

def _cookie_kwargs() -> dict:
    return dict(
        key="apollo_admin",
        httponly=True,
        secure=os.getenv("COOKIE_SECURE", "false").lower() == "true",
        samesite="lax",
        path="/",
        max_age=SESSION_TTL_HOURS * 3600,
    )


async def _current_admin(request: Request) -> Optional[dict]:
    token = request.cookies.get("apollo_admin")
    if not token:
        return None
    row = await db[_SESSIONS].find_one({"token": token})
    if not row:
        return None
    if row.get("expires_at") and row["expires_at"].replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
        await db[_SESSIONS].delete_one({"_id": row["_id"]})
        return None
    return row


def _require_auth_redirect():
    return RedirectResponse("/api/admin/login", status_code=303)


def _app_origin(request: Request) -> str:
    """Derive the origin from the request for callback URL."""
    forwarded_proto = request.headers.get("x-forwarded-proto", "http")
    forwarded_host = request.headers.get("x-forwarded-host") or request.headers.get("host", "localhost")
    return f"{forwarded_proto}://{forwarded_host}"


# ── Auth routes ──────────────────────────────────────────────────────────────

@router.get("/admin/login")
async def admin_login(request: Request):
    origin = _app_origin(request)
    emergent_url = "https://auth.emergentagent.com/?" + urlencode({
        "redirect": origin + "/api/admin/auth/callback"
    })
    return RedirectResponse(emergent_url, status_code=303)


@router.get("/admin/auth/callback", response_class=HTMLResponse)
async def admin_auth_callback():
    """Relay page: reads #session_id from fragment and POSTs to exchange."""
    return _page("Signing in…", """
    <div style="display:flex;align-items:center;justify-content:center;height:80vh;">
      <div style="text-align:center;">
        <div class="spinner"></div>
        <p style="margin-top:16px;color:#8b949e;">Authenticating with Google…</p>
        <p id="err" style="color:#f85149;display:none;margin-top:12px;"></p>
      </div>
    </div>
    <script>
    (async () => {
      const p = new URLSearchParams(location.hash.slice(1));
      const sid = p.get('session_id');
      const err = document.getElementById('err');
      if (!sid) { err.textContent = 'Missing sign-in session. Please try again.'; err.style.display='block'; return; }
      try {
        const r = await fetch('/api/admin/auth/exchange', {
          method: 'POST', headers: {'content-type': 'application/json'},
          credentials: 'same-origin', body: JSON.stringify({session_id: sid})
        });
        if (r.ok) { location.replace('/api/admin/portal'); return; }
        const t = await r.text();
        err.textContent = r.status === 403 ? 'Access denied. This account is not authorised.' : 'Sign-in failed: ' + t;
        err.style.display = 'block';
      } catch(e) { err.textContent = 'Network error. Please try again.'; err.style.display = 'block'; }
    })();
    </script>
    """)


@router.post("/admin/auth/exchange")
async def admin_auth_exchange(request: Request):
    body = await request.json()
    sid = body.get("session_id", "")
    if not sid or len(sid) > 4096:
        return HTMLResponse("Invalid session", status_code=400)

    # Exchange with Emergent
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.get(EMERGENT_SESSION_URL, headers={"X-Session-ID": sid})

    if r.status_code != 200:
        return HTMLResponse("Invalid or expired sign-in", status_code=401)

    identity = r.json()
    email = (identity.get("email") or "").strip().casefold()

    if not ADMIN_EMAIL or not secrets.compare_digest(email, ADMIN_EMAIL):
        return HTMLResponse("Not authorised", status_code=403)

    # Create session
    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    await db[_SESSIONS].insert_one({
        "token": token,
        "email": email,
        "name": identity.get("name", ""),
        "picture": identity.get("picture", ""),
        "created_at": now,
        "expires_at": now + timedelta(hours=SESSION_TTL_HOURS),
    })

    response = JSONResponse({"ok": True})
    response.set_cookie(value=token, **_cookie_kwargs())
    return response


@router.post("/admin/logout")
async def admin_logout(request: Request):
    token = request.cookies.get("apollo_admin")
    if token:
        await db[_SESSIONS].delete_one({"token": token})
    response = RedirectResponse("/api/admin/login", status_code=303)
    response.delete_cookie("apollo_admin", path="/")
    return response


# ── Portal pages ─────────────────────────────────────────────────────────────

@router.get("/admin/portal", response_class=HTMLResponse)
async def admin_portal(request: Request):
    admin = await _current_admin(request)
    if not admin:
        return _require_auth_redirect()

    name = admin.get("name", admin.get("email", "Admin"))
    picture = admin.get("picture", "")

    return _page("Apollo Admin", f"""
    <div class="topbar">
      <div style="display:flex;align-items:center;gap:12px;">
        <span style="font-size:1.5rem;font-weight:700;color:#fff;">Apollo Admin</span>
      </div>
      <div style="display:flex;align-items:center;gap:12px;">
        {'<img src="' + picture + '" style="width:32px;height:32px;border-radius:50%;" />' if picture else ''}
        <span style="color:#8b949e;">{name}</span>
        <form method="post" action="/api/admin/logout" style="margin:0;">
          <button class="btn btn-sm">Sign out</button>
        </form>
      </div>
    </div>

    <div class="grid">
      <a href="/api/admin/reports/gemini-usage-investigation" class="card">
        <div class="card-icon" style="background:rgba(88,166,255,0.12);color:#58a6ff;">&#128270;</div>
        <h3>Usage Investigation</h3>
        <p>Root cause analysis of Gemini API token consumption</p>
      </a>
      <a href="/api/admin/reports/gemini-usage-tracking" class="card">
        <div class="card-icon" style="background:rgba(63,185,80,0.12);color:#3fb950;">&#128200;</div>
        <h3>Usage Tracking Report</h3>
        <p>Live token metrics, cost breakdown, and compaction effectiveness</p>
      </a>
      <a href="/api/admin/usage/live" class="card">
        <div class="card-icon" style="background:rgba(210,153,34,0.12);color:#d29922;">&#9889;</div>
        <h3>Live Usage Data</h3>
        <p>Real-time Gemini API call statistics from the database</p>
      </a>
      <a href="/api/admin/logs" class="card">
        <div class="card-icon" style="background:rgba(248,81,73,0.12);color:#f85149;">&#128209;</div>
        <h3>Backend Logs</h3>
        <p>Recent backend application logs</p>
      </a>
    </div>
    """, extra_css="""
    .topbar { display:flex; justify-content:space-between; align-items:center; padding:16px 0; margin-bottom:24px; border-bottom:1px solid var(--border); }
    .grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:16px; }
    .card { display:block; background:var(--card); border:1px solid var(--border); border-radius:12px; padding:20px; text-decoration:none; color:var(--fg); transition:border-color 0.2s; }
    .card:hover { border-color:var(--accent); }
    .card h3 { margin:12px 0 4px; color:#fff; font-size:1.1rem; }
    .card p { color:var(--muted); font-size:0.9rem; margin:0; }
    .card-icon { width:48px; height:48px; border-radius:12px; display:flex; align-items:center; justify-content:center; font-size:1.5rem; }
    """)


@router.get("/admin/reports/{report_name}", response_class=HTMLResponse)
async def admin_report(request: Request, report_name: str):
    admin = await _current_admin(request)
    if not admin:
        return _require_auth_redirect()

    allowed = {
        "gemini-usage-investigation": ("GEMINI_USAGE_INVESTIGATION.md", "Gemini Usage Investigation — Root Cause Analysis"),
        "gemini-usage-tracking": ("GEMINI_USAGE_TRACKING_REPORT.md", "Gemini Usage Tracking Report"),
    }
    if report_name not in allowed:
        return HTMLResponse("Report not found", status_code=404)

    filename, title = allowed[report_name]
    md_file = REPORT_DIR / filename
    if not md_file.exists():
        return HTMLResponse("Report file not found", status_code=404)

    md_text = md_file.read_text(encoding="utf-8")
    md_text = md_text.replace("\u2705", '<span class="badge badge-done">DONE</span>')
    md_text = md_text.replace("\u23f3", '<span class="badge badge-pending">PENDING</span>')
    html_body = markdown.markdown(md_text, extensions=["tables", "fenced_code", "toc"])

    return _page(title, f"""
    <div class="topbar">
      <a href="/api/admin/portal" style="color:var(--accent);text-decoration:none;">&larr; Dashboard</a>
    </div>
    <article>{html_body}</article>
    """, extra_css="""
    .topbar { padding:12px 0; margin-bottom:16px; border-bottom:1px solid var(--border); }
    article table {{ width:100%; }}
    .badge {{ display:inline-block; padding:2px 8px; border-radius:12px; font-size:0.8em; font-weight:600; }}
    .badge-done {{ background:rgba(63,185,80,0.15); color:var(--green); }}
    .badge-pending {{ background:rgba(248,81,73,0.15); color:var(--red); }}
    """)


@router.get("/admin/usage/live", response_class=HTMLResponse)
async def admin_usage_live(request: Request):
    admin = await _current_admin(request)
    if not admin:
        return _require_auth_redirect()

    # Fetch live stats
    stats = await _fetch_usage_stats()

    # Build the stats table rows
    purpose_rows = ""
    for p in stats["by_purpose"]:
        purpose_rows += f"""<tr>
            <td>{p['purpose']}</td><td style="text-align:right">{p['count']:,}</td>
            <td style="text-align:right">{p['successes']:,}</td><td style="text-align:right">{p['failures']:,}</td>
            <td style="text-align:right">{p['total_input']:,}</td><td style="text-align:right">{p['total_output']:,}</td>
            <td style="text-align:right">{p['total_thinking']:,}</td><td style="text-align:right">${p['total_cost']:.4f}</td>
        </tr>"""

    correlation_rows = ""
    for c in stats["recent_investigations"]:
        status = "ok" if c["successes"] > 0 else "fail"
        correlation_rows += f"""<tr>
            <td style="font-family:monospace;font-size:0.85em;">{c['correlation_id'][:40]}</td>
            <td style="text-align:right">{c['count']:,}</td>
            <td style="text-align:right">{c['total_input']:,}</td><td style="text-align:right">{c['total_output']:,}</td>
            <td style="text-align:right">${c['total_cost']:.4f}</td>
            <td style="text-align:right">{str(c.get('last',''))[:16]}</td>
        </tr>"""

    return _page("Live Gemini Usage", f"""
    <div class="topbar">
      <a href="/api/admin/portal" style="color:var(--accent);text-decoration:none;">&larr; Dashboard</a>
      <span style="color:var(--muted);font-size:0.85em;">Last updated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}</span>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">{stats['totals']['total_calls']:,}</div>
        <div class="stat-label">Total Calls</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{stats['totals']['successes']:,}</div>
        <div class="stat-label">Successful</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{stats['totals']['total_input']:,}</div>
        <div class="stat-label">Input Tokens</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{stats['totals']['total_output']:,}</div>
        <div class="stat-label">Output Tokens</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{stats['totals']['total_thinking']:,}</div>
        <div class="stat-label">Thinking Tokens</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats['totals']['total_cost']:.4f}</div>
        <div class="stat-label">Estimated Cost</div>
      </div>
    </div>

    <h2>By Purpose</h2>
    <table>
      <thead><tr><th>Purpose</th><th style="text-align:right">Calls</th><th style="text-align:right">OK</th><th style="text-align:right">Fail</th><th style="text-align:right">Input</th><th style="text-align:right">Output</th><th style="text-align:right">Thinking</th><th style="text-align:right">Cost</th></tr></thead>
      <tbody>{purpose_rows}</tbody>
    </table>

    <h2>Investigation Statistics</h2>
    <div class="stats-grid" style="grid-template-columns:repeat(auto-fill,minmax(200px,1fr));">
      <div class="stat-card">
        <div class="stat-value">{stats['investigation_stats'].get('count', 0):,}</div>
        <div class="stat-label">Investigation Calls</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{stats['investigation_stats'].get('avg_input', 0):,.0f}</div>
        <div class="stat-label">Avg Input/Call</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{stats['investigation_stats'].get('max_input', 0):,}</div>
        <div class="stat-label">Max Input/Call</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{stats['investigation_stats'].get('avg_duration', 0):,.0f} ms</div>
        <div class="stat-label">Avg Duration</div>
      </div>
    </div>

    <h2>Recent Investigations (by correlation)</h2>
    <table>
      <thead><tr><th>Correlation ID</th><th style="text-align:right">Calls</th><th style="text-align:right">Input</th><th style="text-align:right">Output</th><th style="text-align:right">Cost</th><th style="text-align:right">Last Call</th></tr></thead>
      <tbody>{correlation_rows}</tbody>
    </table>
    """, extra_css="""
    .topbar { display:flex; justify-content:space-between; align-items:center; padding:12px 0; margin-bottom:16px; border-bottom:1px solid var(--border); }
    .stats-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(160px,1fr)); gap:12px; margin:16px 0 24px; }
    .stat-card { background:var(--card); border:1px solid var(--border); border-radius:10px; padding:16px; text-align:center; }
    .stat-value { font-size:1.4rem; font-weight:700; color:#fff; }
    .stat-label { font-size:0.8rem; color:var(--muted); margin-top:4px; }
    """)


@router.get("/admin/logs", response_class=HTMLResponse)
async def admin_logs(request: Request):
    admin = await _current_admin(request)
    if not admin:
        return _require_auth_redirect()

    lines = _read_logs()

    return _page("Backend Logs", f"""
    <div class="topbar">
      <a href="/api/admin/portal" style="color:var(--accent);text-decoration:none;">&larr; Dashboard</a>
      <a href="/api/admin/logs" class="btn btn-sm">Refresh</a>
    </div>
    <pre style="background:var(--card);border:1px solid var(--border);border-radius:8px;padding:16px;overflow-x:auto;font-size:0.82em;line-height:1.5;max-height:70vh;overflow-y:auto;">{lines}</pre>
    """, extra_css="""
    .topbar { display:flex; justify-content:space-between; align-items:center; padding:12px 0; margin-bottom:16px; border-bottom:1px solid var(--border); }
    """)


# ── Data helpers ─────────────────────────────────────────────────────────────

async def _fetch_usage_stats() -> dict[str, Any]:
    """Aggregate Gemini usage data from the database."""
    # Grand totals
    totals_pipeline = [{"$group": {
        "_id": None,
        "total_calls": {"$sum": 1},
        "successes": {"$sum": {"$cond": ["$success", 1, 0]}},
        "failures": {"$sum": {"$cond": ["$success", 0, 1]}},
        "total_input": {"$sum": {"$ifNull": ["$tokens.input", 0]}},
        "total_output": {"$sum": {"$ifNull": ["$tokens.output", 0]}},
        "total_thinking": {"$sum": {"$ifNull": ["$tokens.thinking", 0]}},
        "total_cached": {"$sum": {"$ifNull": ["$tokens.cached_input", 0]}},
        "total_cost": {"$sum": {"$ifNull": ["$estimated_cost_usd", 0]}},
    }}]
    totals_raw = await db.gemini_usage.aggregate(totals_pipeline).to_list(1)
    totals = totals_raw[0] if totals_raw else {
        "total_calls": 0, "successes": 0, "failures": 0,
        "total_input": 0, "total_output": 0, "total_thinking": 0,
        "total_cached": 0, "total_cost": 0,
    }

    # By purpose
    purpose_pipeline = [
        {"$group": {
            "_id": "$purpose",
            "count": {"$sum": 1},
            "successes": {"$sum": {"$cond": ["$success", 1, 0]}},
            "failures": {"$sum": {"$cond": ["$success", 0, 1]}},
            "total_input": {"$sum": {"$ifNull": ["$tokens.input", 0]}},
            "total_output": {"$sum": {"$ifNull": ["$tokens.output", 0]}},
            "total_thinking": {"$sum": {"$ifNull": ["$tokens.thinking", 0]}},
            "total_cost": {"$sum": {"$ifNull": ["$estimated_cost_usd", 0]}},
        }},
        {"$sort": {"total_input": -1}},
    ]
    by_purpose = [
        {**r, "purpose": r["_id"] or "unknown"}
        for r in await db.gemini_usage.aggregate(purpose_pipeline).to_list(20)
    ]

    # Investigation stats
    inv_pipeline = [
        {"$match": {"success": True, "purpose": "investigation"}},
        {"$group": {
            "_id": None,
            "count": {"$sum": 1},
            "avg_input": {"$avg": "$tokens.input"},
            "max_input": {"$max": "$tokens.input"},
            "min_input": {"$min": "$tokens.input"},
            "avg_output": {"$avg": "$tokens.output"},
            "avg_duration": {"$avg": "$duration_ms"},
        }},
    ]
    inv_raw = await db.gemini_usage.aggregate(inv_pipeline).to_list(1)
    inv_stats = inv_raw[0] if inv_raw else {"count": 0, "avg_input": 0, "max_input": 0, "avg_duration": 0}

    # Recent investigations by correlation
    corr_pipeline = [
        {"$group": {
            "_id": "$correlation_id",
            "count": {"$sum": 1},
            "successes": {"$sum": {"$cond": ["$success", 1, 0]}},
            "total_input": {"$sum": {"$ifNull": ["$tokens.input", 0]}},
            "total_output": {"$sum": {"$ifNull": ["$tokens.output", 0]}},
            "total_cost": {"$sum": {"$ifNull": ["$estimated_cost_usd", 0]}},
            "last": {"$max": "$timestamp"},
        }},
        {"$sort": {"last": -1}},
        {"$limit": 20},
    ]
    recent_inv = [
        {**r, "correlation_id": r["_id"] or "unknown"}
        for r in await db.gemini_usage.aggregate(corr_pipeline).to_list(20)
    ]

    return {
        "totals": totals,
        "by_purpose": by_purpose,
        "investigation_stats": inv_stats,
        "recent_investigations": recent_inv,
    }


def _read_logs(lines: int = 200) -> str:
    """Read the last N lines from the backend log."""
    import html
    log_paths = [
        "/var/log/backend.log",
        "/var/log/supervisor/backend-stdout.log",
        "/tmp/backend.log",
    ]
    for path in log_paths:
        try:
            with open(path, "r") as f:
                all_lines = f.readlines()
                return html.escape("".join(all_lines[-lines:]))
        except (FileNotFoundError, PermissionError):
            continue
    return "(No log file found)"


# ── HTML template ────────────────────────────────────────────────────────────

def _page(title: str, body: str, extra_css: str = "") -> str:
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<style>
  :root {{ --bg: #0d1117; --fg: #c9d1d9; --muted: #8b949e; --border: #30363d;
           --accent: #58a6ff; --card: #161b22; --green: #3fb950; --red: #f85149; }}
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
          background: var(--bg); color: var(--fg); line-height: 1.6; padding: 24px 16px; }}
  .container {{ max-width: 960px; margin: 0 auto; }}
  h1 {{ font-size: 1.75rem; margin: 0 0 8px; color: #fff; }}
  h2 {{ font-size: 1.25rem; margin: 28px 0 12px; padding-bottom: 6px;
        border-bottom: 1px solid var(--border); color: #fff; }}
  h3 {{ font-size: 1.05rem; margin: 20px 0 8px; color: var(--accent); }}
  p {{ margin: 0 0 12px; }}
  a {{ color: var(--accent); text-decoration: none; }}
  a:hover {{ text-decoration: underline; }}
  code {{ background: var(--card); padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }}
  pre {{ background: var(--card); padding: 16px; border-radius: 8px; overflow-x: auto;
         margin: 0 0 16px; border: 1px solid var(--border); }}
  pre code {{ background: none; padding: 0; }}
  table {{ width: 100%; border-collapse: collapse; margin: 0 0 16px; font-size: 0.88em; }}
  th, td {{ padding: 8px 10px; border: 1px solid var(--border); text-align: left; }}
  th {{ background: var(--card); color: #fff; font-weight: 600; font-size: 0.85em; }}
  td {{ background: var(--bg); }}
  tr:hover td {{ background: var(--card); }}
  hr {{ border: none; border-top: 1px solid var(--border); margin: 24px 0; }}
  ul, ol {{ margin: 0 0 12px; padding-left: 24px; }}
  li {{ margin: 0 0 4px; }}
  strong {{ color: #fff; }}
  .btn {{ display: inline-block; padding: 6px 14px; border-radius: 6px; background: var(--card);
           border: 1px solid var(--border); color: var(--fg); cursor: pointer; font-size: 0.9em; }}
  .btn:hover {{ border-color: var(--accent); color: #fff; }}
  .btn-sm {{ padding: 4px 10px; font-size: 0.82em; }}
  .spinner {{ width:32px;height:32px;border:3px solid var(--border);border-top-color:var(--accent);
              border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto; }}
  @keyframes spin {{ to {{ transform:rotate(360deg); }} }}
  {extra_css}
</style>
</head>
<body>
<div class="container">
{body}
</div>
</body>
</html>"""
