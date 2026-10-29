"""One-off cleanup: hide the duplicate investigations the Check a Number loop created.

See services/loop_cleanup.py for the rule. Dry run by default; nothing is erased, and --undo restores.

Run: cd /app/backend && python scripts/remove_loop_duplicates.py            # show what would be hidden
     cd /app/backend && python scripts/remove_loop_duplicates.py --apply    # hide them
     cd /app/backend && python scripts/remove_loop_duplicates.py --undo     # restore them
Options: --gap SECONDS (default 120), --owner DEVICE_ID
"""
import argparse
import asyncio
import os
import sys

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
load_dotenv("/app/backend/.env")

from services import loop_cleanup  # noqa: E402


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--undo", action="store_true")
    parser.add_argument("--gap", type=int, default=loop_cleanup.DEFAULT_GAP_SECONDS)
    parser.add_argument("--owner")
    args = parser.parse_args()
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ.get("DB_NAME", "test_database")]
    if args.undo:
        print(await loop_cleanup.undo(db, args.owner))
        return
    print(("APPLIED " if args.apply else "DRY RUN ") + str(await loop_cleanup.run(db, apply=args.apply, gap_seconds=args.gap, owner=args.owner)))


if __name__ == "__main__":
    asyncio.run(main())
