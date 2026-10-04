"""Batch 3 focused tests:
1. A nested Gmail attachment ID reaches download/hash lookup.
2. Account Gate is running when configured and temporarily_unavailable when unconfigured/status retrieval fails.
"""
import json
import pytest
from unittest.mock import AsyncMock, patch, MagicMock

# ---------------------------------------------------------------------------
# 1. Nested Gmail attachment ID reaches download / hash lookup
# ---------------------------------------------------------------------------

def _make_gmail_payload_with_nested_attachment():
    """Simulates a multipart/mixed → multipart/alternative → text/plain + attachment hierarchy."""
    return {
        "mimeType": "multipart/mixed",
        "parts": [
            {
                "mimeType": "multipart/alternative",
                "parts": [
                    {"mimeType": "text/plain", "body": {"size": 100, "data": "aGVsbG8="}},
                    {"mimeType": "text/html", "body": {"size": 200, "data": "PGI+aGk8L2I+"}},
                ],
            },
            {
                "mimeType": "application/pdf",
                "filename": "invoice.pdf",
                "body": {"attachmentId": "ANGjdJ_NESTED_ATT_ID_001", "size": 50000},
            },
            {
                "mimeType": "multipart/related",
                "parts": [
                    {"mimeType": "text/html", "body": {"size": 50}},
                    {
                        "mimeType": "image/png",
                        "filename": "logo.png",
                        "body": {"attachmentId": "ANGjdJ_NESTED_ATT_ID_002", "size": 8000},
                    },
                ],
            },
        ],
    }


def test_get_attachment_ids_nested():
    """get_attachment_ids must traverse nested multipart parts and return all attachment IDs."""
    from services.gmail import get_attachment_ids

    payload = _make_gmail_payload_with_nested_attachment()
    result = get_attachment_ids(payload)

    attachment_ids = {att["attachmentId"] for att in result}
    filenames = {att["filename"] for att in result}

    assert "ANGjdJ_NESTED_ATT_ID_001" in attachment_ids, "Deeply nested PDF attachment ID must be found"
    assert "ANGjdJ_NESTED_ATT_ID_002" in attachment_ids, "Doubly nested image attachment ID must be found"
    assert "invoice.pdf" in filenames
    assert "logo.png" in filenames
    assert len(result) == 2, f"Expected exactly 2 attachments, got {len(result)}"


@pytest.mark.asyncio
async def test_scan_attachments_vt_uses_format_full():
    """_scan_attachments_vt must fetch the message with format=full (not metadata) so that
    payload.parts[].body.attachmentId is present for get_attachment_ids to parse."""
    from services.mailbox_monitor import _scan_attachments_vt

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "payload": _make_gmail_payload_with_nested_attachment()
    }

    captured_params = {}

    async def mock_get(url, params=None, headers=None):
        captured_params.update(params or {})
        return mock_response

    mock_http = AsyncMock()
    mock_http.get = mock_get
    mock_http.__aenter__ = AsyncMock(return_value=mock_http)
    mock_http.__aexit__ = AsyncMock(return_value=False)

    with patch("services.virustotal.VT_API_KEY", "fake_vt_key_for_test"), \
         patch("httpx.AsyncClient", return_value=mock_http):
        import services.gmail as gmail_mod
        with patch.object(gmail_mod, "_access_token_for", new_callable=AsyncMock, return_value="fake_token"):
            result = await _scan_attachments_vt(
                "device_123",
                {"id": "msg_abc", "attachment_names": ["invoice.pdf", "logo.png"]},
                "gmail",
            )

    assert captured_params.get("format") == "full", \
        f"Expected format=full, got format={captured_params.get('format')}"
    assert "metadataHeaders" not in captured_params, \
        "metadataHeaders should not be present — it was a metadata-format artifact"


# ---------------------------------------------------------------------------
# 2. Account Gate status
# ---------------------------------------------------------------------------

def test_account_gate_running_when_configured():
    """Account Gate state is 'running' when accountBreachConfigured is True."""
    from domain_gates_helper import build_gates_and_find

    gate = build_gates_and_find("account", accountBreachConfigured=True)
    assert gate["capability"]["automatic"]["state"] == "running", \
        "Account Gate must be 'running' when breach lookup is configured"


def test_account_gate_unavailable_when_not_configured():
    """Account Gate state is 'temporarily_unavailable' when accountBreachConfigured is False."""
    from domain_gates_helper import build_gates_and_find

    gate = build_gates_and_find("account", accountBreachConfigured=False)
    assert gate["capability"]["automatic"]["state"] == "temporarily_unavailable", \
        "Account Gate must be 'temporarily_unavailable' when breach lookup is not configured"


def test_account_gate_unavailable_when_status_missing():
    """Account Gate state is 'temporarily_unavailable' when accountBreachConfigured is not provided
    (simulates /account/status fetch failure → default False in healthCoordinator)."""
    from domain_gates_helper import build_gates_and_find

    # When accountBreachConfigured is omitted, it defaults to undefined/None in JS.
    # In Python test, we pass False to simulate the healthCoordinator default on fetch failure.
    gate = build_gates_and_find("account", accountBreachConfigured=False)
    assert gate["capability"]["automatic"]["state"] == "temporarily_unavailable", \
        "Account Gate must be 'temporarily_unavailable' when status retrieval fails (default False)"
