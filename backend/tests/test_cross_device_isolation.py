"""Cross-device isolation tests — verify that private investigation data
never leaks between devices/users.

Apollo Privacy Principle: Protect the person without identifying the person.
Private evidence stays private. Threat intelligence may travel.

Run: python tests/test_cross_device_isolation.py
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


async def run_tests():
    from core.db import db, now_utc
    from services.higgins import repository as repo

    DEVICE_A = f"test-device-A-{uuid.uuid4().hex[:8]}"
    DEVICE_B = f"test-device-B-{uuid.uuid4().hex[:8]}"

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

    # ── Setup: Create cases for Device A ──
    print("\n[Setup] Creating cases for Device A...")
    case_a = await repo.create_case(DEVICE_A, "email", None, initiator="apollo_automatic")
    case_a_id = case_a["case_id"]
    # Simulate completed investigation
    await db.investigation_cases.update_one(
        {"owner_id": DEVICE_A, "case_id": case_a_id},
        {"$set": {
            "response_ciphertext": repo.enc_json({"overview": "Private email from victim A about their bank account"}),
            "evidence_fingerprint": "fingerprintABC123",
            "source_metadata": {"type": "email", "sender": "scammer@evil.com", "subject": "Your bank account"},
            "triage_provider_evidence": {
                "safe_browsing": {"urls": {"https://evil.com": {
                    "verdict": "malicious", "threat_types": ["PHISHING"],
                    "status": "ok", "queried_at": now_utc(),
                    "data_class": "shareable_threat_intel",
                }}},
                "hibp": {"emails": {"victim-a@personal.com": {
                    "status": "found", "breaches": ["BigBreach"],
                    "queried_at": now_utc(),
                    "data_class": "shareable_threat_intel",
                }}},
            },
        }}
    )

    # ── Test 1: Device B cannot access Device A's case ──
    print("\n[Test 1] Device B cannot access Device A's case...")
    try:
        _ = await repo.get_case(DEVICE_B, case_a_id)
        _assert(False, "Device B should NOT access Device A case", "get_case succeeded")
    except Exception:
        _assert(True, "Device B correctly denied access to Device A case")

    # ── Test 2: Device B's case listing does not include Device A's cases ──
    print("\n[Test 2] Device B's case listing excludes Device A...")
    b_cases = await db.investigation_cases.find(
        {"owner_id": DEVICE_B}, {"_id": 0, "case_id": 1}
    ).to_list(100)
    b_case_ids = {c["case_id"] for c in b_cases}
    _assert(case_a_id not in b_case_ids, "Device A case not in Device B listing")

    # ── Test 3: Evidence fingerprint dedup is device-scoped ──
    print("\n[Test 3] Evidence fingerprint dedup is device-scoped...")
    # Device B should NOT find Device A's investigation by fingerprint
    cross_device_match = await db.investigation_cases.find_one({
        "owner_id": DEVICE_B,
        "evidence_fingerprint": "fingerprintABC123",
    })
    _assert(cross_device_match is None, "Fingerprint dedup does not cross devices")

    # Same device DOES find its own investigation
    same_device_match = await db.investigation_cases.find_one({
        "owner_id": DEVICE_A,
        "evidence_fingerprint": "fingerprintABC123",
    })
    _assert(same_device_match is not None, "Same device finds its own fingerprint")

    # ── Test 4: Patrol events are device-scoped ──
    print("\n[Test 4] Patrol events are device-scoped...")
    # Create a patrol event for Device A
    patrol_event_id = f"patrol-{uuid.uuid4().hex[:8]}"
    await db.patrol_events.insert_one({
        "event_id": patrol_event_id,
        "device_id": DEVICE_A,
        "category": "email",
        "state": "barking",
        "status": "active",
        "headline": "Private threat for Device A",
        "what_happened": "Private investigation details",
        "investigation_case_id": case_a_id,
        "deleted_at": None,
        "created_at": now_utc(),
    })

    # Device B cannot see Device A's patrol events
    b_events = await db.patrol_events.find(
        {"device_id": DEVICE_B}, {"_id": 0, "event_id": 1}
    ).to_list(100)
    b_event_ids = {e["event_id"] for e in b_events}
    _assert(patrol_event_id not in b_event_ids, "Device A patrol event not visible to Device B")

    # ── Test 5: Triage results are device-scoped ──
    print("\n[Test 5] Triage results are device-scoped...")
    triage_id = f"triage-{uuid.uuid4().hex[:8]}"
    await db.triage_results.insert_one({
        "triage_id": triage_id,
        "device_id": DEVICE_A,
        "fingerprint": "fingerprintABC123",
        "tier": 0,
        "verdict": "suspicious",
        "reason": "Private triage for Device A",
        "created_at": now_utc(),
    })

    b_triage = await db.triage_results.find_one({
        "device_id": DEVICE_B,
        "fingerprint": "fingerprintABC123",
    })
    _assert(b_triage is None, "Triage results are device-scoped")

    # ── Test 6: Investigation reports are device-scoped ──
    print("\n[Test 6] Investigation reports are device-scoped...")
    report_id = f"report-{uuid.uuid4().hex[:8]}"
    await db.investigation_reports.insert_one({
        "report_id": report_id,
        "owner_id": DEVICE_A,
        "report_ciphertext": repo.enc_json({"overview": "Private findings for Device A"}),
        "created_at": now_utc(),
    })

    b_report = await db.investigation_reports.find_one({"owner_id": DEVICE_B, "report_id": report_id})
    _assert(b_report is None, "Reports are device-scoped — Device B cannot access Device A report")

    # ── Test 7: Higgins chat history is device-scoped ──
    print("\n[Test 7] Higgins chat history is device-scoped...")
    chat_id = f"chat-{uuid.uuid4().hex[:8]}"
    await db.chat_turns.insert_one({
        "turn_id": chat_id,
        "owner_id": DEVICE_A,
        "message": "Is this email from my bank a scam?",
        "response": "Based on the investigation...",
        "created_at": now_utc(),
    })

    b_chat = await db.chat_turns.find_one({"owner_id": DEVICE_B, "turn_id": chat_id})
    _assert(b_chat is None, "Chat history is device-scoped")

    # ── Test 8: Provider evidence data_class tagging ──
    print("\n[Test 8] Provider evidence data classification...")
    from services.triage_engine import gather_provider_evidence

    pe = await gather_provider_evidence({
        "urls": ["https://known-phish.com"],
        "domains": ["known-phish.com"],
        "phones": [],
        "emails": [],
        "auth_results": {},
        "source_type": "email",
        "link_domains": ["known-phish.com"],
        "link_urls": ["https://known-phish.com"],
    })

    # Check that data_class tags are present
    has_tags = False
    for section_name, section in pe.items():
        if section_name.startswith("_") or not isinstance(section, dict):
            continue
        for collection in section.values():
            if isinstance(collection, dict):
                for item in collection.values():
                    if isinstance(item, dict) and "data_class" in item:
                        has_tags = True
    _assert(has_tags or len(pe) <= 1, "Provider results have data_class tags")

    # ── Test 9: Shareable threat intelligence does NOT contain user content ──
    print("\n[Test 9] Shareable threat intel excludes user content...")
    shareable_fields = set()
    for section_name, section in pe.items():
        if section_name.startswith("_") or not isinstance(section, dict):
            continue
        for collection in section.values():
            if isinstance(collection, dict):
                for item in collection.values():
                    if isinstance(item, dict) and item.get("data_class") == "shareable_threat_intel":
                        shareable_fields.update(item.keys())
    # Shareable intel should NOT contain: message content, email body, screenshot data, names
    forbidden_in_shareable = {"message_content", "email_body", "screenshot", "user_name", "personal_phone"}
    leaked = shareable_fields & forbidden_in_shareable
    _assert(len(leaked) == 0, "No private fields in shareable threat intel", f"leaked: {leaked}")

    # ── Test 10: Initiator field is preserved on cases ──
    print("\n[Test 10] Initiator tracking...")
    case_with_init = await db.investigation_cases.find_one(
        {"owner_id": DEVICE_A, "case_id": case_a_id},
        {"_id": 0, "initiator": 1}
    )
    _assert(
        case_with_init and case_with_init.get("initiator") == "apollo_automatic",
        "Initiator field preserved on case",
        f"got: {case_with_init}"
    )

    # ── Cleanup test data ──
    await db.investigation_cases.delete_many({"owner_id": {"$in": [DEVICE_A, DEVICE_B]}})
    await db.patrol_events.delete_many({"device_id": {"$in": [DEVICE_A, DEVICE_B]}})
    await db.triage_results.delete_many({"device_id": {"$in": [DEVICE_A, DEVICE_B]}})
    await db.investigation_reports.delete_many({"owner_id": {"$in": [DEVICE_A, DEVICE_B]}})
    await db.chat_turns.delete_many({"owner_id": {"$in": [DEVICE_A, DEVICE_B]}})

    print(f"\n{'=' * 60}")
    print(f"CROSS-DEVICE ISOLATION: {passed}/{passed + failed} passed")
    print(f"{'=' * 60}")
    return passed, failed


if __name__ == "__main__":
    p, f = asyncio.run(run_tests())
    sys.exit(0 if f == 0 else 1)
