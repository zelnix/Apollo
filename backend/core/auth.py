"""Device bearer authentication (Hardening Gate step 2) and the external admin key — two separate trust boundaries."""
from __future__ import annotations

import base64
import hmac
import secrets
from datetime import timedelta
from hashlib import sha256
from typing import Any, Optional

from fastapi import Depends, HTTPException, Request, Security
from fastapi.security import APIKeyHeader, HTTPAuthorizationCredentials, HTTPBearer

from core.config import ADMIN_HEADER, ADMIN_KEY, TOKEN_TTL_DAYS
from core.db import db, now_utc

# --------------------------------------------------------------------------- Device authentication (Hardening Gate step 2)
# Anonymous devices, no accounts. The SERVER issues both the device_id and a 256-bit bearer token; only the token's
# SHA-256 is stored. Every request outside PUBLIC_PATHS must carry `Authorization: Bearer <token>`, and any
# device_id the caller supplies (path, query or JSON body) must equal the authenticated device — the backend never
# trusts a caller-supplied device_id. Legacy devices (no token_hash) can never authenticate: no first-come binding.

bearer_scheme = HTTPBearer(auto_error=False)
PUBLIC_PATHS = {"/api/health", "/api/intel/status", "/api/devices/register"}
# Unauthenticated exceptions, each justified:
#  /api/family/confirm/<token> — single-purpose, single-use, 72 h-expiring random token sent by email (no device context).
#  /api/voice/<sha256-prefix>.mp3 — TTS audio of a sentence the app already displays; keyed by an unguessable digest of
#     the text, never by device/user; contains no identifiers (links are stripped before synthesis). If narration ever
#     includes personal data, switch to short-lived signed URLs.
# NOTE on naming: `user_id` in /register-push is the DEVICE identity today. Device auth proves which device is calling;
# a person/household layer (one person, several devices) can sit above it later without changing this contract.
PUBLIC_PREFIXES = ("/api/family/confirm/", "/api/voice/", "/api/family/voice-play/")  # voice-play is HMAC-ticketed (routers/family.py)


def hash_token(raw: str) -> str:
    return sha256(raw.encode("ascii")).hexdigest()


def new_token() -> str:
    return base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode("ascii")


def _issue(device_id: str) -> tuple[str, dict[str, Any]]:
    raw = new_token()
    ts = now_utc()
    return raw, {"token_hash": hash_token(raw), "token_issued_at": ts, "token_expires_at": ts + timedelta(days=TOKEN_TTL_DAYS), "revoked_at": None}


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(status_code=401, detail=detail, headers={"WWW-Authenticate": "Bearer"})


async def authed_device(credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme)) -> dict[str, Any]:
    """Resolve the bearer token to a device document. Fails closed with 401 on anything unexpected."""
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise _unauthorized("This request needs Apollo's device credential.")
    raw = credentials.credentials
    if not (40 <= len(raw) <= 128):
        raise _unauthorized("Invalid device credential.")
    dev = await db.devices.find_one({"token_hash": hash_token(raw), "revoked_at": None, "token_expires_at": {"$gt": now_utc()}})
    if not dev:
        raise _unauthorized("Device credential is invalid, expired or revoked. Apollo will re-register this device.")
    return dev


async def enforce_device_auth(request: Request, credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme)) -> None:
    """Router-wide gate: public paths pass; everything else needs a valid token AND every supplied device_id must
    match the authenticated device (path param, query string, or top-level JSON body field)."""
    path = request.url.path
    if path in PUBLIC_PATHS or path.startswith(PUBLIC_PREFIXES):
        return
    dev = await authed_device(credentials)
    me = dev["device_id"]
    claimed: set[str] = set()
    for key in ("device_id", "user_id"):
        if key in request.path_params:
            claimed.add(str(request.path_params[key]))
        if key in request.query_params:
            claimed.add(request.query_params[key])
    if request.method in ("POST", "PUT", "PATCH") and "application/json" in (request.headers.get("content-type") or ""):
        try:
            body = await request.json()
        except Exception:  # noqa: BLE001 — malformed JSON is rejected by the route's own validation
            body = None
        if isinstance(body, dict):
            for key in ("device_id", "user_id"):
                if isinstance(body.get(key), str):
                    claimed.add(body[key])
    if any(c != me for c in claimed):
        raise HTTPException(status_code=403, detail="That device_id does not belong to this device.")
    request.state.device = dev


# --------------------------------------------------------------------------- Admin console (external, shared secret)
# A separate trust boundary from device auth: the external admin console presents `X-Admin-Key` (APOLLO_ADMIN_KEY in
# backend/.env). Constant-time compare, generic 401, never logged. The device bearer dependency is NOT applied to this
# router and the admin key is NEVER accepted by device routes. Fails closed (503) when no key is configured.

admin_key_header = APIKeyHeader(name=ADMIN_HEADER, scheme_name="AdminKey", description="External admin console key", auto_error=False)


async def require_admin_key(presented: Optional[str] = Security(admin_key_header)) -> None:
    if not ADMIN_KEY:
        raise HTTPException(status_code=503, detail="Admin access is not configured on this server.")
    if presented is None or not hmac.compare_digest(presented.strip().encode("utf-8"), ADMIN_KEY.encode("utf-8")):
        raise HTTPException(status_code=401, detail="Invalid admin credentials.", headers={"WWW-Authenticate": "ApiKey"})
