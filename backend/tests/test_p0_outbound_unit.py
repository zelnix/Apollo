"""P0-01 outbound transport hardening unit tests (no live network calls)."""
from __future__ import annotations

import asyncio
import sys
from contextlib import asynccontextmanager
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services import outbound  # noqa: E402


class _Resp:
    def __init__(self, status: int = 200, headers: dict[str, str] | None = None, chunks: list[bytes] | None = None):
        self.status_code = status
        self.headers = headers or {}
        self._chunks = chunks or []

    async def aiter_raw(self, chunk_size: int = 16384):
        for chunk in self._chunks:
            await asyncio.sleep(0)
            yield chunk


class _StreamCtx:
    def __init__(self, response: _Resp):
        self.response = response

    async def __aenter__(self):
        return self.response

    async def __aexit__(self, exc_type, exc, tb):
        return False


class _Client:
    def __init__(self, recorder: list[dict], responses: list[_Resp], **kwargs):
        self.recorder = recorder
        self.responses = responses
        self.kwargs = kwargs

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    def stream(self, method, url, headers=None, extensions=None):
        self.recorder.append({
            "method": method,
            "url": str(url),
            "headers": headers or {},
            "extensions": extensions or {},
        })
        if not self.responses:
            raise AssertionError("no response configured")
        return _StreamCtx(self.responses.pop(0))


@pytest.mark.parametrize(
    "value,expected",
    [
        ("8.8.8.8", True),
        ("1.1.1.1", True),
        ("127.0.0.1", False),
        ("10.0.0.2", False),
        ("169.254.1.1", False),
        ("::1", False),
        ("::ffff:127.0.0.1", False),
        ("2002:c000:0201::", False),  # 6to4 (maps 192.0.2.1)
        ("64:ff9b::808:808", False),
    ],
)
def test_public_ip_denies_private_and_transition_forms(value, expected):
    assert outbound.public_ip(value) is expected


def test_parse_target_strictly_validates_scheme_host_port_userinfo():
    ok = outbound.parse_target("https://example.com/path?q=1#frag")
    assert ok.host == "example.com"
    assert ok.fragment == ""

    blocked = [
        "ftp://example.com/file",
        "https://user:pass@example.com/",
        "https://localhost/",
        "http://example.com:8080/",
        "https://example.com\\bad",
    ]
    for raw in blocked:
        with pytest.raises(outbound.OutboundBlocked):
            outbound.parse_target(raw)


@pytest.mark.asyncio
async def test_public_stream_pins_numeric_connect_and_preserves_host_sni(monkeypatch):
    calls: list[dict] = []
    monkeypatch.setattr(outbound, "resolve_public", lambda host, port: asyncio.sleep(0, result=["93.184.216.34"]))
    monkeypatch.setattr(outbound.httpx, "AsyncClient", lambda **kwargs: _Client(calls, [_Resp(status=200, headers={"content-length": "2"}, chunks=[b"ok"])], **kwargs))

    async with outbound.public_stream("GET", "https://example.com/path") as resp:
        body = await outbound.bounded_body(resp)
        assert body == b"ok"

    assert len(calls) == 1
    assert calls[0]["url"].startswith("https://93.184.216.34")
    assert calls[0]["headers"]["Host"] == "example.com"
    assert calls[0]["extensions"]["sni_hostname"] == "example.com"


@pytest.mark.asyncio
async def test_private_target_stops_before_socket_transport(monkeypatch):
    called = {"client": 0}

    def _client(**kwargs):
        called["client"] += 1
        return _Client([], [], **kwargs)

    monkeypatch.setattr(outbound, "resolve_public", lambda *_: (_ for _ in ()).throw(outbound.OutboundBlocked("private_target")))
    monkeypatch.setattr(outbound.httpx, "AsyncClient", _client)
    with pytest.raises(outbound.OutboundBlocked, match="private_target"):
        async with outbound.public_stream("GET", "https://example.com"):
            pass
    assert called["client"] == 0


@pytest.mark.asyncio
async def test_public_to_private_redirect_never_opens_private_socket(monkeypatch):
    calls: list[dict] = []
    responses = [_Resp(status=302, headers={"location": "http://127.0.0.1/hidden", "content-length": "0"}, chunks=[])]

    async def _resolve(host: str, _port: int):
        if host == "example.com":
            return ["93.184.216.34"]
        raise outbound.OutboundBlocked("private_target")

    monkeypatch.setattr(outbound, "resolve_public", _resolve)
    monkeypatch.setattr(outbound.httpx, "AsyncClient", lambda **kwargs: _Client(calls, responses, **kwargs))

    with pytest.raises(outbound.OutboundBlocked, match="private_target"):
        await outbound.public_get("https://example.com/start")
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_resolver_reordering_cannot_change_pinned_connect_target(monkeypatch):
    calls: list[dict] = []
    responses = [
        _Resp(status=200, headers={"content-length": "2"}),
        _Resp(status=200, headers={"content-length": "2"}, chunks=[b"ok"]),
    ]
    ips = ["93.184.216.34", "151.101.1.69"]
    started = asyncio.Event()
    proceed = asyncio.Event()

    async def _resolve(_host: str, _port: int):
        snapshot = list(ips)
        started.set()
        await proceed.wait()
        return snapshot

    monkeypatch.setattr(outbound, "resolve_public", _resolve)
    monkeypatch.setattr(outbound.httpx, "AsyncClient", lambda **kwargs: _Client(calls, responses, **kwargs))

    task = asyncio.create_task(outbound.public_get("https://example.com"))
    await started.wait()
    ips.reverse()  # later resolver changes must not affect the in-flight pinned connect target
    proceed.set()
    res = await task
    assert res.status_code == 200
    assert calls[0]["url"].startswith("https://93.184.216.34")


