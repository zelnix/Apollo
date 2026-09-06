"""Ed25519 primitives + admin-token guard."""
from __future__ import annotations

import base64
import hashlib
import secrets

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from fastapi import Header, HTTPException

from app.core.settings import get_settings


def load_private_key(seed_b64: str) -> Ed25519PrivateKey:
    seed = base64.b64decode(seed_b64)
    if len(seed) != 32:
        raise ValueError("Ed25519 private seed must be 32 bytes")
    return Ed25519PrivateKey.from_private_bytes(seed)


def public_key_b64(private_key: Ed25519PrivateKey) -> str:
    raw = private_key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    return base64.b64encode(raw).decode("ascii")


def sign(private_key: Ed25519PrivateKey, message: bytes) -> str:
    return base64.b64encode(private_key.sign(message)).decode("ascii")


def verify(public_key_b64_value: str, message: bytes, signature_b64: str) -> bool:
    try:
        key = Ed25519PublicKey.from_public_bytes(base64.b64decode(public_key_b64_value))
        key.verify(base64.b64decode(signature_b64), message)
        return True
    except (InvalidSignature, ValueError):
        return False


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def require_admin(x_guarddog_admin_token: str = Header(default="")) -> None:
    if not secrets.compare_digest(x_guarddog_admin_token, get_settings().admin_token):
        raise HTTPException(status_code=401, detail="admin token required")
