import asyncio
import os
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")


async def main():
    from services.investigation_projector import project_committed_cases
    from services.higgins import repository as repo
    from core.db import db
    n = await project_committed_cases()
    print("projected:", n)
    rows = await db.investigation_cases.find({"deleted": False, "response_revision": {"$gt": 0}}, {"_id": 0, "owner_id": 1, "case_id": 1, "status": 1, "response_revision": 1, "patrol_projected_revision": 1, "accepted_commits": 1}).sort("created_at", -1).limit(3).to_list(3)
    for case in rows:
        turns = await repo.accepted_turns(case["owner_id"], case)
        print("case", case["case_id"], "status", case["status"], "rev", case["response_revision"],
              "projected", case.get("patrol_projected_revision"), "commits", len(case.get("accepted_commits") or []), "turns", len(turns))


asyncio.run(main())
