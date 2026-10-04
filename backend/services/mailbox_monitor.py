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
from fastapi import HTTPException

from core.config import logger
from core.db import db, now_utc
from core.redaction import redact_investigation_secrets
from services import gmail
from services.higgins import evidence, jobs, repository as repo
from urllib.parse import urlparse


def _extract_domain_from_email(email_str: str) -> str | None:
    """Extract the domain from an email address or From header like 'Name <user@domain.com>'."""
    import re as _re
    match = _re.search(r'[\w.+-]+@([\w.-]+)', email_str)
    return match.group(1).lower() if match else None


def _org_domain(domain: str) -> str:
    """Get the organizational domain (eTLD+1 approximation). For 'mail.example.com' → 'example.com'.
    For 'example.co.uk' → 'example.co.uk' (simplified: uses last 2 parts, or 3 for known 2-part TLDs)."""
    parts = domain.lower().rstrip(".").split(".")
    two_part_tlds = {"co.uk", "com.au", "co.nz", "co.za", "com.br", "co.jp", "co.kr", "org.uk", "net.au", "ac.uk"}
    if len(parts) >= 3 and ".".join(parts[-2:]) in two_part_tlds:
        return ".".join(parts[-3:])
    return ".".join(parts[-2:]) if len(parts) >= 2 else domain


def _domains_same_org(a: str, b: str) -> bool:
    """Check if two domains belong to the same organization (share the same eTLD+1)."""
    return _org_domain(a) == _org_domain(b)


def _find_domain_mismatches(sender_domain: str, links: list) -> set[str]:
    """Find link domains that don't match the sender's organization domain.
    Returns set of mismatched domains. Treats subdomains of the same org as equivalent."""
    mismatched = set()
    sender_org = _org_domain(sender_domain)
    for link in links:
        if not isinstance(link, dict):
            continue
        href = link.get("href", "")
        if not href:
            continue
        try:
            parsed = urlparse(href if "://" in href else f"https://{href}")
            host = (parsed.hostname or "").lower()
            if not host or host == sender_domain:
                continue
            # Skip common tracking/infrastructure domains that are not the actual destination
            tracking_domains = {"click.", "track.", "links.", "email.", "mail.", "e.", "go.", "t.", "l."}
            if any(host.startswith(p) for p in tracking_domains):
                continue
            link_org = _org_domain(host)
            if link_org != sender_org:
                mismatched.add(host)
        except Exception:
            continue
    return mismatched

URL_RE = re.compile(r"(?i)\bhttps?://[^\s<>\]\[\"']+")


