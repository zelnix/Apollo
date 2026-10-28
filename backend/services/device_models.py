"""Descriptive device names ("Samsung Galaxy Z Fold6") for the model codes Android phones report ("SM-F956B").

Source: Google Play's public list of supported devices (Retail Branding, Marketing Name, Device, Model), downloaded
through the bounded public transport, refreshed weekly and kept in `device_model_names`. iPhones and iPads already
report their descriptive name, so only Android models need it. Nothing leaves the phone for this: a phone asks for its
own name and the server reads the manufacturer and model it already reported (`devices`).
"""
from __future__ import annotations

import asyncio
import csv
import io
import logging
from datetime import timedelta
from urllib.parse import urlparse

from core.db import db, now_utc
from services.outbound import public_get

logger = logging.getLogger("apollo")

URL = "https://storage.googleapis.com/play_public/supported_devices.csv"
HOSTS = {"storage.googleapis.com"}
LIMIT = 16_000_000
REFRESH = timedelta(days=7)
RETRY = timedelta(hours=6)
MIN_ROWS = 10_000  # a much shorter list is a broken download, never a replacement
STATE_ID = "device_model_names"
COLLECTION = "device_model_names"

_lock = asyncio.Lock()
_cache: dict[tuple[str, str], str | None] = {}


def descriptive(brand: str, marketing: str) -> str:
    """"Samsung" + "Galaxy Z Fold6" → "Samsung Galaxy Z Fold6"; "OnePlus" + "OnePlus 12" → "OnePlus 12"."""
    brand, marketing = " ".join(brand.split()), " ".join(marketing.split())
    if brand and brand == brand.lower():
        brand = brand[:1].upper() + brand[1:]
    if not brand or marketing.lower().startswith(brand.lower()):
        return marketing
    return f"{brand} {marketing}"


def parse(content: bytes) -> list[dict]:
    """The list's rows with a marketing name, one per (brand, model). The file is UTF-16 with a byte-order mark."""
    text = content.decode("utf-16") if content[:2] in (b"\xff\xfe", b"\xfe\xff") else content.decode("utf-8-sig")
    rows: dict[tuple[str, str], dict] = {}
    for record in csv.reader(io.StringIO(text)):
        if len(record) < 4 or record[0] == "Retail Branding":
            continue
        brand, marketing, model = record[0].strip(), record[1].strip(), record[3].strip()
        if not marketing or not model:
            continue
        key = (brand.lower(), model.upper())
        rows.setdefault(key, {"brand_key": key[0], "model_key": key[1], "brand": brand, "model": model,
                              "name": descriptive(brand, marketing)})
    return list(rows.values())


async def _state() -> dict:
    return await db.device_model_names_state.find_one({"_id": STATE_ID}) or {}


async def refresh(trigger: str = "scheduled") -> dict:
    """Download the list and replace the stored names in one step. A failed or short download keeps the old names."""
    async with _lock:
        started = now_utc()
        try:
            response = await public_get(URL, max_hops=2, limit=LIMIT, deadline=120)
            if response.status_code != 200 or urlparse(str(response.request.url)).hostname not in HOSTS:
                raise ValueError(f"list response rejected ({response.status_code})")
            rows = parse(response.content)
            if len(rows) < MIN_ROWS:
                raise ValueError(f"list too short ({len(rows)} rows)")
            staging = db[f"{COLLECTION}_next"]
            await staging.drop()
            for i in range(0, len(rows), 5000):
                await staging.insert_many([dict(r) for r in rows[i:i + 5000]], ordered=False)
            await staging.create_index([("model_key", 1), ("brand_key", 1)])
            await staging.rename(COLLECTION, dropTarget=True)
            _cache.clear()
            state = {"refreshed_at": started, "rows": len(rows), "last_error": None, "next_due": started + REFRESH, "trigger": trigger}
        except Exception as exc:  # noqa: BLE001
            logger.warning("device model names refresh failed: %s", type(exc).__name__)
            state = {"last_error": f"{type(exc).__name__}: {str(exc)[:200]}", "failed_at": started, "next_due": started + RETRY, "trigger": trigger}
        await db.device_model_names_state.update_one({"_id": STATE_ID}, {"$set": state}, upsert=True)
        return state


async def run_if_due() -> dict | None:
    due = (await _state()).get("next_due")
    if due and due > now_utc():
        return None
    return await refresh()


async def name_for(manufacturer: str | None, model: str | None) -> str | None:
    """The descriptive name for a reported manufacturer and model, or None when the list doesn't name it."""
    model_key = " ".join((model or "").split()).upper()
    if not model_key:
        return None
    brand_key = " ".join((manufacturer or "").split()).lower()
    if (brand_key, model_key) in _cache:
        return _cache[(brand_key, model_key)]
    found = await db[COLLECTION].find_one({"model_key": model_key, "brand_key": brand_key}, {"name": 1})
    if not found:
        # Some phones report a maker that differs from the list's retail brand; a model code only one name uses still counts.
        names = await db[COLLECTION].distinct("name", {"model_key": model_key})
        found = {"name": names[0]} if len(names) == 1 else None
    name = found["name"] if found else None
    _cache[(brand_key, model_key)] = name
    return name
