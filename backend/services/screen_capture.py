"""Captures Admin → Screens in the preview: every app screen at phone and tablet size, plus the app's logos, icons and
splash images. It needs a browser and the running preview app, so it only runs in the preview. Each image is also
copied to the live server (PUBLIC_API_BASE), so the live admin panel shows the same set, and requests queued from the
live panel are picked up here while the preview is running.

Screens that only show content when there's data use labelled sample data on a screenshot-only test device: a sample
threat case, and a sample family member who shares an alert and an incident with it. Both devices and everything they
hold are deleted when the run ends.
"""
from __future__ import annotations

import asyncio
import base64
import logging
import re
import shutil
from pathlib import Path
from typing import Any, Optional
from urllib.parse import quote, urlparse

import httpx

from core.config import ADMIN_HEADER, ADMIN_KEY, PUBLIC_BASE
from core.db import db, now_utc
from services import account_deletion
from services import screen_gallery as gallery

logger = logging.getLogger("apollo.screens")

FRONTEND = Path(__file__).resolve().parents[2] / "frontend"
APP_DIR = FRONTEND / "app"
IMAGES_DIR = FRONTEND / "assets" / "images"
WEB = "http://localhost:3000"
API = "http://localhost:8001/api"
BROWSERS = ("/root/bin/chromium", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome")

SAMPLE_CASE = "sample-screens-case"
SAMPLE_ALERT = "sample-screens-alert"
SAMPLE_INCIDENT = "sample-screens-incident"
BEFORE_SETUP = ("index", "onboarding", "privacy-disclosure")
NEEDS_SAMPLE = ("patrol/[id]", "patrol/scent/[id]", "family/alert/[id]", "family/incident/[id]")
GROUPS = {"(tabs)": "Tabs", "family": "Family", "settings": "Settings", "higgins": "Learn & Higgins", "patrol": "Threats"}
TITLES = {
    "index": "Start", "patrol/[id]": "Threat case", "patrol/scent/[id]": "Incident plan", "family/alert/[id]": "Family alert",
    "family/incident/[id]": "Family incident", "saved-report/[id]": "Saved report", "capability/[id]": "Protection detail",
    "higgins/learning/[slug]": "Learn article", "higgins/scam/[id]": "Scam alert", "family/help/index": "Family help",
    "settings/index": "Settings menu",
}
NOTES = {"saved-report/[id]": "Shows its 'unavailable' state: a saved report needs a full investigation, which sample data can't stand in for."}
APP_IMAGES = (
    ("icon.png", "App icon"), ("adaptive-icon.png", "Android adaptive icon"), ("favicon.png", "Web favicon"),
    ("splash-logo.png", "Splash screen logo"), ("splash-icon.png", "Splash screen icon"),
    ("splash-full.webp", "Splash screen, phone"), ("splash-full-tablet.webp", "Splash screen, tablet"),
    ("logo.png", "Logo"), ("apollo-sg-logo.png", "ApolloSG logo"), ("apollosg-wordmark.png", "ApolloSG wordmark"),
    ("logo-source.png", "Logo, source artwork"), ("apollo-shield-source.png", "Shield, source artwork"), ("app-image.png", "App image"),
)

_lock = asyncio.Lock()


# ── What gets captured ───────────────────────────────────────────────────────

def _humanise(segment: str) -> str:
    return segment.replace("-", " ").replace("_", " ").strip().capitalize() or "Start"


def screen_for(rel: str) -> dict[str, str]:
    """One route file (relative to frontend/app, no extension) as a screen: its URL, title and group."""
    parts = [p for p in rel.split("/") if not (p.startswith("(") and p.endswith(")"))]
    if parts and parts[-1] == "index":
        parts = parts[:-1]
    top = rel.split("/")[0]
    group = GROUPS.get(top) if "/" in rel else ("Setup" if rel in BEFORE_SETUP or rel == "setup-gates" else "Screens")
    return {
        "screen": re.sub(r"[^a-z0-9]+", "-", rel.lower()).strip("-"),
        "file": rel, "route": "/" + "/".join(parts), "title": TITLES.get(rel) or _humanise(parts[-1] if parts else ""),
        "group": group or "Screens", "note": NOTES.get(rel, ""),
    }


def screens() -> list[dict[str, str]]:
    if not APP_DIR.is_dir():
        return []
    rels = sorted(f.relative_to(APP_DIR).with_suffix("").as_posix() for f in APP_DIR.rglob("*.tsx"))
    return [screen_for(r) for r in rels if not r.rsplit("/", 1)[-1].startswith(("_", "+"))]


def route_for(screen: dict[str, str], ids: dict[str, str]) -> str:
    """The URL to open: a screen for one item opens the labelled sample (or a real Learn article / scam alert)."""
    value = {
        "patrol/[id]": SAMPLE_CASE, "patrol/scent/[id]": SAMPLE_CASE, "family/alert/[id]": SAMPLE_ALERT,
        "family/incident/[id]": SAMPLE_INCIDENT, "capability/[id]": "private_dns", "saved-report/[id]": "sample-screens-report",
        "higgins/learning/[slug]": ids.get("article", "sample"), "higgins/scam/[id]": ids.get("scam", "sample"),
    }.get(screen["file"], "sample")
    return re.sub(r"\[[^\]]+\]", quote(value, safe=""), screen["route"])


def browser_path() -> Optional[str]:
    for path in BROWSERS:
        if Path(path).exists():
            return path
    return shutil.which("chromium") or shutil.which("google-chrome")


async def available() -> bool:
    """Only the preview can capture: it has a browser and the app running next to this server."""
    if not APP_DIR.is_dir() or not browser_path():
        return False
    try:
        async with httpx.AsyncClient(timeout=4) as client:
            return (await client.get(WEB)).status_code < 500
    except httpx.HTTPError:
        return False


def busy() -> bool:
    return _lock.locked()


_tasks: set[asyncio.Task] = set()


def start(run_id: str, keys: Optional[list[str]]) -> None:
    """Starts a capture in the background (the admin page returns straight away and shows its progress)."""
    task = asyncio.create_task(run(run_id, keys, origin="preview"), name=f"apollo-screens-{run_id[:8]}")
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


# ── Running a capture ────────────────────────────────────────────────────────

async def run(run_id: str, keys: Optional[list[str]], origin: str) -> None:
    async with _lock:
        wanted = set(keys) if keys else None
        targets = [(s, size) for size in gallery.SIZES for s in screens() if wanted is None or f"{s['screen']}@{size}" in wanted]
        images = [img for img in APP_IMAGES if wanted is None or f"app:{img[0]}" in wanted]
        progress: dict[str, Any] = {"status": "running", "origin": origin, "total": len(targets) + len(images), "done": 0,
                                    "current": "", "errors": [], "started_at": now_utc().isoformat()}
        await _report(run_id, progress)
        try:
            for filename, title in images:
                path = IMAGES_DIR / filename
                if path.exists():
                    ctype = "image/webp" if filename.endswith(".webp") else "image/png"
                    item = {"key": f"app:{filename}", "kind": "app_image", "title": title, "group": "App images", "filename": filename}
                    await _save(item, path.read_bytes(), ctype, progress)
                progress["done"] += 1
            if targets:
                await _capture(run_id, targets, progress)
            progress.update(status="done", current="", finished_at=now_utc().isoformat())
        except Exception as exc:  # noqa: BLE001
            logger.exception("screen capture failed")
            progress.update(status="failed", current="", error=str(exc)[:300], finished_at=now_utc().isoformat())
        await _report(run_id, progress)


async def _capture(run_id: str, targets: list[tuple[dict[str, str], str]], progress: dict[str, Any]) -> None:
    from playwright.async_api import async_playwright

    who: dict[str, str] = {}
    helper: Optional[str] = None
    pending: list[asyncio.Task] = []
    uploads = asyncio.Semaphore(3)

    async def on_response(resp: Any) -> None:
        if resp.url.endswith("/devices/register") and resp.request.method == "POST" and resp.ok and "device_id" not in who:
            try:
                body = await resp.json()
                who.update(device_id=body["device_id"], token=body["device_token"])
            except Exception:  # noqa: BLE001
                pass

    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=browser_path(), args=["--no-sandbox", "--disable-dev-shm-usage"])
        try:
            first = gallery.SIZES["phone"]
            page = await (await browser.new_context(viewport={"width": first["width"], "height": first["height"]}, device_scale_factor=gallery.SCALE)).new_page()
            page.on("response", lambda r: asyncio.ensure_future(on_response(r)))

            async def shoot(screen: dict[str, str], size: str, route: str) -> None:
                progress["current"] = f"{screen['title']} ({gallery.SIZES[size]['label']})"
                await _report(run_id, progress)
                for attempt in (1, 2):
                    try:
                        await page.goto(WEB + route, wait_until="domcontentloaded", timeout=45000)
                        await _settle(page)
                        data = await page.screenshot(type="png", full_page=False)
                        break
                    except Exception as exc:  # noqa: BLE001
                        if attempt == 2:
                            progress["errors"].append(f"{screen['title']} ({size}): {str(exc)[:160]}")
                            progress["done"] += 1
                            return
                        await _wait_for_app()  # the preview app restarts now and then; carry on once it's back
                final = urlparse(page.url).path or "/"
                note = screen["note"] or (f"This device opens {final} instead." if final.rstrip("/") != route.split("?")[0].rstrip("/") else "")
                item = {"key": f"{screen['screen']}@{size}", "kind": "screen", "screen": screen["screen"], "title": screen["title"],
                        "group": screen["group"], "size": size, "route": route, "note": note, "captured_at": now_utc().isoformat()}
                pending.append(asyncio.create_task(save_soon(item, data)))
                progress["done"] += 1

            async def save_soon(item: dict[str, Any], data: bytes) -> None:
                async with uploads:  # stored and copied to the live panel while the next screen loads
                    try:
                        await _save(item, data, "image/png", progress)
                    except Exception as exc:  # noqa: BLE001
                        progress["errors"].append(f"{item['title']} ({item['size']}): couldn't be saved ({str(exc)[:120]})")

            async def each_size(predicate: Any, route_of: Any) -> None:
                for size, spec in gallery.SIZES.items():
                    batch = [s for s, sz in targets if sz == size and predicate(s)]
                    if batch:
                        await page.set_viewport_size({"width": spec["width"], "height": spec["height"]})
                    for s in batch:
                        await shoot(s, size, route_of(s))

            # First-run screens, before this device is set up.
            await each_size(lambda s: s["file"] in BEFORE_SETUP, lambda s: s["route"])
            if not any(s["file"] not in BEFORE_SETUP for s, _ in targets):
                return
            await page.set_viewport_size({"width": first["width"], "height": first["height"]})
            await _set_up(page)
            if "token" not in who:
                raise RuntimeError("The preview app didn't register a device for the screenshots.")
            async with httpx.AsyncClient(base_url=API, timeout=30, headers={"User-Agent": "apollo-screens"}) as api:
                ids = await _lookups(api, who["token"])
                if any(s["file"] in NEEDS_SAMPLE for s, _ in targets):
                    helper = await _seed(api, who["device_id"], who["token"])
                    # Opening Threats once keeps the sample case on this device, so its screens find it straight away.
                    await page.goto(WEB + "/patrol", wait_until="domcontentloaded")
                    try:
                        await page.get_by_test_id(f"threat-card-{SAMPLE_CASE}").wait_for(timeout=30000)
                    except Exception:  # noqa: BLE001
                        progress["errors"].append("The sample case didn't reach the screenshot device in time.")
            await each_size(lambda s: s["file"] not in BEFORE_SETUP, lambda s: route_for(s, ids))
        finally:
            await asyncio.gather(*pending)
            await browser.close()
            await _clean_up(who.get("device_id"), helper)


