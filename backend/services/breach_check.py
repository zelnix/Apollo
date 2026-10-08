"""Provider-agnostic account-exposure (breach) lookup.

Apollo's Account Gate monitors the owner's own email addresses for appearance in known data
breaches. The provider is abstracted so HIBP can replace XposedOrNot the moment a key is supplied,
without any change to callers.

Privacy posture:
- The address is forwarded once to the configured provider and is never stored or logged here.
- No passwords or secret values are ever requested, returned or persisted.
- "No breach returned" is reported honestly as "not found", never as proof the account is secure.

Attribution: when XposedOrNot data is displayed, the UI credits "XposedOrNot" (free API). HIBP data
is credited to "Have I Been Pwned". The `source_label` field carries the correct attribution.
"""
from __future__ import annotations

import asyncio
import time
from typing import Any
from urllib.parse import quote

import httpx

from core.config import HIBP_API_KEY, logger

# XposedOrNot free endpoints are rate limited per IP (documented: 2 req/s). Serialise outbound calls
# and keep a small floor between them so a multi-email scan never trips a 429.
_XON_BASE = "https://api.xposedornot.com"
_MIN_INTERVAL_S = 0.6
_lock = asyncio.Lock()
_last_request = 0.0


def active_provider() -> str:
    """HIBP when a key is configured (deeper data), otherwise the free XposedOrNot provider."""
    return "hibp" if HIBP_API_KEY else "xposedornot"


def source_label(provider: str) -> str:
    return "Have I Been Pwned" if provider == "hibp" else "XposedOrNot"


async def _xon_get(client: httpx.AsyncClient, path: str, **kwargs: Any) -> httpx.Response:
    global _last_request
    async with _lock:
        delay = _MIN_INTERVAL_S - (time.monotonic() - _last_request)
        if delay > 0:
            await asyncio.sleep(delay)
        response = await client.get(path, **kwargs)
        _last_request = time.monotonic()
    return response


def _clear(provider: str) -> dict[str, Any]:
    return {"status": "clear", "breaches": [], "password_exposed": False, "provider": provider,
            "detail": "No known breach lists this address. That's good — not a guarantee."}


def _unavailable(provider: str, detail: str) -> dict[str, Any]:
    return {"status": "unavailable", "breaches": [], "password_exposed": False, "provider": provider, "detail": detail}


async def _xposedornot_scan(email: str) -> dict[str, Any]:
    encoded = quote(email, safe="")
    try:
        async with httpx.AsyncClient(base_url=_XON_BASE, timeout=12, headers={"user-agent": "Apollo-GuardDog"}) as client:
            r = await _xon_get(client, f"/v1/check-email/{encoded}")
    except httpx.HTTPError:
        return _unavailable("xposedornot", "The breach service didn't answer. Apollo will try again on the next check.")
    if r.status_code == 404:
        return _clear("xposedornot")
    if r.status_code == 429:
        return _unavailable("xposedornot", "The breach service is busy right now. Apollo will try again on the next check.")
    if r.status_code != 200:
        return _unavailable("xposedornot", "The breach service is unavailable right now.")
    try:
        data = r.json()
    except ValueError:
        return _unavailable("xposedornot", "The breach service returned an unreadable answer.")
    raw = data.get("breaches") if isinstance(data, dict) else None
    if not raw:
        return _clear("xposedornot")
    names: list[str] = []
    for group in raw:
        for name in (group if isinstance(group, list) else [group]):
            if name and str(name) not in names:
                names.append(str(name))
    if not names:
        return _clear("xposedornot")
    breaches = [{"name": n, "date": ""} for n in names[:25]]
    plural = "es" if len(breaches) != 1 else ""
    return {"status": "found", "breaches": breaches, "password_exposed": False, "provider": "xposedornot",
            "detail": f"This address appears in {len(breaches)} known breach{plural}."}


async def _hibp_scan(email: str) -> dict[str, Any]:
    ident = quote(email, safe="")
    try:
        async with httpx.AsyncClient(timeout=12) as client:
            r = await client.get(f"https://haveibeenpwned.com/api/v3/breachedaccount/{ident}",
                                 params={"truncateResponse": "false"},
                                 headers={"hibp-api-key": HIBP_API_KEY or "", "user-agent": "Apollo-GuardDog"})
    except httpx.HTTPError:
        return _unavailable("hibp", "The breach service didn't answer. Apollo will try again on the next check.")
    if r.status_code == 404:
        return _clear("hibp")
    if r.status_code != 200:
        return _unavailable("hibp", "The breach service is unavailable right now.")
    try:
        data = r.json()
    except ValueError:
        return _unavailable("hibp", "The breach service returned an unreadable answer.")
    breaches = [{"name": b.get("Title") or b.get("Name") or "Unknown", "date": b.get("BreachDate") or ""} for b in data[:25]]
    pw = any("Passwords" in (b.get("DataClasses") or []) for b in data)
    plural = "es" if len(breaches) != 1 else ""
    detail = f"This address appears in {len(breaches)} known breach{plural}." + (" At least one included passwords." if pw else "")
    return {"status": "found", "breaches": breaches, "password_exposed": pw, "provider": "hibp", "detail": detail}


async def scan_email(email: str) -> dict[str, Any]:
    """One breach lookup for one address through the active provider. Never raises for provider errors —
    returns a truthful 'unavailable' status instead, so a weekly scan never fabricates a clean result."""
    try:
        if HIBP_API_KEY:
            return await _hibp_scan(email)
        return await _xposedornot_scan(email)
    except Exception:  # noqa: BLE001 — provider failures must degrade to "unavailable", never to "clear"
        logger.warning("breach scan failed for one address (provider=%s)", active_provider())
        return _unavailable(active_provider(), "Apollo couldn't complete this check. It will try again on the next check.")
