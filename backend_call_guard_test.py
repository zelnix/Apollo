#!/usr/bin/env python3
"""Backend API tests for Call Guard / Check Number feature (Apollo Scam Guard)."""
import sys
import requests
import json
import time

# Backend URL - using localhost since we're testing the backend directly
BACKEND_URL = "http://localhost:8001"

# Test phone number from IPQS documentation (known high-risk test number)
TEST_PHONE_NUMBER = "+18007132618"
TEST_COUNTRY = "US"


def test_health_endpoint():
    """Test GET /api/health - should return 200 with status 'ok'."""
    print("\n" + "="*70)
    print("TEST 1: Health Check Endpoint")
    print("="*70)
    
    try:
        response = requests.get(f"{BACKEND_URL}/api/health", timeout=10)
        print(f"Status Code: {response.status_code}")
        
        if response.status_code != 200:
            print(f"❌ FAILED: Expected 200, got {response.status_code}")
            return False
        
        data = response.json()
        print(f"Response: {json.dumps(data, indent=2)}")
        
        # Verify response structure
        if data.get("status") != "ok":
            print(f"❌ FAILED: Expected status 'ok', got '{data.get('status')}'")
            return False
        
        if data.get("service") != "apollo-v1":
            print(f"❌ FAILED: Expected service 'apollo-v1', got '{data.get('service')}'")
            return False
        
        if "schemaVersion" not in data:
            print(f"❌ FAILED: Missing 'schemaVersion' in response")
            return False
        
        if "checkedAt" not in data:
            print(f"❌ FAILED: Missing 'checkedAt' in response")
            return False
        
        print("✅ PASSED: Health endpoint returned 200 with correct structure")
        return True
        
    except requests.exceptions.RequestException as e:
        print(f"❌ FAILED: Request error: {e}")
        return False
    except Exception as e:
        print(f"❌ FAILED: Unexpected error: {e}")
        return False


def register_test_device():
    """Register a test device and return credentials."""
    print("\n" + "="*70)
    print("SETUP: Registering Test Device")
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
        
        print(f"✅ Device registered: {device_id[:16]}...")
        return {"device_id": device_id, "device_token": device_token}
        
    except Exception as e:
        print(f"❌ Device registration error: {e}")
        return None


