"""Family sharing: guardians (email), device pairing, shared events, acks, incidents and reassurance notes."""
from __future__ import annotations

import asyncio
import hmac
import re
import secrets
import uuid
from hashlib import sha256
from datetime import datetime, timedelta, timezone
from html import escape
from typing import Any, Literal, Optional

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from core.config import EMAIL_FROM_NAME, PUBLIC_BASE, URL_HMAC_SECRET, logger
from core.db import BaseDocument, db, now_utc
from core.models import ApolloState, PatrolEvent
from services.email import send_email, _wrap
from services.storage import StorageError, get_object, put_object, voice_note_path
from services.transcribe import caption_voice_note
from routers.push import PUSH_FAMILY, PUSH_THREAT, send_push

router = APIRouter()


class GuardianIn(BaseModel):
    device_id: str = Field(min_length=8, max_length=64)
    email: str = Field(min_length=5, max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    name: str = Field(default="", max_length=60)
    owner_name: str = Field(default="", max_length=60)


class Guardian(BaseDocument):
    guardian_id: str
    device_id: str
    email: str
    name: str
    owner_name: str
    confirmed: bool
    confirm_token: str
    created_at: datetime
    deleted_at: Optional[datetime] = None
    sent_today: int = 0
    sent_day: str = ""


@router.post("/family/guardians")
async def add_guardian(body: GuardianIn):
    count = await db.guardians.count_documents({"device_id": body.device_id, "deleted_at": None})
    if count >= 3:
        raise HTTPException(status_code=400, detail="Up to 3 trusted family members")
    g = Guardian(guardian_id=uuid.uuid4().hex, device_id=body.device_id, email=body.email.lower(), name=body.name, owner_name=body.owner_name,
                 confirmed=False, confirm_token=secrets.token_urlsafe(24), created_at=now_utc())
    # Single-purpose, single-use, expiring confirmation link (72 h). This is the only unauthenticated write path.
    await db.guardians.insert_one({**g.to_mongo(), "confirm_expires_at": now_utc() + timedelta(hours=72)})
    link = f"{PUBLIC_BASE}/api/family/confirm/{g.confirm_token}" if PUBLIC_BASE.startswith("https://") else None
    who = escape(body.owner_name) or "someone you know"
    html = _wrap(f"<p>Hi {escape(body.name) or 'there'},</p><p>{who} uses {escape(EMAIL_FROM_NAME)} to stay safe from dangerous links and has asked to share safety alerts with you. "
                 f"You would only receive plain-language notices when Apollo is <strong>barking</strong> (action needed) or <strong>biting</strong> (a threat was blocked).</p>"
                 + (f'<p><a href="{link}">Yes, send me these alerts</a></p>' if link else "<p>Ask them to confirm this in the app.</p>")
                 + "<p>If you did not expect this, simply ignore this email.</p>")
    try:
        await send_email(to=g.email, subject=f"{who} wants to share Apollo safety alerts with you", html=html)
    except HTTPException as exc:
        await db.guardians.update_one({"guardian_id": g.guardian_id}, {"$set": {"deleted_at": now_utc()}})
        raise exc
    return {"guardian_id": g.guardian_id, "confirmed": False}


@router.get("/family/confirm/{token}")
async def confirm_guardian(token: str):
    from fastapi.responses import HTMLResponse
    result = await db.guardians.update_one({"confirm_token": token, "deleted_at": None, "$or": [{"confirm_expires_at": {"$gt": now_utc()}}, {"confirm_expires_at": None}]},
                                           {"$set": {"confirmed": True, "confirm_token": None, "confirmed_at": now_utc()}})  # single-use: token cleared
    msg = "You're now receiving Apollo safety alerts. You can stop any time by asking the person who added you." if result.matched_count else "This link is no longer valid."
    return HTMLResponse(f"<html><body style='font-family:Arial;padding:32px;background:#0B1220;color:#F4F7FA'><h2>Apollo</h2><p>{msg}</p></body></html>")


@router.get("/family/guardians")
async def list_guardians(device_id: str = Query(min_length=8, max_length=64)):
    docs = await db.guardians.find({"device_id": device_id, "deleted_at": None}).to_list(10)
    return [{"guardian_id": d["guardian_id"], "email": d["email"], "name": d["name"], "confirmed": d["confirmed"], "created_at": d["created_at"]} for d in docs]


@router.delete("/family/guardians/{guardian_id}")
async def remove_guardian(guardian_id: str, device_id: str = Query(min_length=8, max_length=64)):
    r = await db.guardians.update_one({"guardian_id": guardian_id, "device_id": device_id, "deleted_at": None}, {"$set": {"deleted_at": now_utc()}})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return {"removed": True}


async def notify_guardians(event: PatrolEvent) -> None:
    try:
        guardians = await db.guardians.find({"device_id": event.device_id, "deleted_at": None, "confirmed": True}).to_list(10)
        links = await db.family_links.find({"protected_device_id": event.device_id, "deleted_at": None}).to_list(10)
        # fan out to paired guardian devices (in-app + push)
        for ln in links:
            await db.shared_events.update_one({"event_id": event.event_id, "guardian_device_id": ln["guardian_device_id"]}, {"$set": {
                "event_id": event.event_id, "guardian_device_id": ln["guardian_device_id"], "protected_device_id": event.device_id, "from_label": ln.get("owner_name") or "Family member",
                "state": event.state, "headline": event.headline, "what_to_do": event.what_to_do, "indicator_host": event.indicator_host, "occurred_at": event.occurred_at, "created_at": now_utc()}}, upsert=True)
        if links:
            who = links[0].get("owner_name") or "A family member"
            verb = "needs to be careful" if event.state == "barking" else "was protected"
            try:
                await send_push(
                    recipients=[ln["guardian_device_id"] for ln in links][:100],
                    data={"title": f"Apollo: {who} {verb}", "message": event.headline, "subtext": "Tap to see the alert and call them.", "action_url": f"/family/alert/{event.event_id}", **PUSH_THREAT},
                    idempotency_key=f"guardian-{event.event_id}",
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning("guardian push failed (non-blocking): %s", type(exc).__name__)
        today = now_utc().strftime("%Y-%m-%d")
        for g in guardians:
            sent = g.get("sent_today", 0) if g.get("sent_day") == today else 0
            if sent >= 5:
                continue
            who = escape(g.get("owner_name") or "Your family member")
            verb = "needs to be careful" if event.state == "barking" else "was protected"
            html = _wrap(f"<p>Hi {escape(g.get('name') or 'there')},</p><p>{who} {verb}: <strong>{escape(event.headline)}</strong></p>"
                         f"<p>{escape(event.what_happened)}</p><p><strong>What to do:</strong> {escape(event.what_to_do)}</p>"
                         f"<p>Website involved: {escape(event.indicator_host or 'n/a')}. A quick call to check in is usually the most helpful thing.</p>")
            await send_email(to=g["email"], subject=f"Apollo alert: {who} {verb}", html=html)
            await db.guardians.update_one({"guardian_id": g["guardian_id"]}, {"$set": {"sent_day": today, "sent_today": sent + 1}})
    except Exception as exc:  # noqa: BLE001
        logger.warning("guardian notify failed: %s", type(exc).__name__)


class PairRequest(BaseModel):
    device_id: str = Field(min_length=8, max_length=64)
    owner_name: str = Field(default="", max_length=60)
    phone: str = Field(default="", max_length=24)  # optional; shared only with the family member who links


class LinkRequest(BaseModel):
    device_id: str = Field(min_length=8, max_length=64)
    code: str = Field(min_length=6, max_length=6)
    guardian_name: str = Field(default="", max_length=40)  # how the protected person will see this watcher


_PHONE_OK = set("+0123456789 ()-")


def _clean_phone(p: str) -> str:
    p = p.strip()
    if p and (any(ch not in _PHONE_OK for ch in p) or sum(ch.isdigit() for ch in p) < 6):
        raise HTTPException(status_code=400, detail="Enter a valid phone number")
    return p


@router.post("/family/pair")
async def create_pair_code(body: PairRequest):
    phone = _clean_phone(body.phone)
    code = "".join(secrets.choice("ABCDEFGHJKLMNPQRSTUVWXYZ23456789") for _ in range(6))
    await db.pair_codes.insert_one({"code": code, "protected_device_id": body.device_id, "owner_name": body.owner_name, "owner_phone": phone, "created_at": now_utc(), "expires_at": now_utc() + timedelta(hours=24), "used": False})
    if phone:  # keep existing links in sync so watchers always have the latest number
        await db.family_links.update_many({"protected_device_id": body.device_id, "deleted_at": None}, {"$set": {"owner_phone": phone}})
    return {"code": code, "expires_in_hours": 24}


@router.post("/family/link")
async def link_device(body: LinkRequest):
    pc = await db.pair_codes.find_one({"code": body.code.upper(), "used": False})
    if not pc or pc["expires_at"].replace(tzinfo=timezone.utc) < now_utc():
        raise HTTPException(status_code=404, detail="Code not found or expired")
    if pc["protected_device_id"] == body.device_id:
        raise HTTPException(status_code=400, detail="You can't link a device to itself")
    await db.pair_codes.update_one({"_id": pc["_id"]}, {"$set": {"used": True}})
    await db.family_links.update_one({"protected_device_id": pc["protected_device_id"], "guardian_device_id": body.device_id},
                                     {"$set": {"protected_device_id": pc["protected_device_id"], "guardian_device_id": body.device_id, "owner_name": pc.get("owner_name", ""), "owner_phone": pc.get("owner_phone", ""), "created_at": now_utc(), "deleted_at": None,
                                               **({"guardian_label": body.guardian_name.strip()} if body.guardian_name.strip() else {})}}, upsert=True)
    return {"linked": True, "owner_name": pc.get("owner_name", "")}


class WatcherNameIn(BaseModel):
    device_id: str = Field(min_length=8, max_length=64)
    name: str = Field(min_length=1, max_length=40)


@router.put("/family/links/{link_id}/name")
async def rename_watcher(link_id: str, body: WatcherNameIn):
    """A guardian sets/changes how they appear on the protected person's phone ("Sarah", "Dad")."""
    try:
        oid = ObjectId(link_id)
    except (InvalidId, TypeError):
        raise HTTPException(status_code=404, detail="Unknown pairing.")
    r = await db.family_links.update_one({"_id": oid, "guardian_device_id": body.device_id, "deleted_at": None}, {"$set": {"guardian_label": body.name.strip()}})
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="Unknown pairing.")
    return {"name": body.name.strip()}


class PhoneIn(BaseModel):
    device_id: str = Field(min_length=8, max_length=64)  # caller (guardian)
    protected_device_id: str = Field(min_length=8, max_length=64)
    phone: str = Field(default="", max_length=24)


@router.post("/family/links/phone")
async def set_link_phone(body: PhoneIn):
    """Watcher edits/adds the number they call for a person they watch (overrides the owner-supplied one)."""
    phone = _clean_phone(body.phone)
    r = await db.family_links.update_one({"protected_device_id": body.protected_device_id, "guardian_device_id": body.device_id, "deleted_at": None}, {"$set": {"guardian_phone": phone}})
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="Link not found")
    return {"phone": phone}


