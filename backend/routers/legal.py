"""Public legal pages: the privacy policy the app, the App Store listing and Google Play link to. Nothing personal."""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import HTMLResponse

PRIVACY_POLICY_PATH = Path(__file__).resolve().parent.parent / "content" / "privacy_policy.html"

router = APIRouter()


@router.get("/privacy-policy", response_class=HTMLResponse, include_in_schema=False)
async def privacy_policy():
    return HTMLResponse(PRIVACY_POLICY_PATH.read_text(encoding="utf-8"), headers={"Cache-Control": "public, max-age=3600"})
