#!/usr/bin/env python3
"""Test for 'Mark as contained' fix - resolved biting events should show effectiveState: 'resolved'."""
import sys
import requests
import json
import time
from datetime import datetime, timezone

BACKEND_URL = "http://localhost:8001"

def register_device():
    """Register a test device and return credentials."""
    print("\n" + "="*70)
    print("STEP 1: Register Device")
    print("="*70)
    
    try:
        response = requests.post(
            f"{BACKEND_URL}/api/devices/register",
            json={
                "platform": "web",
                "adapter_mode": "mock",
                "app_version": "test-1.0.0"
            },
            timeout=10
        )
        
        if response.status_code != 201:
            print(f"❌ Device registration failed: {response.status_code}")
            print(f"Response: {response.text}")
            return None
        
        data = response.json()
        device_id = data.get("device_id")
        device_token = data.get("device_token")
        
        if not device_id or not device_token:
            print(f"❌ Missing device_id or device_token in response")
            return None
        
        print(f"✅ Device registered: {device_id}")
        return {"device_id": device_id, "device_token": device_token}
        
    except Exception as e:
        print(f"❌ Device registration error: {e}")
        return None


def create_biting_event(credentials):
    """Create a biting (blocked) event with verified enforcement evidence."""
    print("\n" + "="*70)
    print("STEP 2: Create Biting (Blocked) Event")
    print("="*70)
    
    if not credentials:
        print("❌ No credentials available")
        return None
    
    try:
        headers = {
            "Authorization": f"Bearer {credentials['device_token']}",
            "Content-Type": "application/json"
        }
        
        event_id = f"test-biting-event-{int(time.time())}"
        occurred_at = datetime.now(timezone.utc).isoformat()
        
        # Create a biting event with verified enforcement evidence
        payload = {
            "event_id": event_id,
            "device_id": credentials["device_id"],
            "category": "website",
            "state": "biting",
            "status": "blocked",
            "headline": "Blocked phishing site",
            "what_happened": "Apollo blocked access to a suspected phishing website",
            "what_to_do": "The site has been blocked. You're safe.",
            "indicator_host": "malicious-phishing-site.example.com",
            "indicator_digest": f"test-digest-{int(time.time())}",
            "scenario": "phishing",
            "claimed_brand": "TestBank",
            "adapter_label": "android_guarddog",
            "occurred_at": occurred_at,
            "background": False,
            "enforcement_evidence": {
                "evidence_id": f"ev{int(time.time())}",
                "device_id": credentials["device_id"],
                "platform": "android",  # Required for dns_filter
                "mechanism": "dns_filter",
                "direction": "outbound",  # Required for dns_filter
                "protocol": "dns",  # Required for dns_filter
                "destination_domain": "malicious-phishing-site.example.com",
                "destination_port": 53,  # Required for dns_filter
                "matched_rule_id": "cloud_intel:phishing:12345",
                "requested_action": "block",
                "enforced_action": "blocked",
                "result": "verified",
                "rule_source": "cloud_intel",
                "confidence": "high",
                "observed_at": occurred_at
            }
        }
        
        print(f"Creating biting event: {event_id}")
        print(f"  State: {payload['state']}")
        print(f"  Status: {payload['status']}")
        print(f"  Enforcement mechanism: {payload['enforcement_evidence']['mechanism']}")
        print(f"  Platform: {payload['enforcement_evidence']['platform']}")
        print(f"  Direction: {payload['enforcement_evidence']['direction']}")
        print(f"  Protocol: {payload['enforcement_evidence']['protocol']}")
        print(f"  Port: {payload['enforcement_evidence']['destination_port']}")
        
        response = requests.post(
            f"{BACKEND_URL}/api/patrol/events",
            json=payload,
            headers=headers,
            timeout=30
        )
        
        print(f"Status Code: {response.status_code}")
        
        if response.status_code != 200:
            print(f"❌ Failed to create biting event: {response.status_code}")
            print(f"Response: {response.text}")
            return None
        
        data = response.json()
        print(f"✅ Biting event created successfully")
        print(f"  Event ID: {data.get('event_id')}")
        print(f"  State: {data.get('state')}")
        print(f"  Status: {data.get('status')}")
        print(f"  Verified Block: {data.get('verified_block')}")
        
        return event_id
        
    except Exception as e:
        print(f"❌ Error creating biting event: {e}")
        import traceback
        traceback.print_exc()
        return None


