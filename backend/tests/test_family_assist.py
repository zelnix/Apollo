from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from core.db import now_utc
from services.family_assist.config import UNAVAILABLE_COPY, capability_record, load_config
from services.family_assist import relay_credentials
from services.family_assist.signaling import validate_message
from services.family_assist.sessions import signaling_transition


CONFIG_KEYS = (
    "FAMILY_ASSIST_ENABLED", "FAMILY_ASSIST_TURN_PROVIDER", "CLOUDFLARE_TURN_KEY_ID", "CLOUDFLARE_TURN_API_TOKEN",
    "FAMILY_ASSIST_TURN_URLS", "FAMILY_ASSIST_TURN_REALM", "FAMILY_ASSIST_TURN_SHARED_SECRET",
)


def test_missing_cloudflare_token_fails_closed(monkeypatch):
    for key in CONFIG_KEYS:
        monkeypatch.delenv(key, raising=False)
    assert capability_record() == {"enabled": False, "protocolVersion": 1, "unavailableReason": "configuration_missing", "detail": UNAVAILABLE_COPY,
        "supportedScopes": [], "microphone": "not_supported", "systemAudio": "not_supported", "remoteControl": "not_supported", "recording": "not_supported"}


def test_generic_coturn_values_never_enable_cloudflare_mode(monkeypatch):
    monkeypatch.setenv("FAMILY_ASSIST_ENABLED", "true")
    monkeypatch.setenv("FAMILY_ASSIST_TURN_PROVIDER", "cloudflare")
    monkeypatch.setenv("CLOUDFLARE_TURN_KEY_ID", "a" * 32)
    monkeypatch.delenv("CLOUDFLARE_TURN_API_TOKEN", raising=False)
    monkeypatch.setenv("FAMILY_ASSIST_TURN_URLS", "turn:example.test")
    monkeypatch.setenv("FAMILY_ASSIST_TURN_REALM", "example.test")
    monkeypatch.setenv("FAMILY_ASSIST_TURN_SHARED_SECRET", "x" * 64)
    assert load_config().available is False


@pytest.fixture
def cloudflare_config(monkeypatch):
    monkeypatch.setenv("FAMILY_ASSIST_ENABLED", "true")
    monkeypatch.setenv("FAMILY_ASSIST_TURN_PROVIDER", "cloudflare")
    monkeypatch.setenv("CLOUDFLARE_TURN_KEY_ID", "a" * 32)
    monkeypatch.setenv("CLOUDFLARE_TURN_API_TOKEN", "test-only-cloudflare-token-not-a-real-secret")


def test_valid_cloudflare_fixture_enables_only_view_only_feature(cloudflare_config):
    record = capability_record()
    assert record["enabled"] is True
    assert record["microphone"] == record["remoteControl"] == record["recording"] == "not_supported"
    assert "token" not in str(record).lower()
    assert "aaaaaaaa" not in str(record)


VALID_PROVIDER_RESPONSE = {"iceServers": [
    {"urls": ["stun:stun.cloudflare.com:3478"]},
    {"urls": ["turn:turn.cloudflare.com:3478?transport=udp", "turns:turn.cloudflare.com:5349?transport=tcp"],
     "username": "temporary-user", "credential": "temporary-credential"},
]}


@pytest.mark.parametrize("payload", [
    {},
    {"iceServers": [{"urls": ["turn:attacker.example:3478"], "username": "u", "credential": "p"}]},
    {"iceServers": [{"urls": ["turn:turn.cloudflare.com:53"], "username": "u", "credential": "p"}]},
    {"iceServers": [{"urls": ["turn:turn.cloudflare.com:3478"], "username": "u", "credential": "p", "secret": "x"}]},
    {"iceServers": [{"urls": ["stun:stun.cloudflare.com:3478"], "username": "not-allowed"}]},
])
def test_provider_response_is_strictly_whitelisted(payload):
    with pytest.raises(relay_credentials.RelayCredentialError):
        relay_credentials.validate_cloudflare_ice_servers(payload)


@pytest.mark.asyncio
async def test_cloudflare_request_uses_server_token_and_returns_only_temporary_servers(cloudflare_config, monkeypatch):
    class Response:
        status_code = 201
        headers = {}
        @staticmethod
        def json(): return VALID_PROVIDER_RESPONSE
    class Client:
        call = None
        def __init__(self, **_kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *_args): return None
        async def post(self, url, **kwargs): Client.call = (url, kwargs); return Response()
    monkeypatch.setattr(relay_credentials.httpx, "AsyncClient", Client)
    result = await relay_credentials.fetch_cloudflare_ice_servers(load_config(), 3600)
    url, call = Client.call
    assert url.endswith(f"/{load_config().cloudflare_turn_key_id}/credentials/generate-ice-servers")
    assert call["json"] == {"ttl": 3600}
    assert call["headers"]["Authorization"].startswith("Bearer test-only-")
    assert result == VALID_PROVIDER_RESPONSE["iceServers"]
    assert "Authorization" not in str(result)


