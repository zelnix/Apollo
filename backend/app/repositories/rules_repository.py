"""Mongo collections: rule_bundles (full signed envelopes) + rule_versions (metadata)."""
from __future__ import annotations

from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorDatabase

from app.domain.models.rule_bundle import SignedRuleBundle


class RulesRepository:
    def __init__(self, db: AsyncIOMotorDatabase):
        self._bundles = db["rule_bundles"]
        self._versions = db["rule_versions"]

    async def ensure_indexes(self) -> None:
        await self._bundles.create_index([("rulesetId", 1), ("bundleVersion", -1)], unique=True)
        await self._versions.create_index([("rulesetId", 1), ("bundleVersion", -1)], unique=True)

    async def save(self, bundle: SignedRuleBundle) -> None:
        doc = bundle.model_dump()
        await self._bundles.insert_one({**doc, "_rulesetId": bundle.rulesetId})
        await self._versions.insert_one(
            {
                "rulesetId": bundle.rulesetId,
                "bundleVersion": bundle.bundleVersion,
                "keyId": bundle.keyId,
                "issuedAt": bundle.issuedAt,
                "expiresAt": bundle.expiresAt,
                "payloadHash": bundle.payloadHash,
                "ruleCount": len(bundle.payload.rules),
                "createdAt": datetime.now(timezone.utc).isoformat(),
            }
        )

    async def highest_version(self, ruleset_id: str) -> int | None:
        doc = await self._versions.find_one({"rulesetId": ruleset_id}, sort=[("bundleVersion", -1)], projection={"_id": 0})
        return doc["bundleVersion"] if doc else None

    async def latest(self, ruleset_id: str) -> SignedRuleBundle | None:
        doc = await self._bundles.find_one({"rulesetId": ruleset_id}, sort=[("bundleVersion", -1)], projection={"_id": 0, "_rulesetId": 0})
        return SignedRuleBundle.model_validate(doc) if doc else None

    async def versions(self, ruleset_id: str) -> list[dict]:
        cursor = self._versions.find({"rulesetId": ruleset_id}, projection={"_id": 0}).sort("bundleVersion", -1)
        return await cursor.to_list(1000)
