"""The only AI transport: Google's supported SDK with the owner's Gemini key.

No prompt/response logging, hidden-reasoning display, implicit model switches or SDK retries.
Public research must be called with an explicitly minimised query, never a private prompt.
"""
from __future__ import annotations

import asyncio
import io
import json
import os
import wave
from dataclasses import dataclass
from typing import Any

from dotenv import load_dotenv
from google import genai
from google.genai import types

from core.config import GEMINI_API_KEY
from services.higgins.capacity import CALL_SECONDS, OUTPUT, SCHEMA_RESERVE

load_dotenv()
TEXT_MODEL = os.getenv("GEMINI_TEXT_MODEL", "gemini-3-flash-preview")
VISION_MODEL = os.getenv("GEMINI_VISION_MODEL", TEXT_MODEL)
TRANSCRIPTION_MODEL = os.getenv("GEMINI_TRANSCRIPTION_MODEL", TEXT_MODEL)
SPEECH_MODEL = os.getenv("GEMINI_SPEECH_MODEL", "gemini-3.1-flash-tts-preview")
SPEECH_VOICE = os.getenv("GEMINI_SPEECH_VOICE", "Gacrux")
RECOVERY_MODEL = os.getenv("GEMINI_RECOVERY_MODEL", "")
_TEXT_CAPS = {"text", "vision", "audio_input", "functions", "search", "json"}
# Register exact documented capabilities. Unknown selections fail closed, not by name heuristics.
CAPABILITIES = {
    "gemini-3-flash-preview": _TEXT_CAPS,
    "gemini-2.5-flash": _TEXT_CAPS,
    "gemini-2.5-pro": _TEXT_CAPS,
    "gemini-3.1-flash-tts-preview": {"speech"},
    "gemini-2.5-flash-preview-tts": {"speech"},
    "gemini-2.5-pro-preview-tts": {"speech"},
}
_client: genai.Client | None = None
_model_limits: dict[str, tuple[int, int]] = {}


class ProviderFailure(RuntimeError):
    def __init__(self, code: str, *, retryable: bool = False, finish_reason: str | None = None):
        self.code, self.retryable, self.finish_reason = code, retryable, finish_reason
        # Never include SDK exception text (may contain input, URLs or credentials).
        super().__init__(code)


def client() -> genai.Client:
    global _client
    if not GEMINI_API_KEY:
        raise ProviderFailure("provider_configuration")
    if _client is None:
        _client = genai.Client(api_key=GEMINI_API_KEY, http_options=types.HttpOptions(
            timeout=CALL_SECONDS * 1000, retry_options=types.HttpRetryOptions(attempts=1)))
    return _client


def require_capability(model: str, capability: str) -> None:
    if capability not in CAPABILITIES.get(model, set()):
        raise ProviderFailure("provider_configuration")


@dataclass
class GeminiResult:
    text: str
    content: types.Content
    finish_reason: str
    usage: dict[str, Any]
    grounding: dict[str, Any] | None
    model: str

    @property
    def metadata(self) -> dict:
        return {"provider": "Gemini", "model": self.model, "finish_reason": self.finish_reason,
                "provider_complete": self.finish_reason == "STOP", "usage": self.usage,
                "grounding": self.grounding}

    def object(self) -> dict:
        try:
            value = json.loads(self.text)
        except (ValueError, TypeError) as exc:
            raise ProviderFailure("response_invalid") from exc
        if not isinstance(value, dict):
            raise ProviderFailure("response_invalid")
        return value


