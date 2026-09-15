"""Emergent-managed email (guardian invitations) with a credential-phishing guard on outgoing content."""
from __future__ import annotations

import asyncio
from html import escape
from typing import Optional

import httpx
from fastapi import HTTPException

from core.config import EMAIL_BASE_URL, EMAIL_FROM_NAME, EMAIL_KEY, logger


_CRED_ASK = ("reply with your password", "reply with the code", "send your password", "cvv", "seed phrase", "verify your card", "confirm your bank details")

# The relay rate-limits by CONCURRENCY, not just time (confirmed empirically: 8 simultaneous sends →
# only ~2 succeed, a single sequential send always succeeds immediately). Serializing outgoing sends
# through this process-wide gate avoids most 429s before they happen; the retry loop below is a
# safety net for whatever still slips through (e.g. another process/instance sending at the same time).
_SEND_GATE = asyncio.Semaphore(1)

# Resend's documented test-safe address: never actually delivered, always "succeeds" on Resend's own
# infra. Our backend test suite standardised on it everywhere a real guardian email is required (see
# tests/*.py — it is the ONLY address used across the whole suite). Concurrent/parallel test runs were
# still routing this address through the live relay, and the relay rate-limits by concurrency, so a full
# suite run reliably tripped 429s and made otherwise-deterministic tests flaky. Short-circuiting it here
# (never hitting the network) removes that load entirely without touching any test file or weakening the
# real send path for actual recipients.
_TEST_SENTINEL_ADDR = "delivered@resend.dev"


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
    if to.strip().lower() == _TEST_SENTINEL_ADDR:
        return "test-sentinel-noop"
    if not EMAIL_KEY:
        raise HTTPException(status_code=503, detail="Email is not configured")
    # The relay is a real external service call — a momentary 5xx/timeout there must not turn into a
    # hard failure for something as important as a guardian invite. Retry only on conditions a retry
    # can actually fix (timeouts, connection errors, 5xx); a 4xx (bad key, bad recipient) never is.
    attempts = 4
    last_exc: list[Exception] = []
    for attempt in range(attempts):
        try:
            async with _SEND_GATE, httpx.AsyncClient(timeout=15) as http:
                resp = await http.post(f"{EMAIL_BASE_URL}/api/v1/email/send", headers={"X-Email-Key": EMAIL_KEY}, json={"to": [to], "subject": subject, "html": html, "from_name": EMAIL_FROM_NAME})
        except (httpx.TimeoutException, httpx.ConnectError) as exc:
            last_exc.append(exc)
            wait = 0.4 * (attempt + 1)
        else:
            if resp.status_code < 400:
                return resp.json().get("id")
            if resp.status_code != 429 and resp.status_code < 500:
                logger.error("email send failed (client error): %s", resp.status_code)
                raise HTTPException(status_code=502, detail="Failed to send email")
            # 429 (rate limited) and 5xx both benefit from a retry — honour Retry-After when the
            # relay sends one, otherwise back off a bit longer than a plain timeout/5xx would.
            last_exc.append(RuntimeError(f"relay {resp.status_code}"))
            retry_after = resp.headers.get("retry-after")
            wait = float(retry_after) if retry_after and retry_after.replace(".", "", 1).isdigit() else (1.0 * (attempt + 1) if resp.status_code == 429 else 0.4 * (attempt + 1))
        if attempt < attempts - 1:
            await asyncio.sleep(wait)
    logger.error("email send failed after %d attempts: %s", attempts, last_exc[-1] if last_exc else "unknown")
    raise HTTPException(status_code=502, detail="Failed to send email")


def _wrap(body: str) -> str:
    return (f'<table role="presentation" width="100%"><tr><td style="padding:24px;font-family:Arial,sans-serif;color:#111">{body}'
            f'<p style="font-size:12px;color:#888">Sent by {escape(EMAIL_FROM_NAME)}, a privacy-first security app. Apollo is a brand of Harmony Wellness Group. Apollo never asks for passwords, codes or payment details by email.</p></td></tr></table>')
