"""Opt-in mailbox monitor using the same durable Higgins case engine as every Gate.

Raw messages exist only in Gmail response memory and encrypted temporary investigation evidence. Patrol keeps a
redacted summary; case retention/recovery is owned by the Higgins maintenance worker.
"""
from __future__ import annotations

import asyncio
import hashlib
import random
import re
import uuid
from datetime import timedelta
from typing import Any

from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from core.config import logger
from core.db import db, now_utc
from core.redaction import redact_investigation_secrets
from services import gmail
from services.higgins import evidence, jobs, repository as repo

URL_RE = re.compile(r"(?i)\bhttps?://[^\s<>\]\[\"']+")
EMAIL_RE = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.I)
PHONE_RE = re.compile(r"(?<!\w)(?:\+?\d[\s().-]*){9,14}(?!\w)")
SCAN_SECONDS = 15 * 60
PENDING_SECONDS = 20


def _safe_summary(value: str) -> str:
    protected = redact_investigation_secrets(value)
    return PHONE_RE.sub("[phone]", EMAIL_RE.sub("[email]", URL_RE.sub("[link]", protected)))[:400]


def _message_digest(provider: str, message_id: str) -> str:
    return hashlib.sha256(f"{provider}:{message_id}".encode()).hexdigest()


async def ensure_indexes() -> None:
    await db.mailbox_assessment_receipts.create_index([("provider", 1), ("device_id", 1), ("message_digest", 1)], unique=True)
    await db.mailbox_assessment_receipts.create_index([("state", 1), ("updated_at", 1)])
    await db.gmail_connections.create_index([("monitoring_enabled", 1), ("monitor_lease_until", 1)])


async def _submit_shared_case(provider: str, device_id: str, message: dict[str, Any], intake_mode: str) -> bool:
    digest = _message_digest(provider, str(message.get("id", "")))
    key = {"provider": provider, "device_id": device_id, "message_digest": digest}
    try:
        await db.mailbox_assessment_receipts.insert_one({**key, "state": "claimed", "intake_mode": intake_mode, "created_at": now_utc(), "updated_at": now_utc()})
    except DuplicateKeyError:
        pass
    receipt = await db.mailbox_assessment_receipts.find_one(key, {"_id": 0})
    if not receipt or receipt.get("state") in ("submitted", "complete", "failed"):
        return False
    sender = str(message.get("from", ""))
    subject = str(message.get("subject", ""))
    body = str(message.get("body", ""))
    links = message.get("links", []) if isinstance(message.get("links"), list) else []
    link_context = "\n".join(f"Displayed link text: {link.get('text', '')}\nActual destination: {link.get('href', '')}" for link in links if isinstance(link, dict))
    link_section = f"\n\nHTML link destinations:\n{link_context}" if link_context else ""
    text = f"From: {sender}\nSubject: {subject}\n\n{body}{link_section}".strip()
    case = await repo.create_case(device_id, "email", None)
    item = await evidence.ingest_text(device_id, case, f"mailbox-{digest}", text, label=f"{provider} message selected by ongoing monitoring")
    local_findings = []
    if URL_RE.search(text):
        local_findings.append("The email contains one or more links requiring sender and destination verification.")
    if re.search(r"(?i)urgent|verify|payment|password|code|invoice|account|transfer", text):
        local_findings.append("The email contains urgency, account, credential or payment language worth checking.")
    for index, finding in enumerate(local_findings):
        await evidence.ingest_text(device_id, case, f"mailbox-{digest}-finding-{index}", finding, origin="apollo_inference",
                                   label="Apollo background intake observation", coverage=evidence.Coverage(status="examined", unit="items", total=1, examined=1))
    turn_id = str(uuid.uuid4())
    payload = {"message": "Investigate this monitored email. Verify its sender, claims and every material link; explain one safe next action.",
               "answerToQuestionId": None, "evidenceIds": [item.id], "turnId": turn_id}
    job = await repo.create_job(device_id, case, turn_id, repo.digest(f"mailbox:{digest}"), repo.digest(str(payload)), "turn", payload)
    updated = await repo.cas(device_id, case["case_id"], {"revision": case["revision"], "active_job_id": None},
                             {"$set": {"status": "queued", "active_job_id": job["job_id"], "active_turn_id": turn_id}})
    if not updated:
        raise RuntimeError("mailbox case ownership conflict")
    await db.mailbox_assessment_receipts.update_one(key, {"$set": {"state": "submitted", "case_id": case["case_id"], "job_id": job["job_id"], "updated_at": now_utc()}})
    jobs.launch(device_id, case["case_id"], job["job_id"])
    return True