async def _scan_attachments_vt(device_id: str, message: dict, provider: str) -> list[str]:
    """Scan email attachments via VirusTotal hash lookup. Returns list of finding strings.
    Non-blocking: failures or missing configuration produce informational messages, not errors."""
    from services.virustotal import VT_API_KEY
    if not VT_API_KEY:
        return []  # Not configured — silently skip (already reported by attachment risk flagging)
    attachment_names = message.get("attachment_names", [])
    if not attachment_names or not isinstance(attachment_names, list):
        return []
    message_id = message.get("id", "")
    if not message_id:
        return []
    findings: list[str] = []
    try:
        # Get attachment IDs from the Gmail message payload
        # Note: we need the raw message payload which isn't stored in our scan results.
        # The attachment data is fetched on-demand from Gmail API.
        from services.gmail import download_attachment, get_attachment_ids
        from services.virustotal import lookup_hash, compute_sha256

        # Reconstruct attachment info — re-fetch message metadata to get attachment IDs
        access_token = await gmail._access_token_for(device_id)
        import httpx
        async with httpx.AsyncClient(timeout=30) as http:
            resp = await http.get(
                f"{gmail.GMAIL_API}/messages/{message_id}",
                params={"format": "metadata", "metadataHeaders": ""},
                headers={"Authorization": f"Bearer {access_token}"},
            )
        if resp.status_code != 200:
            return []

        msg_data = resp.json()
        attachments = get_attachment_ids(msg_data.get("payload", {}))

        for att in attachments[:5]:  # Limit to 5 attachments per email (rate limit protection)
            try:
                file_bytes = await download_attachment(device_id, message_id, att["attachmentId"])
                if not file_bytes:
                    continue
                sha256 = compute_sha256(file_bytes)
                result = await lookup_hash(sha256, att["filename"])
                if result.status == "malicious":
                    names_str = f" ({', '.join(result.malware_names[:3])})" if result.malware_names else ""
                    findings.append(
                        f"Malware detected in attachment '{att['filename']}': "
                        f"{result.detection_count}/{result.total_engines} antivirus engines flagged this file{names_str}. "
                        f"Do not open this attachment."
                    )
                elif result.status == "suspicious":
                    findings.append(
                        f"Suspicious attachment '{att['filename']}': "
                        f"{result.detection_count}/{result.total_engines} engines flagged this file. "
                        f"Exercise caution — some engines may produce false positives."
                    )
                elif result.status == "unknown":
                    findings.append(
                        f"Attachment '{att['filename']}' is not in the VirusTotal malware database. "
                        f"This does not confirm it is safe — it means this file has not been previously analyzed."
                    )
                # "clean" and "error" results are not added as findings (clean is good news, error is non-actionable)
            except Exception as exc:
                logger.info("VT scan failed for attachment %s: %s", att.get("filename", "?"), type(exc).__name__)
    except Exception as exc:
        logger.info("VT attachment scanning failed for message %s: %s", message_id, type(exc).__name__)
    return findings

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
    if not receipt or receipt.get("state") in ("submitted", "complete"):
        return False
    # Temporary failures (e.g. "temporary_case_unavailable") are retryable — only permanent
    # terminal states ("complete") and active submissions ("submitted") are skipped.
    if receipt.get("state") == "failed":
        failure_reason = receipt.get("failure", "")
        terminal_failures = {"cancelled", "expired"}
        if failure_reason in terminal_failures:
            return False
        # Retryable failure: reset state to "claimed" and re-process
        await db.mailbox_assessment_receipts.update_one(key, {"$set": {"state": "claimed", "updated_at": now_utc()}})
    sender = str(message.get("from", ""))
    subject = str(message.get("subject", ""))
    body = str(message.get("body", ""))
    links = message.get("links", []) if isinstance(message.get("links"), list) else []
    # Preserve Reply-To and attachment filenames during intake where available
    reply_to = str(message.get("reply_to", "")) if message.get("reply_to") else ""
    attachment_names = message.get("attachment_names", []) if isinstance(message.get("attachment_names"), list) else []
    auth_results = message.get("auth_results", {}) if isinstance(message.get("auth_results"), dict) else {}
    link_context = "\n".join(f"Displayed link text: {link.get('text', '')}\nActual destination: {link.get('href', '')}" for link in links if isinstance(link, dict))
    link_section = f"\n\nHTML link destinations:\n{link_context}" if link_context else ""
    reply_section = f"\nReply-To: {reply_to}" if reply_to and reply_to != sender else ""
    attachment_section = f"\nAttachment filenames: {', '.join(attachment_names)}" if attachment_names else ""
    # #3: Include authentication evidence plainly
    auth_section = ""
    if auth_results:
        auth_lines = []
        for mech in ("spf", "dkim", "dmarc"):
            result = auth_results.get(mech, "unknown")
            if result in ("fail", "softfail", "permerror"):
                auth_lines.append(f"Sender authentication ({mech.upper()}): FAILED ({result})")
            elif result == "pass":
                auth_lines.append(f"Sender authentication ({mech.upper()}): passed")
            elif result != "unknown":
                auth_lines.append(f"Sender authentication ({mech.upper()}): {result}")
        if auth_lines:
            auth_section = "\n" + "\n".join(auth_lines)
    text = f"From: {sender}{reply_section}\nSubject: {subject}{auth_section}{attachment_section}\n\n{body}{link_section}".strip()

    # C1: Reconcile retries with existing case/job to prevent duplicate investigations.
    existing_case_id = receipt.get("case_id")
    existing_job_id = receipt.get("job_id")
    reuse_existing = False
    if existing_case_id and existing_job_id:
        try:
            existing_case = await repo.get_case(device_id, existing_case_id)
            existing_job = await repo.get_job(device_id, existing_case_id, existing_job_id)
            if existing_job["status"] in ("queued", "investigating", "retry_wait", "waiting_device"):
                await db.mailbox_assessment_receipts.update_one(key, {"$set": {"state": "submitted", "updated_at": now_utc()}})
                return True
            if existing_case.get("response_ciphertext"):
                await db.mailbox_assessment_receipts.update_one(key, {"$set": {"state": "complete", "processed_at": now_utc(), "updated_at": now_utc()}})
                return False
            reuse_existing = True
        except Exception:
            pass

    if reuse_existing and existing_case_id:
        case = await repo.get_case(device_id, existing_case_id)
    else:
        case = await repo.create_case(device_id, "email", None)
    item = await evidence.ingest_text(device_id, case, f"mailbox-{digest}", text, label=f"{provider} message selected by ongoing monitoring")
    local_findings = []
    if URL_RE.search(text):
        local_findings.append("The email contains one or more links requiring sender and destination verification.")
    if re.search(r"(?i)urgent|verify|payment|password|code|invoice|account|transfer", text):
        local_findings.append("The email contains urgency, account, credential or payment language worth checking.")

    # Email Gate: Sender/link domain mismatch detection
    sender_domain = _extract_domain_from_email(sender)
    if sender_domain and links:
        mismatched_domains = _find_domain_mismatches(sender_domain, links)
        if mismatched_domains:
            domains_str = ", ".join(sorted(mismatched_domains)[:5])
            local_findings.append(
                f"The sender's email address ({sender_domain}) and link destinations use different domains ({domains_str}). "
                "Verify the sender before opening the link or following payment instructions."
            )
    # Reply-To mismatch detection
    if reply_to:
        reply_domain = _extract_domain_from_email(reply_to)
        if reply_domain and sender_domain and not _domains_same_org(reply_domain, sender_domain):
            local_findings.append(
                f"The Reply-To address ({reply_to}) uses a different domain ({reply_domain}) from the sender ({sender_domain}). "
                "Replies will go to a different address than the one displayed."
            )
    # Authentication failure detection (#4)
    if auth_results:
        for mech in ("dmarc", "spf", "dkim"):
            result = auth_results.get(mech, "unknown")
            if result in ("fail", "softfail", "permerror"):
                local_findings.append(
                    f"Sender authentication failed ({mech.upper()}: {result}). "
                    "The sender's identity could not be authenticated by the email provider. "
                    "This does not prove fraud, but the sender could not be verified."
                )
                break  # one auth failure finding is enough
    # Attachment risk flagging (#5)
    risky_extensions = {".exe", ".scr", ".bat", ".cmd", ".com", ".pif", ".js", ".vbs", ".wsf",
                        ".msi", ".dll", ".hta", ".ps1", ".reg", ".lnk", ".iso", ".img", ".cab"}
    for name in attachment_names:
        ext = "." + name.rsplit(".", 1)[-1].lower() if "." in name else ""
        if ext in risky_extensions:
            local_findings.append(
                f"Risky attachment type: {name} ({ext}). This file type can execute code on your device. "
                "Apollo flagged the filename — attachment contents were not inspected."
            )

    # #7: Link reputation coverage reporting. Check each link against Safe Browsing + blocklist.
    # Explicitly report when checks could not be performed (unavailable) instead of defaulting to "clean".
    link_checked_count = 0
    link_unavailable_count = 0
    if links:
        from services.intel import run_intel_check, sanitize_url
        for link in links[:10]:  # limit to 10 links per email
            href = link.get("href", "") if isinstance(link, dict) else ""
            if not href:
                continue
            try:
                result = await run_intel_check("url", href)
                link_checked_count += 1
                if result.verdict == "malicious":
                    _, host = sanitize_url(href)
                    local_findings.append(
                        f"Link to {host} is listed as unsafe by reputation sources ({', '.join(result.threat_types)}). "
                        "Do not open this link."
                    )
                elif result.coverage in ("partial", "none"):
                    link_unavailable_count += 1
            except Exception:
                link_unavailable_count += 1
        if link_unavailable_count > 0:
            local_findings.append(
                f"Coverage limitation: {link_unavailable_count} of {link_checked_count + link_unavailable_count} "
                "link reputation checks could not be completed (Safe Browsing or blocklist unavailable). "
                "These links were not confirmed safe — they could not be checked."
            )
        elif link_checked_count > 0 and link_unavailable_count == 0:
            local_findings.append(
                f"Coverage: {link_checked_count} link{'s' if link_checked_count != 1 else ''} checked against "
                "Safe Browsing and Apollo's managed threat list — no current listings found. "
                "This checks known threats only; a clean result does not guarantee the destination is safe."
            )

    # #8: Authentication disclaimer. When auth_results are present (from Gmail API headers),
    # add a clear disclaimer that authentication confirms the sending domain, not the content.
    if auth_results and any(auth_results.get(m) == "pass" for m in ("spf", "dkim", "dmarc")):
        local_findings.append(
            "Sender authentication (SPF/DKIM/DMARC): passed. This confirms the email was sent from "
            "the claimed domain's authorised mail server. It does NOT confirm the email's content, "
            "intentions, or truthfulness. A legitimate domain can still send misleading content."
        )

    for index, finding in enumerate(local_findings):
        await evidence.ingest_text(device_id, case, f"mailbox-{digest}-finding-{index}", finding, origin="apollo_inference",
                                   label="Apollo background intake observation", coverage=evidence.Coverage(status="examined", unit="items", total=1, examined=1))
    # #6: VirusTotal hash-based malware scanning for attachments (non-blocking, best-effort).
    # Only runs when VIRUSTOTAL_API_KEY is configured. Uses hash-only mode — no file content leaves Apollo.
    vt_findings = await _scan_attachments_vt(device_id, message, provider)
    for vt_idx, vt_finding in enumerate(vt_findings):
        await evidence.ingest_text(device_id, case, f"mailbox-{digest}-vt-{vt_idx}", vt_finding, origin="apollo_inference",
                                   label="VirusTotal attachment scan", coverage=evidence.Coverage(status="examined", unit="items", total=1, examined=1))
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
        # Distinguish temporary backend unavailability from terminal failure. Use a "retry_failed"
        # state so the receipt remains eligible for re-processing by _submit_shared_case.
        await db.mailbox_assessment_receipts.update_one({"provider": receipt["provider"], "device_id": owner, "message_digest": receipt["message_digest"]},
                                                         {"$set": {"state": "failed", "failure": "temporary_case_unavailable", "retry_after": now_utc() + timedelta(minutes=5), "updated_at": now_utc()}})
        return
    if job["status"] in ("queued", "investigating", "retry_wait", "waiting_device"):
        return
    selector = {"provider": receipt["provider"], "device_id": owner, "message_digest": receipt["message_digest"], "state": "submitted"}
    if not case.get("response_ciphertext"):
        if job["status"] in ("failed", "cancelled", "expired"):
            await db.mailbox_assessment_receipts.update_one(selector, {"$set": {"state": "failed", "failure": job["status"], "updated_at": now_utc()}})
        return
    await db.mailbox_assessment_receipts.update_one(selector, {"$set": {"state": "complete", "processed_at": now_utc(), "updated_at": now_utc()}})
    # C2: Update the gmail connection's assessment timestamp
    try:
        await db.gmail_connections.update_one(
            {"device_id": owner},
            {"$set": {"monitor_last_assessment_at": now_utc()}}
        )
    except Exception:
        pass
    # Push notification is handled exclusively by the investigation projector:
    # project_committed_cases() creates a Patrol event from the completed case, and
    # push_owner_alert() fires for events with state >= growling. This eliminates the
    # duplicate push path that previously existed here (_send_assessment_push).


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
        exists = await db.gmail_connections.find_one({"device_id": device_id}, {"_id": 1})
        if exists is None:
            raise HTTPException(404, "Gmail is not connected")
        return {"status": "busy", "checked": 0, "accepted": 0, "nextCursor": None}
    try:
        messages, next_cursor = await gmail.scan_inbox_page(device_id, row.get("monitor_next_page_token"))
        accepted = 0
        for message in messages:
            accepted += int(await _submit_shared_case("gmail", device_id, message, intake_mode))
        # C2: Distinguish successful retrieval from completed assessment. `monitor_last_success_at`
        # now reflects RETRIEVAL success only. `monitor_last_assessment_at` tracks when assessments
        # actually complete (updated by finalise_pending_assessments). The Email Gate should check
        # BOTH timestamps — retrieval without assessment means the gate is degraded, not working.
        await db.gmail_connections.update_one({"device_id": device_id, "monitor_lease": lease}, {"$set": {
            "monitor_next_page_token": next_cursor, "monitor_last_checked_at": now_utc(),
            "monitor_last_retrieval_at": now_utc(),  # C2: renamed from monitor_last_success_at
            "monitor_last_success_at": now_utc(),    # kept for backward compat; gate must also check assessment
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