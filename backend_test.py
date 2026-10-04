#!/usr/bin/env python3
"""Backend API testing for Iteration 84 - Live Caller ID PIR, Email Gate, and Config Plugin validation."""

import requests
import json
import sys

# Backend URL from environment
BACKEND_URL = "https://apollo-patrol.preview.emergentagent.com/api"

def log(msg):
    print(f"[TEST] {msg}", flush=True)

def test_backend_health():
    """Test 1: Backend Health Endpoint"""
    log("Testing GET /api/health...")
    try:
        resp = requests.get(f"{BACKEND_URL}/health", timeout=10)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        data = resp.json()
        assert data.get("status") == "ok", f"Expected status 'ok', got {data.get('status')}"
        assert data.get("schemaVersion") == 1, f"Expected schemaVersion 1, got {data.get('schemaVersion')}"
        assert data.get("service") == "apollo-v1", f"Expected service 'apollo-v1', got {data.get('service')}"
        log("✅ Backend health endpoint working correctly")
        return True
    except Exception as e:
        log(f"❌ Backend health test failed: {e}")
        return False

def test_device_registration():
    """Test 2: Device Registration"""
    log("Testing POST /api/devices/register...")
    try:
        payload = {
            "platform": "ios",
            "adapter_mode": "native",
            "app_version": "1.0.0",
            "tz_offset_minutes": 600,
            "locale": "en-AU"
        }
        resp = requests.post(f"{BACKEND_URL}/devices/register", json=payload, timeout=10)
        assert resp.status_code == 201, f"Expected 201, got {resp.status_code}"
        data = resp.json()
        assert "device_id" in data, "Response missing device_id"
        assert "device_token" in data, "Response missing device_token"
        log(f"✅ Device registration successful: device_id={data['device_id'][:8]}...")
        return data["device_id"], data["device_token"]
    except Exception as e:
        log(f"❌ Device registration failed: {e}")
        return None, None

def test_caller_id_endpoints(device_id, token):
    """Test 3 & 4: Caller ID Database Endpoints"""
    headers = {"Authorization": f"Bearer {token}"}
    
    # Test count endpoint
    log("Testing GET /api/call/caller-id-db/count...")
    try:
        resp = requests.get(f"{BACKEND_URL}/call/caller-id-db/count", headers=headers, timeout=10)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        data = resp.json()
        assert "count" in data, "Response missing count field"
        count = data["count"]
        log(f"✅ Caller ID database count: {count}")
    except Exception as e:
        log(f"❌ Caller ID count endpoint failed: {e}")
        return False
    
    # Test export endpoint
    log("Testing GET /api/call/caller-id-db/export...")
    try:
        resp = requests.get(f"{BACKEND_URL}/call/caller-id-db/export", headers=headers, timeout=10)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        data = resp.json()
        assert "entries" in data, "Response missing entries field"
        assert "count" in data, "Response missing count field"
        assert isinstance(data["entries"], list), "entries should be a list"
        log(f"✅ Caller ID database export: {data['count']} entries")
        
        # Verify PIR format
        if data["entries"]:
            entry = data["entries"][0]
            assert "phoneNumber" in entry, "Entry missing phoneNumber"
            assert "label" in entry, "Entry missing label"
            assert "category" in entry, "Entry missing category"
            log(f"✅ PIR format validation passed (sample: {entry})")
        
        return True
    except Exception as e:
        log(f"❌ Caller ID export endpoint failed: {e}")
        return False

def test_mailbox_monitor_import():
    """Test 5: Email Gate Reporting Accuracy - Verify mailbox_monitor imports"""
    log("Testing mailbox_monitor module imports...")
    try:
        # Test that the module can be imported and has the required functions
        import sys
        sys.path.insert(0, '/app/backend')
        from services.mailbox_monitor import _submit_shared_case
        from services.intel import run_intel_check, sanitize_url
        log("✅ mailbox_monitor imports successfully (run_intel_check, sanitize_url)")
        log("✅ _submit_shared_case function exists (new findings logic)")
        
        # Verify the new findings logic is present in the code
        import inspect
        source = inspect.getsource(_submit_shared_case)
        
        # Check for coverage limitation reporting
        assert "Coverage limitation" in source, "Coverage limitation reporting not found"
        log("✅ Coverage limitation reporting found in _submit_shared_case")
        
        # Check for authentication disclaimer
        assert "authentication (SPF/DKIM/DMARC)" in source or "Sender authentication" in source, "Authentication disclaimer not found"
        log("✅ Authentication disclaimer found in _submit_shared_case")
        
        return True
    except ImportError as e:
        log(f"❌ mailbox_monitor import failed: {e}")
        return False
    except Exception as e:
        log(f"❌ mailbox_monitor test failed: {e}")
        return False

def main():
    log("=== Iteration 84 Backend Testing ===")
    log(f"Backend URL: {BACKEND_URL}")
    
    results = []
    
    # Test 1: Backend Health
    results.append(("Backend Health", test_backend_health()))
    
    # Test 2: Device Registration
    device_id, token = test_device_registration()
    if device_id and token:
        results.append(("Device Registration", True))
        
        # Test 3 & 4: Caller ID Endpoints
        results.append(("Caller ID Endpoints", test_caller_id_endpoints(device_id, token)))
    else:
        results.append(("Device Registration", False))
        results.append(("Caller ID Endpoints", False))
    
    # Test 5: Mailbox Monitor Import
    results.append(("Mailbox Monitor Import", test_mailbox_monitor_import()))
    
    # Summary
    log("\n=== Test Summary ===")
    passed = sum(1 for _, result in results if result)
    total = len(results)
    for name, result in results:
        status = "✅ PASS" if result else "❌ FAIL"
        log(f"{status}: {name}")
    
    log(f"\nTotal: {passed}/{total} tests passed")
    
    return 0 if passed == total else 1

if __name__ == "__main__":
    sys.exit(main())
