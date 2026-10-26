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


# ── Model per feature: one tap on the Gemini Map ─────────────────────────────
from services.higgins import model_choice, provider  # noqa: E402


def test_only_models_that_can_do_each_job_are_offered_cheapest_first():
    magnum, ask = model_choice.eligible("magnum_di"), model_choice.eligible("ask_higgins")
    assert all({"search", "vision", "json"} <= provider.CAPABILITIES[m] for m in magnum)
    assert "gemini-2.5-flash-lite" not in magnum, "no Google Search, so it can't do Magnum DI's job"
    assert "gemini-2.5-flash-lite" in ask and set(magnum) <= set(ask)
    assert provider.TEXT_MODEL in magnum and provider.TEXT_MODEL in ask
    priced = [m for m in ask if m in model_choice.MODEL_PRICING]
    assert [model_choice.MODEL_PRICING[m]["input"] for m in priced] == sorted(model_choice.MODEL_PRICING[m]["input"] for m in priced)
    assert ask[len(priced):] == [m for m in ask if m not in model_choice.MODEL_PRICING], "unpriced models come last"


def test_ask_higgins_uses_magnum_dis_model_and_tc_flyby_always_follows_magnum(monkeypatch):
    async def run():
        client = AsyncIOMotorClient(os.environ["MONGO_URL"])
        scratch = client[f"model_choice_{uuid.uuid4().hex[:8]}"]
        monkeypatch.setattr(model_choice, "db", scratch)
        try:
            assert await model_choice.current() == {"magnum_di": "gemini-3.1-flash-lite", "tc_flyby": "gemini-3.1-flash-lite",
                                                    "ask_higgins": "gemini-3.1-flash-lite"}
            assert await model_choice.choose("magnum_di", "gemini-2.5-flash", "a@apollo.test") == "gemini-3.1-flash-lite"
            assert await model_choice.model_for("tc_flyby") == "gemini-2.5-flash"
            assert await model_choice.model_for("ask_higgins") == "gemini-3.1-flash-lite", "each feature has its own choice"
            for feature, model in (("magnum_di", "gemini-2.5-flash-lite"), ("tc_flyby", "gemini-2.5-flash"), ("ask_higgins", "gpt-4")):
                with pytest.raises(ValueError):
                    await model_choice.choose(feature, model, "a@apollo.test")
            assert await model_choice.model_for("magnum_di") == "gemini-2.5-flash", "a refused change changes nothing"
            await scratch[model_choice.COLLECTION].update_one({"feature": "ask_higgins"}, {"$set": {"model": "retired-model"}}, upsert=True)
            assert await model_choice.model_for("ask_higgins") == provider.TEXT_MODEL, "a stored model that can't do the job is never called"
        finally:
            await client.drop_database(scratch.name)
            client.close()

    asyncio.run(run())


@pytest.fixture()
def restore_choices():
    saved = list(DB[model_choice.COLLECTION].find({}, {"_id": 0}))
    yield
    DB[model_choice.COLLECTION].delete_many({})
    if saved:
        DB[model_choice.COLLECTION].insert_many(saved)


def test_one_tap_changes_a_features_model_and_is_audited(admin_cookie, restore_choices):
    page = httpx.get(f"{BASE}/admin/gemini-map?tz=600", cookies=admin_cookie, timeout=20).text
    assert "data-testid='gemini-model-magnum_di'" in page and "data-testid='gemini-model-ask_higgins'" in page
    assert "onchange='this.form.submit()'" in page and "Always the same as Magnum DI" in page
    assert "GEMINI_*_MODEL" not in page
    pick = "gemini-2.5-flash" if "<option value='gemini-2.5-flash-lite' selected>" in page.split("gemini-model-ask_higgins")[1] else "gemini-2.5-flash-lite"
    r = httpx.post(f"{BASE}/admin/gemini-map/model", data={"feature": "ask_higgins", "model": pick, "tz": "600"},
                   cookies=admin_cookie, timeout=20, follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"] == "/api/admin/gemini-map?tz=600&changed=ask_higgins"
    page = httpx.get(f"{BASE}/admin/gemini-map?tz=600&changed=ask_higgins", cookies=admin_cookie, timeout=20).text
    assert "data-testid='gemini-model-changed'" in page and f"Ask Higgins now uses <strong>{pick}</strong>" in page
    assert f"<option value='{pick}' selected>" in page and "Changed by gemini-map-test@apollo.test" in page
    audit = DB.admin_audit.find_one({"email": "gemini-map-test@apollo.test", "action": "gemini_model_change"}, sort=[("timestamp", -1)])
    assert audit and audit["detail"].startswith("Ask Higgins: ") and audit["detail"].endswith(f"→ {pick}")
    DB.admin_audit.delete_many({"email": "gemini-map-test@apollo.test"})
    refused = httpx.post(f"{BASE}/admin/gemini-map/model", data={"feature": "magnum_di", "model": "gemini-2.5-flash-lite"},
                         cookies=admin_cookie, timeout=20, follow_redirects=False)
    assert refused.status_code == 400
    flyby = httpx.post(f"{BASE}/admin/gemini-map/model", data={"feature": "tc_flyby", "model": "gemini-2.5-flash"},
                       cookies=admin_cookie, timeout=20, follow_redirects=False)
    assert flyby.status_code == 400, "TC FlyBy has no choice of its own"


def test_signed_out_visitors_cannot_change_a_model():
    r = httpx.post(f"{BASE}/admin/gemini-map/model", data={"feature": "ask_higgins", "model": "gemini-2.5-flash"}, timeout=20, follow_redirects=False)
    assert r.status_code == 303 and "login" in r.headers["location"]


def test_admin_pages_show_only_the_models_in_use(admin_cookie):
    system = httpx.get(f"{BASE}/admin/system", cookies=admin_cookie, timeout=30).text
    assert "Magnum DI and TC FlyBy model" in system and "Ask Higgins model" in system and "Vision Model" not in system
    triage = httpx.get(f"{BASE}/admin/triage", cookies=admin_cookie, timeout=30).text
    assert "Triage Model" not in triage and "Input Price" not in triage
    releases = httpx.get(f"{BASE}/admin/releases", cookies=admin_cookie, timeout=30).text
    assert "Ask Higgins model" in releases
