"""Signing + verification of rule bundles (Python side of the parity chain).

sign:   payloadHash = sha256(JCS(payload)); signature = Ed25519(JCS(unsigned envelope))
verify: schema -> payloadHash -> keyId known -> signature -> issued/expiry -> rollback
"""
from __future__ import annotations

import hashlib

from datetime import datetime, timedelta, timezone
from enum import Enum

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from pydantic import ValidationError

from app.core import security
from app.domain.models.rule_bundle import (
    SCHEMA_VERSION,
    RulePayload,
    SignedRuleBundle,
    UnsignedRuleBundle,
    format_iso_z,
    parse_iso_z,
)
from app.domain.models.rule_entry import RuleEntry
from app.services.jcs_canonicalization import canonical_bytes


class RejectReason(str, Enum):
    SCHEMA_INVALID = "SCHEMA_INVALID"
    PAYLOAD_HASH_MISMATCH = "PAYLOAD_HASH_MISMATCH"
    UNKNOWN_KEY = "UNKNOWN_KEY"
    SIGNATURE_INVALID = "SIGNATURE_INVALID"
    NOT_YET_VALID = "NOT_YET_VALID"
    EXPIRED = "EXPIRED"
    ROLLBACK = "ROLLBACK"
    VERSION_CONFLICT = "VERSION_CONFLICT"  # same bundleVersion as the accepted one, different authenticated signed envelope


class VerificationResult:
    def __init__(self, accepted: bool, reason: RejectReason | None = None, bundle: SignedRuleBundle | None = None, envelope_hash: str | None = None):
        self.accepted, self.reason, self.bundle, self.envelope_hash = accepted, reason, bundle, envelope_hash


def envelope_hash(bundle: SignedRuleBundle) -> str:
    """Identity of everything the signature covers: SHA-256 of the JCS canonical unsigned envelope (parity: Kotlin/Swift store this)."""
    return hashlib.sha256(canonical_bytes(bundle.unsigned_dict())).hexdigest()


def payload_hash(payload: RulePayload | dict) -> str:
    data = payload.model_dump() if isinstance(payload, RulePayload) else payload
    return security.sha256_hex(canonical_bytes(data))


def build_unsigned(
    *, ruleset_id: str, bundle_version: int, key_id: str, rules: list[RuleEntry], issued_at: datetime, expires_at: datetime
) -> UnsignedRuleBundle:
    payload = RulePayload(rules=rules)
    return UnsignedRuleBundle(
        schemaVersion=SCHEMA_VERSION,
        rulesetId=ruleset_id,
        bundleVersion=bundle_version,
        issuedAt=format_iso_z(issued_at),
        expiresAt=format_iso_z(expires_at),
        keyId=key_id,
        payload=payload,
        payloadHash=payload_hash(payload),
    )


def sign_unsigned(unsigned: UnsignedRuleBundle, private_key: Ed25519PrivateKey) -> SignedRuleBundle:
    signature = security.sign(private_key, canonical_bytes(unsigned.model_dump()))
    return SignedRuleBundle(**unsigned.model_dump(), signature=signature)


def sign_bundle(*, private_key: Ed25519PrivateKey, ttl_days: int, now: datetime | None = None, **kwargs) -> SignedRuleBundle:
    issued = now or datetime.now(timezone.utc)
    return sign_unsigned(build_unsigned(issued_at=issued, expires_at=issued + timedelta(days=ttl_days), **kwargs), private_key)


def verify_bundle(
    raw: dict,
    trusted_keys: dict[str, str],
    now: datetime,
    highest_accepted_version: int | None = None,
    highest_accepted_envelope_hash: str | None = None,
) -> VerificationResult:
    """Rollback semantics (identical on Kotlin/Swift): version < highest -> ROLLBACK; version > highest -> accepted; version == highest
    with the same envelope identity (or no recorded identity) -> accepted idempotently; version == highest with a different
    authenticated identity -> VERSION_CONFLICT."""
    try:
        bundle = SignedRuleBundle.model_validate(raw, strict=True)
    except ValidationError:
        return VerificationResult(False, RejectReason.SCHEMA_INVALID)
    if payload_hash(bundle.payload) != bundle.payloadHash:
        return VerificationResult(False, RejectReason.PAYLOAD_HASH_MISMATCH)
    public_key = trusted_keys.get(bundle.keyId)
    if public_key is None:
        return VerificationResult(False, RejectReason.UNKNOWN_KEY)
    if not security.verify(public_key, canonical_bytes(bundle.unsigned_dict()), bundle.signature):
        return VerificationResult(False, RejectReason.SIGNATURE_INVALID)
    if parse_iso_z(bundle.issuedAt) > now:
        return VerificationResult(False, RejectReason.NOT_YET_VALID)
    if parse_iso_z(bundle.expiresAt) <= now:
        return VerificationResult(False, RejectReason.EXPIRED)
    identity = envelope_hash(bundle)
    if highest_accepted_version is not None:
        if bundle.bundleVersion < highest_accepted_version:
            return VerificationResult(False, RejectReason.ROLLBACK)
        if bundle.bundleVersion == highest_accepted_version and highest_accepted_envelope_hash not in (None, identity):
            return VerificationResult(False, RejectReason.VERSION_CONFLICT)
    return VerificationResult(True, None, bundle, identity)
