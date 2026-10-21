"""The payload Apollo actually hands to the managed push relay.

The relay types `subtext`, `action_url` and `sound` as strings, and a provider that receives null in a
string field rejects the whole request (HTTP 400) — the fault that silently killed every weekly family
alert while Apollo sent `subtitle: null`. A sender without a subtext must omit the field entirely.
"""
from __future__ import annotations

from routers.push import APOLLO_ALERTS_CHANNEL, PUSH_FAMILY, PUSH_GROWL, PUSH_THREAT, _relay_data


def test_subtext_omitted_when_absent():
    data = _relay_data({"title": "Weekly summary", "message": "body", "action_url": "/family", **PUSH_FAMILY})
    assert "subtext" not in data
    assert data["channel_id"] == "family"
    assert data["sound"] == "apollo_chime.wav"
    assert data["action_url"] == "/family"


def test_subtext_kept_when_present():
    data = _relay_data({"title": "Apollo is barking", "message": "body", "subtext": "Higgins: open the case.", **PUSH_THREAT})
    assert data["subtext"] == "Higgins: open the case."
    assert data["channel_id"] == APOLLO_ALERTS_CHANNEL
    assert data["sound"] == "apollo_bark.wav"


def test_blank_subtext_is_not_sent_as_an_empty_string():
    data = _relay_data({"title": "t", "message": "b", "subtext": "   ", **PUSH_GROWL})
    assert "subtext" not in data
    assert "sound" not in data  # growling is silent


def test_no_null_fields_in_any_shape():
    for payload in (
        {"title": "t", "message": "b", **PUSH_THREAT},
        {"title": "t", "message": "b", **PUSH_FAMILY},
        {"title": "t", "message": "b", "subtext": "s", "action_url": "/patrol/1", **PUSH_GROWL},
    ):
        data = _relay_data(payload)
        nulls = [k for k, v in data.items() if v is None]
        assert not nulls, f"a null in a string field makes the provider reject the request: {nulls}"


def test_alert_key_rides_in_the_deep_link():
    data = _relay_data({"title": "t", "message": "b", "action_url": "/patrol/evt-1", **PUSH_THREAT}, "owner-evt-1")
    assert data["action_url"] == "/patrol/evt-1?a=owner-evt-1"
    withq = _relay_data({"title": "t", "message": "b", "action_url": "/family?tab=alerts", **PUSH_FAMILY}, "weekly-1")
    assert withq["action_url"] == "/family?tab=alerts&a=weekly-1"


def test_no_deep_link_means_no_alert_key_field():
    data = _relay_data({"title": "t", "message": "b", **PUSH_GROWL}, "owner-evt-2")
    assert "action_url" not in data


def test_title_and_message_always_present():
    data = _relay_data({"title": "Apollo is biting", "message": "Blocked a known scam site.", **PUSH_THREAT})
    assert data["title"] and data["message"]
