"""Gmail read-only connection: server-side OAuth (Web-application client), encrypted refresh-token
storage in Mongo, and a manual inbox scan. Scope is `gmail.readonly` only — Apollo never sends,
deletes, labels or modifies anything in the connected account.

Privacy contract: message content fetched by scan_inbox() is returned to the caller for THIS
request only and is NEVER written to Mongo. Only the encrypted OAuth refresh token is persisted —
and only for as long as the user keeps the connection (see disconnect()).
"""
from __future__ import annotations

import base64
import re
from datetime import timedelta
from typing import Any, Optional
from urllib.parse import urlencode

import httpx
from cryptography.fernet import Fernet
from fastapi import HTTPException

from core.config import GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_GMAIL_REDIRECT_URI, GMAIL_TOKEN_ENCRYPTION_KEY, logger
from core.db import db, now_utc

AUTH_URI = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URI = "https://oauth2.googleapis.com/token"
GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me"
SCOPE = "https://www.googleapis.com/auth/gmail.readonly"
OAUTH_STATE_TTL = timedelta(minutes=10)

_fernet: Optional[Fernet] = Fernet(GMAIL_TOKEN_ENCRYPTION_KEY.encode()) if GMAIL_TOKEN_ENCRYPTION_KEY else None


def configured() -> bool:
    return bool(GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET and GOOGLE_GMAIL_REDIRECT_URI and _fernet)


def build_authorization_url(state: str) -> str:
    params = {
        "client_id": GOOGLE_CLIENT_ID, "redirect_uri": GOOGLE_GMAIL_REDIRECT_URI, "response_type": "code",
        "scope": SCOPE, "access_type": "offline", "prompt": "consent", "include_granted_scopes": "true", "state": state,
    }
    return f"{AUTH_URI}?{urlencode(params)}"


async def exchange_code(code: str) -> dict:
    async with httpx.AsyncClient(timeout=10) as http:
        resp = await http.post(TOKEN_URI, data={
            "code": code, "client_id": GOOGLE_CLIENT_ID, "client_secret": GOOGLE_CLIENT_SECRET,
            "redirect_uri": GOOGLE_GMAIL_REDIRECT_URI, "grant_type": "authorization_code",
        })
    if resp.status_code != 200:
        logger.info("gmail code exchange failed: %s", resp.status_code)
        raise HTTPException(400, "Google authorization failed")
    return resp.json()


async def _refresh_access_token(refresh_token: str) -> str:
    async with httpx.AsyncClient(timeout=10) as http:
        resp = await http.post(TOKEN_URI, data={
            "refresh_token": refresh_token, "client_id": GOOGLE_CLIENT_ID, "client_secret": GOOGLE_CLIENT_SECRET,
            "grant_type": "refresh_token",
        })
    if resp.status_code != 200:
        raise HTTPException(401, "Gmail grant expired or was revoked; reconnect")
    return resp.json()["access_token"]


async def save_connection(device_id: str, refresh_token: str) -> None:
    if not _fernet:
        raise HTTPException(503, "Gmail isn't configured on this build")
    enc = _fernet.encrypt(refresh_token.encode()).decode()
    await db.gmail_connections.update_one(
        {"device_id": device_id},
        {"$set": {"refresh_token_enc": enc, "scopes": [SCOPE], "updated_at": now_utc()},
         "$setOnInsert": {"device_id": device_id, "created_at": now_utc(), "monitoring_enabled": False}},
        upsert=True,
    )


async def get_connection(device_id: str) -> Optional[dict]:
    return await db.gmail_connections.find_one({"device_id": device_id})


async def disconnect(device_id: str) -> None:
    row = await get_connection(device_id)
    if row and _fernet:
        try:
            refresh = _fernet.decrypt(row["refresh_token_enc"].encode()).decode()
            async with httpx.AsyncClient(timeout=10) as http:
                await http.post("https://oauth2.googleapis.com/revoke", data={"token": refresh})
        except Exception as exc:
            logger.info("gmail provider revocation did not complete: %s", type(exc).__name__)
    await db.gmail_connections.delete_one({"device_id": device_id})


