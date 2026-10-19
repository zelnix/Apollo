"""Comprehensive triage engine tests — with specialist provider integration.

Tests all 5 stages:
  Stage 1: RDAP integration into Tier 0
  Stage 2: Redirect expansion into Tier 0
  Stage 3: IPQS into SMS Tier 0
  Stage 4: Scam intel feed into Tier 1
  Stage 5: Pre-gathered evidence for Magnum DI

No paid Gemini calls required — uses mock provider mode.
"""
import asyncio
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Force mock mode
os.environ.setdefault("APOLLO_PROVIDER_MODE", "mock")

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))


async def run_tests():
    from core.db import db, now_utc
    from services.triage_engine import (
        Tier, Verdict, TriageResult,
        compute_fingerprint,
        _tier0_screen,
        _extract_evidence_from_email,
        _extract_evidence_from_text,
        _build_triage_prompt,
        _match_scam_intel,
        triage_item,
        get_triage_stats,
        gather_provider_evidence,
        ensure_indexes,
        COLLECTION,
    )

    # Clean up any previous test data
    await db[COLLECTION].delete_many({"device_id": {"$regex": "^test-triage-"}})
    await ensure_indexes()

    passed = 0
    failed = 0
    total = 0

    def _assert(condition, name, detail=""):
        nonlocal passed, failed, total
        total += 1
        if condition:
            passed += 1
            print(f"  PASS: {name}")
        else:
            failed += 1
            print(f"  FAIL: {name} — {detail}")

    # ═══════════════════════════════════════════════════════════════════
    print("\n=== TEST 1: Fingerprint computation ===")
    # ═══════════════════════════════════════════════════════════════════
    
    ev1 = {"sender_domain": "example.com", "subject": "Your invoice", "link_domains": ["evil.com"], "auth_results": {"spf": "pass"}}
    ev2 = {"sender_domain": "example.com", "subject": "Your invoice", "link_domains": ["evil.com"], "auth_results": {"spf": "pass"}}
    ev3 = {"sender_domain": "other.com", "subject": "Your invoice", "link_domains": ["evil.com"], "auth_results": {"spf": "pass"}}

    fp1 = compute_fingerprint(ev1)
    fp2 = compute_fingerprint(ev2)
    fp3 = compute_fingerprint(ev3)

    _assert(fp1 == fp2, "Identical evidence produces same fingerprint")
    _assert(fp1 != fp3, "Different sender produces different fingerprint")
    _assert(len(fp1) == 64, "Fingerprint is SHA-256 hex", f"got length {len(fp1)}")

    ev_re = {"sender_domain": "example.com", "subject": "Re: Your invoice", "link_domains": [], "auth_results": {}}
    ev_plain = {"sender_domain": "example.com", "subject": "Your invoice", "link_domains": [], "auth_results": {}}
    _assert(compute_fingerprint(ev_re) == compute_fingerprint(ev_plain), 
            "Re: prefix stripped for fingerprint normalization")

    # ═══════════════════════════════════════════════════════════════════
    print("\n=== TEST 2: Evidence extraction (email) ===")
    # ═══════════════════════════════════════════════════════════════════

    email_msg = {
        "from": "scammer@evil.org",
        "subject": "Urgent: Verify your account",
        "links": [{"href": "https://evil-bank.com/login", "text": "Verify now"}],
        "reply_to": "reply@different.org",
        "attachment_names": ["document.pdf", "payload.exe"],
        "auth_results": {"spf": "fail", "dkim": "pass", "dmarc": "fail"},
    }

    extracted = _extract_evidence_from_email(email_msg)
    _assert(extracted["sender_domain"] == "evil.org", "Sender domain extracted")
    _assert("evil-bank.com" in extracted["link_domains"], "Link domain extracted")
    _assert("https://evil-bank.com/login" in extracted["link_urls"], "Link URL preserved for redirect expansion")
    _assert(".exe" in extracted["attachment_extensions"], "Attachment extension extracted")

    # ═══════════════════════════════════════════════════════════════════
    print("\n=== TEST 3: Evidence extraction (SMS with phone) ===")
    # ═══════════════════════════════════════════════════════════════════

    sms_evidence = _extract_evidence_from_text("+61412345678", "Click https://scam.example.com to claim your prize!")
    _assert("scam.example.com" in sms_evidence["link_domains"], "SMS link domain extracted")
    _assert(sms_evidence["sender_phone"] == "+61412345678", "Sender phone preserved for IPQS")
    _assert("https://scam.example.com" in sms_evidence["link_urls"], "SMS link URL preserved for redirect expansion")

    # ═══════════════════════════════════════════════════════════════════
    print("\n=== STAGE 1: RDAP into Tier 0 ===")
    # ═══════════════════════════════════════════════════════════════════

    print("\n  --- TEST 4: Newly registered domain + suspicious findings → SUSPICIOUS ---")
    rdap_pe = {
        "rdap": {"domains": {"phish-bank.com": {
            "registrar": "NameCheap", "registration_date": "2026-10-15",
            "newly_registered": True, "country": "US", "status": "ok",
            "queried_at": "2026-10-18T00:00:00Z",
        }}},
        "_summary": {"providers_consulted": ["rdap"], "total_lookups": 1, "gathered_at": "2026-10-18T00:00:00Z"},
    }
    result = _tier0_screen(
        {"source_type": "email", "auth_results": {}, "attachment_extensions": []},
        ["The sender's email address (bank.com) and link destinations use different domains (phish-bank.com)."],
        rdap_pe,
    )
    _assert(result is not None, "Tier 0 resolved")
    _assert(result.verdict == Verdict.SUSPICIOUS, "Newly registered + suspicious → SUSPICIOUS")
    _assert("rdap" in result.providers_used, "RDAP tracked as contributing provider")
    _assert(result.cost_usd == 0.0, "Cost is $0 (RDAP is free)")

    print("\n  --- TEST 5: Newly registered domain alone → None (ambiguous, Tier 1) ---")
    result = _tier0_screen(
        {"source_type": "email", "auth_results": {}, "attachment_extensions": []},
        [],  # No suspicious findings
        rdap_pe,
    )
    _assert(result is None, "Newly registered alone → Tier 1 (not auto-SUSPICIOUS)")

    print("\n  --- TEST 6: RDAP unavailable → does NOT result in SAFE ---")
    rdap_unavail_pe = {
        "rdap": {"domains": {"mystery.com": {"status": "unavailable", "detail": "Timeout", "queried_at": "2026-10-18T00:00:00Z"}}},
        "_summary": {"providers_consulted": [], "total_lookups": 0, "gathered_at": "2026-10-18T00:00:00Z"},
    }
    result = _tier0_screen(
        {"source_type": "email", "auth_results": {}, "attachment_extensions": []},
        [],  # No findings
        rdap_unavail_pe,
    )
    _assert(result is None, "RDAP unavailable → Tier 1 (provider failure is NOT SAFE)")

    # ═══════════════════════════════════════════════════════════════════
    print("\n=== STAGE 2: Redirect expansion into Tier 0 ===")
    # ═══════════════════════════════════════════════════════════════════

    print("\n  --- TEST 7: Clean URL redirecting to malicious → SUSPICIOUS ---")
    redirect_pe = {
        "redirects": {"urls": {"https://short.url/abc": {
            "chain": ["https://short.url/abc", "https://evil-phish.com/login"],
            "final_url": "https://evil-phish.com/login", "hops": 1,
            "status": "ok", "queried_at": "2026-10-18T00:00:00Z",
        }}},
        "safe_browsing": {"urls": {"https://evil-phish.com/login": {
            "verdict": "malicious", "threat_types": ["SOCIAL_ENGINEERING"],
            "status": "ok", "queried_at": "2026-10-18T00:00:00Z",
            "via_redirect_from": "https://short.url/abc",
        }}},
        "_summary": {"providers_consulted": ["redirect_expansion", "safe_browsing"], "total_lookups": 2, "gathered_at": "2026-10-18T00:00:00Z"},
    }
    result = _tier0_screen(
        {"source_type": "email", "auth_results": {}, "attachment_extensions": []},
        [],  # Raw URL looked clean
        redirect_pe,
    )
    _assert(result is not None, "Redirect to malicious resolved at Tier 0")
    _assert(result.verdict == Verdict.SUSPICIOUS, "Redirect to malicious → SUSPICIOUS")
    _assert("redirect_expansion" in result.providers_used, "Redirect expansion tracked")
    _assert("safe_browsing" in result.providers_used, "Safe Browsing tracked")

    print("\n  --- TEST 8: Redirect chain to clean destination → no change ---")
    clean_redirect_pe = {
        "redirects": {"urls": {"https://short.url/xyz": {
            "chain": ["https://short.url/xyz", "https://legit-company.com/page"],
            "final_url": "https://legit-company.com/page", "hops": 1,
            "status": "ok", "queried_at": "2026-10-18T00:00:00Z",
        }}},
        "safe_browsing": {"urls": {"https://legit-company.com/page": {
            "verdict": "clean", "threat_types": [],
            "status": "ok", "queried_at": "2026-10-18T00:00:00Z",
        }}},
        "_summary": {"providers_consulted": ["redirect_expansion", "safe_browsing"], "total_lookups": 2, "gathered_at": "2026-10-18T00:00:00Z"},
    }
    result = _tier0_screen(
        {"source_type": "email", "auth_results": {}, "attachment_extensions": []},
        [],
        clean_redirect_pe,
    )
    _assert(result is not None, "Clean redirect resolved at Tier 0")
    _assert(result.verdict == Verdict.SAFE, "Clean redirect → SAFE")

    # ═══════════════════════════════════════════════════════════════════
    print("\n=== STAGE 3: IPQS into SMS Tier 0 ===")
    # ═══════════════════════════════════════════════════════════════════

    print("\n  --- TEST 9: High IPQS fraud score → SUSPICIOUS ---")
    ipqs_pe = {
        "ipqs": {"phones": {"+61400000000": {
            "fraud_score": 92, "recent_abuse": True, "voip": False,
            "carrier": "Telstra", "decision": "high_risk", "status": "ok",
            "queried_at": "2026-10-18T00:00:00Z",
        }}},
        "_summary": {"providers_consulted": ["ipqs"], "total_lookups": 1, "gathered_at": "2026-10-18T00:00:00Z"},
    }
    result = _tier0_screen(
        {"source_type": "text", "auth_results": {}, "attachment_extensions": []},
        ["The message contains one or more links requiring verification."],
        ipqs_pe,
    )
    _assert(result is not None, "High IPQS resolved at Tier 0")
    _assert(result.verdict == Verdict.SUSPICIOUS, "IPQS fraud_score 92 → SUSPICIOUS")
    _assert("ipqs" in result.providers_used, "IPQS tracked as provider")

    print("\n  --- TEST 10: Low IPQS fraud score → no auto-SUSPICIOUS ---")
    low_ipqs_pe = {
        "ipqs": {"phones": {"+61411111111": {
            "fraud_score": 20, "recent_abuse": False, "voip": False,
            "carrier": "Optus", "decision": "low_risk", "status": "ok",
            "queried_at": "2026-10-18T00:00:00Z",
        }}},
        "_summary": {"providers_consulted": ["ipqs"], "total_lookups": 1, "gathered_at": "2026-10-18T00:00:00Z"},
    }
    result = _tier0_screen(
        {"source_type": "text", "auth_results": {}, "attachment_extensions": []},
        [],
        low_ipqs_pe,
    )
    # No findings + low IPQS → SAFE at Tier 0
    _assert(result is not None and result.verdict == Verdict.SAFE, "Low IPQS + no findings → SAFE")

    # ═══════════════════════════════════════════════════════════════════
    print("\n=== STAGE 4: Scam intel feed into Tier 1 ===")
    # ═══════════════════════════════════════════════════════════════════

    print("\n  --- TEST 11: High-severity scam intel match → Tier 0 SUSPICIOUS ---")
    scam_pe = {
        "scam_intel": {"matches": [{
            "advisory_id": "scam-001",
            "title": "ATO tax refund SMS scam",
            "severity": "high",
            "scam_types": ["phishing"],
            "matched_on": "keyword: ato",
        }]},
        "_summary": {"providers_consulted": ["scam_intel"], "total_lookups": 1, "gathered_at": "2026-10-18T00:00:00Z"},
    }
    result = _tier0_screen(
        {"source_type": "text", "auth_results": {}, "attachment_extensions": []},
        ["The message contains urgency, account, credential or payment language worth checking."],
        scam_pe,
    )
    _assert(result is not None, "High-severity scam match resolved at Tier 0")
    _assert(result.verdict == Verdict.SUSPICIOUS, "Active scam advisory match → SUSPICIOUS")
    _assert("scam_intel" in result.providers_used, "Scam intel tracked")

    print("\n  --- TEST 12: Scam intel in Tier 1 prompt ---")
    prompt = _build_triage_prompt(
        {"sender_domain": "ato-refund.com", "subject": "Tax refund notification", "link_domains": ["ato-refund.com"], "auth_results": {}, "text_preview": ""},
        ["The message contains urgency, account, credential or payment language worth checking."],
        scam_pe,
    )
    _assert("ATO tax refund SMS scam" in prompt, "Scam advisory included in Tier 1 prompt")
    _assert("Specialist intelligence" in prompt, "Provider evidence section in prompt")

    # ═══════════════════════════════════════════════════════════════════
    print("\n=== STAGE 5: Pre-gathered evidence for Magnum DI ===")
    # ═══════════════════════════════════════════════════════════════════

    print("\n  --- TEST 13: Compact evidence summary format ---")
    full_pe = {
        "rdap": {"domains": {"phish.com": {
            "registrar": "NameCheap", "registration_date": "2026-10-10",
            "newly_registered": True, "country": "US", "status": "ok",
            "queried_at": "2026-10-18T09:00:00Z",
        }}},
        "safe_browsing": {"urls": {"https://phish.com/login": {
            "verdict": "malicious", "threat_types": ["SOCIAL_ENGINEERING"],
            "status": "ok", "queried_at": "2026-10-18T09:00:00Z",
        }}},
        "redirects": {"urls": {"https://short.ly/x": {
            "chain": ["https://short.ly/x", "https://phish.com/login"],
            "final_url": "https://phish.com/login", "hops": 1,
            "status": "ok", "queried_at": "2026-10-18T09:00:00Z",
        }}},
        "ipqs": {"phones": {"+61400000000": {
            "fraud_score": 95, "recent_abuse": True, "carrier": "Telstra",
            "status": "ok", "queried_at": "2026-10-18T09:00:00Z",
        }}},
        "scam_intel": {"matches": [{
            "advisory_id": "scam-001", "title": "ATO refund scam",
            "severity": "high", "matched_on": "domain: phish.com",
        }]},
    }
    tr = TriageResult(
        tier=Tier.AI_TRIAGE, verdict=Verdict.SUSPICIOUS,
        reason="Test", escalation_reason="Test escalation",
        provider_evidence=full_pe, providers_used=["rdap", "safe_browsing", "ipqs", "scam_intel"],
    )
    summary = tr.compact_evidence_for_magnum_di()
    _assert("Pre-gathered specialist intelligence" in summary, "Summary header present")
    _assert("phish.com" in summary, "RDAP domain in summary")
    _assert("NEWLY REGISTERED" in summary, "Newly registered flag in summary")
    _assert("SOCIAL_ENGINEERING" in summary, "Safe Browsing threat type in summary")
    _assert("redirects through" in summary, "Redirect chain in summary")
    _assert("fraud score 95" in summary, "IPQS fraud score in summary")
    _assert("ATO refund scam" in summary, "Scam intel match in summary")
    _assert("RDAP" in summary, "RDAP provenance attribution")
    _assert("2026-10-18" in summary, "Timestamp provenance")
    print(f"    Summary ({len(summary)} chars):\n{summary[:500]}")

    # ═══════════════════════════════════════════════════════════════════
    print("\n=== TEST 14: Full triage_item — Tier 0 SAFE path ===")
    # ═══════════════════════════════════════════════════════════════════

    device_safe = f"test-triage-safe-{uuid.uuid4().hex[:8]}"
    safe_result = await triage_item(
        device_id=device_safe,
        evidence={"sender_domain": "legit.com", "subject": "Newsletter", "link_domains": [], "link_urls": [],
                  "auth_results": {}, "source_type": "email", "attachment_extensions": [], "sender_phone": ""},
        findings=["Sender authentication (SPF/DKIM/DMARC): passed."],
        correlation_id="test-safe-001",
        provider_evidence={},  # Empty provider evidence (no links to check)
    )
    _assert(safe_result.tier == Tier.LOCAL, "Tier 0 path taken")
    _assert(safe_result.verdict == Verdict.SAFE, "Verdict SAFE")
    _assert(safe_result.cost_usd == 0.0, "No cost")
    _assert(not safe_result.should_escalate, "Should NOT escalate")
    _assert(safe_result.gemini_calls_prevented, "Gemini call prevented flag set")

    # ═══════════════════════════════════════════════════════════════════
    print("\n=== TEST 15: Full triage_item — Tier 1 (mock AI) ===")
    # ═══════════════════════════════════════════════════════════════════

    device_ai = f"test-triage-ai-{uuid.uuid4().hex[:8]}"
    ai_result = await triage_item(
        device_id=device_ai,
        evidence={"sender_domain": "paypal-verify.com", "subject": "Verify your account",
                  "link_domains": ["paypal-verify.com"], "link_urls": [],
                  "auth_results": {}, "source_type": "email", "attachment_extensions": [], "sender_phone": ""},
        findings=["The sender's email address (paypal.com) and link destinations use different domains (paypal-verify.com)."],
        correlation_id="test-ai-001",
        provider_evidence={},
    )
    _assert(ai_result.tier == Tier.AI_TRIAGE, "Tier 1 path taken")
    _assert(ai_result.verdict == Verdict.SUSPICIOUS, "Mock AI returns SUSPICIOUS")
    _assert(ai_result.should_escalate, "Should escalate to Magnum DI")
    _assert("gemini_triage" in ai_result.providers_used, "Gemini triage tracked as provider")

    # ═══════════════════════════════════════════════════════════════════
    print("\n=== TEST 16: Cache — hit on duplicate ===")
    # ═══════════════════════════════════════════════════════════════════

    device_cache = f"test-triage-cache-{uuid.uuid4().hex[:8]}"
    evidence_cache = {"sender_domain": "cached.com", "subject": "Cached test", "link_domains": [], "link_urls": [],
                      "auth_results": {}, "source_type": "email", "attachment_extensions": [], "sender_phone": ""}

    r1 = await triage_item(device_id=device_cache, evidence=evidence_cache,
        findings=["Sender authentication (SPF/DKIM/DMARC): passed."],
        correlation_id="test-cache-001", provider_evidence={})
    _assert(not r1.cached, "First call is not cached")

    r2 = await triage_item(device_id=device_cache, evidence=evidence_cache,
        findings=["Sender authentication (SPF/DKIM/DMARC): passed."],
        correlation_id="test-cache-002", provider_evidence={})
    _assert(r2.cached, "Second call is cached")
    _assert(r2.cost_usd == 0.0, "Cached result has $0 cost")

    # ═══════════════════════════════════════════════════════════════════
    print("\n=== TEST 17: Provider evidence reuse across tiers ===")
    # ═══════════════════════════════════════════════════════════════════

    # Provider evidence gathered once, flows to Tier 1 without re-querying
    device_reuse = f"test-triage-reuse-{uuid.uuid4().hex[:8]}"
    pre_gathered_pe = {
        "rdap": {"domains": {"suspicious.com": {
            "registrar": "Fly-by-night", "registration_date": "2026-10-17",
            "newly_registered": True, "status": "ok", "queried_at": "2026-10-18T00:00:00Z",
        }}},
        "_summary": {"providers_consulted": ["rdap"], "total_lookups": 1, "gathered_at": "2026-10-18T00:00:00Z"},
    }
    reuse_result = await triage_item(
        device_id=device_reuse,
        evidence={"sender_domain": "suspicious.com", "subject": "Important",
                  "link_domains": ["suspicious.com"], "link_urls": [],
                  "auth_results": {}, "source_type": "email", "attachment_extensions": [], "sender_phone": ""},
        findings=[],  # No findings, but newly registered → ambiguous → Tier 1
        correlation_id="test-reuse-001",
        provider_evidence=pre_gathered_pe,  # Pre-supplied, not re-gathered
    )
    # Should escalate to Tier 1 (newly registered alone is ambiguous)
    _assert(reuse_result.tier == Tier.AI_TRIAGE, "Ambiguous escalated to Tier 1")
    _assert("rdap" in reuse_result.providers_used, "RDAP from pre-gathered PE flows to Tier 1")

    # ═══════════════════════════════════════════════════════════════════
    print("\n=== TEST 18: Stats aggregation with provider tracking ===")
    # ═══════════════════════════════════════════════════════════════════

    stats = await get_triage_stats()
    _assert(stats["items_screened"] > 0, "Stats show screened items")
    _assert("provider_utilisation" in stats, "Stats include provider_utilisation")
    _assert("gemini_calls_prevented" in stats, "Stats include gemini_calls_prevented")

    # ═══════════════════════════════════════════════════════════════════
    print("\n=== TEST 19: wire() includes provider tracking ===")
    # ═══════════════════════════════════════════════════════════════════

    wire = ai_result.wire()
    _assert("providers_used" in wire, "Wire includes providers_used")
    _assert("gemini_calls_prevented" in wire, "Wire includes gemini_calls_prevented")

    # ═══════════════════════════════════════════════════════════════════
    # Cleanup
    # ═══════════════════════════════════════════════════════════════════
    await db[COLLECTION].delete_many({"device_id": {"$regex": "^test-triage-"}})

    print(f"\n{'='*60}")
    print(f"TRIAGE ENGINE TESTS: {passed}/{total} passed, {failed} failed")
    print(f"{'='*60}")
    return failed == 0


if __name__ == "__main__":
    success = asyncio.run(run_tests())
    sys.exit(0 if success else 1)
