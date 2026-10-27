"""ApolloSG observed intelligence: what ApolloSG itself has seen in material it found concerning, as counts of separate
devices, never content.

Stored in ApolloSG's own indicator store (`threat_indicators`, source `apollosg-observed`), not a separate silo:
- scope `observed`: one website (its registrable domain), phone number or email address. Every subject is kept as a
  one-way code (services/reusable_intel.subject_key; a website as `domain:<code>`). A website's name is stored readably only
  once THRESHOLD separate devices have seen it, because by then it is a pattern rather than one person's material.
- scope `observed_relation`: two of those subjects seen together in the same concerning material (a possible campaign).
- Each device is recorded as a mark made from the subject and the device together, so the same device can't be followed
  from one subject to another. Marks older than WINDOW are dropped; a subject nobody saw for WINDOW stops counting.

What is recorded: the websites, numbers and addresses of a case whose outcome is a concern (Concerning, Likely scam or
Confirmed scam/threat), but never an organisation's own or official address, a shared platform or a free mail provider, a
number on the Official Organisation Directory, or a case whose concern came from a simulated AI result. A concern that
rests only on ApolloSG's own observations is never recorded, so observations can't feed themselves.

How it is used: seen in concerning material on THRESHOLD or more separate devices (other than the one checking) in the
last WINDOW → a weak signal (the owner's rule). Never a concern on its own, alone or together with other weak signals.
"""
from __future__ import annotations

import hashlib
import itertools
import logging
from datetime import datetime, timedelta, timezone

from core.db import db, now_utc

log = logging.getLogger("apollo.observed")

SOURCE = "apollosg-observed"
THRESHOLD = 3
WINDOW = timedelta(days=30)
CONCERN_OUTCOMES = ("concerning", "likely_scam", "confirmed_threat")
MAX_SUBJECTS = 6
_SELF_TOPICS = ("observed", "campaign")


def subject(kind: str, value: str) -> tuple[str, str | None] | None:
    """(one-way key, readable name or None) for a website, phone number or email address that may be recorded."""
    from services import org_directory, threat_feeds
    from services.higgins.brand_domains import owner, registrable
    from services.higgins.teddy.triage import FREE_MAIL
    from services.reusable_intel import fingerprint, subject_key
    value = (value or "").strip()
    if not value:
        return None
    if kind == "domain":
        host = threat_feeds.norm_host(value.split("//")[-1].split("/")[0].split("@")[-1].split(":")[0])
        domain = registrable(host)
        if "." not in domain or threat_feeds.restricted(domain) or owner(domain) or domain in FREE_MAIL:
            return None
        return f"domain:{fingerprint('observed-domain|' + domain)}", domain
    if kind == "phone":
        return (None if org_directory.phone_owner(value) else (subject_key("phone", value), None))
    if kind == "email":
        domain = value.lower().split("@")[-1]
        # A free mail address is one person's account (a scammer's Gmail): it may be recorded. Organisations' own are never.
        if org_directory.email_owner(value) or (domain not in FREE_MAIL and (owner(domain) or threat_feeds.restricted(domain))):
            return None
        return subject_key("email", value), None
    return None


def _mark(key: str, device: str) -> str:
    return hashlib.sha256(f"observed|{key}|{device}".encode()).hexdigest()[:24]


def _aware(value):
    return value.replace(tzinfo=timezone.utc) if isinstance(value, datetime) and value.tzinfo is None else value


