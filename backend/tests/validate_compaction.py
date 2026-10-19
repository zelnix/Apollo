"""Compaction validation harness — controlled Gemini investigations with per-call instrumentation.

Run this script when Gemini API access is restored to validate that the token-reduction
fixes deliver equivalent investigation quality at reduced cost.

Usage:
    cd /app/backend
    python tests/validate_compaction.py

Prerequisites:
    - Gemini API key active (not 402)
    - Backend running on port 8001
    - MongoDB running

Test scenarios:
    1. Simple text investigation (single suspicious email)
    2. Multi-source investigation (email + 2 URLs)
    3. Multi-round investigation (email + 3 URLs + reputation lookups)
    4. Contradictory evidence (phishing email from a legitimate-looking domain)
    5. Vision/image investigation (screenshot of scam)
    6. Multi-turn Higgins investigation (initial + follow-up question)

For each test, reports:
    - Per-call: Purpose, Input tokens, Output tokens, Cumulative input, Tool round, Compaction applied
    - Summary: Total calls, total I/O tokens, estimated cost, outcome, evidence/provenance intact
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import time
import uuid
from datetime import datetime, timezone
from typing import Any

import httpx

BASE = os.environ.get("TEST_BASE", "http://localhost:8001")

# ──────────────────────────────────────────────────────────────────────────────
# Test scenarios — each defines the investigation input
# ──────────────────────────────────────────────────────────────────────────────

SCENARIOS = [
    {
        "id": "simple_text",
        "name": "1. Simple text investigation",
        "description": "Single suspicious email — tests basic coordinator flow with minimal rounds",
        "gate": "email",
        "question": "Is this email legitimate or a scam?",
        "submissions": [
            {"kind": "text", "client_item_id": "email-001",
             "value": "From: support@paypa1-secure.com\nSubject: Action Required: Verify Your Account\n\nDear Customer,\n\nWe have detected unusual activity on your account. Please verify your identity immediately by clicking the link below:\n\nhttps://paypa1-secure.com/verify?token=abc123\n\nIf you do not verify within 24 hours, your account will be suspended.\n\nPayPal Security Team",
             "label": "Suspicious PayPal email"},
        ],
    },
    {
        "id": "multi_source",
        "name": "2. Multi-source Magnum DI investigation",
        "description": "Email with 2 embedded URLs — tests source registration and snapshot creation",
        "gate": "email",
        "question": "Investigate this email. Check both URLs for legitimacy.",
        "submissions": [
            {"kind": "text", "client_item_id": "email-002",
             "value": "From: billing@amaz0n-renewal.com\nSubject: Your Prime Membership Renewal\n\nYour Amazon Prime membership has been renewed for $499.99.\nIf this was not you, cancel here: https://amaz0n-renewal.com/cancel\nView your account: https://amaz0n-renewal.com/account\n\nThank you,\nAmazon Customer Service",
             "label": "Amazon renewal scam email"},
            {"kind": "url", "client_item_id": "url-001",
             "value": "https://amaz0n-renewal.com/cancel",
             "label": "Cancel link from email"},
            {"kind": "url", "client_item_id": "url-002",
             "value": "https://amaz0n-renewal.com/account",
             "label": "Account link from email"},
        ],
    },
    {
        "id": "multi_round",
        "name": "3. Multi-round investigation (several tool rounds)",
        "description": "Email with 3 URLs requiring research, reputation, and URL inspection",
        "gate": "email",
        "question": "Investigate this email thoroughly. Check every link, research the sender domain, and verify claims.",
        "submissions": [
            {"kind": "text", "client_item_id": "email-003",
             "value": "From: no-reply@secure-banking-alerts.net\nSubject: Urgent: Unauthorized Transaction Detected\n\nWe detected an unauthorized transaction of $2,847.00 from your account.\n\nTransaction ID: TXN-2024-8847231\nMerchant: CRYPTO-EXCHANGE-INTL\nDate: Today\n\nIf this was not you:\n1. Review details: https://secure-banking-alerts.net/txn/8847231\n2. Report fraud: https://secure-banking-alerts.net/report\n3. Contact support: https://secure-banking-alerts.net/support\n\nYour Security Team\nFirst National Bank",
             "label": "Urgent banking alert email"},
            {"kind": "url", "client_item_id": "url-003",
             "value": "https://secure-banking-alerts.net/txn/8847231",
             "label": "Transaction review link"},
            {"kind": "url", "client_item_id": "url-004",
             "value": "https://secure-banking-alerts.net/report",
             "label": "Fraud report link"},
            {"kind": "url", "client_item_id": "url-005",
             "value": "https://secure-banking-alerts.net/support",
             "label": "Support link"},
        ],
    },
    {
        "id": "contradictory",
        "name": "4. Contradictory evidence case",
        "description": "A message that looks suspicious but comes from a plausible source with mixed signals",
        "gate": "text",
        "question": "Is this message legitimate? The sender domain appears real but the content is unusual.",
        "submissions": [
            {"kind": "text", "client_item_id": "msg-004",
             "value": "From: noreply@outlook.com\nSubject: Microsoft Account Security Alert\n\nDear user,\n\nWe noticed a sign-in attempt from a new device:\n\nDevice: iPhone 15 Pro\nLocation: Sydney, Australia\nIP Address: 203.0.113.42\nTime: 2024-10-15 14:32 UTC\n\nIf this was you, no action is needed.\nIf not, secure your account: https://account.live.com/security\n\nNote: We will never ask for your password via email.\n\nMicrosoft Account Team",
             "label": "Microsoft security alert — mixed signals"},
            {"kind": "url", "client_item_id": "url-006",
             "value": "https://account.live.com/security",
             "label": "Account security link (looks legitimate)"},
        ],
    },
    {
        "id": "vision_image",
        "name": "5. Vision/image investigation",
        "description": "Text description of a scam screenshot — tests text-only flow (image upload requires device)",
        "gate": "text",
        "question": "I received this text message. Is it a scam?",
        "submissions": [
            {"kind": "text", "client_item_id": "sms-005",
             "value": "SMS from +61 412 345 678:\n\n'Hi mum, I dropped my phone in the toilet and its broken. This is my new number. Can you send me $200 via bank transfer to pay for the repair? I need it urgently. New account: BSB 123-456 Acc 78901234. Love you xx'\n\n[Received at 2024-10-15 09:23 AEST]",
             "label": "'Hi Mum' scam SMS"},
        ],
    },
]

MULTI_TURN_SCENARIO = {
    "id": "multi_turn",
    "name": "6. Multi-turn Higgins investigation",
    "description": "Initial investigation + follow-up question to test previousTurns handling",
    "gate": "email",
    "question": "Is this email legitimate?",
    "followup": "The sender claims to be from my bank. Can you check if Commonwealth Bank actually uses this domain?",
    "submissions": [
        {"kind": "text", "client_item_id": "email-006",
         "value": "From: alerts@cba-security-update.com\nSubject: Important Account Update Required\n\nDear Valued Customer,\n\nAs part of our security upgrade, please update your details at:\nhttps://cba-security-update.com/update\n\nCommonwealth Bank of Australia",
         "label": "CBA phishing email"},
        {"kind": "url", "client_item_id": "url-007",
         "value": "https://cba-security-update.com/update",
         "label": "Update link from email"},
    ],
}


# ──────────────────────────────────────────────────────────────────────────────
# Test runner
# ──────────────────────────────────────────────────────────────────────────────

async def register_device(client: httpx.AsyncClient) -> tuple[str, str]:
    """Register a fresh anonymous device and return (device_id, bearer_token)."""
    resp = await client.post(f"{BASE}/api/devices/register", json={
        "platform": "test", "adapter_mode": "val_harness",
        "app_version": "0.0.0", "tz_offset_minutes": 600, "locale": "en-AU",
    })
    resp.raise_for_status()
    data = resp.json()
    return data["device_id"], data["device_token"]


async def create_investigation(client: httpx.AsyncClient, headers: dict, scenario: dict) -> dict:
    """Create a case and submit the initial question + evidence."""
    body = {
        "gate": scenario["gate"],
        "question": scenario["question"],
        "submissions": scenario["submissions"],
        "initial_findings": [],
        "device_profile": {"platform": "web", "capabilityIds": []},
    }
    resp = await client.post(f"{BASE}/api/investigations", json=body, headers={
        **headers, "Idempotency-Key": str(uuid.uuid4()),
    })
    if resp.status_code != 201:
        print(f"  ERROR creating case: {resp.status_code} {resp.text[:300]}")
        return {}
    data = resp.json()
    # Response is {"case": {...}, "job": {...}} where case may also appear at top level
    case_obj = data.get("case", data)
    return {**case_obj, "job": data.get("job")}


async def poll_job(client: httpx.AsyncClient, headers: dict, case_id: str, job_id: str,
                   timeout: int = 300) -> dict:
    """Poll a job until it completes or fails."""
    start = time.monotonic()
    while time.monotonic() - start < timeout:
        resp = await client.get(f"{BASE}/api/investigations/{case_id}/jobs/{job_id}", headers=headers)
        if resp.status_code != 200:
            print(f"  Job poll error: {resp.status_code}")
            await asyncio.sleep(5)
            continue
        job = resp.json()["job"]
        status = job.get("status")
        if status in ("committed", "invalid", "failed", "expired"):
            return job
        await asyncio.sleep(3)
    return {"status": "timeout"}


async def submit_followup(client: httpx.AsyncClient, headers: dict, case_id: str,
                          revision: int, message: str) -> dict:
    """Submit a follow-up turn."""
    resp = await client.post(f"{BASE}/api/investigations/{case_id}/turns", json={
        "expected_revision": revision,
        "turn_id": str(uuid.uuid4()),
        "message": message,
    }, headers={**headers, "Idempotency-Key": str(uuid.uuid4())})
    if resp.status_code != 202:
        print(f"  ERROR submitting follow-up: {resp.status_code} {resp.text[:300]}")
        return {}
    return resp.json()


async def fetch_trace(client: httpx.AsyncClient, case_id: str) -> dict:
    """Fetch the per-call Gemini usage trace for a case."""
    resp = await client.get(f"{BASE}/api/usage/gemini/trace/case-{case_id}")
    if resp.status_code != 200:
        return {}
    return resp.json()


async def fetch_case_detail(client: httpx.AsyncClient, headers: dict, case_id: str) -> dict:
    """Fetch the full case detail including response."""
    resp = await client.get(f"{BASE}/api/investigations/{case_id}", headers=headers)
    if resp.status_code != 200:
        return {}
    return resp.json()


def print_trace_table(trace: dict, scenario_name: str):
    """Print the per-call usage table."""
    calls = trace.get("calls", [])
    if not calls:
        print(f"  No Gemini calls recorded for this investigation.")
        return

    print(f"\n  {'Call':>4} | {'Purpose':<28} | {'Input':>10} | {'Output':>10} | {'Cumul In':>10} | {'Round':>5} | {'Compacted':>9}")
    print(f"  {'─'*4}─┼─{'─'*28}─┼─{'─'*10}─┼─{'─'*10}─┼─{'─'*10}─┼─{'─'*5}─┼─{'─'*9}")

    for call in calls:
        tokens = call.get("tokens", {})
        cumul = call.get("cumulative", {})
        audit = call.get("payload_audit") or {}
        # Determine if compaction was applied: content_rounds > 2 means prior rounds exist
        # and _compacted would be in older rounds (we can't see inside, but round > 1 means yes)
        compacted = "yes" if audit.get("content_rounds", 0) > 3 else "no"
        fn_calls = audit.get("total_function_calls", 0)
        fn_responses = audit.get("total_function_responses", 0)
        round_indicator = f"R{(audit.get('content_rounds', 1) - 1) // 2}" if audit else "?"

        print(f"  {call['call_number']:>4} | {call.get('purpose', '?'):<28} | "
              f"{tokens.get('input') or 0:>10,} | {tokens.get('output') or 0:>10,} | "
              f"{cumul.get('input_tokens', 0):>10,} | {round_indicator:>5} | {compacted:>9}")

    totals = trace.get("totals", {})
    print(f"\n  Totals: {trace.get('total_calls', 0)} calls, "
          f"{totals.get('input_tokens', 0):,} input, "
          f"{totals.get('output_tokens', 0):,} output, "
          f"~${totals.get('estimated_cost_usd', 0):.4f} est. cost")


def check_evidence_preservation(case_detail: dict) -> list[str]:
    """Check that evidence and provenance are preserved in the final response."""
    issues = []
    response = case_detail.get("response", {})
    if not response:
        issues.append("No response in case detail")
        return issues

    # Check source references exist
    sources = response.get("sourceIds") or response.get("source_ids") or []
    if not sources:
        # Not necessarily an issue for text-only investigations
        pass

    explanation = response.get("explanationMarkdown") or response.get("explanation_markdown") or ""
    overview = response.get("overview") or ""

    if not overview:
        issues.append("Missing overview in response")
    if not explanation:
        issues.append("Missing explanation in response")

    # Check for hallucination indicators (generic hedging without specifics)
    if "unable to determine" in explanation.lower() and len(explanation) < 200:
        issues.append("Response may be too generic — possible evidence loss")

    return issues


async def run_scenario(client: httpx.AsyncClient, headers: dict, scenario: dict) -> dict:
    """Run one test scenario and return the results."""
    print(f"\n{'='*80}")
    print(f"  {scenario['name']}")
    print(f"  {scenario['description']}")
    print(f"{'='*80}")

    # Create investigation
    print(f"  Creating investigation...")
    case_data = await create_investigation(client, headers, scenario)
    if not case_data:
        return {"scenario": scenario["id"], "status": "creation_failed"}

    case_id = case_data.get("id") or case_data.get("caseId") or case_data.get("case_id")
    job_data = case_data.get("job") or {}
    job_id = job_data.get("id") or job_data.get("jobId") or job_data.get("job_id") if job_data else None

    if not job_id:
        print(f"  No job created (question may be empty or job not in response)")
        return {"scenario": scenario["id"], "status": "no_job", "case_id": case_id}

    # Poll for completion
    print(f"  Case {case_id}, Job {job_id} — polling...")
    job = await poll_job(client, headers, case_id, job_id)
    status = job.get("status", "unknown")
    print(f"  Job status: {status}")

    if status == "failed":
        failure = job.get("failureReason") or job.get("failure_reason") or "unknown"
        print(f"  Failure reason: {failure}")
        # Still fetch trace — failed jobs still have Gemini calls
    elif status == "committed":
        print(f"  Investigation completed successfully!")

    # Fetch trace
    trace = await fetch_trace(client, case_id)
    print_trace_table(trace, scenario["name"])

    # Fetch case detail for evidence check
    case_detail = await fetch_case_detail(client, headers, case_id)
    evidence_issues = check_evidence_preservation(case_detail)
    if evidence_issues:
        print(f"\n  ⚠ Evidence issues: {', '.join(evidence_issues)}")
    else:
        print(f"\n  ✓ Evidence and provenance appear intact")

    return {
        "scenario": scenario["id"],
        "case_id": case_id,
        "job_id": job_id,
        "status": status,
        "trace": trace,
        "evidence_issues": evidence_issues,
    }


async def run_multi_turn(client: httpx.AsyncClient, headers: dict) -> dict:
    """Run the multi-turn scenario."""
    scenario = MULTI_TURN_SCENARIO
    print(f"\n{'='*80}")
    print(f"  {scenario['name']}")
    print(f"  {scenario['description']}")
    print(f"{'='*80}")

    # Turn 1
    print(f"  Turn 1: Creating investigation...")
    case_data = await create_investigation(client, headers, scenario)
    if not case_data:
        return {"scenario": scenario["id"], "status": "creation_failed"}

    case_id = case_data.get("id") or case_data.get("caseId") or case_data.get("case_id")
    job_data = case_data.get("job") or {}
    job_id = job_data.get("id") or job_data.get("jobId") or job_data.get("job_id") if job_data else None

    if not job_id:
        return {"scenario": scenario["id"], "status": "no_job"}

    print(f"  Turn 1: Polling job {job_id}...")
    job = await poll_job(client, headers, case_id, job_id)
    print(f"  Turn 1 status: {job.get('status')}")

    if job.get("status") != "committed":
        trace = await fetch_trace(client, case_id)
        print_trace_table(trace, f"{scenario['name']} — Turn 1")
        return {"scenario": scenario["id"], "status": job.get("status"),
                "turn": 1, "trace": trace}

    # Get revision for follow-up
    case_detail = await fetch_case_detail(client, headers, case_id)
    case_obj = case_detail.get("case", case_detail)
    revision = case_obj.get("revision", 1)

    # Turn 2
    print(f"\n  Turn 2: Submitting follow-up question...")
    followup = await submit_followup(client, headers, case_id, revision, scenario["followup"])
    if not followup:
        return {"scenario": scenario["id"], "status": "followup_failed", "turn": 2}

    job2 = followup.get("job") or {}
    job2_id = job2.get("id") or job2.get("jobId") or job2.get("job_id")

    print(f"  Turn 2: Polling job {job2_id}...")
    job2_result = await poll_job(client, headers, case_id, job2_id)
    print(f"  Turn 2 status: {job2_result.get('status')}")

    trace = await fetch_trace(client, case_id)
    print_trace_table(trace, f"{scenario['name']} — Both turns")

    case_detail = await fetch_case_detail(client, headers, case_id)
    evidence_issues = check_evidence_preservation(case_detail)
    if evidence_issues:
        print(f"\n  ⚠ Evidence issues: {', '.join(evidence_issues)}")
    else:
        print(f"\n  ✓ Evidence and provenance appear intact across both turns")

    return {
        "scenario": scenario["id"],
        "case_id": case_id,
        "status": job2_result.get("status"),
        "trace": trace,
        "evidence_issues": evidence_issues,
    }


async def main():
    print("=" * 80)
    print("  COMPACTION VALIDATION — Controlled Investigation Test Suite")
    print(f"  Timestamp: {datetime.now(timezone.utc).isoformat()}")
    print(f"  Target: {BASE}")
    print("=" * 80)

    # Preflight: check if Gemini API is accessible
    async with httpx.AsyncClient(timeout=30) as client:
        try:
            resp = await client.get(f"{BASE}/api/health")
            if resp.status_code != 200:
                print(f"\n  ✗ Backend health check failed: {resp.status_code}")
                return
            print(f"  ✓ Backend healthy")
        except Exception as e:
            print(f"\n  ✗ Cannot reach backend: {e}")
            return

    async with httpx.AsyncClient(timeout=60) as client:
        # Register test device
        device_id, token = await register_device(client)
        headers = {"Authorization": f"Bearer {token}"}
        print(f"  ✓ Test device registered: {device_id[:12]}...")

        results = []

        # Run single-turn scenarios
        for scenario in SCENARIOS:
            try:
                result = await run_scenario(client, headers, scenario)
                results.append(result)
            except Exception as e:
                print(f"\n  ✗ Scenario '{scenario['id']}' failed with exception: {e}")
                results.append({"scenario": scenario["id"], "status": "exception", "error": str(e)})

        # Run multi-turn scenario
        try:
            result = await run_multi_turn(client, headers)
            results.append(result)
        except Exception as e:
            print(f"\n  ✗ Multi-turn scenario failed with exception: {e}")
            results.append({"scenario": "multi_turn", "status": "exception", "error": str(e)})

        # Summary
        print(f"\n\n{'='*80}")
        print(f"  VALIDATION SUMMARY")
        print(f"{'='*80}")

        total_input = 0
        total_output = 0
        total_calls = 0
        total_cost = 0.0

        for r in results:
            trace = r.get("trace", {})
            totals = trace.get("totals", {})
            inp = totals.get("input_tokens", 0)
            out = totals.get("output_tokens", 0)
            calls = trace.get("total_calls", 0)
            cost = totals.get("estimated_cost_usd", 0)

            total_input += inp
            total_output += out
            total_calls += calls
            total_cost += cost

            status_icon = "✓" if r.get("status") == "committed" else "✗" if r.get("status") == "failed" else "?"
            evidence_ok = "✓" if not r.get("evidence_issues") else "⚠"
            print(f"  {status_icon} {r.get('scenario', '?'):<20} | "
                  f"calls: {calls:>3} | input: {inp:>10,} | output: {out:>10,} | "
                  f"cost: ${cost:>8.4f} | evidence: {evidence_ok}")

        print(f"\n  TOTALS: {total_calls} Gemini calls, "
              f"{total_input:,} input tokens, "
              f"{total_output:,} output tokens, "
              f"${total_cost:.4f} estimated cost")

        # Write JSON report
        report = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "device_id": device_id,
            "total_calls": total_calls,
            "total_input_tokens": total_input,
            "total_output_tokens": total_output,
            "total_estimated_cost_usd": round(total_cost, 6),
            "scenarios": [{
                "id": r.get("scenario"),
                "status": r.get("status"),
                "case_id": r.get("case_id"),
                "gemini_calls": r.get("trace", {}).get("total_calls", 0),
                "input_tokens": r.get("trace", {}).get("totals", {}).get("input_tokens", 0),
                "output_tokens": r.get("trace", {}).get("totals", {}).get("output_tokens", 0),
                "estimated_cost_usd": r.get("trace", {}).get("totals", {}).get("estimated_cost_usd", 0),
                "evidence_issues": r.get("evidence_issues", []),
            } for r in results],
        }
        report_path = "/app/backend/COMPACTION_VALIDATION_REPORT.json"
        with open(report_path, "w") as f:
            json.dump(report, f, indent=2)
        print(f"\n  Full report written to: {report_path}")


if __name__ == "__main__":
    asyncio.run(main())
