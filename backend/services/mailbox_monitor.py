"""Opt-in mailbox monitor. Raw messages are request/task-memory only; Patrol stores summaries."""
from __future__ import annotations

import asyncio
import hashlib
import re
import uuid
from typing import Any

from core.config import logger
from core.db import db, now_utc
from core.models import PatrolEvent
from routers.push import push_owner_alert
from services import gmail
from services.intel import assess_indicator
from services.investigation import investigate_message

URL_RE = re.compile(r"(?i)\bhttps?://[^\s<>\]\[\"']+")
EMAIL_RE = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.I)
PHONE_RE = re.compile(r"(?<!\w)(?:\+?\d[\s().-]*){9,14}(?!\w)")


def _safe_summary(value: str) -> str:
    return PHONE_RE.sub("[phone]", EMAIL_RE.sub("[email]", URL_RE.sub("[link]", value[:400])))


async def _url_context(urls: list[str]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for url in urls[:5]:
        try:
            intel = await asyncio.wait_for(assess_indicator(url), timeout=12)
            rows.append({"url": url, "host": intel.host, "verdict": intel.verdict, "coverage": intel.coverage,
                         "threat_types": intel.threat_types, "redirect_chain": intel.redirect_chain, "final_url": intel.final_url})
        except Exception:
            rows.append({"url": url, "host": "unknown", "verdict": "unknown", "coverage": "none"})
    return rows


def _message_digest(provider: str, message_id: str) -> str:
    return hashlib.sha256(f"{provider}:{message_id}".encode()).hexdigest()


async def _assess(provider: str, device_id: str, message: dict[str, Any]) -> None:
    digest = _message_digest(provider, str(message.get("id", "")))
    key = {"provider": provider, "device_id": device_id, "message_digest": digest}
    if await db.mailbox_assessment_receipts.find_one(key, {"_id": 1}):
        return
    sender = str(message.get("from", ""))[:80]
    subject = str(message.get("subject", ""))[:500]
    body = str(message.get("body", ""))[:3500]
    text = f"{subject}\n{body}".strip()
    urls = list(dict.fromkeys([*URL_RE.findall(text), *[str(link.get("href", "")) for link in message.get("links", [])]]))[:10]
    local_state = "growling" if urls or re.search(r"(?i)urgent|verify|payment|password|code|invoice|account|transfer", text) else "resting"
    assessment = await investigate_message(sender=sender, text=text, urls=urls, claimed_brand=None,
        local_state=local_state, url_context=await _url_context(urls))
    if assessment.risk == "warning":
        suspicious = any(finding.status == "suspicious" for finding in assessment.findings)
        ts = now_utc()
        doc = {"event_id": uuid.uuid4().hex, "device_id": device_id, "category": "email",
               "state": "barking" if suspicious else "growling", "status": "active",
               "headline": f"{provider.title()}: {assessment.higgins.headline}",
               "what_happened": _safe_summary(assessment.higgins.what_was_found[0] if assessment.higgins.what_was_found else assessment.higgins.headline),
               "why": [finding.title for finding in assessment.findings[:6]], "what_to_do": assessment.higgins.next_action,
               "indicator_host": assessment.entities.links[0] if assessment.entities.links else None, "indicator_digest": None,
               "verified_block": False, "adapter_label": "Apollo purpose-limited mailbox monitor",
               "occurred_at": ts, "resolved_at": None, "enforcement_evidence": None,
               "supporting_references": [{"label": source.label, "url": source.url} for source in assessment.sources if source.url][:6],
               "created_at": ts, "updated_at": ts, "deleted_at": None}
        await db.patrol_events.insert_one(doc)
        await push_owner_alert(PatrolEvent.from_mongo(doc))
    await db.mailbox_assessment_receipts.update_one(key, {"$setOnInsert": {**key, "processed_at": now_utc()}}, upsert=True)


async def monitor_enabled_mailboxes_once() -> None:
    for provider, collection, scanner in (("gmail", db.gmail_connections, gmail.scan_inbox),):
        async for row in collection.find({"monitoring_enabled": True}, {"_id": 0, "device_id": 1}):
            try:
                messages = await scanner(row["device_id"])
                for message in messages[:10]:
                    await _assess(provider, row["device_id"], message)
                await collection.update_one({"device_id": row["device_id"]}, {"$set": {"monitor_last_checked_at": now_utc(),
                    "monitor_last_error_at": None, "monitor_last_error": None}})
            except Exception as exc:
                logger.warning("%s mailbox monitoring failed for one device: %s", provider, type(exc).__name__)
                await collection.update_one({"device_id": row["device_id"]}, {"$set": {"monitor_last_error_at": now_utc(),
                    "monitor_last_error": type(exc).__name__}})


async def mailbox_monitor_loop() -> None:
    while True:
        try:
            await monitor_enabled_mailboxes_once()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("mailbox monitor pass failed: %s", type(exc).__name__)
        await asyncio.sleep(15 * 60)