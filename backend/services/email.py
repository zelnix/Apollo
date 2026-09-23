"""Transactional Family email through the platform-managed, verified sender.

Recipients and content are server-owned. Callers provide domain IDs, never arbitrary
email payloads. Provider acceptance remains distinct from delivery.
"""
from __future__ import annotations

from html import escape
from html.parser import HTMLParser
import hashlib
import ipaddress
import os
import re
from urllib.parse import urlparse

import httpx
from dotenv import load_dotenv
from fastapi import HTTPException

from core.config import EMAIL_FROM_NAME, logger
from core.db import db, now_utc

load_dotenv()

EMAIL_BASE_URL = "https://integrations.emergentagent.com"
EMAIL_KEY = os.environ.get("EMERGENT_EMAIL_KEY", "")
EMAIL_REPLY_TO = os.environ.get("EMAIL_REPLY_TO")


def email_configured() -> bool:
    return bool(EMAIL_KEY and EMAIL_FROM_NAME.strip())


_SHORTENERS = ("bit.ly", "tinyurl.com", "t.co", "is.gd", "cutt.ly", "goo.gl", "rebrand.ly")
_CRED_ASK = (
    "reply with your password", "reply with the code", "send your password", "cvv",
    "send us your password", "enter your password below", "confirm your card number",
    "your full card number", "seed phrase", "recovery phrase", "verify your card",
    "social security number", "confirm your bank details",
)
_HOSTISH = re.compile(r"\b(?:https?://)?((?:[a-z0-9-]+\.)+[a-z]{2,})", re.I)


def _host_ok(host: str) -> bool:
    if not host or "xn--" in host:
        return False
    try:
        ipaddress.ip_address(host)
        return False
    except ValueError:
        pass
    return not any(host == value or host.endswith("." + value) for value in _SHORTENERS)


def _same_site(shown: str, real: str) -> bool:
    return shown == real or real.endswith("." + shown) or shown.endswith("." + real)


class _EmailScan(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags: set[str] = set()
        self.urls: list[str] = []
        self.anchors: list[tuple[str, str]] = []
        self._href: str | None = None
        self._text: list[str] = []

    def handle_starttag(self, tag, attrs):
        self.tags.add(tag.lower())
        self.urls += [value for key, value in attrs if key.lower() in ("href", "src") and value]
        if tag.lower() == "a":
            self._href = dict((key.lower(), value) for key, value in attrs).get("href")
            self._text = []

    def handle_data(self, data):
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag):
        if tag.lower() == "a" and self._href is not None:
            self.anchors.append((self._href, "".join(self._text)))
            self._href, self._text = None, []


def _assert_safe_email(subject: str, html: str) -> None:
    scan = _EmailScan()
    scan.feed(html)
    if scan.tags & {"form", "input", "textarea", "select"}:
        raise ValueError("No forms or input fields in transactional email")
    body = f"{subject}\n{html}".lower()
    if any(phrase in body for phrase in _CRED_ASK):
        raise ValueError("Transactional email must not request credentials")
    for value in scan.urls:
        low = value.strip().lower()
        if low.startswith(("mailto:", "tel:", "cid:", "#")):
            continue
        parsed = urlparse(low)
        if not low.startswith("https://") or not _host_ok(parsed.hostname or "") or parsed.username is not None:
            raise ValueError("Transactional email contains an unsafe link or asset")
    for href, text in scan.anchors:
        real = urlparse(href.strip().lower()).hostname or ""
        if not real:
            continue
        for match in _HOSTISH.finditer(text):
            if not _same_site(match.group(1).lower(), real):
                raise ValueError("Transactional email anchor text does not match its destination")


async def send_email(*, to: str, subject: str, html: str, event_id: str) -> str:
    """Submit one server-defined event while preserving truthful provider receipts."""
    _assert_safe_email(subject, html)
    if not email_configured():
        raise HTTPException(503, "Guardian email is not configured. No email was sent.")
    key = hashlib.sha256(f"email|{event_id}".encode()).hexdigest()
    payload_digest = hashlib.sha256(f"{to.lower()}|{subject}|{html}".encode()).hexdigest()
    receipt = await db.delivery_receipts.find_one({"channel": "email", "idempotency_key": key}, {"_id": 0})
    if receipt:
        if receipt.get("payload_digest") != payload_digest:
            raise HTTPException(409, "This email event was already sent with different content; a changed message is a new event.")
        if receipt.get("state") == "provider_accepted":
            return receipt["provider_id"]
    else:
        await db.delivery_receipts.update_one(
            {"channel": "email", "idempotency_key": key},
            {"$setOnInsert": {"channel": "email", "idempotency_key": key, "payload_digest": payload_digest,
                              "state": "queued", "to_digest": hashlib.sha256(to.lower().encode()).hexdigest(),
                              "subject": subject[:120], "attempts": [], "created_at": now_utc()}}, upsert=True,
        )
    await db.delivery_receipts.update_one(
        {"channel": "email", "idempotency_key": key},
        {"$set": {"state": "submitted", "updated_at": now_utc()}, "$push": {"attempts": {"at": now_utc(), "state": "submitted"}}},
    )
    payload = {"to": [to], "subject": subject, "html": html, "from_name": EMAIL_FROM_NAME}
    if EMAIL_REPLY_TO:
        payload["contact_email"] = EMAIL_REPLY_TO
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                f"{EMAIL_BASE_URL}/api/v1/email/send",
                headers={"X-Email-Key": EMAIL_KEY, "Idempotency-Key": key},
                json=payload,
            )
    except httpx.TimeoutException:
        await db.delivery_receipts.update_one({"channel": "email", "idempotency_key": key}, {"$set": {"state": "outcome_unknown", "failure_code": "provider_timeout", "updated_at": now_utc()}})
        raise HTTPException(503, "The email service did not confirm in time. The outcome is unknown; retry to reconcile.")
    except httpx.HTTPError:
        await db.delivery_receipts.update_one({"channel": "email", "idempotency_key": key}, {"$set": {"state": "failed", "failure_code": "provider_unreachable", "updated_at": now_utc()}})
        raise HTTPException(503, "The email service could not be reached. No email was sent; try again shortly.")
    if response.status_code >= 400:
        logger.warning("managed email rejected status=%s", response.status_code)
        await db.delivery_receipts.update_one({"channel": "email", "idempotency_key": key}, {"$set": {"state": "failed", "failure_code": f"provider_http_{response.status_code}", "updated_at": now_utc()}})
        raise HTTPException(502 if response.status_code >= 500 else 503, "The email service rejected this transactional message.")
    provider_id = (response.json() or {}).get("id")
    if not provider_id:
        await db.delivery_receipts.update_one({"channel": "email", "idempotency_key": key}, {"$set": {"state": "outcome_unknown", "failure_code": "provider_reference_missing", "updated_at": now_utc()}})
        raise HTTPException(503, "The email service answered without a reference; the outcome is unknown.")
    await db.delivery_receipts.update_one(
        {"channel": "email", "idempotency_key": key},
        {"$set": {"state": "provider_accepted", "provider_id": str(provider_id), "failure_code": None,
                  "sent_at": now_utc(), "updated_at": now_utc()}},
    )
    return str(provider_id)


def _wrap(body: str) -> str:
    return (f'<table role="presentation" width="100%"><tr><td style="padding:24px;font-family:Arial,sans-serif;color:#111">{body}'
            f'<p style="font-size:12px;color:#888">Sent by {escape(EMAIL_FROM_NAME)}. Apollo is a brand of Harmony Wellness Group. '
            'Higgins Apollo never asks for passwords, codes or payment details by email.</p></td></tr></table>')