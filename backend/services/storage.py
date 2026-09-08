"""Emergent Managed Object Storage — family voice notes (short audio). Only the backend talks to storage; the app never
sees EMERGENT_LLM_KEY. Ownership/existence live in MongoDB (incident_notes), never probed against storage."""
from __future__ import annotations

import os

import requests
from starlette.concurrency import run_in_threadpool

from core.config import EMERGENT_LLM_KEY, logger

STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
APP_NAME = "apollo-v1"
_storage_key: str | None = None


class StorageError(Exception):
    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status, self.detail = status, detail


def _init() -> str:
    global _storage_key
    if _storage_key:
        return _storage_key
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_LLM_KEY}, timeout=30)
    if resp.status_code != 200:
        raise StorageError(503, "Voice storage is not available right now.")
    _storage_key = resp.json()["storage_key"]
    return _storage_key


def _reset_key() -> None:
    global _storage_key
    _storage_key = None


def _put(path: str, data: bytes, content_type: str) -> dict:
    for attempt in (1, 2):
        resp = requests.put(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": _init(), "Content-Type": content_type}, data=data, timeout=120)
        if resp.status_code == 503 and attempt == 1:
            _reset_key()  # stale storage key → re-init once
            continue
        break
    if resp.status_code == 402:
        raise StorageError(402, "Voice notes are paused: storage credits are used up.")
    if resp.status_code != 200:
        logger.warning("voice upload failed: %s", resp.status_code)
        raise StorageError(503, "Voice storage is not available right now.")
    return resp.json()


def _get(path: str) -> tuple[bytes, str]:
    for attempt in (1, 2):
        resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": _init()}, timeout=60)
        if resp.status_code == 503 and attempt == 1:
            _reset_key()
            continue
        break
    if resp.status_code != 200:
        raise StorageError(503, "That voice note can't be fetched right now.")
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")


async def put_object(path: str, data: bytes, content_type: str) -> dict:
    return await run_in_threadpool(_put, path, data, content_type)


async def get_object(path: str) -> tuple[bytes, str]:
    return await run_in_threadpool(_get, path)


def voice_note_path(guardian_device_id: str, note_id: str, ext: str) -> str:
    return f"{APP_NAME}/family-voice/{guardian_device_id}/{note_id}.{ext}"
