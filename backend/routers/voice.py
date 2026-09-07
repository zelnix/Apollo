"""Higgins' voice — OpenAI TTS via the Emergent LLM key, cached mp3 served from our own store."""
from __future__ import annotations

import asyncio
import re
from hashlib import sha256

import emoji
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field

from core.config import EMERGENT_LLM_KEY, HIGGINS_TTS, logger
from core.db import db, now_utc

router = APIRouter()


def clean_for_tts(text: str) -> str:
    text = emoji.replace_emoji(text, replace="")
    text = re.sub(r"https?://\S+", "a web address", text)
    text = re.sub(r"`{1,3}[^`]*`{1,3}", "", text)
    text = re.sub(r"[*_#>~|]", "", text)
    text = text.replace("Wi‑Fi", "wifi").replace("Wi-Fi", "wifi").replace("MFA", "M F A").replace("URL", "web address")
    return re.sub(r"\s+", " ", text).strip()


class SpeakIn(BaseModel):
    device_id: str = Field(min_length=8, max_length=64)
    text: str = Field(min_length=1, max_length=1500)


@router.post("/voice/speak")
async def voice_speak(body: SpeakIn):
    text = clean_for_tts(body.text)
    if not text:
        raise HTTPException(status_code=422, detail="Nothing to say.")
    key = sha256(f"{text}|{HIGGINS_TTS['voice']}|{HIGGINS_TTS['speed']}|{HIGGINS_TTS['model']}|mp3".encode()).hexdigest()[:40]
    if not await db.voice_cache.find_one({"key": key}, {"_id": 1}):
        if not EMERGENT_LLM_KEY:
            raise HTTPException(status_code=503, detail="Higgins' voice isn't configured on this server.")
        from emergentintegrations.llm.openai import OpenAITextToSpeech
        try:
            audio = await asyncio.wait_for(OpenAITextToSpeech(api_key=EMERGENT_LLM_KEY).generate_speech(text=text, model=HIGGINS_TTS["model"], voice=HIGGINS_TTS["voice"], speed=HIGGINS_TTS["speed"], response_format="mp3"), timeout=30)
        except Exception as exc:  # noqa: BLE001
            logger.warning("tts failed: %s", type(exc).__name__)
            raise HTTPException(status_code=502, detail="Higgins has lost his voice for a moment. Do try again shortly.")
        await db.voice_cache.update_one({"key": key}, {"$set": {"key": key, "audio": audio, "chars": len(text), "created_at": now_utc()}}, upsert=True)
    return {"url": f"/api/voice/{key}.mp3", "chars": len(text)}


@router.get("/voice/{key}.mp3")
async def voice_audio(key: str):
    doc = await db.voice_cache.find_one({"key": key})
    if not doc:
        raise HTTPException(status_code=404, detail="Not found")
    return Response(content=bytes(doc["audio"]), media_type="audio/mpeg", headers={"Cache-Control": "public, max-age=31536000"})
