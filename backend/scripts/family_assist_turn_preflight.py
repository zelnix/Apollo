#!/usr/bin/env python3
"""Fail-closed Cloudflare TURN preflight. Provider secrets and credentials are never printed."""
from __future__ import annotations

import asyncio

from services.family_assist.config import load_config
from services.family_assist.relay_credentials import RelayCredentialError, fetch_cloudflare_ice_servers


async def run() -> int:
    config = load_config()
    if not config.turn_valid:
        print("FF10_TURN_PREFLIGHT=configuration_missing provider=cloudflare")
        return 2
    try:
        servers = await fetch_cloudflare_ice_servers(config, config.relay_ttl_seconds)
    except RelayCredentialError as error:
        print(f"FF10_TURN_PREFLIGHT=provider_failed code={error} credentials=redacted")
        return 3
    turn_routes = sum(len(row["urls"]) for row in servers if "username" in row)
    print(f"FF10_TURN_PREFLIGHT=pass provider=cloudflare ice_servers={len(servers)} turn_routes={turn_routes} ttl={config.relay_ttl_seconds} credentials=redacted")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(run()))