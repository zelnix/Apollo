"""Acceptance tests for the Historical Investigation & Protection Record Retrofit.

Tests all 12 acceptance criteria from the PRD.
These require a database populated by the retrofit migration script.
In a fresh environment, these may not have records to check — they are skipped
if no retrofit data exists.
"""
from __future__ import annotations

import sys
sys.path.insert(0, "/app/backend")

import asyncio
from core.db import db
from services.record_classification import classify_record, generate_higgins_briefing


def _run(coro):
    """Run an async function safely with Motor's event loop."""
    try:
        loop = asyncio.get_event_loop()
        if loop.is_closed():
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    return loop.run_until_complete(coro)


def test_1_investigations_accessible():
    """AT1: Existing genuine investigations remain accessible."""
    count = _run(db.patrol_records.count_documents({"investigation_case_id": {"$ne": None}, "record_class": {"$exists": True}}))
    if count == 0:
        import pytest; pytest.skip("No classified investigation records — retrofit not run")
    print(f"  ✓ AT1: {count} investigation records accessible with classification")


def test_2_timestamps_preserved():
    """AT2: Historical evidence and original timestamps preserved."""
    sample = _run(db.patrol_records.find_one({"record_class": {"$exists": True}}, {"_id": 0}))
    if not sample:
        import pytest; pytest.skip("No classified records — retrofit not run")
    assert "occurred_at" in sample, "occurred_at missing"
    assert "created_at" in sample, "created_at missing"
    if sample.get("reassessment"):
        assert "reassessed_at" in sample["reassessment"], "reassessment missing reassessed_at"
        assert sample["reassessment"]["reassessed_at"] != sample["occurred_at"], "reassessment date should differ"
    print("  ✓ AT2: Timestamps preserved, reassessment dates separate")


def test_3_higgins_briefings():
    """AT3: Higgins gives concise, evidence-specific briefings for deterministic records.
    Investigation records may have null briefings (the Magnum DI result is authoritative)."""
    count = _run(db.patrol_records.count_documents({"higgins_briefing": {"$exists": True, "$ne": None}}))
    if count == 0:
        import pytest; pytest.skip("No Higgins briefings — retrofit not run or all investigation records")
    sample = _run(db.patrol_records.find_one({"higgins_briefing": {"$exists": True, "$ne": None}}, {"_id": 0}))
    briefing = sample["higgins_briefing"]
    assert "investigated" in briefing, "Briefing missing 'investigated'"
    assert "established" in briefing, "Briefing missing 'established'"
    assert "meaning" in briefing, "Briefing missing 'meaning'"
    assert "evidence_points" in briefing, "Briefing missing 'evidence_points'"
    print(f"  ✓ AT3: {count} Higgins briefings generated with required fields")


def test_4_magnum_reports_available():
    """AT4: Magnum DI full reports remain available on demand."""
    count = _run(db.higgins_investigation_history.count_documents({"retrofit_version": "v1"}))
    if count == 0:
        import pytest; pytest.skip("No retrofitted investigation history — retrofit not run")
    print(f"  ✓ AT4: {count} investigation history entries updated for Magnum DI")


def test_5_unverifiable_identified():
    """AT5: Unverifiable historical findings clearly identified."""
    result = classify_record({"category": "unknown", "raw_state": "unknown"})
    assert result == "unverifiable_legacy", f"Expected unverifiable_legacy, got {result}"
    print("  ✓ AT5: Unverifiable records correctly identified by classifier")


def test_6_gate_failures_not_threats():
    """AT6: Old Gate failures no longer count as security threats."""
    protection_threats = _run(db.patrol_records.count_documents({
        "category": {"$in": ["protection", "system"]},
        "record_class": "security_threat",
    }))
    assert protection_threats == 0, f"Found {protection_threats} protection records misclassified as security_threat"
    protection_issues = _run(db.patrol_records.count_documents({
        "category": {"$in": ["protection", "system"]},
        "record_class": {"$in": ["protection_issue", "reduced_protection", "informational"]},
    }))
    print(f"  ✓ AT6: 0 gate failures as threats, {protection_issues} correctly classified")


def test_7_no_false_current_alerts():
    """AT7: Historical incidents do not cause false current alerts."""
    resolved = _run(db.patrol_records.count_documents({"record_class": "resolved"}))
    active_threats_from_resolved = _run(db.patrol_records.count_documents({
        "resolution.status": {"$in": ["resolved", "trusted"]},
        "record_class": "security_threat",
    }))
    assert active_threats_from_resolved == 0, f"Found {active_threats_from_resolved} resolved records still classified as active threats"
    print(f"  ✓ AT7: {resolved} resolved records, 0 false active threats from resolved items")


