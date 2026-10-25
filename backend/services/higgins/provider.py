"""The only AI transport: Google's supported SDK with the owner's Gemini key.

No prompt/response logging, hidden-reasoning display, implicit model switches or SDK retries.
A Magnum DI investigation makes exactly one call through this gateway (see coordinator.py).

NO-FALLBACK CONTRACT:
    In production every Gemini failure is reported exactly as-is — the error code,
    the HTTP status, the finish reason. There is no simulation fallback, no mock
    substitute, no "try again with fake data" path. Higgins surfaces the honest
    failure to the person.

PREVIEW vs PRODUCTION — decided by where this server runs:
    Preview  — the Emergent preview workspace (its process manager sets APP_URL to a
               *.preview.emergentagent.com address), or APOLLO_PREVIEW_SIMULATOR=on. server.py
               installs the simulator at startup. generate() routes through it. No Gemini calls.
    Production — anything else. The published app is never served from the preview domain, and the
               workspace's APP_URL is never copied into a deployment's settings. _preview_generate
               stays None and cannot be installed. generate() calls live Gemini.
    The preview/ directory IS deployed with the rest of the project, so its presence
    proves nothing; a missing or unrecognised address always means live Gemini, never fake
    answers. (APOLLO_ENV is deliberately NOT used: an old "preview" value of it still
    sits in the deployment's secrets.)
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
from urllib.parse import urlparse

from dotenv import load_dotenv
from google import genai
from google.genai import types

from core.config import GEMINI_API_KEY
from services.higgins.capacity import CALL_SECONDS, OUTPUT, SCHEMA_RESERVE
from services.higgins.llm_boundary import Purpose, enforce_boundary, strip_credentials, validate_outbound_payload
from services.gemini_usage import record_usage as _record_usage

load_dotenv()

# Separate dev key for explicit live-AI testing in preview
_GEMINI_DEV_API_KEY = os.getenv("GEMINI_DEV_API_KEY", "").strip()

_gateway_log = _logging.getLogger("apollo.gateway")
_gateway_log.info("gemini_key_configured=%s", bool(GEMINI_API_KEY))

_PREVIEW_HOST_SUFFIX = ".preview.emergentagent.com"


def preview_environment() -> bool:
    """True only on the preview server: the Emergent preview workspace, or APOLLO_PREVIEW_SIMULATOR=on.

    The workspace is recognised by APP_URL, which its own process manager sets to the preview address.
    The published app is never served from *.preview.emergentagent.com, so production stays live."""
    if os.getenv("APOLLO_PREVIEW_SIMULATOR", "").strip().lower() == "on":
        return True
    host = (urlparse(os.getenv("APP_URL", "").strip()).hostname or "").lower()
    return host.endswith(_PREVIEW_HOST_SUFFIX)


# ── Preview handler slot ────────────────────────────────────────────────────
# Filled by services.higgins.preview.dispatch.install_preview_provider() at
# startup, and only when preview_environment() is true. Everywhere else this
# stays None and generate() calls live Gemini.
_preview_generate = None


def get_provider_mode() -> str:
    """Return 'preview' or 'live' based on whether a preview handler is installed."""
    return "preview" if _preview_generate is not None else "live"


def register_preview_handler(handler) -> None:
    """Install the preview generate handler. Called at startup from preview/dispatch.py.
    Refuses outside an explicit preview environment, so the simulator can never answer in production."""
    global _preview_generate
    if not preview_environment():
        raise RuntimeError("The preview simulator can only be installed on the preview server.")
    _preview_generate = handler
    _gateway_log.info("preview handler registered")
# Magnum DI's investigation model. Gemini 3.1 Flash-Lite (stable, May 2026) supports image/PDF
# input, Search grounding and structured outputs, which is everything the investigation request uses.
TEXT_MODEL = os.getenv("GEMINI_TEXT_MODEL", "gemini-3.1-flash-lite")
# TC FlyBy's targeted Google Search lookups: the low-cost model with Search grounding. By default the same
# model Magnum DI is configured with — never a stronger one, and never a second attempt at Magnum's task.
TEDDY_MODEL = os.getenv("GEMINI_TEDDY_MODEL", TEXT_MODEL)
# Vision extraction and advisory generation stay on their existing model — unchanged by the
# Magnum DI model switch.
VISION_MODEL = os.getenv("GEMINI_VISION_MODEL", "gemini-3.8-flash")
RECOVERY_MODEL = os.getenv("GEMINI_RECOVERY_MODEL", "")
ADVISORY_MODEL = os.getenv("GEMINI_ADVISORY_MODEL", "gemini-3.8-flash")
TRIAGE_MODEL = os.getenv("GEMINI_TRIAGE_MODEL", "gemini-2.5-flash-lite")
CHAT_MODEL = os.getenv("GEMINI_CHAT_MODEL", "gemini-2.5-flash")
_TEXT_CAPS = {"text", "vision", "audio_input", "functions", "search", "json"}
_LITE_CAPS = {"text", "json"}  # Older lite models: text + JSON only, no tools/search/vision
CAPABILITIES = {
    "gemini-3.5-flash": _TEXT_CAPS,
    "gemini-3.8-flash": _TEXT_CAPS,
    "gemini-3-flash-preview": _TEXT_CAPS,
    "gemini-2.5-flash": _TEXT_CAPS,
    "gemini-2.5-flash-lite": _LITE_CAPS,
    "gemini-2.5-pro": _TEXT_CAPS,
    "gemini-3.1-pro-preview": _TEXT_CAPS,
    # Per the model card: text/image/video/audio/PDF in, function calling, Search grounding and
    # structured outputs are all supported on 3.1 Flash-Lite.
    "gemini-3.1-flash-lite": _TEXT_CAPS,
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
    """Return the Gemini SDK client for live Gemini calls.
    
    In preview the preview dispatch handles generate() — client() is never called.
    If somehow reached while a preview handler is installed, it raises.
    """
    global _client, _dev_client

    if _preview_generate is not None:
        raise ProviderFailure(
            "provider_configuration",
            original_message="FATAL: client() called while preview handler is installed. "
                             "The preview dispatch handles all generate() calls.")

    if _GEMINI_DEV_API_KEY and not GEMINI_API_KEY:
        if _dev_client is None:
            _dev_client = genai.Client(api_key=_GEMINI_DEV_API_KEY, http_options=types.HttpOptions(
                timeout=CALL_SECONDS * 1000, retry_options=types.HttpRetryOptions(attempts=1)))
        return _dev_client

    if not GEMINI_API_KEY:
        raise ProviderFailure("provider_configuration",
                              original_message="GEMINI_API_KEY is not set. Cannot make live Gemini calls.")
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
    # True when the preview simulator produced this result instead of Gemini. Carried through to
    # what is stored, so a simulated answer can never be recorded as a Gemini one.
    simulated: bool = False

    @property
    def metadata(self) -> dict:
        return {"provider": "Preview simulator" if self.simulated else "Gemini", "model": self.model,
                "finish_reason": self.finish_reason, "provider_complete": self.finish_reason == "STOP",
                "usage": self.usage, "grounding": self.grounding, "simulated": self.simulated}

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
    # The Vision Gate exists to have Gemini look at the person's privacy-screened image.
    Purpose.VISION_INVESTIGATION,
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

    NO-FALLBACK CONTRACT: In production every Gemini failure is reported exactly as-is.
    There is no simulation fallback. Higgins surfaces the honest failure to the person.

    Preview (APOLLO_PREVIEW_SIMULATOR=on): the preview dispatch handles generate() calls — installed at startup.
    Production: no preview handler can be installed. This function calls live Gemini only.
    """
    # ── Live Gemini and preview alike: every production check runs first ──
    # The simulator replaces ONLY the network call below. Model capability, image authorisation,
    # credential stripping and the privacy boundary all run before it, so a request production would
    # refuse is refused in preview too — preview can no longer pass what production rejects.
    require_capability(model, capability)

    call_id = str(uuid.uuid4())
    call_type = "generate_json" if json_output else "generate_text"
    t0 = time.monotonic()

    # ── Payload composition audit ──────────────────────────────────────
    # Captures what is being sent to Gemini so per-call costs can be attributed
    # to system prompt, evidence, tool results, conversation rounds, etc.
    payload_audit = _audit_payload(system, contents, tools)

    async def _track(success: bool, usage: dict | None = None, failure_code: str | None = None, search_queries: int | None = None):
        elapsed_ms = int((time.monotonic() - t0) * 1000)
        extra_data: dict = {"payload_audit": payload_audit, "search_tool": _has_search(tools)}
        if search_queries is not None:
            extra_data["search_queries"] = search_queries
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

    # ── Preview (APOLLO_PREVIEW_SIMULATOR=on): the simulator answers instead of the network call ──
    if _preview_generate is not None:
        return await _preview_generate(
            system, contents, model=model, capability=capability,
            json_output=json_output, tools=tools, timeout=timeout,
            response_schema=response_schema, purpose=purpose,
            correlation_id=correlation_id, trigger_source=trigger_source)

    # ── Live Gemini ───────────────────────────────────────────────────────
    if os.getenv("APOLLO_FORBID_PROVIDER_CALLS") == "1":
        raise AssertionError("Live Gemini/provider calls are prohibited in bounded tests")

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
    grounding = candidate.grounding_metadata.model_dump(mode="json", exclude_none=True) if candidate.grounding_metadata else None

    # Track successful usage, with the number of Google Search queries Gemini ran (each one is billed).
    await _track(True, usage=usage, search_queries=search_query_count(grounding) if _has_search(tools) else None)

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

    return GeminiResult(text, candidate.content, finish, usage, grounding, model)


