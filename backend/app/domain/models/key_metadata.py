from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict

KeyStatus = Literal["active", "retired"]


class KeyMetadata(BaseModel):
    """Public, persist-safe key metadata. Private material never enters this model."""

    model_config = ConfigDict(extra="forbid")

    keyId: str
    algorithm: Literal["Ed25519"] = "Ed25519"
    publicKeyB64: str
    status: KeyStatus = "active"
    purpose: Literal["m1-test-signing"] = "m1-test-signing"
    introducedAt: str
    retiredAt: str | None = None