@pytest.mark.asyncio
async def test_issued_credentials_are_one_hour_session_bound_metadata_only(cloudflare_config, monkeypatch):
    monkeypatch.setattr(relay_credentials, "fetch_cloudflare_ice_servers", AsyncMock(return_value=VALID_PROVIDER_RESPONSE["iceServers"]))
    collection = SimpleNamespace(insert_one=AsyncMock())
    monkeypatch.setattr(relay_credentials, "db", SimpleNamespace(family_assist_turn_issuances=collection))
    session = {"session_id": "session-a", "generation": "generation-a", "invitation_expires_at": now_utc() + timedelta(hours=2), "hard_expires_at": now_utc() + timedelta(hours=2)}
    issued = await relay_credentials.issue_relay_credentials(session, "device-a", "sharer")
    assert issued["provider"] == "cloudflare" and issued["ttl"] == 3600
    assert issued["iceServers"] == VALID_PROVIDER_RESPONSE["iceServers"]
    assert "key" not in str(issued).lower() and "api_token" not in str(issued).lower()
    stored = collection.insert_one.await_args.args[0]
    assert stored["session_id"] == "session-a" and stored["device_id"] == "device-a" and stored["role"] == "sharer"
    assert "username_digest" in stored and "credential" not in stored and "iceServers" not in stored


def test_signaling_schema_is_closed_monotonic_and_allows_bounded_relay_refresh():
    valid = '{"type":"offer","sequence":1,"generation":"g","sdp":"v=0"}'
    body, count = validate_message(valid, "sharer", "g", 0, 0)
    assert body["type"] == "offer" and count == 0
    refresh, _ = validate_message('{"type":"relay_refresh","sequence":2,"generation":"g"}', "sharer", "g", 1, 0)
    assert refresh["type"] == "relay_refresh"
    for invalid in [
        '{"type":"offer","sequence":1,"generation":"old","sdp":"v=0"}',
        '{"type":"offer","sequence":1,"generation":"g","sdp":"v=0","extra":"no"}',
        '{"type":"answer","sequence":1,"generation":"g","sdp":"v=0"}',
        '{"type":"relay_refresh","sequence":2,"generation":"g","credential":"no"}',
    ]:
        with pytest.raises(ValueError): validate_message(invalid, "sharer", "g", 0, 0)


def test_no_provider_secret_or_key_id_reaches_frontend_source():
    import pathlib
    source = "\n".join(path.read_text(errors="ignore") for path in pathlib.Path("../frontend").rglob("*") if path.is_file() and "node_modules" not in path.parts and path.suffix in {".ts", ".tsx", ".js", ".json", ".kt", ".swift"})
    assert "CLOUDFLARE_TURN_API_TOKEN" not in source
    assert load_config().cloudflare_turn_key_id not in source
    assert "FAMILY_ASSIST_TURN_SHARED_SECRET" not in source


def test_no_media_or_turn_secret_fields_in_durable_session_source():
    source = open("services/family_assist/sessions.py", encoding="utf-8").read()
    for forbidden in ("recording_url", "frame_data", "audio_data", "turn_secret", "FAMILY_ASSIST_TURN_SHARED_SECRET", "CLOUDFLARE_TURN_API_TOKEN"):
        assert forbidden not in source


def test_native_signaling_pause_resume_stop_failure_and_helper_leave_are_state_fenced():
    assert signaling_transition("active", "sharer", {"type": "pause_state", "paused": True}) == ("paused", None)
    assert signaling_transition("paused", "sharer", {"type": "pause_state", "paused": False}) == ("active", None)
    assert signaling_transition("active", "sharer", {"type": "terminate", "reason": "owner_stopped"}) == ("ended", "owner_stopped")
    assert signaling_transition("connecting", "sharer", {"type": "terminate", "reason": "transport_failed"}) == ("ended", "transport_failed")
    assert signaling_transition("active", "helper", {"type": "terminate", "reason": "helper_left"}) == ("ended", "helper_left")
    with pytest.raises(HTTPException): signaling_transition("connecting", "sharer", {"type": "pause_state", "paused": True})
    with pytest.raises(HTTPException): signaling_transition("active", "helper", {"type": "pause_state", "paused": True})