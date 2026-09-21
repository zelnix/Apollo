"""Guardian email via the owner's Resend account (RESEND_API_KEY + verified RESEND_FROM_EMAIL).

No managed relay, no fake-success recipient. Unconfigured → typed 503 for this delivery only.
Every send is idempotent on (recipient, subject digest) within 10 minutes and leaves a receipt.
"""
from html import escape
import hashlib
import os
import re
import uuid

import httpx
from fastapi import HTTPException

from core.config import EMAIL_FROM_NAME, logger
from core.db import db, now_utc

RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
RESEND_FROM_EMAIL = os.environ.get("RESEND_FROM_EMAIL", "")


def email_configured() -> bool:
    return bool(RESEND_API_KEY and RESEND_FROM_EMAIL)

_CRED_ASK = ("reply with your password", "reply with the code", "send your password", "cvv", "seed phrase", "verify your card", "confirm your bank details")


def _assert_safe_email(subject: str, html: str) -> None:
    low = f"{subject}\n{html}".lower()
    if "<form" in low or "<input" in low or any(p in low for p in _CRED_ASK):
        raise ValueError("Credential collection is not permitted")
    for match in re.finditer(r'(?:href|src)="([^"]+)"', html):
        url = match.group(1).lower()
        if url.startswith(("mailto:", "#")):
            continue
        if not url.startswith("https://") or "xn--" in url or "@" in url.split("/")[2]:
            raise ValueError("Unsafe email link")


async def send_email(*, to: str, subject: str, html: str) -> str:
    _assert_safe_email(subject, html)
    if not email_configured():
        raise HTTPException(503, "Guardian email requires RESEND_API_KEY and a verified RESEND_FROM_EMAIL. No email was sent.")
    key = hashlib.sha256(f"{to.lower()}|{subject}|{now_utc().strftime('%Y%m%d%H')}{now_utc().minute // 10}".encode()).hexdigest()
    receipt = await db.delivery_receipts.find_one({"channel": "email", "idempotency_key": key}, {"_id": 0})
    if receipt:
        return receipt["provider_id"]
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post("https://api.resend.com/emails", headers={"Authorization": f"Bearer {RESEND_API_KEY}", "Idempotency-Key": key},
                                  json={"from": f"{EMAIL_FROM_NAME} <{RESEND_FROM_EMAIL}>", "to": [to], "subject": subject, "html": html})
    except httpx.HTTPError:
        raise HTTPException(503, "The email service did not answer. No email was sent; try again shortly.")
    if r.status_code >= 400:
        logger.warning("resend rejected email status=%s", r.status_code)
        raise HTTPException(502 if r.status_code >= 500 else 503, "The email service rejected this message. Check the sender domain verification in Resend.")
    provider_id = str(r.json().get("id") or uuid.uuid4())
    await db.delivery_receipts.insert_one({"channel": "email", "idempotency_key": key, "provider_id": provider_id, "to_digest": hashlib.sha256(to.lower().encode()).hexdigest(),
                                           "subject": subject[:120], "sent_at": now_utc()})
    return provider_id


def _wrap(body: str) -> str:
    return (f'<table role="presentation" width="100%"><tr><td style="padding:24px;font-family:Arial,sans-serif;color:#111">{body}'
            f'<p style="font-size:12px;color:#888">Sent by {escape(EMAIL_FROM_NAME)}. Apollo is a brand of Harmony Wellness Group. '
            'Apollo never asks for passwords, codes or payment details by email.</p></td></tr></table>')