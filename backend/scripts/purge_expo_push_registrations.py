"""One-time cleanup after moving to the managed push relay.

The old rows hold Expo tokens for a project this backend can no longer send to, and tokens are not
stored here any more. Removing them means those installations re-register on next app open (the app
registers on every launch) instead of looking like a destination that cannot be delivered to.
"""
import asyncio
import os

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv("/app/backend/.env")


async def main():
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ.get("DB_NAME", "test_database")]
    stale = await db.push_registrations.count_documents({"$or": [{"token": {"$exists": True}}, {"provider": "expo"}]})
    result = await db.push_registrations.delete_many({"$or": [{"token": {"$exists": True}}, {"provider": "expo"}]})
    print(f"stale Expo registrations: {stale}, removed: {result.deleted_count}")
    print("remaining:", await db.push_registrations.count_documents({}))


asyncio.run(main())
