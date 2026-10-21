import asyncio, os
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")


async def main():
    c = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = c[os.environ["DB_NAME"]]
    cases = await db.investigation_cases.find({}, {"_id": 0, "case_id": 1, "status": 1, "response_revision": 1, "patrol_projected_revision": 1, "gates": 1, "created_at": 1, "owner_id": 1, "client_submission_id": 1}).sort("created_at", -1).limit(5).to_list(5)
    for x in cases:
        print("CASE", x)
    evs = await db.patrol_events.find({"investigation_case_id": {"$ne": None}}, {"_id": 0, "event_id": 1, "headline": 1, "state": 1, "what_happened": 1, "why": 1, "device_id": 1, "occurred_at": 1}).sort("occurred_at", -1).limit(5).to_list(5)
    for e in evs:
        print("EVENT", str(e)[:600])


asyncio.run(main())
