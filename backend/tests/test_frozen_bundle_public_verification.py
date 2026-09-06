"""Read-only verification of the FROZEN M1 controlled bundle (v25) against the pinned PUBLIC key.

Needs no private material, no database, no running backend: this is the check every consumer (CI, app, auditor)
can run. The committed copy is security/frozen/controlled-bundle-v25.json; the pinned key is the M1 trust anchor.
"""
from __future__ import annotations

import base64
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from app.services.jcs_canonicalization import canonical_bytes as canonicalize
from app.services.rule_signer import verify_bundle

ROOT = Path(__file__).resolve().parents[2]
FROZEN = json.loads((ROOT / "security/frozen/controlled-bundle-v25.json").read_text())
PINNED_KEY_ID = "gd-m1-test-ed25519-001"
PINNED_PUBLIC_B64 = "ccf41NL6VHYQsH171Lw98hKiIoQFvAY0t171X4PL/ac="


def test_frozen_bundle_identity():
    assert FROZEN["rulesetId"] == "gd-m1-controlled-block"
    assert FROZEN["bundleVersion"] == 25
    assert FROZEN["keyId"] == PINNED_KEY_ID
    assert FROZEN["payload"]["rules"] == [
        {"ruleId": "m1-controlled-block-001", "host": "blocktest.btciq.app", "action": "block", "matchType": "exact", "category": "controlled-test"}
    ]


def test_frozen_bundle_payload_hash_is_sha256_of_jcs_payload():
    assert FROZEN["payloadHash"] == hashlib.sha256(canonicalize(FROZEN["payload"])).hexdigest()
    assert FROZEN["payloadHash"] == "2581666cc768e1e4e76962db0cc70e497e17e9b9cf4a5a997c8cfb091e6b90c9"


def test_frozen_bundle_signature_verifies_with_pinned_public_key_only():
    unsigned = {k: v for k, v in FROZEN.items() if k != "signature"}
    Ed25519PublicKey.from_public_bytes(base64.b64decode(PINNED_PUBLIC_B64)).verify(base64.b64decode(FROZEN["signature"]), canonicalize(unsigned))
    result = verify_bundle(FROZEN, {PINNED_KEY_ID: PINNED_PUBLIC_B64}, datetime.now(timezone.utc), highest_accepted_version=24)
    assert result.accepted, result.reason


def test_frozen_bundle_rejected_by_any_other_key_and_below_frozen_version():
    other = base64.b64encode(bytes(32)).decode()
    assert not verify_bundle(FROZEN, {PINNED_KEY_ID: other}, datetime.now(timezone.utc)).accepted
    # rollback protection: once v25 is accepted, v25 itself is not "newer"
    assert not verify_bundle(FROZEN, {PINNED_KEY_ID: PINNED_PUBLIC_B64}, datetime.now(timezone.utc), highest_accepted_version=25).accepted
