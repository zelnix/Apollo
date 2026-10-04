"""Batch 3 focused tests:
1. get_attachment_ids finds all nested attachment IDs in a multipart Gmail payload.
2. _scan_attachments_vt fetches with format=full and passes each nested attachment ID
   through download_attachment → compute_sha256 → lookup_hash.
"""
import pytest
from unittest.mock import AsyncMock, patch, MagicMock, call

# ---------------------------------------------------------------------------
# Shared fixture: deeply nested Gmail payload
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


# ---------------------------------------------------------------------------
# 1. get_attachment_ids traverses nested multipart parts
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# 2. _scan_attachments_vt uses format=full and calls download → hash → lookup
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_scan_attachments_vt_format_full_and_pipeline():
    """_scan_attachments_vt must:
    a) Fetch the message with format=full (not metadata).
    b) Call download_attachment once per nested attachment ID.
    c) Call compute_sha256 on the downloaded bytes.
    d) Call lookup_hash with the resulting hash and correct filename.
    """
    from services.mailbox_monitor import _scan_attachments_vt
    from services.virustotal import ScanResult

    # --- Arrange ---

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

    # Fake bytes returned by download_attachment for each attachment
    pdf_bytes = b"%PDF-1.4 fake content"
    png_bytes = b"\x89PNG fake content"

    async def mock_download(device_id, message_id, attachment_id):
        if attachment_id == "ANGjdJ_NESTED_ATT_ID_001":
            return pdf_bytes
        elif attachment_id == "ANGjdJ_NESTED_ATT_ID_002":
            return png_bytes
        return None

    # Deterministic hashes for the fake bytes
    pdf_hash = "sha256_hash_of_pdf"
    png_hash = "sha256_hash_of_png"

    def mock_compute_sha256(data):
        if data == pdf_bytes:
            return pdf_hash
        elif data == png_bytes:
            return png_hash
        return "unknown_hash"

    mock_lookup = AsyncMock(return_value=ScanResult(
        filename="", sha256="", status="clean", detection_count=0, total_engines=70,
        detail="No malware detected."
    ))

    # --- Act ---

    with patch("services.virustotal.VT_API_KEY", "fake_vt_key_for_test"), \
         patch("httpx.AsyncClient", return_value=mock_http), \
         patch("services.gmail._access_token_for", new_callable=AsyncMock, return_value="fake_token"), \
         patch("services.gmail.download_attachment", side_effect=mock_download) as dl_mock, \
         patch("services.virustotal.compute_sha256", side_effect=mock_compute_sha256) as sha_mock, \
         patch("services.virustotal.lookup_hash", mock_lookup) as lh_mock:
        result = await _scan_attachments_vt(
            "device_123",
            {"id": "msg_abc", "attachment_names": ["invoice.pdf", "logo.png"]},
            "gmail",
        )

    # --- Assert ---

    # (a) format=full
    assert captured_params.get("format") == "full", \
        f"Expected format=full, got format={captured_params.get('format')}"
    assert "metadataHeaders" not in captured_params, \
        "metadataHeaders should not be present — it was a metadata-format artifact"

    # (b) download_attachment called once per nested attachment ID
    assert dl_mock.call_count == 2, f"Expected 2 download_attachment calls, got {dl_mock.call_count}"
    dl_mock.assert_any_call("device_123", "msg_abc", "ANGjdJ_NESTED_ATT_ID_001")
    dl_mock.assert_any_call("device_123", "msg_abc", "ANGjdJ_NESTED_ATT_ID_002")

    # (c) compute_sha256 called on the downloaded bytes
    assert sha_mock.call_count == 2, f"Expected 2 compute_sha256 calls, got {sha_mock.call_count}"
    sha_mock.assert_any_call(pdf_bytes)
    sha_mock.assert_any_call(png_bytes)

    # (d) lookup_hash called with correct hashes and filenames
    assert lh_mock.call_count == 2, f"Expected 2 lookup_hash calls, got {lh_mock.call_count}"
    lh_mock.assert_any_call(pdf_hash, "invoice.pdf")
    lh_mock.assert_any_call(png_hash, "logo.png")
