"""Family weekly check-in: count-only rollups, Sunday summary push, Tuesday nudge, check-in replies."""
from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Literal, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from core.config import logger
from core.db import db, now_utc

from routers.devices import in_quiet_hours
from routers.push import PUSH_FAMILY, send_push
from routers.family import _link_phone

router = APIRouter()


async def _weekly_rollup(guardian_device_id: str) -> list[dict[str, Any]]:
    links = await db.family_links.find({"guardian_device_id": guardian_device_id, "deleted_at": None}).to_list(20)
    since = now_utc() - timedelta(days=7)
    out = []
    for ln in links:
        pid = ln["protected_device_id"]
        evs = await db.patrol_events.find({"device_id": pid, "deleted_at": None, "occurred_at": {"$gte": since}}, {"state": 1, "status": 1, "category": 1, "occurred_at": 1}).to_list(500)
        by_state = {k: 0 for k in ("sniffing", "resting", "ears_up", "growling", "barking", "biting")}
        for e in evs:
            by_state[e["state"]] = by_state.get(e["state"], 0) + 1
        alerts = [e for e in evs if e["state"] in ("growling", "barking", "biting")]
        open_alerts = sum(1 for e in alerts if e["status"] == "active")
        days = {e["occurred_at"].date().isoformat() for e in evs}
        dev = await db.devices.find_one({"device_id": pid}, {"last_seen_at": 1})
        incs = await db.shared_incidents.find({"protected_device_id": pid, "guardian_device_id": guardian_device_id, "shared_at": {"$gte": since}}, {"resolved": 1}).to_list(50)
        out.append({
            "protected_device_id": pid, "owner_name": ln.get("owner_name", ""), "phone": _link_phone(ln),
            "week_start": since, "total": len(evs), "by_state": by_state, "alerts": len(alerts), "open_alerts": open_alerts,
            "handled_alerts": len(alerts) - open_alerts, "blocked": by_state["biting"], "active_days": len(days),
            "shared_incidents": len(incs), "shared_resolved": sum(1 for i in incs if i.get("resolved")),
            "last_seen_at": (dev or {}).get("last_seen_at"),
        })
    return out


def weekly_sentence(w: dict[str, Any], at: Optional[datetime] = None) -> str:
    """Server-side twin of frontend weeklyHeadline — same calm wording, so the push matches the screen."""
    who = w.get("owner_name") or "your family member"
    seen = w.get("last_seen_at")
    silent_days = ((at or now_utc()) - seen.replace(tzinfo=timezone.utc)).days if seen else 999
    if w["total"] == 0 and silent_days >= 7:
        return f"Apollo hasn't heard from {who}'s phone this week. A friendly check-in would not go amiss."
    if w["total"] == 0:
        return f"A quiet week for {who}. Nothing came up that needed a look."
    if w["open_alerts"] > 0:
        n = w["open_alerts"]
        return f"{who[0].upper() + who[1:]} has {n} alert{'s' if n > 1 else ''} still open this week. I would suggest a call to walk through it."
    if w["alerts"] > 0:
        n = w["alerts"]
        return f"{who[0].upper() + who[1:]} had {n} alert{'s' if n > 1 else ''} this week and handled {'them all' if n > 1 else 'it'}. Quite so."
    return f"A calm week for {who}. Apollo looked at {w['total']} thing{'s' if w['total'] > 1 else ''} and none needed attention."


@router.get("/family/weekly")
async def family_weekly(device_id: str = Query(min_length=8, max_length=64)):
    return await _weekly_rollup(device_id)


# Sunday check-in push — one gentle notification per guardian per week, in their local Sunday evening
# (17:00–20:59 by the device's coarse UTC offset). Counts only; same wording as the Family screen.
WEEKLY_WINDOW = range(17, 21)


def _week_key(local: datetime) -> str:
    iso = local.isocalendar()
    return f"{iso[0]}-W{iso[1]:02d}"


