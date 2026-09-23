import base64
import hashlib
import hmac
from datetime import timedelta

import pytest

from core.db import now_utc
from services.family_assist.config import UNAVAILABLE_COPY, capability_record, load_config
from services.family_assist.relay_credentials import issue_relay_credentials
from services.family_assist.signaling import validate_message


def test_missing_turn_configuration_fails_closed(monkeypatch):
    for key in ("FAMILY_ASSIST_ENABLED", "FAMILY_ASSIST_TURN_URLS", "FAMILY_ASSIST_TURN_REALM", "FAMILY_ASSIST_TURN_SHARED_SECRET"):
        monkeypatch.delenv(key, raising=False)
    assert capability_record() == {"enabled": False, "protocolVersion": 1, "unavailableReason": "configuration_missing", "detail": UNAVAILABLE_COPY,
        "supportedScopes": [], "microphone": "not_supported", "systemAudio": "not_supported", "remoteControl": "not_supported", "recording": "not_supported"}


@pytest.fixture
def turn_config(monkeypatch):
    monkeypatch.setenv("FAMILY_ASSIST_ENABLED", "true")
    monkeypatch.setenv("FAMILY_ASSIST_TURN_URLS", "turn:turn.example.test:3478?transport=udp,turns:turn.example.test:5349?transport=tcp")
    monkeypatch.setenv("FAMILY_ASSIST_TURN_REALM", "turn.example.test")
    monkeypatch.setenv("FAMILY_ASSIST_TURN_SHARED_SECRET", "test-only-secret-that-is-longer-than-thirty-two-bytes")


def test_valid_turn_fixture_enables_only_view_only_feature(turn_config):
    record = capability_record()
    assert record["enabled"] is True
    assert record["microphone"] == record["remoteControl"] == record["recording"] == "not_supported"
    assert "secret" not in str(record).lower()


@pytest.mark.parametrize("urls", ["turn:turn.example.test:3478?transport=udp", "turns:turn.example.test:5349?transport=tcp", "https://turn.example.test", "turn:user:pass@turn.example.test"])
def test_invalid_or_incomplete_turn_routes_fail_closed(monkeypatch, urls):
    monkeypatch.setenv("FAMILY_ASSIST_ENABLED", "true"); monkeypatch.setenv("FAMILY_ASSIST_TURN_URLS", urls)
    monkeypatch.setenv("FAMILY_ASSIST_TURN_REALM", "turn.example.test"); monkeypatch.setenv("FAMILY_ASSIST_TURN_SHARED_SECRET", "x" * 40)
    assert load_config().available is False


def test_short_lived_turn_credentials_are_session_and_device_bound(turn_config):
    session = {"session_id": "session-a", "generation": "generation-a", "invitation_expires_at": now_utc() + timedelta(minutes=20), "hard_expires_at": now_utc() + timedelta(minutes=20)}
    issued = issue_relay_credentials(session, "device-a", "sharer")
    assert 30 <= issued["ttl"] <= 600
    expected = base64.b64encode(hmac.new(load_config().turn_secret.encode(), issued["username"].encode(), hashlib.sha1).digest()).decode()
    assert hmac.compare_digest(expected, issued["credential"])
    other = issue_relay_credentials(session, "device-b", "helper")
    assert issued["username"] != other["username"]


def test_signaling_schema_is_closed_and_monotonic():
    valid = '{"type":"offer","sequence":1,"generation":"g","sdp":"v=0"}'
    body, count = validate_message(valid, "sharer", "g", 0, 0)
    assert body["type"] == "offer" and count == 0
    for invalid in [
        '{"type":"offer","sequence":1,"generation":"old","sdp":"v=0"}',
        '{"type":"offer","sequence":1,"generation":"g","sdp":"v=0","extra":"no"}',
        '{"type":"answer","sequence":1,"generation":"g","sdp":"v=0"}',
    ]:
        with pytest.raises(ValueError): validate_message(invalid, "sharer", "g", 0, 0)


def test_no_media_or_turn_secret_fields_in_durable_session_source():
    source = open("services/family_assist/sessions.py", encoding="utf-8").read()
    for forbidden in ("recording_url", "frame_data", "audio_data", "turn_secret", "FAMILY_ASSIST_TURN_SHARED_SECRET"):
        assert forbidden not in source