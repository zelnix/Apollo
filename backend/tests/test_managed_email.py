from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from services import email


class FakeResponse:
    status_code = 202

    @staticmethod
    def json():
        return {"id": "email-test-reference"}


class FakeClient:
    last_call = None

    def __init__(self, **_kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    async def post(self, url, **kwargs):
        FakeClient.last_call = (url, kwargs)
        return FakeResponse()


@pytest.mark.asyncio
async def test_managed_email_uses_brand_and_server_key(monkeypatch):
    receipts = SimpleNamespace(find_one=AsyncMock(return_value=None), update_one=AsyncMock())
    monkeypatch.setattr(email, "db", SimpleNamespace(delivery_receipts=receipts))
    monkeypatch.setattr(email.httpx, "AsyncClient", FakeClient)
    provider_id = await email.send_email(
        to="delivered@resend.dev", subject="Higgins Apollo family invitation",
        html=email._wrap('<p>A family member invited you.</p><p><a href="https://apollo.example/family">Review in Higgins Apollo</a></p>'),
        event_id="test-managed-email",
    )
    assert provider_id == "email-test-reference"
    url, call = FakeClient.last_call
    assert url == "https://integrations.emergentagent.com/api/v1/email/send"
    assert call["headers"]["X-Email-Key"] == email.EMAIL_KEY
    assert call["json"]["from_name"] == "Higgins Apollo"
    assert "contact_email" not in call["json"]
    assert "from" not in call["json"]
    assert receipts.update_one.await_count == 3


@pytest.mark.parametrize("html", [
    '<form><input name="password"></form>',
    '<a href="http://example.com">Open</a>',
    '<a href="https://bit.ly/example">Open</a>',
    '<a href="https://apollo.example">paypal.com</a>',
])
def test_email_gate_rejects_unsafe_content(html):
    with pytest.raises(ValueError):
        email._assert_safe_email("Family invitation", html)


def test_email_configuration_uses_no_resend_secret():
    source = open("services/email.py", encoding="utf-8").read()
    assert "RESEND_API_KEY" not in source
    assert "RESEND_FROM_EMAIL" not in source
    assert email.email_configured()