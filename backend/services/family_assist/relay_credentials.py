"""Cloudflare TURN credential broker. Long-lived provider configuration never leaves this module."""
from __future__ import annotations

import asyncio
import hashlib
import random
from datetime import timedelta
from urllib.parse import urlparse

import httpx
from fastapi import HTTPException

from core.db import db, now_utc
from services.family_assist.config import FamilyAssistConfig, load_config

ALLOWED_ICE_HOSTS = frozenset({"stun.cloudflare.com", "turn.cloudflare.com"})
ALLOWED_ICE_SCHEMES = frozenset({"stun", "turn", "turns"})


class RelayCredentialError(RuntimeError):
    pass


def _parse_ice_url(raw: str):
    if ":" not in raw:
        return urlparse(raw)
    scheme, rest = raw.split(":", 1)
    return urlparse(f"{scheme}://{rest}")


def validate_cloudflare_ice_servers(payload: object) -> list[dict]:
    if not isinstance(payload, dict) or set(payload) != {"iceServers"} or not isinstance(payload["iceServers"], list):
        raise RelayCredentialError("invalid_provider_shape")
    if not 1 <= len(payload["iceServers"]) <= 5:
        raise RelayCredentialError("invalid_provider_server_count")
    output: list[dict] = []
    saw_turn = False
    for raw in payload["iceServers"]:
        if not isinstance(raw, dict) or set(raw) - {"urls", "username", "credential"}:
            raise RelayCredentialError("unexpected_provider_fields")
        urls = raw.get("urls")
        urls = [urls] if isinstance(urls, str) else urls
        if not isinstance(urls, list) or not 1 <= len(urls) <= 8:
            raise RelayCredentialError("invalid_provider_urls")
        for value in urls:
            if not isinstance(value, str) or len(value) > 300:
                raise RelayCredentialError("invalid_provider_url")
            parsed = _parse_ice_url(value)
            if parsed.scheme not in ALLOWED_ICE_SCHEMES or parsed.hostname not in ALLOWED_ICE_HOSTS or parsed.username or parsed.password or parsed.port == 53:
                raise RelayCredentialError("non_whitelisted_provider_url")
        turn_entry = any(value.startswith(("turn:", "turns:")) for value in urls)
        if turn_entry:
            username, credential = raw.get("username"), raw.get("credential")
            if not isinstance(username, str) or not 1 <= len(username) <= 512 or not isinstance(credential, str) or not 1 <= len(credential) <= 512:
                raise RelayCredentialError("missing_temporary_turn_auth")
            output.append({"urls": urls, "username": username, "credential": credential})
            saw_turn = True
        else:
            if any(not value.startswith("stun:") for value in urls) or "username" in raw or "credential" in raw:
                raise RelayCredentialError("invalid_stun_entry")
            output.append({"urls": urls})
    if not saw_turn:
        raise RelayCredentialError("turn_server_missing")
    return output


async def fetch_cloudflare_ice_servers(config: FamilyAssistConfig, ttl: int) -> list[dict]:
    if not config.turn_valid:
        raise RelayCredentialError("family_assist_unavailable")
    delays = (0.0, 1.0, 2.0, 4.0)
    for attempt, delay in enumerate(delays):
        if delay:
            await asyncio.sleep(delay + random.uniform(0, min(0.25, delay / 4)))
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                response = await client.post(
                    config.cloudflare_credentials_url,
                    headers={"Authorization": f"Bearer {config.cloudflare_turn_api_token}", "Content-Type": "application/json"},
                    json={"ttl": ttl},
                )
        except (httpx.TimeoutException, httpx.NetworkError):
            if attempt == len(delays) - 1:
                raise RelayCredentialError("provider_unreachable")
            continue
        if response.status_code == 201:
            try:
                return validate_cloudflare_ice_servers(response.json())
            except (ValueError, TypeError) as error:
                raise RelayCredentialError("invalid_provider_json") from error
        if response.status_code in {401, 403}:
            raise RelayCredentialError("provider_auth_rejected")
        if response.status_code == 429:
            if attempt == len(delays) - 1:
                raise RelayCredentialError("provider_rate_limited")
            retry_after = response.headers.get("Retry-After", "1")
            try:
                await asyncio.sleep(max(0.1, min(4.0, float(retry_after))))
            except ValueError:
                await asyncio.sleep(1)
            continue
        if response.status_code < 500 or attempt == len(delays) - 1:
            raise RelayCredentialError("provider_rejected")
    raise RelayCredentialError("provider_unreachable")


async def issue_relay_credentials(session: dict, device_id: str, role: str) -> dict:
    config = load_config()
    if not config.available:
        raise RelayCredentialError("family_assist_unavailable")
    now = now_utc()
    hard_end = session.get("hard_expires_at") or session["invitation_expires_at"]
    remaining = int((hard_end - now).total_seconds())
    ttl = min(config.relay_ttl_seconds, max(1, remaining))
    if ttl < 60:
        raise RelayCredentialError("session_expiring")
    ice_servers = await fetch_cloudflare_ice_servers(config, ttl)
    expires_at = now + timedelta(seconds=ttl)
    turn_username = next(row["username"] for row in ice_servers if "username" in row)
    await db.family_assist_turn_issuances.insert_one({
        "provider": "cloudflare", "session_id": session["session_id"], "generation": session["generation"],
        "device_id": device_id, "role": role, "username_digest": hashlib.sha256(turn_username.encode()).hexdigest(),
        "issued_at": now, "expires_at": expires_at,
    })
    return {"provider": "cloudflare", "iceServers": ice_servers, "ttl": ttl, "expiresAt": expires_at.isoformat()}


def unavailable_http() -> HTTPException:
    return HTTPException(503, "Family Help relay credentials are temporarily unavailable.")