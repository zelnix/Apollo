#!/usr/bin/env python3
"""
Apollo V1 Backend Health and Family/Push Route Testing
Tests backend health, family routes, and push registration endpoints
"""
import requests
import json
import sys
from typing import Dict, Any, Optional

# Backend URL from environment
BACKEND_URL = "https://apollo-patrol.preview.emergentagent.com/api"

class TestResult:
    def __init__(self):
        self.passed = 0
        self.failed = 0
        self.errors = []
    
    def add_pass(self, test_name: str):
        self.passed += 1
        print(f"✅ PASS: {test_name}")
    
    def add_fail(self, test_name: str, reason: str):
        self.failed += 1
        error_msg = f"❌ FAIL: {test_name} - {reason}"
        self.errors.append(error_msg)
        print(error_msg)
    
    def summary(self):
        total = self.passed + self.failed
        print(f"\n{'='*60}")
        print(f"Test Summary: {self.passed}/{total} passed")
        if self.errors:
            print(f"\nFailed Tests:")
            for error in self.errors:
                print(f"  {error}")
        print(f"{'='*60}\n")
        return self.failed == 0


def register_device() -> Optional[Dict[str, Any]]:
    """Register a test device and return device_id and token"""
    try:
        response = requests.post(
            f"{BACKEND_URL}/devices/register",
            json={
                "platform": "android",
                "adapter_mode": "web",
                "app_version": "1.1.0"
            },
            timeout=15
        )
        if response.status_code == 201:
            data = response.json()
            return {
                "device_id": data.get("device_id"),
                "token": data.get("device_token")
            }
        else:
            print(f"❌ Device registration failed: {response.status_code} - {response.text}")
            return None
    except Exception as e:
        print(f"❌ Device registration error: {e}")
        return None


def test_health_endpoint(result: TestResult):
    """Test GET /api/health endpoint"""
    try:
        response = requests.get(f"{BACKEND_URL}/health", timeout=10)
        
        if response.status_code != 200:
            result.add_fail("GET /api/health", f"Expected 200, got {response.status_code}")
            return
        
        data = response.json()
        
        # Check required fields
        if data.get("schemaVersion") != 1:
            result.add_fail("GET /api/health", f"schemaVersion should be 1, got {data.get('schemaVersion')}")
            return
        
        if data.get("status") != "ok":
            result.add_fail("GET /api/health", f"status should be 'ok', got {data.get('status')}")
            return
        
        if data.get("service") != "apollo-v1":
            result.add_fail("GET /api/health", f"service should be 'apollo-v1', got {data.get('service')}")
            return
        
        result.add_pass("GET /api/health returns 200 with correct schema")
        
    except Exception as e:
        result.add_fail("GET /api/health", f"Exception: {e}")


def test_push_registration(device_id: str, token: str, result: TestResult):
    """Test GET /api/push/registration"""
    try:
        headers = {"Authorization": f"Bearer {token}"}
        response = requests.get(
            f"{BACKEND_URL}/push/registration",
            headers=headers,
            timeout=10
        )
        
        if response.status_code != 200:
            result.add_fail("GET /api/push/registration", f"Expected 200, got {response.status_code}")
            return
        
        data = response.json()
        
        # Push is NOT configured, so expect configured: false
        if data.get("configured") is not False:
            result.add_fail("GET /api/push/registration", f"Expected configured=false (EXPO_PUSH_ENABLED not set), got {data.get('configured')}")
            return
        
        result.add_pass("GET /api/push/registration returns correct state (configured: false)")
        
    except Exception as e:
        result.add_fail("GET /api/push/registration", f"Exception: {e}")


def test_family_guardians(device_id: str, token: str, result: TestResult):
    """Test GET /api/family/guardians"""
    try:
        headers = {"Authorization": f"Bearer {token}"}
        response = requests.get(
            f"{BACKEND_URL}/family/guardians?device_id={device_id}",
            headers=headers,
            timeout=10
        )
        
        if response.status_code != 200:
            result.add_fail("GET /api/family/guardians", f"Expected 200, got {response.status_code}")
            return
        
        data = response.json()
        
        # Should return empty list for new device
        if not isinstance(data, list):
            result.add_fail("GET /api/family/guardians", f"Expected list, got {type(data)}")
            return
        
        result.add_pass("GET /api/family/guardians returns empty list")
        
    except Exception as e:
        result.add_fail("GET /api/family/guardians", f"Exception: {e}")


