"""Idempotent, model-free projection of committed Higgins responses into Patrol.

One finding, one patrol record.  The projector takes a completed Magnum DI
investigation and ensures a single authoritative patrol event exists for it.

Indicators (indicator_host, claimed_brand, scenario) come exclusively from:
  1. The case's source_metadata captured at intake, or
  2. The ORIGINAL patrol event linked via client_submission_id.

We never extract metadata from Gemini's prose via regex.  If Apollo did not
record an indicator from actual intake/evidence, Patrol does not manufacture one.
"""
from __future__ import annotations

import uuid

from core.db import db, now_utc
from core.models import PatrolEvent
from core.redaction import redact_investigation_secrets
from routers.push import push_owner_alert
from services.higgins import repository as repo


# Gate → patrol category. Every gate Apollo can open must map to a category the patrol record
# accepts; an unmapped gate (e.g. "vision") previously failed validation and the case never reached
# the Threats screen at all.
GATE_CATEGORY: dict[str, str] = {
    "text": "message", "message": "message", "vision": "message", "screenshot": "message",
    "email": "email", "call": "call", "app": "app", "file": "file", "account": "account",
    "device": "device", "network": "connection", "connection": "connection",
    "link": "link", "site": "website", "website": "website", "family": "family",
}


def patrol_category(gate: str | None) -> str:
    return GATE_CATEGORY.get(gate or "", "message")


def _dog_state(response) -> str:
    if response.assessment == "no_concern_found_within_scope" and response.attention == "none":
        return "resting"
    if response.attention in ("urgent", "action_needed"):
        return "barking"
    return "growling"


async def _resolve_intake_metadata(case: dict) -> dict:
    """Resolve indicator metadata from real intake data — NOT from Gemini's prose.

    Priority:
      1. case.source_metadata  (set at investigation creation from the original submission)
      2. The original patrol event (linked via client_submission_id)
      3. Null — don't guess.
    """
    meta: dict = {"indicator_host": None, "claimed_brand": None, "scenario": None}

    # 1. Case-level source_metadata (captured at intake)
    source = case.get("source_metadata") or {}
    if source.get("indicator_host"):
        meta["indicator_host"] = source["indicator_host"]
    if source.get("claimed_brand"):
        meta["claimed_brand"] = source["claimed_brand"]
    if source.get("scenario"):
        meta["scenario"] = source["scenario"]

    # 2. Fall back to the original patrol event that triggered this investigation
    sub_id = case.get("client_submission_id")
    if sub_id and not meta["indicator_host"]:
        original = await db.patrol_events.find_one(
            {"event_id": sub_id, "deleted_at": None},
            {"_id": 0, "indicator_host": 1, "claimed_brand": 1, "scenario": 1},
        )
        if original:
            meta["indicator_host"] = meta["indicator_host"] or original.get("indicator_host")
            meta["claimed_brand"] = meta["claimed_brand"] or original.get("claimed_brand")
            meta["scenario"] = meta["scenario"] or original.get("scenario")

    return meta


