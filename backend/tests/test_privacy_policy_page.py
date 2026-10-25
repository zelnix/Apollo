"""The public privacy policy web page: reachable without a device credential, and worded for every platform."""
import re

from fastapi import FastAPI
from fastapi.testclient import TestClient

from routers import legal


def _page() -> str:
    app = FastAPI()
    app.include_router(legal.router, prefix="/api")
    res = TestClient(app).get("/api/privacy-policy")
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/html")
    return res.text


def test_privacy_policy_is_public_html():
    html = _page()
    assert "<title>ApolloSG Privacy Policy</title>" in html
    assert "support@harmonywellnessgroup.com.au" in html


def test_server_mounts_it_without_the_device_gate():
    from server import app
    route = next(r for r in app.routes if getattr(r, "path", "") == "/api/privacy-policy")
    assert not getattr(route, "dependencies", [])


def test_privacy_policy_explains_ai_tools_without_naming_them():
    text = re.sub(r"<[^>]+>", " ", _page())
    assert "Use of AI tools" in text
    assert "your personal information is removed before anything is sent" in text
    for name in ("Gemini", "Google AI", "Android"):
        assert name not in text, name
