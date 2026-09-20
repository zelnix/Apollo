"""Generic IMAP connection & manual inbox scan. See services/imapmail.py for the IMAP details.

Privacy contract: /imap/scan returns message content to the caller for THIS request only -- it is
never written to Mongo. Only the encrypted app password is persisted, and only until the user
disconnects (DELETE /imap/connection)."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from core.db import db, now_utc
from services import imapmail

router = APIRouter()

COMMON_PROVIDERS = [
    {"label": "Gmail / Google Workspace", "host": "imap.gmail.com", "port": 993, "ssl": True},
    {"label": "Outlook.com / Microsoft 365", "host": "outlook.office365.com", "port": 993, "ssl": True},
    {"label": "Yahoo Mail", "host": "imap.mail.yahoo.com", "port": 993, "ssl": True},
    {"label": "iCloud Mail", "host": "imap.mail.me.com", "port": 993, "ssl": True},
]

_BAD_HOST_CHARS = set("@/ ")
_BAD_USERNAME_CHARS = set("\r\n")


class ImapConnectIn(BaseModel):
    device_id: str = Field(min_length=8, max_length=64)
    host: str = Field(min_length=1, max_length=255)
    port: int = Field(default=993, ge=1, le=65535)
    ssl: bool = True
    username: str = Field(min_length=1, max_length=320)
    app_password: str = Field(min_length=1, max_length=512)


@router.get("/imap/providers")
async def imap_providers():
    return {"providers": COMMON_PROVIDERS}


@router.post("/imap/connections", status_code=201)
async def imap_connect(body: ImapConnectIn):
    if not imapmail.configured():
        raise HTTPException(503, "IMAP isn't configured on this build")
    if any(c in _BAD_HOST_CHARS for c in body.host) or any(c in _BAD_USERNAME_CHARS for c in body.username):
        raise HTTPException(400, "Invalid host or username")
    await imapmail.test_connection(body.host, body.port, body.ssl, body.username, body.app_password)
    await imapmail.save_connection(body.device_id, body.host, body.port, body.ssl, body.username, body.app_password)
    return {"connected": True, "host": body.host, "username": body.username}


@router.get("/imap/status")
async def imap_status(device_id: str = Query(min_length=8, max_length=64)):
    row = await imapmail.get_connection(device_id)
    return {"connected": row is not None, "configured": imapmail.configured(), "host": row.get("host") if row else None,
            "username": row.get("username") if row else None, "monitoring_enabled": bool(row and row.get("monitoring_enabled"))}


class ImapMonitoringIn(BaseModel):
    device_id: str = Field(min_length=8, max_length=64)
    enabled: bool


@router.post("/imap/monitoring")
async def imap_monitoring(body: ImapMonitoringIn):
    result = await db.imap_connections.update_one({"device_id": body.device_id},
        {"$set": {"monitoring_enabled": body.enabled, "updated_at": now_utc()}})
    if not result.matched_count:
        raise HTTPException(404, "Connect the inbox before enabling monitoring")
    return {"monitoring_enabled": body.enabled}


@router.delete("/imap/connection", status_code=204)
async def imap_disconnect(device_id: str = Query(min_length=8, max_length=64)):
    await imapmail.disconnect(device_id)


class ImapLinkOut(BaseModel):
    text: str
    href: str


class ImapScanMessage(BaseModel):
    id: str
    from_: str = Field(alias="from")
    subject: str
    date: str
    body: str
    links: list[ImapLinkOut] = Field(default_factory=list)

    class Config:
        populate_by_name = True


class ImapScanIn(BaseModel):
    device_id: str = Field(min_length=8, max_length=64)


@router.post("/imap/scan", response_model=list[ImapScanMessage])
async def imap_scan(body: ImapScanIn):
    messages = await imapmail.scan_inbox(body.device_id)
    return [ImapScanMessage(**m) for m in messages]
