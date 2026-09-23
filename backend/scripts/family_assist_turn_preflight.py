#!/usr/bin/env python3
"""Fail-closed FF10 TURN configuration/network preflight. Never prints credentials."""
from __future__ import annotations

import socket
import ssl
import sys

from services.family_assist.config import load_config, parse_turn_url


def main() -> int:
    config = load_config()
    if not config.turn_valid:
        print("FF10_TURN_PREFLIGHT=configuration_missing")
        return 2
    failures: list[str] = []
    checked: list[str] = []
    for raw in config.turn_urls:
        parsed = parse_turn_url(raw); host = parsed.hostname or ""; port = parsed.port or (5349 if parsed.scheme == "turns" else 3478)
        try:
            socket.getaddrinfo(host, port, type=socket.SOCK_STREAM if parsed.scheme == "turns" else socket.SOCK_DGRAM)
            checked.append(f"dns:{parsed.scheme}:{host}:{port}")
            if parsed.scheme == "turns":
                context = ssl.create_default_context()
                with socket.create_connection((host, port), timeout=5) as tcp, context.wrap_socket(tcp, server_hostname=host):
                    checked.append(f"tls:{host}:{port}")
        except (OSError, ssl.SSLError) as error:
            failures.append(f"{parsed.scheme}:{host}:{port}:{type(error).__name__}")
    if failures:
        print("FF10_TURN_PREFLIGHT=network_failed " + ",".join(failures))
        return 3
    print(f"FF10_TURN_PREFLIGHT=pass routes={len(config.turn_urls)} checks={len(checked)} credentials=redacted")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())