async def _add(scope: str, key: str, device: str, now: datetime, fields: dict) -> int:
    """Add this device's mark to one subject (or relation); returns the separate devices in the window."""
    doc = await db.threat_indicators.find_one({"scope": scope, "key": key, "source": SOURCE}, {"_id": 0, "marks": 1})
    mark = _mark(key, device)
    marks = [m for m in (doc or {}).get("marks") or [] if now - _aware(m["at"]) <= WINDOW and m["m"] != mark] + [{"m": mark, "at": now}]
    devices = len(marks)
    revealed = {"hostname": fields.get("readable") or ""} if devices >= THRESHOLD else {"hostname": ""}
    await db.threat_indicators.update_one({"scope": scope, "key": key, "source": SOURCE}, {
        "$set": {"marks": marks, "devices_30d": devices, "last_verified_at": now, "evidence_expiry_deadline": now + WINDOW,
                 "status": "active", "updated_at": now, "review_status": "auto_verified", "threat_type": "OBSERVED_CONCERN",
                 "original_evidence": f"Seen in material ApolloSG found concerning on {devices} separate device{'s' if devices != 1 else ''}",
                 **{k: v for k, v in fields.items() if k != "readable"}, **revealed},
        "$setOnInsert": {"indicator_id": "obs-" + hashlib.sha256(f"{scope}|{key}".encode()).hexdigest()[:24], "source": SOURCE,
                         "first_seen_at": now, "added_at": now, "added_by": "observed", "original_scope": scope}}, upsert=True)
    return devices


def _subjects_of(record: dict) -> list[tuple[str, str, str | None]]:
    """(kind, key, readable) for each website, number and address in a TC FlyBy record."""
    entities = {}
    for check in record.get("checks") or []:
        entities.setdefault({"link": "domain", "phone": "phone", "email": "email"}.get(check["kind"], ""), []).append(check["subject"])
    out, seen = [], set()
    for kind in ("domain", "phone", "email"):
        for value in entities.get(kind, []):
            found = subject(kind, value)
            if found and found[0] not in seen:
                seen.add(found[0])
                out.append((kind, found[0], found[1]))
    return out[:MAX_SUBJECTS]


def _rests_only_on_observations(record: dict, answered_by: str) -> bool:
    if answered_by == "magnum_di":
        return False
    warnings = [f for c in record.get("checks") or [] for f in c.get("facts") or []
                if f.get("class") == "live_evidence" and f.get("signal") in ("concern", "anomaly")]
    patterns = record.get("pattern") and record["pattern"].get("stage") in ("full", "opening")
    return not patterns and not any(f.get("topic") not in _SELF_TOPICS for f in warnings)


async def record_case(owner: str, case_id: str, outcome: str | None, *, answered_by: str = "", simulated: bool = False) -> int:
    """Record a concerning case's websites, numbers and addresses (and how they appeared together). Returns subjects recorded."""
    if outcome not in CONCERN_OUTCOMES or simulated:
        return 0
    from services.higgins import repository as repo
    stored = await db.investigation_cases.find_one({"owner_id": owner, "case_id": case_id}, {"_id": 0, "teddy_ciphertext": 1, "observed_at": 1})
    if not stored or not stored.get("teddy_ciphertext") or stored.get("observed_at"):
        return 0
    record = repo.dec_json(stored["teddy_ciphertext"])
    if _rests_only_on_observations(record, answered_by):
        return 0
    now = now_utc()
    subjects = _subjects_of(record)
    for kind, key, readable in subjects:
        await _add("observed", key, owner, now, {"subject_kind": kind, "readable": readable})
    for (ka, a, ra), (kb, b, rb) in itertools.combinations(sorted(subjects, key=lambda s: s[1]), 2):
        await _add("observed_relation", f"rel:{hashlib.sha256(f'{a}|{b}'.encode()).hexdigest()[:32]}", owner, now,
                   {"a_key": a, "b_key": b, "a_kind": ka, "b_kind": kb, "a_name": ra, "b_name": rb})
    await db.investigation_cases.update_one({"owner_id": owner, "case_id": case_id}, {"$set": {"observed_at": now}})
    return len(subjects)


async def _doc(kind: str, value: str) -> dict | None:
    found = subject(kind, value)
    if not found:
        return None
    return await db.threat_indicators.find_one({"scope": "observed", "key": found[0], "source": SOURCE, "status": "active",
                                                "evidence_expiry_deadline": {"$gt": now_utc()}}, {"_id": 0})


