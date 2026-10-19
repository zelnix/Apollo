#!/usr/bin/env python3
"""Fail-closed verification for the dedicated Stage 1D controlled endpoint."""
from __future__ import annotations

import ipaddress
import os
import socket
import ssl
import urllib.request
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse

EXPECTED_BODY = b"APOLLO_GUARDDOG_ACCEPTANCE_V1\n"


def required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit(f"Missing {name}")
    return value


def main() -> None:
    host = required("GUARDDOG_CONTROLLED_HOST").lower().rstrip(".")
    ipv4 = required("GUARDDOG_CONTROLLED_IPV4")
    url = required("GUARDDOG_CONTROLLED_URL")
    address = ipaddress.ip_address(ipv4)
    if address.version != 4 or not address.is_global:
        raise SystemExit("Controlled endpoint must use a dedicated globally routed IPv4")
    parsed = urlparse(url)
    if parsed.scheme != "https" or parsed.hostname != host or parsed.path != "/apollo-guarddog-acceptance/v1":
        raise SystemExit("URL must be the exact HTTPS acceptance path on the controlled host")
    resolved = sorted({row[4][0] for row in socket.getaddrinfo(host, 443, socket.AF_INET, socket.SOCK_STREAM)})
    if resolved != [ipv4]:
        raise SystemExit(f"Expected exclusive DNS answer {[ipv4]}, got {resolved}")
    request = urllib.request.Request(url, headers={"User-Agent": "Apollo-GuardDog-Endpoint-Verifier/1"})
    try:
        with urllib.request.urlopen(request, timeout=10, context=ssl.create_default_context()) as response:
            body = response.read(len(EXPECTED_BODY) + 1)
            if response.status != 200 or body != EXPECTED_BODY:
                raise SystemExit(f"Deterministic baseline mismatch: HTTP {response.status}, body={body!r}")
            if response.headers.get("Cache-Control") != "no-store":
                raise SystemExit("Controlled response must set Cache-Control: no-store")
    except HTTPError as error:
        raise SystemExit(f"Controlled endpoint returned HTTP {error.code} at the exact acceptance path") from None
    except URLError as error:
        raise SystemExit(f"Controlled endpoint connection failed: {error.reason}") from None
    print(f"PASS host={host} dedicated_ipv4={ipv4} https=valid deterministic_response=valid")


if __name__ == "__main__":
    main()