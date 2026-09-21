"""Guardian invitations: legacy managed relay and fake-success recipient removed.

Direct sending is blocked until the owner supplies Resend credentials and a verified sender.
Gmail read-only OAuth is unrelated and remains enabled.
"""
from html import escape
import re

from fastapi import HTTPException
from core.config import EMAIL_FROM_NAME

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
    raise HTTPException(503, "Guardian email requires RESEND_API_KEY and a verified RESEND_FROM_EMAIL. No email was sent.")


def _wrap(body: str) -> str:
    return (f'<table role="presentation" width="100%"><tr><td style="padding:24px;font-family:Arial,sans-serif;color:#111">{body}'
            f'<p style="font-size:12px;color:#888">Sent by {escape(EMAIL_FROM_NAME)}. Apollo is a brand of Harmony Wellness Group. '
            'Apollo never asks for passwords, codes or payment details by email.</p></td></tr></table>')