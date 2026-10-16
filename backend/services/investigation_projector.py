"""Idempotent, model-free projection of committed Higgins responses into Patrol.

Fix: preserve indicator_host, claimed_brand, scenario from response findings
when available. Set evidence_provenance so the frontend can distinguish between
server-projected investigations (with real data) and truly incomplete events.
"""
from __future__ import annotations

import re
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


# ── Extract indicators from the investigation response ──────────────────────
# The response findings, overview and scope may contain domain names, email
# subjects, senders and claimed brands.  We extract these so the frontend can
# display "what was investigated" concretely.

_DOMAIN_RE = re.compile(r"\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|org|net|io|co|au|uk|gov|edu|info|biz|app|dev|me|xyz|online)\b", re.I)
_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_BRAND_KEYWORDS = re.compile(r"\b(?:posing as|impersonat|claiming to be|pretending to be|brand(?: name)?:)\s+[\"']?(\w[\w\s&'.,-]{1,60})[\"']?", re.I)


def _extract_indicators(response, gate: str) -> dict:
    """Extract indicator_host, claimed_brand and scenario from the investigation response."""
    all_text = " ".join([
        response.overview or "",
        response.scope or "",
        *(f.text for f in (response.findings or [])[:8]),
        *((a.instruction or "") for a in (response.actions or [])[:3]),
    ])

    # Extract domains
    domains = _DOMAIN_RE.findall(all_text)
    # Filter out common non-indicator domains
    skip = {"gmail.com", "google.com", "outlook.com", "yahoo.com", "hotmail.com",
            "example.com", "microsoft.com", "apple.com", "icloud.com"}
    indicator_domains = [d.lower() for d in domains if d.lower() not in skip]
    indicator_host = indicator_domains[0] if indicator_domains else None

    # Extract claimed brand
    brand_match = _BRAND_KEYWORDS.search(all_text)
    claimed_brand = brand_match.group(1).strip().rstrip(".,") if brand_match else None

    # Build a useful scenario from the investigation scope
    scenario = None
    if response.scope:
        scenario = redact_investigation_secrets(response.scope)[:200]

    return {
        "indicator_host": indicator_host,
        "claimed_brand": claimed_brand,
        "scenario": scenario or "shared_investigation",
    }


async def project_committed_cases(limit: int = 100) -> int:
    query = {"deleted": False, "response_revision": {"$gt": 0}, "$expr": {"$gt": ["$response_revision", {"$ifNull": ["$patrol_projected_revision", 0]}]}}
    rows = await db.investigation_cases.find(query, {"_id": 0, "owner_id": 1, "case_id": 1, "gates": 1, "status": 1,
                                                       "response_revision": 1, "accepted_commits": 1, "created_at": 1, "updated_at": 1,
                                                       "client_submission_id": 1}).limit(limit).to_list(limit)
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

        # Extract indicators from the investigation response
        indicators = _extract_indicators(response, gate)

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
            # Preserve indicators extracted from the investigation when available
            "indicator_host": indicators["indicator_host"],
            "indicator_digest": None,
            "local_indicator": None,
            "verified_block": False,
            "adapter_label": "Higgins investigation",
            "occurred_at": latest.committed_at, "resolved_at": latest.committed_at if state == "resting" else None,
            "trust_allowed": False,
            "claimed_brand": indicators["claimed_brand"],
            "scenario": indicators["scenario"],
            "scent_id": None,
            "background": True, "investigation_case_id": case["case_id"],
            "client_submission_id": case.get("client_submission_id"),
            # Mark as server_projected so the frontend knows this has real investigation data
            "evidence_provenance": "server_projected",
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
