from __future__ import annotations

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.domain.models.key_metadata import KeyMetadata


class KeyMetadataRepository:
    def __init__(self, db: AsyncIOMotorDatabase):
        self._col = db["key_metadata"]

    async def ensure_indexes(self) -> None:
        await self._col.create_index("keyId", unique=True)

    async def get(self, key_id: str) -> KeyMetadata | None:
        doc = await self._col.find_one({"keyId": key_id}, projection={"_id": 0})
        return KeyMetadata.model_validate(doc) if doc else None

    async def upsert(self, meta: KeyMetadata) -> None:
        await self._col.update_one({"keyId": meta.keyId}, {"$set": meta.model_dump()}, upsert=True)

    async def list_all(self) -> list[KeyMetadata]:
        docs = await self._col.find({}, projection={"_id": 0}).sort("introducedAt", 1).to_list(100)
        return [KeyMetadata.model_validate(d) for d in docs]

    async def set_status(self, key_id: str, status: str, retired_at: str | None) -> KeyMetadata | None:
        await self._col.update_one({"keyId": key_id}, {"$set": {"status": status, "retiredAt": retired_at}})
        return await self.get(key_id)
