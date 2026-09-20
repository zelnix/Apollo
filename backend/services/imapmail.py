"""Generic IMAP read-only connection: the user supplies their own host/port/username/app-password
(no OAuth app to register — works with Gmail app passwords, Outlook.com, Yahoo, iCloud, or any
custom provider). Mirrors services/gmail.py's contract exactly: encrypted credential storage,
manual "scan my inbox" only, message content checked and discarded — never persisted.

Security posture: read-only IMAP (`SELECT INBOX` with readonly=True, `BODY.PEEK[]` — never `STORE`,
`COPY`, `MOVE` or `EXPUNGE`), TLS certificate verification via ssl.create_default_context(), capped
message count/bytes/text length/timeout. imaplib is synchronous — every call here runs inside
asyncio.to_thread() so it never blocks the event loop.
"""
from __future__ import annotations

import asyncio
import email
import imaplib
import re
import ssl
from email import policy
from email.parser import BytesParser
from html import unescape
from typing import Any, Optional

from cryptography.fernet import Fernet
from fastapi import HTTPException

from core.config import IMAP_CREDENTIAL_KEY, logger
from core.db import db, now_utc

MAX_MESSAGES = 15
MAX_RAW_BYTES = 2_000_000
MAX_TEXT = 4000
IMAP_TIMEOUT = 20

_fernet: Optional[Fernet] = Fernet(IMAP_CREDENTIAL_KEY.encode()) if IMAP_CREDENTIAL_KEY else None


def configured() -> bool:
    return bool(_fernet)


def _encrypt(value: str) -> str:
    if not _fernet:
        raise HTTPException(503, "IMAP isn't configured on this build")
    return _fernet.encrypt(value.encode("utf-8")).decode("ascii")


def _decrypt(value: str) -> str:
    if not _fernet:
        raise HTTPException(503, "IMAP isn't configured on this build")
    return _fernet.decrypt(value.encode("ascii")).decode("utf-8")


def _strip_html(html: str) -> tuple[str, list[dict[str, str]]]:
    """Returns (plain_text, anchors) — anchors feed Email Guard's link-text-vs-destination check,
    same as the Gmail path."""
    from bs4 import BeautifulSoup

    anchors: list[dict[str, str]] = []
    try:
        soup = BeautifulSoup(html, "html.parser")
        for a in soup.find_all("a", href=True):
            href = str(a["href"]).strip()
            text = a.get_text(" ", strip=True)
            if text and href.lower().startswith(("http://", "https://")) and len(anchors) < 20:
                anchors.append({"text": text[:120], "href": href[:500]})
        for tag in soup(["script", "style", "noscript"]):
            tag.decompose()
        plain = re.sub(r"\s+", " ", soup.get_text(" ")).strip()
    except Exception:  # noqa: BLE001
        plain = re.sub(r"<[^>]+>", " ", unescape(html))
        plain = re.sub(r"\s+", " ", plain).strip()
    return plain, anchors


def _text_part(part: "email.message.Message") -> tuple[str, list[dict[str, str]]]:
    if part.get_content_maintype() == "multipart" or part.get_content_disposition() == "attachment":
        return "", []
    ctype = part.get_content_type()
    if ctype not in ("text/plain", "text/html"):
        return "", []
    try:
        content = part.get_content()
    except Exception:  # noqa: BLE001
        return "", []
    if ctype == "text/html":
        return _strip_html(str(content))
    return str(content), []


def _parse_message(raw: bytes) -> dict[str, Any]:
    msg = BytesParser(policy=policy.default).parsebytes(raw)
    chunks: list[str] = []
    anchors: list[dict[str, str]] = []
    parts = msg.walk() if msg.is_multipart() else [msg]
    for part in parts:
        text, a = _text_part(part)
        if text:
            chunks.append(text)
        anchors.extend(a)
    return {
        "subject": str(msg.get("subject", ""))[:300], "from": str(msg.get("from", ""))[:200],
        "date": str(msg.get("date", ""))[:100], "body": ("\n".join(chunks))[:MAX_TEXT], "links": anchors[:20],
    }