async def _wait_for_app(seconds: int = 120) -> None:
    for _ in range(seconds // 3):
        try:
            async with httpx.AsyncClient(timeout=3) as client:
                if (await client.get(WEB)).status_code < 500:
                    return
        except httpx.HTTPError:
            pass
        await asyncio.sleep(3)


async def _settle(page: Any) -> None:
    try:
        await page.wait_for_function("() => { const r = document.querySelector('#root'); return !!r && r.innerText.trim().length > 0; }", timeout=30000)
    except Exception:  # noqa: BLE001
        pass
    for _ in range(24):  # the launch splash covers every fresh load for ~2 s (src/components/LaunchSplash.tsx)
        if not await page.locator("[data-testid=launch-splash]").count():
            break
        await page.wait_for_timeout(500)
    for _ in range(16):  # up to 8 s for loading spinners to finish
        if not await page.locator("[role=progressbar]").count():
            break
        await page.wait_for_timeout(500)
    await page.wait_for_timeout(1200)


async def _set_up(page: Any) -> None:
    """Sets the screenshot device up the way a person does: Continue, then accept the privacy disclosure."""
    await page.goto(WEB + "/onboarding", wait_until="domcontentloaded")
    await page.get_by_test_id("onboarding-start-button").click(timeout=30000)
    await page.get_by_test_id("disclosure-accept-button").click(timeout=30000)
    await page.wait_for_url(lambda url: "privacy-disclosure" not in url, timeout=45000)
    await _settle(page)


async def _lookups(api: httpx.AsyncClient, token: str) -> dict[str, str]:
    """A real Learn article and scam alert to open, so those screens show content."""
    me = {"Authorization": f"Bearer {token}"}
    ids: dict[str, str] = {}
    try:
        articles = (await api.get("/learning/articles", headers=me)).json().get("items") or []
        if articles:
            ids["article"] = articles[0]["slug"]
        alerts = (await api.get("/higgins/scams", headers=me)).json().get("alerts") or []
        if alerts:
            ids["scam"] = alerts[0]["url"]
    except Exception:  # noqa: BLE001
        logger.warning("screens: Learn article / scam alert lookup failed")
    return ids


async def _seed(api: httpx.AsyncClient, device_id: str, token: str) -> str:
    """Labelled sample data: a threat case on the screenshot device, and a sample family member (a second test device)
    who shares an alert and an incident with it. Returns the family member's device id."""
    me = {"Authorization": f"Bearer {token}"}
    now = now_utc().isoformat()
    (await api.post("/patrol/events", headers=me, json={
        "event_id": SAMPLE_CASE, "device_id": device_id, "category": "message", "state": "growling", "status": "active",
        "headline": "Sample case: a text asking you to pay a parcel fee",
        "what_happened": "Sample data for screenshots. A text said a parcel was waiting and asked for a small fee through a link.",
        "why": ["Sample data for screenshots", "Asks for a payment through a link"],
        "what_to_do": "Don't use the link. Check with the delivery company directly.",
        "indicator_host": "parcel-fee.example", "indicator_digest": None, "verified_block": False,
        "adapter_label": "Sample data", "occurred_at": now, "resolved_at": None,
    })).raise_for_status()
    reg = await api.post("/devices/register", json={"platform": "web", "adapter_mode": "unsupported", "app_version": "screens"})
    reg.raise_for_status()
    helper, them = reg.json()["device_id"], {"Authorization": f"Bearer {reg.json()['device_token']}"}
    code = (await api.post("/family/pair", headers=them, json={"device_id": helper, "owner_name": "Sample family member"})).json()["code"]
    (await api.post("/family/link", headers=me, json={"device_id": device_id, "code": code, "guardian_name": "You"})).raise_for_status()
    (await api.post("/family/threats/share", headers=them, json={
        "device_id": helper, "event_id": SAMPLE_ALERT, "state": "barking", "result": "Confirmed scam or threat",
        "headline": "Sample alert: a fake bank text", "what_happened": "Sample data for screenshots. A text pretending to be the bank asked them to log in.",
        "what_to_do": "Don't open the link. Call the bank on the number on the card.", "involved_label": "Website",
        "involved": "bank-verify.example", "case_ref": "TC-SAMPLE", "occurred_at": now,
    })).raise_for_status()
    (await api.post("/family/incidents/share", headers=them, json={
        "device_id": helper, "scent_id": SAMPLE_INCIDENT, "headline": "Sample incident: bank details shared on a fake site", "state": "barking",
        "events": [{"event_id": SAMPLE_ALERT, "category": "message", "state": "barking", "headline": "Sample alert: a fake bank text", "occurred_at": now, "status": "active"}],
        "steps": [{"id": "call-bank", "text": "Call the bank on the number on the card"}, {"id": "password", "text": "Change the online banking password"}],
        "done": ["call-bank"], "note": "",
    })).raise_for_status()
    return helper


async def _clean_up(device_id: Optional[str], helper: Optional[str]) -> None:
    for did in (device_id, helper):
        if not did:
            continue
        try:
            await account_deletion.purge_device(did)
        except Exception:  # noqa: BLE001
            logger.warning("screens: test device clean-up failed")
    await db.shared_events.delete_many({"event_id": SAMPLE_ALERT})
    await db.shared_incidents.delete_many({"scent_id": SAMPLE_INCIDENT})


# ── Saving and copying to the live panel ─────────────────────────────────────

def _to_live() -> bool:
    return bool(PUBLIC_BASE and ADMIN_KEY)


async def _save(item: dict[str, Any], data: bytes, content_type: str, progress: dict[str, Any]) -> None:
    await gallery.save_image(item, data, content_type)
    if not _to_live():
        return
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(f"{PUBLIC_BASE}/api/admin/screens/ingest", headers={ADMIN_HEADER: ADMIN_KEY},
                                  json={"item": item, "content_type": content_type, "data": base64.b64encode(data).decode("ascii")})
        r.raise_for_status()
    except Exception as exc:  # noqa: BLE001
        progress["live_copy_failed"] = progress.get("live_copy_failed", 0) + 1
        status = getattr(getattr(exc, "response", None), "status_code", None)
        progress["live_copy_error"] = ("the live server doesn't have this update yet" if status == 404 else
                                       f"the live server answered {status}" if status else f"{type(exc).__name__}")


async def _report(run_id: str, progress: dict[str, Any]) -> None:
    await gallery.record_run(run_id, dict(progress))
    if not _to_live():
        return
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            await client.post(f"{PUBLIC_BASE}/api/admin/screens/runs/{run_id}", headers={ADMIN_HEADER: ADMIN_KEY}, json=progress)
    except Exception:  # noqa: BLE001
        pass


async def queue_loop() -> None:
    """In the preview: picks up captures requested from the live admin panel, every 30 seconds."""
    if not _to_live():
        return
    while True:
        await asyncio.sleep(30)
        try:
            if busy() or not await available():
                continue
            async with httpx.AsyncClient(timeout=20) as client:
                r = await client.post(f"{PUBLIC_BASE}/api/admin/screens/queue/claim", headers={ADMIN_HEADER: ADMIN_KEY})
            job = r.json().get("run") if r.status_code == 200 else None
            if job:
                await run(job["run_id"], job.get("keys"), origin="live")
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            logger.warning("screens: live queue check failed")
