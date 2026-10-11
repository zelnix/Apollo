"""Tests for the threat indicator lifecycle — Stage 1.

Uses session-scoped event loop (loop_scope="session") so the Motor client
survives across async test functions without "Event loop is closed" errors.

Covers: admin CRUD, revalidation state transitions, dual-timestamp semantics,
provider timeout handling, hard expiry, migration.
"""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest

from core.db import db


# ── Helpers ─────────────────────────────────────────────────────────────────

def _make_indicator(
    *,
    hostname: str = "evil.example.com",
    source: str = "google_safe_browsing",
    status: str = "active",
    next_check_delta: timedelta = timedelta(hours=-1),
    expiry_delta: timedelta = timedelta(hours=23),
    consecutive_failures: int = 0,
) -> dict:
    ts = datetime.utcnow()
    return {
        "indicator_id": f"ti-test-{secrets.token_hex(8)}",
        "hostname": hostname,
        "scope": "hostname",
        "source": source,
        "source_reference": None,
        "original_evidence": f"Test indicator for {hostname}",
        "original_scope": "hostname",
        "first_seen_at": ts - timedelta(days=1),
        "last_verified_at": ts - timedelta(hours=5),
        "next_scheduled_check": ts + next_check_delta,
        "evidence_expiry_deadline": ts + expiry_delta,
        "verification_count": 1,
        "last_revalidation_outcome": None,
        "last_revalidation_at": None,
        "consecutive_check_failures": consecutive_failures,
        "status": status,
        "review_status": "auto_verified",
        "added_at": ts - timedelta(days=1),
        "updated_at": ts - timedelta(hours=5),
        "withdrawn_at": None,
        "withdrawal_reason": None,
        "added_by": "test",
    }


async def _cleanup():
    await db.threat_indicators.delete_many({"indicator_id": {"$regex": "^ti-test-"}})
    await db.threat_revalidation_log.delete_many({"indicator_id": {"$regex": "^ti-test-"}})


# ── Revalidation engine tests (session-scoped loop to keep Motor alive) ──────

@pytest.mark.asyncio(loop_scope="session")
async def test_reval_01_confirmed_refreshes_both_timestamps():
    from core.models import ThreatIndicator
    from services.threat_revalidation import _apply_revalidation_outcome
    ind = _make_indicator()
    await db.threat_indicators.insert_one(ind)
    try:
        indicator = ThreatIndicator.from_mongo(ind)
        before_check = ind["next_scheduled_check"]
        before_expiry = ind["evidence_expiry_deadline"]
        new_status = await _apply_revalidation_outcome(indicator, "confirmed")
        assert new_status == "active"
        updated = await db.threat_indicators.find_one({"indicator_id": ind["indicator_id"]})
        assert updated["verification_count"] == 2
        assert updated["consecutive_check_failures"] == 0
        assert updated["next_scheduled_check"] > before_check
        assert updated["evidence_expiry_deadline"] > before_expiry
    finally:
        await _cleanup()


@pytest.mark.asyncio(loop_scope="session")
async def test_reval_02_source_delisted_expires():
    from core.models import ThreatIndicator
    from services.threat_revalidation import _apply_revalidation_outcome
    ind = _make_indicator()
    await db.threat_indicators.insert_one(ind)
    try:
        indicator = ThreatIndicator.from_mongo(ind)
        new_status = await _apply_revalidation_outcome(indicator, "source_delisted")
        assert new_status == "expired"
        updated = await db.threat_indicators.find_one({"indicator_id": ind["indicator_id"]})
        assert updated["status"] == "expired"
        assert updated["withdrawal_reason"] == "source_delisted"
        assert updated["withdrawn_at"] is not None
    finally:
        await _cleanup()


