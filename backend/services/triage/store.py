"""Persist completed Triage Investigations.

Every outcome — No Threat, Possible Threat, Limited — becomes one Patrol History
record carrying the full deterministic record (rules applicable, rules checked,
results, evidence, coverage gaps, retries, correlation, outcome and reason).
"""
from __future__ import annotations

import uuid

from core.db import db, now_utc
from services.triage.catalogue import LIMITED_CAUTION, gap_plain
from services.triage.contract import Outcome, TriageInvestigation

COLLECTION = "triage_investigations"

_STATE = {Outcome.NO_THREAT: "resting", Outcome.LIMITED: "ears_up", Outcome.POSSIBLE_THREAT: "growling"}
_HEADLINE = {
    Outcome.NO_THREAT: "Triage: no threat identified",
    Outcome.LIMITED: "Triage: limited — ApolloSG couldn't reach a reliable decision",
    Outcome.POSSIBLE_THREAT: "Triage: possible threat identified",
}


async def ensure_indexes() -> None:
    coll = db[COLLECTION]
    await coll.create_index([("device_id", 1), ("evaluated_at", -1)])
    await coll.create_index("investigation_id")


async def record_triage_history(device_id: str, investigation: TriageInvestigation, *,
                                category: str, subject: str = "", client_submission_id: str | None = None,
                                investigation_case_id: str | None = None,
                                indicator_host: str | None = None) -> str:
    """Save the Triage Investigation and project it into Patrol History (idempotent)."""
    wire = investigation.wire()
    await db[COLLECTION].update_one(
        {"device_id": device_id, "investigation_id": investigation.investigation_id},
        {"$set": {"device_id": device_id, "investigation_id": investigation.investigation_id,
                  "category": category, "subject": subject[:200], "record": wire,
                  "outcome": investigation.outcome.value, "evaluated_at": investigation.evaluated_at or now_utc(),
                  "investigation_case_id": investigation_case_id, "updated_at": now_utc()},
         "$setOnInsert": {"created_at": now_utc()}}, upsert=True)

    event_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"apollo-triage:{device_id}:{investigation.investigation_id}"))
    state = _STATE[investigation.outcome]
    gaps = investigation.coverage_gaps
    why = [record.title for record in investigation.met_rules][:4] or [
        f"Checked {len(wire['rulesChecked'])} deterministic rule(s); none were met."]
    if gaps:
        # Plain English here (Overview, Higgins); the codes stay in `triage_investigation` for the DI view.
        why.append("Couldn't check: " + " ".join(gap_plain(gap.code) for gap in gaps))
    document = {
        "event_id": event_id, "device_id": device_id, "category": category, "state": state,
        "status": "resolved" if investigation.outcome is Outcome.NO_THREAT else "active",
        "headline": _HEADLINE[investigation.outcome],
        "what_happened": investigation.reason[:600],
        "why": why,
        "what_to_do": ("Nothing to do — Apollo found no deterministic threat." if investigation.outcome is Outcome.NO_THREAT
                       else LIMITED_CAUTION if investigation.outcome is Outcome.LIMITED
                       else "Apollo is investigating this further."),
        "indicator_host": indicator_host, "indicator_digest": None, "local_indicator": None,
        "verified_block": False, "adapter_label": "Higgins Triage (deterministic)",
        "occurred_at": investigation.evaluated_at or now_utc(),
        "resolved_at": (investigation.evaluated_at or now_utc()) if investigation.outcome is Outcome.NO_THREAT else None,
        "trust_allowed": False, "claimed_brand": None, "scenario": None, "scent_id": None,
        "background": True, "investigation_case_id": investigation_case_id,
        "client_submission_id": client_submission_id,
        "evidence_provenance": "server_projected",
        "triage_investigation": wire,
        "initiator": "apollo_triage",
        "deleted_at": None, "updated_at": now_utc(),
    }
    await db.patrol_events.update_one({"device_id": device_id, "event_id": event_id},
                                      {"$set": document, "$setOnInsert": {"created_at": now_utc()}}, upsert=True)
    return event_id
