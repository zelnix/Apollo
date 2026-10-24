"""Admin portal: every page shows this server's AI mode — Live AI or Simulated — read from the provider gateway."""
from routers import admin_portal
from services.higgins import provider

ADMIN = {"email": "owner@example.com", "name": "Owner"}


def _page() -> str:
    return admin_portal._shell("Dashboard", "/api/admin/portal", "<h2>Body</h2>", admin=ADMIN)


def test_the_preview_server_shows_simulated(monkeypatch):
    monkeypatch.setattr(provider, "_preview_generate", lambda *a, **k: None)
    page = _page()
    assert 'id="ai-mode-badge" data-mode="preview"' in page
    assert ">Simulated</span>" in page and "no Gemini calls are made" in page
    assert page.index('id="ai-mode-badge"') < page.index("<h2>Body</h2>"), "the badge leads the page"


def test_a_live_server_with_a_key_shows_live_ai(monkeypatch):
    monkeypatch.setattr(provider, "_preview_generate", None)
    monkeypatch.setattr(provider, "GEMINI_API_KEY", "set")
    page = _page()
    assert 'data-mode="live"' in page and ">Live AI</span>" in page
    assert "goes to Gemini and is billed" in page


def test_a_live_server_without_a_key_says_ai_will_fail(monkeypatch):
    monkeypatch.setattr(provider, "_preview_generate", None)
    monkeypatch.setattr(provider, "GEMINI_API_KEY", "")
    page = _page()
    assert "Live AI — no key" in page and "AI requests fail" in page


def test_the_signed_out_page_shows_no_badge(monkeypatch):
    monkeypatch.setattr(provider, "_preview_generate", None)
    assert "ai-mode-badge" not in admin_portal._shell("Sign in", "", "<p>Sign in</p>", admin=None, show_nav=False)
