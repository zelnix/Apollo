"""The only AI transport: Google's supported SDK with the owner's Gemini key.

No prompt/response logging, hidden-reasoning display, implicit model switches or SDK retries.
Public research must be called with an explicitly minimised query, never a private prompt.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import time
import uuid
import logging as _logging
from dataclasses import dataclass
from typing import Any

from dotenv import load_dotenv
from google import genai
from google.genai import types

from core.config import GEMINI_API_KEY
from services.higgins.capacity import CALL_SECONDS, OUTPUT, SCHEMA_RESERVE
from services.higgins.llm_boundary import Purpose, enforce_boundary, strip_credentials, validate_outbound_payload
from services.gemini_usage import record_usage as _record_usage

load_dotenv()
TEXT_MODEL = os.getenv("GEMINI_TEXT_MODEL", "gemini-3.8-flash")
VISION_MODEL = os.getenv("GEMINI_VISION_MODEL", TEXT_MODEL)
RECOVERY_MODEL = os.getenv("GEMINI_RECOVERY_MODEL", "")
ADVISORY_MODEL = os.getenv("GEMINI_ADVISORY_MODEL", TEXT_MODEL)
_TEXT_CAPS = {"text", "vision", "audio_input", "functions", "search", "json"}
CAPABILITIES = {
    "gemini-3.5-flash": _TEXT_CAPS,
    "gemini-3.8-flash": _TEXT_CAPS,
    "gemini-3-flash-preview": _TEXT_CAPS,
    "gemini-2.5-flash": _TEXT_CAPS,
    "gemini-2.5-pro": _TEXT_CAPS,
    "gemini-3.1-pro-preview": _TEXT_CAPS,
}
_client: genai.Client | None = None
_model_limits: dict[str, tuple[int, int]] = {}

_gateway_log = _logging.getLogger("apollo.gateway")


class ProviderFailure(RuntimeError):
    def __init__(self, code: str, *, retryable: bool = False, finish_reason: str | None = None,
                 http_status: int | None = None, original_message: str | None = None,
                 exception_type: str | None = None, operation: str | None = None):
        self.code, self.retryable, self.finish_reason = code, retryable, finish_reason
        self.http_status = http_status
        self.original_message = _sanitise_diagnostic(original_message) if original_message else None
        self.exception_type = exception_type
        self.operation = operation or "response_generation"
        super().__init__(code)


def _sanitise_diagnostic(text: str) -> str:
    """Redact API keys, tokens and sensitive data from diagnostic text."""
    text = re.sub(r'(key|token|secret|password|auth)[=:]\s*\S+', r'\1=<REDACTED>', text, flags=re.IGNORECASE)
    text = re.sub(r'AIza[A-Za-z0-9_-]{30,}', '<REDACTED_KEY>', text)
    text = re.sub(r'AQ\.[A-Za-z0-9_-]{20,}', '<REDACTED_KEY>', text)
    text = re.sub(r'sk-[A-Za-z0-9_-]{20,}', '<REDACTED_KEY>', text)
    text = re.sub(r'Bearer\s+\S+', 'Bearer <REDACTED>', text, flags=re.IGNORECASE)
    return text[:500] if len(text) > 500 else text


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


# Purposes that are authorised for binary (image/audio) content transmission.
_BINARY_AUTHORISED_PURPOSES = frozenset({
    Purpose.VISION_PREFLIGHT,
    Purpose.PAGE_SIGNAL_EXTRACTION,
    Purpose.INVESTIGATION,
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


def _audit_payload(system: str, contents: Any, tools: list[types.Tool] | None) -> dict:
    """Non-blocking audit of what is being sent to Gemini for cost attribution.

    Returns a lightweight breakdown of the payload composition without copying content.
    Token estimates use ~4 chars/token as a rough heuristic (actual tokenisation happens
    separately via count_tokens).
    """
    audit: dict[str, Any] = {
        "system_chars": len(system) if system else 0,
        "system_est_tokens": len(system) // 4 if system else 0,
        "tool_declarations": len(tools[0].function_declarations) if tools and hasattr(tools[0], 'function_declarations') and tools[0].function_declarations else 0,
    }
    # Decompose contents into rounds with per-role character counts
    rounds: list[dict] = []
    total_text_chars = 0
    total_binary_parts = 0
    total_function_calls = 0
    total_function_responses = 0

    items = contents if isinstance(contents, list) else [contents]
    for item in items:
        if isinstance(item, types.Content):
            role = item.role or "unknown"
            text_chars = 0
            binary_count = 0
            fn_calls = 0
            fn_responses = 0
            for part in (item.parts or []):
                if part.text:
                    text_chars += len(part.text)
                if part.inline_data:
                    binary_count += 1
                if part.function_call:
                    fn_calls += 1
                if part.function_response:
                    fn_responses += 1
            total_text_chars += text_chars
            total_binary_parts += binary_count
            total_function_calls += fn_calls
            total_function_responses += fn_responses
            rounds.append({
                "role": role, "text_chars": text_chars, "est_tokens": text_chars // 4,
                "binary_parts": binary_count, "fn_calls": fn_calls, "fn_responses": fn_responses,
            })
        elif isinstance(item, str):
            total_text_chars += len(item)
            rounds.append({"role": "user", "text_chars": len(item), "est_tokens": len(item) // 4})
        elif isinstance(item, types.Part):
            chars = len(item.text) if item.text else 0
            total_text_chars += chars
            if item.inline_data:
                total_binary_parts += 1
            rounds.append({"role": "part", "text_chars": chars, "est_tokens": chars // 4, "binary_parts": 1 if item.inline_data else 0})

    audit["content_rounds"] = len(rounds)
    audit["total_text_chars"] = total_text_chars
    audit["total_est_tokens"] = (audit["system_chars"] + total_text_chars) // 4
    audit["total_binary_parts"] = total_binary_parts
    audit["total_function_calls"] = total_function_calls
    audit["total_function_responses"] = total_function_responses
    audit["rounds"] = rounds[:20]  # Cap to avoid bloating the record
    return audit


async def generate(system: str, contents: Any, *, model: str = TEXT_MODEL,
                   capability: str = "text", json_output: bool = False,
                   tools: list[types.Tool] | None = None, timeout: float = CALL_SECONDS,
                   response_schema: Any | None = None,
                   purpose: Purpose,
                   correlation_id: str | None = None) -> GeminiResult:
    """Single authoritative Gemini gateway. Every AI inference request MUST use this function."""
    if os.getenv("APOLLO_FORBID_PROVIDER_CALLS") == "1":
        raise AssertionError("Live Gemini/provider calls are prohibited in bounded tests")
    require_capability(model, capability)

    call_id = str(uuid.uuid4())
    call_type = "generate_json" if json_output else "generate_text"
    t0 = time.monotonic()

    # ── Payload composition audit ──────────────────────────────────────
    # Captures what is being sent to Gemini so per-call costs can be attributed
    # to system prompt, evidence, tool results, conversation rounds, etc.
    payload_audit = _audit_payload(system, contents, tools)

    async def _track(success: bool, usage: dict | None = None, failure_code: str | None = None):
        elapsed_ms = int((time.monotonic() - t0) * 1000)
        try:
            await _record_usage(
                record_id=call_id,
                correlation_id=correlation_id,
                model=model,
                purpose=purpose.value if hasattr(purpose, "value") else str(purpose),
                call_type=call_type,
                success=success,
                failure_code=failure_code,
                usage_metadata=usage,
                duration_ms=elapsed_ms,
                extra={"payload_audit": payload_audit},
            )
        except Exception:
            _gateway_log.warning("gemini_usage: failed to persist usage record %s", call_id, exc_info=True)

    has_binary = _contains_binary(contents)
    if has_binary and purpose not in _BINARY_AUTHORISED_PURPOSES:
        raise ProviderFailure("privacy_violation", retryable=False)
    if has_binary:
        _gateway_log.info("gateway_binary: purpose=%s model=%s capability=%s", purpose.value, model, capability)

    if system:
        system = strip_credentials(system)
    if isinstance(contents, str):
        contents = enforce_boundary(purpose, contents)
    elif isinstance(contents, list):
        for content_item in contents:
            if isinstance(content_item, types.Content) and content_item.parts:
                for part in content_item.parts:
                    if part.text:
                        part.text = enforce_boundary(purpose, part.text)
            elif isinstance(content_item, types.Part) and content_item.text:
                content_item.text = enforce_boundary(purpose, content_item.text)

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
        await _track(False, failure_code="timeout")
        raise ProviderFailure("provider_unavailable", retryable=True,
                              operation="response_generation",
                              original_message=f"Gemini API call timed out after {timeout}s") from exc
    except ProviderFailure as exc:
        await _track(False, failure_code=exc.code)
        raise
    except Exception as exc:
        code = getattr(exc, "code", None)
        status_code = getattr(exc, "status_code", code)
        exc_message = str(exc)[:300] if str(exc) else None
        exc_type = type(exc).__name__
        if code in (400, 401, 402, 403, 404):
            await _track(False, failure_code=f"http_{code}")
            raise ProviderFailure("provider_configuration", retryable=False,
                                  http_status=code,
                                  original_message=exc_message,
                                  exception_type=exc_type,
                                  operation="response_generation") from exc
        failure_code = "rate_limited" if code == 429 else "provider_unavailable"
        await _track(False, failure_code=failure_code)
        raise ProviderFailure(failure_code,
                              retryable=code in (429, 500, 502, 503, 504) or code is None,
                              http_status=code if isinstance(code, int) else None,
                              original_message=exc_message,
                              exception_type=exc_type,
                              operation="response_generation") from exc

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

    # Track successful usage
    await _track(True, usage=usage)

    return GeminiResult(text, candidate.content, finish, usage,
                        candidate.grounding_metadata.model_dump(mode="json", exclude_none=True) if candidate.grounding_metadata else None, model)


async def generate_json(system: str, prompt: Any, **kwargs: Any) -> tuple[dict, dict]:
    result = await generate(system, prompt, json_output=True, **kwargs)
    return result.object(), result.metadata


async def generate_text(system: str, prompt: Any, **kwargs: Any) -> GeminiResult:
    return await generate(system, prompt, json_output=False, **kwargs)


def configuration() -> dict:
    models = {"investigation": TEXT_MODEL, "vision": VISION_MODEL,
              "recovery": RECOVERY_MODEL or None}
    return {"provider": "Gemini", "sdk": "google-genai", "keyConfigured": bool(GEMINI_API_KEY),
            "models": models, "capabilities": {m: sorted(CAPABILITIES.get(m, set())) for m in models.values() if m},
            "accountAccess": "Direct Google AI Studio API key",
            "providerRetention": "Apollo uses the Gemini API directly via google-genai SDK. "
                                 "Request-scoped processing copies are closed immediately after completion.",
            "dataFlow": "Device -> Apollo service -> Google Gemini API."}