async def send_weekly_checkin(guardian_device_id: str, week_key: str, *, force: bool = False) -> dict[str, Any]:
    rollup = await _weekly_rollup(guardian_device_id)
    if not rollup:
        return {"sent": False, "reason": "no_links"}
    dev = await db.devices.find_one({"device_id": guardian_device_id}) or {}
    if not force and dev.get("weekly_checkin_enabled") is False:
        return {"sent": False, "reason": "opted_out"}
    if not force and await db.weekly_checkin_sends.find_one({"guardian_device_id": guardian_device_id, "week_key": week_key}):
        return {"sent": False, "reason": "already_sent"}
    lines = [weekly_sentence(w) for w in rollup]
    message = " ".join(lines[:2]) + (f" And {len(lines) - 2} more — open Family for the full check-in." if len(lines) > 2 else "")
    open_total = sum(w["open_alerts"] for w in rollup)
    title = "Higgins: your Sunday check-in" if open_total == 0 else "Higgins: your Sunday check-in — a call may be in order"
    await send_push(recipients=[guardian_device_id], data={"title": title, "message": message, "action_url": "/family", **PUSH_FAMILY},
                    idempotency_key=f"weekly-{guardian_device_id}-{week_key}" + ("-manual-" + uuid.uuid4().hex[:6] if force else ""))
    if not force:
        await db.weekly_checkin_sends.update_one({"guardian_device_id": guardian_device_id, "week_key": week_key}, {"$set": {"sent_at": now_utc(), "message": message}}, upsert=True)
    return {"sent": True, "title": title, "message": message}


async def weekly_checkin_tick(at: Optional[datetime] = None) -> int:
    """Run every 15 minutes; sends to guardians whose local time is inside the Sunday window."""
    at = at or now_utc()
    guardians = await db.family_links.distinct("guardian_device_id", {"deleted_at": None})
    sent = 0
    for gid in guardians:
        dev = await db.devices.find_one({"device_id": gid}) or {}
        tz = int(dev.get("tz_offset_minutes") or ((dev.get("settings") or {}).get("quiet_hours") or {}).get("tz_offset_minutes", 0) or 0)
        local = at + timedelta(minutes=tz)
        if local.weekday() != 6 or local.hour not in WEEKLY_WINDOW or in_quiet_hours((dev.get("settings") or {}).get("quiet_hours"), at):
            continue
        try:
            r = await send_weekly_checkin(gid, _week_key(local))
            sent += int(bool(r.get("sent")))
        except Exception as exc:  # noqa: BLE001
            logger.warning("weekly check-in push failed for a guardian (non-blocking): %s", type(exc).__name__)
    return sent


# Missed Check-In Nudge — Tuesday evening (same local window), one per guardian per week: names the people they
# haven't said hello to since Sunday. Same opt-out and quiet hours as the Sunday summary.
async def send_missed_checkin_nudge(guardian_device_id: str, local: datetime, *, force: bool = False) -> dict[str, Any]:
    dev = await db.devices.find_one({"device_id": guardian_device_id}) or {}
    if not force and dev.get("weekly_checkin_enabled") is False:
        return {"sent": False, "reason": "opted_out"}
    week_key = _week_key(local)
    if not force and await db.weekly_nudge_sends.find_one({"guardian_device_id": guardian_device_id, "week_key": week_key}):
        return {"sent": False, "reason": "already_sent"}
    links = await db.family_links.find({"guardian_device_id": guardian_device_id, "deleted_at": None}).to_list(20)
    if not links:
        return {"sent": False, "reason": "no_links"}
    # "since Sunday" = 00:00 of the most recent local Sunday, expressed in UTC using the device's coarse offset.
    tz_minutes = int(dev.get("tz_offset_minutes") or 0)
    sunday_local = (local - timedelta(days=(local.weekday() + 1) % 7)).replace(hour=0, minute=0, second=0, microsecond=0)
    since = (sunday_local - timedelta(minutes=tz_minutes)).replace(tzinfo=timezone.utc)
    missed = []
    for ln in links:
        done = await db.weekly_checkins.find_one({"guardian_device_id": guardian_device_id, "protected_device_id": ln["protected_device_id"], "created_at": {"$gte": since}})
        if not done:
            missed.append(ln.get("owner_name") or "your family member")
    if not missed:
        return {"sent": False, "reason": "all_checked_in"}
    names = missed[0] if len(missed) == 1 else f"{', '.join(missed[:-1])} and {missed[-1]}"
    title = f"Higgins: a hello for {names}, perhaps?"
    message = f"You haven't checked in with {names} since Sunday. A quiet week is rather nicer with a quick call — then do tap \"All good\" in Family."
    await send_push(recipients=[guardian_device_id], data={"title": title, "message": message, "action_url": "/family", **PUSH_FAMILY},
                    idempotency_key=f"nudge-{guardian_device_id}-{week_key}" + ("-manual-" + uuid.uuid4().hex[:6] if force else ""))
    if not force:
        await db.weekly_nudge_sends.update_one({"guardian_device_id": guardian_device_id, "week_key": week_key}, {"$set": {"sent_at": now_utc(), "missed": missed}}, upsert=True)
    return {"sent": True, "title": title, "message": message, "missed": missed}