async def generate(system: str, contents: Any, *, model: str = TEXT_MODEL,
                   capability: str = "text", json_output: bool = False,
                   tools: list[types.Tool] | None = None, timeout: float = CALL_SECONDS,
                   speech: bool = False) -> GeminiResult:
    require_capability(model, capability)
    config = types.GenerateContentConfig(
        system_instruction=system or None, max_output_tokens=OUTPUT.value,
        response_mime_type="application/json" if json_output else None,
        tools=tools, automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True))
    if speech:
        config.system_instruction = None
        config.response_modalities = ["AUDIO"]
        config.speech_config = types.SpeechConfig(voice_config=types.VoiceConfig(
            prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=SPEECH_VOICE)))
    input_count = None
    async def invoke():
        nonlocal input_count
        if not speech:
            if model not in _model_limits:
                info = await client().aio.models.get(model=model)
                if not info.input_token_limit or not info.output_token_limit:
                    raise ProviderFailure('provider_configuration')
                _model_limits[model] = (info.input_token_limit, info.output_token_limit)
            input_limit, output_limit = _model_limits[model]
            config.max_output_tokens = min(OUTPUT.value, output_limit)
            # Developer API rejects CountTokensConfig.system_instruction/tools (Vertex-only).
            # Tokenise their complete text as a surrogate Part, with an explicit wrapper reserve.
            schemas = json.dumps([tool.model_dump(mode='json', exclude_none=True) for tool in tools or []])
            count_contents = [types.Part(text=(system or '') + '\n' + schemas), *(contents if isinstance(contents, list) else [contents])]
            counted = await client().aio.models.count_tokens(model=model, contents=count_contents)
            input_count = counted.total_tokens
            if input_count is None or input_count + config.max_output_tokens + SCHEMA_RESERVE.value > input_limit:
                raise ProviderFailure('budget_exhausted')
        return await client().aio.models.generate_content(model=model, contents=contents, config=config)
    try:
        response = await asyncio.wait_for(invoke(), timeout=timeout)
    except asyncio.TimeoutError as exc:
        raise ProviderFailure("provider_unavailable", retryable=True) from exc
    except ProviderFailure:
        raise
    except Exception as exc:
        code = getattr(exc, "code", None)
        if code in (400, 401, 403, 404):
            raise ProviderFailure("provider_configuration") from exc
        raise ProviderFailure("rate_limited" if code == 429 else "provider_unavailable",
                              retryable=code in (429, 500, 502, 503, 504) or code is None) from exc
    candidates = response.candidates or []
    if not candidates or not candidates[0].content:
        raise ProviderFailure("incomplete_output")
    candidate = candidates[0]
    finish = getattr(candidate.finish_reason, "value", candidate.finish_reason) or "UNKNOWN"
    if finish != "STOP":
        raise ProviderFailure("incomplete_output", finish_reason=str(finish))
    parts = candidate.content.parts or []
    text = "".join(part.text for part in parts if part.text and not part.thought)
    if not text and not any(p.function_call or p.inline_data for p in parts):
        raise ProviderFailure("incomplete_output", finish_reason=finish)
    usage = response.usage_metadata.model_dump(mode='json', exclude_none=True) if response.usage_metadata else {}
    usage['admission_input_tokens'] = input_count
    usage['admission_method'] = 'complete content plus system/schema surrogate; wrapper reserve' if not speech else 'bounded speech segment'
    return GeminiResult(text, candidate.content, finish, usage,
                        candidate.grounding_metadata.model_dump(mode="json", exclude_none=True) if candidate.grounding_metadata else None, model)


async def generate_json(system: str, prompt: Any, **kwargs: Any) -> tuple[dict, dict]:
    result = await generate(system, prompt, json_output=True, **kwargs)
    return result.object(), result.metadata


async def speech_bytes(text: str) -> tuple[bytes, dict]:
    prompt = ("Synthesize speech. Read only the transcript, exactly, with no added words. "
              "Voice: Higgins, a mature English gentleman; courteous, warm and unhurried.\n\nTRANSCRIPT:\n" + text)
    result = await generate("", prompt, model=SPEECH_MODEL, capability="speech", speech=True)
    pcm = b"".join(p.inline_data.data for p in result.content.parts or []
                   if p.inline_data and p.inline_data.data and (p.inline_data.mime_type or "").startswith("audio/"))
    if not pcm:
        raise ProviderFailure("incomplete_output")
    with io.BytesIO() as output:
        with wave.open(output, "wb") as audio:
            audio.setnchannels(1)
            audio.setsampwidth(2)
            audio.setframerate(24000)
            audio.writeframes(pcm)
        return output.getvalue(), result.metadata


def configuration() -> dict:
    models = {"investigation": TEXT_MODEL, "vision": VISION_MODEL, "transcription": TRANSCRIPTION_MODEL,
              "speech": SPEECH_MODEL, "recovery": RECOVERY_MODEL or None}
    return {"provider": "Gemini", "sdk": "google-genai", "keyConfigured": bool(GEMINI_API_KEY),
            "models": models, "capabilities": {m: sorted(CAPABILITIES.get(m, set())) for m in models.values() if m},
            "accountAccess": "requires live verification", "providerRetention": "Owner must verify Google account data settings"}