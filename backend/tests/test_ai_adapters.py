"""Claude and OpenAI adapters: each turns ApolloSG's neutral request into one call to its provider and returns the
answer in ApolloSG's terms. The SDK clients here are deterministic fakes — no provider call is made.

Run: cd /app/backend && python -m pytest tests/test_ai_adapters.py -q
"""
import json
from types import SimpleNamespace as NS

import anthropic
import httpx
import httpx2
import openai
import pytest

from services.higgins import adapters, ai_settings, provider
from services.higgins.adapters import _schema, claude, gpt
from services.higgins.ai_request import Message, Part, ProviderFailure
from services.higgins.llm_boundary import Purpose
from services.higgins.response_schema import response_schema

_real_generate = provider.generate  # captured before conftest's autouse live-call blocker replaces it

pytestmark = pytest.mark.anyio
SCHEMA = response_schema(evidence_ids=["ev-1"], source_ids=[], capability_ids=[])
ANSWER = {"overview": "Looks fine.", "assessment": "uncertain"}
PNG = b"\x89PNG\r\n\x1a\nfake"


@pytest.fixture
def anyio_backend():
    return "asyncio"


# ── The fixed answer shape as strict JSON Schema ─────────────────────────────
def _objects(node):
    if "anyOf" in node:
        for option in node["anyOf"]:
            yield from _objects(option)
    elif node.get("type") == "object":
        yield node
        for child in node["properties"].values():
            yield from _objects(child)
    elif node.get("type") == "array":
        yield from _objects(node["items"])


@pytest.mark.parametrize("array_limits", [False, True], ids=["claude", "openai"])
def test_the_shape_is_closed_and_fully_required_with_null_unions(array_limits):
    shape = _schema.strict(SCHEMA, array_limits=array_limits)
    for obj in _objects(shape):
        assert obj["additionalProperties"] is False and set(obj["required"]) == set(obj["properties"])
    props = shape["properties"]
    assert set(props) == set(SCHEMA["properties"]), "nothing added or dropped"
    assert props["outcome"]["type"] == ["string", "null"] and props["outcome"]["enum"][-1] is None
    assert props["question"]["anyOf"][1] == {"type": "null"}, "the optional question may be null"
    assert ("maxItems" in props["sourceIds"]) is array_limits
    if not array_limits:
        assert "At most 0 items." in props["sourceIds"]["description"], "Claude: the limit moves into the description"


# ── Settings: which Claude and OpenAI models can be selected ─────────────────
def test_claude_and_openai_models_need_their_key_on_the_server(monkeypatch):
    assert set(adapters.ADAPTERS) == {"gemini", "anthropic", "openai"}
    for pid, model in (("anthropic", "claude-sonnet-5-5"), ("openai", "gpt-5.5")):
        assert ai_settings.capabilities(model) >= {"json", "vision", "search"}
        monkeypatch.setattr(ai_settings, "key_configured", lambda _p: False)
        assert ai_settings.unavailable(pid, model) == [f"no {ai_settings.label(pid)} API key is set on the server"]
        monkeypatch.setattr(ai_settings, "key_configured", lambda _p: True)
        assert ai_settings.unavailable(pid, model) == []
    assert set(gpt.LIMITS) == set(ai_settings.PROVIDERS["openai"]["models"]), "every approved OpenAI model has its limits"


