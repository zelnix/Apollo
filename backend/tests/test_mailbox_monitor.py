"""Opt-in mailbox monitoring uses durable Higgins cases and stores redacted Patrol summaries only."""
from __future__ import annotations

import sys
import uuid
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.db import now_utc
from services import mailbox_monitor
from services.higgins import repository as repo


async def test_enabled_mailbox_monitor_is_shared_summary_only_and_idempotent(monkeypatch):
    import core.db as core_db

    fresh_client = core_db.AsyncIOMotorClient(core_db.os.environ["MONGO_URL"])
    fresh_db = fresh_client[core_db.os.environ["DB_NAME"]]
    monkeypatch.setattr(mailbox_monitor, "db", fresh_db)
    monkeypatch.setattr(repo, "db", fresh_db)
    device_id = f"mailbox-{uuid.uuid4().hex}"; raw_secret = "ONE-TIME-CODE-998877"; message_id = uuid.uuid4().hex
    await mailbox_monitor.ensure_indexes()
    await fresh_db.gmail_connections.insert_one({"device_id": device_id, "monitoring_enabled": True,
                                           "refresh_token_enc": "test-only", "created_at": now_utc(), "updated_at": now_utc()})

    async def fake_scan(current_device: str, _cursor=None, email=None):
        messages = [{"id": message_id, "from": "alerts@example.test", "subject": "Review sign-in",
                     "body": f"Use {raw_secret} only if you requested it.", "links": []}] if current_device == device_id else []
        return messages, None

    monkeypatch.setattr(mailbox_monitor.gmail, "scan_inbox_page", fake_scan)
    monkeypatch.setattr(mailbox_monitor.jobs, "launch", lambda *_args: None)

    # Mock triage to return a suspicious verdict so the monitor escalates to investigation
    from unittest.mock import AsyncMock
    from types import SimpleNamespace
    fake_triage = AsyncMock(return_value=SimpleNamespace(
        should_escalate=True,
        tier=SimpleNamespace(value=3),
        verdict=SimpleNamespace(value="suspicious"),
        reason="Unexpected verification-code wording.",
        escalation_reason="Sender not authenticated.",
        cost_usd=0.0,
        cached=True,
        provider_evidence=None,
        providers_used=[],
    ))
    import services.triage_engine as _triage_mod
    monkeypatch.setattr(_triage_mod, "triage_item", fake_triage)

    await mailbox_monitor.monitor_enabled_mailboxes_once()
    receipt = await fresh_db.mailbox_assessment_receipts.find_one({"device_id": device_id}, {"_id": 0})
    assert receipt["state"] in ("submitted", "complete") and receipt["case_id"] and receipt["job_id"]
    response = {"revision": 1, "overview": "An unexpected code request needs independent verification.",
                "explanationMarkdown": "Open the official account and review sign-ins.", "assessment": "concern_found",
                "attention": "action_needed", "attentionReason": "The sender was not authenticated.",
                "findings": [{"id": "finding-1", "text": "Unexpected verification-code wording.", "basis": "observation", "confidence": "medium", "evidenceIds": [], "sourceIds": []}],
                "uncertainties": ["The sender identity remains unknown."], "scope": "Submitted email only.", "sourceIds": [],
                "remainingEvidenceIds": [], "actions": [{"id": "action-1", "kind": "instruction", "label": "Review official account",
                    "instruction": "Open the official account and review sign-ins.", "capabilityId": None, "executionDescriptorId": None,
                    "requiresUserGesture": True, "sourceIds": [], "desiredField": None, "desiredValue": None}],
                "recommendedActionId": "action-1", "question": None, "completion": "complete"}
    await fresh_db.investigation_cases.update_one({"owner_id": device_id, "case_id": receipt["case_id"]},
        {"$set": {"response_ciphertext": repo.enc_json(response), "response_revision": 1, "status": "complete", "active_job_id": None}})
    await fresh_db.investigation_jobs.update_one({"owner_id": device_id, "case_id": receipt["case_id"], "job_id": receipt["job_id"]},
                                            {"$set": {"status": "complete"}})

    await mailbox_monitor.finalise_pending_assessments(); await mailbox_monitor.monitor_enabled_mailboxes_once(); await mailbox_monitor.finalise_pending_assessments()
    cases = await fresh_db.investigation_cases.find({"owner_id": device_id}, {"_id": 0}).to_list(10)
    assert len(cases) == 1 and cases[0]["status"] == "complete"
    assert raw_secret not in str(cases)
    assert await fresh_db.mailbox_assessment_receipts.count_documents({"device_id": device_id}) == 1
    assert (await fresh_db.mailbox_assessment_receipts.find_one({"device_id": device_id}, {"_id": 0}))["state"] == "complete"
    await fresh_db.gmail_connections.delete_many({"device_id": device_id}); await fresh_db.patrol_events.delete_many({"device_id": device_id})
    await fresh_db.mailbox_assessment_receipts.delete_many({"device_id": device_id})
    fresh_client.close()