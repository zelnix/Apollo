"""Protection explanations — Gemini teaches Apollo about a protection once; Apollo reuses it for everyone.

Three things are kept separate, and only the first lives here:
  1. the explanation of a protection (what it is, why it matters, what it protects against) — reusable content;
  2. the settings steps to change it — the device catalogue on the phone, because they differ by OS and maker;
  3. the person's current state — only ever the phone's own read. Gemini never sees or decides it.

Lookup order for a Device Protection:
  reviewed seed → stored explanation at its scope → Gemini, only on a genuine miss → store → reuse.
The scope is the broadest one that is accurate: OS → OS version → maker → maker + OS version → model. A request
for a narrower scope than the protection needs never creates a narrower copy, and missing device facts widen it.
Concurrent identical misses make one Gemini call: an in-process lock plus a claimed lease in Mongo.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import timedelta
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field
from pymongo.errors import DuplicateKeyError

from core.db import db, now_utc
from services.higgins import provider
from services.protection_knowledge import APOLLO_PROTECTIONS, DEVICE_SEEDS

log = logging.getLogger("apollo.protections")

Scope = Literal["os", "os_version", "oem", "oem_os_version", "model"]
PLATFORM_NAME = {"android": "Android", "ios": "iOS", "windows": "Windows", "macos": "macOS"}
LEASE = timedelta(seconds=90)
WAIT_SECONDS = 20.0
DAILY_NEW_PER_DEVICE = 12  # genuine misses one device may cause per day; reuse is unlimited

_locks: dict[str, asyncio.Lock] = {}


class DeviceExplanationRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")
    protection_id: str = Field(alias="protectionId", pattern=r"^[a-z0-9_:.\-]{2,90}$")
    title: str = Field(min_length=2, max_length=80)
    platform: Literal["android", "ios", "windows", "macos"]
    os_version: Optional[str] = Field(default=None, alias="osVersion", max_length=20)
    oem: Optional[str] = Field(default=None, max_length=40)
    model: Optional[str] = Field(default=None, max_length=60)
    scope: Scope = "os"


class ModelExplanation(BaseModel):
    """Gemini's teaching about one protection. No field may describe the person's own setting."""
    what: str = Field(max_length=400)
    why: str = Field(max_length=400)
    protects_against: str = Field(max_length=300)
    recommended: str = Field(max_length=300)


def _wire(explanation: dict) -> dict:
    return {"what": explanation["what"], "why": explanation["why"], "protectsAgainst": explanation["protects_against"],
            "recommended": explanation.get("recommended")}


def apollo_explanation(protection_id: str) -> Optional[dict]:
    """The one canonical explanation of an Apollo Protection. Fixed text: the same for every user."""
    item = APOLLO_PROTECTIONS.get(protection_id)
    if not item:
        return None
    return {"protectionId": protection_id, "title": item["title"], "explanation": _wire(item), "version": item["version"],
            "source": "apollo_reviewed", "scopeLabel": "Every ApolloSG user"}


def _clean(value: Optional[str], pattern: str = r"[^a-z0-9 .\-]") -> str:
    return re.sub(pattern, "", (value or "").strip().lower())[:40].strip()


def _os_major(version: Optional[str]) -> str:
    match = re.match(r"\s*(\d{1,3})", version or "")
    return match.group(1) if match else ""


def scope_key(req: DeviceExplanationRequest) -> tuple[str, str, str]:
    """(storage key, effective scope, label). Missing device facts widen the scope — never guessed."""
    platform, major, oem, model = req.platform, _os_major(req.os_version), _clean(req.oem), _clean(req.model, r"[^a-z0-9 \-]")
    scope: str = req.scope
    if scope == "model" and not (oem and model):
        scope = "oem" if oem else "os"
    if scope in ("oem", "oem_os_version") and not oem:
        scope = "os_version" if scope == "oem_os_version" else "os"
    if scope in ("os_version", "oem_os_version") and not major:
        scope = "oem" if scope == "oem_os_version" else "os"
    name = PLATFORM_NAME[platform]
    parts, label = [platform], f"All {name} devices"
    if scope == "os_version":
        parts, label = [platform, f"v{major}"], f"{name} {major}"
    elif scope == "oem":
        parts, label = [platform, oem], f"{oem.title()} devices on {name}"
    elif scope == "oem_os_version":
        parts, label = [platform, oem, f"v{major}"], f"{oem.title()} devices on {name} {major}"
    elif scope == "model":
        parts, label = [platform, oem, model], f"{oem.title()} {model.upper()}"
    return f"{req.protection_id}|{'/'.join(parts)}", scope, label


def _ready(doc: dict) -> dict:
    return {"protectionId": doc["protection_id"], "title": doc["title"], "explanation": _wire(doc["explanation"]),
            "source": "higgins_cached", "scope": doc["scope"], "scopeLabel": doc["scope_label"],
            "createdAt": doc["created_at"].isoformat() if doc.get("created_at") else None}


async def _find_ready(key: str) -> Optional[dict]:
    doc = await db.protection_explanations.find_one({"_id": key, "status": "ready"})
    return _ready(doc) if doc else None


async def _claim(key: str, owner: str) -> bool:
    """One generator per key across every worker: insert a lease, or take over one that expired."""
    now = now_utc()
    try:
        await db.protection_explanations.insert_one({"_id": key, "status": "generating", "lease_until": now + LEASE, "requested_by": owner, "claimed_at": now})
        return True
    except DuplicateKeyError:
        taken = await db.protection_explanations.update_one(
            {"_id": key, "status": "generating", "lease_until": {"$lt": now}},
            {"$set": {"lease_until": now + LEASE, "requested_by": owner, "claimed_at": now}})
        return taken.modified_count == 1


async def _wait_for(key: str) -> Optional[dict]:
    deadline = asyncio.get_running_loop().time() + WAIT_SECONDS
    while asyncio.get_running_loop().time() < deadline:
        ready = await _find_ready(key)
        if ready:
            return ready
        await asyncio.sleep(0.5)
    return None


async def _new_today(owner: str) -> int:
    return await db.protection_explanations.count_documents({"requested_by": owner, "claimed_at": {"$gte": now_utc() - timedelta(days=1)}})


SYSTEM = ("You are Higgins, the security adviser inside the ApolloSG app. Explain ONE device protection to a non-technical person, "
          "in plain English, one or two short sentences per field. Describe the protection in general for the platform and maker given. "
          "You do not know this person's settings: never say whether it is on, off, set or missing on their device, and never invent "
          "settings paths. If you are not sure the protection exists as named, say what it most likely is and keep it general.")


async def _generate(req: DeviceExplanationRequest, scope_label: str) -> tuple[ModelExplanation, bool]:
    """The explanation, and whether it came from the preview simulator instead of Gemini."""
    prompt = json.dumps({"protection": req.title, "platform": PLATFORM_NAME[req.platform], "applies_to": scope_label}, ensure_ascii=False)
    result = await provider.generate(SYSTEM, prompt, model=provider.CHAT_MODEL, capability="json", json_output=True,
                                     response_schema=ModelExplanation, purpose=provider.Purpose.ORDINARY_CHAT,
                                     correlation_id=f"protection-{req.protection_id[:40]}", trigger_source="protection_explanation_miss")
    return ModelExplanation.model_validate_json(result.text), bool(getattr(result, "simulated", False))


def reviewed_device_explanation(protection_id: str) -> Optional[dict]:
    """The pre-written explanation of a common Device Protection, or None. Never calls Gemini."""
    seed = DEVICE_SEEDS.get(protection_id)
    if not seed:
        return None
    return {"protectionId": protection_id, "explanation": _wire(seed), "source": "apollo_reviewed", "scope": "os", "scopeLabel": "Reviewed by Apollo"}


async def device_explanation(owner: str, req: DeviceExplanationRequest) -> dict:
    """Reviewed seed → cached explanation → (genuine miss) one Gemini call, stored at its scope and reused."""
    reviewed = reviewed_device_explanation(req.protection_id)
    if reviewed:
        return {**reviewed, "title": req.title}
    key, scope, label = scope_key(req)
    ready = await _find_ready(key)
    if ready:
        return ready
    lock = _locks.setdefault(key, asyncio.Lock())
    async with lock:
        ready = await _find_ready(key)
        if ready:
            return ready
        if await _new_today(owner) >= DAILY_NEW_PER_DEVICE:
            return {"status": "limited", "protectionId": req.protection_id}
        if not await _claim(key, owner):
            return await _wait_for(key) or {"status": "generating", "protectionId": req.protection_id}
        try:
            taught, simulated = await _generate(req, label)
        except Exception:
            await db.protection_explanations.delete_one({"_id": key, "status": "generating"})
            raise
        if simulated:
            # Preview: shown once, labelled, and never stored as Higgins' explanation.
            await db.protection_explanations.delete_one({"_id": key, "status": "generating"})
            return {"protectionId": req.protection_id, "title": req.title, "explanation": _wire(taught.model_dump()),
                    "source": "preview_simulator", "scope": scope, "scopeLabel": label}
        doc = {"protection_id": req.protection_id, "title": req.title, "platform": req.platform, "scope": scope, "scope_label": label,
               "explanation": taught.model_dump(), "status": "ready", "created_at": now_utc(), "model": provider.CHAT_MODEL}
        await db.protection_explanations.update_one({"_id": key}, {"$set": doc, "$unset": {"lease_until": ""}})
        log.info("protection_explanation_taught key=%s", key)
        return {**_ready({**doc, "_id": key}), "source": "higgins_new"}
