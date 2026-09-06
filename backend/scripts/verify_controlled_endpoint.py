"""DNS/IP binding pre-check for the controlled endpoint (backend-side mirror of the Android check).

Usage: cd backend && python scripts/verify_controlled_endpoint.py [--allow-placeholder] [--api https://backend]
  --api  read the controlled endpoint from the running backend's public GET /api/config instead of local settings.
         Needs NO backend secrets — this is what the mobile build pipeline uses (public distribution data only).
Exit 0 only if the configured host resolves to exactly the configured dedicated IPv4 (single A record)
and the HTTPS URL answers. Exit 2 on placeholder config, 3 on mismatch, 4 on unreachable URL.
"""
from __future__ import annotations

import socket
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from types import SimpleNamespace


def _from_api(base: str) -> SimpleNamespace:
    cfg = httpx.get(f"{base.rstrip('/')}/api/config", timeout=10).json()
    ce = cfg["controlledEndpoint"]
    return SimpleNamespace(controlled_host=ce["host"], controlled_ipv4=ce["ipv4"], controlled_url=ce["url"], ruleset_id=cfg["rulesetId"],
                           controlled_endpoint_is_placeholder=ce["isPlaceholder"])


def main() -> int:
    if "--api" in sys.argv:
        s = _from_api(sys.argv[sys.argv.index("--api") + 1])
    else:
        from app.core.settings import get_settings
        s = get_settings()
    allow_placeholder = "--allow-placeholder" in sys.argv
    print(f"controlledHost={s.controlled_host} controlledIpv4={s.controlled_ipv4} url={s.controlled_url} ruleset={s.ruleset_id}")
    if s.controlled_endpoint_is_placeholder and not allow_placeholder:
        print("REFUSED: controlled endpoint is a documentation placeholder; inject the real Guard Dog-controlled host/IPv4 first")
        return 2
    try:
        resolved = sorted({ai[4][0] for ai in socket.getaddrinfo(s.controlled_host, 443, socket.AF_INET)})
    except socket.gaierror as exc:
        print(f"MISMATCH: hostname did not resolve ({exc})")
        return 3
    print(f"resolved={resolved}")
    if resolved != [s.controlled_ipv4]:
        print("MISMATCH: resolution must be exactly the configured dedicated IPv4 (single A record, no CDN/shared IP)")
        return 3
    try:
        r = httpx.get(s.controlled_url, timeout=8, follow_redirects=False)
        print(f"https status={r.status_code} tls=ok")
    except httpx.HTTPError as exc:
        print(f"UNREACHABLE: {type(exc).__name__}")
        return 4
    print("OK: DNS/IP binding verified")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
