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

    def test_report_retention_90d(self):
        from services.higgins.capacity import REPORT_RETENTION_SECONDS
        assert REPORT_RETENTION_SECONDS == 90 * 24 * 3600

    def test_storage_limit_100mb(self):
        from services.higgins.capacity import REPORT_STORAGE_LIMIT_BYTES
        assert REPORT_STORAGE_LIMIT_BYTES == 100 * 1024 * 1024

    def test_saved_retention_class(self):
        from services.higgins.capacity import SAVED_RETENTION
        assert SAVED_RETENTION == "apollo_saved_report"


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


@pytest.mark.asyncio(loop_scope="module")
class TestPromoteToSaved:
    async def test_promote_sets_retention_fields(self):
        from core.db import db, now_utc
        from services.higgins import repository as repo
        from services.higgins.capacity import SAVED_RETENTION
        owner = f"promote-test-{uuid.uuid4().hex[:8]}"
        case_id = str(uuid.uuid4())
        now = now_utc()
        await db.investigation_cases.insert_one({
            "owner_id": owner, "case_id": case_id, "retention_class": "apollo_15_minute_temporary",
            "deleted": False, "status": "complete", "revision": 1, "epoch": 1,
            "gates": ["vision"], "created_at": now, "updated_at": now,
            "expires_at": now + timedelta(minutes=15),
            "response_ciphertext": "encrypted-response-data-here",
            "sources_ciphertext": "encrypted-sources",
        })
        await repo.promote_to_saved(owner, case_id)
        doc = await db.investigation_cases.find_one({"owner_id": owner, "case_id": case_id}, {"_id": 0})
        assert doc["retention_class"] == SAVED_RETENTION
        assert doc.get("report_expires_at") is not None
        assert doc.get("evidence_expires_at") is not None
        assert doc["report_byte_size"] > 0
        expires = repo.utc(doc["expires_at"])
        assert (expires - now).days >= 89
        await db.investigation_cases.delete_many({"owner_id": owner})


@pytest.mark.asyncio(loop_scope="module")
class TestStorageLimit:
    async def test_enforce_deletes_oldest_first(self):
        from core.db import db, now_utc
        from services.higgins import repository as repo
        from services.higgins.capacity import SAVED_RETENTION
        owner = f"storage-test-{uuid.uuid4().hex[:8]}"
        now = now_utc()
        cases = []
        for i, size_mb in enumerate([40, 35, 30]):
            case_id = str(uuid.uuid4())
            await db.investigation_cases.insert_one({
                "owner_id": owner, "case_id": case_id, "retention_class": SAVED_RETENTION,
                "deleted": False, "status": "complete", "revision": 1, "epoch": 1,
                "gates": ["vision"], "created_at": now + timedelta(hours=i),
                "updated_at": now + timedelta(hours=i),
                "expires_at": now + timedelta(days=90),
                "report_expires_at": now + timedelta(days=90),
                "report_byte_size": size_mb * 1024 * 1024,
                "cleanup_status": "not_due",
            })
            cases.append(case_id)
        total_before = await repo.report_storage_used(owner)
        assert total_before == 105 * 1024 * 1024
        deleted = await repo.enforce_storage_limit(owner)
        assert deleted >= 1
        oldest = await db.investigation_cases.find_one({"owner_id": owner, "case_id": cases[0]}, {"_id": 0})
        assert oldest is None or oldest.get("deleted") is True
        total_after = await repo.report_storage_used(owner)
        assert total_after <= 100 * 1024 * 1024
        await db.investigation_cases.delete_many({"owner_id": owner})
        await db.investigation_cleanup.delete_many({"owner_id": owner})

    async def test_check_oversized_single_report(self):
        from services.higgins import repository as repo
        from services.higgins.capacity import REPORT_STORAGE_LIMIT_BYTES
        owner = f"oversize-{uuid.uuid4().hex[:8]}"
        result = await repo.check_storage_before_save(owner, REPORT_STORAGE_LIMIT_BYTES + 1)
        assert result["allowed"] is False
        assert "exceeds" in result["message"].lower()


@pytest.mark.asyncio(loop_scope="module")
class TestMigrateLegacy:
    async def test_migration_promotes_completed_cases(self):
        from core.db import db, now_utc
        from services.higgins import repository as repo
        from services.higgins.capacity import SAVED_RETENTION
        owner = f"migrate-test-{uuid.uuid4().hex[:8]}"
        case_id = str(uuid.uuid4())
        now = now_utc()
        await db.investigation_cases.insert_one({
            "owner_id": owner, "case_id": case_id,
            "retention_class": "apollo_15_minute_temporary",
            "deleted": False, "status": "complete", "revision": 1, "epoch": 1,
            "gates": ["vision"], "created_at": now - timedelta(hours=1),
            "updated_at": now, "expires_at": now - timedelta(minutes=5),
            "response_ciphertext": "has-a-response", "cleanup_status": "not_due",
        })
        migrated = await repo.migrate_legacy_retention()
        assert migrated >= 1
        doc = await db.investigation_cases.find_one({"owner_id": owner, "case_id": case_id}, {"_id": 0})
        assert doc["retention_class"] == SAVED_RETENTION
        assert doc.get("report_expires_at") is not None
        await db.investigation_cases.delete_many({"owner_id": owner})


class TestStorageInfoEndpoint:
    def test_storage_endpoint_returns_usage(self):
        _, headers = register_device()
        r = httpx.get(f"{BASE}/investigations/storage", headers=headers, timeout=20)
        assert r.status_code == 200
        body = r.json()
        assert "usedBytes" in body
        assert "limitBytes" in body
        assert body["limitMB"] == 100
        assert body["evidenceRetentionHours"] == 24
        assert body["reportRetentionDays"] == 90


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
        notice = report.get("retentionNotice", "")
        assert "90 days" in notice
        assert "24 hours" in notice
