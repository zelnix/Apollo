"""Trusted signing keys by keyId. Private keys stay in process memory (from env)."""
from __future__ import annotations

from datetime import datetime, timezone

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from app.core import security
from app.core.settings import Settings
from app.domain.models.key_metadata import KeyMetadata
from app.domain.models.rule_bundle import format_iso_z
from app.repositories.key_metadata_repository import KeyMetadataRepository


class KeyRegistryService:
    def __init__(self, settings: Settings, repo: KeyMetadataRepository):
        self._repo = repo
        # Distribution-only deployments (CI builds, read replicas) hold no private material at all.
        self._private: dict[str, Ed25519PrivateKey] = {}
        if settings.signing_private_key_b64:
            self._private[settings.signing_key_id] = security.load_private_key(settings.signing_private_key_b64)
        if settings.secondary_key_id and settings.secondary_private_key_b64:
            self._private[settings.secondary_key_id] = security.load_private_key(settings.secondary_private_key_b64)
        self.default_key_id = settings.signing_key_id
        self._signing_enabled = settings.signing_enabled

    async def ensure_seeded(self) -> None:
        now = format_iso_z(datetime.now(timezone.utc))
        for key_id, private in self._private.items():
            if await self._repo.get(key_id) is None:
                await self._repo.upsert(
                    KeyMetadata(keyId=key_id, publicKeyB64=security.public_key_b64(private), introducedAt=now)
                )

    @property
    def can_sign(self) -> bool:
        """Signing requires the default key; a lone secondary key never enables signing/seeding."""
        return self._signing_enabled and self.default_key_id in self._private

    def private_key(self, key_id: str) -> Ed25519PrivateKey:
        try:
            return self._private[key_id]
        except KeyError as exc:
            raise KeyError(f"no private key for keyId '{key_id}' (distribution-only mode?)") from exc

    async def list_keys(self) -> list[KeyMetadata]:
        return await self._repo.list_all()

    async def trusted_public_keys(self) -> dict[str, str]:
        return {k.keyId: k.publicKeyB64 for k in await self._repo.list_all() if k.status == "active"}

    async def retire(self, key_id: str) -> KeyMetadata | None:
        return await self._repo.set_status(key_id, "retired", format_iso_z(datetime.now(timezone.utc)))
