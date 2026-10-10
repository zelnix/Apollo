"""The only AI transport: Google's supported SDK with the owner's Gemini key.

No prompt/response logging, hidden-reasoning display, implicit model switches or SDK retries.
Public research must be called with an explicitly minimised query, never a private prompt.
"""
from __future__ import annotations

import asyncio
import json
import os
from dataclasses import dataclass
from typing import Any

from dotenv import load_dotenv
from google import genai
from google.genai import types

from core.config import GEMINI_API_KEY
from services.higgins.capacity import CALL_SECONDS, OUTPUT, SCHEMA_RESERVE
from services.higgins.llm_boundary import Purpose, enforce_boundary, strip_credentials, validate_outbound_payload

load_dotenv()
TEXT_MODEL = os.getenv("GEMINI_TEXT_MODEL", "gemini-3-flash-preview")
VISION_MODEL = os.getenv("GEMINI_VISION_MODEL", TEXT_MODEL)
RECOVERY_MODEL = os.getenv("GEMINI_RECOVERY_MODEL", "")
ADVISORY_MODEL = os.getenv("GEMINI_ADVISORY_MODEL", "gemini-3.1-pro-preview")
_TEXT_CAPS = {"text", "vision", "audio_input", "functions", "search", "json"}
# Register exact documented capabilities. Unknown selections fail closed, not by name heuristics.
CAPABILITIES = {
    "gemini-3-flash-preview": _TEXT_CAPS,
    "gemini-2.5-flash": _TEXT_CAPS,
    "gemini-2.5-pro": _TEXT_CAPS,
    "gemini-3.1-pro-preview": _TEXT_CAPS,
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


import logging as _logging

_gateway_log = _logging.getLogger("apollo.gateway")

# Purposes that are authorised for binary (image/audio) content transmission.
# All other purposes MUST NOT send binary to Gemini.
_BINARY_AUTHORISED_PURPOSES = frozenset({
    Purpose.VISION_PREFLIGHT,           # Image admission check (the screening mechanism itself)
    Purpose.PAGE_SIGNAL_EXTRACTION,     # Privacy-gated screenshot → signal extraction
    Purpose.INVESTIGATION,              # Owner-authorised investigation evidence
})


def _contains_binary(contents: Any) -> bool:
    """Check whether contents include binary (non-text) parts."""
    if isinstance(contents, (str, bytes)):
        return isinstance(contents, bytes)
    if isinstance(contents, types.Part):
        return bool(contents.inline_data)
    if isinstance(contents, types.Content):
        return any(_contains_binary(p) for p in (contents.parts or []))
    if isinstance(contents, list):
        return any(_contains_binary(item) for item in contents)
    return False


async def generate(system: str, contents: Any, *, model: str = TEXT_MODEL,
                   capability: str = "text", json_output: bool = False,
                   tools: list[types.Tool] | None = None, timeout: float = CALL_SECONDS,
                   response_schema: Any | None = None,
                   purpose: Purpose) -> GeminiResult:
    """Single authoritative Gemini gateway. Every AI inference request MUST use this function.

    `purpose` is REQUIRED — no default. Every caller must explicitly declare their processing
    purpose so the correct privacy controls are applied. A missing purpose produces a TypeError.
    """
    if os.getenv("APOLLO_FORBID_PROVIDER_CALLS") == "1":
        raise AssertionError("Live Gemini/provider calls are prohibited in bounded tests")
    require_capability(model, capability)

    # ── Binary content authorisation: verify purpose permits binary ──
    has_binary = _contains_binary(contents)
    if has_binary and purpose not in _BINARY_AUTHORISED_PURPOSES:
        raise ProviderFailure("privacy_violation",
                              retryable=False)

    if has_binary:
        _gateway_log.info("gateway_binary: purpose=%s model=%s capability=%s", purpose.value, model, capability)

    # ── LLM Evidence Boundary: enforce before any external call ──
    # Strip credentials from the system prompt.
    if system:
        system = strip_credentials(system)
    # Enforce boundary on all text contents with purpose-specific controls.
    if isinstance(contents, str):
        contents = enforce_boundary(purpose, contents)
    elif isinstance(contents, list):
        for content_item in contents:
            if isinstance(content_item, types.Content) and content_item.parts:
                for part in content_item.parts:
                    if part.text:
                        # Full purpose-aware enforcement on every text part, not just credential stripping.
                        part._raw_part.text = enforce_boundary(purpose, part.text)
            elif isinstance(content_item, types.Part) and content_item.text:
                content_item._raw_part.text = enforce_boundary(purpose, content_item.text)

    config = types.GenerateContentConfig(
        system_instruction=system or None, max_output_tokens=OUTPUT.value,
        response_mime_type="application/json" if json_output else None,
        response_schema=response_schema,
        tools=tools, automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True))
    input_count = None
    async def invoke():
        nonlocal input_count
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
    usage['admission_method'] = 'complete content plus system/schema surrogate; wrapper reserve'
    return GeminiResult(text, candidate.content, finish, usage,
                        candidate.grounding_metadata.model_dump(mode="json", exclude_none=True) if candidate.grounding_metadata else None, model)


async def generate_json(system: str, prompt: Any, **kwargs: Any) -> tuple[dict, dict]:
    result = await generate(system, prompt, json_output=True, **kwargs)
    return result.object(), result.metadata


def configuration() -> dict:
    models = {"investigation": TEXT_MODEL, "vision": VISION_MODEL,
              "recovery": RECOVERY_MODEL or None}
    return {"provider": "Gemini", "sdk": "google-genai", "keyConfigured": bool(GEMINI_API_KEY),
            "models": models, "capabilities": {m: sorted(CAPABILITIES.get(m, set())) for m in models.values() if m},
            "accountAccess": "Apollo-managed paid API tier (not the user's personal Google account)",
            "providerRetention": "Paid Gemini API: Google states customer API data is not used for model training. "
                                 "Apollo's request-scoped copies close immediately after completion, never later than 15 minutes. "
                                 "Google's own API data retention follows their published terms.",
            "dataFlow": "Device -> Apollo service -> Google Gemini paid API. No user Google account involved."}