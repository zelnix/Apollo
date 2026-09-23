"""Registered read-only context tools available to ordinary Higgins chat only."""
from __future__ import annotations

from datetime import timedelta
from typing import Awaitable, Callable

from google.genai import types

from core.db import db, now_utc
from core.redaction import redact_investigation_secrets
from services import capability_registry, government_alerts
from services import patrol_records
from services.higgins import context as memory
from services.higgins import repository as repo


def _declaration(name: str, description: str) -> types.FunctionDeclaration:
    return types.FunctionDeclaration(name=name, description=description, parameters=types.Schema(type="OBJECT", properties={}))


DECLARATIONS = [
    _declaration("get_protection_summary", "Read the owner's current, non-stale Apollo protection summary."),
    _declaration("get_recent_cases", "Read bounded metadata and redacted summaries for the owner's recent investigation cases."),
    _declaration("get_last_relevant_outcome", "Read the owner's latest meaningful Patrol outcome."),
    _declaration("get_saved_reports", "Read bounded metadata and redacted summaries for the owner's saved reports."),
    _declaration("get_recent_patrol_outcomes", "Read the owner's latest meaningful Patrol outcomes."),
    _declaration("get_user_learning_preferences", "Read the owner's current learning preferences when recorded."),
    _declaration("get_new_scams_digest", "Read a bounded digest from configured recognised-government feeds."),
    _declaration("get_product_capabilities", "Read the authoritative product capability registry, configuration truth and latest device observation."),
    _declaration("get_gate_states", "Read current Gate states from the latest fresh device observation; missing observations remain unavailable."),
]
TOOLS = [types.Tool(function_declarations=DECLARATIONS)]


def _result(items: list[dict], provenance: list[str], *, observed_at=None, confidence: str = "high") -> dict:
    now = now_utc(); fresh = observed_at or now
    return {"status": "ok" if items else "none_found", "items": items, "provenance": provenance,
            "observedAt": fresh.isoformat() if hasattr(fresh, "isoformat") else str(fresh),
            "freshThrough": (now + timedelta(minutes=15)).isoformat(), "confidence": confidence,
            "note": "No matching owner-scoped record was found." if not items else "Secrets and raw evidence are excluded."}


async def protection(owner: str) -> dict:
    items = [item for item in await memory.current(owner) if item.category == "protection_state"][:3]
    return _result([{"summary": item.summary, "observedAt": item.observed_at.isoformat()} for item in items], ["device_observation"], observed_at=items[0].observed_at if items else None)


async def recent_cases(owner: str) -> dict:
    rows = await db.investigation_cases.find({"owner_id": owner, "deleted": False}, {"_id": 0, "case_id": 1, "status": 1, "gates": 1, "updated_at": 1, "accepted_commits": 1}).sort("updated_at", -1).limit(5).to_list(5)
    items = []
    for row in rows:
        turns = await repo.accepted_turns(owner, row); latest = max(turns, key=lambda turn: turn.committed_at) if turns else None
        items.append({"caseId": row["case_id"], "status": row["status"], "gates": row.get("gates", []), "updatedAt": row["updated_at"].isoformat(),
                      "summary": redact_investigation_secrets(latest.response.overview)[:400] if latest else "No completed answer yet."})
    return _result(items, ["investigation_case_store"], observed_at=rows[0]["updated_at"] if rows else None)


async def patrol(owner: str, *, one: bool = False) -> dict:
    limit = 1 if one else 5
    rows = [row for row in await patrol_records.current(owner, limit + 5) if row["category"] != "system"][:limit]
    items = [{"recordId": row["recordId"], "logicalIssueKey": row["logicalIssueKey"], "category": row["category"],
              "effectiveState": row["effectiveState"], "effectiveReason": row["effectiveReason"],
              "headline": redact_investigation_secrets(row["headline"])[:200], "summary": redact_investigation_secrets(row["summary"])[:400],
              "occurredAt": row["occurredAt"].isoformat() if hasattr(row["occurredAt"], "isoformat") else str(row["occurredAt"]),
              "observedBlockReference": row.get("observedBlockReference")} for row in rows]
    observed = rows[0]["occurredAt"] if rows else None
    return _result(items, ["authoritative_patrol_record_store"], observed_at=observed)


async def saved_reports(owner: str) -> dict:
    rows = await db.investigation_reports.find({"owner_id": owner}, {"_id": 0, "report_id": 1, "saved_at": 1, "report_ciphertext": 1}).sort("saved_at", -1).limit(5).to_list(5)
    items = []
    for row in rows:
        try:
            report = repo.dec_json(row["report_ciphertext"]); overview = redact_investigation_secrets(str(report.get("overview") or "Saved report"))[:400]
        except (ValueError, TypeError):
            overview = "Saved report"
        items.append({"reportId": row["report_id"], "savedAt": row["saved_at"].isoformat(), "summary": overview})
    return _result(items, ["encrypted_saved_report_store"], observed_at=rows[0]["saved_at"] if rows else None)


async def preferences(owner: str) -> dict:
    items = [item for item in await memory.current(owner) if item.category == "preference"][:10]
    learning_preferences = await db.learning_preferences.find_one({"owner_id": owner}, {"_id": 0, "owner_id": 0})
    values = [{"summary": item.summary, "observedAt": item.observed_at.isoformat()} for item in items]
    if learning_preferences: values.append({"learning": learning_preferences})
    return _result(values, ["owner_preference_store", "learning_preference_store"], observed_at=items[0].observed_at if items else learning_preferences.get("updatedAt") if learning_preferences else None)


async def scams(_owner: str) -> dict:
    value = await government_alerts.snapshot(5); items = [{"title": item["title"], "source": item["source"], "publishedAt": item.get("published_at").isoformat() if item.get("published_at") else None, "url": item["url"]} for item in value["items"]]
    statuses = [feed["status"] for feed in value["feeds"].values()]
    return _result(items, ["recognised_government_feed_cache"], confidence="high" if "fresh" in statuses else "medium")


async def product_capabilities(owner: str) -> dict:
    value = await capability_registry.product_capabilities(owner)
    return _result([value], ["authoritative_capability_registry"], observed_at=value["generatedAt"])


async def gate_states(owner: str) -> dict:
    value = await capability_registry.gate_states(owner)
    return _result(value["items"], ["authoritative_gate_registry", "fresh_device_observation"], observed_at=value["generatedAt"])


READERS: dict[str, Callable[[str], Awaitable[dict]]] = {
    "get_protection_summary": protection, "get_recent_cases": recent_cases,
    "get_last_relevant_outcome": lambda owner: patrol(owner, one=True), "get_saved_reports": saved_reports,
    "get_recent_patrol_outcomes": patrol, "get_user_learning_preferences": preferences, "get_new_scams_digest": scams,
    "get_product_capabilities": product_capabilities, "get_gate_states": gate_states,
}


async def execute(owner: str, name: str) -> dict:
    reader = READERS.get(name)
    if not reader:
        return {"status": "unknown_tool", "items": [], "provenance": [], "confidence": "low"}
    try:
        return await reader(owner)
    except Exception:  # noqa: BLE001 — context absence is explicit, never fabricated
        return {"status": "unavailable", "items": [], "provenance": [], "confidence": "low", "note": "This context source is unavailable."}