async def _finalise_receipt(receipt: dict) -> None:
    owner, case_id, job_id = receipt["device_id"], receipt["case_id"], receipt["job_id"]
    try:
        case = await repo.get_case(owner, case_id)
        job = await repo.get_job(owner, case_id, job_id)
    except Exception:
        await db.mailbox_assessment_receipts.update_one({"provider": receipt["provider"], "device_id": owner, "message_digest": receipt["message_digest"]},
                                                         {"$set": {"state": "failed", "failure": "temporary_case_unavailable", "updated_at": now_utc()}})
        return
    if job["status"] in ("queued", "investigating", "retry_wait", "waiting_device"):
        return
    selector = {"provider": receipt["provider"], "device_id": owner, "message_digest": receipt["message_digest"], "state": "submitted"}
    if not case.get("response_ciphertext"):
        if job["status"] in ("failed", "cancelled", "expired"):
            await db.mailbox_assessment_receipts.update_one(selector, {"$set": {"state": "failed", "failure": job["status"], "updated_at": now_utc()}})
        return
    await db.mailbox_assessment_receipts.update_one(selector, {"$set": {"state": "complete", "processed_at": now_utc(), "updated_at": now_utc()}})


async def finalise_pending_assessments() -> None:
    async for receipt in db.mailbox_assessment_receipts.find({"state": "submitted"}, {"_id": 0}).limit(100):
        await _finalise_receipt(receipt)


async def scan_gmail_through_shared_pipeline(device_id: str, intake_mode: str) -> dict:
    lease = str(uuid.uuid4()); now = now_utc()
    row = await db.gmail_connections.find_one_and_update(
        {"device_id": device_id, "$or": [{"monitor_lease_until": {"$lte": now}}, {"monitor_lease_until": {"$exists": False}}, {"monitor_lease_until": None}]},
        {"$set": {"monitor_lease": lease, "monitor_lease_until": now + timedelta(seconds=90), "monitor_last_attempt_at": now}},
        projection={"_id": 0, "monitor_next_page_token": 1},
        return_document=ReturnDocument.AFTER,
    )
    if row is None:
        return {"status": "busy", "checked": 0, "accepted": 0, "nextCursor": None}
    try:
        messages, next_cursor = await gmail.scan_inbox_page(device_id, row.get("monitor_next_page_token"))
        accepted = 0
        for message in messages:
            accepted += int(await _submit_shared_case("gmail", device_id, message, intake_mode))
        await db.gmail_connections.update_one({"device_id": device_id, "monitor_lease": lease}, {"$set": {
            "monitor_next_page_token": next_cursor, "monitor_last_checked_at": now_utc(), "monitor_last_success_at": now_utc(),
            "monitor_last_error_at": None, "monitor_last_error": None, "monitor_lease": None, "monitor_lease_until": None,
        }})
        return {"status": "accepted", "checked": len(messages), "accepted": accepted, "nextCursor": next_cursor}
    except Exception as exc:
        await db.gmail_connections.update_one({"device_id": device_id, "monitor_lease": lease}, {"$set": {
            "monitor_last_error_at": now_utc(), "monitor_last_error": type(exc).__name__, "monitor_lease": None, "monitor_lease_until": None,
        }})
        raise


async def monitor_enabled_mailboxes_once() -> None:
    async for row in db.gmail_connections.find({"monitoring_enabled": True, "refresh_token_enc": {"$exists": True}}, {"_id": 0, "device_id": 1}):
        try:
            await scan_gmail_through_shared_pipeline(row["device_id"], "monitored")
        except Exception as exc:  # noqa: BLE001
            logger.warning("gmail mailbox monitoring failed for one device: %s", type(exc).__name__)


async def mailbox_monitor_loop() -> None:
    loop = asyncio.get_running_loop(); next_scan = 0.0
    while True:
        try:
            await finalise_pending_assessments()
            if loop.time() >= next_scan:
                await monitor_enabled_mailboxes_once(); next_scan = loop.time() + SCAN_SECONDS
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            logger.warning("mailbox monitor pass failed: %s", type(exc).__name__)
        await asyncio.sleep(PENDING_SECONDS)


async def supervise_mailbox_monitor() -> None:
    failures = 0
    while True:
        try:
            await mailbox_monitor_loop()
            failures = 0
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # pragma: no cover - final ownership boundary
            failures += 1
            delay = min(60, 2 ** min(failures, 5)) + random.random()
            logger.error("mailbox monitor exited: %s; retrying in %.2fs", type(exc).__name__, delay)
            await asyncio.sleep(delay)