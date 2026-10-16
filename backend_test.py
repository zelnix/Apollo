#!/usr/bin/env python3
"""Backend API tests for TASK 1 and TASK 2 changes."""
import sys
import requests
import json
from datetime import datetime, timezone

# Backend URL
BACKEND_URL = "http://localhost:8001"

def test_backend_health():
    """Test backend health endpoint."""
    print("Testing backend health...")
    response = requests.get(f"{BACKEND_URL}/api/health")
    assert response.status_code == 200, f"Health check failed: {response.status_code}"
    data = response.json()
    assert data["status"] == "ok", f"Health status not ok: {data}"
    assert data["service"] == "apollo-v1", f"Service name mismatch: {data}"
    print("✅ Backend health check passed")
    return True

def test_investigation_projector_imports():
    """Test that investigation_projector imports correctly."""
    print("\nTesting investigation_projector imports...")
    try:
        from services.investigation_projector import project_committed_cases, _extract_indicators
        print("✅ investigation_projector imports successfully")
        return True
    except Exception as e:
        print(f"❌ investigation_projector import failed: {e}")
        return False

def test_extract_indicators():
    """Test _extract_indicators with mock data."""
    print("\nTesting _extract_indicators...")
    try:
        from services.investigation_projector import _extract_indicators
        
        class MockFinding:
            def __init__(self, text):
                self.text = text
        
        class MockAction:
            def __init__(self, instruction):
                self.instruction = instruction
        
        class MockResponse:
            def __init__(self):
                self.overview = 'This email from support@paypa1-verify.com claims to be from PayPal and asks you to verify your account'
                self.scope = 'Email investigation: suspicious login alert from fake-paypal.com'
                self.findings = [
                    MockFinding('The domain paypa1-verify.com is not owned by PayPal'),
                    MockFinding('The sender is posing as PayPal customer support')
                ]
                self.actions = [MockAction('Do not click any links in this email')]
        
        result = _extract_indicators(MockResponse(), 'text')
        print(f"  indicator_host: {result['indicator_host']}")
        print(f"  claimed_brand: {result['claimed_brand']}")
        print(f"  scenario: {result['scenario']}")
        
        assert result['indicator_host'] is not None, 'Should extract a domain'
        assert result['claimed_brand'] is not None, 'Should extract PayPal as claimed brand'
        assert 'paypa1-verify.com' in result['indicator_host'].lower() or 'fake-paypal.com' in result['indicator_host'].lower(), f"Expected domain in indicator_host, got: {result['indicator_host']}"
        
        print("✅ _extract_indicators test passed")
        return True
    except Exception as e:
        print(f"❌ _extract_indicators test failed: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_patrol_records_effective_reason():
    """Test patrol_records _effective returns human-readable reason."""
    print("\nTesting patrol_records _effective reason...")
    try:
        from services.patrol_records import _effective, PatrolEventIn
        
        # Test with investigation_case_id
        e = PatrolEventIn(
            event_id='test12345', 
            device_id='device123456', 
            category='message', 
            state='barking', 
            status='active',
            headline='Suspicious email', 
            what_happened='Test investigation', 
            why=[], 
            what_to_do='Review',
            adapter_label='test_adapter',
            occurred_at=datetime.now(timezone.utc), 
            investigation_case_id='case123'
        )
        state, reason = _effective(e, False)
        print(f"  With investigation_case_id: state={state}, reason={reason}")
        
        assert 'server_projection' not in reason, f'Should not contain internal code, got: {reason}'
        assert 'investigation' in reason.lower() or 'magnum' in reason.lower(), f'Should mention investigation, got: {reason}'
        
        # Test without investigation_case_id
        e2 = PatrolEventIn(
            event_id='test12346', 
            device_id='device123456', 
            category='message', 
            state='barking', 
            status='active',
            headline='Suspicious email', 
            what_happened='Test assessment', 
            why=[], 
            what_to_do='Review',
            adapter_label='test_adapter',
            occurred_at=datetime.now(timezone.utc)
        )
        state2, reason2 = _effective(e2, False)
        print(f"  Without investigation_case_id: state={state2}, reason={reason2}")
        
        assert 'server_projection' not in reason2, f'Should not contain internal code, got: {reason2}'
        assert 'assessment' in reason2.lower() or 'apollo' in reason2.lower(), f'Should mention assessment, got: {reason2}'
        
        print("✅ patrol_records _effective test passed")
        return True
    except Exception as e:
        print(f"❌ patrol_records _effective test failed: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_patrol_router_imports():
    """Test that patrol router imports correctly."""
    print("\nTesting patrol router imports...")
    try:
        from routers.patrol import router
        print("✅ patrol router imports successfully")
        return True
    except Exception as e:
        print(f"❌ patrol router import failed: {e}")
        return False

def main():
    """Run all backend tests."""
    print("=" * 60)
    print("BACKEND API TESTS - TASK 1 & TASK 2")
    print("=" * 60)
    
    results = []
    
    # Test 1: Backend health
    results.append(("Backend Health", test_backend_health()))
    
    # Test 2: Investigation projector imports
    results.append(("Investigation Projector Imports", test_investigation_projector_imports()))
    
    # Test 3: Extract indicators
    results.append(("Extract Indicators", test_extract_indicators()))
    
    # Test 4: Patrol records effective reason
    results.append(("Patrol Records Effective Reason", test_patrol_records_effective_reason()))
    
    # Test 5: Patrol router imports
    results.append(("Patrol Router Imports", test_patrol_router_imports()))
    
    # Summary
    print("\n" + "=" * 60)
    print("TEST SUMMARY")
    print("=" * 60)
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for name, result in results:
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{status}: {name}")
    
    print(f"\nTotal: {passed}/{total} tests passed")
    
    if passed == total:
        print("\n🎉 All tests passed!")
        return 0
    else:
        print(f"\n⚠️  {total - passed} test(s) failed")
        return 1

if __name__ == "__main__":
    sys.exit(main())
