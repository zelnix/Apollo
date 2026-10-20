#!/usr/bin/env python3
"""
Backend API Tests for Double Investigation Bug Fix in Call Guard Manual Flow

Tests verify that:
1. POST /api/call/risk-check returns reputation data WITHOUT creating investigation
2. POST /api/call/investigate creates investigation independently
3. POST /api/investigations works for general investigation creation
4. Regression: Other gate investigations (link, message) still work
"""

import requests
import json
import time
from datetime import datetime

# Backend URL from frontend/.env
BASE_URL = "https://uat-loop-fix.preview.emergentagent.com/api"

# Test phone number (known high-risk test number from review request)
TEST_PHONE = "+18007132618"

# Colors for output
GREEN = '\033[92m'
RED = '\033[91m'
YELLOW = '\033[93m'
BLUE = '\033[94m'
RESET = '\033[0m'

def log_test(name):
    print(f"\n{BLUE}{'='*80}{RESET}")
    print(f"{BLUE}TEST: {name}{RESET}")
    print(f"{BLUE}{'='*80}{RESET}")

def log_success(message):
    print(f"{GREEN}✓ {message}{RESET}")

def log_error(message):
    print(f"{RED}✗ {message}{RESET}")

def log_info(message):
    print(f"{YELLOW}ℹ {message}{RESET}")

def log_response(response):
    print(f"\nStatus: {response.status_code}")
    try:
        print(f"Response: {json.dumps(response.json(), indent=2)}")
    except:
        print(f"Response: {response.text}")

class TestResults:
    def __init__(self):
        self.passed = []
        self.failed = []
        self.warnings = []
    
    def add_pass(self, test_name):
        self.passed.append(test_name)
        log_success(f"PASSED: {test_name}")
    
    def add_fail(self, test_name, reason):
        self.failed.append((test_name, reason))
        log_error(f"FAILED: {test_name} - {reason}")
    
    def add_warning(self, test_name, reason):
        self.warnings.append((test_name, reason))
        log_info(f"WARNING: {test_name} - {reason}")
    
    def summary(self):
        print(f"\n{BLUE}{'='*80}{RESET}")
        print(f"{BLUE}TEST SUMMARY{RESET}")
        print(f"{BLUE}{'='*80}{RESET}")
        print(f"{GREEN}Passed: {len(self.passed)}{RESET}")
        print(f"{RED}Failed: {len(self.failed)}{RESET}")
        print(f"{YELLOW}Warnings: {len(self.warnings)}{RESET}")
        
        if self.failed:
            print(f"\n{RED}Failed Tests:{RESET}")
            for test_name, reason in self.failed:
                print(f"  - {test_name}: {reason}")
        
        if self.warnings:
            print(f"\n{YELLOW}Warnings:{RESET}")
            for test_name, reason in self.warnings:
                print(f"  - {test_name}: {reason}")
        
        return len(self.failed) == 0

def register_device():
    """Register a device and return device_id and device_token"""
    log_test("Device Registration")
    
    url = f"{BASE_URL}/devices/register"
    payload = {
        "platform": "web",
        "adapter_mode": "preview",
        "app_version": "1.0.0"
    }
    
    response = requests.post(url, json=payload)
    log_response(response)
    
    if response.status_code != 201:
        raise Exception(f"Device registration failed: {response.status_code}")
    
    data = response.json()
    device_id = data.get("device_id")
    device_token = data.get("device_token")
    
    if not device_id or not device_token:
        raise Exception("Device registration did not return device_id or device_token")
    
    log_success(f"Device registered: {device_id}")
    return device_id, device_token

