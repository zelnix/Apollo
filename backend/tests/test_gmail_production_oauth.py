from urllib.parse import parse_qs, urlparse
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from core.config import GOOGLE_GMAIL_REDIRECT_URI
from routers.gmail import _valid_app_redirect
from services import gmail


def test_production_callback_and_exact_read_only_authorization_url():
    assert GOOGLE_GMAIL_REDIRECT_URI == "https://threat-patrol-1.emergent.host/api/gmail/oauth/callback"
    query = parse_qs(urlparse(gmail.build_authorization_url("opaque-state")).query)
    assert query["redirect_uri"] == [GOOGLE_GMAIL_REDIRECT_URI]
    assert query["scope"] == [gmail.SCOPE]
    assert query["include_granted_scopes"] == ["false"]
    assert query["access_type"] == ["offline"]


@pytest.mark.parametrize("url, expected", [
    ("apollo://email", True),
    ("https://threat-patrol-1.emergent.host/email", True),
    ("https://attacker.example/steal", False),
    ("https://threat-patrol-1.emergent.host@attacker.example/steal", False),
    ("javascript:alert(1)", False),
])
def test_post_callback_redirect_is_not_an_open_redirect(url, expected):
    assert _valid_app_redirect(url) is expected


@pytest.mark.asyncio
async def test_token_exchange_rejects_any_scope_set_beyond_gmail_readonly(monkeypatch):
    class Response:
        status_code = 200
        @staticmethod
        def json(): return {"access_token": "redacted", "scope": f"{gmail.SCOPE} openid"}
    class Client:
        def __init__(self, **_kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *_args): return None
        async def post(self, *_args, **_kwargs): return Response()
    monkeypatch.setattr(gmail.httpx, "AsyncClient", Client)
    with pytest.raises(HTTPException, match="exact read-only Gmail"):
        await gmail.exchange_code("redacted-code")


def test_oauth_state_is_hashed_and_consumed_atomically():
    source = open("routers/gmail.py", encoding="utf-8").read()
    assert '"state_digest": state_digest' in source
    assert "find_one_and_delete" in source
    assert 'insert_one({"state": state' not in source


@pytest.mark.asyncio
async def test_unreadable_refresh_grant_is_deleted_without_retry_loop(monkeypatch):
    async def connection(_device_id): return {"refresh_token_enc": "not-a-fernet-token"}
    collection = SimpleNamespace(delete_one=AsyncMock())
    monkeypatch.setattr(gmail, "get_connection", connection)
    monkeypatch.setattr(gmail, "db", SimpleNamespace(gmail_connections=collection))
    with pytest.raises(HTTPException, match="reconnect"):
        await gmail._access_token_for("device-a")
    collection.delete_one.assert_awaited_once_with({"device_id": "device-a"})