def _link_phone(ln: dict[str, Any]) -> str:
    return ln.get("guardian_phone") or ln.get("owner_phone") or ""


@router.get("/family/links")
async def list_links(device_id: str = Query(min_length=8, max_length=64)):
    protecting = await db.family_links.find({"guardian_device_id": device_id, "deleted_at": None}).to_list(20)
    watched_by = await db.family_links.find({"protected_device_id": device_id, "deleted_at": None}).to_list(20)
    # `watching_me` stays a count for compatibility; `watchers` lists each paired device (label + since, never its id) so the
    # protected person can remove one. `link_id` is the handle for DELETE /family/links/{link_id}.
    return {
        "i_watch": [{"link_id": str(l["_id"]), "owner_name": l.get("owner_name", ""), "protected_device_id": l["protected_device_id"], "phone": _link_phone(l), "since": l["created_at"], "my_label": l.get("guardian_label") or ""} for l in protecting],
        "watching_me": len(watched_by),
        "watchers": [{"link_id": str(l["_id"]), "guardian_label": l.get("guardian_label") or "A family member", "since": l["created_at"], "last_checkin_at": l.get("last_checkin_at")} for l in watched_by],
    }


@router.delete("/family/links/{link_id}", status_code=204)
async def unlink_device(link_id: str, device_id: str = Query(min_length=8, max_length=64)):
    """Either side may end a pairing: the protected person removes a watcher, or a guardian stops watching.
    Soft delete — the other device simply stops receiving fan-outs, pushes and weekly rollups (all filter deleted_at=None)."""
    try:
        oid = ObjectId(link_id)
    except (InvalidId, TypeError):
        raise HTTPException(status_code=404, detail="Unknown pairing.")
    r = await db.family_links.update_one(
        {"_id": oid, "deleted_at": None, "$or": [{"protected_device_id": device_id}, {"guardian_device_id": device_id}]},
        {"$set": {"deleted_at": now_utc(), "unlinked_by": device_id}},
    )
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="Unknown pairing.")
    return Response(status_code=204)


