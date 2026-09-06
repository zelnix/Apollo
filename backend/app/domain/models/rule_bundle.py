"""Signed rule bundle envelope.

Envelope (strict, extra fields forbidden):
  schemaVersion, rulesetId, bundleVersion, issuedAt, expiresAt, keyId,
  payload{rules[]}, payloadHash (sha256 hex of JCS(payload)),
  signature (base64 Ed25519 over JCS(envelope minus `signature`)).
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.domain.models.rule_entry import RuleEntry

SCHEMA_VERSION = "1.0"
_ISO_Z = "%Y-%m-%dT%H:%M:%SZ"


def parse_iso_z(value: str) -> datetime:
    from datetime import timezone

    return datetime.strptime(value, _ISO_Z).replace(tzinfo=timezone.utc)


def format_iso_z(value: datetime) -> str:
    return value.strftime(_ISO_Z)


class RulePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rules: list[RuleEntry] = Field(min_length=1, max_length=10_000)


class UnsignedRuleBundle(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schemaVersion: Literal["1.0"]
    rulesetId: str = Field(min_length=1, max_length=128, pattern=r"^[a-z0-9-]+$")
    bundleVersion: int = Field(ge=1, le=2**53 - 1, strict=True)
    issuedAt: str
    expiresAt: str
    keyId: str = Field(min_length=1, max_length=128, pattern=r"^[a-z0-9-]+$")
    payload: RulePayload
    payloadHash: str = Field(pattern=r"^[0-9a-f]{64}$")

    @field_validator("issuedAt", "expiresAt")
    @classmethod
    def _iso(cls, v: str) -> str:
        parse_iso_z(v)
        return v


class SignedRuleBundle(UnsignedRuleBundle):
    signature: str = Field(min_length=88, max_length=88)

    def unsigned_dict(self) -> dict:
        return self.model_dump(exclude={"signature"})


class SignRequest(BaseModel):
    """Administrative signing request. `confirm` is an explicit human confirmation, NOT access control
    (the admin token + GD_SIGNING_ENABLED + ruleset allow-list are the access controls)."""

    model_config = ConfigDict(extra="forbid")
    rulesetId: str = Field(pattern=r"^[a-z0-9-]+$")
    rules: list[RuleEntry] = Field(min_length=1)
    expiresAt: str | None = None
    keyId: str | None = None
    confirm: bool = False
    purpose: Literal["m1-controlled-test"] = "m1-controlled-test"

    @field_validator("expiresAt")
    @classmethod
    def _iso(cls, v: str | None) -> str | None:
        if v is not None:
            parse_iso_z(v)
        return v
