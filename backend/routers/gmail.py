"""Gmail read-only connection & manual inbox scan. See services/gmail.py for the OAuth/API details.

Privacy contract: /gmail/scan returns message content to the caller for THIS request only — it is
never written to Mongo. Only the encrypted OAuth refresh token is persisted, and only until the
user disconnects (DELETE /gmail/connection)."""
from __future__ import annotations

import secrets
from datetime import timedelta, timezone
from typing import Optional
from urllib.parse import urlencode

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from core.config import GOOGLE_GMAIL_REDIRECT_URI, logger
from core.db import db, now_utc
from services import gmail as gmail_service

router = APIRouter()

# Where the OAuth callback is allowed to bounce the browser back to — the app supplies this itself
# (Linking.createURL) so it always matches the current dev/Expo-Go/production redirect target; we
# just refuse anything that isn't one of Apollo's own schemes to prevent this becoming an open redirect.
_ALLOWED_REDIRECT_SCHEMES = ("apollo", "exp", "exps", "https", "http")


def _valid_app_redirect(url: str) -> bool:
    return any(url.startswith(f"{scheme}://") or url.startswith(f"{scheme}:/") for scheme in _ALLOWED_REDIRECT_SCHEMES)


def _bounce(base: str, **params) -> str:
    sep = "&" if "?" in base else "?"
    return f"{base}{sep}{urlencode(params)}"


class GmailConnectOut(BaseModel):
    authorization_url: str


@router.get("/gmail/connect", response_model=GmailConnectOut)
async def gmail_connect(device_id: str = Query(min_length=8, max_length=64), app_redirect: str = Query(min_length=4, max_length=500)):
    if not gmail_service.configured():
        raise HTTPException(503, "Gmail isn't configured on this build")
    if not _valid_app_redirect(app_redirect):
        raise HTTPException(400, "Invalid redirect target")
    state = secrets.token_urlsafe(24)
    await db.gmail_oauth_states.insert_one({"state": state, "device_id": device_id, "app_redirect": app_redirect,
                                            "retention_class": "oauth_csrf_temporary", "created_at": now_utc(),
                                            "expires_at": now_utc() + timedelta(minutes=10)})
    logger.info("gmail oauth start redirect_uri=%s", GOOGLE_GMAIL_REDIRECT_URI)
    return GmailConnectOut(authorization_url=gmail_service.build_authorization_url(state))


@router.get("/gmail/oauth/callback")
async def gmail_callback(code: Optional[str] = None, state: Optional[str] = None, error: Optional[str] = None):
    row = await db.gmail_oauth_states.find_one({"state": state}) if state else None
    if state:
        await db.gmail_oauth_states.delete_one({"state": state})  # single-use, always consumed
    if not row:
        # No trusted app_redirect to bounce to at all — the only safe response is a plain page.
        raise HTTPException(400, "This Gmail connection link is invalid or expired. Please try connecting again in the app.")
    app_redirect = row["app_redirect"]
    if row["expires_at"].replace(tzinfo=timezone.utc) < now_utc():
        return RedirectResponse(_bounce(app_redirect, gmail="error", reason="expired"), status_code=303)
    if error:
        return RedirectResponse(_bounce(app_redirect, gmail="denied"), status_code=303)
    if not code:
        return RedirectResponse(_bounce(app_redirect, gmail="error"), status_code=303)
    try:
        token_data = await gmail_service.exchange_code(code)
        refresh = token_data.get("refresh_token")
        if not refresh:
            # Google omits it on a repeat consent; only fail if we don't already have one on file.
            existing = await gmail_service.get_connection(row["device_id"])
            if not existing:
                return RedirectResponse(_bounce(app_redirect, gmail="error", reason="no_refresh_token"), status_code=303)
        else:
            await gmail_service.save_connection(row["device_id"], refresh)
    except HTTPException as exc:
        logger.info("gmail callback failed: %s", exc.detail)
        return RedirectResponse(_bounce(app_redirect, gmail="error"), status_code=303)
    return RedirectResponse(_bounce(app_redirect, gmail="connected"), status_code=303)


@router.get("/gmail/status")
async def gmail_status(device_id: str = Query(min_length=8, max_length=64)):
    row = await gmail_service.get_connection(device_id)
    return {"connected": row is not None, "configured": gmail_service.configured(),
            "oauth_redirect_uri": GOOGLE_GMAIL_REDIRECT_URI if gmail_service.configured() else None,
            "monitoring_enabled": bool(row and row.get("monitoring_enabled")),
            "monitor_last_checked_at": row.get("monitor_last_checked_at") if row else None,
            "monitor_last_error_at": row.get("monitor_last_error_at") if row else None}


class GmailMonitoringIn(BaseModel):
    device_id: str = Field(min_length=8, max_length=64)
    enabled: bool


@router.post("/gmail/monitoring")
async def gmail_monitoring(body: GmailMonitoringIn):
    result = await db.gmail_connections.update_one({"device_id": body.device_id},
        {"$set": {"monitoring_enabled": body.enabled, "updated_at": now_utc()}})
    if not result.matched_count:
        raise HTTPException(404, "Connect Gmail before enabling monitoring")
    return {"monitoring_enabled": body.enabled}


@router.delete("/gmail/connection", status_code=204)
async def gmail_disconnect(device_id: str = Query(min_length=8, max_length=64)):
    await gmail_service.disconnect(device_id)


class LinkAnchorOut(BaseModel):
    text: str
    href: str


class ScanMessage(BaseModel):
    id: str
    from_: str = Field(alias="from")
    subject: str
    date: str
    body: str
    links: list[LinkAnchorOut] = Field(default_factory=list)

    class Config:
        populate_by_name = True


class GmailScanIn(BaseModel):
    device_id: str = Field(min_length=8, max_length=64)


@router.post("/gmail/scan", response_model=list[ScanMessage])
async def gmail_scan(body: GmailScanIn):
    messages = await gmail_service.scan_inbox(body.device_id)
    return [ScanMessage(**m) for m in messages]
