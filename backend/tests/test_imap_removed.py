"""Apollo never accepts or stores mailbox usernames or passwords."""
from pathlib import Path

import requests

from conftest import BASE_URL


def test_legacy_imap_routes_are_removed():
    device_id = "legacy-imap-removed"
    for method, path, payload in (
        ("get", f"/api/imap/status?device_id={device_id}", None),
        ("post", "/api/imap/connections", {"device_id": device_id, "host": "imap.example.com", "port": 993,
            "ssl": True, "username": "person@example.com", "app_password": "must-not-be-accepted"}),
        ("post", "/api/imap/scan", {"device_id": device_id}),
    ):
        response = getattr(requests, method)(f"{BASE_URL}{path}", json=payload, timeout=30) if payload is not None else getattr(requests, method)(f"{BASE_URL}{path}", timeout=30)
        assert response.status_code == 404, response.text


def test_frontend_has_no_mailbox_username_or_password_collection():
    root = Path(__file__).resolve().parents[2]
    email_screen = (root / "frontend" / "app" / "email.tsx").read_text()
    privacy = (root / "frontend" / "src" / "domain" / "privacy.ts").read_text()
    assert "email-imap-username" not in email_screen
    assert "email-imap-password" not in email_screen
    assert "app_password" not in privacy
    assert "imap_connect" not in privacy