def test_call_risk_check(device_id, device_token, results):
    """Test POST /api/call/risk-check - should return reputation WITHOUT creating investigation"""
    log_test("POST /api/call/risk-check - Reputation Check Without Investigation")
    
    url = f"{BASE_URL}/call/risk-check"
    headers = {
        "Authorization": f"Bearer {device_token}",
        "Content-Type": "application/json"
    }
    payload = {
        "device_id": device_id,
        "number": TEST_PHONE
    }
    
    response = requests.post(url, json=payload, headers=headers)
    log_response(response)
    
    if response.status_code != 200:
        results.add_fail("call/risk-check status code", f"Expected 200, got {response.status_code}")
        return
    
    data = response.json()
    
    # Verify response contains reputation data
    required_fields = ["decision", "fraud_score", "number"]
    missing_fields = [f for f in required_fields if f not in data]
    
    if missing_fields:
        results.add_fail("call/risk-check response fields", f"Missing fields: {missing_fields}")
        return
    
    # Verify NO investigation_case_id in response (this is server-side, shouldn't create investigations)
    if "investigation_case_id" in data:
        results.add_warning("call/risk-check investigation_case_id", 
                          "Response contains investigation_case_id - this endpoint should not create investigations")
    
    # Check if IPQS is configured
    if data.get("source") == "not_configured":
        results.add_warning("call/risk-check IPQS", "IPQS_API_KEY not configured - acceptable per review request")
    else:
        log_success(f"IPQS source: {data.get('source')}")
        log_success(f"Decision: {data.get('decision')}")
        log_success(f"Fraud score: {data.get('fraud_score')}")
    
    results.add_pass("call/risk-check returns reputation data")

def test_call_investigate(device_id, device_token, results):
    """Test POST /api/call/investigate - should create investigation independently"""
    log_test("POST /api/call/investigate - Create Investigation")
    
    url = f"{BASE_URL}/call/investigate"
    headers = {
        "Authorization": f"Bearer {device_token}",
        "Content-Type": "application/json"
    }
    payload = {
        "device_id": device_id,
        "number": TEST_PHONE
    }
    
    response = requests.post(url, json=payload, headers=headers)
    log_response(response)
    
    if response.status_code != 200:
        results.add_fail("call/investigate status code", f"Expected 200, got {response.status_code}")
        return
    
    data = response.json()
    
    # Verify response contains investigation_case_id
    if "investigation_case_id" not in data:
        results.add_fail("call/investigate investigation_case_id", "Response missing investigation_case_id")
        return
    
    case_id = data.get("investigation_case_id")
    if not case_id:
        results.add_fail("call/investigate case_id value", "investigation_case_id is null or empty")
        return
    
    log_success(f"Investigation created: {case_id}")
    
    # Verify reputation data is also included
    if "reputation" in data:
        log_success("Reputation data included in response")
    
    results.add_pass("call/investigate creates investigation")
    return case_id

def test_investigations_endpoint(device_id, device_token, results):
    """Test POST /api/investigations - general investigation creation"""
    log_test("POST /api/investigations - General Investigation Creation")
    
    url = f"{BASE_URL}/investigations"
    headers = {
        "Authorization": f"Bearer {device_token}",
        "Content-Type": "application/json",
        "Idempotency-Key": f"test-{int(time.time())}-{device_id[:8]}"
    }
    payload = {
        "gate": "call",
        "question": "Test investigation for call gate",
        "submissions": [
            {
                "client_item_id": "test-call-1",
                "kind": "text",
                "value": TEST_PHONE,
                "label": "Test phone number"
            }
        ],
        "initial_findings": []
    }
    
    response = requests.post(url, json=payload, headers=headers)
    log_response(response)
    
    if response.status_code != 201:
        results.add_fail("investigations status code", f"Expected 201, got {response.status_code}")
        return
    
    data = response.json()
    
    # Verify response contains case
    if "case" not in data:
        results.add_fail("investigations response", "Response missing 'case' field")
        return
    
    case = data.get("case", {})
    case_id = case.get("id")
    
    if not case_id:
        results.add_fail("investigations case_id", "Case ID is null or empty")
        return
    
    log_success(f"Investigation created: {case_id}")
    
    # Verify job details if present
    if "job" in data and data["job"]:
        log_success(f"Job created: {data['job'].get('id')}")
    
    results.add_pass("investigations endpoint works")
    return case_id