def verify_patrol_record_blocked(credentials, event_id):
    """Verify the patrol record shows effectiveState: 'blocked'."""
    print("\n" + "="*70)
    print("STEP 3: Verify Patrol Record Shows 'blocked'")
    print("="*70)
    
    if not credentials or not event_id:
        print("❌ Missing credentials or event_id")
        return False
    
    try:
        headers = {
            "Authorization": f"Bearer {credentials['device_token']}",
        }
        
        # Wait a moment for the record to be created
        time.sleep(1)
        
        response = requests.get(
            f"{BACKEND_URL}/api/patrol/records",
            headers=headers,
            timeout=10
        )
        
        print(f"Status Code: {response.status_code}")
        
        if response.status_code != 200:
            print(f"❌ Failed to get patrol records: {response.status_code}")
            print(f"Response: {response.text}")
            return False
        
        records = response.json()
        print(f"Number of patrol records: {len(records)}")
        
        # Find the record for our event
        matching_record = None
        for record in records:
            if record.get("sourceEventId") == event_id:
                matching_record = record
                break
        
        if not matching_record:
            print(f"❌ Could not find patrol record for event {event_id}")
            print(f"Available records: {[r.get('sourceEventId') for r in records]}")
            return False
        
        effective_state = matching_record.get("effectiveState")
        raw_state = matching_record.get("rawState")
        resolution_status = matching_record.get("resolution", {}).get("status")
        
        print(f"✅ Found patrol record:")
        print(f"  Record ID: {matching_record.get('recordId')}")
        print(f"  Raw State: {raw_state}")
        print(f"  Effective State: {effective_state}")
        print(f"  Resolution Status: {resolution_status}")
        print(f"  Effective Reason: {matching_record.get('effectiveReason')}")
        
        if effective_state != "blocked":
            print(f"❌ FAILED: Expected effectiveState 'blocked', got '{effective_state}'")
            return False
        
        print(f"✅ PASSED: Patrol record shows effectiveState: 'blocked' as expected")
        return True
        
    except Exception as e:
        print(f"❌ Error verifying patrol record: {e}")
        import traceback
        traceback.print_exc()
        return False


def resolve_event(credentials, event_id):
    """Resolve the event by marking it as contained."""
    print("\n" + "="*70)
    print("STEP 4: Resolve Event (Mark as Contained)")
    print("="*70)
    
    if not credentials or not event_id:
        print("❌ Missing credentials or event_id")
        return False
    
    try:
        headers = {
            "Authorization": f"Bearer {credentials['device_token']}",
            "Content-Type": "application/json"
        }
        
        resolved_at = datetime.now(timezone.utc).isoformat()
        
        # Resolve the event - client normalizes state to "barking" when resolving
        # (no enforcement evidence on resolution)
        payload = {
            "event_id": event_id,
            "device_id": credentials["device_id"],
            "category": "website",
            "state": "barking",  # Downgraded by client normalization
            "status": "resolved",
            "headline": "Blocked phishing site",
            "what_happened": "Apollo blocked access to a suspected phishing website",
            "what_to_do": "The site has been blocked. You're safe.",
            "indicator_host": "malicious-phishing-site.example.com",
            "indicator_digest": f"test-digest-{int(time.time())}",
            "scenario": "phishing",
            "claimed_brand": "TestBank",
            "adapter_label": "android_guarddog",
            "occurred_at": datetime.now(timezone.utc).isoformat(),
            "resolved_at": resolved_at,
            "background": False
            # NO enforcement_evidence on resolution
        }
        
        print(f"Resolving event: {event_id}")
        print(f"  State: {payload['state']} (downgraded from biting)")
        print(f"  Status: {payload['status']}")
        print(f"  Resolved At: {resolved_at}")
        print(f"  Enforcement Evidence: None (as expected on resolution)")
        
        response = requests.post(
            f"{BACKEND_URL}/api/patrol/events",
            json=payload,
            headers=headers,
            timeout=30
        )
        
        print(f"Status Code: {response.status_code}")
        
        if response.status_code != 200:
            print(f"❌ Failed to resolve event: {response.status_code}")
            print(f"Response: {response.text}")
            return False
        
        data = response.json()
        print(f"✅ Event resolved successfully")
        print(f"  Event ID: {data.get('event_id')}")
        print(f"  State: {data.get('state')}")
        print(f"  Status: {data.get('status')}")
        print(f"  Resolved At: {data.get('resolved_at')}")
        
        return True
        
    except Exception as e:
        print(f"❌ Error resolving event: {e}")
        import traceback
        traceback.print_exc()
        return False


