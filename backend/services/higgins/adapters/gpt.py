"""OpenAI adapter: one ApolloSG request → one OpenAI Responses API call, through OpenAI's SDK (openai).

No prompt/response logging, hidden-reasoning display, implicit model switches or SDK retries (one attempt), and
response storage at OpenAI is turned off (store=false). OpenAI's API doesn't report a model's limits, so they are the
published ones below (developers.openai.com/api/docs/models); before the call the request is measured with OpenAI's
own input-token count and refused (budget_exhausted) when it would not fit, never cut short to make it fit.

The fixed answer shape is sent as OpenAI's strict structured output; it combines with OpenAI's web search tool.
"""
from __future__ import annotations

import base64
from typing import Any
from urllib.parse import urlparse

from openai import APIConnectionError, APIStatusError, AsyncOpenAI

from core.config import OPENAI_API_KEY
from services.higgins.adapters._schema import strict
from services.higgins.ai_request import AIResult, Message, Part, ProviderFailure
from services.higgins.capacity import CALL_SECONDS, OUTPUT, SCHEMA_RESERVE

PROVIDER = "openai"
SDK = "openai"
ACCOUNT = "Direct OpenAI API key"
RETENTION = ("ApolloSG uses the OpenAI API directly via OpenAI's SDK under OpenAI's published API terms, with response "
             "storage turned off. ApolloSG does not control or independently verify OpenAI's internal retention practices. "
             "ApolloSG's own request-scoped processing copies are closed after completion.")

# (context window, max output tokens), as published on each model's page.
LIMITS: dict[str, tuple[int, int]] = {
    "gpt-5.6-luna": (1_050_000, 128_000),
    "gpt-5.6-terra": (1_050_000, 128_000),
    "gpt-5.6-sol": (1_050_000, 128_000),
    "gpt-5.5": (1_050_000, 128_000),
    "gpt-5.4": (1_050_000, 128_000),
    "gpt-5.4-mini": (400_000, 128_000),
}
IMAGE_TYPES = frozenset({"image/jpeg", "image/png", "image/gif", "image/webp"})

_client: AsyncOpenAI | None = None


def key_configured() -> bool:
    return bool(OPENAI_API_KEY)


def client() -> AsyncOpenAI:
    """The OpenAI SDK client for live calls. Unreachable while the preview simulator answers instead."""
    global _client
    from services.higgins import provider  # the gateway: is the preview simulator installed on this server?

    if provider.get_provider_mode() == "preview":
        raise ProviderFailure("provider_configuration",
                              original_message="FATAL: the OpenAI client was requested while the preview simulator is installed. "
                                               "The preview dispatch handles all generate() calls.")
    if not OPENAI_API_KEY:
        raise ProviderFailure("provider_configuration", original_message="OPENAI_API_KEY is not set. Cannot make live OpenAI calls.")
    if _client is None:
        _client = AsyncOpenAI(api_key=OPENAI_API_KEY, max_retries=0, timeout=CALL_SECONDS)
    return _client


def _content(part: Any, assistant: bool) -> dict | None:
    if isinstance(part, str):
        part = Part(text=part)
    if part.data is not None:
        if part.mime_type not in IMAGE_TYPES:
            raise ProviderFailure("provider_configuration", original_message=f"OpenAI can't read {part.mime_type} evidence.")
        return {"type": "input_image", "image_url": f"data:{part.mime_type};base64,{base64.b64encode(part.data).decode('ascii')}"}
    if not part.text:
        return None
    return {"type": "output_text" if assistant else "input_text", "text": part.text}


def input_for(contents: Any) -> list[dict]:
    """ApolloSG's request as Responses API input. Loose parts or text go in one user message."""
    items = contents if isinstance(contents, list) else [contents]
    out: list[dict] = []
    loose: list[dict] = []
    for item in items:
        if isinstance(item, Message):
            assistant = item.role in ("model", "assistant")
            out.append({"role": "assistant" if assistant else "user",
                        "content": [c for c in (_content(p, assistant) for p in item.parts) if c]})
        elif (content := _content(item, False)) is not None:
            loose.append(content)
    if loose:
        out.append({"role": "user", "content": loose})
    return out


