import asyncio
import os
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")


async def main():
    from core.db import db
    case = await db.investigation_cases.find_one({"case_id": "cf8ff1a8-b953-46d8-8db1-81ae0178d0c2"}, {"_id": 0, "response": 0})
    print({k: v for k, v in (case or {}).items() if k in ("case_id", "status", "deleted", "response_revision", "patrol_projected_revision", "accepted_commits", "cleanup_status", "expires_at", "updated_at")})
    commits = await db.investigation_turn_commits.count_documents({"case_id": "cf8ff1a8-b953-46d8-8db1-81ae0178d0c2"})
    print("turn commits in db:", commits)
    ev = await db.patrol_events.find_one({"investigation_case_id": "cf8ff1a8-b953-46d8-8db1-81ae0178d0c2"}, {"_id": 0, "headline": 1, "state": 1, "what_happened": 1, "why": 1, "updated_at": 1})
    print("event:", str(ev)[:500])


asyncio.run(main())
