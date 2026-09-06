from __future__ import annotations

from motor.motor_asyncio import AsyncIOMotorDatabase


class ConfigRepository:
    """service_config: non-secret service configuration snapshot."""

    def __init__(self, db: AsyncIOMotorDatabase):
        self._col = db["service_config"]

    async def put(self, key: str, value: dict) -> None:
        await self._col.update_one({"key": key}, {"$set": {"key": key, "value": value}}, upsert=True)

    async def get(self, key: str) -> dict | None:
        doc = await self._col.find_one({"key": key}, projection={"_id": 0})
        return doc["value"] if doc else None
