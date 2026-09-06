"""DNS/IP binding pre-check for the controlled endpoint (backend-side mirror of the Android check).

Usage: cd backend && python scripts/verify_controlled_endpoint.py [--allow-placeholder]
Exit 0 only if the configured host resolves to exactly the configured dedicated IPv4 (single A record)
and the HTTPS URL answers. Exit 2 on placeholder config, 3 on mismatch, 4 on unreachable URL.
"""
from __future__ import annotations

import socket
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core.settings import get_settings  # noqa: E402


def main() -> int:
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
