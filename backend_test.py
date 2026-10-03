#!/usr/bin/env python3
"""
Backend API test for push notification frontend restoration verification.
Tests push registration endpoints and family routes to ensure no regression.
"""
import os
import sys
import json
import requests
from dotenv import load_dotenv

# Load environment variables
load_dotenv("/app/backend/.env")
load_dotenv("/app/frontend/.env")

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"

def test_backend_health():
    """Test 1: Backend health endpoint"""
    print("\n=== Test 1: Backend Health ===")
    r = requests.get(f"{API}/health")
    assert r.status_code == 200, f"Health check failed: {r.status_code} {r.text}"
    data = r.json()
    assert data["status"] == "ok", f"Health status not ok: {data}"
    assert data["schemaVersion"] == 1, f"Schema version mismatch: {data}"
    print(f"✅ Backend health: {json.dumps(data, indent=2)}")
    return True

def register_device():
    """Helper: Register a device and return device_id and token"""
    print("\n=== Registering Device ===")
    r = requests.post(
        f"{API}/devices/register",
        json={
            "platform": "android",
            "adapter_mode": "web",
            "app_version": "1.1.0"
        }
    )
    assert r.status_code in (200, 201), f"Device registration failed: {r.status_code} {r.text}"
    data = r.json()
    device_id = data["device_id"]
    device_token = data["device_token"]
    print(f"✅ Device registered: device_id={device_id[:20]}...")
    return device_id, device_token

def test_push_registration_status(device_token):
    """Test 2: Push registration status (should show not configured)"""
    print("\n=== Test 2: Push Registration Status ===")
    r = requests.get(
        f"{API}/push/registration",
        headers={"Authorization": f"Bearer {device_token}"}
    )
    assert r.status_code == 200, f"Push registration status failed: {r.status_code} {r.text}"
    data = r.json()
    print(f"Push registration status: {json.dumps(data, indent=2)}")
    
    # Expected: push not configured yet (EXPO_PUSH_ENABLED not set)
    assert data["configured"] == False, f"Push should not be configured: {data}"
    assert data["registered"] == False, f"Push should not be registered: {data}"
    print("✅ Push registration status correct (not configured as expected)")
    return True

def test_push_register_endpoint(device_token):
    """Test 3: POST /api/register-push (should return 503 - push not enabled)"""
    print("\n=== Test 3: Push Register Endpoint ===")
    r = requests.post(
        f"{API}/register-push",
        json={
            "platform": "android",
            "provider": "expo",
            "projectId": "47cd97c4-e5a6-41fa-9fde-257a5de031af",
            "device_token": "ExponentPushToken[test123]"
        },
        headers={"Authorization": f"Bearer {device_token}"}
    )
    
    # Expected: 503 because EXPO_PUSH_ENABLED is not set in backend .env
    if r.status_code == 503:
        data = r.json()
        assert "Expo push configuration" in data.get("detail", ""), f"Expected push config error: {data}"
        print(f"✅ Push register correctly returns 503: {data['detail']}")
    elif r.status_code == 201:
        # If push is actually configured, that's also valid
        print(f"✅ Push register succeeded (push is configured): {r.json()}")
    else:
        raise AssertionError(f"Unexpected status code: {r.status_code} {r.text}")
    
    return True

def test_family_guardians(device_id, device_token):
    """Test 4: Family guardians endpoint (should return empty list)"""
    print("\n=== Test 4: Family Guardians Endpoint ===")
    r = requests.get(
        f"{API}/family/guardians",
        params={"device_id": device_id},
        headers={"Authorization": f"Bearer {device_token}"}
    )
    assert r.status_code == 200, f"Family guardians failed: {r.status_code} {r.text}"
    data = r.json()
    assert isinstance(data, list), f"Expected list, got: {type(data)}"
    print(f"✅ Family guardians: {len(data)} guardians (empty list as expected)")
    return True

def test_family_links(device_id, device_token):
    """Test 5: Family links endpoint (should return valid response)"""
    print("\n=== Test 5: Family Links Endpoint ===")
    r = requests.get(
        f"{API}/family/links",
        params={"device_id": device_id},
        headers={"Authorization": f"Bearer {device_token}"}
    )
    assert r.status_code == 200, f"Family links failed: {r.status_code} {r.text}"
    data = r.json()
    assert "i_watch" in data, f"Expected 'i_watch' key: {data}"
    assert "watching_me" in data, f"Expected 'watching_me' key: {data}"
    assert isinstance(data["i_watch"], list), f"Expected list for i_watch: {data}"
    print(f"✅ Family links: {json.dumps(data, indent=2)}")
    return True

def main():
    """Run all tests"""
    print("=" * 70)
    print("Backend API Test Suite - Push Notification Frontend Restoration")
    print("=" * 70)
    
    try:
        # Test 1: Backend health
        test_backend_health()
        
        # Register a device for authenticated tests
        device_id, device_token = register_device()
        
        # Test 2: Push registration status
        test_push_registration_status(device_token)
        
        # Test 3: Push register endpoint
        test_push_register_endpoint(device_token)
        
        # Test 4: Family guardians (no regression)
        test_family_guardians(device_id, device_token)
        
        # Test 5: Family links (no regression)
        test_family_links(device_id, device_token)
        
        print("\n" + "=" * 70)
        print("✅ ALL TESTS PASSED")
        print("=" * 70)
        return 0
        
    except AssertionError as e:
        print(f"\n❌ TEST FAILED: {e}")
        return 1
    except Exception as e:
        print(f"\n❌ UNEXPECTED ERROR: {e}")
        import traceback
        traceback.print_exc()
        return 1

if __name__ == "__main__":
    sys.exit(main())
