from __future__ import annotations

from motor.motor_asyncio import AsyncIOMotorDatabase


class ProviderCacheRepository:
    """provider_cache: keyed by sha256(sanitizedUrl). Stores verdict + TTL only."""

    def __init__(self, db: AsyncIOMotorDatabase):
        self._col = db["provider_cache"]

    async def ensure_indexes(self) -> None:
        await self._col.create_index("cacheKey", unique=True)

    async def get(self, cache_key: str) -> dict | None:
        return await self._col.find_one({"cacheKey": cache_key}, projection={"_id": 0})

    async def put(self, cache_key: str, doc: dict) -> None:
        await self._col.update_one({"cacheKey": cache_key}, {"$set": {**doc, "cacheKey": cache_key}}, upsert=True)