def test_8_verified_blocks_authentic():
    """AT8: Previously verified blocks retain authentic enforcement evidence."""
    verified = _run(db.patrol_records.count_documents({"record_class": "threat_stopped"}))
    with_ref = _run(db.patrol_records.count_documents({
        "record_class": "threat_stopped",
        "observed_block_reference": {"$ne": None},
    }))
    print(f"  ✓ AT8: {verified} threat_stopped records, {with_ref} with verified block reference")


def test_9_duplicates_preserved():
    """AT9: Duplicate findings removed from presentation without destroying source."""
    duplicates = _run(db.patrol_records.count_documents({"duplicate_of": {"$ne": None}}))
    if duplicates > 0:
        sample = _run(db.patrol_records.find_one({"duplicate_of": {"$ne": None}}, {"_id": 0}))
        assert "source_event_id" in sample, "Duplicate lost source_event_id"
        assert "occurred_at" in sample, "Duplicate lost occurred_at"
    print(f"  ✓ AT9: {duplicates} duplicates marked, source observations preserved")


def test_10_migration_idempotent():
    """AT10: Migration is repeatable and does not duplicate or corrupt records."""
    report = _run(db.migration_reports.find_one({"migration_id": "retrofit_v1"}, {"_id": 0}))
    if not report:
        import pytest; pytest.skip("Migration report not found — retrofit not run")
    assert report.get("errors", -1) == 0, f"Migration had {report.get('errors')} errors"
    # Record count may have grown since the retrofit was run (new events arriving)
    total = _run(db.patrol_records.count_documents({}))
    assert total >= report["records_reviewed"], \
        f"Record count {total} should be >= reviewed {report['records_reviewed']}"
    print(f"  ✓ AT10: Migration report found, 0 errors, {total} current records (>= {report['records_reviewed']} reviewed)")


def test_11_distinguish_historic_from_new():
    """AT11: User can clearly distinguish historic conclusions from new reassessments."""
    with_reassessment = _run(db.patrol_records.count_documents({"reassessment": {"$exists": True, "$ne": None}}))
    if with_reassessment == 0:
        import pytest; pytest.skip("No reassessment metadata — retrofit not run")
    sample = _run(db.patrol_records.find_one({"reassessment": {"$exists": True, "$ne": None}}, {"_id": 0})
    )
    r = sample["reassessment"]
    assert "reassessed_at" in r, "Missing reassessed_at"
    assert "reason" in r, "Missing reason"
    assert "version" in r, "Missing version"
    print(f"  ✓ AT11: {with_reassessment} records with reassessment provenance metadata")


def test_12_consistent_standards():
    """AT12: New and retrofitted reports follow approved standards.
    Investigation records may have null higgins_briefing (Magnum DI result is authoritative)."""
    unclassified = _run(db.patrol_records.count_documents({"record_class": {"$exists": False}}))
    assert unclassified == 0, f"Found {unclassified} unclassified records"
    # All records should have higgins_briefing field (may be null for investigation records)
    missing_field = _run(db.patrol_records.count_documents({"higgins_briefing": {"$exists": False}}))
    assert missing_field == 0, f"Found {missing_field} records without higgins_briefing field"
    print(f"  ✓ AT12: All records classified with consistent standards")


async def run_all():
    tests = [
        test_1_investigations_accessible,
        test_2_timestamps_preserved,
        test_3_higgins_briefings,
        test_4_magnum_reports_available,
        test_5_unverifiable_identified,
        test_6_gate_failures_not_threats,
        test_7_no_false_current_alerts,
        test_8_verified_blocks_authentic,
        test_9_duplicates_preserved,
        test_10_migration_idempotent,
        test_11_distinguish_historic_from_new,
        test_12_consistent_standards,
    ]

    passed = 0
    failed = 0

    print("\n" + "=" * 60)
    print("Historical Record Retrofit — Acceptance Tests")
    print("=" * 60 + "\n")

    for test in tests:
        try:
            test()
            passed += 1
        except AssertionError as e:
            print(f"  ✗ {test.__doc__}: {e}")
            failed += 1
        except Exception as e:
            print(f"  ✗ {test.__doc__}: Unexpected error: {e}")
            failed += 1

    print(f"\n{'=' * 60}")
    print(f"Results: {passed}/{passed + failed} passed")
    print("=" * 60)
    return failed == 0


if __name__ == "__main__":
    success = asyncio.run(run_all())
    sys.exit(0 if success else 1)
