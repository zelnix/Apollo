"""The only AI transport: Google's supported SDK with the owner's Gemini key.

No prompt/response logging, hidden-reasoning display, implicit model switches or SDK retries.
Public research must be called with an explicitly minimised query, never a private prompt.

PROVIDER MODE (APOLLO_PROVIDER_MODE):
    simulated — Preview. The real request is built (real Magnum DI prompt, real evidence, real
               privacy/redaction, real post-redaction attachments) and then the EXTERNAL GEMINI CALL
               ONLY is replaced by the preview simulator, which always succeeds with the fixed V1
               response. Magnum DI and Higgins continue through the real workflow.
    mock     — Default in preview/dev. All generate() calls route to the deterministic
               mock provider. Zero external Gemini calls, $0 cost. NEVER falls back to
               the paid Gemini key.
    live     — Production. Uses the real Gemini API key. CANNOT be set when mock safeguards
               detect a preview environment without explicit opt-in.
    live_test — Explicit live-AI testing mode using GEMINI_DEV_API_KEY. For validating
                genuine Gemini behaviour with synthetic/non-sensitive test data against a
                free-tier development project. Must be deliberately enabled.
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

# ── Provider mode ────────────────────────────────────────────────────────────
# "mock" (default when no GEMINI_API_KEY) | "live" | "live_test"
_PROVIDER_MODE = os.getenv("APOLLO_PROVIDER_MODE", "").strip().lower()
if not _PROVIDER_MODE:
    # Auto-detect: if no production Gemini key, default to mock
    _PROVIDER_MODE = "live" if GEMINI_API_KEY else "mock"

# Separate dev key for live_test mode (never the production key)
_GEMINI_DEV_API_KEY = os.getenv("GEMINI_DEV_API_KEY", "").strip()

def get_provider_mode() -> str:
    """Return the current provider mode: 'mock', 'live', or 'live_test'."""
    return _PROVIDER_MODE

def _validate_mode_at_import() -> None:
    """Fail-fast safety checks run at import time."""
    if _PROVIDER_MODE == "live_test" and not _GEMINI_DEV_API_KEY:
        raise RuntimeError(
            "APOLLO_PROVIDER_MODE=live_test requires GEMINI_DEV_API_KEY to be set. "
            "Use a free-tier Google AI Studio development project key.")
    if _PROVIDER_MODE not in ("mock", "live", "live_test", "simulated"):
        raise RuntimeError(f"Invalid APOLLO_PROVIDER_MODE='{_PROVIDER_MODE}'. Must be mock|live|live_test|simulated.")

_validate_mode_at_import()

_gateway_log = _logging.getLogger("apollo.gateway")
_gateway_log.info("provider_mode=%s gemini_key_configured=%s dev_key_configured=%s",
                  _PROVIDER_MODE, bool(GEMINI_API_KEY), bool(_GEMINI_DEV_API_KEY))
TEXT_MODEL = os.getenv("GEMINI_TEXT_MODEL", "gemini-3.8-flash")
VISION_MODEL = os.getenv("GEMINI_VISION_MODEL", TEXT_MODEL)
RECOVERY_MODEL = os.getenv("GEMINI_RECOVERY_MODEL", "")
ADVISORY_MODEL = os.getenv("GEMINI_ADVISORY_MODEL", TEXT_MODEL)
TRIAGE_MODEL = os.getenv("GEMINI_TRIAGE_MODEL", "gemini-2.5-flash-lite")
CHAT_MODEL = os.getenv("GEMINI_CHAT_MODEL", "gemini-2.5-flash")
_TEXT_CAPS = {"text", "vision", "audio_input", "functions", "search", "json"}
_LITE_CAPS = {"text", "json"}  # Lite models: text + JSON only, no tools/search/vision
CAPABILITIES = {
    "gemini-3.5-flash": _TEXT_CAPS,
    "gemini-3.8-flash": _TEXT_CAPS,
    "gemini-3-flash-preview": _TEXT_CAPS,
    "gemini-2.5-flash": _TEXT_CAPS,
    "gemini-2.5-flash-lite": _LITE_CAPS,
    "gemini-2.5-pro": _TEXT_CAPS,
    "gemini-3.1-pro-preview": _TEXT_CAPS,
    "gemini-3.1-flash-lite": _LITE_CAPS,
    "gemini-3.5-flash-lite": _LITE_CAPS,
}
_client: genai.Client | None = None
_dev_client: genai.Client | None = None
_model_limits: dict[str, tuple[int, int]] = {}


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
    """Return the appropriate Gemini SDK client for the current provider mode.
    
    SAFETY: In mock mode, this function is NEVER called (generate() routes to mock_provider).
    If somehow called in mock mode, it raises immediately — never falls back to production.
    """
    global _client, _dev_client

    if _PROVIDER_MODE == "mock":
        raise ProviderFailure(
            "provider_configuration",
            original_message="FATAL: client() called in mock mode. The mock provider should handle "
                             "all generate() calls. This indicates a code path bypassing the mock gate.")

    if _PROVIDER_MODE == "live_test":
        if not _GEMINI_DEV_API_KEY:
            raise ProviderFailure("provider_configuration",
                                  original_message="live_test mode requires GEMINI_DEV_API_KEY")
        if _dev_client is None:
            _dev_client = genai.Client(api_key=_GEMINI_DEV_API_KEY, http_options=types.HttpOptions(
                timeout=CALL_SECONDS * 1000, retry_options=types.HttpRetryOptions(attempts=1)))
        return _dev_client

    # live mode
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


_DI_OWNERS: dict[str, str] = {}


def register_di_owner(correlation_id: str, owner: str) -> None:
    """Magnum DI tells the gateway which device owns a correlation id, so the DI record can be
    returned only to that device. Bounded to the most recent cases."""
    if not correlation_id or not owner:
        return
    _DI_OWNERS[correlation_id] = owner
    if len(_DI_OWNERS) > 500:
        for key in list(_DI_OWNERS)[:100]:
            _DI_OWNERS.pop(key, None)


def _owner_for(correlation_id: str | None) -> str | None:
    return _DI_OWNERS.get(correlation_id or "")


async def generate(system: str, contents: Any, *, model: str = TEXT_MODEL,
                   capability: str = "text", json_output: bool = False,
                   tools: list[types.Tool] | None = None, timeout: float = CALL_SECONDS,
                   response_schema: Any | None = None,
                   purpose: Purpose,
                   correlation_id: str | None = None,
                   trigger_source: str | None = None) -> GeminiResult:
    """Single authoritative Gemini gateway. Every AI inference request MUST use this function.
    
    In mock mode: routes to mock_provider. Zero external calls. Fail-closed — never falls back.
    In live_test mode: uses GEMINI_DEV_API_KEY (separate from production).
    In live mode: uses the production GEMINI_API_KEY.
    """
    # ── Preview simulator gate (fail-closed) ─────────────────────────────
    # The request below is the REAL one. Only the external call is replaced.
    if _PROVIDER_MODE == "simulated":
        from services.higgins import di_record as _di
        from services.higgins.preview_simulator import simulate_generate
        _audit = _audit_payload(system, contents, tools)
        _t0 = time.monotonic()
        _result = await simulate_generate(
            system, contents, model=model, capability=capability, json_output=json_output,
            tools=tools, timeout=timeout, response_schema=response_schema, purpose=purpose,
            correlation_id=correlation_id, trigger_source=trigger_source, payload_audit=_audit)
        await _di.save_di_record(
            correlation_id=correlation_id, owner=_owner_for(correlation_id),
            investigation_id=(correlation_id or "").removeprefix("case-") or None,
            model=model, purpose=purpose.value if hasattr(purpose, "value") else str(purpose),
            simulated=True, environment="Preview", status="success",
            request=_di.describe_request(system, contents, tools),
            response_text=_result.text, finish_reason=_result.finish_reason,
            usage=_result.usage, duration_ms=int((time.monotonic() - _t0) * 1000),
            retries=0, calls=0)
        return _result

    # ── Mock mode gate (fail-closed) ──────────────────────────────────────
    if _PROVIDER_MODE == "mock":
        from services.higgins.mock_provider import mock_generate
        return await mock_generate(
            system, contents, model=model, capability=capability,
            json_output=json_output, tools=tools, timeout=timeout,
            response_schema=response_schema, purpose=purpose,
            correlation_id=correlation_id, trigger_source=trigger_source)

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
        extra_data: dict = {"payload_audit": payload_audit}
        if trigger_source:
            extra_data["trigger_source"] = trigger_source
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
                extra=extra_data,
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
    # Privacy processing builds a separate analysis representation; the caller's evidence objects are never mutated.
    if isinstance(contents, str):
        contents = enforce_boundary(purpose, contents)
    elif isinstance(contents, list):
        def _screen(part: Any) -> Any:
            return part.model_copy(update={"text": enforce_boundary(purpose, part.text)}) if isinstance(part, types.Part) and part.text else part
        contents = [
            item.model_copy(update={"parts": [_screen(p) for p in item.parts]}) if isinstance(item, types.Content) and item.parts
            else _screen(item)
            for item in contents
        ]

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

    # DI transaction record for the real call (production as well as preview).
    try:
        from services.higgins import di_record as _di
        await _di.save_di_record(
            correlation_id=correlation_id, owner=_owner_for(correlation_id),
            investigation_id=(correlation_id or "").removeprefix("case-") or None,
            model=model, purpose=purpose.value if hasattr(purpose, "value") else str(purpose),
            simulated=False, environment="Production", status="success",
            request=_di.describe_request(system, contents, tools),
            response_text=text, finish_reason=finish, usage=usage,
            duration_ms=int((time.monotonic() - t0) * 1000), retries=0, calls=1)
    except Exception:
        _gateway_log.warning("di_record: could not record live DI transaction", exc_info=True)

    return GeminiResult(text, candidate.content, finish, usage,
                        candidate.grounding_metadata.model_dump(mode="json", exclude_none=True) if candidate.grounding_metadata else None, model)


async def generate_json(system: str, prompt: Any, **kwargs: Any) -> tuple[dict, dict]:
    result = await generate(system, prompt, json_output=True, **kwargs)
    return result.object(), result.metadata


async def generate_text(system: str, prompt: Any, **kwargs: Any) -> GeminiResult:
    return await generate(system, prompt, json_output=False, **kwargs)


def configuration() -> dict:
    models = {"investigation": TEXT_MODEL, "vision": VISION_MODEL,
              "recovery": RECOVERY_MODEL or None, "chat": CHAT_MODEL,
              "triage": TRIAGE_MODEL}
    mode = _PROVIDER_MODE
    mock_active = mode == "mock"
    return {"provider": "Gemini" if not mock_active else "Gemini (MOCK)",
            "provider_mode": mode,
            "mock_active": mock_active,
            "sdk": "google-genai", "keyConfigured": bool(GEMINI_API_KEY),
            "devKeyConfigured": bool(_GEMINI_DEV_API_KEY),
            "models": models, "capabilities": {m: sorted(CAPABILITIES.get(m, set())) for m in models.values() if m},
            "accountAccess": "Direct Google AI Studio API key" if not mock_active else "Mock provider (no external calls)",
            "providerRetention": "Apollo uses the Gemini API directly via the google-genai SDK under Google's published "
                                 "Gemini API terms. Apollo does not control or independently verify Google's internal "
                                 "retention practices. Apollo's own request-scoped processing copies are closed after completion."
                                 if not mock_active else
                                 "Mock mode: no data leaves this server.",
            "dataFlow": "Device -> Apollo service -> Google Gemini API." if not mock_active else
                        "Device -> Apollo service -> Mock provider (local, deterministic)."}