async def missed_checkin_tick(at: Optional[datetime] = None) -> int:
    at = at or now_utc()
    guardians = await db.family_links.distinct("guardian_device_id", {"deleted_at": None})
    sent = 0
    for gid in guardians:
        dev = await db.devices.find_one({"device_id": gid}) or {}
        tz = int(dev.get("tz_offset_minutes") or ((dev.get("settings") or {}).get("quiet_hours") or {}).get("tz_offset_minutes", 0) or 0)
        local = at + timedelta(minutes=tz)
        if local.weekday() != 1 or local.hour not in WEEKLY_WINDOW or in_quiet_hours((dev.get("settings") or {}).get("quiet_hours"), at):
            continue
        try:
            r = await send_missed_checkin_nudge(gid, local.replace(tzinfo=None))
            sent += int(bool(r.get("sent")))
        except Exception as exc:  # noqa: BLE001
            logger.warning("missed check-in nudge failed for a guardian (non-blocking): %s", type(exc).__name__)
    return sent


async def weekly_checkin_loop() -> None:
    while True:
        for tick in (weekly_checkin_tick, missed_checkin_tick):
            try:
                await tick()
            except Exception as exc:  # noqa: BLE001
                logger.warning("%s failed: %s", tick.__name__, type(exc).__name__)
        await asyncio.sleep(15 * 60)


class WeeklyPrefIn(BaseModel):
    device_id: str = Field(min_length=8, max_length=64)
    enabled: bool = True


@router.put("/family/weekly/notify")
async def set_weekly_pref(body: WeeklyPrefIn):
    await db.devices.update_one({"device_id": body.device_id}, {"$set": {"weekly_checkin_enabled": body.enabled, "last_seen_at": now_utc()}}, upsert=True)
    return {"enabled": body.enabled}


@router.get("/family/weekly/notify")
async def get_weekly_pref(device_id: str = Query(min_length=8, max_length=64)):
    dev = await db.devices.find_one({"device_id": device_id}) or {}
    last = await db.weekly_checkin_sends.find_one({"guardian_device_id": device_id}, sort=[("sent_at", -1)])
    return {"enabled": dev.get("weekly_checkin_enabled", True) is not False, "last_sent_at": (last or {}).get("sent_at"), "window": "Sunday 5–9 pm, your local time"}


# Check-In Reply — the guardian taps "All good, spoke to Mum" on the Sunday summary; the family member sees who
# checked in. One reply per guardian per person per week (re-tapping updates it).
CHECKIN_LABEL = {"spoke": "All good, spoke to them", "messaged": "Messaged them, all good", "will_call": "Will call them this week"}


class CheckinIn(BaseModel):
    device_id: str = Field(min_length=8, max_length=64)  # guardian device
    protected_device_id: str = Field(min_length=8, max_length=64)
    reply: Literal["spoke", "messaged", "will_call"] = "spoke"
    from_name: str = Field(default="", max_length=40)


