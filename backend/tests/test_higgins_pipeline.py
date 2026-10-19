"""Test Higgins investigation intent detection and pipeline routing.

Validates that:
- Investigation intent is detected from user messages
- Submittable artefacts (URLs, emails, phones) are extracted correctly
- Pipeline submission creates a case with initiator='higgins_user_request'
- Deduplication reuses existing investigations on the same device
- Non-investigation messages pass through to normal chat

Run: python tests/test_higgins_pipeline.py
"""
import asyncio
import os
import sys
import uuid

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ["APOLLO_PROVIDER_MODE"] = "mock"
os.environ["APOLLO_FORBID_PROVIDER_CALLS"] = "1"

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))


def test_intent_detection():
    """Test the intent detection patterns (pure logic, no async)."""
    from services.higgins.pipeline_submit import detect_investigation_intent

    passed = 0
    failed = 0

    def _assert(ok, name, detail=""):
        nonlocal passed, failed
        if ok:
            print(f"  PASS: {name}")
            passed += 1
        else:
            print(f"  FAIL: {name} — {detail}")
            failed += 1

    print("\n[Intent Detection Tests]")

    # Positive cases — should detect investigation intent
    positive = [
        "Is this email a scam? sender@dodgy.com",
        "Can you check this URL for me? https://suspicious-site.com/login",
        "Is this link safe to click? https://example.com/offer",
        "I just got this text, is it suspicious? Your bank account needs verification",
        "Investigate this number for me: +61 400 123 456",
        "Could you look into https://phish.example.com",
        "Check this for me: someone sent me an email from admin@fake-bank.com",
        "Is it safe to respond to this message about my payment?",
        "Please scan this link https://dodgy.co/free-prize",
        "Run a check on this website https://totally-legit.biz",
        "Should I click this link? https://verify-account.net",
        "I received a suspicious email from tax@gov-scam.co",
    ]
    for msg in positive:
        _assert(detect_investigation_intent(msg), f"Positive: '{msg[:60]}...'")

    # Negative cases — should NOT detect investigation intent
    negative = [
        "What is Apollo?",
        "How does Magnum DI work?",
        "Tell me about cybersecurity best practices",
        "What was my last investigation about?",
        "Hello Higgins",
        "Thanks for the help",
        "What protection features do I have?",
    ]
    for msg in negative:
        _assert(not detect_investigation_intent(msg), f"Negative: '{msg[:60]}...'")

    return passed, failed


def test_artefact_extraction():
    """Test that submittable artefacts are correctly extracted."""
    from services.higgins.pipeline_submit import extract_submittable_items

    passed = 0
    failed = 0

    def _assert(ok, name, detail=""):
        nonlocal passed, failed
        if ok:
            print(f"  PASS: {name}")
            passed += 1
        else:
            print(f"  FAIL: {name} — {detail}")
            failed += 1

    print("\n[Artefact Extraction Tests]")

    # URL extraction
    items = extract_submittable_items("Check https://suspicious.com/login please")
    _assert(any(i["kind"] == "url" and "suspicious.com" in i["value"] for i in items),
            "Extracts URL", f"got: {items}")

    # Email extraction
    items = extract_submittable_items("Is this sender legit? admin@fake-bank.com")
    _assert(any(i["kind"] == "email" and "fake-bank.com" in i["value"] for i in items),
            "Extracts email", f"got: {items}")

    # Phone extraction
    items = extract_submittable_items("Investigate this number +61 400 123 456")
    _assert(any(i["kind"] == "phone" for i in items), "Extracts phone", f"got: {items}")

    # Multiple artefacts
    items = extract_submittable_items("Check https://site.com and admin@evil.com")
    _assert(len(items) >= 2, "Multiple artefacts", f"got {len(items)} items")

    # Text fallback
    items = extract_submittable_items("I received a very suspicious message saying my account needs urgent verification and I should transfer money immediately")
    _assert(any(i["kind"] == "text" for i in items), "Falls back to text for substantial messages", f"got: {items}")

    # Short message — no items
    items = extract_submittable_items("Is this safe?")
    _assert(len(items) == 0, "No items for short message without artefact")

    return passed, failed