async def _access_token_for(device_id: str) -> str:
    row = await get_connection(device_id)
    if not row or not _fernet:
        raise HTTPException(404, "Gmail is not connected")
    refresh = _fernet.decrypt(row["refresh_token_enc"].encode()).decode()
    try:
        return await _refresh_access_token(refresh)
    except HTTPException:
        await disconnect(device_id)
        raise


def _b64url_decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _walk_parts(part: dict):
    if isinstance(part.get("parts"), list):
        for child in part["parts"]:
            yield from _walk_parts(child)
    elif part.get("body", {}).get("data"):
        mime = part.get("mimeType", "")
        if mime in ("text/plain", "text/html"):
            yield mime, _b64url_decode(part["body"]["data"])


def _extract_anchors(chunks: list[tuple[str, bytes]]) -> list[dict[str, str]]:
    """Pulls (visible text, href) pairs from the text/html MIME part — this is what Email Guard's
    displayed-link-text vs real-destination mismatch check needs; plain text alone can't carry it."""
    from bs4 import BeautifulSoup

    anchors: list[dict[str, str]] = []
    for mime, raw in chunks:
        if mime != "text/html":
            continue
        try:
            soup = BeautifulSoup(raw.decode("utf-8", errors="replace"), "html.parser")
        except Exception:  # noqa: BLE001
            continue
        for a in soup.find_all("a", href=True):
            href = str(a["href"]).strip()
            text = a.get_text(" ", strip=True)
            if not text or not href.lower().startswith(("http://", "https://")):
                continue
            anchors.append({"text": text[:120], "href": href[:500]})
            if len(anchors) >= 20:
                return anchors
    return anchors


def _extract_content(message: dict) -> tuple[str, list[dict[str, str]]]:
    """Returns (plain_text, anchors). Text prefers text/plain (crude tag-strip fallback for
    text/html); anchors come from the text/html part specifically, when present. Capped — this is a
    signal source for the on-device rule engine, not a faithful rendering of the email."""
    payload = message.get("payload", {})
    chunks = list(_walk_parts(payload))
    if not chunks and payload.get("body", {}).get("data"):
        chunks = [(payload.get("mimeType", ""), _b64url_decode(payload["body"]["data"]))]
    plain = next((b for m, b in chunks if m == "text/plain"), None)
    raw = plain or (chunks[0][1] if chunks else b"")
    text = raw.decode("utf-8", errors="replace")
    if "<" in text and ">" in text:
        text = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", text, flags=re.IGNORECASE | re.DOTALL)
        text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()[:4000]
    return text, _extract_anchors(chunks)


def _headers_of(message: dict) -> dict[str, str]:
    return {h["name"].lower(): h.get("value", "") for h in message.get("payload", {}).get("headers", [])}


async def scan_inbox(device_id: str, limit: int = 15) -> list[dict[str, Any]]:
    """Fetch the most recent messages (last 30 days) and return minimal fields for the caller's
    on-device analysis. NOTHING here is persisted — the caller must discard after processing."""
    limit = max(1, min(limit, 25))
    token = await _access_token_for(device_id)
    auth = {"Authorization": f"Bearer {token}"}
    async with httpx.AsyncClient(timeout=20) as http:
        listed = await http.get(f"{GMAIL_API}/messages", params={"maxResults": limit, "q": "newer_than:30d"}, headers=auth)
        if listed.status_code == 401:
            await disconnect(device_id)
            raise HTTPException(401, "Gmail access was rejected; reconnect")
        listed.raise_for_status()
        ids = listed.json().get("messages", [])
        out: list[dict[str, Any]] = []
        for item in ids:
            got = await http.get(f"{GMAIL_API}/messages/{item['id']}", params={"format": "full"}, headers=auth)
            if got.status_code != 200:
                continue
            msg = got.json()
            h = _headers_of(msg)
            text, anchors = _extract_content(msg)
            out.append({"id": msg.get("id", ""), "from": h.get("from", "")[:200], "subject": h.get("subject", "")[:300], "date": h.get("date", ""), "body": text, "links": anchors})
    return out
