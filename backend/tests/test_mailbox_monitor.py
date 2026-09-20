"""Opt-in mailbox monitoring stores summaries only and is idempotent."""
from __future__ import annotations

import uuid
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.db import db, now_utc
from services import mailbox_monitor
from services.investigation import (HigginsAssessment, InvestigationEntities, InvestigationFinding,
                                    InvestigationResult, InvestigationSource)


@pytest.mark.asyncio
async def test_enabled_mailbox_monitor_is_summary_only_and_idempotent(monkeypatch):
    device_id = f"mailbox-{uuid.uuid4().hex}"
    raw_secret = "ONE-TIME-CODE-998877"
    message_id = uuid.uuid4().hex
    await db.gmail_connections.insert_one({"device_id": device_id, "monitoring_enabled": True,
                                           "refresh_token_enc": "test-only", "created_at": now_utc(), "updated_at": now_utc()})

    async def fake_scan(current_device: str):
        return [{"id": message_id, "from": "alerts@example.test", "subject": "Review sign-in",
                 "body": f"Use {raw_secret} only if you requested it.", "links": []}] if current_device == device_id else []

    assessment = InvestigationResult(assessment_id=uuid.uuid4().hex, risk="warning",
        entities=InvestigationEntities(), findings=[InvestigationFinding(status="suspicious", title="Unexpected code request", detail="A code was requested without authenticated context.", source_ids=["local-1"])],
        sources=[InvestigationSource(source_id="local-1", label="Apollo local analysis", status="inconclusive", detail="Unexpected verification-code wording.")],
        higgins=HigginsAssessment(headline="Verify the account independently", next_action="Open the official account and review sign-ins.",
            exact_response="An unexpected code request needs verification. Open the official account and review sign-ins.",
            what_was_found=["An unexpected code request was detected."], why_it_matters=["Codes can approve access."],
            could_not_establish=["Apollo could not authenticate the sender."], action_label="Review official account", action_kind="check_account"),
        technical_summary=[], processing={"raw_retained_by_apollo": False})

    async def fake_investigate(**_kwargs): return assessment
    async def no_push(_event): return None
    monkeypatch.setattr(mailbox_monitor.gmail, "scan_inbox", fake_scan)
    monkeypatch.setattr(mailbox_monitor, "investigate_message", fake_investigate)
    monkeypatch.setattr(mailbox_monitor, "push_owner_alert", no_push)

    await mailbox_monitor.monitor_enabled_mailboxes_once()
    await mailbox_monitor.monitor_enabled_mailboxes_once()
    events = await db.patrol_events.find({"device_id": device_id}, {"_id": 0}).to_list(10)
    assert len(events) == 1
    assert events[0]["state"] == "barking" and events[0]["verified_block"] is False
    assert raw_secret not in str(events[0])
    assert await db.mailbox_assessment_receipts.count_documents({"device_id": device_id}) == 1
    connection = await db.gmail_connections.find_one({"device_id": device_id}, {"_id": 0})
    assert connection["monitor_last_checked_at"] is not None
    assert connection.get("monitor_last_error_at") is None
    await db.gmail_connections.delete_many({"device_id": device_id})
    await db.patrol_events.delete_many({"device_id": device_id})
    await db.mailbox_assessment_receipts.delete_many({"device_id": device_id})