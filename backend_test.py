#!/usr/bin/env python3
"""
Backend test for Unified Investigation Reports feature.
This is a frontend-only change, so we only verify backend health.
"""
import requests
import sys

def test_backend_health():
    """Test 1: Verify backend health endpoint returns 200 with status 'ok'"""
    print("Test 1: Backend Health Check")
    print("-" * 50)
    
    try:
        response = requests.get("http://localhost:8001/api/health", timeout=10)
        print(f"Status Code: {response.status_code}")
        
        if response.status_code != 200:
            print(f"❌ FAILED: Expected 200, got {response.status_code}")
            return False
        
        data = response.json()
        print(f"Response: {data}")
        
        if data.get("status") != "ok":
            print(f"❌ FAILED: Expected status 'ok', got '{data.get('status')}'")
            return False
        
        print("✅ PASSED: Backend health check successful")
        return True
        
    except Exception as e:
        print(f"❌ FAILED: Exception occurred: {e}")
        return False

def main():
    print("=" * 50)
    print("UNIFIED INVESTIGATION REPORTS - BACKEND TEST")
    print("=" * 50)
    print()
    
    results = []
    
    # Test 1: Backend Health
    results.append(test_backend_health())
    print()
    
    # Summary
    print("=" * 50)
    print("TEST SUMMARY")
    print("=" * 50)
    passed = sum(results)
    total = len(results)
    print(f"Passed: {passed}/{total}")
    
    if passed == total:
        print("✅ ALL TESTS PASSED")
        sys.exit(0)
    else:
        print("❌ SOME TESTS FAILED")
        sys.exit(1)

if __name__ == "__main__":
    main()