async def project_committed_cases(limit: int = 100) -> int:
    query = {"deleted": False, "response_revision": {"$gt": 0}, "$expr": {"$gt": ["$response_revision", {"$ifNull": ["$patrol_projected_revision", 0]}]}}
    rows = await db.investigation_cases.find(query, {"_id": 0, "owner_id": 1, "case_id": 1, "gates": 1, "status": 1,
                                                       "response_revision": 1, "accepted_commits": 1, "created_at": 1, "updated_at": 1,
                                                       "client_submission_id": 1, "source_metadata": 1}).limit(limit).to_list(limit)
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
        category = patrol_category((case.get("gates") or ["text"])[0])
        findings = [redact_investigation_secrets(finding.text)[:400] for finding in response.findings[:6]]
        action = response.actions[0].instruction if response.actions else "Review the investigation details in Patrol."
        overview = redact_investigation_secrets(response.overview)

        # Resolve indicators from actual intake data — never from Gemini's prose
        indicators = await _resolve_intake_metadata(case)

        history_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"apollo-history:{case['owner_id']}:{case['case_id']}"))
        await db.higgins_investigation_history.update_one(
            {"owner_id": case["owner_id"], "history_id": history_id},
            {"$set": {"owner_id": case["owner_id"], "history_id": history_id, "case_id": case["case_id"], "case_start": case["created_at"],
                      "last_update": latest.committed_at, "status": "completed" if case.get("status") == "complete" else case.get("status", "active"),
                      "gates": case.get("gates", []), "attention": response.attention, "conclusion": overview[:600], "deleted": False,
                      "updated_at": now_utc()}, "$setOnInsert": {"created_at": now_utc()}}, upsert=True,
        )
        document = {
            "event_id": event_id, "device_id": case["owner_id"], "category": category, "state": state,
            "status": "resolved" if state == "resting" else "active", "headline": overview[:160],
            "what_happened": overview[:600], "why": findings or [redact_investigation_secrets(response.scope)[:400]],
            "what_to_do": redact_investigation_secrets(action)[:400],
            # Real intake metadata only — never manufactured from Gemini's prose
            "indicator_host": indicators["indicator_host"],
            "indicator_digest": None,
            "local_indicator": None,
            "verified_block": False,
            "adapter_label": "Magnum DI investigation",
            "occurred_at": latest.committed_at, "resolved_at": latest.committed_at if state == "resting" else None,
            "trust_allowed": False,
            "claimed_brand": indicators["claimed_brand"],
            "scenario": indicators["scenario"],
            "scent_id": None,
            "background": True, "investigation_case_id": case["case_id"],
            "client_submission_id": case.get("client_submission_id"),
            # Mark as server_projected so the frontend knows this has real investigation data
            "evidence_provenance": "server_projected",
            # Actual recorded source metadata from intake — NOT Gemini-inferred
            "source_metadata": case.get("source_metadata"),
            # Pipeline initiator for telemetry
            "initiator": case.get("initiator", "unknown"),
            "deleted_at": None, "created_at": now_utc(), "updated_at": now_utc(),
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


async def project_open_cases(limit: int = 100) -> int:
    """Give every investigation a patrol record as soon as it starts.

    An investigation started from Ask Higgins is a case the person should be able to find, follow and
    come back to — not something that only appears once Magnum DI has answered. This writes the same
    deterministic patrol event the committed projection later updates (same event_id), so there is one
    record per case throughout, never two.

    The placeholder states only what is true: Apollo is investigating. It carries no findings, no
    assessment and no conclusion — those exist only once a response has been validated and committed.
    """
    query = {"deleted": False, "$or": [{"response_revision": {"$exists": False}}, {"response_revision": 0}]}
    rows = await db.investigation_cases.find(query, {"_id": 0, "owner_id": 1, "case_id": 1, "gates": 1, "status": 1,
                                                 "created_at": 1, "updated_at": 1, "client_submission_id": 1,
                                                 "source_metadata": 1, "initiator": 1}).limit(limit).to_list(limit)
    projected = 0
    for case in rows:
        projected += 1 if await project_case_started(case) else 0
    return projected


async def project_case_started(case: dict) -> bool:
    """Write the "investigating" patrol record for one case. Idempotent; safe to call at creation."""
    # An investigation that began from an existing patrol event already has its record.
    if case.get("client_submission_id"):
        return False
    if case.get("response_revision"):
        return False
    existing = await db.patrol_events.find_one(
        {"device_id": case["owner_id"], "investigation_case_id": case["case_id"], "deleted_at": None},
        {"_id": 0, "event_id": 1})
    if existing:
        return False
    category = patrol_category((case.get("gates") or ["text"])[0])
    indicators = await _resolve_intake_metadata(case)
    event_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"apollo-patrol:{case['owner_id']}:{case['case_id']}"))
    document = {
        "event_id": event_id, "device_id": case["owner_id"], "category": category,
        # "sniffing": Apollo is looking. Not a finding, not an assessment.
        "state": "sniffing", "status": "active",
        "headline": "Apollo is investigating this",
        "what_happened": "Higgins has started an investigation. Nothing has been established yet.",
        "why": ["The investigation is still running."],
        "what_to_do": "Nothing to do right now. Higgins will tell you as soon as the investigation finishes.",
        "indicator_host": indicators["indicator_host"], "indicator_digest": None, "local_indicator": None,
        "verified_block": False, "adapter_label": "Magnum DI investigation",
        "occurred_at": case.get("created_at") or now_utc(), "resolved_at": None, "trust_allowed": False,
        "claimed_brand": indicators["claimed_brand"], "scenario": indicators["scenario"], "scent_id": None,
        "background": True, "investigation_case_id": case["case_id"], "client_submission_id": None,
        "evidence_provenance": "server_projected", "source_metadata": case.get("source_metadata"),
        "initiator": case.get("initiator", "unknown"), "deleted_at": None, "updated_at": now_utc(),
    }
    created_at = now_utc()
    await db.patrol_events.update_one(
        {"device_id": case["owner_id"], "event_id": event_id},
        {"$set": document, "$setOnInsert": {"created_at": created_at}}, upsert=True)
    return True
