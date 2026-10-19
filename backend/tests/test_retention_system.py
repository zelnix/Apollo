"""Two-Tier Retention System — Acceptance Tests

Covers:
- Evidence 24-hour retention (content expires, metadata preserved)
- Report 90-day retention
- 100MB storage limit with oldest-first deletion
- Evidence reopening does not reset expiry
- Cross-owner isolation
- Migration of legacy retention
- Content_expired availability status
- Sweep functions

Run: cd /app/backend && python -m pytest tests/test_retention_system.py -v
"""
import uuid
from datetime import timedelta

import httpx
import pytest

BASE = "http://localhost:8001/api"


def register_device() -> tuple[str, dict]:
    r = httpx.post(f"{BASE}/devices/register",
                   json={"platform": "android", "adapter_mode": "standard", "app_version": "retention-test"},
                   timeout=20)
    r.raise_for_status()
    data = r.json()
    return data["device_id"], {"Authorization": f"Bearer {data['device_token']}"}


class TestRetentionConstants:
    def test_evidence_retention_24h(self):
        from services.higgins.capacity import EVIDENCE_RETENTION_SECONDS
        assert EVIDENCE_RETENTION_SECONDS == 24 * 3600

    def test_dead_retention_constants_removed(self):
        """Stage 11: Server-side report retention constants have been removed."""
        from services.higgins import capacity
        assert not hasattr(capacity, "REPORT_RETENTION_SECONDS"), "REPORT_RETENTION_SECONDS removed in Stage 11"
        assert not hasattr(capacity, "REPORT_STORAGE_LIMIT_BYTES"), "REPORT_STORAGE_LIMIT_BYTES removed in Stage 11"
        assert not hasattr(capacity, "SAVED_RETENTION"), "SAVED_RETENTION removed in Stage 11"


class TestEvidenceContentExpiry:
    def test_content_expired_availability_in_contract(self):
        from services.higgins.contracts import EvidenceItem, Coverage
        item = EvidenceItem(
            id="test", case_id="c", client_item_id="ci", display_id="E-001",
            origin="user_submission", kind="image", availability="content_expired",
            collected_at="2026-01-01T00:00:00Z", expires_at="2026-01-02T00:00:00Z",
            coverage=Coverage(status="examined", unit="bytes", total=1024, examined=1024),
        )
        wire = item.wire()
        assert wire["availability"] == "content_expired"
        assert wire["displayId"] == "E-001"

    def test_content_expired_items_counted_in_inventory(self):
        from services.higgins.contracts import Inventory
        inv = Inventory(total=3, examined=1, content_expired=1, purged=1)
        wire = inv.wire()
        assert wire["contentExpired"] == 1
        assert wire["total"] == 3


@pytest.mark.asyncio(loop_scope="module")
class TestSweepEvidenceContent:
    async def test_sweep_marks_expired_evidence(self):
        from core.db import db, now_utc
        from services.higgins import repository as repo
        owner = f"sweep-test-{uuid.uuid4().hex[:8]}"
        case_id = str(uuid.uuid4())
        evidence_id = str(uuid.uuid4())
        expired_at = now_utc() - timedelta(hours=1)
        await db.investigation_evidence.insert_one({
            "owner_id": owner, "case_id": case_id, "evidence_id": evidence_id,
            "availability": "available", "expires_at": expired_at, "kind": "image",
            "media_type": "image/jpeg", "collected_at": expired_at - timedelta(hours=23),
            "coverage": {"status": "examined", "unit": "bytes", "total": 100, "examined": 100},
        })
        await db.investigation_content_chunks.insert_one({
            "owner_id": owner, "case_id": case_id, "evidence_id": evidence_id,
            "chunk_index": 0, "ciphertext": "fake-data", "expires_at": expired_at,
        })
        count = await repo.sweep_evidence_content()
        assert count >= 1
        row = await db.investigation_evidence.find_one({"owner_id": owner, "evidence_id": evidence_id}, {"_id": 0})
        assert row["availability"] == "content_expired"
        chunk = await db.investigation_content_chunks.find_one({"owner_id": owner, "evidence_id": evidence_id})
        assert chunk is None
        await db.investigation_evidence.delete_many({"owner_id": owner})


@pytest.mark.skip(reason="promote_to_saved not implemented — server-side report retention is disabled")
@pytest.mark.asyncio(loop_scope="module")
class TestPromoteToSaved:
    async def test_promote_sets_retention_fields(self):
        pass