def test_family_links(device_id: str, token: str, result: TestResult):
    """Test GET /api/family/links"""
    try:
        headers = {"Authorization": f"Bearer {token}"}
        response = requests.get(
            f"{BACKEND_URL}/family/links?device_id={device_id}",
            headers=headers,
            timeout=10
        )
        
        if response.status_code != 200:
            result.add_fail("GET /api/family/links", f"Expected 200, got {response.status_code}")
            return
        
        data = response.json()
        
        # Check structure
        if not isinstance(data, dict):
            result.add_fail("GET /api/family/links", f"Expected dict, got {type(data)}")
            return
        
        if "i_watch" not in data or "watching_me" not in data or "watchers" not in data:
            result.add_fail("GET /api/family/links", f"Missing required fields in response")
            return
        
        result.add_pass("GET /api/family/links returns correct structure")
        
    except Exception as e:
        result.add_fail("GET /api/family/links", f"Exception: {e}")


def test_family_weekly(device_id: str, token: str, result: TestResult):
    """Test GET /api/family/weekly"""
    try:
        headers = {"Authorization": f"Bearer {token}"}
        response = requests.get(
            f"{BACKEND_URL}/family/weekly?device_id={device_id}",
            headers=headers,
            timeout=10
        )
        
        if response.status_code != 200:
            result.add_fail("GET /api/family/weekly", f"Expected 200, got {response.status_code}")
            return
        
        data = response.json()
        
        # Should return empty list for new device
        if not isinstance(data, list):
            result.add_fail("GET /api/family/weekly", f"Expected list, got {type(data)}")
            return
        
        result.add_pass("GET /api/family/weekly returns empty list")
        
    except Exception as e:
        result.add_fail("GET /api/family/weekly", f"Exception: {e}")


def test_family_acks(device_id: str, token: str, result: TestResult):
    """Test GET /api/family/acks"""
    try:
        headers = {"Authorization": f"Bearer {token}"}
        response = requests.get(
            f"{BACKEND_URL}/family/acks?device_id={device_id}",
            headers=headers,
            timeout=10
        )
        
        if response.status_code != 200:
            result.add_fail("GET /api/family/acks", f"Expected 200, got {response.status_code}")
            return
        
        data = response.json()
        
        # Should return empty list for new device
        if not isinstance(data, list):
            result.add_fail("GET /api/family/acks", f"Expected list, got {type(data)}")
            return
        
        result.add_pass("GET /api/family/acks returns empty list")
        
    except Exception as e:
        result.add_fail("GET /api/family/acks", f"Exception: {e}")


def test_family_incidents(device_id: str, token: str, result: TestResult):
    """Test GET /api/family/incidents"""
    try:
        headers = {"Authorization": f"Bearer {token}"}
        response = requests.get(
            f"{BACKEND_URL}/family/incidents?device_id={device_id}",
            headers=headers,
            timeout=10
        )
        
        if response.status_code != 200:
            result.add_fail("GET /api/family/incidents", f"Expected 200, got {response.status_code}")
            return
        
        data = response.json()
        
        # Should return empty list for new device
        if not isinstance(data, list):
            result.add_fail("GET /api/family/incidents", f"Expected list, got {type(data)}")
            return
        
        result.add_pass("GET /api/family/incidents returns empty list")
        
    except Exception as e:
        result.add_fail("GET /api/family/incidents", f"Exception: {e}")


def test_family_weekly_notify(device_id: str, token: str, result: TestResult):
    """Test GET /api/family/weekly/notify"""
    try:
        headers = {"Authorization": f"Bearer {token}"}
        response = requests.get(
            f"{BACKEND_URL}/family/weekly/notify?device_id={device_id}",
            headers=headers,
            timeout=10
        )
        
        if response.status_code != 200:
            result.add_fail("GET /api/family/weekly/notify", f"Expected 200, got {response.status_code}")
            return
        
        data = response.json()
        
        # Should have enabled field
        if "enabled" not in data:
            result.add_fail("GET /api/family/weekly/notify", f"Missing 'enabled' field in response")
            return
        
        result.add_pass("GET /api/family/weekly/notify returns correct structure")
        
    except Exception as e:
        result.add_fail("GET /api/family/weekly/notify", f"Exception: {e}")