def test_options_never_carry_a_key_value(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-secret-value")
    assert "sk-ant-secret-value" not in json.dumps(ai_settings.options())
    assert ai_settings.key_configured("anthropic") is True


# ── Claude ───────────────────────────────────────────────────────────────────
def _caps(image=True, structured=True, search=True):
    yes = lambda ok: NS(supported=ok)  # noqa: E731
    return NS(image_input=yes(image), structured_outputs=yes(structured), server_tools=NS(supported=search, web_search=yes(search)))


class FakeClaude:
    def __init__(self, response=None, error=None, caps=None, max_input=1_000_000, counted=1_000):
        self.calls, self.counts, self.response, self.error = [], [], response, error
        info = NS(max_input_tokens=max_input, max_tokens=128_000, capabilities=caps or _caps())
        self.models = NS(retrieve=self._retrieve(info))
        self.messages = NS(create=self._create, count_tokens=self._count(counted))

    @staticmethod
    def _retrieve(info):
        async def retrieve(_model):
            return info
        return retrieve

    def _count(self, n):
        async def count(**kwargs):
            self.counts.append(kwargs)
            return NS(input_tokens=n)
        return count

    async def _create(self, **kwargs):
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        return self.response


def _claude_usage(**kw):
    return NS(input_tokens=kw.get("i", 900), output_tokens=kw.get("o", 100), cache_read_input_tokens=kw.get("c", 100),
              cache_creation_input_tokens=0, server_tool_use=NS(web_search_requests=kw.get("s", 0)))


@pytest.fixture
def fake_claude(monkeypatch):
    def install(**kwargs):
        fake = FakeClaude(**kwargs)
        monkeypatch.setattr(claude, "client", lambda: fake)
        claude._models.clear()
        return fake
    return install


async def test_claude_answer_shape_without_search_is_structured_output(fake_claude):
    fake = fake_claude(response=NS(stop_reason="end_turn", content=[NS(type="text", text=json.dumps(ANSWER))], usage=_claude_usage()))
    result = await claude.invoke(model="claude-sonnet-5-5", system="", contents=[Message("user", [Part(text="Is this real?"),
                                 Part.from_bytes(data=PNG, mime_type="image/png")])], json_output=True, response_schema=SCHEMA, web_search=False)
    sent = fake.calls[0]
    assert sent["output_config"]["format"]["type"] == "json_schema" and "tools" not in sent and "system" not in sent
    assert sent["max_tokens"] <= 128_000 and fake.counts[0]["messages"] == sent["messages"], "the complete request is counted"
    image = sent["messages"][0]["content"][1]
    assert image["type"] == "image" and image["source"]["media_type"] == "image/png"
    assert result.object() == ANSWER and result.finish_reason == "STOP" and result.provider == "anthropic" and result.grounding is None
    assert result.usage["prompt_token_count"] == 1_000 and result.usage["cached_content_token_count"] == 100


async def test_claude_answer_shape_with_search_is_a_strict_tool_and_the_sources_are_recorded(fake_claude):
    blocks = [NS(type="server_tool_use", name="web_search", input={"query": "example-scam.top scam warning"}),
              NS(type="web_search_tool_result", content=[NS(url="https://www.scamwatch.gov.au/a", title="Scamwatch alert")]),
              NS(type="tool_use", name=claude.ANSWER_TOOL, input=ANSWER)]
    fake = fake_claude(response=NS(stop_reason="tool_use", content=blocks, usage=_claude_usage(s=1)))
    result = await claude.invoke(model="claude-sonnet-5-5", system="", contents="Is this real?", json_output=True,
                                 response_schema=SCHEMA, web_search=True)
    sent = fake.calls[0]
    assert "output_config" not in sent and sent["tool_choice"] == {"type": "any"}
    web, answer = sent["tools"]
    assert web["type"].startswith("web_search_") and web["max_uses"] == claude.MAX_SEARCHES
    assert answer["name"] == claude.ANSWER_TOOL and answer["strict"] is True and answer["input_schema"]["additionalProperties"] is False
    assert result.object() == ANSWER
    assert result.grounding["grounding_chunks"] == [{"web": {"uri": "https://www.scamwatch.gov.au/a", "title": "Scamwatch alert",
                                                             "domain": "www.scamwatch.gov.au"}}]
    assert provider.search_query_count(result.grounding) == 1


async def test_claude_citations_become_supports_on_the_cited_text(fake_claude):
    first, second = "Q1 | NO_WARNING_FOUND | Searched – ", "nothing found on Scamwatch."
    blocks = [NS(type="text", text=first, citations=None),
              NS(type="text", text=second, citations=[NS(url="https://scamwatch.gov.au/x", title="Scamwatch")])]
    fake_claude(response=NS(stop_reason="end_turn", content=blocks, usage=_claude_usage()))
    result = await claude.invoke(model="claude-haiku-5-5", system="", contents="Q1", json_output=False, response_schema=None, web_search=True)
    assert result.text == first + second
    support = result.grounding["grounding_supports"][0]
    start = len(first.encode("utf-8"))  # byte offsets: the en dash is 3 bytes
    assert support["segment"]["start_index"] == start and support["segment"]["end_index"] == start + len(second.encode())
    assert support["grounding_chunk_indices"] == [0]


@pytest.mark.parametrize("stop", ["max_tokens", "refusal", "pause_turn"])
async def test_claude_unfinished_answers_are_reported_incomplete(fake_claude, stop):
    fake_claude(response=NS(stop_reason=stop, content=[NS(type="text", text="{")], usage=_claude_usage()))
    with pytest.raises(ProviderFailure) as exc:
        await claude.invoke(model="claude-opus-5-5", system="", contents="q", json_output=True, response_schema=SCHEMA, web_search=False)
    assert exc.value.code == "incomplete_output" and exc.value.finish_reason == stop.upper()


async def test_claude_ending_without_the_answer_tool_is_incomplete(fake_claude):
    fake_claude(response=NS(stop_reason="end_turn", content=[NS(type="text", text="Done.", citations=None)], usage=_claude_usage()))
    with pytest.raises(ProviderFailure) as exc:
        await claude.invoke(model="claude-opus-5-5", system="", contents="q", json_output=True, response_schema=SCHEMA, web_search=True)
    assert exc.value.code == "incomplete_output"


async def test_claude_refuses_before_any_call_what_the_model_cannot_do_or_fit(fake_claude):
    fake = fake_claude(caps=_caps(search=False))
    with pytest.raises(ProviderFailure) as exc:
        await claude.invoke(model="claude-haiku-5-5", system="", contents="q", json_output=False, response_schema=None, web_search=True)
    assert exc.value.code == "provider_configuration" and "web_search" in exc.value.original_message and not fake.calls
    fake = fake_claude(max_input=2_000, counted=1_500)
    with pytest.raises(ProviderFailure) as exc:
        await claude.invoke(model="claude-haiku-5-5", system="", contents="q", json_output=False, response_schema=None, web_search=False)
    assert exc.value.code == "budget_exhausted" and not fake.calls, "nothing is cut short to make it fit"
    with pytest.raises(ProviderFailure) as exc:
        await claude.invoke(model="claude-haiku-5-5", system="", contents=[Part.from_bytes(data=b"x", mime_type="audio/mpeg")],
                            json_output=False, response_schema=None, web_search=False)
    assert exc.value.code == "provider_configuration" and "audio/mpeg" in exc.value.original_message


@pytest.mark.parametrize("status, code, retryable", [(401, "provider_configuration", False), (429, "rate_limited", True),
                                                     (529, "provider_unavailable", True)])
async def test_claude_errors_are_reported_as_they_are(fake_claude, status, code, retryable):
    response = httpx2.Response(status, request=httpx2.Request("POST", "https://api.anthropic.com/v1/messages"))
    fake_claude(error=anthropic.APIStatusError("api_key=sk-ant-abcdefghijklmnopqrstuvwxyz failed", response=response, body=None))
    with pytest.raises(ProviderFailure) as exc:
        await claude.invoke(model="claude-sonnet-5-5", system="", contents="q", json_output=False, response_schema=None, web_search=False)
    assert (exc.value.code, exc.value.retryable, exc.value.http_status) == (code, retryable, status)
    assert "sk-ant-abcdefghijklmnopqrstuvwxyz" not in (exc.value.original_message or ""), "keys never reach the diagnostics"


# ── OpenAI ───────────────────────────────────────────────────────────────────
class FakeOpenAI:
    def __init__(self, data=None, error=None, counted=1_000):
        self.calls, self.counts, self.data, self.error, self.counted = [], [], data, error, counted
        self.responses = NS(create=self._create)

    async def post(self, path, *, cast_to, body):
        assert path == "/responses/input_tokens" and cast_to is object
        self.counts.append(body)
        return {"object": "response.input_tokens", "input_tokens": self.counted}

    async def _create(self, **kwargs):
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        return NS(model_dump=lambda mode="json": self.data)


def _openai_data(text, *, status="completed", annotations=(), search=None, reason=None):
    output = [search] if search else []
    output.append({"type": "message", "content": [{"type": "output_text", "text": text, "annotations": list(annotations)}]})
    return {"status": status, "incomplete_details": {"reason": reason} if reason else None, "output": output,
            "usage": {"input_tokens": 1_000, "input_tokens_details": {"cached_tokens": 200}, "output_tokens": 300,
                      "output_tokens_details": {"reasoning_tokens": 120}, "total_tokens": 1_300}}


@pytest.fixture
def fake_openai(monkeypatch):
    def install(**kwargs):
        fake = FakeOpenAI(**kwargs)
        monkeypatch.setattr(gpt, "client", lambda: fake)
        return fake
    return install


async def test_openai_answer_shape_and_search_in_one_call(fake_openai):
    search = {"type": "web_search_call", "action": {"type": "search", "queries": ["example-scam.top"],
                                                    "sources": [{"type": "url", "url": "https://www.scamwatch.gov.au/a"}]}}
    fake = fake_openai(data=_openai_data(json.dumps(ANSWER), search=search))
    result = await gpt.invoke(model="gpt-5.5", system="", contents=[Message("user", [Part(text="Is this real?"),
                              Part.from_bytes(data=PNG, mime_type="image/png")])], json_output=True, response_schema=SCHEMA, web_search=True)
    sent = fake.calls[0]
    assert sent["store"] is False and sent["tools"] == [{"type": "web_search"}] and "instructions" not in sent
    assert sent["text"]["format"]["strict"] is True and sent["text"]["format"]["schema"]["additionalProperties"] is False
    assert sent["include"] == ["web_search_call.action.sources"] and sent["max_output_tokens"] <= 128_000
    assert sent["input"][0]["content"][1]["image_url"].startswith("data:image/png;base64,")
    assert fake.counts[0]["input"] == sent["input"] and "store" not in fake.counts[0], "the complete request is counted"
    assert result.object() == ANSWER and result.provider == "openai" and provider.search_query_count(result.grounding) == 1
    assert result.grounding["grounding_chunks"][0]["web"]["domain"] == "www.scamwatch.gov.au"
    assert result.usage["candidates_token_count"] == 180 and result.usage["thoughts_token_count"] == 120


async def test_openai_citations_become_supports_in_byte_offsets(fake_openai):
    text = "Q1 | WARNING | Listed – see ([scamwatch.gov.au](https://scamwatch.gov.au/x))"
    start = text.index("([")
    fake_openai(data=_openai_data(text, annotations=[{"type": "url_citation", "start_index": start, "end_index": len(text),
                                                      "url": "https://scamwatch.gov.au/x", "title": "Scamwatch"}]))
    result = await gpt.invoke(model="gpt-5.6-luna", system="", contents="Q1", json_output=False, response_schema=None, web_search=True)
    segment = result.grounding["grounding_supports"][0]["segment"]
    assert segment["start_index"] == len(text[:start].encode("utf-8")) == start + 2, "the en dash is 3 bytes"
    assert segment["end_index"] == len(text.encode("utf-8"))


@pytest.mark.parametrize("data, finish", [(_openai_data("{", status="incomplete", reason="max_output_tokens"), "MAX_TOKENS"),
                                          ({"status": "completed", "output": [{"type": "message", "content": [{"type": "refusal", "refusal": "no"}]}]}, "REFUSAL")])
async def test_openai_unfinished_answers_are_reported_incomplete(fake_openai, data, finish):
    fake_openai(data=data)
    with pytest.raises(ProviderFailure) as exc:
        await gpt.invoke(model="gpt-5.4", system="", contents="q", json_output=True, response_schema=SCHEMA, web_search=False)
    assert exc.value.code == "incomplete_output" and exc.value.finish_reason == finish


async def test_openai_refuses_what_would_not_fit_and_unknown_models(fake_openai):
    fake = fake_openai(counted=399_000)
    with pytest.raises(ProviderFailure) as exc:
        await gpt.invoke(model="gpt-5.4-mini", system="", contents="q", json_output=False, response_schema=None, web_search=False)
    assert exc.value.code == "budget_exhausted" and not fake.calls
    with pytest.raises(ProviderFailure) as exc:
        await gpt.invoke(model="gpt-4", system="", contents="q", json_output=False, response_schema=None, web_search=False)
    assert exc.value.code == "provider_configuration"


@pytest.mark.parametrize("status, code", [(401, "provider_configuration"), (429, "rate_limited"), (503, "provider_unavailable")])
async def test_openai_errors_are_reported_as_they_are(fake_openai, status, code):
    response = httpx.Response(status, request=httpx.Request("POST", "https://api.openai.com/v1/responses"))
    fake_openai(error=openai.APIStatusError("Incorrect API key provided: sk-proj-abcdefghijklmnopqrstuvwxyz", response=response, body=None))
    with pytest.raises(ProviderFailure) as exc:
        await gpt.invoke(model="gpt-5.5", system="", contents="q", json_output=False, response_schema=None, web_search=False)
    assert exc.value.code == code and exc.value.http_status == status
    assert "sk-proj-abcdefghijklmnopqrstuvwxyz" not in (exc.value.original_message or "")


# ── The gateway hands each model to its own provider's adapter, and only that one ──
@pytest.mark.parametrize("model, provider_id", [("claude-sonnet-5-5", "anthropic"), ("gpt-5.6-luna", "openai"),
                                                ("gemini-3.1-flash-lite", "gemini")])
async def test_the_gateway_calls_only_the_selected_models_adapter(monkeypatch, model, provider_id):
    called: list[str] = []
    for pid, module in adapters.ADAPTERS.items():
        async def invoke(*, model, system, contents, json_output, response_schema, web_search, _pid=pid):
            called.append(_pid)
            return provider.AIResult(json.dumps(ANSWER), "STOP", {}, None, model, provider=_pid)
        monkeypatch.setattr(module, "invoke", invoke)

    async def no_record(**_kwargs):
        return None
    monkeypatch.setattr(provider, "_record_usage", no_record)
    monkeypatch.setattr(provider, "_preview_generate", None)
    monkeypatch.delenv("APOLLO_FORBID_PROVIDER_CALLS", raising=False)
    result = await _real_generate("", "Is example.com real?", model=model, json_output=True, response_schema=SCHEMA,
                                     web_search=True, capability="search", purpose=Purpose.INVESTIGATION)
    assert called == [provider_id] and result.provider == provider_id and result.model == model


async def test_the_gateway_refuses_audio_for_a_model_that_cannot_hear(monkeypatch):
    monkeypatch.setattr(provider, "_preview_generate", None)
    with pytest.raises(ProviderFailure) as exc:
        await _real_generate("", "q", model="claude-sonnet-5-5", capability="audio_input", purpose=Purpose.INVESTIGATION)
    assert exc.value.code == "provider_configuration"
