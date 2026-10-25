"""The Play Console guide in the admin portal: its own page (collapsible, word for word) and a PDF with the banner."""
import os
import uuid
from datetime import timedelta

import httpx
import pytest
from pymongo import MongoClient

from core.db import now_utc
from routers.admin_portal import PLAY_CONSOLE_GUIDE

BASE = os.environ.get("APOLLO_API", "http://localhost:8001/api")


@pytest.fixture()
def admin_cookie():
    db = MongoClient(os.environ["MONGO_URL"])[os.environ.get("DB_NAME", "test_database")]
    token = f"test-{uuid.uuid4().hex}"
    db.admin_sessions.insert_one({"token": token, "email": "play-guide-test@apollo.test", "expires_at": now_utc() + timedelta(minutes=5)})
    yield {"apollo_admin": token}
    db.admin_sessions.delete_one({"token": token})


def test_the_play_store_page_shows_the_guide_in_closed_sections(admin_cookie):
    r = httpx.get(f"{BASE}/admin/play-console", cookies=admin_cookie, timeout=20)
    assert r.status_code == 200
    page = r.text
    assert 'data-testid="play-console-guide"' in page and 'href="/api/admin/play-console"' in page
    headings = [line[3:].strip() for line in PLAY_CONSOLE_GUIDE.read_text().splitlines() if line.startswith("## ")]
    assert len(headings) >= 5
    for h in headings:
        assert f"<summary><h2>{h.replace('&', '&amp;')}</h2></summary>" in page
    assert "<details class=\"rb-section\" open" not in page
    assert 'href="/api/admin/reports/play-console/pdf"' in page


def test_the_play_store_guide_downloads_as_a_pdf_with_the_banner(admin_cookie):
    r = httpx.get(f"{BASE}/admin/reports/play-console/pdf", cookies=admin_cookie, timeout=60)
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf"
    assert r.content.startswith(b"%PDF") and b"/Subtype /Image" in r.content


def test_signed_out_visitors_are_sent_to_login():
    r = httpx.get(f"{BASE}/admin/play-console", timeout=20, follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"].endswith("/api/admin/login")
