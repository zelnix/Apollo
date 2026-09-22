"""Idempotent, model-free projection of committed Higgins responses into Patrol."""
from __future__ import annotations

import uuid

from core.db import db, now_utc
from core.models import PatrolEvent
from core.redaction import redact_investigation_secrets
from routers.push import push_owner_alert
from services.higgins import repository as repo


def _dog_state(response) -> str:
    if response.assessment == "no_concern_found_within_scope" and response.attention == "none":
        return "resting"
    if response.attention in ("urgent", "action_needed"):
        return "barking"
    return "growling"


async def project_committed_cases(limit: int = 100) -> int:
    query = {"deleted": False, "response_revision": {"$gt": 0}, "$expr": {"$gt": ["$response_revision", {"$ifNull": ["$patrol_projected_revision", 0]}]}}
    rows = await db.investigation_cases.find(query, {"_id": 0, "owner_id": 1, "case_id": 1, "gates": 1,
                                                       "response_revision": 1, "accepted_commits": 1, "created_at": 1}).limit(limit).to_list(limit)
    projected = 0
    for case in rows:
        turns = await repo.accepted_turns(case["owner_id"], case)
        if not turns:
            continue
        latest = max(turns, key=lambda turn: turn.committed_at)
        response = latest.response
        state = _dog_state(response)
        existing = await db.patrol_events.find_one({"device_id": case["owner_id"], "investigation_case_id": case["case_id"], "deleted_at": None}, {"_id": 0, "event_id": 1})
        event_id = existing["event_id"] if existing else str(uuid.uuid5(uuid.NAMESPACE_URL, f"apollo-patrol:{case['owner_id']}:{case['case_id']}"))
        gate = (case.get("gates") or ["text"])[0]
        category = {"text": "message", "network": "connection", "file": "file", "link": "link", "site": "website"}.get(gate, gate)
        findings = [redact_investigation_secrets(finding.text)[:400] for finding in response.findings[:6]]
        action = response.actions[0].instruction if response.actions else "Review the investigation details in Patrol."
        overview = redact_investigation_secrets(response.overview)
        document = {
            "event_id": event_id, "device_id": case["owner_id"], "category": category, "state": state,
            "status": "resolved" if state == "resting" else "active", "headline": overview[:160],
            "what_happened": overview[:600], "why": findings or [redact_investigation_secrets(response.scope)[:400]],
            "what_to_do": redact_investigation_secrets(action)[:400], "indicator_host": None, "indicator_digest": None,
            "local_indicator": None, "verified_block": False, "adapter_label": "Higgins investigation",
            "occurred_at": latest.committed_at, "resolved_at": latest.committed_at if state == "resting" else None,
            "trust_allowed": False, "claimed_brand": None, "scenario": "shared_investigation", "scent_id": None,
            "background": True, "investigation_case_id": case["case_id"], "deleted_at": None, "created_at": now_utc(), "updated_at": now_utc(),
        }
        created_at = document.pop("created_at")
        upsert = await db.patrol_events.update_one({"device_id": case["owner_id"], "event_id": event_id}, {"$set": document, "$setOnInsert": {"created_at": created_at}}, upsert=True)
        if upsert.upserted_id and state != "resting":
            await push_owner_alert(PatrolEvent.from_mongo({**document, "created_at": created_at}))
        changed = await db.investigation_cases.update_one(
            {"owner_id": case["owner_id"], "case_id": case["case_id"], "response_revision": case["response_revision"],
             "$or": [{"patrol_projected_revision": {"$exists": False}}, {"patrol_projected_revision": {"$lt": case["response_revision"]}}]},
            {"$set": {"patrol_projected_revision": case["response_revision"], "patrol_projected_at": now_utc()}},
        )
        projected += changed.modified_count
    return projected