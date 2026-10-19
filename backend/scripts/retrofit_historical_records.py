"""Historical Investigation & Protection Record Retrofit — Migration Script.

Idempotent, repeatable migration that:
  1. Classifies all existing patrol_records using the approved taxonomy.
  2. Generates Higgins briefings for historical investigations.
  3. Deduplicates presentation records (marks duplicates, preserves source observations).
  4. Marks unverifiable records as legacy.
  5. Stores reassessment metadata without overwriting originals.

Usage:
  cd /app/backend && python scripts/retrofit_historical_records.py

The migration is safe to rerun — it uses $set operations and checks for existing
reassessments before overwriting. Original evidence and timestamps are never modified.
"""
from __future__ import annotations

import asyncio
import sys
from datetime import datetime, timezone

# Ensure backend modules are importable
sys.path.insert(0, "/app/backend")

from core.db import db, now_utc
from services.record_classification import (
    RecordClass,
    classify_record,
    build_reassessment,
    generate_higgins_briefing,
)


class MigrationStats:
    def __init__(self):
        self.records_reviewed = 0
        self.records_classified = 0
        self.records_reclassified = 0
        self.records_unchanged = 0
        self.briefings_generated = 0
        self.duplicates_marked = 0
        self.legacy_marked = 0
        self.errors = 0
        self.by_class: dict[str, int] = {}

    def report(self) -> dict:
        return {
            "records_reviewed": self.records_reviewed,
            "records_classified": self.records_classified,
            "records_reclassified": self.records_reclassified,
            "records_unchanged": self.records_unchanged,
            "briefings_generated": self.briefings_generated,
            "duplicates_marked": self.duplicates_marked,
            "legacy_marked": self.legacy_marked,
            "errors": self.errors,
            "by_class": self.by_class,
        }


async def classify_all_records(stats: MigrationStats, dry_run: bool = False) -> None:
    """Phase 1: Classify all patrol_records."""
    print("\n=== Phase 1: Classify Patrol Records ===")

    cursor = db.patrol_records.find({}, {"_id": 0}).batch_size(200)
    batch = []

    async for record in cursor:
        stats.records_reviewed += 1
        record_id = record.get("record_id")
        if not record_id:
            stats.errors += 1
            continue

        new_class = classify_record(record)
        old_class = record.get("record_class")

        stats.by_class[new_class] = stats.by_class.get(new_class, 0) + 1

        if old_class == new_class and record.get("reassessment"):
            stats.records_unchanged += 1
            continue

        reassessment = build_reassessment(
            record, new_class, datetime.now(timezone.utc)
        )

        if old_class and old_class != new_class:
            stats.records_reclassified += 1
        else:
            stats.records_classified += 1

        if new_class == "unverifiable_legacy":
            stats.legacy_marked += 1

        if not dry_run:
            batch.append({
                "filter": {"record_id": record_id},
                "update": {
                    "$set": {
                        "record_class": new_class,
                        "reassessment": reassessment,
                    }
                },
            })

            if len(batch) >= 100:
                await _flush_batch(batch)
                batch = []

    if batch and not dry_run:
        await _flush_batch(batch)

    print(f"  Reviewed: {stats.records_reviewed}")
    print(f"  Classified: {stats.records_classified}")
    print(f"  Reclassified: {stats.records_reclassified}")
    print(f"  Unchanged: {stats.records_unchanged}")
    print(f"  Legacy: {stats.legacy_marked}")
    print(f"  By class: {stats.by_class}")


async def generate_historical_briefings(stats: MigrationStats, dry_run: bool = False) -> None:
    """Phase 2: Generate Higgins briefings for historical records."""
    print("\n=== Phase 2: Generate Higgins Briefings ===")

    # Process records that have a classification but no briefing yet
    query = {
        "record_class": {"$exists": True, "$ne": None},
        "$or": [
            {"higgins_briefing": {"$exists": False}},
            {"higgins_briefing": None},
        ],
    }

    cursor = db.patrol_records.find(query, {"_id": 0}).batch_size(200)
    batch = []

    async for record in cursor:
        record_id = record.get("record_id")
        record_class = record.get("record_class")
        if not record_id or not record_class:
            continue

        briefing = generate_higgins_briefing(record, record_class)
        briefing["generated_at"] = datetime.now(timezone.utc).isoformat()
        stats.briefings_generated += 1

        if not dry_run:
            batch.append({
                "filter": {"record_id": record_id},
                "update": {"$set": {"higgins_briefing": briefing}},
            })

            if len(batch) >= 100:
                await _flush_batch(batch)
                batch = []

    if batch and not dry_run:
        await _flush_batch(batch)

    print(f"  Briefings generated: {stats.briefings_generated}")


