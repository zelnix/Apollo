"""Gmail read-only connection & manual inbox scan. See services/gmail.py for the OAuth/API details.

Privacy contract: /gmail/scan returns message content to the caller for THIS request only — it is
never written to Mongo. Only the encrypted OAuth refresh token is persisted, and only until the
user disconnects (DELETE /gmail/connection)."""
from __future__ import annotations

import secrets
import hashlib
from datetime import timedelta, timezone
from typing import Optional
from urllib.parse import urlencode
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from core.config import GOOGLE_GMAIL_REDIRECT_URI, PUBLIC_BASE, logger
from core.db import db, now_utc
from services import gmail as gmail_service
from services.mailbox_monitor import scan_gmail_through_shared_pipeline

router = APIRouter()

# Where the OAuth callback is allowed to bounce the browser back to — the app supplies this itself
# (Linking.createURL) so it always matches the current dev/Expo-Go/production redirect target; we
# just refuse anything that isn't one of Apollo's own schemes to prevent this becoming an open redirect.
def _valid_app_redirect(url: str) -> bool:
    try:
        parsed = urlparse(url)
    except ValueError:
        return False
    if parsed.username or parsed.password or parsed.fragment:
        return False
    if parsed.scheme == "apollo":
        return bool(parsed.netloc or parsed.path)
    if parsed.scheme in {"exp", "exps"}:
        return bool(parsed.hostname)  # development-only Expo return; carries no Google token
    public_host = urlparse(PUBLIC_BASE).hostname
    if parsed.scheme == "https":
        return bool(public_host and parsed.hostname == public_host)
    if parsed.scheme == "http":
        return parsed.hostname in {"127.0.0.1", "localhost"}
    return False


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
    state_digest = hashlib.sha256(state.encode()).hexdigest()
    await db.gmail_oauth_states.insert_one({"state_digest": state_digest, "device_id": device_id, "app_redirect": app_redirect,
                                            "retention_class": "oauth_csrf_temporary", "created_at": now_utc(),
                                            "expires_at": now_utc() + timedelta(minutes=10)})
    logger.info("gmail oauth start redirect_uri=%s", GOOGLE_GMAIL_REDIRECT_URI)
    return GmailConnectOut(authorization_url=gmail_service.build_authorization_url(state))


@router.get("/gmail/oauth/callback")
async def gmail_callback(code: Optional[str] = None, state: Optional[str] = None, error: Optional[str] = None):
    state_digest = hashlib.sha256(state.encode()).hexdigest() if state else None
    row = await db.gmail_oauth_states.find_one_and_delete({"state_digest": state_digest}) if state_digest else None
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
    lease_active = bool(row and row.get("monitor_lease_until") and row["monitor_lease_until"].replace(tzinfo=timezone.utc) > now_utc())
    monitor_state = "disconnected" if not row else "off" if not row.get("monitoring_enabled") else "checking" if lease_active else "needs_attention" if row.get("monitor_last_error_at") and not row.get("monitor_last_success_at") else "ready"
    return {"connected": row is not None, "configured": gmail_service.configured(),
            "oauth_redirect_uri": GOOGLE_GMAIL_REDIRECT_URI if gmail_service.configured() else None,
            "monitoring_enabled": bool(row and row.get("monitoring_enabled")),
            "monitor_last_checked_at": row.get("monitor_last_checked_at") if row else None,
            "monitor_last_error_at": row.get("monitor_last_error_at") if row else None,
            "monitor_last_success_at": row.get("monitor_last_success_at") if row else None,
            "monitor_last_attempt_at": row.get("monitor_last_attempt_at") if row else None,
            "monitor_state": monitor_state, "cursor_pending": bool(row and row.get("monitor_next_page_token"))}


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


class GmailScanIn(BaseModel):
    device_id: str = Field(min_length=8, max_length=64)


@router.post("/gmail/scan")
async def gmail_scan(body: GmailScanIn):
    return await scan_gmail_through_shared_pipeline(body.device_id, "manual")
