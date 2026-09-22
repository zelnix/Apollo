"""Owner-curated scam-safety learning catalogue; article bodies remain server-side."""
from __future__ import annotations

import re
from datetime import timedelta
from typing import Any

from core.db import db, now_utc
from services import government_alerts

SOURCE_URLS = ["https://www.scamwatch.gov.au/types-of-scams", "https://www.cyber.gov.au/protect-yourself"]
GROUP_ACTIONS = {
    "Everyday scams": ["Pause before acting on urgency.", "Contact the organisation through a number or address you find yourself.", "Use Check It for the exact message, link or request."],
    "Messages and email": ["Do not reply or use the supplied link.", "Check the sender and destination separately.", "Keep verification codes and passwords private."],
    "Calls and impersonation": ["End the call if you feel pressured.", "Call back through an independently verified number.", "Do not install remote-access software for an unexpected caller."],
    "Shopping and payments": ["Check the seller outside the advertisement.", "Use a payment method with dispute protection.", "Do not pay with gift cards, cryptocurrency or an unexpected bank transfer."],
    "Accounts and identity": ["Open the provider's app or type its address yourself.", "Change reused passwords from a trusted device.", "Contact the provider's official recovery team promptly."],
    "Devices, apps and networks": ["Install apps only from the official store or provider.", "Review permissions before approving them.", "Use mobile data or a trusted network for sensitive work."],
    "After an incident": ["Stop further payments and contact your bank quickly.", "Keep safe copies of receipts and messages.", "Report the incident through the relevant official service."],
}
SEEDS = [
    ("urgency-and-pressure", "Urgency and pressure", "Everyday scams", "Why a demand to act immediately is a warning sign."),
    ("too-good-to-be-true", "Offers that seem too good to be true", "Everyday scams", "How prizes, investments and bargains are used to lower your guard."),
    ("verify-independently", "How to verify a request independently", "Everyday scams", "A safe way to contact an organisation without using supplied details."),
    ("keeping-codes-private", "Keeping security codes private", "Everyday scams", "Why one-time codes, PINs and recovery phrases must stay private."),
    ("trusted-family-check", "Ask a trusted person before acting", "Everyday scams", "How a second opinion can break the pressure of a scam."),
    ("scam-texts", "Spotting scam text messages", "Messages and email", "Common warning signs in parcel, toll, bank and account-alert texts."),
    ("phishing-email", "Spotting phishing email", "Messages and email", "How to check unexpected email without trusting its links or attachments."),
    ("fake-invoice", "Fake invoices and payment changes", "Messages and email", "How criminals change bank details or imitate a supplier."),
    ("dangerous-links", "What makes a link dangerous", "Messages and email", "How misleading addresses and redirects can hide the real destination."),
    ("unexpected-attachments", "Unexpected attachments", "Messages and email", "Why even familiar-looking files deserve a separate check."),
    ("bank-impersonation", "Bank impersonation calls", "Calls and impersonation", "What to do when a caller claims money or an account is at risk."),
    ("government-impersonation", "Government impersonation", "Calls and impersonation", "How threats about tax, police or immigration are used to create fear."),
    ("remote-access-call", "Remote-access support scams", "Calls and impersonation", "Why unexpected callers should never control your device."),
    ("caller-id-spoofing", "Caller ID can be copied", "Calls and impersonation", "Why a familiar number is not proof of who is calling."),
    ("family-emergency-call", "Family emergency impersonation", "Calls and impersonation", "How to verify an urgent request that appears to come from family."),
    ("fake-online-store", "Fake online stores", "Shopping and payments", "How copied shops, rushed discounts and unusual payment methods mislead buyers."),
    ("marketplace-scam", "Online marketplace scams", "Shopping and payments", "How to deal safely with buyers, sellers and payment links."),
    ("investment-scam", "Investment scams", "Shopping and payments", "Why high returns, celebrity claims and private chat groups need caution."),
    ("romance-payment", "Romance and friendship payment requests", "Shopping and payments", "How trust can be built before repeated money requests begin."),
    ("gift-card-crypto", "Gift card and cryptocurrency demands", "Shopping and payments", "Why unusual irreversible payment methods are a serious warning."),
    ("account-alert", "Unexpected account alerts", "Accounts and identity", "How to check a login or recovery warning without using its link."),
    ("password-reuse", "What to do about a reused password", "Accounts and identity", "A practical order for changing important accounts safely."),
    ("identity-document", "Protecting identity documents", "Accounts and identity", "How to limit copies of licences, passports and identity numbers."),
    ("sim-swap", "Phone number and SIM takeover", "Accounts and identity", "Warning signs when calls or messages suddenly stop working."),
    ("recovery-contact", "Use official account recovery", "Accounts and identity", "How to avoid fake recovery services and sponsored impostor results."),
    ("unsafe-app-permissions", "Unsafe app permissions", "Devices, apps and networks", "How to question access to messages, accessibility, microphone and contacts."),
    ("fake-security-app", "Fake security and cleaner apps", "Devices, apps and networks", "Why alarming pop-ups should not choose an app for you."),
    ("public-wifi", "Using public Wi-Fi more safely", "Devices, apps and networks", "When to switch to mobile data and avoid sensitive activity."),
    ("qr-code-scam", "QR code scams", "Devices, apps and networks", "How a printed or emailed code can lead to an unexpected destination."),
    ("device-warning", "Unexpected device warnings", "Devices, apps and networks", "How to separate real system settings from scareware and browser pop-ups."),
    ("contact-bank", "Contact your bank after a scam", "After an incident", "Why speed matters and what information your bank may need."),
    ("secure-accounts", "Secure important accounts", "After an incident", "A calm order for passwords, sessions, recovery details and multi-factor security."),
    ("preserve-evidence", "Keep useful evidence safely", "After an incident", "What to retain without continuing contact with the scammer."),
    ("report-scam", "Where to report a scam", "After an incident", "How official reporting can support recovery and warn others."),
    ("recover-confidence", "Recovering confidence after a scam", "After an incident", "Why being targeted is not your fault and how to rebuild safer habits."),
]