async def deduplicate_presentation(stats: MigrationStats, dry_run: bool = False) -> None:
    """Phase 3: Mark duplicate presentation records.

    Finds records with the same logical_issue_key where one supersedes another
    and ensures duplicates are properly marked without deleting source observations.
    """
    print("\n=== Phase 3: Deduplicate Presentation ===")

    # Find all owners
    owners = await db.patrol_records.distinct("owner_id")

    for owner_id in owners:
        # Get all records grouped by logical_issue_key
        pipeline = [
            {"$match": {"owner_id": owner_id}},
            {"$sort": {"revision": -1}},
            {"$group": {
                "_id": "$logical_issue_key",
                "records": {"$push": {"record_id": "$record_id", "revision": "$revision",
                                       "record_class": "$record_class", "occurred_at": "$occurred_at",
                                       "raw_state": "$raw_state", "duplicate_of": "$duplicate_of"}},
                "count": {"$sum": 1},
            }},
            {"$match": {"count": {"$gt": 1}}},
        ]

        async for group in db.patrol_records.aggregate(pipeline):
            records = group["records"]
            if len(records) <= 1:
                continue

            # The latest revision is the canonical one
            latest = records[0]

            for older in records[1:]:
                if older.get("duplicate_of"):
                    continue  # Already marked

                # Only mark as duplicate if same resolution class
                if older.get("record_class") == latest.get("record_class"):
                    stats.duplicates_marked += 1
                    if not dry_run:
                        await db.patrol_records.update_one(
                            {"record_id": older["record_id"]},
                            {"$set": {
                                "duplicate_of": latest["record_id"],
                                "duplicate_reason": "superseded_by_later_revision",
                            }},
                        )

    print(f"  Duplicates marked: {stats.duplicates_marked}")


async def update_investigation_history(stats: MigrationStats, dry_run: bool = False) -> None:
    """Phase 4: Update investigation history entries with classification and briefing data."""
    print("\n=== Phase 4: Update Investigation History ===")

    cursor = db.higgins_investigation_history.find(
        {"retrofit_version": {"$exists": False}}, {"_id": 0}
    ).batch_size(100)

    updated = 0
    async for history in cursor:
        case_id = history.get("case_id")
        if not case_id:
            continue

        # Find the corresponding patrol record
        record = await db.patrol_records.find_one(
            {"investigation_case_id": case_id, "record_class": {"$exists": True}},
            {"_id": 0, "record_class": 1, "higgins_briefing": 1},
        )

        update_fields = {"retrofit_version": "v1", "retrofitted_at": now_utc()}
        if record:
            if record.get("record_class"):
                update_fields["record_class"] = record["record_class"]
            if record.get("higgins_briefing"):
                update_fields["higgins_briefing"] = record["higgins_briefing"]

        if not dry_run:
            await db.higgins_investigation_history.update_one(
                {"history_id": history["history_id"]},
                {"$set": update_fields},
            )
        updated += 1

    print(f"  Investigation history entries updated: {updated}")


async def ensure_indexes() -> None:
    """Ensure classification indexes exist."""
    await db.patrol_records.create_index([("record_class", 1)])
    await db.patrol_records.create_index([("owner_id", 1), ("record_class", 1)])
    await db.patrol_records.create_index([("owner_id", 1), ("record_class", 1), ("occurred_at", -1)])


async def _flush_batch(batch: list[dict]) -> None:
    """Execute a batch of update operations."""
    from pymongo import UpdateOne

    ops = [UpdateOne(item["filter"], item["update"]) for item in batch]
    if ops:
        await db.patrol_records.bulk_write(ops, ordered=False)


async def run_migration(dry_run: bool = False) -> dict:
    """Run the full migration pipeline."""
    stats = MigrationStats()

    print("=" * 60)
    print("Historical Investigation & Protection Record Retrofit")
    print(f"Mode: {'DRY RUN' if dry_run else 'LIVE'}")
    print(f"Started: {datetime.now(timezone.utc).isoformat()}")
    print("=" * 60)

    # Ensure indexes first
    await ensure_indexes()

    # Phase 1: Classify
    await classify_all_records(stats, dry_run)

    # Phase 2: Generate briefings
    await generate_historical_briefings(stats, dry_run)

    # Phase 3: Deduplicate
    await deduplicate_presentation(stats, dry_run)

    # Phase 4: Update investigation history
    await update_investigation_history(stats, dry_run)

    report = stats.report()
    report["completed_at"] = datetime.now(timezone.utc).isoformat()
    report["dry_run"] = dry_run

    print("\n" + "=" * 60)
    print("Migration Summary")
    print("=" * 60)
    for key, value in report.items():
        print(f"  {key}: {value}")

    # Store the migration report
    if not dry_run:
        await db.migration_reports.update_one(
            {"migration_id": "retrofit_v1"},
            {"$set": {**report, "migration_id": "retrofit_v1"}},
            upsert=True,
        )

    return report


if __name__ == "__main__":
    dry = "--dry-run" in sys.argv
    asyncio.run(run_migration(dry_run=dry))
