import httpx
import pytest
import respx

from app.providers.base import ProviderUnavailable
from app.providers.google_webrisk import ENDPOINT, GoogleWebRiskProvider


def provider(key="test-key"):
    return GoogleWebRiskProvider(key, 1.0, 3600)


@pytest.mark.anyio
async def test_unconfigured_provider_is_unavailable_not_safe():
    assert not provider(None).is_configured()
    with pytest.raises(ProviderUnavailable):
        await provider(None).lookup("https://example.com/")


@pytest.mark.anyio
async def test_no_match_returns_allow_and_sends_only_sanitized_uri():
    with respx.mock() as router:
        route = router.get(ENDPOINT).mock(return_value=httpx.Response(200, json={}))
        result = await provider().lookup("https://example.com/login")
    assert result.verdict == "allow" and result.providerId == "google-webrisk"
    params = route.calls[0].request.url.params
    assert params["uri"] == "https://example.com/login"
    assert params.get_list("threatTypes") == ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE"]


@pytest.mark.anyio
async def test_match_maps_to_neutral_categories():
    with respx.mock() as router:
        router.get(ENDPOINT).mock(
            return_value=httpx.Response(200, json={"threat": {"threatTypes": ["MALWARE", "SOCIAL_ENGINEERING"], "expireTime": "2030-01-01T00:00:00Z"}})
        )
        result = await provider().lookup("https://bad.example/")
    assert result.verdict == "block" and result.threatCategories == ["malware", "phishing"]
    assert 60 <= result.ttlSeconds <= 3600


@pytest.mark.anyio
@pytest.mark.parametrize("status", [400, 403, 429, 500, 503, 504])
async def test_failures_raise_unavailable(status):
    with respx.mock() as router:
        router.get(ENDPOINT).mock(return_value=httpx.Response(status, json={"error": {"status": "X"}}))
        with pytest.raises(ProviderUnavailable):
            await provider().lookup("https://example.com/")


@pytest.mark.anyio
async def test_timeout_raises_unavailable():
    with respx.mock() as router:
        router.get(ENDPOINT).mock(side_effect=httpx.ConnectTimeout("timeout"))
        with pytest.raises(ProviderUnavailable):
            await provider().lookup("https://example.com/")