def _read(data: dict) -> tuple[str, dict]:
    """The answer text and ApolloSG's web-search record (UTF-8 byte offsets into the text)."""
    chunks: list[dict] = []
    index: dict[str, int] = {}
    supports: list[dict] = []
    queries: list[str] = []
    texts: list[str] = []

    def chunk(url: str, title: str | None) -> int:
        if url not in index:
            index[url] = len(chunks)
            chunks.append({"web": {"uri": url, "title": title or "", "domain": (urlparse(url).hostname or "").lower()}})
        return index[url]

    offset = 0
    for item in data.get("output") or []:
        if item.get("type") == "web_search_call":
            action = item.get("action") or {}
            queries += [q for q in (action.get("queries") or [action.get("query")]) if q]
            for source in action.get("sources") or []:
                if source.get("url"):
                    chunk(source["url"], source.get("title"))
        elif item.get("type") == "message":
            for content in item.get("content") or []:
                if content.get("type") == "refusal":
                    raise ProviderFailure("incomplete_output", finish_reason="REFUSAL")
                if content.get("type") != "output_text":
                    continue
                text = content.get("text") or ""
                for note in content.get("annotations") or []:
                    if note.get("type") == "url_citation" and note.get("url"):
                        start, end = note.get("start_index") or 0, note.get("end_index") or 0
                        supports.append({"segment": {"start_index": offset + len(text[:start].encode("utf-8")),
                                                     "end_index": offset + len(text[:end].encode("utf-8")), "text": text[start:end]},
                                         "grounding_chunk_indices": [chunk(note["url"], note.get("title"))]})
                texts.append(text)
                offset += len(text.encode("utf-8"))
    return "".join(texts), {"grounding_chunks": chunks, "grounding_supports": supports, "web_search_queries": queries}


def _usage(usage: dict) -> dict:
    output = usage.get("output_tokens") or 0
    reasoning = (usage.get("output_tokens_details") or {}).get("reasoning_tokens") or 0
    return {"prompt_token_count": usage.get("input_tokens"), "candidates_token_count": output - reasoning,
            "thoughts_token_count": reasoning, "total_token_count": usage.get("total_tokens"),
            "cached_content_token_count": (usage.get("input_tokens_details") or {}).get("cached_tokens") or 0}


def _failure(exc: Exception) -> ProviderFailure:
    message, kind = (str(exc)[:300] or None), type(exc).__name__
    if isinstance(exc, APIStatusError):
        code = exc.status_code
        if code in (400, 401, 402, 403, 404, 413):
            return ProviderFailure("provider_configuration", http_status=code, original_message=message, exception_type=kind)
        return ProviderFailure("rate_limited" if code == 429 else "provider_unavailable", retryable=code in (429, 500, 502, 503, 504),
                               http_status=code, original_message=message, exception_type=kind)
    return ProviderFailure("provider_unavailable", retryable=True, original_message=message, exception_type=kind)


async def invoke(*, model: str, system: str, contents: Any, json_output: bool, response_schema: dict | None,
                 web_search: bool) -> AIResult:
    if model not in LIMITS:
        raise ProviderFailure("provider_configuration", original_message=f"ApolloSG has no published limits for {model}.")
    context, max_output = LIMITS[model]
    request: dict[str, Any] = {"model": model, "input": input_for(contents)}
    if system:
        request["instructions"] = system
    if web_search:
        request["tools"] = [{"type": "web_search"}]
    if json_output and response_schema:
        request["text"] = {"format": {"type": "json_schema", "name": "apollo_answer", "strict": True,
                                      "schema": strict(response_schema, array_limits=True)}}
    max_tokens = min(OUTPUT.value, max_output)
    input_count = None
    try:
        counted = await client().post("/responses/input_tokens", cast_to=object, body=request)
        input_count = (counted or {}).get("input_tokens") if isinstance(counted, dict) else None
        if input_count is None or input_count + max_tokens + SCHEMA_RESERVE.value > context:
            raise ProviderFailure("budget_exhausted")
        response = await client().responses.create(**request, store=False, max_output_tokens=max_tokens,
                                                   **({"include": ["web_search_call.action.sources"]} if web_search else {}))
    except ProviderFailure:
        raise
    except (APIStatusError, APIConnectionError) as exc:
        raise _failure(exc) from exc

    data = response.model_dump(mode="json")
    if data.get("status") != "completed":
        reason = (data.get("incomplete_details") or {}).get("reason")
        raise ProviderFailure("incomplete_output", finish_reason="MAX_TOKENS" if reason == "max_output_tokens"
                              else str(reason or data.get("status") or "unknown").upper())
    text, grounding = _read(data)
    if not text:
        raise ProviderFailure("incomplete_output", finish_reason="STOP")
    usage = _usage(data.get("usage") or {})
    usage["admission_input_tokens"] = input_count
    usage["admission_method"] = "OpenAI input-token count of the complete request; wrapper reserve"
    return AIResult(text, "STOP", usage, grounding if web_search else None, model, provider=PROVIDER)
