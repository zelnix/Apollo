"""Emergent-managed email (guardian invitations) with a credential-phishing guard on outgoing content."""
from __future__ import annotations

from html import escape
from typing import Optional

import httpx
from fastapi import HTTPException

from core.config import EMAIL_BASE_URL, EMAIL_FROM_NAME, EMAIL_KEY, logger


_CRED_ASK = ("reply with your password", "reply with the code", "send your password", "cvv", "seed phrase", "verify your card", "confirm your bank details")


def _assert_safe_email(subject: str, html: str) -> None:
    low = f"{subject}\n{html}".lower()
    if "<form" in low or "<input" in low:
        raise ValueError("No forms in email")
    if any(p in low for p in _CRED_ASK):
        raise ValueError("Credential ask phrasing")
    for m in __import__("re").finditer(r'(?:href|src)="([^"]+)"', html):
        u = m.group(1).lower()
        if u.startswith(("mailto:", "#")):
            continue
        if not u.startswith("https://") or "xn--" in u or "@" in u.split("/")[2]:
            raise ValueError(f"Unsafe link {u}")


async def send_email(*, to: str, subject: str, html: str) -> Optional[str]:
    _assert_safe_email(subject, html)
    if not EMAIL_KEY:
        raise HTTPException(status_code=503, detail="Email is not configured")
    async with httpx.AsyncClient(timeout=30) as http:
        resp = await http.post(f"{EMAIL_BASE_URL}/api/v1/email/send", headers={"X-Email-Key": EMAIL_KEY}, json={"to": [to], "subject": subject, "html": html, "from_name": EMAIL_FROM_NAME})
    if resp.status_code >= 400:
        logger.error("email send failed: %s", resp.status_code)
        raise HTTPException(status_code=502, detail="Failed to send email")
    return resp.json().get("id")


def _wrap(body: str) -> str:
    return (f'<table role="presentation" width="100%"><tr><td style="padding:24px;font-family:Arial,sans-serif;color:#111">{body}'
            f'<p style="font-size:12px;color:#888">Sent by {escape(EMAIL_FROM_NAME)}, a privacy-first security app. Apollo is a brand of Harmony Wellness Group. Apollo never asks for passwords, codes or payment details by email.</p></td></tr></table>')