def _has_search(tools: list[types.Tool] | None) -> bool:
    return any(getattr(tool, "google_search", None) is not None for tool in tools or [])


def search_query_count(grounding: dict | None) -> int:
    """How many Google Search queries Gemini ran for one answer (from its grounding record)."""
    grounding = grounding or {}
    return len(grounding.get("web_search_queries") or grounding.get("webSearchQueries") or [])


async def generate_json(system: str, prompt: Any, **kwargs: Any) -> tuple[dict, dict]:
    result = await generate(system, prompt, json_output=True, **kwargs)
    return result.object(), result.metadata


async def generate_text(system: str, prompt: Any, **kwargs: Any) -> GeminiResult:
    return await generate(system, prompt, json_output=False, **kwargs)


def configuration() -> dict:
    models = {"investigation": TEXT_MODEL, "teddy_search": TEDDY_MODEL, "vision": VISION_MODEL,
              "recovery": RECOVERY_MODEL or None, "chat": CHAT_MODEL,
              "triage": TRIAGE_MODEL}
    preview_active = _preview_generate is not None
    return {"provider": "Gemini (preview)" if preview_active else "Gemini",
            "preview_active": preview_active,
            "sdk": "google-genai", "keyConfigured": bool(GEMINI_API_KEY),
            "models": models, "capabilities": {m: sorted(CAPABILITIES.get(m, set())) for m in models.values() if m},
            "accountAccess": "Preview provider (no external calls)" if preview_active else "Direct Google AI Studio API key",
            "providerRetention": "Preview: no data leaves this server." if preview_active else
                                 "Apollo uses the Gemini API directly via the google-genai SDK under Google's published "
                                 "Gemini API terms. Apollo does not control or independently verify Google's internal "
                                 "retention practices. Apollo's own request-scoped processing copies are closed after completion.",
            "dataFlow": "Device -> Apollo service -> Preview provider (local)." if preview_active else
                        "Device -> Apollo service -> Google Gemini API."}