async def seen(kind: str, value: str, *, exclude: str | None = None) -> dict | None:
    """{devices, first_seen_at, last_seen_at} when THRESHOLD or more separate devices (other than `exclude`) saw this subject
    in concerning material within WINDOW; None otherwise."""
    doc = await _doc(kind, value)
    if not doc:
        return None
    now = now_utc()
    own = _mark(doc["key"], exclude) if exclude else None
    devices = sum(1 for m in doc.get("marks") or [] if now - _aware(m["at"]) <= WINDOW and m["m"] != own)
    if devices < THRESHOLD:
        return None
    return {"devices": devices, "first_seen_at": _aware(doc.get("first_seen_at")), "last_seen_at": _aware(doc.get("last_verified_at"))}


async def related(kind: str, value: str) -> list[dict]:
    """Subjects seen together with this one in concerning material on THRESHOLD or more separate devices (a possible campaign)."""
    found = subject(kind, value)
    if not found:
        return []
    rows = await db.threat_indicators.find({"scope": "observed_relation", "source": SOURCE, "status": "active", "devices_30d": {"$gte": THRESHOLD},
                                            "evidence_expiry_deadline": {"$gt": now_utc()}, "$or": [{"a_key": found[0]}, {"b_key": found[0]}]},
                                           {"_id": 0, "a_key": 1, "b_key": 1, "a_kind": 1, "b_kind": 1, "a_name": 1, "b_name": 1, "devices_30d": 1}).to_list(10)
    out = []
    for row in rows:
        side = "b" if row["a_key"] == found[0] else "a"
        out.append({"key": row[f"{side}_key"], "kind": row[f"{side}_kind"], "name": row.get(f"{side}_name"), "devices": row["devices_30d"]})
    return out


async def purge() -> int:
    result = await db.threat_indicators.update_many(
        {"source": SOURCE, "status": "active", "evidence_expiry_deadline": {"$lte": now_utc()}},
        {"$set": {"status": "expired", "withdrawal_reason": "expired_unverified", "marks": [], "hostname": ""}})
    removed = await db.threat_indicators.delete_many({"source": SOURCE, "status": "expired", "updated_at": {"$lt": now_utc() - timedelta(days=90)}})
    return result.modified_count + removed.deleted_count


async def summary() -> dict:
    """Counts and the patterns at or above the threshold, for the admin portal. No content."""
    now = now_utc()
    base = {"source": SOURCE, "status": "active", "evidence_expiry_deadline": {"$gt": now}}
    subjects = await db.threat_indicators.find({**base, "scope": "observed", "devices_30d": {"$gte": THRESHOLD}},
                                               {"_id": 0, "subject_kind": 1, "hostname": 1, "key": 1, "devices_30d": 1, "first_seen_at": 1,
                                                "last_verified_at": 1}).sort("devices_30d", -1).to_list(50)
    campaigns = await db.threat_indicators.find({**base, "scope": "observed_relation", "devices_30d": {"$gte": THRESHOLD}},
                                                {"_id": 0, "a_kind": 1, "b_kind": 1, "a_name": 1, "b_name": 1, "a_key": 1, "b_key": 1,
                                                 "devices_30d": 1, "last_verified_at": 1}).sort("devices_30d", -1).to_list(50)
    return {"tracked": await db.threat_indicators.count_documents({**base, "scope": "observed"}),
            "atThreshold": await db.threat_indicators.count_documents({**base, "scope": "observed", "devices_30d": {"$gte": THRESHOLD}}),
            "campaigns": campaigns, "subjects": subjects, "threshold": THRESHOLD, "windowDays": WINDOW.days}


async def ensure_indexes() -> None:
    await db.threat_indicators.create_index([("scope", 1), ("key", 1), ("source", 1)])
    await db.threat_indicators.create_index([("scope", 1), ("a_key", 1)])
    await db.threat_indicators.create_index([("scope", 1), ("b_key", 1)])
