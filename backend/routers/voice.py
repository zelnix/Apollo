"""Owner-scoped, expiring Gemini narration. No public content-derived audio URLs."""
from __future__ import annotations

import re
import uuid

import emoji
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field

from core.db import db, now_utc
from core.redaction import redact_user_secrets
from services.higgins.encryption import decrypt, encrypt
from services.higgins.provider import ProviderFailure, speech_bytes
from services.higgins.retention import delete_scope, open_scope, require_scope, utc
from services.higgins.capacity import SPEECH_SEGMENT_CHARACTERS

router = APIRouter()


def clean_for_tts(text: str) -> str:
    text = emoji.replace_emoji(redact_user_secrets(text), replace="")
    text = re.sub(r"https?://\S+", "a web address", text)
    text = re.sub(r"[*_#>~|]", "", text)
    return re.sub(r"\s+", " ", text).strip()


class SpeakIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    device_id: str = Field(min_length=8, max_length=64)
    text: str = Field(min_length=1, max_length=SPEECH_SEGMENT_CHARACTERS)
    scope_id: str = Field(default_factory=lambda: str(uuid.uuid4()), pattern=r"^[A-Za-z0-9-]{8,64}$")


class SpeakOut(BaseModel):
    url: str
    audio_id: str
    scope_id: str
    chars: int
    expires_at: str
    provider: str = "Gemini"


@router.post("/voice/speak", response_model=SpeakOut)
async def voice_speak(body: SpeakIn, request: Request):
    owner = request.state.device["device_id"]
    scope = await open_scope(owner, body.scope_id)
    text = clean_for_tts(body.text)
    if not text:
        raise HTTPException(422, "Nothing to say.")
    audio_id = str(uuid.uuid4())
    try:
        audio, metadata = await speech_bytes(text)
        await require_scope(owner, body.scope_id)
        if len(audio) > 8_000_000:
            raise HTTPException(413, "The speech segment exceeded its storage budget. Use a shorter segment.")
        await db.voice_cache.insert_one({"device_id": owner, "scope_id": body.scope_id, "audio_id": audio_id,
            "audio_ciphertext": encrypt(audio), "created_at": now_utc(), "expires_at": scope["expires_at"],
            "content_version": 1, "generation": scope["generation"], "provider": metadata["provider"]})
        await db.investigation_scopes.update_one({'owner_id': owner, 'scope_id': body.scope_id}, {'$addToSet': {'audio_ids': audio_id}})
        await require_scope(owner, body.scope_id)
    except ProviderFailure as exc:
        raise HTTPException(503 if exc.code == "provider_configuration" else 502,
                            f"Gemini narration unavailable ({exc.code}). Text remains available.") from exc
    except HTTPException:
        await db.voice_cache.delete_one({"device_id": owner, "audio_id": audio_id})
        raise
    finally:
        text = ""
        audio = b""
    return SpeakOut(url=f"/api/voice/{audio_id}.wav", audio_id=audio_id, scope_id=body.scope_id,
                    chars=len(body.text), expires_at=utc(scope["expires_at"]).isoformat())


@router.get("/voice/{audio_id}.wav")
async def voice_audio(audio_id: str, request: Request):
    owner = request.state.device["device_id"]
    doc = await db.voice_cache.find_one({"device_id": owner, "audio_id": audio_id,
        "expires_at": {"$gt": now_utc()}}, {"_id": 0})
    if not doc:
        known = await db.investigation_scopes.find_one({'owner_id': owner, 'audio_ids': audio_id}, {'_id': 0, 'scope_id': 1})
        if known:
            raise HTTPException(410, 'This temporary audio has expired or was deleted.')
        raise HTTPException(404, "Temporary audio not found or expired.")
    await require_scope(owner, doc["scope_id"])
    return Response(decrypt(doc["audio_ciphertext"]), media_type="audio/wav",
                    headers={"Cache-Control": "private, no-store", "Pragma": "no-cache"})


@router.delete("/voice/sessions/{scope_id}", status_code=204)
async def cancel_voice(scope_id: str, request: Request):
    owner = request.state.device["device_id"]
    await delete_scope(owner, scope_id)
    return Response(status_code=204)


@router.get("/voice/{legacy_key}.mp3")
async def legacy_audio(legacy_key: str):
    raise HTTPException(410, "Legacy public narration was removed. Request new protected audio.")