def verify_patrol_record_resolved(credentials, event_id):
    """Verify the patrol record NOW shows effectiveState: 'resolved'."""
    print("\n" + "="*70)
    print("STEP 5: Verify Patrol Record NOW Shows 'resolved'")
    print("="*70)
    
    if not credentials or not event_id:
        print("❌ Missing credentials or event_id")
        return False
    
    try:
        headers = {
            "Authorization": f"Bearer {credentials['device_token']}",
        }
        
        # Wait a moment for the record to be updated
        time.sleep(1)
        
        response = requests.get(
            f"{BACKEND_URL}/api/patrol/records",
            headers=headers,
            timeout=10
        )
        
        print(f"Status Code: {response.status_code}")
        
        if response.status_code != 200:
            print(f"❌ Failed to get patrol records: {response.status_code}")
            print(f"Response: {response.text}")
            return False
        
        records = response.json()
        print(f"Number of patrol records: {len(records)}")
        
        # Find the record for our event
        matching_record = None
        for record in records:
            if record.get("sourceEventId") == event_id:
                matching_record = record
                break
        
        if not matching_record:
            print(f"❌ Could not find patrol record for event {event_id}")
            return False
        
        effective_state = matching_record.get("effectiveState")
        raw_state = matching_record.get("rawState")
        resolution_status = matching_record.get("resolution", {}).get("status")
        resolved_at = matching_record.get("resolution", {}).get("resolvedAt")
        
        print(f"✅ Found patrol record:")
        print(f"  Record ID: {matching_record.get('recordId')}")
        print(f"  Raw State: {raw_state}")
        print(f"  Effective State: {effective_state}")
        print(f"  Resolution Status: {resolution_status}")
        print(f"  Resolved At: {resolved_at}")
        print(f"  Effective Reason: {matching_record.get('effectiveReason')}")
        
        # THE KEY TEST: effectiveState should be "resolved", not "blocked"
        if effective_state != "resolved":
            print(f"❌ FAILED: Expected effectiveState 'resolved', got '{effective_state}'")
            print(f"\n🔍 ROOT CAUSE CHECK:")
            print(f"   This is the bug we're testing for!")
            print(f"   Before the fix: _effective() checked state=='biting' before status=='resolved'")
            print(f"   After the fix: _effective() checks status in {{'resolved', 'trusted'}} FIRST")
            print(f"   Current behavior: effectiveState is '{effective_state}' (should be 'resolved')")
            return False
        
        if resolution_status != "resolved":
            print(f"❌ FAILED: Expected resolution status 'resolved', got '{resolution_status}'")
            return False
        
        if not resolved_at:
            print(f"❌ FAILED: Expected resolved_at to be set")
            return False
        
        print(f"✅ PASSED: Patrol record NOW shows effectiveState: 'resolved' (bug is fixed!)")
        return True
        
    except Exception as e:
        print(f"❌ Error verifying resolved patrol record: {e}")
        import traceback
        traceback.print_exc()
        return False