def _article(seed: tuple[str, str, str, str]) -> dict[str, Any]:
    slug, title, group, summary = seed; actions = GROUP_ACTIONS[group]
    body = f"{summary}\n\nScammers rely on a believable story and a moment of pressure. A familiar name, number or logo is not proof by itself. Stop and check the request through a separate, trusted path.\n\nWhat to do\n\n" + "\n".join(f"• {item}" for item in actions) + "\n\nIf money, an account or identity information may already be affected, contact the relevant provider through its official app, statement or independently found website. Apollo can help explain the next step, but it does not replace your bank, service provider or emergency services."
    return {"slug": slug, "title": title, "summary": summary, "group": group, "tags": [word.lower() for word in re.findall(r"[A-Za-z]+", title)[:4]],
            "risk_context": group, "related_topics": [], "source_urls": SOURCE_URLS, "source_names": ["Scamwatch", "Australian Cyber Security Centre"],
            "source_type": "owner_curated", "published_at": now_utc(), "updated_at": now_utc(), "review_after": now_utc() + timedelta(days=180),
            "evidence_quality": "official_guidance", "body": body, "published": True, "deleted_at": None}


async def ensure_indexes() -> None:
    await db.learning_articles.create_index("slug", unique=True)
    await db.learning_articles.create_index([("published", 1), ("group", 1), ("title", 1)])
    for seed in SEEDS:
        article = _article(seed)
        await db.learning_articles.update_one({"slug": article["slug"]}, {"$setOnInsert": article}, upsert=True)
    await db.learning_feed_runs.create_index([("feed_id", 1), ("checked_at", -1)])


def _summary(row: dict) -> dict:
    return {key: row.get(key) for key in ("slug", "title", "summary", "group", "tags", "risk_context", "related_topics", "source_urls", "source_names", "source_type", "published_at", "updated_at", "review_after", "evidence_quality")}


async def list_articles(group: str | None, search: str | None, cursor: str | None, limit: int) -> dict:
    query: dict[str, Any] = {"published": True, "deleted_at": None}
    if group:
        query["group"] = group
    if search:
        safe = re.escape(search.strip()[:80]); query["$or"] = [{"title": {"$regex": safe, "$options": "i"}}, {"summary": {"$regex": safe, "$options": "i"}}, {"tags": {"$regex": safe, "$options": "i"}}]
    if cursor:
        query["slug"] = {"$gt": cursor}
    rows = await db.learning_articles.find(query, {"_id": 0, "body": 0}).sort("slug", 1).limit(limit + 1).to_list(limit + 1)
    return {"items": [_summary(row) for row in rows[:limit]], "next_cursor": rows[limit - 1]["slug"] if len(rows) > limit else None, "groups": list(GROUP_ACTIONS)}


async def get_article(slug: str) -> dict | None:
    row = await db.learning_articles.find_one({"slug": slug, "published": True, "deleted_at": None}, {"_id": 0})
    return row


async def refresh_feeds(feed_id: str | None = None) -> dict:
    selected = [feed_id] if feed_id else list(government_alerts.FEEDS)
    results = []
    for current in selected:
        cfg = government_alerts.FEEDS.get(current)
        if not cfg:
            results.append({"feed_id": current, "status": "unknown"}); continue
        await government_alerts.refresh_one(current, cfg)
        state = await db.government_feed_state.find_one({"feed_id": current}, {"_id": 0})
        results.append({"feed_id": current, "status": "ok" if state and state.get("last_success_at") else "unavailable", "checked_at": state.get("checked_at") if state else now_utc()})
        await db.learning_feed_runs.insert_one({"feed_id": current, "checked_at": now_utc(), "result": results[-1]})
    return {"feeds": results}