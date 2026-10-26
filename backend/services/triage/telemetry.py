"""Triage outcome telemetry — "Limited by cause".

Every Triage evaluation (on the phone, or on the server for background items) reports its outcome and, when it
is Limited, the cause codes: reputation timeout, authorisation failure, provider unavailable, genuine
insufficient evidence, a moderate number-risk result, a rule execution error, and so on. Codes only — never a
link, number, message or any content. Read by the admin Triage page so decision policy is changed on evidence,
not on preview numbers that include test traffic.
"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Optional

from core.db import db, now_utc

COLLECTION = "triage_outcome_telemetry"
OUTCOMES = ("NO_THREAT_IDENTIFIED", "POSSIBLE_THREAT_IDENTIFIED", "LIMITED_UNABLE_TO_DETERMINE")
_CODE = re.compile(r"^[a-z][a-z0-9_]{1,59}$")
_GAP = re.compile(r"^[A-Z][A-Z0-9_]{1,59}$")


async def ensure_indexes() -> None:
    await db[COLLECTION].create_index([("at", -1)])
    await db[COLLECTION].create_index([("outcome", 1), ("at", -1)])

# Plain-English names for the admin report. An unknown cause is shown as its code.
CAUSE_LABELS: dict[str, str] = {
    "reputation_timeout": "Reputation lookup timed out",
    "reputation_offline": "Reputation service unreachable (no connection)",
    "reputation_server_error": "Reputation service error (5xx)",
    "reputation_rate_limited": "Reputation service rate-limited",
    "reputation_malformed": "Reputation answer unreadable",
    "reputation_provider_unavailable": "Reputation provider unavailable (no source answered)",
    "reputation_auth_failure": "Authorisation failure (401)",
    "reputation_forbidden": "Not allowed (403)",
    "reputation_rejected": "Lookup input rejected (4xx)",
    "reputation_not_configured": "Reputation provider not configured",
    "reputation_no_data": "Reputation provider had no data",
    "reputation_quota_exhausted": "Lookup allowance used up (quota)",
    "reputation_unavailable": "Reputation unavailable (cause not reported)",
    "insufficient_evidence": "Genuine insufficient evidence",
    "number_risk_moderate": "Moderate number-risk result",
    "rule_execution_error": "Rule execution error",
}


def causes_for(record: dict, reputation_failure: Optional[str] = None) -> list[str]:
    """Mirror of frontend src/domain/triage/limitedCause.ts limitedCauses() for server-side Triage. The failure
    kind recorded on the gap itself wins; `reputation_failure` is the caller's fallback."""
    if record.get("outcome") != "LIMITED_UNABLE_TO_DETERMINE":
        return []
    causes: list[str] = []
    for gap in record.get("coverageGaps") or []:
        code = gap.get("code", "")
        cause = (f"reputation_{gap.get('failure') or reputation_failure or 'unavailable'}" if code == "INTELLIGENCE_PROVIDER_UNAVAILABLE"
                 else "insufficient_evidence" if code == "INSUFFICIENT_EVIDENCE"
                 else "rule_execution_error" if code == "DETERMINISTIC_CHECK_ERROR"
                 else f"gap_{code.lower()}")
        if cause not in causes:
            causes.append(cause)
    return causes


def incomplete_codes(record: dict) -> list[str]:
    """Which checks didn't complete and how, for any outcome: "final_destination_nonexistent_domain",
    "reputation_timeout", "number_reputation_stale". Mirror of limitedCause.ts incompleteCodes()."""
    codes: list[str] = []
    for check in record.get("incompleteChecks") or []:
        code = f"{check.get('check')}_{'stale' if check.get('status') == 'stale' else check.get('failure') or 'unknown'}"
        if code not in codes:
            codes.append(code)
    return codes


async def record(device: Optional[dict], *, origin: str, source_type: str, outcome: str, causes: list[str],
                 gap_codes: list[str], catalogue_version: Optional[int] = None, lookup: Optional[dict] = None,
                 incomplete: Optional[list[str]] = None) -> None:
    """Store one outcome. Inputs are validated to codes; anything else is dropped, never stored."""
    if outcome not in OUTCOMES:
        return
    await db[COLLECTION].insert_one({
        "device_id": (device or {}).get("device_id"),
        # Lets the report separate real phones from web previews and mock adapters (test traffic).
        "platform": (device or {}).get("platform") or "server",
        "adapter_mode": (device or {}).get("adapter_mode") or "server",
        "origin": origin,
        "source_type": source_type if _CODE.match(source_type or "") else "unknown",
        "outcome": outcome,
        "causes": [c for c in causes if _CODE.match(c)][:10],
        "gap_codes": [g for g in gap_codes if _GAP.match(g)][:10],
        "incomplete": [c for c in (incomplete or []) if _CODE.match(c)][:10],
        "catalogue_version": catalogue_version,
        "lookup": lookup,
        "at": now_utc(),
    })


def _real_phones(match: dict) -> dict:
    return {**match, "platform": {"$in": ["ios", "android"]}, "adapter_mode": {"$ne": "mock"}}


async def limited_by_cause(start: Optional[datetime] = None, phones_only: bool = False) -> dict[str, Any]:
    """Outcome totals, Limited counts by cause and by source type, and how the reputation retry fared."""
    match: dict = {"at": {"$gte": start}} if start else {}
    if phones_only:
        match = _real_phones(match)
    coll = db[COLLECTION]
    outcomes = {row["_id"]: row["n"] async for row in coll.aggregate([{"$match": match}, {"$group": {"_id": "$outcome", "n": {"$sum": 1}}}])}
    limited = {**match, "outcome": "LIMITED_UNABLE_TO_DETERMINE"}
    by_cause = [(row["_id"]["cause"], row["_id"]["source"], row["n"]) async for row in coll.aggregate([
        {"$match": limited}, {"$unwind": {"path": "$causes", "preserveNullAndEmptyArrays": True}},
        {"$group": {"_id": {"cause": {"$ifNull": ["$causes", "not_reported"]}, "source": "$source_type"}, "n": {"$sum": 1}}},
        {"$sort": {"n": -1}}])]
    retries = {row["_id"] or "none": row["n"] async for row in coll.aggregate([
        {"$match": {**match, "lookup.check": {"$ne": None}}}, {"$group": {"_id": "$lookup.outcome", "n": {"$sum": 1}}}])}
    # "No threat found by available checks": what didn't complete, for any outcome.
    incomplete = [(row["_id"]["code"], row["_id"]["outcome"], row["n"]) async for row in coll.aggregate([
        {"$match": {**match, "incomplete.0": {"$exists": True}}}, {"$unwind": "$incomplete"},
        {"$group": {"_id": {"code": "$incomplete", "outcome": "$outcome"}, "n": {"$sum": 1}}}, {"$sort": {"n": -1}}])]
    return {"outcomes": {o: outcomes.get(o, 0) for o in OUTCOMES}, "total": sum(outcomes.values()),
            "by_cause": by_cause, "lookup_retries": retries, "incomplete": incomplete}
