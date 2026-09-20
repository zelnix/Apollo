"""Independent real-clock/crypto checks for public Stage 1D acceptance vectors."""
from __future__ import annotations

import base64
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

ROOT = Path(__file__).resolve().parents[1]
VECTORS = ROOT / "modules/apollo-security/android/src/test/resources/guarddog-acceptance"
KEY_ID = "apollo-stage1d-acceptance-ed25519-001"
PUBLIC = Ed25519PublicKey.from_public_bytes(base64.b64decode("bZeQ3t9aAOC9/eg7sCrKB5hNLBRKk/SZlDmYBhxNQrk="))


def canonical(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def load(name: str) -> dict:
    return json.loads((VECTORS / name).read_text())


def signature_valid(bundle: dict) -> bool:
    unsigned = {key: value for key, value in bundle.items() if key != "signature"}
    try:
        PUBLIC.verify(base64.b64decode(bundle["signature"]), canonical(unsigned))
        return True
    except InvalidSignature:
        return False


def test_current_valid_bundle_signature_scope_and_clock():
    bundle = load("valid_bundle.json")
    assert bundle["keyId"] == KEY_ID
    assert bundle["payloadHash"] == hashlib.sha256(canonical(bundle["payload"])).hexdigest()
    assert signature_valid(bundle)
    now = datetime.now(timezone.utc)
    assert datetime.fromisoformat(bundle["issuedAt"].replace("Z", "+00:00")) <= now
    assert now < datetime.fromisoformat(bundle["expiresAt"].replace("Z", "+00:00"))
    assert bundle["payload"]["rules"] == [{
        "ruleId": "stage1d-fixture-block", "host": "stage1d-acceptance-fixture.invalid",
        "action": "block", "matchType": "exact", "category": "acceptance",
    }]


def test_tampered_expired_and_unknown_key_cases_fail_closed():
    tampered = load("tampered_bundle.json")
    assert tampered["payloadHash"] != hashlib.sha256(canonical(tampered["payload"])).hexdigest()
    assert not signature_valid(tampered)
    expired = load("expired_bundle.json")
    assert signature_valid(expired)
    assert datetime.fromisoformat(expired["expiresAt"].replace("Z", "+00:00")) < datetime.now(timezone.utc)
    unknown = load("unknown_key_bundle.json")
    assert unknown["keyId"] != KEY_ID