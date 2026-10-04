"""Backend API tests for comprehensive security and automatic protection features.
Testing new features: Call Guard, Caller ID Database, VirusTotal integration.
"""
import requests
import sys

# Use the public backend URL from frontend/.env
BACKEND_URL = "https://apollo-patrol.preview.emergentagent.com/api"

def test_backend_health():
    """Test 1: Backend health endpoint."""
    print("\n=== Test 1: Backend Health ===")
    try:
        response = requests.get(f"{BACKEND_URL}/health", timeout=10)
        print(f"Status: {response.status_code}")
        print(f"Response: {response.json()}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert data.get("status") == "ok", f"Expected status 'ok', got {data.get('status')}"
        assert data.get("schemaVersion") == 1, f"Expected schemaVersion 1, got {data.get('schemaVersion')}"
        assert data.get("service") == "apollo-v1", f"Expected service 'apollo-v1', got {data.get('service')}"
        print("✅ Backend health check PASSED")
        return True
    except Exception as e:
        print(f"❌ Backend health check FAILED: {e}")
        return False


def register_device():
    """Register a test device and return the auth token."""
    try:
        payload = {
            "platform": "test",
            "adapter_mode": "preview",
            "app_version": "1.0.0"
        }
        response = requests.post(f"{BACKEND_URL}/devices/register", json=payload, timeout=10)
        if response.status_code == 201:
            data = response.json()
            return data.get("device_id"), data.get("device_token")
        else:
            print(f"Device registration failed with status {response.status_code}: {response.text}")
        return None, None
    except Exception as e:
        print(f"Device registration error: {e}")
        return None, None


def test_device_registration():
    """Test 2: Device registration."""
    print("\n=== Test 2: Device Registration ===")
    try:
        device_id, token = register_device()
        assert device_id is not None, "Device ID is None"
        assert token is not None, "Device token is None"
        print(f"Device ID: {device_id[:8]}...")
        print(f"Token: {token[:20]}...")
        print("✅ Device registration PASSED")
        return True, device_id, token
    except Exception as e:
        print(f"❌ Device registration FAILED: {e}")
        return False, None, None


def test_caller_id_db_count(token):
    """Test 3: Caller ID database count endpoint."""
    print("\n=== Test 3: Caller ID Database Count ===")
    try:
        headers = {"Authorization": f"Bearer {token}"}
        response = requests.get(f"{BACKEND_URL}/call/caller-id-db/count", headers=headers, timeout=10)
        print(f"Status: {response.status_code}")
        print(f"Response: {response.json()}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert "count" in data, "Response missing 'count' field"
        initial_count = data["count"]
        print(f"Initial count: {initial_count}")
        print("✅ Caller ID database count PASSED")
        return True, initial_count
    except Exception as e:
        print(f"❌ Caller ID database count FAILED: {e}")
        return False, 0


def test_caller_id_db_export(token):
    """Test 4: Caller ID database export endpoint."""
    print("\n=== Test 4: Caller ID Database Export ===")
    try:
        headers = {"Authorization": f"Bearer {token}"}
        response = requests.get(f"{BACKEND_URL}/call/caller-id-db/export", headers=headers, timeout=10)
        print(f"Status: {response.status_code}")
        data = response.json()
        print(f"Response keys: {data.keys()}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        assert "entries" in data, "Response missing 'entries' field"
        assert "count" in data, "Response missing 'count' field"
        print(f"Export count: {data['count']}")
        print(f"Entries: {len(data['entries'])}")
        print("✅ Caller ID database export PASSED")
        return True
    except Exception as e:
        print(f"❌ Caller ID database export FAILED: {e}")
        return False


def test_call_risk_check(device_id, token):
    """Test 5: Call risk check with IPQS test number."""
    print("\n=== Test 5: Call Risk Check (IPQS Test Number) ===")
    try:
        headers = {"Authorization": f"Bearer {token}"}
        # IPQS test number: +18007132618 (known high-risk, fraud_score=100)
        payload = {
            "device_id": device_id,
            "number": "+18007132618"
        }
        response = requests.post(f"{BACKEND_URL}/call/risk-check", json=payload, headers=headers, timeout=15)
        print(f"Status: {response.status_code}")
        data = response.json()
        print(f"Response keys: {data.keys()}")
        print(f"Decision: {data.get('decision')}")
        print(f"Fraud Score: {data.get('fraud_score')}")
        print(f"Country: {data.get('country')}")
        print(f"Carrier: {data.get('carrier')}")
        print(f"Line Type: {data.get('line_type')}")
        print(f"Recent Abuse: {data.get('recent_abuse')}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        assert "decision" in data, "Response missing 'decision' field"
        assert data.get("decision") == "avoid", f"Expected decision 'avoid' for test number, got {data.get('decision')}"
        assert data.get("fraud_score") == 100, f"Expected fraud_score 100, got {data.get('fraud_score')}"
        assert data.get("recent_abuse") == True, f"Expected recent_abuse True, got {data.get('recent_abuse')}"
        
        # Verify caller metadata fields are present
        assert "country" in data, "Response missing 'country' field"
        assert "carrier" in data, "Response missing 'carrier' field"
        assert "line_type" in data, "Response missing 'line_type' field"
        
        print("✅ Call risk check PASSED")
        return True
    except Exception as e:
        print(f"❌ Call risk check FAILED: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_caller_id_db_auto_ingest(token, initial_count):
    """Test 6: Verify caller ID database auto-ingestion after risk check."""
    print("\n=== Test 6: Caller ID Database Auto-Ingestion ===")
    try:
        headers = {"Authorization": f"Bearer {token}"}
        response = requests.get(f"{BACKEND_URL}/call/caller-id-db/count", headers=headers, timeout=10)
        print(f"Status: {response.status_code}")
        data = response.json()
        new_count = data["count"]
        print(f"Initial count: {initial_count}")
        print(f"New count: {new_count}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        assert new_count >= initial_count + 1, f"Expected count to increase by at least 1, got {new_count - initial_count}"
        print("✅ Caller ID database auto-ingestion PASSED")
        return True
    except Exception as e:
        print(f"❌ Caller ID database auto-ingestion FAILED: {e}")
        return False


def test_virustotal_integration():
    """Test 7: VirusTotal integration with EICAR test hash."""
    print("\n=== Test 7: VirusTotal Integration ===")
    try:
        sys.path.insert(0, '/app/backend')
        import asyncio
        from services.virustotal import lookup_hash
        
        async def test():
            # EICAR test file hash (known malware test file)
            eicar = '275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f'
            r1 = await lookup_hash(eicar, 'eicar.txt')
            print(f'EICAR: status={r1.status}, detections={r1.detection_count}/{r1.total_engines}')
            assert r1.status == 'malicious', f'Expected malicious, got {r1.status}'
            assert r1.detection_count > 0, f'Expected detection_count > 0, got {r1.detection_count}'
            
            # Unknown hash (should return status='unknown')
            r2 = await lookup_hash('0' * 64, 'fake.pdf')
            print(f'Unknown: status={r2.status}')
            assert r2.status == 'unknown', f'Expected unknown, got {r2.status}'
            
            print('✅ All VirusTotal tests passed!')
            return True
        
        result = asyncio.run(test())
        return result
    except Exception as e:
        print(f"❌ VirusTotal integration FAILED: {e}")
        import traceback
        traceback.print_exc()
        return False


def main():
    """Run all tests."""
    print("=" * 70)
    print("COMPREHENSIVE BACKEND TESTING - Call Guard & VirusTotal Integration")
    print("=" * 70)
    
    results = []
    
    # Test 1: Backend health
    results.append(("Backend Health", test_backend_health()))
    
    # Test 2: Device registration
    success, device_id, token = test_device_registration()
    results.append(("Device Registration", success))
    
    if not success or not token:
        print("\n⚠️  Cannot proceed with authenticated tests without device token")
        print_summary(results)
        return False
    
    # Test 3: Caller ID database count (before risk check)
    success, initial_count = test_caller_id_db_count(token)
    results.append(("Caller ID Database Count", success))
    
    # Test 4: Caller ID database export
    results.append(("Caller ID Database Export", test_caller_id_db_export(token)))
    
    # Test 5: Call risk check with IPQS test number
    results.append(("Call Risk Check (IPQS)", test_call_risk_check(device_id, token)))
    
    # Test 6: Verify auto-ingestion into caller ID database
    results.append(("Caller ID Auto-Ingestion", test_caller_id_db_auto_ingest(token, initial_count)))
    
    # Test 7: VirusTotal integration
    results.append(("VirusTotal Integration", test_virustotal_integration()))
    
    # Summary
    print_summary(results)
    
    return all(result for _, result in results)


def print_summary(results):
    """Print test summary."""
    print("\n" + "=" * 70)
    print("TEST SUMMARY")
    print("=" * 70)
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for name, result in results:
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{status}: {name}")
    
    print(f"\nTotal: {passed}/{total} tests passed")
    print("=" * 70)


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