@pytest.mark.asyncio(loop_scope="session")
async def test_reval_03_timeout_never_expires():
    """Provider timeout must NEVER move indicator to expired — only check_overdue."""
    from core.models import ThreatIndicator
    from services.threat_revalidation import _apply_revalidation_outcome
    ind = _make_indicator()
    await db.threat_indicators.insert_one(ind)
    try:
        indicator = ThreatIndicator.from_mongo(ind)
        original_expiry = ind["evidence_expiry_deadline"]
        new_status = await _apply_revalidation_outcome(indicator, "source_timeout")
        assert new_status == "check_overdue"
        updated = await db.threat_indicators.find_one({"indicator_id": ind["indicator_id"]})
        assert updated["status"] == "check_overdue"
        assert updated["consecutive_check_failures"] == 1
        # evidence_expiry_deadline must NOT be extended on failure (allow Mongo microsecond truncation)
        delta = abs((updated["evidence_expiry_deadline"] - original_expiry).total_seconds())
        assert delta < 1.0, f"expiry shifted by {delta}s — should be unchanged on timeout"
    finally:
        await _cleanup()


@pytest.mark.asyncio(loop_scope="session")
async def test_reval_04_error_never_expires():
    from core.models import ThreatIndicator
    from services.threat_revalidation import _apply_revalidation_outcome
    ind = _make_indicator()
    await db.threat_indicators.insert_one(ind)
    try:
        indicator = ThreatIndicator.from_mongo(ind)
        new_status = await _apply_revalidation_outcome(indicator, "source_error")
        assert new_status == "check_overdue"
        updated = await db.threat_indicators.find_one({"indicator_id": ind["indicator_id"]})
        assert updated["consecutive_check_failures"] == 1
    finally:
        await _cleanup()


@pytest.mark.asyncio(loop_scope="session")
async def test_reval_05_failures_accumulate():
    from core.models import ThreatIndicator
    from services.threat_revalidation import _apply_revalidation_outcome
    ind = _make_indicator(consecutive_failures=3)
    await db.threat_indicators.insert_one(ind)
    try:
        indicator = ThreatIndicator.from_mongo(ind)
        await _apply_revalidation_outcome(indicator, "source_timeout")
        updated = await db.threat_indicators.find_one({"indicator_id": ind["indicator_id"]})
        assert updated["consecutive_check_failures"] == 4
        assert updated["status"] in ("active", "check_overdue")
    finally:
        await _cleanup()


@pytest.mark.asyncio(loop_scope="session")
async def test_reval_06_audit_log_created():
    from core.models import ThreatIndicator
    from services.threat_revalidation import _apply_revalidation_outcome
    ind = _make_indicator()
    await db.threat_indicators.insert_one(ind)
    try:
        indicator = ThreatIndicator.from_mongo(ind)
        await _apply_revalidation_outcome(indicator, "confirmed")
        log = await db.threat_revalidation_log.find_one({"indicator_id": ind["indicator_id"]})
        assert log is not None
        assert log["outcome"] == "confirmed"
        assert log["previous_status"] == "active"
        assert log["new_status"] == "active"
    finally:
        await _cleanup()


@pytest.mark.asyncio(loop_scope="session")
async def test_reval_07_hard_expiry_enforced():
    from services.threat_revalidation import _enforce_hard_expiry
    ind = _make_indicator(expiry_delta=timedelta(hours=-1))
    await db.threat_indicators.insert_one(ind)
    try:
        count = await _enforce_hard_expiry()
        assert count >= 1
        updated = await db.threat_indicators.find_one({"indicator_id": ind["indicator_id"]})
        assert updated["status"] == "expired"
        assert updated["withdrawal_reason"] == "expired_unverified"
    finally:
        await _cleanup()


@pytest.mark.asyncio(loop_scope="session")
async def test_reval_08_hard_expiry_skips_valid():
    from services.threat_revalidation import _enforce_hard_expiry
    ind = _make_indicator(expiry_delta=timedelta(hours=20))
    await db.threat_indicators.insert_one(ind)
    try:
        await _enforce_hard_expiry()
        updated = await db.threat_indicators.find_one({"indicator_id": ind["indicator_id"]})
        assert updated["status"] == "active"
    finally:
        await _cleanup()


