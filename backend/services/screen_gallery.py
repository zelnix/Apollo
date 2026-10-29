"""Admin → Screens: a screenshot of every app screen at phone and tablet size, plus the app's logos, icons and splash
images, to view and download.

Screens are captured in the preview (services/screen_capture.py needs a browser and the running preview app) and each
image is copied to the live server, so both admin panels show the latest set. Regenerating from the live panel queues
a request that the preview picks up while it is running.

admin_screens: one row per image — key, kind ("screen" | "app_image"), title, group, size, route, note, filename,
storage_path, content_type, bytes, captured_at. admin_screen_runs: capture runs and queued requests.
"""
from __future__ import annotations

import asyncio
import io
import re
import time
import uuid
import zipfile
from collections import OrderedDict
from datetime import timedelta
from typing import Any, Optional

from core import local_time
from core.db import db, now_utc
from services.emergent_storage import APP_NAME, get_object, put_object

ITEMS = "admin_screens"
RUNS = "admin_screen_runs"
SIZES: dict[str, dict[str, Any]] = {
    "phone": {"label": "Phone", "width": 390, "height": 844},
    "tablet": {"label": "Tablet", "width": 820, "height": 1180},
}
SCALE = 2  # pixels per point: phone 780×1688, tablet 1640×2360
STALLED_AFTER = timedelta(minutes=4)
KEY_PATTERN = re.compile(r"^(app:[A-Za-z0-9._-]{1,80}|[a-z0-9-]{1,100}@(phone|tablet))$")
CONTENT_TYPES = {"image/png", "image/webp"}


def _safe(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "-", value).strip("-")[:120] or "item"


def download_name(row: dict[str, Any]) -> str:
    if row.get("kind") == "app_image":
        return f"app-images/{_safe(row['filename'])}"
    return f"screens/{row['size']}/{_safe(row['group']).lower()}/{_safe(row['screen'])}.png"


def _thumbnail(data: bytes) -> bytes:
    """A small JPEG for the gallery grid (the full image opens on click)."""
    from PIL import Image
    with Image.open(io.BytesIO(data)) as img:
        img = img.convert("RGBA")
        flat = Image.new("RGB", img.size, (255, 255, 255))
        flat.paste(img, mask=img.split()[-1])
        flat.thumbnail((320, 640))
        out = io.BytesIO()
        flat.save(out, "JPEG", quality=78, optimize=True)
        return out.getvalue()


async def save_image(item: dict[str, Any], data: bytes, content_type: str) -> dict[str, Any]:
    ext = "webp" if content_type == "image/webp" else "png"
    stamp = int(time.time() * 1000)
    path = f"{APP_NAME}/admin-screens/{_safe(item['key'])}-{stamp}.{ext}"
    thumb = f"{APP_NAME}/admin-screens/{_safe(item['key'])}-{stamp}-thumb.jpg"
    await asyncio.to_thread(put_object, path, data, content_type)
    await asyncio.to_thread(put_object, thumb, await asyncio.to_thread(_thumbnail, data), "image/jpeg")
    row = {**item, "storage_path": path, "thumb_path": thumb, "content_type": content_type, "bytes": len(data), "updated_at": now_utc()}
    await db[ITEMS].update_one({"key": item["key"]}, {"$set": row}, upsert=True)
    return row


_thumbs: "OrderedDict[str, bytes]" = OrderedDict()  # small JPEGs kept in memory: the grid opens fast, storage isn't re-read


async def thumbnail(key: str) -> Optional[bytes]:
    row = await db[ITEMS].find_one({"key": key}, {"_id": 0, "thumb_path": 1})
    if not row or not row.get("thumb_path"):
        return None
    path = row["thumb_path"]
    if path in _thumbs:
        _thumbs.move_to_end(path)
        return _thumbs[path]
    data, _ = await asyncio.to_thread(get_object, path)
    _thumbs[path] = data
    if len(_thumbs) > 400:
        _thumbs.popitem(last=False)
    return data


async def items() -> list[dict[str, Any]]:
    return await db[ITEMS].find({}, {"_id": 0}).sort([("kind", -1), ("group", 1), ("title", 1), ("size", 1)]).to_list(2000)


async def image(key: str) -> Optional[tuple[bytes, str, str]]:
    row = await db[ITEMS].find_one({"key": key}, {"_id": 0})
    if not row:
        return None
    data, stored_type = await asyncio.to_thread(get_object, row["storage_path"])
    return data, row.get("content_type") or stored_type, download_name(row)


async def zip_of(keys: list[str]) -> tuple[bytes, int]:
    buf, count = io.BytesIO(), 0
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as z:  # images are already compressed
        for key in dict.fromkeys(keys):
            got = await image(key)
            if got:
                z.writestr(got[2], got[0])
                count += 1
    return buf.getvalue(), count


# ── Runs ─────────────────────────────────────────────────────────────────────

async def latest_run() -> Optional[dict[str, Any]]:
    return await db[RUNS].find_one({}, {"_id": 0}, sort=[("requested_at", -1)])


def run_state(run: Optional[dict[str, Any]]) -> Optional[str]:
    """queued | running | stalled | done | failed — "stalled" when a queued or running capture stopped reporting."""
    if not run:
        return None
    status = run.get("status")
    updated = local_time.parse(run.get("updated_at")) if run.get("updated_at") else None
    if status == "running" and updated and now_utc() - updated > STALLED_AFTER:
        return "stalled"
    return status


async def queue(keys: Optional[list[str]], who: str) -> dict[str, Any]:
    ts = now_utc()
    run = {"run_id": uuid.uuid4().hex, "status": "queued", "keys": keys, "requested_by": who, "requested_at": ts, "updated_at": ts}
    await db[RUNS].insert_one(dict(run))
    return run


async def claim_next() -> Optional[dict[str, Any]]:
    ts = now_utc()
    return await db[RUNS].find_one_and_update(
        {"status": "queued"}, {"$set": {"status": "running", "claimed_at": ts, "updated_at": ts}},
        sort=[("requested_at", 1)], projection={"_id": 0}, return_document=True,
    )


async def record_run(run_id: str, fields: dict[str, Any]) -> None:
    ts = now_utc()
    await db[RUNS].update_one({"run_id": run_id}, {"$set": {**fields, "run_id": run_id, "updated_at": ts}, "$setOnInsert": {"requested_at": ts}}, upsert=True)
