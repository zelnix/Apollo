import json
import logging

import httpx
import pytest
import respx

from app.core.logging import REDACTED, RawUrlRedactionFilter
from app.domain.validation.normalization import canonicalize_host, sanitize_url
from app.providers.google_webrisk import ENDPOINT
from tests.conftest import VECTORS


def test_host_vectors_parity():
    vectors = json.loads((VECTORS / "normalization" / "host_vectors.json").read_text())["vectors"]
    for v in vectors:
        assert canonicalize_host(v["input"]) == v["expected"], v


def test_url_vectors_parity():
    vectors = json.loads((VECTORS / "normalization" / "url_vectors.json").read_text())["vectors"]
    for v in vectors:
        result = sanitize_url(v["input"])
        assert (result is not None) == v["analyzable"], v
        assert (result.sanitized_url if result else None) == v["sanitizedUrl"], v
        assert (result.host if result else None) == v["host"], v


def test_sanitized_url_strips_secrets_but_original_remains_analyzable():
    result = sanitize_url("https://user:pw@example.com/login?token=SECRET#frag")
    assert result.sanitized_url == "https://example.com/login"
    assert result.original_had_query and result.original_had_fragment and result.original_had_userinfo
    assert "SECRET" not in result.sanitized_url and "user" not in result.sanitized_url


def test_log_filter_redacts_urls():
    record = logging.LogRecord("guarddog.x", logging.INFO, "", 0, "lookup for https://example.com/login?token=SECRET failed", (), None)
    assert RawUrlRedactionFilter().filter(record)
    assert "SECRET" not in record.getMessage() and REDACTED in record.getMessage()
    record = logging.LogRecord("guarddog.x", logging.INFO, "", 0, "url=%s", ("http://a.example/?t=1",), None)
    RawUrlRedactionFilter().filter(record)
    assert record.getMessage() == f"url={REDACTED}"


@pytest.mark.anyio
async def test_lookup_endpoint_local_rule_first_then_sanitized_cloud_only_when_unresolved(client, caplog):
    caplog.set_level(logging.INFO)
    # 1) local signed rule resolves the controlled host: no provider call, verdict block
    with respx.mock(assert_all_called=False) as router:
        route = router.get(ENDPOINT).mock(return_value=httpx.Response(200, json={}))
        r = await client.post("/api/intelligence/lookup", json={"url": "https://M1-Block-Test.GuardDog.Example./x?secret=1"})
        assert r.status_code == 200
        assert r.json()["verdict"] == "block" and r.json()["source"] == "local-signed-rules"
        assert r.json()["sanitizedUrl"] == "https://m1-block-test.guarddog.example/x"
        assert not route.called
    # 2) unresolved host, provider unconfigured -> unknown + degraded (fail open, never 'block')
    r = await client.post("/api/intelligence/lookup", json={"url": "https://unknown.example/p?token=SECRET"})
    assert r.json()["verdict"] == "unknown" and r.json()["degraded"] is True and r.json()["source"] == "none"
    # 3) raw URL/secret never reaches logs
    assert "SECRET" not in caplog.text and "unknown.example" not in caplog.text
    # 4) invalid URL rejected
    assert (await client.post("/api/intelligence/lookup", json={"url": "javascript:alert(1)"})).status_code == 422


@pytest.mark.anyio
async def test_lookup_uses_cloud_then_cache_when_provider_configured(client):
    client.app.state.provider._api_key = "test-key"
    with respx.mock() as router:
        route = router.get(ENDPOINT).mock(
            return_value=httpx.Response(200, json={"threat": {"threatTypes": ["MALWARE"], "expireTime": "2030-01-01T00:00:00Z"}})
        )
        r1 = await client.post("/api/intelligence/lookup", json={"url": "https://bad.example/a?tok=1#f"})
        r2 = await client.post("/api/intelligence/lookup", json={"url": "https://bad.example/a?tok=2"})
    assert r1.json()["source"] == "cloud-provider" and r1.json()["verdict"] == "block"
    assert r2.json()["source"] == "provider-cache" and r2.json()["verdict"] == "block"
    assert route.call_count == 1
    assert route.calls[0].request.url.params["uri"] == "https://bad.example/a"


@pytest.mark.anyio
async def test_provider_outage_yields_unavailable_degraded(client):
    client.app.state.provider._api_key = "test-key"
    with respx.mock() as router:
        router.get(ENDPOINT).mock(return_value=httpx.Response(503))
        r = await client.post("/api/intelligence/lookup", json={"url": "https://down.example/"})
    assert r.json()["verdict"] == "unavailable" and r.json()["degraded"] is True