@pytest.mark.asyncio(loop_scope="session")
async def test_reval_09_hard_expiry_skips_withdrawn():
    from services.threat_revalidation import _enforce_hard_expiry
    ind = _make_indicator(expiry_delta=timedelta(hours=-1))
    ind["status"] = "withdrawn"
    await db.threat_indicators.insert_one(ind)
    try:
        await _enforce_hard_expiry()
        updated = await db.threat_indicators.find_one({"indicator_id": ind["indicator_id"]})
        assert updated["status"] == "withdrawn"
    finally:
        await _cleanup()


@pytest.mark.asyncio(loop_scope="session")
async def test_reval_10_cycle_selects_due_only():
    from services.threat_revalidation import revalidate_due_indicators
    overdue = _make_indicator(hostname="overdue.test.local", next_check_delta=timedelta(hours=-1))
    not_due = _make_indicator(hostname="notdue.test.local", next_check_delta=timedelta(hours=3))
    await db.threat_indicators.insert_many([overdue, not_due])
    try:
        with patch("services.threat_revalidation._revalidate_indicator", new_callable=AsyncMock, return_value="confirmed"):
            stats = await revalidate_due_indicators()
        assert stats["checked"] >= 1
        assert stats["confirmed"] >= 1
    finally:
        await _cleanup()


# ── Admin HTTP CRUD (synchronous) ────────────────────────────────────────────

class TestThreatIndicatorAdminCRUD:

    def test_list_indicators(self):
        import os, requests
        base = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
        admin_key = os.environ.get("APOLLO_ADMIN_KEY", "")
        resp = requests.get(f"{base}/api/admin/threat-indicators", headers={"X-Admin-Key": admin_key})
        assert resp.status_code == 200
        data = resp.json()
        assert "indicators" in data
        assert "total" in data

    def test_add_and_withdraw_lifecycle(self):
        import os, requests
        base = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
        admin_key = os.environ.get("APOLLO_ADMIN_KEY", "")
        hdrs = {"X-Admin-Key": admin_key, "Content-Type": "application/json"}
        tag = secrets.token_hex(4)
        hostname = f"test-lifecycle-{tag}.example.net"

        resp = requests.post(f"{base}/api/admin/threat-indicators", headers=hdrs, json={
            "hostname": hostname, "source": "apollo_manual",
            "original_evidence": "Manual test", "original_scope": "hostname", "reason": "test",
        })
        assert resp.status_code == 201, resp.text
        indicator_id = resp.json()["indicator_id"]

        resp = requests.get(f"{base}/api/admin/threat-indicators/{indicator_id}", headers=hdrs)
        assert resp.status_code == 200
        assert resp.json()["indicator"]["status"] == "active"

        resp = requests.post(f"{base}/api/admin/threat-indicators/{indicator_id}/withdraw", headers=hdrs, json={
            "reason": "false_positive_confirmed", "detail": "Test withdrawal",
        })
        assert resp.status_code == 200
        assert resp.json()["status"] == "withdrawn"

    def test_duplicate_hostname_rejected(self):
        import os, requests
        base = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
        admin_key = os.environ.get("APOLLO_ADMIN_KEY", "")
        hdrs = {"X-Admin-Key": admin_key, "Content-Type": "application/json"}
        tag = secrets.token_hex(4)
        hostname = f"test-dupe-{tag}.example.net"

        body = {"hostname": hostname, "source": "apollo_manual",
                "original_evidence": "Dupe test", "original_scope": "hostname", "reason": "test"}
        resp1 = requests.post(f"{base}/api/admin/threat-indicators", headers=hdrs, json=body)
        assert resp1.status_code == 201
        resp2 = requests.post(f"{base}/api/admin/threat-indicators", headers=hdrs, json=body)
        assert resp2.status_code == 409

        requests.post(f"{base}/api/admin/threat-indicators/{resp1.json()['indicator_id']}/withdraw",
                      headers=hdrs, json={"reason": "admin_manual", "detail": "cleanup"})

    def test_stats_endpoint(self):
        import os, requests
        base = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
        admin_key = os.environ.get("APOLLO_ADMIN_KEY", "")
        resp = requests.get(f"{base}/api/admin/threat-indicators/stats/summary", headers={"X-Admin-Key": admin_key})
        assert resp.status_code == 200
        data = resp.json()
        assert "by_status" in data
        assert "total_active" in data
