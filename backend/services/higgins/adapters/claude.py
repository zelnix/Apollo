"""Anthropic Claude adapter: one ApolloSG request → one Claude Messages API call, through Anthropic's SDK (anthropic).

No prompt/response logging, hidden-reasoning display, implicit model switches or SDK retries (one attempt). Before the
call, Anthropic's own record of the model (Models API) gives its limits and what it can do, and the request is measured
with Claude's token count; a request that would not fit is refused (budget_exhausted), never cut short to make it fit.

The fixed answer shape: Claude's structured output can't be combined with web search (whose citations are always on).
So when a call needs both, the shape is a strict tool, `apollo_answer` (grammar-constrained like structured output),
that Claude must finish by calling: the tool's input is the answer. Without web search the shape is sent as Claude's
structured output. Web searches are capped at MAX_SEARCHES per call.
"""
from __future__ import annotations

import base64
import json
from typing import Any
from urllib.parse import urlparse

from anthropic import APIConnectionError, APIStatusError, AsyncAnthropic

from core.config import ANTHROPIC_API_KEY
from services.higgins.adapters._schema import strict
from services.higgins.ai_request import AIResult, Message, Part, ProviderFailure
from services.higgins.capacity import CALL_SECONDS, OUTPUT, SCHEMA_RESERVE

PROVIDER = "anthropic"
SDK = "anthropic"
ACCOUNT = "Direct Anthropic API key"
RETENTION = ("ApolloSG uses the Claude API directly via Anthropic's SDK under Anthropic's published API terms. "
             "ApolloSG does not control or independently verify Anthropic's internal retention practices. ApolloSG's own "
             "request-scoped processing copies are closed after completion.")

MAX_SEARCHES = 5
WEB_SEARCH = {"type": "web_search_20250305", "name": "web_search", "max_uses": MAX_SEARCHES}
ANSWER_TOOL = "apollo_answer"
IMAGE_TYPES = frozenset({"image/jpeg", "image/png", "image/gif", "image/webp"})
_COMPLETE = {"end_turn", "tool_use", "stop_sequence"}

_client: AsyncAnthropic | None = None
_models: dict[str, Any] = {}


def key_configured() -> bool:
    return bool(ANTHROPIC_API_KEY)


def client() -> AsyncAnthropic:
    """The Claude SDK client for live calls. Unreachable while the preview simulator answers instead."""
    global _client
    from services.higgins import provider  # the gateway: is the preview simulator installed on this server?

    if provider.get_provider_mode() == "preview":
        raise ProviderFailure("provider_configuration",
                              original_message="FATAL: the Claude client was requested while the preview simulator is installed. "
                                               "The preview dispatch handles all generate() calls.")
    if not ANTHROPIC_API_KEY:
        raise ProviderFailure("provider_configuration", original_message="ANTHROPIC_API_KEY is not set. Cannot make live Claude calls.")
    if _client is None:
        _client = AsyncAnthropic(api_key=ANTHROPIC_API_KEY, max_retries=0, timeout=CALL_SECONDS)
    return _client


def _block(part: Any) -> dict | None:
    if isinstance(part, str):
        return {"type": "text", "text": part} if part else None
    if part.data is not None:
        if part.mime_type not in IMAGE_TYPES:
            raise ProviderFailure("provider_configuration", original_message=f"Claude can't read {part.mime_type} evidence.")
        return {"type": "image", "source": {"type": "base64", "media_type": part.mime_type,
                                            "data": base64.b64encode(part.data).decode("ascii")}}
    return {"type": "text", "text": part.text} if part.text else None


def messages_for(contents: Any) -> list[dict]:
    """ApolloSG's request as Claude messages. Loose parts or text go in one user message."""
    items = contents if isinstance(contents, list) else [contents]
    out: list[dict] = []
    loose: list[dict] = []
    for item in items:
        if isinstance(item, Message):
            blocks = [b for b in (_block(p) for p in item.parts) if b]
            out.append({"role": "assistant" if item.role in ("model", "assistant") else "user", "content": blocks})
        elif (block := _block(item)) is not None:
            loose.append(block)
    if loose:
        out.append({"role": "user", "content": loose})
    return out


def _supports(info: Any, need: str) -> bool:
    """Anthropic's own record of whether the model can do `need`. A record without capabilities can't refuse."""
    caps = getattr(info, "capabilities", None)
    if caps is None:
        return True
    if need == "web_search":
        return bool(caps.server_tools.supported and caps.server_tools.web_search.supported)
    return bool(getattr(caps, need).supported)


async def _model(model: str) -> Any:
    if model not in _models:
        info = await client().models.retrieve(model)
        if not info.max_input_tokens or not info.max_tokens:
            raise ProviderFailure("provider_configuration", original_message=f"Anthropic didn't report {model}'s token limits.")
        _models[model] = info
    return _models[model]