@router.get("/family/shared-events")
async def shared_events(device_id: str = Query(min_length=8, max_length=64)):
    docs = await db.shared_events.find({"guardian_device_id": device_id}).sort("occurred_at", -1).to_list(100)
    links = {l["protected_device_id"]: l for l in await db.family_links.find({"guardian_device_id": device_id, "deleted_at": None}).to_list(20)}
    return [{**{k: v for k, v in d.items() if k != "_id"}, "phone": _link_phone(links.get(d.get("protected_device_id", ""), {}))} for d in docs]


class AckIn(BaseModel):
    device_id: str = Field(min_length=8, max_length=64)  # guardian device
    reply: Literal["called", "messaged", "visiting", "noted"] = "called"


ACK_LABEL = {"called": "I called them", "messaged": "I messaged them", "visiting": "I'm visiting them", "noted": "Noted, no action needed"}


@router.post("/family/shared-events/{event_id}/ack")
async def ack_shared_event(event_id: str, body: AckIn):
    """Guardian Reply: the family member marks how they responded; both sides see it."""
    se = await db.shared_events.find_one({"event_id": event_id, "guardian_device_id": body.device_id})
    if not se:
        raise HTTPException(status_code=404, detail="Alert not found")
    ts = now_utc()
    link = await db.family_links.find_one({"guardian_device_id": body.device_id, "deleted_at": None})
    await db.shared_events.update_one({"_id": se["_id"]}, {"$set": {"acknowledged_at": ts, "ack_label": ACK_LABEL[body.reply]}})
    ev = await db.patrol_events.find_one({"event_id": event_id})
    if ev:
        guardian_label = (link or {}).get("guardian_label") or "A family member"
        await db.family_acks.update_one({"event_id": event_id, "guardian_device_id": body.device_id}, {"$set": {
            "event_id": event_id, "protected_device_id": ev["device_id"], "guardian_device_id": body.device_id,
            "guardian_label": guardian_label, "ack_label": ACK_LABEL[body.reply], "headline": ev["headline"], "acknowledged_at": ts}}, upsert=True)
        try:
            await send_push(
                recipients=[ev["device_id"]],
                data={"title": f"{guardian_label} replied: {ACK_LABEL[body.reply]}", "message": ev["headline"], "action_url": "/family", **PUSH_FAMILY},
                idempotency_key=f"ack-{event_id}-{body.device_id}",
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("ack push failed (non-blocking): %s", type(exc).__name__)
    return {"acknowledged": True, "ack_label": ACK_LABEL[body.reply]}


# ---------------------------------------------------------------------------
# Family Incident Sharing — the protected person explicitly shares ONE incident (Threat Scent timeline + the
# combined Stay With Me plan and tick progress) with paired guardians. Minimal fields only; no message text.
# ---------------------------------------------------------------------------

class SharedIncidentEvent(BaseModel):
    event_id: str = Field(max_length=64)
    category: str = Field(max_length=20)
    state: ApolloState
    headline: str = Field(max_length=200)
    occurred_at: str = Field(max_length=40)
    status: str = Field(default="active", max_length=20)


class SharedIncidentStep(BaseModel):
    id: str = Field(max_length=40)
    text: str = Field(max_length=400)


class ShareIncidentIn(BaseModel):
    device_id: str = Field(min_length=8, max_length=64)
    scent_id: str = Field(min_length=4, max_length=64)
    headline: str = Field(max_length=200)
    state: ApolloState
    events: list[SharedIncidentEvent] = Field(max_length=30)
    steps: list[SharedIncidentStep] = Field(max_length=30)
    done: list[str] = Field(default_factory=list, max_length=30)
    note: str = Field(default="", max_length=300)


class IncidentProgressIn(BaseModel):
    device_id: str = Field(min_length=8, max_length=64)
    done: list[str] = Field(default_factory=list, max_length=30)
    resolved: bool = False


def _incident_out(d: dict[str, Any], links: dict[str, dict[str, Any]]) -> dict[str, Any]:
    return {**{k: v for k, v in d.items() if k != "_id"}, "phone": _link_phone(links.get(d.get("protected_device_id", ""), {}))}


@router.post("/family/incidents/share")
async def share_incident(body: ShareIncidentIn):
    links = await db.family_links.find({"protected_device_id": body.device_id, "deleted_at": None}).to_list(10)
    ts = now_utc()
    for ln in links:
        await db.shared_incidents.update_one({"scent_id": body.scent_id, "guardian_device_id": ln["guardian_device_id"]}, {"$set": {
            "scent_id": body.scent_id, "guardian_device_id": ln["guardian_device_id"], "protected_device_id": body.device_id,
            "from_label": ln.get("owner_name") or "Family member", "headline": body.headline, "state": body.state,
            "events": [e.model_dump() for e in body.events], "steps": [s.model_dump() for s in body.steps], "done": body.done, "note": body.note,
            "resolved": False, "shared_at": ts, "updated_at": ts}}, upsert=True)
    if links:
        who = links[0].get("owner_name") or "A family member"
        try:
            await send_push(recipients=[ln["guardian_device_id"] for ln in links][:100],
                            data={"title": f"Higgins: {who} is asking for your help", "message": body.headline, "subtext": "Do have a look at what happened and the steps they're working through.", "action_url": f"/family/incident/{body.scent_id}", **PUSH_THREAT},
                            idempotency_key=f"incident-{body.scent_id}-{ts.isoformat()[:16]}")
        except Exception as exc:  # noqa: BLE001
            logger.warning("incident push failed (non-blocking): %s", type(exc).__name__)
    return {"shared_with": len(links)}


@router.patch("/family/incidents/{scent_id}/progress")
async def incident_progress(scent_id: str, body: IncidentProgressIn):
    r = await db.shared_incidents.update_many({"scent_id": scent_id, "protected_device_id": body.device_id}, {"$set": {"done": body.done, "resolved": body.resolved, "updated_at": now_utc()}})
    return {"updated": r.matched_count}


@router.get("/family/incidents")
async def list_shared_incidents(device_id: str = Query(min_length=8, max_length=64)):
    docs = await db.shared_incidents.find({"guardian_device_id": device_id}).sort("updated_at", -1).to_list(50)
    links = {l["protected_device_id"]: l for l in await db.family_links.find({"guardian_device_id": device_id, "deleted_at": None}).to_list(20)}
    return [_incident_out(d, links) for d in docs]


@router.get("/family/incidents/{scent_id}")
async def get_shared_incident(scent_id: str, device_id: str = Query(min_length=8, max_length=64)):
    d = await db.shared_incidents.find_one({"scent_id": scent_id, "guardian_device_id": device_id})
    if not d:
        raise HTTPException(status_code=404, detail="Incident not found")
    links = {l["protected_device_id"]: l for l in await db.family_links.find({"guardian_device_id": device_id, "deleted_at": None}).to_list(20)}
    return _incident_out(d, links)


# Family Reassurance Note — a guardian sends a short "I'm here" note back onto a shared incident. Preset kinds
# keep it calm and quick; a custom line is capped short. Never carries passwords/codes (protected user is told so).
NOTE_TEXT = {"here": "I'm here — call me when you're ready.", "calling": "I'm calling you now.", "on_way": "I'm on my way over.", "together": "Don't worry, we'll sort this out together."}


class IncidentNoteIn(BaseModel):
    device_id: str = Field(min_length=8, max_length=64)  # guardian device
    kind: Literal["here", "calling", "on_way", "together", "custom"] = "here"
    text: str = Field(default="", max_length=140)
    from_name: str = Field(default="", max_length=40)
    phone: str = Field(default="", max_length=32)  # guardian's call-back number, optional


@router.post("/family/incidents/{scent_id}/notes", status_code=201)
async def add_incident_note(scent_id: str, body: IncidentNoteIn):
    inc = await db.shared_incidents.find_one({"scent_id": scent_id, "guardian_device_id": body.device_id})
    if not inc:
        raise HTTPException(status_code=404, detail="Incident not found")
    text = body.text.strip() if body.kind == "custom" else NOTE_TEXT[body.kind]
    if not text:
        raise HTTPException(status_code=422, detail="Write a short note first.")
    link_q = {"guardian_device_id": body.device_id, "protected_device_id": inc["protected_device_id"], "deleted_at": None}
    link = await db.family_links.find_one(link_q)
    from_name, phone = body.from_name.strip(), re.sub(r"[^+\d ]", "", body.phone).strip()
    remember = {k: v for k, v in (("guardian_label", from_name), ("guardian_phone", phone)) if v}
    if remember and link:
        await db.family_links.update_one({"_id": link["_id"]}, {"$set": remember})
    guardian_label = from_name or (link or {}).get("guardian_label") or "A family member"
    phone = phone or (link or {}).get("guardian_phone", "")
    note = {"note_id": uuid.uuid4().hex, "scent_id": scent_id, "protected_device_id": inc["protected_device_id"], "guardian_device_id": body.device_id,
            "guardian_label": guardian_label, "kind": body.kind, "text": text, "phone": phone, "created_at": now_utc()}
    await db.incident_notes.insert_one(dict(note))
    try:
        await send_push(recipients=[inc["protected_device_id"]],
                        data={"title": f"{guardian_label}: {text}", "message": inc["headline"], "action_url": f"/patrol/scent/{scent_id}", **PUSH_FAMILY},
                        idempotency_key=f"note-{note['note_id']}")
    except Exception as exc:  # noqa: BLE001
        logger.warning("note push failed (non-blocking): %s", type(exc).__name__)
    return note


@router.get("/family/incidents/{scent_id}/notes")
async def list_incident_notes(scent_id: str, device_id: str = Query(min_length=8, max_length=64)):
    """Protected user sees every guardian's notes; a guardian sees only the notes they sent."""
    docs = await db.incident_notes.find({"scent_id": scent_id, "$or": [{"protected_device_id": device_id}, {"guardian_device_id": device_id}]}).sort("created_at", 1).to_list(50)
    return [{k: v for k, v in d.items() if k not in ("_id", "audio_path")} for d in docs]


# Guardian Voice Note — a short recording (≤ 30 s, ≤ 1 MB) attached to a shared incident so the protected person hears a
# familiar voice. Audio bytes live in Emergent Object Storage; MongoDB owns existence + who may listen. Playback uses a
# short-lived HMAC ticket URL (works on web <audio> and native alike) — never a bearer token in a URL.
VOICE_MAX_BYTES = 1_000_000
VOICE_MAX_SECONDS = 30
VOICE_TYPES = {"audio/m4a": "m4a", "audio/x-m4a": "m4a", "audio/mp4": "m4a", "audio/aac": "aac", "audio/mpeg": "mp3", "audio/webm": "webm", "audio/ogg": "ogg", "audio/wav": "wav", "video/webm": "webm"}
VOICE_TICKET_SECONDS = 600
_background: set[asyncio.Task[None]] = set()  # keeps caption tasks referenced until done


def _voice_sig(note_id: str, exp: int) -> str:
    return hmac.new(URL_HMAC_SECRET.encode(), f"voice:{note_id}:{exp}".encode(), sha256).hexdigest()[:32]


@router.post("/family/incidents/{scent_id}/voice", status_code=201)
async def add_voice_note(request: Request, scent_id: str, device_id: str = Form(min_length=8, max_length=64), from_name: str = Form(default="", max_length=40),
                         duration_s: float = Form(default=0, ge=0, le=VOICE_MAX_SECONDS), file: UploadFile = File(...)):
    # Multipart bodies are not inspected by the router-wide gate → bind the form's device_id to the bearer here.
    if request.state.device["device_id"] != device_id:
        raise HTTPException(status_code=403, detail="That device_id does not belong to this device.")
    inc = await db.shared_incidents.find_one({"scent_id": scent_id, "guardian_device_id": device_id})
    if not inc:
        raise HTTPException(status_code=404, detail="Incident not found")
    ctype = (file.content_type or "").split(";")[0].strip().lower()
    ext = VOICE_TYPES.get(ctype)
    if not ext:
        raise HTTPException(status_code=415, detail="That recording format isn't supported.")
    data = await file.read(VOICE_MAX_BYTES + 1)
    if len(data) > VOICE_MAX_BYTES:
        raise HTTPException(status_code=413, detail="Keep voice notes under 30 seconds.")
    if len(data) < 200:
        raise HTTPException(status_code=422, detail="The recording was empty. Try again.")
    link = await db.family_links.find_one({"guardian_device_id": device_id, "protected_device_id": inc["protected_device_id"], "deleted_at": None})
    if not link:
        raise HTTPException(status_code=403, detail="You're no longer paired with this person.")
    guardian_label = from_name.strip() or link.get("guardian_label") or "A family member"
    if from_name.strip():
        await db.family_links.update_one({"_id": link["_id"]}, {"$set": {"guardian_label": guardian_label}})
    note_id = uuid.uuid4().hex
    path = voice_note_path(device_id, note_id, ext)
    try:
        stored = await put_object(path, data, ctype)
    except StorageError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.detail)
    note = {"note_id": note_id, "scent_id": scent_id, "protected_device_id": inc["protected_device_id"], "guardian_device_id": device_id,
            "guardian_label": guardian_label, "kind": "voice", "text": f"{guardian_label} left you a voice note.", "phone": link.get("guardian_phone", ""),
            "duration_s": round(float(duration_s), 1), "content_type": ctype, "size": stored.get("size", len(data)), "created_at": now_utc(),
            "transcript": "", "transcript_language": None, "transcript_status": "pending"}  # caption arrives asynchronously (services/transcribe.py)
    await db.incident_notes.insert_one({**note, "audio_path": stored.get("path", path)})
    task = asyncio.create_task(caption_voice_note(note_id, data, ext))
    _background.add(task)
    task.add_done_callback(_background.discard)
    try:
        await send_push(recipients=[inc["protected_device_id"]],
                        data={"title": f"{guardian_label} left you a voice note", "message": inc["headline"], "action_url": f"/patrol/scent/{scent_id}", **PUSH_FAMILY},
                        idempotency_key=f"voice-{note_id}")
    except Exception as exc:  # noqa: BLE001
        logger.warning("voice note push failed (non-blocking): %s", type(exc).__name__)
    return note