async def test_pipeline_submission():
    """Test that pipeline submission creates a case with correct initiator."""
    from core.db import db, now_utc
    from services.higgins import repository as repo
    from services.higgins.pipeline_submit import submit_to_investigation_pipeline

    passed = 0
    failed = 0
    device_id = f"test-higgins-pipeline-{uuid.uuid4().hex[:8]}"

    def _assert(ok, name, detail=""):
        nonlocal passed, failed
        if ok:
            print(f"  PASS: {name}")
            passed += 1
        else:
            print(f"  FAIL: {name} — {detail}")
            failed += 1

    print("\n[Pipeline Submission Tests]")

    # Test 1: Submit creates a case with correct initiator
    items = [{"kind": "url", "value": "https://test-suspicious.com/phish"}]
    try:
        result = await submit_to_investigation_pipeline(
            device_id,
            "Is this URL a scam? https://test-suspicious.com/phish",
            items,
        )
        _assert(result["case_id"] is not None, "Pipeline returns case_id")
        _assert(result["reused"] is False, "First submission is not reused")

        # Check the case has correct initiator
        case = await db.investigation_cases.find_one(
            {"owner_id": device_id, "case_id": result["case_id"]},
            {"_id": 0, "initiator": 1, "evidence_fingerprint": 1, "source_metadata": 1}
        )
        _assert(case is not None, "Case exists in DB")
        _assert(case.get("initiator") == "higgins_user_request",
                "Initiator is higgins_user_request", f"got: {case.get('initiator')}")
        _assert(case.get("evidence_fingerprint") is not None,
                "Evidence fingerprint is set")
        _assert(case.get("source_metadata") is not None,
                "Source metadata is set")
    except Exception as exc:
        _assert(False, "Pipeline submission", f"Exception: {exc}")

    # Test 2: Same submission on same device reuses investigation
    try:
        # Mark previous case as completed (has response_ciphertext)
        await db.investigation_cases.update_one(
            {"owner_id": device_id, "case_id": result["case_id"]},
            {"$set": {"response_ciphertext": repo.enc_json({"overview": "Test result"})}}
        )

        result2 = await submit_to_investigation_pipeline(
            device_id,
            "Is this URL a scam? https://test-suspicious.com/phish",
            items,
        )
        _assert(result2["reused"] is True, "Same evidence reuses investigation")
        _assert(result2["case_id"] == result["case_id"],
                "Reused case ID matches", f"got: {result2['case_id']} vs {result['case_id']}")
    except Exception as exc:
        _assert(False, "Investigation reuse", f"Exception: {exc}")

    # Test 3: Different device does NOT reuse
    other_device = f"test-higgins-other-{uuid.uuid4().hex[:8]}"
    try:
        result3 = await submit_to_investigation_pipeline(
            other_device,
            "Is this URL a scam? https://test-suspicious.com/phish",
            items,
        )
        _assert(result3["reused"] is False, "Cross-device does not reuse")
        _assert(result3["case_id"] != result["case_id"],
                "Different device gets different case")
    except Exception as exc:
        _assert(False, "Cross-device isolation", f"Exception: {exc}")

    # Cleanup
    await db.investigation_cases.delete_many({"owner_id": {"$in": [device_id, other_device]}})
    await db.investigation_evidence.delete_many({"owner_id": {"$in": [device_id, other_device]}})
    await db.investigation_jobs.delete_many({"owner_id": {"$in": [device_id, other_device]}})

    return passed, failed


async def run_all():
    total_passed = 0
    total_failed = 0

    # Sync tests
    p, f = test_intent_detection()
    total_passed += p
    total_failed += f

    p, f = test_artefact_extraction()
    total_passed += p
    total_failed += f

    # Async tests
    p, f = await test_pipeline_submission()
    total_passed += p
    total_failed += f

    print(f"\n{'=' * 60}")
    print(f"HIGGINS PIPELINE ROUTING: {total_passed}/{total_passed + total_failed} passed")
    print(f"{'=' * 60}")
    return total_passed, total_failed


if __name__ == "__main__":
    p, f = asyncio.run(run_all())
    sys.exit(0 if f == 0 else 1)
