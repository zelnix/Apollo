#!/usr/bin/env python3
"""
Backend API tests for Naming Consistency + Ears Up → Sniffing rename verification
Tests P1 backend requirements from the review request.
"""

import requests
import json

# Backend URL from frontend/.env
BACKEND_URL = "https://redaction-pipeline.preview.emergentagent.com"

def test_backend_health():
    """P1: GET /api/health should return 200 with status:ok"""
    print("\n=== Testing Backend Health ===")
    response = requests.get(f"{BACKEND_URL}/api/health")
    print(f"Status Code: {response.status_code}")
    
    assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    
    data = response.json()
    print(f"Response: {json.dumps(data, indent=2)}")
    
    assert data.get("status") == "ok", f"Expected status 'ok', got {data.get('status')}"
    assert data.get("service") == "apollo-v1", f"Expected service 'apollo-v1', got {data.get('service')}"
    assert data.get("schemaVersion") == 1, f"Expected schemaVersion 1, got {data.get('schemaVersion')}"
    
    print("✅ Backend health check PASSED")
    return True

def test_device_registration():
    """P1: POST /api/devices/register should work correctly"""
    print("\n=== Testing Device Registration ===")
    
    payload = {
        "platform": "web",
        "app_version": "1.0.0",
        "adapter_mode": "preview"
    }
    
    response = requests.post(
        f"{BACKEND_URL}/api/devices/register",
        json=payload,
        headers={"Content-Type": "application/json"}
    )
    
    print(f"Status Code: {response.status_code}")
    
    assert response.status_code == 201, f"Expected 201, got {response.status_code}"
    
    data = response.json()
    print(f"Response: {json.dumps(data, indent=2)}")
    
    assert "device_id" in data, "Response missing device_id"
    assert "device_token" in data, "Response missing device_token"
    assert data.get("registered") == True, "Expected registered=True"
    
    print("✅ Device registration PASSED")
    return data

def main():
    """Run all backend tests"""
    print("=" * 60)
    print("NAMING CONSISTENCY + EARS UP → SNIFFING RENAME")
    print("Backend API Verification Tests (P1)")
    print("=" * 60)
    
    try:
        # Test 1: Backend health
        test_backend_health()
        
        # Test 2: Device registration
        device_data = test_device_registration()
        
        print("\n" + "=" * 60)
        print("✅ ALL BACKEND TESTS PASSED")
        print("=" * 60)
        print("\nSummary:")
        print("  ✅ GET /api/health returns 200 with status:ok")
        print("  ✅ POST /api/devices/register returns 201 with device credentials")
        print("\nNote: These backend endpoints are unchanged by the naming consistency")
        print("      changes, which are purely frontend presentation updates.")
        
        return True
        
    except AssertionError as e:
        print(f"\n❌ TEST FAILED: {e}")
        return False
    except Exception as e:
        print(f"\n❌ UNEXPECTED ERROR: {e}")
        return False

if __name__ == "__main__":
    success = main()
    exit(0 if success else 1)
