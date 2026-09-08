"""Voice-note captions — OpenAI Whisper through the Emergent LLM key. Best effort and never blocking: the note is saved and
pushed first; the caption arrives a few seconds later or is honestly marked unavailable. Audio bytes are not kept here."""
from __future__ import annotations

import asyncio
import io

from core.config import EMERGENT_LLM_KEY, logger
from core.db import db, now_utc

TRANSCRIPT_MAX_CHARS = 500
TRANSCRIBE_TIMEOUT_S = 40
HALLUCINATIONS = {"thank you", "thanks for watching", "thank you for watching", "you", "bye", "so", "the end", "music"}


async def transcribe_bytes(data: bytes, ext: str) -> tuple[str, str] | None:
    """Returns (text, language) or None when the caption can't be produced."""
    if not EMERGENT_LLM_KEY:
        return None
    try:
        from emergentintegrations.llm.openai import OpenAISpeechToText
        f = io.BytesIO(data)
        f.name = f"note.{ext}"  # the client validates format by name/extension
        result = await asyncio.wait_for(
            # No style prompt: Whisper echoes prompts back on silence/noise, which would show up as a fake caption.
            OpenAISpeechToText(api_key=EMERGENT_LLM_KEY).transcribe(file=f, model="whisper-1", response_format="verbose_json"),
            timeout=TRANSCRIBE_TIMEOUT_S,
        )
        text = (getattr(result, "text", None) or (result.get("text") if isinstance(result, dict) else "") or "").strip()
        language = getattr(result, "language", None) or (result.get("language") if isinstance(result, dict) else None) or "unknown"
        # Whisper hallucinates on silence/noise (e.g. "Thank you.", "Subtitles by…"). Treat those as "no caption".
        if not text or len(text) < 4 or text.lower().strip(" .!") in HALLUCINATIONS or "subtitle" in text.lower() or "amara.org" in text.lower():
            return None
        return text[:TRANSCRIPT_MAX_CHARS], str(language)
    except Exception as exc:  # noqa: BLE001 — caption is optional; the voice note itself already succeeded
        logger.warning("voice transcription failed (non-blocking): %s", type(exc).__name__)
        return None


async def caption_voice_note(note_id: str, data: bytes, ext: str) -> None:
    """Background task: write transcript_status ready|unavailable onto the incident note."""
    res = await transcribe_bytes(data, ext)
    update = {"transcript": res[0], "transcript_language": res[1], "transcript_status": "ready"} if res else {"transcript": "", "transcript_language": None, "transcript_status": "unavailable"}
    await db.incident_notes.update_one({"note_id": note_id}, {"$set": {**update, "transcript_at": now_utc()}})