@router.post("/family/weekly/checkin")
async def weekly_checkin_reply(body: CheckinIn):
    link = await db.family_links.find_one({"guardian_device_id": body.device_id, "protected_device_id": body.protected_device_id, "deleted_at": None})
    if not link:
        raise HTTPException(status_code=404, detail="You're not paired with that person.")
    from_name = body.from_name.strip()
    if from_name:
        await db.family_links.update_one({"_id": link["_id"]}, {"$set": {"guardian_label": from_name}})
    guardian_label = from_name or link.get("guardian_label") or "A family member"
    owner = link.get("owner_name") or "you"
    ts = now_utc()
    week_key = _week_key(ts)
    label = CHECKIN_LABEL[body.reply]
    await db.weekly_checkins.update_one({"guardian_device_id": body.device_id, "protected_device_id": body.protected_device_id, "week_key": week_key}, {"$set": {
        "guardian_device_id": body.device_id, "protected_device_id": body.protected_device_id, "week_key": week_key,
        "guardian_label": guardian_label, "reply": body.reply, "label": label, "created_at": ts}}, upsert=True)
    try:
        await send_push(recipients=[body.protected_device_id],
                        data={"title": f"{guardian_label} checked in", "message": label.replace("them", owner if owner != "you" else "you"), "action_url": "/family", **PUSH_FAMILY},
                        idempotency_key=f"checkin-{body.device_id}-{body.protected_device_id}-{week_key}-{body.reply}")
    except Exception as exc:  # noqa: BLE001
        logger.warning("check-in push failed (non-blocking): %s", type(exc).__name__)
    return {"checked_in": True, "label": label, "week_key": week_key, "guardian_label": guardian_label}


@router.get("/family/weekly/checkins")
async def list_weekly_checkins(device_id: str = Query(min_length=8, max_length=64)):
    """Protected user: check-ins they received (last 8 weeks). Guardian: the ones they sent (to mark the button done)."""
    since = now_utc() - timedelta(weeks=8)
    docs = await db.weekly_checkins.find({"created_at": {"$gte": since}, "$or": [{"protected_device_id": device_id}, {"guardian_device_id": device_id}]}).sort("created_at", -1).to_list(100)
    return [{k: v for k, v in d.items() if k != "_id"} for d in docs]


class WeeklySendNowIn(BaseModel):
    device_id: str = Field(min_length=8, max_length=64)
    preview_only: bool = False  # True → compose the text without pushing (works on web / Expo Go)
    kind: Literal["summary", "nudge"] = "summary"


@router.post("/family/weekly/send-now")
async def weekly_send_now(body: WeeklySendNowIn):
    """Guardian asks to see this week's check-in (or the Tuesday nudge) as a notification right now, or just its text."""
    if body.kind == "nudge":
        dev = await db.devices.find_one({"device_id": body.device_id}) or {}
        local = (now_utc() + timedelta(minutes=int(dev.get("tz_offset_minutes") or 0))).replace(tzinfo=None)
        if body.preview_only:
            links = await db.family_links.find({"guardian_device_id": body.device_id, "deleted_at": None}).to_list(20)
            if not links:
                return {"sent": False, "reason": "no_links"}
            names = [ln.get("owner_name") or "your family member" for ln in links]
            who = names[0] if len(names) == 1 else f"{', '.join(names[:-1])} and {names[-1]}"
            return {"sent": False, "preview": True, "title": f"Higgins: a hello for {who}, perhaps?", "message": f"You haven't checked in with {who} since Sunday. A quiet week is rather nicer with a quick call — then do tap \"All good\" in Family."}
        try:
            return await send_missed_checkin_nudge(body.device_id, local, force=True)
        except HTTPException:
            raise
        except Exception:  # noqa: BLE001
            raise HTTPException(status_code=502, detail="Apollo's alert relay didn't respond. Try again in a minute.")
    if body.preview_only:
        rollup = await _weekly_rollup(body.device_id)
        if not rollup:
            return {"sent": False, "reason": "no_links"}
        lines = [weekly_sentence(w) for w in rollup]
        return {"sent": False, "preview": True, "title": "Higgins: your Sunday check-in", "message": " ".join(lines[:2]) + (f" And {len(lines) - 2} more — open Family for the full check-in." if len(lines) > 2 else "")}
    try:
        return await send_weekly_checkin(body.device_id, _week_key(now_utc()), force=True)
    except HTTPException:
        raise
    except Exception:  # noqa: BLE001
        raise HTTPException(status_code=502, detail="Apollo's alert relay didn't respond. Try again in a minute.")