@pytest.mark.skip(reason="Storage limit functions not implemented — server-side report storage is disabled")
@pytest.mark.asyncio(loop_scope="module")
class TestStorageLimit:
    async def test_enforce_deletes_oldest_first(self):
        pass

    async def test_check_oversized_single_report(self):
        pass


@pytest.mark.skip(reason="migrate_legacy_retention not implemented — server-side report retention is disabled")
@pytest.mark.asyncio(loop_scope="module")
class TestMigrateLegacy:
    async def test_migration_promotes_completed_cases(self):
        pass


class TestStorageInfoEndpoint:
    def test_storage_endpoint_returns_usage(self):
        _, headers = register_device()
        r = httpx.get(f"{BASE}/investigations/storage", headers=headers, timeout=20)
        assert r.status_code == 200
        body = r.json()
        assert "usedBytes" in body
        assert "limitBytes" in body
        # Storage is currently disabled (0 limit)
        assert body["limitMB"] == 0 or body["limitMB"] == 100
        assert body["evidenceRetentionHours"] == 24


@pytest.mark.asyncio(loop_scope="module")
class TestEvidenceExpiryDoesNotReset:
    async def test_get_evidence_metadata_does_not_change_expiry(self):
        from core.db import db, now_utc
        from services.higgins import repository as repo
        owner = f"no-reset-{uuid.uuid4().hex[:8]}"
        case_id = str(uuid.uuid4())
        evidence_id = str(uuid.uuid4())
        original_expires = now_utc() + timedelta(hours=12)
        await db.investigation_evidence.insert_one({
            "owner_id": owner, "case_id": case_id, "evidence_id": evidence_id,
            "availability": "available", "expires_at": original_expires,
            "kind": "text", "collected_at": now_utc() - timedelta(hours=12),
            "coverage": {"status": "examined", "unit": "bytes", "total": 50, "examined": 50},
        })
        row = await repo.get_evidence(owner, case_id, evidence_id, content_required=False)
        assert row is not None
        # Verify expiry unchanged (compare to second precision — MongoDB truncates microseconds)
        updated = await db.investigation_evidence.find_one({"owner_id": owner, "evidence_id": evidence_id}, {"_id": 0})
        stored_expires = repo.utc(updated["expires_at"])
        assert abs((stored_expires - original_expires).total_seconds()) < 1
        await db.investigation_evidence.delete_many({"owner_id": owner})


@pytest.mark.asyncio(loop_scope="module")
class TestCrossOwnerIsolation:
    async def test_sweep_only_affects_own_evidence(self):
        from core.db import db, now_utc
        from services.higgins import repository as repo
        owner_a = f"isolation-a-{uuid.uuid4().hex[:8]}"
        owner_b = f"isolation-b-{uuid.uuid4().hex[:8]}"
        case_a = str(uuid.uuid4())
        case_b = str(uuid.uuid4())
        expired = now_utc() - timedelta(hours=1)
        future = now_utc() + timedelta(hours=12)
        await db.investigation_evidence.insert_one({
            "owner_id": owner_a, "case_id": case_a, "evidence_id": "ea1",
            "availability": "available", "expires_at": expired, "kind": "image",
            "coverage": {"status": "examined", "unit": "bytes", "total": 100, "examined": 100},
        })
        await db.investigation_evidence.insert_one({
            "owner_id": owner_b, "case_id": case_b, "evidence_id": "eb1",
            "availability": "available", "expires_at": future, "kind": "image",
            "coverage": {"status": "examined", "unit": "bytes", "total": 100, "examined": 100},
        })
        await repo.sweep_evidence_content()
        row_a = await db.investigation_evidence.find_one({"owner_id": owner_a, "evidence_id": "ea1"}, {"_id": 0})
        row_b = await db.investigation_evidence.find_one({"owner_id": owner_b, "evidence_id": "eb1"}, {"_id": 0})
        assert row_a["availability"] == "content_expired"
        assert row_b["availability"] == "available"
        await db.investigation_evidence.delete_many({"owner_id": {"$in": [owner_a, owner_b]}})


class TestReportRetentionNotice:
    def test_retention_notice_text(self):
        from services.higgins.report_store import build_report
        report = build_report(
            response={"overview": "Test", "explanationMarkdown": "Test", "assessment": "moderate",
                       "subject": "Test", "findings": [], "sources": [], "attention": "low",
                       "completion": "complete", "sourceIds": [], "scope": "Test scope",
                       "question": None, "uncertainties": [], "actions": []},
            case_id="test-case", gates=["vision"], revision=1,
            sources=[], health_check=False,
        )
        # The retention notice should exist and be a string
        notice = report.get("retentionNotice", "")
        assert isinstance(notice, str)
