"""Hides the duplicate investigations the Check a Number render loop created (2026-10-29).

call-guard.tsx rebuilt InvestigationFlow's submissionId on every render, so one check of a number
opened a new case every few seconds. Each case left a Higgins history entry and a background Patrol
event (Threat history). This hides the copies; nothing is erased:
  * Call Gate entries for the same number within `gap_seconds` of the previous entry are one check,
    and the FIRST entry of each check is kept;
  * hidden history rows get deleted=True, hidden Patrol events get deleted_at, and their Patrol
    records are marked duplicate_of the kept record, all tagged REMOVED_REASON so `undo` restores them;
  * devices drop their local copies through GET /api/patrol/removed.
"""
from __future__ import annotations

from datetime import timedelta
from typing import Any, Iterable

from pymongo import UpdateMany, UpdateOne

from core.db import now_utc

REMOVED_REASON = "duplicate_investigation_loop"
DEFAULT_GAP_SECONDS = 120


def plan_removals(cases: Iterable[dict], material_by_case: dict[str, str], gap_seconds: int = DEFAULT_GAP_SECONDS) -> dict[str, str]:
    """Return {hidden_case_id: kept_case_id}. Cases whose material is unknown are never grouped.

    In each check, the first case that still shows in history is kept (else the first case), so a check
    already listed never swaps to a different entry."""
    groups: dict[tuple, dict[str, dict]] = {}
    for case in cases:
        material = material_by_case.get(case.get("case_id"))
        if material:
            groups.setdefault((case["owner_id"], tuple(case.get("gates") or []), material), {})[case["case_id"]] = case
    gap = timedelta(seconds=gap_seconds)
    hidden: dict[str, str] = {}
    for by_id in groups.values():
        bursts: list[list[dict]] = []
        previous = None
        for case in sorted(by_id.values(), key=lambda c: c["case_start"]):
            if previous is None or case["case_start"] - previous > gap:
                bursts.append([])
            bursts[-1].append(case)
            previous = case["case_start"]
        for burst in bursts:
            kept = min(burst, key=lambda c: (not c.get("in_history"), c["case_start"]))["case_id"]
            hidden.update({c["case_id"]: kept for c in burst if c["case_id"] != kept})
    return hidden


async def run(db: Any, *, apply: bool, gap_seconds: int = DEFAULT_GAP_SECONDS, owner: str | None = None) -> dict[str, int]:
    # Every looped case left a history entry, a background Patrol event, or both — gather both.
    history_match: dict = {"deleted": False, "gates": "call"}
    event_match: dict = {"deleted_at": None, "category": "call", "investigation_case_id": {"$ne": None}}
    if owner:
        history_match["owner_id"] = owner
        event_match["device_id"] = owner
    in_history = set(await db.higgins_investigation_history.distinct("case_id", history_match))
    case_ids = list(in_history | set(await db.patrol_events.distinct("investigation_case_id", event_match)))
    cases: list[dict] = []
    material: dict[str, str] = {}
    async for case in db.investigation_cases.find({"case_id": {"$in": case_ids}}, {"_id": 0, "case_id": 1, "owner_id": 1, "gates": 1, "created_at": 1, "source_metadata.preview": 1}):
        cases.append({"case_id": case["case_id"], "owner_id": case["owner_id"], "gates": case.get("gates") or [],
                      "case_start": case["created_at"], "in_history": case["case_id"] in in_history})
        preview = (case.get("source_metadata") or {}).get("preview")
        if preview:
            material[case["case_id"]] = preview
    hidden = plan_removals(cases, material, gap_seconds)
    events = await db.patrol_events.find({"investigation_case_id": {"$in": list(hidden)}, "deleted_at": None},
                                         {"_id": 0, "event_id": 1, "investigation_case_id": 1}).to_list(None)
    hidden_history = [case_id for case_id in hidden if case_id in in_history]
    summary = {"cases_seen": len(cases), "checks_kept": len(cases) - len(hidden),
               "history_hidden": len(hidden_history), "patrol_events_hidden": len(events)}
    if apply and hidden:
        now = now_utc()
        if hidden_history:
            await db.higgins_investigation_history.bulk_write([
                UpdateOne({"case_id": case_id, "deleted": False},
                          {"$set": {"deleted": True, "removed_reason": REMOVED_REASON, "duplicate_of_case": hidden[case_id], "removed_at": now}})
                for case_id in hidden_history])
        if events:
            await db.patrol_events.bulk_write([
                UpdateOne({"event_id": event["event_id"], "deleted_at": None},
                          {"$set": {"deleted_at": now, "removed_reason": REMOVED_REASON, "duplicate_of_case": hidden[event["investigation_case_id"]]}})
                for event in events])
    summary["patrol_records_hidden"] = await _hide_records_of_removed_events(db, owner, apply)
    return summary


async def _hide_records_of_removed_events(db: Any, owner: str | None, apply: bool) -> int:
    """Every revision of a hidden event's Patrol record becomes a duplicate of the kept check's record
    (also repairs earlier runs, which marked only one revision per event)."""
    removed = await db.patrol_events.find({**({"device_id": owner} if owner else {}), "removed_reason": REMOVED_REASON},
                                          {"_id": 0, "event_id": 1, "duplicate_of_case": 1}).to_list(None)
    if not apply:
        return await db.patrol_records.count_documents({"source_event_id": {"$in": [e["event_id"] for e in removed]}, "duplicate_of": None})
    kept_events = {row["investigation_case_id"]: row["event_id"] for row in await db.patrol_events.find(
        {"investigation_case_id": {"$in": list({e["duplicate_of_case"] for e in removed})}, "deleted_at": None},
        {"_id": 0, "event_id": 1, "investigation_case_id": 1}).to_list(None)}
    kept_records: dict[str, str] = {}
    async for record in db.patrol_records.find({"source_event_id": {"$in": list(kept_events.values())}}, {"_id": 0, "record_id": 1, "source_event_id": 1}).sort("revision", -1):
        kept_records.setdefault(record["source_event_id"], record["record_id"])
    ops = [UpdateMany({"source_event_id": e["event_id"], "duplicate_of": None},
                      {"$set": {"duplicate_of": kept_records.get(kept_events.get(e["duplicate_of_case"], "")) or f"case:{e['duplicate_of_case']}",
                                "duplicate_reason": REMOVED_REASON}}) for e in removed]
    return (await db.patrol_records.bulk_write(ops)).modified_count if ops else 0


async def undo(db: Any, owner: str | None = None) -> dict[str, int]:
    scope = {"owner_id": owner} if owner else {}
    history = await db.higgins_investigation_history.update_many(
        {**scope, "removed_reason": REMOVED_REASON},
        {"$set": {"deleted": False}, "$unset": {"removed_reason": "", "duplicate_of_case": "", "removed_at": ""}})
    events = await db.patrol_events.update_many(
        {**({"device_id": owner} if owner else {}), "removed_reason": REMOVED_REASON},
        {"$set": {"deleted_at": None}, "$unset": {"removed_reason": "", "duplicate_of_case": ""}})
    records = await db.patrol_records.update_many(
        {**scope, "duplicate_reason": REMOVED_REASON}, {"$set": {"duplicate_of": None, "duplicate_reason": None}})
    return {"history_restored": history.modified_count, "patrol_events_restored": events.modified_count, "patrol_records_restored": records.modified_count}
