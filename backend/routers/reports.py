"""Public report endpoint — serves the Gemini usage investigation report as HTML.

No authentication required so stakeholders can view via a direct link.
"""

import os
from pathlib import Path

import markdown
from fastapi import APIRouter
from fastapi.responses import HTMLResponse

router = APIRouter(tags=["reports"])

_REPORT_DIR = Path(__file__).resolve().parent.parent  # /app/backend

_HTML_TEMPLATE = """<!DOCTYPE html>
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
  .container {{ max-width: 920px; margin: 0 auto; }}
  h1 {{ font-size: 1.75rem; margin: 0 0 8px; color: #fff; }}
  h2 {{ font-size: 1.35rem; margin: 32px 0 12px; padding-bottom: 6px;
        border-bottom: 1px solid var(--border); color: #fff; }}
  h3 {{ font-size: 1.1rem; margin: 24px 0 8px; color: var(--accent); }}
  p {{ margin: 0 0 12px; }}
  a {{ color: var(--accent); text-decoration: none; }}
  a:hover {{ text-decoration: underline; }}
  code {{ background: var(--card); padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }}
  pre {{ background: var(--card); padding: 16px; border-radius: 8px; overflow-x: auto;
         margin: 0 0 16px; border: 1px solid var(--border); }}
  pre code {{ background: none; padding: 0; }}
  table {{ width: 100%; border-collapse: collapse; margin: 0 0 16px; font-size: 0.92em; }}
  th, td {{ padding: 8px 12px; border: 1px solid var(--border); text-align: left; }}
  th {{ background: var(--card); color: #fff; font-weight: 600; }}
  td {{ background: var(--bg); }}
  tr:hover td {{ background: var(--card); }}
  hr {{ border: none; border-top: 1px solid var(--border); margin: 24px 0; }}
  ul, ol {{ margin: 0 0 12px; padding-left: 24px; }}
  li {{ margin: 0 0 4px; }}
  strong {{ color: #fff; }}
  blockquote {{ border-left: 3px solid var(--accent); padding: 8px 16px; margin: 0 0 12px;
                background: var(--card); border-radius: 0 6px 6px 0; }}
  .meta {{ color: var(--muted); font-size: 0.85em; margin-bottom: 24px; }}
  .badge {{ display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 0.8em; font-weight: 600; }}
  .badge-done {{ background: rgba(63,185,80,0.15); color: var(--green); }}
  .badge-pending {{ background: rgba(248,81,73,0.15); color: var(--red); }}
</style>
</head>
<body>
<div class="container">
{content}
<hr>
<p class="meta">Apollo Gemini Usage Investigation &middot; Generated from backend analysis</p>
</div>
</body>
</html>"""


def _render(md_path: Path, title: str) -> str:
    """Read a markdown file and render it as styled HTML."""
    text = md_path.read_text(encoding="utf-8")
    # Replace ✅ / ⏳ with styled badges for visual clarity
    text = text.replace("✅", '<span class="badge badge-done">DONE</span>')
    text = text.replace("⏳", '<span class="badge badge-pending">PENDING</span>')
    html_body = markdown.markdown(text, extensions=["tables", "fenced_code", "toc"])
    return _HTML_TEMPLATE.format(title=title, content=html_body)


@router.get("/reports/gemini-usage-investigation", response_class=HTMLResponse)
async def gemini_usage_investigation_report():
    """Public HTML view of the Gemini usage root-cause analysis."""
    md_file = _REPORT_DIR / "GEMINI_USAGE_INVESTIGATION.md"
    if not md_file.exists():
        return HTMLResponse("<h1>Report not found</h1>", status_code=404)
    return HTMLResponse(_render(md_file, "Gemini API Usage Investigation — Root Cause Analysis"))


@router.get("/reports/gemini-usage-tracking", response_class=HTMLResponse)
async def gemini_usage_tracking_report():
    """Public HTML view of the live Gemini usage tracking report."""
    md_file = _REPORT_DIR / "GEMINI_USAGE_TRACKING_REPORT.md"
    if not md_file.exists():
        return HTMLResponse("<h1>Report not found</h1>", status_code=404)
    return HTMLResponse(_render(md_file, "Gemini Usage Tracking Report"))
