"""Persist completed Triage Investigations.

Every outcome — No Threat, Possible Threat, Limited — becomes one Patrol History
record carrying the full deterministic record (rules applicable, rules checked,
results, evidence, coverage gaps, retries, correlation, outcome and reason).
"""
from __future__ import annotations

import uuid

from core.db import db, now_utc
from services.triage import telemetry
from services.triage.catalogue import LIMITED_CAUTION, gap_plain
from services.triage.completeness import AVAILABLE_CHECKS, incomplete_plain
from services.triage.contract import Outcome, TriageInvestigation

COLLECTION = "triage_investigations"

_STATE = {Outcome.NO_THREAT: "resting", Outcome.LIMITED: "ears_up", Outcome.POSSIBLE_THREAT: "growling"}
_HEADLINE = {
    Outcome.NO_THREAT: "Triage: no threat identified",
    Outcome.LIMITED: "Triage: limited — ApolloSG couldn't reach a reliable decision",
    Outcome.POSSIBLE_THREAT: "Triage: possible threat identified",
}
_HEADLINE_INCOMPLETE = f"Triage: {AVAILABLE_CHECKS[0].lower()}{AVAILABLE_CHECKS[1:]}"


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
    incomplete = investigation.incomplete_checks
    saved = await db[COLLECTION].update_one(
        {"device_id": device_id, "investigation_id": investigation.investigation_id},
        {"$set": {"device_id": device_id, "investigation_id": investigation.investigation_id,
                  "category": category, "subject": subject[:200], "record": wire,
                  "outcome": investigation.outcome.value, "evaluated_at": investigation.evaluated_at or now_utc(),
                  "investigation_case_id": investigation_case_id, "updated_at": now_utc()},
         "$setOnInsert": {"created_at": now_utc()}}, upsert=True)
    if saved.upserted_id:
        # Once per evaluation (this save is idempotent): outcome and cause codes for the "Limited by cause" report.
        device = await db.devices.find_one({"device_id": device_id}, {"_id": 0, "device_id": 1, "platform": 1, "adapter_mode": 1})
        await telemetry.record(device or {"device_id": device_id}, origin="server", source_type=wire["sourceType"],
                               outcome=wire["outcome"], causes=telemetry.causes_for(wire),
                               gap_codes=[g["code"] for g in wire["coverageGaps"]], catalogue_version=wire["catalogueVersion"],
                               incomplete=telemetry.incomplete_codes(wire))

    event_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"apollo-triage:{device_id}:{investigation.investigation_id}"))
    state = _STATE[investigation.outcome]
    gaps = investigation.coverage_gaps
    why = [record.title for record in investigation.met_rules][:4] or [
        f"Checked {len(wire['rulesChecked'])} deterministic rule(s); none were met."]
    if gaps:
        # Plain English here (Overview, Higgins); the codes stay in `triage_investigation` for the DI view.
        why.append("Couldn't check: " + " ".join(gap_plain(gap.code) for gap in gaps))
    if incomplete:
        why.append("Not completed: " + " ".join(incomplete_plain(c) for c in incomplete))
    no_threat = investigation.outcome is Outcome.NO_THREAT
    document = {
        "event_id": event_id, "device_id": device_id, "category": category, "state": state,
        "status": "resolved" if no_threat else "active",
        "headline": _HEADLINE_INCOMPLETE if no_threat and incomplete else _HEADLINE[investigation.outcome],
        "what_happened": investigation.reason[:600],
        "why": why,
        "what_to_do": (("Proceed with normal care — not every check Apollo needed completed." if incomplete
                        else "Nothing to do — Apollo found no deterministic threat.") if no_threat
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
