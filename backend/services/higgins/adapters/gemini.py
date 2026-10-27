"""Google Gemini adapter: one ApolloSG request → one Gemini call, through Google's supported SDK (google-genai).

No prompt/response logging, hidden-reasoning display, implicit model switches or SDK retries (one attempt).
Before the call the request is measured with Gemini's own token count and refused (budget_exhausted) when it would
not fit the model's limits, so nothing is ever cut short to make it fit.
"""
from __future__ import annotations

import json
import os
from typing import Any

from google import genai
from google.genai import types

from core.config import GEMINI_API_KEY
from services.higgins.ai_request import AIResult, Message, Part, ProviderFailure
from services.higgins.capacity import CALL_SECONDS, OUTPUT, SCHEMA_RESERVE

PROVIDER = "gemini"
SDK = "google-genai"
ACCOUNT = "Direct Google AI Studio API key"
RETENTION = ("ApolloSG uses the Gemini API directly via the google-genai SDK under Google's published Gemini API terms. "
             "ApolloSG does not control or independently verify Google's internal retention practices. ApolloSG's own "
             "request-scoped processing copies are closed after completion.")

# Separate dev key for explicit live-AI testing in preview
_GEMINI_DEV_API_KEY = os.getenv("GEMINI_DEV_API_KEY", "").strip()
_client: genai.Client | None = None
_dev_client: genai.Client | None = None
_model_limits: dict[str, tuple[int, int]] = {}


def key_configured() -> bool:
    return bool(GEMINI_API_KEY or _GEMINI_DEV_API_KEY)


def client() -> genai.Client:
    """The Gemini SDK client for live calls. Unreachable while the preview simulator answers instead."""
    global _client, _dev_client
    from services.higgins import provider  # the gateway: is the preview simulator installed on this server?

    if provider.get_provider_mode() == "preview":
        raise ProviderFailure("provider_configuration",
                              original_message="FATAL: the Gemini client was requested while the preview simulator is installed. "
                                               "The preview dispatch handles all generate() calls.")
    options = types.HttpOptions(timeout=CALL_SECONDS * 1000, retry_options=types.HttpRetryOptions(attempts=1))
    if _GEMINI_DEV_API_KEY and not GEMINI_API_KEY:
        if _dev_client is None:
            _dev_client = genai.Client(api_key=_GEMINI_DEV_API_KEY, http_options=options)
        return _dev_client
    if not GEMINI_API_KEY:
        raise ProviderFailure("provider_configuration", original_message="GEMINI_API_KEY is not set. Cannot make live Gemini calls.")
    if _client is None:
        _client = genai.Client(api_key=GEMINI_API_KEY, http_options=options)
    return _client


def schema(node: dict) -> types.Schema:
    """ApolloSG's response shape (a JSON-schema dict) as Gemini's structured-output schema."""
    kw: dict[str, Any] = {"type": node["type"].upper()}
    for key, name in (("description", "description"), ("enum", "enum"), ("required", "required"), ("maxItems", "max_items")):
        if key in node:
            kw[name] = node[key]
    if node.get("nullable"):
        kw["nullable"] = True
    if "items" in node:
        kw["items"] = schema(node["items"])
    if "properties" in node:
        kw["properties"] = {name: schema(child) for name, child in node["properties"].items()}
    return types.Schema(**kw)


def _part(part: Any) -> Any:
    if isinstance(part, Part):
        return types.Part.from_bytes(data=part.data, mime_type=part.mime_type) if part.data is not None else types.Part(text=part.text)
    return part


def contents_for(contents: Any) -> Any:
    if isinstance(contents, str):
        return contents
    items = contents if isinstance(contents, list) else [contents]
    return [types.Content(role=item.role, parts=[_part(p) for p in item.parts]) if isinstance(item, Message) else _part(item)
            for item in items]


async def invoke(*, model: str, system: str, contents: Any, json_output: bool, response_schema: dict | None,
                 web_search: bool) -> AIResult:
    tools = [types.Tool(google_search=types.GoogleSearch())] if web_search else None
    request = contents_for(contents)
    config = types.GenerateContentConfig(
        system_instruction=system or None, max_output_tokens=OUTPUT.value,
        response_mime_type="application/json" if json_output else None,
        response_schema=schema(response_schema) if response_schema else None,
        tools=tools, automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True))
    input_count = None
    try:
        if model not in _model_limits:
            info = await client().aio.models.get(model=model)
            if not info.input_token_limit or not info.output_token_limit:
                raise ProviderFailure("provider_configuration")
            _model_limits[model] = (info.input_token_limit, info.output_token_limit)
        input_limit, output_limit = _model_limits[model]
        config.max_output_tokens = min(OUTPUT.value, output_limit)
        schemas = json.dumps([tool.model_dump(mode="json", exclude_none=True) for tool in tools or []])
        count_contents = [types.Part(text=(system or "") + "\n" + schemas), *(request if isinstance(request, list) else [request])]
        counted = await client().aio.models.count_tokens(model=model, contents=count_contents)
        input_count = counted.total_tokens
        if input_count is None or input_count + config.max_output_tokens + SCHEMA_RESERVE.value > input_limit:
            raise ProviderFailure("budget_exhausted")
        response = await client().aio.models.generate_content(model=model, contents=request, config=config)
    except ProviderFailure:
        raise
    except Exception as exc:
        code = getattr(exc, "code", None)
        message, kind = (str(exc)[:300] if str(exc) else None), type(exc).__name__
        if code in (400, 401, 402, 403, 404):
            raise ProviderFailure("provider_configuration", http_status=code, original_message=message, exception_type=kind) from exc
        raise ProviderFailure("rate_limited" if code == 429 else "provider_unavailable",
                              retryable=code in (429, 500, 502, 503, 504) or code is None,
                              http_status=code if isinstance(code, int) else None, original_message=message, exception_type=kind) from exc

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
    usage = response.usage_metadata.model_dump(mode="json", exclude_none=True) if response.usage_metadata else {}
    usage["admission_input_tokens"] = input_count
    usage["admission_method"] = "complete content plus system/schema surrogate; wrapper reserve"
    # Gemini's grounding record is already in ApolloSG's shape (grounding_chunks / grounding_supports / web_search_queries).
    grounding = candidate.grounding_metadata.model_dump(mode="json", exclude_none=True) if candidate.grounding_metadata else None
    return AIResult(text, finish, usage, grounding, model, provider=PROVIDER)