@router.get("/family/voice/{note_id}/ticket")
async def voice_ticket(note_id: str, device_id: str = Query(min_length=8, max_length=64)):
    """Authenticated: either side of the incident gets a 10-minute playback URL for this note."""
    doc = await db.incident_notes.find_one({"note_id": note_id, "kind": "voice", "$or": [{"protected_device_id": device_id}, {"guardian_device_id": device_id}]})
    if not doc:
        raise HTTPException(status_code=404, detail="Voice note not found")
    exp = int(now_utc().timestamp()) + VOICE_TICKET_SECONDS
    return {"url": f"{PUBLIC_BASE}/api/family/voice-play/{note_id}?exp={exp}&sig={_voice_sig(note_id, exp)}", "expires_at": exp, "content_type": doc["content_type"]}


@router.get("/family/voice-play/{note_id}")
async def voice_play(note_id: str, exp: int = Query(...), sig: str = Query(min_length=32, max_length=32)):
    """Public path (core.auth PUBLIC_PREFIXES) guarded by the HMAC ticket — unguessable, expiring, note-specific."""
    if exp < int(now_utc().timestamp()) or not hmac.compare_digest(sig, _voice_sig(note_id, exp)):
        raise HTTPException(status_code=403, detail="This playback link has expired.")
    doc = await db.incident_notes.find_one({"note_id": note_id, "kind": "voice"})
    if not doc:
        raise HTTPException(status_code=404, detail="Voice note not found")
    try:
        data, ctype = await get_object(doc["audio_path"])
    except StorageError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.detail)
    return Response(content=data, media_type=doc.get("content_type") or ctype, headers={"Cache-Control": "private, max-age=600", "Accept-Ranges": "bytes"})


# Family Weekly Check-In — a calm, count-only summary of a watched person's week. Uses the event summaries the

@router.get("/family/acks")
async def list_acks(device_id: str = Query(min_length=8, max_length=64)):
    docs = await db.family_acks.find({"protected_device_id": device_id}).sort("acknowledged_at", -1).to_list(50)
    return [{k: v for k, v in d.items() if k != "_id"} for d in docs]
