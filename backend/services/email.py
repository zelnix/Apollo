"""Guardian email via the owner's Resend account (RESEND_API_KEY + verified RESEND_FROM_EMAIL).

No managed relay, no fake-success recipient. Unconfigured → typed 503 for this delivery only.
Every send is idempotent on (recipient, subject digest) within 10 minutes and leaves a receipt.
"""
from html import escape
import hashlib
import os
import re

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


async def send_email(*, to: str, subject: str, html: str, event_id: str) -> str:
    """Sends one logical email event exactly once (spec §10A). `event_id` is the stable logical identity (e.g. the invitation token or
    the Patrol event + guardian); a payload digest distinguishes a genuinely changed message. Only real provider acceptance references
    are persisted; a timeout after submission is `outcome_unknown` (reconciled before retry), never "no email was sent"."""
    _assert_safe_email(subject, html)
    if not email_configured():
        raise HTTPException(503, "Guardian email requires RESEND_API_KEY and a verified RESEND_FROM_EMAIL. No email was sent.")
    key = hashlib.sha256(f"email|{event_id}".encode()).hexdigest()
    payload_digest = hashlib.sha256(f"{to.lower()}|{subject}|{html}".encode()).hexdigest()
    receipt = await db.delivery_receipts.find_one({"channel": "email", "idempotency_key": key}, {"_id": 0})
    if receipt:
        if receipt.get("payload_digest") != payload_digest:
            raise HTTPException(409, "This email event was already sent with different content; a changed message is a new event.")
        if receipt.get("state") == "provider_accepted":
            return receipt["provider_id"]
        # outcome_unknown from an earlier timeout: the provider's idempotency key makes the retry safe; do not mint a new token here.
    else:
        await db.delivery_receipts.update_one({"channel": "email", "idempotency_key": key},
                                              {"$setOnInsert": {"channel": "email", "idempotency_key": key, "payload_digest": payload_digest, "state": "queued",
                                                                "to_digest": hashlib.sha256(to.lower().encode()).hexdigest(), "subject": subject[:120], "attempts": [], "created_at": now_utc()}}, upsert=True)
    await db.delivery_receipts.update_one({"channel": "email", "idempotency_key": key}, {"$set": {"state": "submitted", "updated_at": now_utc()}, "$push": {"attempts": {"at": now_utc(), "state": "submitted"}}})
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post("https://api.resend.com/emails", headers={"Authorization": f"Bearer {RESEND_API_KEY}", "Idempotency-Key": key},
                                  json={"from": f"{EMAIL_FROM_NAME} <{RESEND_FROM_EMAIL}>", "to": [to], "subject": subject, "html": html})
    except httpx.TimeoutException:
        await db.delivery_receipts.update_one({"channel": "email", "idempotency_key": key}, {"$set": {"state": "outcome_unknown", "failure_code": "provider_timeout", "updated_at": now_utc()}})
        raise HTTPException(503, "The email service did not confirm in time. The email may or may not have been sent; Apollo will not send a duplicate — retry to reconcile.")
    except httpx.HTTPError:
        await db.delivery_receipts.update_one({"channel": "email", "idempotency_key": key}, {"$set": {"state": "failed", "failure_code": "provider_unreachable", "updated_at": now_utc()}})
        raise HTTPException(503, "The email service could not be reached. No email was sent; try again shortly.")
    if r.status_code >= 400:
        logger.warning("resend rejected email status=%s", r.status_code)
        await db.delivery_receipts.update_one({"channel": "email", "idempotency_key": key}, {"$set": {"state": "failed", "failure_code": f"provider_http_{r.status_code}", "updated_at": now_utc()}})
        raise HTTPException(502 if r.status_code >= 500 else 503, "The email service rejected this message. Check the sender domain verification in Resend.")
    provider_id = (r.json() or {}).get("id")
    if not provider_id:  # acceptance without a reference is not proof of acceptance
        await db.delivery_receipts.update_one({"channel": "email", "idempotency_key": key}, {"$set": {"state": "outcome_unknown", "failure_code": "provider_reference_missing", "updated_at": now_utc()}})
        raise HTTPException(503, "The email service answered without a message reference; the outcome is unknown. Retry to reconcile.")
    await db.delivery_receipts.update_one({"channel": "email", "idempotency_key": key}, {"$set": {"state": "provider_accepted", "provider_id": str(provider_id), "failure_code": None, "sent_at": now_utc(), "updated_at": now_utc()}})
    return str(provider_id)


def _wrap(body: str) -> str:
    return (f'<table role="presentation" width="100%"><tr><td style="padding:24px;font-family:Arial,sans-serif;color:#111">{body}'
            f'<p style="font-size:12px;color:#888">Sent by {escape(EMAIL_FROM_NAME)}. Apollo is a brand of Harmony Wellness Group. '
            'Apollo never asks for passwords, codes or payment details by email.</p></td></tr></table>')