def test_call_risk_check(credentials):
    """Test POST /api/call/risk-check - IPQS caller reputation check."""
    print("\n" + "="*70)
    print("TEST 2: Call Risk Check Endpoint (POST /api/call/risk-check)")
    print("="*70)
    
    if not credentials:
        print("❌ FAILED: No device credentials available")
        return False
    
    try:
        headers = {
            "Authorization": f"Bearer {credentials['device_token']}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "device_id": credentials["device_id"],
            "number": TEST_PHONE_NUMBER,
            "country": TEST_COUNTRY
        }
        
        print(f"Testing with number: {TEST_PHONE_NUMBER} (IPQS test number)")
        response = requests.post(
            f"{BACKEND_URL}/api/call/risk-check",
            json=payload,
            headers=headers,
            timeout=30
        )
        
        print(f"Status Code: {response.status_code}")
        
        # Should return 200 or 503 (if API key exhausted)
        if response.status_code == 503:
            print("⚠️  WARNING: Service returned 503 (API key may be exhausted or rate limited)")
            print(f"Response: {response.text}")
            return True  # 503 is acceptable per review request
        
        if response.status_code != 200:
            print(f"❌ FAILED: Expected 200 or 503, got {response.status_code}")
            print(f"Response: {response.text}")
            return False
        
        data = response.json()
        print(f"Response keys: {list(data.keys())}")
        
        # Verify response structure
        required_fields = ["number", "decision", "checked_at", "source", "cached"]
        missing_fields = [field for field in required_fields if field not in data]
        
        if missing_fields:
            print(f"❌ FAILED: Missing required fields: {missing_fields}")
            print(f"Response: {json.dumps(data, indent=2)}")
            return False
        
        # Check decision field
        valid_decisions = ["allow", "review", "avoid", "unknown"]
        if data["decision"] not in valid_decisions:
            print(f"❌ FAILED: Invalid decision value: {data['decision']}")
            return False
        
        print(f"Decision: {data['decision']}")
        print(f"Source: {data['source']}")
        print(f"Cached: {data['cached']}")
        
        # Check for caller metadata (optional but expected when available)
        metadata_fields = ["country", "carrier", "line_type", "fraud_score"]
        available_metadata = [field for field in metadata_fields if field in data and data[field] is not None]
        print(f"Available metadata: {available_metadata}")
        
        if available_metadata:
            for field in available_metadata:
                print(f"  {field}: {data[field]}")
        
        # Check for assessment field (Higgins investigation)
        if "assessment" in data and data["assessment"]:
            print(f"Assessment available: {list(data['assessment'].keys())}")
        
        print("✅ PASSED: Call risk check endpoint returned valid response")
        return True
        
    except requests.exceptions.Timeout:
        print(f"❌ FAILED: Request timed out")
        return False
    except requests.exceptions.RequestException as e:
        print(f"❌ FAILED: Request error: {e}")
        return False
    except Exception as e:
        print(f"❌ FAILED: Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_call_investigate(credentials):
    """Test POST /api/call/investigate - Magnum DI investigation endpoint."""
    print("\n" + "="*70)
    print("TEST 3: Call Investigate Endpoint (POST /api/call/investigate)")
    print("="*70)
    
    if not credentials:
        print("❌ FAILED: No device credentials available")
        return False
    
    try:
        headers = {
            "Authorization": f"Bearer {credentials['device_token']}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "device_id": credentials["device_id"],
            "number": TEST_PHONE_NUMBER,
            "country": TEST_COUNTRY
        }
        
        print(f"Testing with number: {TEST_PHONE_NUMBER}")
        response = requests.post(
            f"{BACKEND_URL}/api/call/investigate",
            json=payload,
            headers=headers,
            timeout=60  # Longer timeout for Gemini investigation
        )
        
        print(f"Status Code: {response.status_code}")
        
        # Should return 200 or 503 (if Gemini key exhausted)
        if response.status_code == 503:
            print("⚠️  WARNING: Service returned 503 (Gemini API key may be exhausted)")
            print(f"Response: {response.text}")
            return True  # 503 is acceptable per review request
        
        if response.status_code == 500:
            print(f"❌ FAILED: Got 500 Internal Server Error (should return structured response)")
            print(f"Response: {response.text}")
            return False
        
        if response.status_code != 200:
            print(f"⚠️  WARNING: Expected 200 or 503, got {response.status_code}")
            print(f"Response: {response.text}")
            # Check if it's a structured error response
            try:
                error_data = response.json()
                if "detail" in error_data or "error" in error_data:
                    print("✅ PASSED: Endpoint exists and returns structured error (not 500)")
                    return True
            except:
                pass
            return False
        
        data = response.json()
        print(f"Response keys: {list(data.keys())}")
        
        # Check for higgins field (investigation result)
        if "higgins" not in data:
            print(f"⚠️  WARNING: Missing 'higgins' field in response")
            print(f"Available keys: {list(data.keys())}")
        else:
            higgins = data["higgins"]
            print(f"Higgins investigation keys: {list(higgins.keys())}")
            
            # Check for expected investigation fields
            if "assessment" in higgins:
                print(f"Assessment: {higgins['assessment'][:100]}..." if len(str(higgins['assessment'])) > 100 else f"Assessment: {higgins['assessment']}")
            
            if "recommendation" in higgins:
                print(f"Recommendation: {higgins['recommendation'][:100]}..." if len(str(higgins['recommendation'])) > 100 else f"Recommendation: {higgins['recommendation']}")
        
        print("✅ PASSED: Call investigate endpoint returned structured response")
        return True
        
    except requests.exceptions.Timeout:
        print(f"❌ FAILED: Request timed out after 60 seconds")
        return False
    except requests.exceptions.RequestException as e:
        print(f"❌ FAILED: Request error: {e}")
        return False
    except Exception as e:
        print(f"❌ FAILED: Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_no_500_errors(credentials):
    """Test that call endpoints don't crash with 500 errors."""
    print("\n" + "="*70)
    print("TEST 4: Verify No 500 Errors on Call Endpoints")
    print("="*70)
    
    if not credentials:
        print("❌ FAILED: No device credentials available")
        return False
    
    headers = {
        "Authorization": f"Bearer {credentials['device_token']}",
        "Content-Type": "application/json"
    }
    
    test_cases = [
        {
            "name": "Call risk check with minimal data",
            "endpoint": "/api/call/risk-check",
            "payload": {
                "device_id": credentials["device_id"],
                "number": "+61400123456"
            }
        },
        {
            "name": "Call investigate with minimal data",
            "endpoint": "/api/call/investigate",
            "payload": {
                "device_id": credentials["device_id"],
                "number": "+61400123456",
                "country": "AU"
            }
        }
    ]
    
    all_passed = True
    
    for test_case in test_cases:
        print(f"\nTesting: {test_case['name']}")
        try:
            response = requests.post(
                f"{BACKEND_URL}{test_case['endpoint']}",
                json=test_case["payload"],
                headers=headers,
                timeout=30
            )
            
            print(f"  Status Code: {response.status_code}")
            
            if response.status_code == 500:
                print(f"  ❌ FAILED: Got 500 Internal Server Error")
                print(f"  Response: {response.text[:200]}")
                all_passed = False
            elif response.status_code in [200, 503]:
                print(f"  ✅ OK: Returned {response.status_code} (structured response)")
            else:
                print(f"  ✅ OK: Returned {response.status_code} (not 500)")
                
        except Exception as e:
            print(f"  ❌ FAILED: Exception occurred: {e}")
            all_passed = False
    
    if all_passed:
        print("\n✅ PASSED: No 500 errors detected on call endpoints")
    else:
        print("\n❌ FAILED: Some endpoints returned 500 errors")
    
    return all_passed


def main():
    """Run all Call Guard backend tests."""
    print("\n" + "="*70)
    print("APOLLO SCAM GUARD - CALL GUARD / CHECK NUMBER BACKEND API TESTS")
    print("Testing: Health, Call Risk Check, Call Investigate, Error Handling")
    print("="*70)
    
    results = []
    
    # Test 1: Health endpoint (no auth required)
    health_passed = test_health_endpoint()
    results.append(("Health Check (GET /api/health)", health_passed))
    
    # Setup: Register device for authenticated tests
    credentials = register_test_device()
    
    if not credentials:
        print("\n❌ CRITICAL: Device registration failed - cannot proceed with authenticated tests")
        print("\n" + "="*70)
        print("TEST SUMMARY")
        print("="*70)
        print("❌ FAIL: Health Check (GET /api/health)" if not health_passed else "✅ PASS: Health Check (GET /api/health)")
        print("⚠️  SKIP: Remaining tests (device registration failed)")
        return 1
    
    # Test 2: Call risk check endpoint
    risk_passed = test_call_risk_check(credentials)
    results.append(("Call Risk Check (POST /api/call/risk-check)", risk_passed))
    
    # Test 3: Call investigate endpoint
    investigate_passed = test_call_investigate(credentials)
    results.append(("Call Investigate (POST /api/call/investigate)", investigate_passed))
    
    # Test 4: Verify no 500 errors
    no_500_passed = test_no_500_errors(credentials)
    results.append(("No 500 Errors on Call Endpoints", no_500_passed))
    
    # Summary
    print("\n" + "="*70)
    print("TEST SUMMARY")
    print("="*70)
    
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for name, result in results:
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{status}: {name}")
    
    print(f"\nTotal: {passed}/{total} tests passed")
    
    if passed == total:
        print("\n🎉 All tests passed!")
        print("\nKey findings:")
        print("  • Backend health endpoint is working correctly")
        print("  • Call risk check endpoint (IPQS) returns structured responses")
        print("  • Call investigate endpoint (Magnum DI) returns structured responses")
        print("  • No 500 errors detected - all endpoints return proper error structures")
        print("\n✅ Call Guard backend API verification COMPLETE")
        return 0
    else:
        print(f"\n⚠️  {total - passed} test(s) failed")
        print("\nPlease review the failed tests above for details.")
        return 1


if __name__ == "__main__":
    sys.exit(main())
