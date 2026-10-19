"""Ed25519 rule bundle signing service.

Stage 4: Cryptographically signs rule bundles so native devices can verify
that blocking instructions are authentic and authorised by the Apollo backend.

Key management:
- Private key: loaded from RULE_SIGNING_PRIVATE_KEY env var (base64-encoded)
- Public key: derived from private key, served via endpoint for native clients
- If no key is configured, signing is disabled (bundles served unsigned for backward compat)
- Keypair generation: run `python -m services.rule_signing generate` to create a new pair

Signing protocol:
1. Backend serializes the rule bundle as canonical JSON (sorted keys, no whitespace)
2. Signs the canonical bytes with Ed25519
3. Attaches the base64-encoded signature to the bundle response
4. Native client verifies the signature against the pinned public key before any
   schema or version checks
"""
from __future__ import annotations

import base64
import json
import os

from dotenv import load_dotenv

load_dotenv()

# ── Key loading ───────────────────────────────────────────────────────────────

_private_key = None
_public_key = None
_public_key_b64: str | None = None
_signing_enabled = False


def _load_keys():
    """Load Ed25519 keypair from environment. Called once at module import."""
    global _private_key, _public_key, _public_key_b64, _signing_enabled

    raw_b64 = os.getenv("RULE_SIGNING_PRIVATE_KEY")
    if not raw_b64:
        return  # Signing disabled — bundles served unsigned

    try:
        from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
        from cryptography.hazmat.primitives.serialization import (
            Encoding,
            NoEncryption,
            PrivateFormat,
            PublicFormat,
        )

        raw_bytes = base64.b64decode(raw_b64)

        # Support both raw 32-byte seed and DER-encoded private key
        if len(raw_bytes) == 32:
            _private_key = Ed25519PrivateKey.from_private_bytes(raw_bytes)
        else:
            from cryptography.hazmat.primitives.serialization import load_der_private_key
            _private_key = load_der_private_key(raw_bytes, password=None)

        _public_key = _private_key.public_key()
        _public_key_b64 = base64.b64encode(
            _public_key.public_bytes(Encoding.Raw, PublicFormat.Raw)
        ).decode("ascii")
        _signing_enabled = True
    except Exception as exc:
        from core.config import logger
        logger.error("rule_signing_key_load_failed error=%s", exc)
        _signing_enabled = False


_load_keys()


# ── Public API ────────────────────────────────────────────────────────────────

def is_signing_enabled() -> bool:
    """Whether Ed25519 rule signing is configured and active."""
    return _signing_enabled


def get_public_key_b64() -> str | None:
    """Base64-encoded raw Ed25519 public key (32 bytes), or None if signing is disabled."""
    return _public_key_b64


def sign_bundle(bundle: dict) -> str | None:
    """Sign a rule bundle dict and return the base64-encoded Ed25519 signature.

    The signed content is the canonical JSON of the bundle (sorted keys, compact
    separators, UTF-8 encoded). The 'signature' key is NOT included in the signed
    content — it is added to the response after signing.

    Returns None if signing is disabled.
    """
    if not _signing_enabled or _private_key is None:
        return None

    # Canonical JSON: deterministic serialization for signature stability
    canonical = _canonical_json(bundle)
    signature = _private_key.sign(canonical)
    return base64.b64encode(signature).decode("ascii")


def verify_bundle_signature(bundle: dict, signature_b64: str) -> bool:
    """Verify a bundle's Ed25519 signature. For testing/admin use."""
    if _public_key is None:
        return False

    try:
        canonical = _canonical_json(bundle)
        signature = base64.b64decode(signature_b64)
        _public_key.verify(signature, canonical)
        return True
    except Exception:
        return False


def _canonical_json(bundle: dict) -> bytes:
    """Deterministic JSON serialization for signing.
    
    Removes the 'signature' key (if present) before serialization to ensure
    the signed content is independent of the signature itself.
    """
    to_sign = {k: v for k, v in bundle.items() if k != "signature"}
    return json.dumps(to_sign, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")


# ── CLI keypair generation ────────────────────────────────────────────────────

def generate_keypair() -> tuple[str, str]:
    """Generate a new Ed25519 keypair. Returns (private_key_b64, public_key_b64)."""
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

    private_key = Ed25519PrivateKey.generate()
    public_key = private_key.public_key()

    # Raw 32-byte seed for compact storage
    private_bytes = private_key.private_bytes_raw()
    public_bytes = public_key.public_bytes(Encoding.Raw, PublicFormat.Raw)

    return (
        base64.b64encode(private_bytes).decode("ascii"),
        base64.b64encode(public_bytes).decode("ascii"),
    )


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == "generate":
        priv, pub = generate_keypair()
        print("=== Ed25519 Rule Signing Keypair ===")
        print(f"Private key (base64, add to RULE_SIGNING_PRIVATE_KEY env var):")
        print(f"  {priv}")
        print(f"Public key (base64, pinned in native clients):")
        print(f"  {pub}")
        print(f"\nAdd to backend .env:")
        print(f"  RULE_SIGNING_PRIVATE_KEY={priv}")
    else:
        print("Usage: python -m services.rule_signing generate")
