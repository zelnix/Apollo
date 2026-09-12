# Generic IMAP connection (Gate 1 add-on, Phase 3) -- backend tests.
# Covers: /imap/providers (preset list), /imap/status (unconnected), /imap/connections
# (bad-host validation + unreachable-host graceful error, both must respond <=25s, never 500/hang),
# /imap/scan (no connection -> 404), /imap/connection DELETE (idempotent),
# and a pure unit test of services.imapmail._parse_message() anchor extraction.
# Real IMAP mailbox credentials CANNOT be used here (no test mailbox available) -- error-path only.
import os
import sys
import time
import uuid
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
BASE_URL = (
    os.environ.get("EXPO_BACKEND_URL")
    or os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or "https://threat-patrol-1.preview.emergentagent.com"
).rstrip("/")

# Make services.imapmail importable for the pure unit test.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def device_id():
    return f"TEST_imap_{uuid.uuid4().hex[:12]}"


class TestImapProviders:
    def test_providers_list_shape(self, api):
        r = api.get(f"{BASE_URL}/api/imap/providers", timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        providers = data["providers"]
        labels = {p["label"] for p in providers}
        assert any("Gmail" in l for l in labels)
        assert any("Outlook" in l for l in labels)
        assert any("Yahoo" in l for l in labels)
        assert any("iCloud" in l for l in labels)
        for p in providers:
            assert p["port"] == 993
            assert p["ssl"] is True
            assert isinstance(p["host"], str) and "." in p["host"]


class TestImapStatus:
    def test_status_before_connection(self, api, device_id):
        r = api.get(f"{BASE_URL}/api/imap/status", params={"device_id": device_id}, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["connected"] is False
        assert data["configured"] is True
        assert data["host"] is None
        assert data["username"] is None


class TestImapConnect:
    def test_connect_invalid_host_chars_returns_400_fast(self, api, device_id):
        start = time.time()
        r = api.post(
            f"{BASE_URL}/api/imap/connections",
            json={
                "device_id": device_id,
                "host": "imap.example.com@evil",
                "port": 993,
                "ssl": True,
                "username": "user@example.com",
                "app_password": "somepassword",
            },
            timeout=25,
        )
        elapsed = time.time() - start
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"
        assert elapsed < 25
        assert "invalid" in r.json().get("detail", "").lower()

    def test_connect_unreachable_host_returns_400_gracefully(self, api, device_id):
        start = time.time()
        r = api.post(
            f"{BASE_URL}/api/imap/connections",
            json={
                "device_id": device_id,
                "host": "imap.doesnotexist.invalid",
                "port": 993,
                "ssl": True,
                "username": "user@example.com",
                "app_password": "somepassword",
            },
            timeout=30,
        )
        elapsed = time.time() - start
        assert r.status_code == 400, f"expected 400, got {r.status_code}: {r.text}"
        assert elapsed < 30, f"took too long: {elapsed}s"
        assert len(r.json().get("detail", "")) > 0

    def test_connect_missing_fields_is_422(self, api, device_id):
        r = api.post(
            f"{BASE_URL}/api/imap/connections",
            json={"device_id": device_id, "host": "imap.gmail.com"},
            timeout=15,
        )
        assert r.status_code == 422


class TestImapScan:
    def test_scan_without_connection_returns_404(self, api, device_id):
        r = api.post(f"{BASE_URL}/api/imap/scan", json={"device_id": device_id}, timeout=20)
        assert r.status_code == 404, f"expected 404, got {r.status_code}: {r.text}"
        assert "no imap inbox is connected" in r.json().get("detail", "").lower()


class TestImapDisconnect:
    def test_disconnect_with_no_existing_connection_succeeds(self, api, device_id):
        r = api.delete(f"{BASE_URL}/api/imap/connection", params={"device_id": device_id}, timeout=15)
        assert r.status_code == 204, f"expected 204, got {r.status_code}: {r.text}"
        assert r.content in (b"", None)

    def test_status_still_disconnected_after_delete(self, api, device_id):
        r = api.get(f"{BASE_URL}/api/imap/status", params={"device_id": device_id}, timeout=15)
        assert r.status_code == 200
        assert r.json()["connected"] is False


class TestParseMessageUnit:
    """Pure unit test of services.imapmail._parse_message() -- no network/IMAP involved."""

    def test_parse_message_extracts_anchor_mismatch_and_headers(self):
        from services.imapmail import _parse_message

        raw = (
            b"From: PayPal Security <security@evil-domain.ru>\r\n"
            b"Subject: Your account needs verification\r\n"
            b"Date: Mon, 05 Jan 2026 10:00:00 +0000\r\n"
            b"Content-Type: text/html; charset=utf-8\r\n"
            b"\r\n"
            b"<html><body><p>Please confirm your details at "
            b"<a href='https://evil-domain.ru/x'>paypal.com</a></p></body></html>\r\n"
        )
        parsed = _parse_message(raw)
        assert parsed["subject"] == "Your account needs verification"
        assert "evil-domain.ru" in parsed["from"]
        assert "2026" in parsed["date"]
        assert "confirm your details" in parsed["body"]
        assert len(parsed["links"]) == 1
        link = parsed["links"][0]
        assert link["text"] == "paypal.com"
        assert link["href"] == "https://evil-domain.ru/x"