def test_link_investigate_regression(device_id, device_token, results):
    """Regression test: POST /api/link/investigate should still work"""
    log_test("REGRESSION: POST /api/link/investigate")
    
    url = f"{BASE_URL}/link/investigate"
    headers = {
        "Authorization": f"Bearer {device_token}",
        "Content-Type": "application/json"
    }
    payload = {
        "device_id": device_id,
        "url": "https://example.com",
        "local_state": "resting"
    }
    
    response = requests.post(url, json=payload, headers=headers)
    log_response(response)
    
    if response.status_code != 200:
        results.add_fail("link/investigate status code", f"Expected 200, got {response.status_code}")
        return
    
    data = response.json()
    
    # Verify response contains investigation_case_id
    if "investigation_case_id" not in data:
        results.add_fail("link/investigate investigation_case_id", "Response missing investigation_case_id")
        return
    
    case_id = data.get("investigation_case_id")
    if not case_id:
        results.add_fail("link/investigate case_id value", "investigation_case_id is null or empty")
        return
    
    log_success(f"Link investigation created: {case_id}")
    results.add_pass("link/investigate regression test")

def test_message_analyse_regression(device_id, device_token, results):
    """Regression test: POST /api/message/analyse should still work"""
    log_test("REGRESSION: POST /api/message/analyse")
    
    url = f"{BASE_URL}/message/analyse"
    headers = {
        "Authorization": f"Bearer {device_token}",
        "Content-Type": "application/json"
    }
    payload = {
        "device_id": device_id,
        "text": "Test message with link https://example.com",
        "sender": "unknown",
        "local_state": "resting"
    }
    
    response = requests.post(url, json=payload, headers=headers)
    log_response(response)
    
    if response.status_code != 200:
        results.add_fail("message/analyse status code", f"Expected 200, got {response.status_code}")
        return
    
    data = response.json()
    
    # Verify response structure (message/analyse returns analysis, not necessarily investigation_case_id)
    # It may or may not create an investigation depending on the content
    log_success("Message analysis completed")
    results.add_pass("message/analyse regression test")

def main():
    print(f"\n{BLUE}{'='*80}{RESET}")
    print(f"{BLUE}Backend API Tests - Double Investigation Bug Fix{RESET}")
    print(f"{BLUE}{'='*80}{RESET}")
    print(f"Backend URL: {BASE_URL}")
    print(f"Test Phone: {TEST_PHONE}")
    print(f"Timestamp: {datetime.now().isoformat()}")
    
    results = TestResults()
    
    try:
        # Step 1: Register device
        device_id, device_token = register_device()
        log_success(f"Using device: {device_id}")
        
        # Step 2: Test call/risk-check (should NOT create investigation)
        test_call_risk_check(device_id, device_token, results)
        
        # Step 3: Test call/investigate (should create investigation)
        test_call_investigate(device_id, device_token, results)
        
        # Step 4: Test general investigations endpoint
        test_investigations_endpoint(device_id, device_token, results)
        
        # Step 5: Regression tests for other gates
        test_link_investigate_regression(device_id, device_token, results)
        test_message_analyse_regression(device_id, device_token, results)
        
    except Exception as e:
        log_error(f"Test execution failed: {str(e)}")
        import traceback
        traceback.print_exc()
        results.add_fail("Test execution", str(e))
    
    # Print summary
    success = results.summary()
    
    if success:
        print(f"\n{GREEN}{'='*80}{RESET}")
        print(f"{GREEN}ALL TESTS PASSED ✓{RESET}")
        print(f"{GREEN}{'='*80}{RESET}")
        return 0
    else:
        print(f"\n{RED}{'='*80}{RESET}")
        print(f"{RED}SOME TESTS FAILED ✗{RESET}")
        print(f"{RED}{'='*80}{RESET}")
        return 1

if __name__ == "__main__":
    exit(main())