def verify_event_in_events_list(credentials, event_id):
    """Verify the event in GET /api/patrol/events has status: 'resolved' and resolved_at set."""
    print("\n" + "="*70)
    print("STEP 6: Verify Event in Events List")
    print("="*70)
    
    if not credentials or not event_id:
        print("❌ Missing credentials or event_id")
        return False
    
    try:
        headers = {
            "Authorization": f"Bearer {credentials['device_token']}",
        }
        
        response = requests.get(
            f"{BACKEND_URL}/api/patrol/events",
            params={"device_id": credentials["device_id"]},
            headers=headers,
            timeout=10
        )
        
        print(f"Status Code: {response.status_code}")
        
        if response.status_code != 200:
            print(f"❌ Failed to get patrol events: {response.status_code}")
            print(f"Response: {response.text}")
            return False
        
        events = response.json()
        print(f"Number of patrol events: {len(events)}")
        
        # Find our event
        matching_event = None
        for event in events:
            if event.get("event_id") == event_id:
                matching_event = event
                break
        
        if not matching_event:
            print(f"❌ Could not find event {event_id}")
            return False
        
        status = matching_event.get("status")
        resolved_at = matching_event.get("resolved_at")
        state = matching_event.get("state")
        
        print(f"✅ Found event:")
        print(f"  Event ID: {matching_event.get('event_id')}")
        print(f"  State: {state}")
        print(f"  Status: {status}")
        print(f"  Resolved At: {resolved_at}")
        
        if status != "resolved":
            print(f"❌ FAILED: Expected status 'resolved', got '{status}'")
            return False
        
        if not resolved_at:
            print(f"❌ FAILED: Expected resolved_at to be set")
            return False
        
        print(f"✅ PASSED: Event has status: 'resolved' and resolved_at set")
        return True
        
    except Exception as e:
        print(f"❌ Error verifying event: {e}")
        import traceback
        traceback.print_exc()
        return False


def main():
    """Run the patrol resolved biting event test."""
    print("\n" + "="*80)
    print("TEST: 'Mark as Contained' Fix - Resolved Biting Events")
    print("="*80)
    print("\nTesting that resolved biting events show effectiveState: 'resolved'")
    print("(not 'blocked' as they did before the fix)")
    print("\nScenario:")
    print("  1. Register device")
    print("  2. Create biting (blocked) event with verified enforcement evidence")
    print("  3. Verify patrol record shows effectiveState: 'blocked'")
    print("  4. Resolve the event (mark as contained)")
    print("  5. Verify patrol record NOW shows effectiveState: 'resolved'")
    print("  6. Verify event in events list has status: 'resolved' and resolved_at set")
    
    results = []
    
    # Step 1: Register device
    credentials = register_device()
    if not credentials:
        print("\n❌ CRITICAL: Device registration failed")
        return 1
    
    # Step 2: Create biting event
    event_id = create_biting_event(credentials)
    if not event_id:
        print("\n❌ CRITICAL: Failed to create biting event")
        return 1
    
    # Step 3: Verify patrol record shows 'blocked'
    blocked_verified = verify_patrol_record_blocked(credentials, event_id)
    results.append(("Patrol record shows 'blocked' initially", blocked_verified))
    
    # Step 4: Resolve the event
    resolved = resolve_event(credentials, event_id)
    if not resolved:
        print("\n❌ CRITICAL: Failed to resolve event")
        return 1
    
    # Step 5: Verify patrol record NOW shows 'resolved'
    resolved_verified = verify_patrol_record_resolved(credentials, event_id)
    results.append(("Patrol record shows 'resolved' after resolution", resolved_verified))
    
    # Step 6: Verify event in events list
    event_verified = verify_event_in_events_list(credentials, event_id)
    results.append(("Event has status: 'resolved' and resolved_at set", event_verified))
    
    # Summary
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for name, result in results:
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{status}: {name}")
    
    print(f"\nTotal: {passed}/{total} tests passed")
    
    if passed == total:
        print("\n🎉 All tests passed!")
        print("\n✅ THE FIX IS WORKING CORRECTLY:")
        print("   • Resolved biting events now show effectiveState: 'resolved'")
        print("   • The _effective() function correctly prioritizes resolved/trusted status")
        print("   • 'Mark as contained' now persists correctly in patrol records")
        return 0
    else:
        print(f"\n⚠️  {total - passed} test(s) failed")
        print("\n❌ THE FIX MAY NOT BE WORKING:")
        print("   • Check if _effective() in patrol_records.py prioritizes status check")
        print("   • The status in {'resolved', 'trusted'} check should come BEFORE state == 'biting'")
        return 1


if __name__ == "__main__":
    sys.exit(main())
