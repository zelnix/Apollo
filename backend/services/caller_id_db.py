"""Phone number reputation database for Live Caller ID Lookup.

Maintains a database of phone number → label/category mappings that:
1. Feeds the iOS Live Caller ID Lookup PIR server
2. Grows organically from IPQualityScore results (via call risk checks)
3. Exports in the format Apple's PIR server expects

The PIR protocol itself requires a separate server (Apple's reference Swift implementation).
This service manages the data that PIR server indexes.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Optional

from core.config import logger
from core.db import db, now_utc


# Live Caller ID label categories (Apple's CXCallDirectoryPhoneNumber + LiveCallerIDLookup)
LABEL_CATEGORIES = {
    "spam": "Likely spam",
    "fraud": "Suspected fraud",
    "telemarketer": "Telemarketer",
    "robocall": "Robocall",
    "scam": "Scam risk",
    "unknown_risk": "Unknown caller — elevated risk",
}


async def upsert_number(number: str, label: str, category: str, source: str,
                         fraud_score: Optional[int] = None, carrier: Optional[str] = None,
                         country: Optional[str] = None, line_type: Optional[str] = None,
                         voip: Optional[bool] = None) -> dict:
    """Insert or update a phone number reputation entry.
    Called automatically when a call risk check returns a non-allow result."""
    cleaned = _normalize_number(number)
    if not cleaned:
        return {}
    entry = {
        "number": cleaned,
        "label": label,
        "category": category,
        "source": source,
        "fraud_score": fraud_score,
        "carrier": carrier,
        "country": country,
        "line_type": line_type,
        "voip": voip,
        "updated_at": now_utc(),
    }
    result = await db.caller_id_numbers.update_one(
        {"number": cleaned},
        {"$set": entry, "$setOnInsert": {"created_at": now_utc()}},
        upsert=True,
    )
    return entry


async def remove_number(number: str) -> bool:
    """Remove a number from the reputation database (e.g., user override to allow)."""
    cleaned = _normalize_number(number)
    if not cleaned:
        return False
    result = await db.caller_id_numbers.delete_one({"number": cleaned})
    return result.deleted_count > 0


async def get_number(number: str) -> Optional[dict]:
    """Look up a single number in the reputation database."""
    cleaned = _normalize_number(number)
    if not cleaned:
        return None
    return await db.caller_id_numbers.find_one({"number": cleaned}, {"_id": 0})


async def export_for_pir(limit: int = 100000) -> list[dict]:
    """Export the reputation database in the format Apple's PIR server expects.
    Each entry: {phoneNumber: int64, label: str, category: str}

    Apple's PIR server indexes this data and serves it via the PIR protocol.
    The export should be run periodically (e.g., daily) and fed to the PIR server's
    data ingestion endpoint.
    """
    entries = []
    async for row in db.caller_id_numbers.find({}, {"_id": 0}).sort("updated_at", -1).limit(limit):
        phone_int = _to_int64(row["number"])
        if phone_int is None:
            continue
        entries.append({
            "phoneNumber": phone_int,
            "label": row.get("label", "Unknown caller"),
            "category": row.get("category", "unknown_risk"),
        })
    return entries


async def count() -> int:
    """Return the number of entries in the reputation database."""
    return await db.caller_id_numbers.count_documents({})


async def ingest_from_risk_check(number: str, risk_result: dict) -> None:
    """Ingest a call risk check result into the reputation database.
    Called automatically by the call risk check endpoint when a number is flagged."""
    decision = risk_result.get("decision", "allow")
    if decision == "allow":
        return  # Don't store clean numbers
    fraud_score = risk_result.get("fraud_score")
    label = "Scam risk" if decision == "avoid" else "Unknown caller — elevated risk"
    category = "fraud" if decision == "avoid" else "unknown_risk"
    if risk_result.get("recent_abuse"):
        label = "Reported for abuse"
        category = "spam"
    if risk_result.get("voip"):
        label = f"{label} (VOIP)"
    await upsert_number(
        number=number,
        label=label,
        category=category,
        source=risk_result.get("source", "ipqs"),
        fraud_score=fraud_score,
        carrier=risk_result.get("carrier"),
        country=risk_result.get("country"),
        line_type=risk_result.get("line_type"),
        voip=risk_result.get("voip"),
    )


def _normalize_number(number: str) -> str:
    """Normalize a phone number to digits-only format with country code."""
    digits = re.sub(r"[^\d+]", "", number)
    if digits.startswith("+"):
        digits = digits[1:]
    # Must have at least 7 digits to be a valid phone number
    if len(digits) < 7:
        return ""
    return digits


def _to_int64(normalized: str) -> Optional[int]:
    """Convert a normalized phone number string to int64 for PIR indexing."""
    try:
        return int(normalized)
    except (ValueError, OverflowError):
        return None