def _grounding(blocks: list) -> dict:
    """Claude's searches, results and citations in ApolloSG's web-search record (UTF-8 byte offsets into the text)."""
    chunks: list[dict] = []
    index: dict[str, int] = {}
    supports: list[dict] = []
    queries: list[str] = []

    def chunk(url: str, title: str | None) -> int:
        if url not in index:
            index[url] = len(chunks)
            chunks.append({"web": {"uri": url, "title": title or "", "domain": (urlparse(url).hostname or "").lower()}})
        return index[url]

    offset = 0
    for block in blocks:
        if block.type == "server_tool_use" and block.name == "web_search":
            query = (block.input or {}).get("query")
            if query:
                queries.append(query)
        elif block.type == "web_search_tool_result" and isinstance(block.content, list):
            for result in block.content:
                if getattr(result, "url", None):
                    chunk(result.url, getattr(result, "title", None))
        elif block.type == "text":
            size = len(block.text.encode("utf-8"))
            cited = sorted({chunk(c.url, getattr(c, "title", None)) for c in (block.citations or []) if getattr(c, "url", None)})
            if cited:
                supports.append({"segment": {"start_index": offset, "end_index": offset + size, "text": block.text},
                                 "grounding_chunk_indices": cited})
            offset += size
    return {"grounding_chunks": chunks, "grounding_supports": supports, "web_search_queries": queries}


def _usage(usage: Any) -> dict:
    cache_read = usage.cache_read_input_tokens or 0
    prompt = (usage.input_tokens or 0) + cache_read + (usage.cache_creation_input_tokens or 0)
    out = {"prompt_token_count": prompt, "candidates_token_count": usage.output_tokens,
           "total_token_count": prompt + (usage.output_tokens or 0), "cached_content_token_count": cache_read}
    searches = getattr(getattr(usage, "server_tool_use", None), "web_search_requests", None)
    if searches is not None:
        out["web_search_requests"] = searches
    return out


def _failure(exc: Exception) -> ProviderFailure:
    message, kind = (str(exc)[:300] or None), type(exc).__name__
    if isinstance(exc, APIStatusError):
        code = exc.status_code
        if code in (400, 401, 402, 403, 404, 413):
            return ProviderFailure("provider_configuration", http_status=code, original_message=message, exception_type=kind)
        return ProviderFailure("rate_limited" if code == 429 else "provider_unavailable", retryable=code in (429, 500, 502, 503, 504, 529),
                               http_status=code, original_message=message, exception_type=kind)
    return ProviderFailure("provider_unavailable", retryable=True, original_message=message, exception_type=kind)


async def invoke(*, model: str, system: str, contents: Any, json_output: bool, response_schema: dict | None,
                 web_search: bool) -> AIResult:
    messages = messages_for(contents)
    request: dict[str, Any] = {"model": model, "messages": messages}
    if system:
        request["system"] = system
    shaped = bool(json_output and response_schema)
    answer_tool = shaped and web_search
    tools: list[dict] = [dict(WEB_SEARCH)] if web_search else []
    if answer_tool:
        tools.append({"name": ANSWER_TOOL, "strict": True, "input_schema": strict(response_schema, array_limits=False),
                      "description": "Return the answer in ApolloSG's required shape. Call this exactly once, as the final step."})
        request["tool_choice"] = {"type": "any"}
    elif shaped:
        request["output_config"] = {"format": {"type": "json_schema", "schema": strict(response_schema, array_limits=False)}}
    if tools:
        request["tools"] = tools
    needs = (["image_input"] if any(b["type"] == "image" for m in messages for b in m["content"]) else []) \
        + (["structured_outputs"] if shaped else []) + (["web_search"] if web_search else [])

    input_count = None
    try:
        info = await _model(model)
        missing = [need for need in needs if not _supports(info, need)]
        if missing:
            raise ProviderFailure("provider_configuration",
                                  original_message=f"Anthropic says {model} can't do what this call needs ({', '.join(missing)}).")
        max_tokens = min(OUTPUT.value, info.max_tokens)
        input_count = (await client().messages.count_tokens(**request)).input_tokens
        if input_count is None or input_count + max_tokens + SCHEMA_RESERVE.value > info.max_input_tokens:
            raise ProviderFailure("budget_exhausted")
        response = await client().messages.create(max_tokens=max_tokens, **request)
    except ProviderFailure:
        raise
    except (APIStatusError, APIConnectionError) as exc:
        raise _failure(exc) from exc

    stop = response.stop_reason or "unknown"
    if stop not in _COMPLETE:
        raise ProviderFailure("incomplete_output", finish_reason=str(stop).upper())
    blocks = response.content or []
    if answer_tool:
        call = next((b for b in blocks if b.type == "tool_use" and b.name == ANSWER_TOOL), None)
        if call is None:
            raise ProviderFailure("incomplete_output", finish_reason=str(stop).upper())
        text = json.dumps(call.input, ensure_ascii=False)
    else:
        text = "".join(b.text for b in blocks if b.type == "text")
        if not text:
            raise ProviderFailure("incomplete_output", finish_reason=str(stop).upper())
    usage = _usage(response.usage)
    usage["admission_input_tokens"] = input_count
    usage["admission_method"] = "Claude token count of the complete request; wrapper reserve"
    return AIResult(text, "STOP", usage, _grounding(blocks) if web_search else None, model, provider=PROVIDER)
