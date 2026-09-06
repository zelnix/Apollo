"""Generate the canonical cross-language fixtures under security/test-vectors.

Run:  cd backend && python scripts/generate_test_vectors.py
Requires the M1 signing keys from backend/.env (Ed25519 is deterministic, so
regeneration is byte-identical; test_bundle_fixture_generation.py asserts this).
Frozen clock for all consumers: 2026-06-15T00:00:00Z.
"""
from __future__ import annotations

import base64
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core import security  # noqa: E402
from app.core.settings import get_settings  # noqa: E402
from app.domain.models.rule_bundle import SignedRuleBundle, UnsignedRuleBundle  # noqa: E402
from app.domain.models.rule_entry import RuleEntry  # noqa: E402
from app.services.jcs_canonicalization import canonical_bytes  # noqa: E402
from app.services.rule_signer import build_unsigned, payload_hash, sign_unsigned  # noqa: E402

ROOT = Path(__file__).resolve().parents[2] / "security" / "test-vectors"
FROZEN_NOW = "2026-06-15T00:00:00Z"
ISSUED = datetime(2026, 6, 1, tzinfo=timezone.utc)
EXPIRES = datetime(2027, 6, 1, tzinfo=timezone.utc)
RULESET = "gd-m1-controlled-block"
CONTROLLED_HOST = "m1-block-test.guarddog.example"


def rules() -> list[RuleEntry]:
    return [
        RuleEntry(ruleId="m1-controlled-block-001", host=CONTROLLED_HOST, action="block", category="controlled-test"),
        RuleEntry(ruleId="m1-allow-001", host="allowed.guarddog.example", action="allow", category="controlled-test"),
    ]


def dump(name: str, data) -> None:
    path = ROOT / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def resign(unsigned: dict, key) -> dict:
    return sign_unsigned(UnsignedRuleBundle.model_validate(unsigned), key).model_dump()


def flip_signature(sig_b64: str) -> str:
    raw = bytearray(base64.b64decode(sig_b64))
    raw[0] ^= 0x01
    return base64.b64encode(bytes(raw)).decode("ascii")


def main() -> dict:
    s = get_settings()
    key1 = security.load_private_key(s.signing_private_key_b64)
    key2 = security.load_private_key(s.secondary_private_key_b64)
    pub1, pub2 = security.public_key_b64(key1), security.public_key_b64(key2)

    unsigned = build_unsigned(ruleset_id=RULESET, bundle_version=3, key_id=s.signing_key_id, rules=rules(), issued_at=ISSUED, expires_at=EXPIRES)
    valid = sign_unsigned(unsigned, key1).model_dump()
    u = unsigned.model_dump()
    out: dict[str, object] = {}

    # --- signing/ ---
    out["signing/valid_bundle.json"] = valid
    tampered = json.loads(json.dumps(valid))
    tampered["payload"]["rules"][0]["host"] = "attacker-swapped.guarddog.example"  # hash+sig untouched
    out["signing/tampered_payload_bundle.json"] = tampered
    out["signing/expired_bundle.json"] = resign({**u, "expiresAt": "2026-06-10T00:00:00Z"}, key1)
    out["signing/rollback_bundle.json"] = resign({**u, "bundleVersion": 1}, key1)
    out["signing/unknown_key_bundle.json"] = resign({**u, "keyId": s.secondary_key_id}, key2)

    # --- jcs/ ---
    out["jcs/unsigned_envelope.json"] = u
    (ROOT / "jcs").mkdir(parents=True, exist_ok=True)
    (ROOT / "jcs" / "canonical_bytes.hex").write_text(canonical_bytes(u).hex() + "\n")
    out["jcs/valid_signature_bundle.json"] = valid
    out["jcs/invalid_signature_bundle.json"] = {**valid, "signature": flip_signature(valid["signature"])}
    modified_payload = json.loads(json.dumps(valid))
    modified_payload["payload"]["rules"][0]["action"] = "allow"
    modified_payload["payloadHash"] = payload_hash(modified_payload["payload"])  # hash fixed, signature stale
    out["jcs/modified_payload_bundle.json"] = modified_payload
    out["jcs/modified_expiry_bundle.json"] = {**valid, "expiresAt": "2030-06-01T00:00:00Z"}
    out["jcs/modified_bundle_version_bundle.json"] = {**valid, "bundleVersion": 4}
    out["jcs/modified_ruleset_id_bundle.json"] = {**valid, "rulesetId": "gd-m1-other-ruleset"}
    out["jcs/modified_key_id_bundle.json"] = {**valid, "keyId": s.secondary_key_id}
    out["jcs/invalid_payload_hash_bundle.json"] = resign({**u, "payloadHash": "0" * 64}, key1)

    for name, data in out.items():
        dump(name, data)

    trusted = {
        "frozenNow": FROZEN_NOW,
        "rulesetId": RULESET,
        "controlledHost": CONTROLLED_HOST,
        "highestAcceptedVersionForRollbackTest": 3,
        "trustedKeys": {s.signing_key_id: pub1},
        "rolloverKeys": {s.secondary_key_id: pub2},
        "note": "Public test keys only. Private keys are backend-only (env) and never ship in apps.",
    }
    dump("signing/trusted_keys.json", trusted)
    SignedRuleBundle.model_validate(valid, strict=True)
    return {"fixtures": sorted(out), "publicKeys": {s.signing_key_id: pub1, s.secondary_key_id: pub2}}


if __name__ == "__main__":
    print(json.dumps(main(), indent=2))