def _scan_sync(host: str, port: int, use_ssl: bool, username: str, password: str, limit: int) -> list[dict[str, Any]]:
    # P0-01/P0-04: there is no approved remote mailbox-processing policy. No socket may
    # be opened, even by an internal caller bypassing the HTTP boundary. Re-enable only
    # after an approved host/993-only TLS policy and pinned-address transport exist.
    raise HTTPException(403, "Remote mailbox processing is disabled by privacy policy")


def _disabled_legacy_scan(host: str, port: int, use_ssl: bool, username: str, password: str, limit: int) -> list[dict[str, Any]]:
    raise HTTPException(403, "Remote mailbox processing is disabled by privacy policy")
    context = ssl.create_default_context()
    client = imaplib.IMAP4_SSL(host, port, ssl_context=context, timeout=IMAP_TIMEOUT) if use_ssl else imaplib.IMAP4(host, port, timeout=IMAP_TIMEOUT)
    try:
        if not use_ssl:
            client.starttls(ssl_context=context)
        client.login(username, password)
        typ, _ = client.select("INBOX", readonly=True)  # readonly: never mutates the mailbox
        if typ != "OK":
            raise RuntimeError("cannot select inbox read-only")
        typ, data = client.uid("SEARCH", None, "ALL")
        if typ != "OK":
            raise RuntimeError("search failed")
        uids = data[0].split()[-limit:][::-1] if data and data[0] else []
        out: list[dict[str, Any]] = []
        for uid in uids:
            typ, rows = client.uid("FETCH", uid, "(BODY.PEEK[])")  # PEEK: never marks messages as read
            if typ != "OK":
                continue
            raw = next((x[1] for x in rows if isinstance(x, tuple) and isinstance(x[1], bytes)), b"")
            if not raw:
                continue
            if len(raw) > MAX_RAW_BYTES:
                raw = raw[:MAX_RAW_BYTES]
            parsed = _parse_message(raw)
            parsed["id"] = uid.decode("ascii", "ignore")
            out.append(parsed)
        return out
    finally:
        try:
            client.close()
        except Exception:  # noqa: BLE001
            pass
        try:
            client.logout()
        except Exception:  # noqa: BLE001
            pass


async def test_connection(host: str, port: int, use_ssl: bool, username: str, password: str) -> None:
    """Raises on failure — used to validate credentials once, at connect time."""
    try:
        await asyncio.wait_for(asyncio.to_thread(_scan_sync, host, port, use_ssl, username, password, 1), timeout=IMAP_TIMEOUT + 5)
    except Exception as exc:
        logger.info("imap test connection failed: %s", type(exc).__name__)
        raise HTTPException(400, "Couldn't connect — check the host, port and app password.") from exc


async def save_connection(device_id: str, host: str, port: int, use_ssl: bool, username: str, password: str) -> None:
    await db.imap_connections.update_one(
        {"device_id": device_id},
        {"$set": {"host": host, "port": port, "ssl": use_ssl, "username": username, "password_enc": _encrypt(password), "updated_at": now_utc()},
         "$setOnInsert": {"device_id": device_id, "created_at": now_utc()}},
        upsert=True,
    )


async def get_connection(device_id: str) -> Optional[dict]:
    return await db.imap_connections.find_one({"device_id": device_id})


async def disconnect(device_id: str) -> None:
    await db.imap_connections.delete_one({"device_id": device_id})


async def scan_inbox(device_id: str) -> list[dict[str, Any]]:
    """NOTHING here is persisted — the caller must discard message content after processing."""
    row = await get_connection(device_id)
    if not row:
        raise HTTPException(404, "No IMAP inbox is connected")
    password = _decrypt(row["password_enc"])
    try:
        return await asyncio.wait_for(asyncio.to_thread(_scan_sync, row["host"], row["port"], row["ssl"], row["username"], password, MAX_MESSAGES), timeout=IMAP_TIMEOUT + 10)
    except Exception as exc:
        logger.info("imap scan failed: %s", type(exc).__name__)
        raise HTTPException(401, "Couldn't read that inbox — the connection may need to be reconnected.") from exc
    finally:
        password = ""  # noqa: F841 — drop the reference as soon as practical
