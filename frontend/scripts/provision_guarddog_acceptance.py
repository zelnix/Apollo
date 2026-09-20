#!/usr/bin/env python3
"""Provision a short-lived public acceptance bundle without writing the private key to disk."""
from __future__ import annotations

import base64
import hashlib
import ipaddress
import json
import os
import socket
import ssl
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

PINNED_PUBLIC_B64 = "bZeQ3t9aAOC9/eg7sCrKB5hNLBRKk/SZlDmYBhxNQrk="
KEY_ID = "apollo-stage1d-acceptance-ed25519-001"


def canonical(value: object) -> bytes:
    # This strict acceptance schema contains ASCII strings, arrays, objects and one integer only;
    # sorted compact JSON is therefore byte-identical to RFC 8785 for every accepted input here.
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit(f"Missing {name}")
    return value


def main() -> None:
    host = required("GUARDDOG_CONTROLLED_HOST").lower().rstrip(".")
    ipv4 = required("GUARDDOG_CONTROLLED_IPV4")
    url = required("GUARDDOG_CONTROLLED_URL")
    ownership_path = Path(required("GUARDDOG_ENDPOINT_OWNERSHIP_FILE"))
    if not ownership_path.is_file():
        raise SystemExit("Endpoint ownership evidence file is missing")
    if not ipaddress.ip_address(ipv4).is_global:
        raise SystemExit("Controlled IPv4 must be a currently routed global dedicated address")
    if urlparse(url).scheme != "https" or urlparse(url).hostname != host:
        raise SystemExit("Controlled URL must be HTTPS and match the canonical host")
    resolved = sorted({row[4][0] for row in socket.getaddrinfo(host, 443, socket.AF_INET, socket.SOCK_STREAM)})
    if resolved != [ipv4]:
        raise SystemExit(f"Dedicated binding failed: expected {[ipv4]}, resolved {resolved}")
    request = urllib.request.Request(url, headers={"User-Agent": "Apollo-GuardDog-Acceptance-Provisioner/1"})
    with urllib.request.urlopen(request, timeout=10, context=ssl.create_default_context()) as response:
        baseline_status = response.status
        response.read(4096)
    if not 200 <= baseline_status < 400:
        raise SystemExit(f"Controlled endpoint baseline failed with HTTP {baseline_status}")

    private_path = os.environ.get("GUARDDOG_ACCEPTANCE_PRIVATE_KEY_FILE", "").strip()
    if private_path:
        key_path = Path(private_path).resolve()
        if key_path.is_relative_to(Path.cwd().resolve()):
            raise SystemExit("Private acceptance key must remain outside the repository")
        if key_path.stat().st_mode & 0o077:
            raise SystemExit("Private acceptance key must not be readable by group or other users")
        key = serialization.load_pem_private_key(key_path.read_bytes(), password=None)
    else:
        private_der = base64.b64decode(required("GUARDDOG_ACCEPTANCE_PRIVATE_KEY_PKCS8_B64"), validate=True)
        key = serialization.load_der_private_key(private_der, password=None)
    if not isinstance(key, Ed25519PrivateKey):
        raise SystemExit("Acceptance key is not Ed25519")
    public_raw = key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    if base64.b64encode(public_raw).decode() != PINNED_PUBLIC_B64:
        raise SystemExit("Private signing key does not match the Apollo acceptance public key")

    now = datetime.now(timezone.utc).replace(microsecond=0)
    payload = {"rules": [{"ruleId": "apollo-stage1d-controlled-block", "host": host, "action": "block", "matchType": "exact", "category": "acceptance"}]}
    unsigned = {"schemaVersion": "1.0", "rulesetId": "apollo-stage1d-acceptance", "bundleVersion": int(required("GUARDDOG_BUNDLE_VERSION")),
                "issuedAt": (now - timedelta(minutes=5)).isoformat().replace("+00:00", "Z"),
                "expiresAt": (now + timedelta(hours=24)).isoformat().replace("+00:00", "Z"), "keyId": KEY_ID,
                "payload": payload, "payloadHash": hashlib.sha256(canonical(payload)).hexdigest()}
    bundle = {**unsigned, "signature": base64.b64encode(key.sign(canonical(unsigned))).decode()}
    bundle_json = canonical(bundle).decode()

    output = Path(".acceptance"); output.mkdir(mode=0o700, exist_ok=True)
    bundle_path = output / "guarddog-bundle.json"; bundle_path.write_text(bundle_json); bundle_path.chmod(0o600)
    env_path = output / "candidate.env"
    env_path.write_text("\n".join([
        "EXPO_PUBLIC_ANDROID_ENFORCEMENT_ENGINE=guarddog_acceptance",
        f"EXPO_PUBLIC_GUARDDOG_CONTROLLED_HOST={host}",
        f"EXPO_PUBLIC_GUARDDOG_CONTROLLED_IPV4={ipv4}",
        f"EXPO_PUBLIC_GUARDDOG_CONTROLLED_URL={url}",
        "EXPO_PUBLIC_GUARDDOG_RULESET_ID=apollo-stage1d-acceptance",
        f"EXPO_PUBLIC_GUARDDOG_SIGNED_BUNDLE_B64={base64.b64encode(bundle_json.encode()).decode()}",
        "",
    ]))
    env_path.chmod(0o600)
    receipt = {"provisionedAt": now.isoformat(), "host": host, "ipv4": ipv4, "url": url, "baselineStatus": baseline_status,
               "ownershipEvidenceSha256": hashlib.sha256(ownership_path.read_bytes()).hexdigest(),
               "bundleSha256": hashlib.sha256(bundle_json.encode()).hexdigest(), "expiresAt": bundle["expiresAt"], "keyId": KEY_ID}
    (output / "provisioning-receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    Path("guarddog-acceptance.config.json").write_text(json.dumps({
        "controlledHost": host,
        "controlledIpv4": ipv4,
        "controlledUrl": url,
        "rulesetId": "apollo-stage1d-acceptance",
        "signedBundleB64": base64.b64encode(bundle_json.encode()).decode(),
    }, indent=2) + "\n")
    print(json.dumps(receipt, indent=2))


if __name__ == "__main__":
    main()