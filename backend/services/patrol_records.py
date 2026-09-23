"""Immutable authoritative Patrol records and server-owned display projection."""
from __future__ import annotations

import hashlib
import hmac
import json
import uuid
from datetime import timedelta
from typing import Any

from core.config import URL_HMAC_SECRET
from core.db import db, now_utc
from core.models import PatrolEventIn

DISPLAY = {"resting": "resolved", "ears_up": "monitoring", "growling": "warning", "barking": "danger", "biting": "blocked", "sniffing": "monitoring"}


async def ensure_indexes() -> None:
    await db.patrol_records.create_index("record_id", unique=True)
    await db.patrol_records.create_index([("owner_id", 1), ("logical_issue_key", 1), ("revision", 1)], unique=True)
    await db.patrol_records.create_index([("owner_id", 1), ("source_event_id", 1), ("source_fingerprint", 1)], unique=True)
    await db.patrol_records.create_index([("owner_id", 1), ("occurred_at", -1)])


def _digest(value: str) -> str:
    return hmac.new(URL_HMAC_SECRET.encode(), value.encode(), hashlib.sha256).hexdigest()[:32]


def _issue_key(event: PatrolEventIn) -> str:
    anchor = event.investigation_case_id or event.scent_id or event.indicator_digest or event.indicator_host or event.claimed_brand or event.scenario or event.event_id
    return _digest(f"{event.device_id}:{event.category}:{anchor}")


def _fingerprint(event: PatrolEventIn, verified: bool) -> str:
    payload = event.model_dump(mode="json", exclude={"verified_block"})
    payload["verified_block"] = verified
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _effective(event: PatrolEventIn, verified: bool) -> tuple[str, str]:
    if event.state == "biting":
        return ("blocked", "fresh_packet_drop_evidence") if verified else ("danger", "unverified_block_claim_rejected")
    if event.status in {"resolved", "trusted"}:
        return "resolved", "recorded_resolution"
    return DISPLAY[event.state], "server_projection_of_recorded_outcome"


def _wire(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "recordId": row["record_id"], "logicalIssueKey": row["logical_issue_key"], "revision": row["revision"],
        "supersedes": row.get("supersedes"), "sourceEventId": row["source_event_id"], "sourceType": row["source_type"],
        "category": row["category"], "headline": row["headline"], "summary": row["summary"],
        "rawState": row["raw_state"], "effectiveState": row["effective_state"], "effectiveReason": row["effective_reason"],
        "observedBlockReference": row.get("observed_block_reference"), "assessmentReference": row.get("assessment_reference"),
        "investigationCaseId": row.get("investigation_case_id"), "scenarioContext": row.get("scenario_context"),
        "freshness": row["freshness"], "outageContext": row.get("outage_context"), "resolution": row.get("resolution"),
        "duplicateOf": row.get("duplicate_of"), "duplicateReason": row.get("duplicate_reason"),
        "occurredAt": row["occurred_at"], "updatedAt": row["created_at"], "event": row["event"],
    }


async def append(event: PatrolEventIn, verified: bool) -> dict[str, Any]:
    fingerprint, logical_key = _fingerprint(event, verified), _issue_key(event)
    replay = await db.patrol_records.find_one({"owner_id": event.device_id, "source_event_id": event.event_id, "source_fingerprint": fingerprint}, {"_id": 0})
    if replay:
        return replay
    latest = await db.patrol_records.find_one({"owner_id": event.device_id, "logical_issue_key": logical_key}, {"_id": 0}, sort=[("revision", -1)])
    revision = int((latest or {}).get("revision", 0)) + 1
    effective, reason = _effective(event, verified)
    duplicate = await db.patrol_records.find_one({"owner_id": event.device_id, "logical_issue_key": logical_key,
        "source_fingerprint": fingerprint, "occurred_at": {"$gte": event.occurred_at - timedelta(hours=24)}}, {"_id": 0}, sort=[("occurred_at", -1)])
    record_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"apollo-patrol-record:{event.device_id}:{logical_key}:{revision}:{fingerprint}"))
    evidence = event.enforcement_evidence.model_dump(mode="json") if event.enforcement_evidence else None
    row = {
        "record_id": record_id, "owner_id": event.device_id, "logical_issue_key": logical_key, "revision": revision,
        "supersedes": latest.get("record_id") if latest else None, "source_event_id": event.event_id,
        "source_fingerprint": fingerprint, "source_type": "investigation" if event.investigation_case_id else "device_enforcement" if evidence else "device_assessment",
        "category": event.category, "headline": event.headline, "summary": event.what_happened, "raw_state": event.state,
        "effective_state": effective, "effective_reason": reason,
        "observed_block_reference": evidence.get("evidence_id") if verified and evidence else None,
        "assessment_reference": event.event_id, "investigation_case_id": event.investigation_case_id,
        "scenario_context": {"scenario": event.scenario, "claimedBrand": event.claimed_brand, "indicatorHost": event.indicator_host},
        "freshness": {"observedAt": event.occurred_at, "projectedAt": now_utc(), "status": "current"},
        "outage_context": None, "resolution": {"status": event.status, "resolvedAt": event.resolved_at},
        "duplicate_of": duplicate.get("record_id") if duplicate and duplicate.get("source_event_id") != event.event_id else None,
        "duplicate_reason": "same_issue_and_payload_within_24h" if duplicate and duplicate.get("source_event_id") != event.event_id else None,
        "occurred_at": event.occurred_at, "created_at": now_utc(), "event": {**event.model_dump(mode="json"), "verified_block": verified},
    }
    try:
        await db.patrol_records.insert_one(dict(row))
    except Exception:
        winner = await db.patrol_records.find_one({"owner_id": event.device_id, "source_event_id": event.event_id, "source_fingerprint": fingerprint}, {"_id": 0})
        if winner:
            return winner
        raise
    return row


async def backfill_owner(owner: str, limit: int = 500) -> None:
    rows = await db.patrol_events.find({"device_id": owner, "deleted_at": None}, {"_id": 0}).sort("occurred_at", 1).limit(limit).to_list(limit)
    for row in rows:
        try:
            await append(PatrolEventIn.model_validate(row), bool(row.get("verified_block")))
        except (ValueError, TypeError):
            continue


async def current(owner: str, limit: int = 200) -> list[dict[str, Any]]:
    await backfill_owner(owner)
    rows = await db.patrol_records.find({"owner_id": owner, "duplicate_of": None}, {"_id": 0}).sort([("occurred_at", -1), ("revision", -1)]).limit(1000).to_list(1000)
    latest: dict[str, dict] = {}
    for row in rows:
        latest.setdefault(row["logical_issue_key"], row)
    return [_wire(row) for row in sorted(latest.values(), key=lambda value: value["occurred_at"], reverse=True)[:limit]]


async def timeline(owner: str, record_id: str) -> list[dict[str, Any]]:
    selected = await db.patrol_records.find_one({"owner_id": owner, "record_id": record_id}, {"_id": 0})
    if not selected:
        return []
    rows = await db.patrol_records.find({"owner_id": owner, "logical_issue_key": selected["logical_issue_key"]}, {"_id": 0}).sort("revision", 1).to_list(500)
    return [_wire(row) for row in rows]