"""Gemini Map admin page: each feature that calls Gemini, with its calls and cost this week."""
import asyncio
import os
import uuid
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import MongoClient

from core.db import now_utc
from routers import admin_portal

BASE = os.environ.get("APOLLO_API", "http://localhost:8001/api")
DB = MongoClient(os.environ["MONGO_URL"])[os.environ.get("DB_NAME", "test_database")]


@pytest.fixture()
def admin_cookie():
    token = f"test-{uuid.uuid4().hex}"
    DB.admin_sessions.insert_one({"token": token, "email": "gemini-map-test@apollo.test", "expires_at": now_utc() + timedelta(minutes=5)})
    yield {"apollo_admin": token}
    DB.admin_sessions.delete_one({"token": token})


def test_the_week_starts_monday_midnight_in_the_admins_zone():
    start = admin_portal._week_start(600)
    local = start.astimezone(timezone(timedelta(minutes=600)))
    assert (local.weekday(), local.hour, local.minute) == (0, 0, 0)
    assert timedelta(0) <= now_utc() - start < timedelta(days=7)


def test_each_record_is_counted_under_the_feature_that_made_it(monkeypatch):
    """Against a throwaway database, so the preview's own usage is untouched."""
    async def run():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        scratch = client[f"gemini_map_{uuid.uuid4().hex[:8]}"]
        monkeypatch.setattr(admin_portal, "db", scratch)
        now = now_utc()
        rec = lambda purpose, cid, cost=0.01, ok=True, ts=now: {"purpose": purpose, "correlation_id": cid, "estimated_cost_usd": cost,  # noqa: E731
                                                               "success": ok, "search_queries": 1, "timestamp": ts}
        try:
            await scratch.gemini_usage.insert_many([
                rec("investigation", "case-1"), rec("investigation", "case-1", ok=False), rec("teddy_search", "case-1"),
                rec("ordinary_chat", "chat-abc"), rec("ordinary_chat", "protection-x"), rec("investigation", "page-crawl"),
                rec("investigation", "case-2", ts=now - timedelta(days=9)),
            ])
            usage = await admin_portal.gemini_usage_by_feature(now - timedelta(days=1))
            assert usage["magnum_di"]["calls"] == 2 and usage["magnum_di"]["failed"] == 1
            assert usage["tc_flyby"]["calls"] == 1 and usage["ask_higgins"]["calls"] == 1
            assert usage["protection"]["calls"] == 1 and usage["page_crawl"]["calls"] == 1
            assert round(sum(v["cost"] for v in usage.values()), 4) == 0.06
        finally:
            await client.drop_database(scratch.name)
            client.close()

    asyncio.run(run())


def test_the_page_lists_every_feature_with_this_weeks_numbers(admin_cookie):
    r = httpx.get(f"{BASE}/admin/gemini-map?tz=600", cookies=admin_cookie, timeout=20)
    assert r.status_code == 200
    page = r.text
    assert 'href="/api/admin/gemini-map"' in page and "since Monday 00:00 UTC+10:00" in page
    for key in ("magnum_di", "tc_flyby", "ask_higgins"):
        assert f"data-testid='gemini-feature-{key}'" in page
        assert f"data-testid='gemini-trend-{key}'" in page
    assert "data-testid='gemini-trend-other'" in page and "data-testid='gemini-trend-total'" in page
    assert page.count("Week of<br>") == 3 and "This week so far<br>" in page
    for gone in ("page_extract", "page_crawl()", "protection_explanations.py"):
        assert gone not in page
    assert "Gemini calls this week" in page and "Estimated cost this week" in page


def test_each_weeks_cost_is_compared_with_the_week_before():
    assert admin_portal._change_html(2.0, 1.0) == " <span class='trend up'>▲ 100%</span>"
    assert admin_portal._change_html(0.5, 1.0) == " <span class='trend down'>▼ 50%</span>"
    assert admin_portal._change_html(1.0, 0.0) == " <span class='trend up'>new</span>"
    assert admin_portal._change_html(0.0, 0.0) == ""
    assert admin_portal._change_html(1.001, 1.0) == " <span class='trend'>±0%</span>"


def test_the_four_weeks_are_counted_separately(monkeypatch):
    async def run():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        scratch = client[f"gemini_trend_{uuid.uuid4().hex[:8]}"]
        monkeypatch.setattr(admin_portal, "db", scratch)
        start = admin_portal._week_start(0)
        try:
            await scratch.gemini_usage.insert_many([
                {"purpose": "teddy_search", "correlation_id": "case-1", "estimated_cost_usd": 0.02, "success": True, "timestamp": start - timedelta(days=3)},
                {"purpose": "teddy_search", "correlation_id": "case-2", "estimated_cost_usd": 0.01, "success": True, "timestamp": start + timedelta(minutes=1)},
            ])
            last_week = await admin_portal.gemini_usage_by_feature(start - timedelta(weeks=1), start)
            this_week = await admin_portal.gemini_usage_by_feature(start)
            assert last_week["tc_flyby"]["calls"] == 1 and round(last_week["tc_flyby"]["cost"], 2) == 0.02
            assert this_week["tc_flyby"]["calls"] == 1 and round(this_week["tc_flyby"]["cost"], 2) == 0.01
        finally:
            await client.drop_database(scratch.name)
            client.close()

    asyncio.run(run())


def test_signed_out_visitors_are_sent_to_login():
    r = httpx.get(f"{BASE}/admin/gemini-map", timeout=20, follow_redirects=False)
    assert r.status_code == 303