@pytest.mark.asyncio
async def test_safe_public_success(monkeypatch):
    calls: list[dict] = []
    responses = [
        _Resp(status=200, headers={"content-length": "5"}),
        _Resp(status=200, headers={"content-length": "5"}, chunks=[b"hello"]),
    ]
    monkeypatch.setattr(outbound, "resolve_public", lambda *_: asyncio.sleep(0, result=["93.184.216.34"]))
    monkeypatch.setattr(outbound.httpx, "AsyncClient", lambda **kwargs: _Client(calls, responses, **kwargs))

    res = await outbound.public_get("https://example.com")
    assert res.status_code == 200
    assert res.content == b"hello"


@pytest.mark.asyncio
async def test_head_405_then_get_headers_only_no_body_consumption(monkeypatch):
    """Expected transport behavior: HEAD preflight may 405, then GET should proceed safely.

    This test intentionally describes required behavior; if absent, it should fail visibly.
    """
    methods: list[str] = []

    @asynccontextmanager
    async def _fake_stream(method: str, _url: str):
        methods.append(method)
        if method == "HEAD":
            yield _Resp(status=405, headers={"content-length": "9999999"}, chunks=[])
            return
        yield _Resp(status=200, headers={"content-length": "2"}, chunks=[b"ok"])

    monkeypatch.setattr(outbound, "public_stream", _fake_stream)
    result = await outbound.public_get("https://example.com")
    assert result.status_code == 200
    # Required: try HEAD first (headers only), then GET after 405.
    assert methods[:2] == ["HEAD", "GET"]


@pytest.mark.asyncio
async def test_resolve_public_blocks_mixed_dns_answers(monkeypatch):
    class _Loop:
        async def getaddrinfo(self, *_args, **_kwargs):
            return [
                (2, 1, 6, "", ("93.184.216.34", 443)),
                (2, 1, 6, "", ("127.0.0.1", 443)),
            ]

    monkeypatch.setattr(asyncio, "get_running_loop", lambda: _Loop())
    with pytest.raises(outbound.OutboundBlocked, match="private_target"):
        await outbound.resolve_public("example.com", 443)


@pytest.mark.asyncio
async def test_bounded_body_rejects_encoded_and_oversized_content():
    encoded = _Resp(headers={"content-encoding": "gzip"}, chunks=[b"abc"])
    with pytest.raises(outbound.OutboundBlocked, match="encoded_body_not_supported"):
        await outbound.bounded_body(encoded)

    too_long = _Resp(headers={"content-length": "2000000"}, chunks=[b"abc"])
    with pytest.raises(outbound.OutboundBlocked, match="body_too_large"):
        await outbound.bounded_body(too_long)

    streamed = _Resp(headers={"content-length": "10"}, chunks=[b"a" * 100_000, b"b" * 1_450_001])
    with pytest.raises(outbound.OutboundBlocked, match="body_too_large"):
        await outbound.bounded_body(streamed)


@pytest.mark.asyncio
async def test_redirect_loop_maxhop_and_deadline(monkeypatch):
    calls: list[dict] = []
    responses = [
        _Resp(status=302, headers={"location": "https://example.com/a", "content-length": "0"}, chunks=[]),
        _Resp(status=302, headers={"location": "https://example.com/b", "content-length": "0"}, chunks=[]),
        _Resp(status=302, headers={"location": "https://example.com/c", "content-length": "0"}, chunks=[]),
        _Resp(status=302, headers={"location": "https://example.com/d", "content-length": "0"}, chunks=[]),
    ]
    monkeypatch.setattr(outbound, "resolve_public", lambda *_: asyncio.sleep(0, result=["93.184.216.34"]))
    monkeypatch.setattr(outbound.httpx, "AsyncClient", lambda **kwargs: _Client(calls, responses, **kwargs))
    with pytest.raises(outbound.OutboundBlocked, match="too_many_redirects"):
        await outbound.public_get("https://example.com/start", max_hops=3)

    async def _slow(*_args, **_kwargs):
        await asyncio.sleep(16)
        return ["93.184.216.34"]

    monkeypatch.setattr(outbound, "resolve_public", _slow)
    with pytest.raises(asyncio.TimeoutError):
        await outbound.public_get("https://example.com/slow")


@pytest.mark.asyncio
async def test_concurrency_permit_released_after_failure(monkeypatch):
    original = outbound._slots
    outbound._slots = asyncio.Semaphore(1)
    calls: list[dict] = []
    monkeypatch.setattr(outbound, "resolve_public", lambda *_: asyncio.sleep(0, result=["93.184.216.34"]))

    # First response fails in bounded_body due to content-encoding.
    responses = [
        _Resp(status=200, headers={"content-encoding": "gzip", "content-length": "3"}, chunks=[b"abc"]),
        _Resp(status=200, headers={"content-length": "2"}),
        _Resp(status=200, headers={"content-length": "2"}, chunks=[b"ok"]),
    ]
    monkeypatch.setattr(
        outbound.httpx,
        "AsyncClient",
        lambda **kwargs: _Client(calls, responses, **kwargs),
    )

    with pytest.raises(outbound.OutboundBlocked, match="encoded_body_not_supported"):
        await outbound.public_get("https://example.com/fail")
    ok = await outbound.public_get("https://example.com/pass")
    assert ok.status_code == 200
    assert ok.content == b"ok"
    outbound._slots = original