def test_family_weekly_checkins(device_id: str, token: str, result: TestResult):
    """Test GET /api/family/weekly/checkins"""
    try:
        headers = {"Authorization": f"Bearer {token}"}
        response = requests.get(
            f"{BACKEND_URL}/family/weekly/checkins?device_id={device_id}",
            headers=headers,
            timeout=10
        )
        
        if response.status_code != 200:
            result.add_fail("GET /api/family/weekly/checkins", f"Expected 200, got {response.status_code}")
            return
        
        data = response.json()
        
        # Should return empty list for new device
        if not isinstance(data, list):
            result.add_fail("GET /api/family/weekly/checkins", f"Expected list, got {type(data)}")
            return
        
        result.add_pass("GET /api/family/weekly/checkins returns empty list")
        
    except Exception as e:
        result.add_fail("GET /api/family/weekly/checkins", f"Exception: {e}")


def test_family_shared_events(device_id: str, token: str, result: TestResult):
    """Test GET /api/family/shared-events"""
    try:
        headers = {"Authorization": f"Bearer {token}"}
        response = requests.get(
            f"{BACKEND_URL}/family/shared-events?device_id={device_id}",
            headers=headers,
            timeout=10
        )
        
        if response.status_code != 200:
            result.add_fail("GET /api/family/shared-events", f"Expected 200, got {response.status_code}")
            return
        
        data = response.json()
        
        # Should return empty list for new device
        if not isinstance(data, list):
            result.add_fail("GET /api/family/shared-events", f"Expected list, got {type(data)}")
            return
        
        result.add_pass("GET /api/family/shared-events returns empty list")
        
    except Exception as e:
        result.add_fail("GET /api/family/shared-events", f"Exception: {e}")


def test_family_assist_capabilities(token: str, result: TestResult):
    """Test GET /api/family/assist/capabilities"""
    try:
        headers = {"Authorization": f"Bearer {token}"}
        response = requests.get(
            f"{BACKEND_URL}/family/assist/capabilities",
            headers=headers,
            timeout=10
        )
        
        if response.status_code != 200:
            result.add_fail("GET /api/family/assist/capabilities", f"Expected 200, got {response.status_code}")
            return
        
        data = response.json()
        
        # TURN is NOT configured, so expect enabled: false
        if data.get("enabled") is not False:
            result.add_fail("GET /api/family/assist/capabilities", f"Expected enabled=false (TURN not configured), got {data.get('enabled')}")
            return
        
        if data.get("unavailableReason") != "configuration_missing":
            result.add_fail("GET /api/family/assist/capabilities", f"Expected unavailableReason='configuration_missing', got {data.get('unavailableReason')}")
            return
        
        result.add_pass("GET /api/family/assist/capabilities returns correct state (enabled: false, configuration_missing)")
        
    except Exception as e:
        result.add_fail("GET /api/family/assist/capabilities", f"Exception: {e}")


def main():
    print("="*60)
    print("Apollo V1 Backend Health and Family/Push Route Testing")
    print("="*60)
    print(f"Backend URL: {BACKEND_URL}\n")
    
    result = TestResult()
    
    # Test 1: Health endpoint (no auth required)
    print("\n--- Testing Backend Health ---")
    test_health_endpoint(result)
    
    # Register a device for authenticated tests
    print("\n--- Registering Test Device ---")
    device_creds = register_device()
    
    if not device_creds:
        print("\n❌ CRITICAL: Could not register device. Skipping authenticated tests.")
        result.summary()
        sys.exit(1)
    
    device_id = device_creds["device_id"]
    token = device_creds["token"]
    print(f"✅ Device registered: {device_id}")
    
    # Test 2: Push registration
    print("\n--- Testing Push Routes ---")
    test_push_registration(device_id, token, result)
    
    # Test 3: Family routes
    print("\n--- Testing Family Routes ---")
    test_family_guardians(device_id, token, result)
    test_family_links(device_id, token, result)
    test_family_weekly(device_id, token, result)
    test_family_acks(device_id, token, result)
    test_family_incidents(device_id, token, result)
    test_family_weekly_notify(device_id, token, result)
    test_family_weekly_checkins(device_id, token, result)
    test_family_shared_events(device_id, token, result)
    
    # Test 4: Family Assist capabilities
    print("\n--- Testing Family Assist Routes ---")
    test_family_assist_capabilities(token, result)
    
    # Summary
    success = result.summary()
    
    if success:
        print("✅ All backend health and family/push route tests PASSED")
        sys.exit(0)
    else:
        print("❌ Some tests FAILED")
        sys.exit(1)


if __name__ == "__main__":
    main()
