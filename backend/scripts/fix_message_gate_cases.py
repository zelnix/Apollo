"""One-off repair: investigation cases filed under the invalid gate "message".

/message/analyse used to open its cases with gate="message", which is not a member of the Gate
literal. Every such case failed validation on read (GET /api/investigations/{case_id} → HTTP 500),
so the person could never open the investigation behind those Threat cases. The endpoint now writes
"text" (or "email"); this rewrites the rows already stored.

Run: cd /app/backend && python scripts/fix_message_gate_cases.py
"""
import asyncio
import os

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

load_dotenv("/app/backend/.env")


async def main() -> None:
    client = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = client[os.environ.get("DB_NAME", "test_database")]
    before = await db.investigation_cases.count_documents({"gates": "message"})
    print(f"cases with gate 'message': {before}")
    if not before:
        return
    result = await db.investigation_cases.update_many({"gates": "message"}, {"$set": {"gates.$[gate]": "text"}},
                                                      array_filters=[{"gate": "message"}])
    after = await db.investigation_cases.count_documents({"gates": "message"})
    print(f"rewritten to 'text': {result.modified_count}; remaining: {after}")


if __name__ == "__main__":
    asyncio.run(main())
