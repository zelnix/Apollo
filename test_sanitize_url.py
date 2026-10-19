#!/usr/bin/env python3
"""
Direct test of sanitize_url() function to verify Fix 1 implementation.
Tests that URL path is preserved and secret params are stripped.
"""
import sys
sys.path.insert(0, '/app/backend')

from services.intel import sanitize_url

def test_sanitize_url():
    """Test sanitize_url() directly"""
    print("=" * 80)
    print("Direct sanitize_url() Function Tests")
    print("=" * 80)
    
    # Test 1: Path preservation
    print("\n1. Path preservation:")
    url, host = sanitize_url("https://example.com/phishing/page?id=123")
    print(f"   Input:  https://example.com/phishing/page?id=123")
    print(f"   Output: {url}")
    print(f"   Host:   {host}")
    assert "/phishing/page" in url, f"Path not preserved: {url}"
    assert "id=123" in url, f"Safe param not preserved: {url}"
    print("   ✅ Path and safe params preserved")
    
    # Test 2: Secret param stripping
    print("\n2. Secret param stripping:")
    url, host = sanitize_url("https://example.com/path?token=secret&page=2")
    print(f"   Input:  https://example.com/path?token=secret&page=2")
    print(f"   Output: {url}")
    print(f"   Host:   {host}")
    assert "token" not in url, f"Secret param not stripped: {url}"
    assert "page=2" in url, f"Safe param not preserved: {url}"
    print("   ✅ Secret param stripped, safe param preserved")
    
    # Test 3: Credentials stripping
    print("\n3. Credentials stripping:")
    url, host = sanitize_url("https://user:pass@example.com/path?token=secret&safe=yes")
    print(f"   Input:  https://user:pass@example.com/path?token=secret&safe=yes")
    print(f"   Output: {url}")
    print(f"   Host:   {host}")
    assert "user" not in url, f"Username not stripped: {url}"
    assert "pass" not in url, f"Password not stripped: {url}"
    assert "/path" in url, f"Path not preserved: {url}"
    assert "token" not in url, f"Secret param not stripped: {url}"
    assert "safe=yes" in url, f"Safe param not preserved: {url}"
    print("   ✅ Credentials and secret params stripped, path and safe params preserved")
    
    # Test 4: Multiple secret params
    print("\n4. Multiple secret params:")
    url, host = sanitize_url("https://example.com/api?auth=xyz&code=123&page=5&session=abc")
    print(f"   Input:  https://example.com/api?auth=xyz&code=123&page=5&session=abc")
    print(f"   Output: {url}")
    print(f"   Host:   {host}")
    assert "auth" not in url, f"Auth param not stripped: {url}"
    assert "code" not in url, f"Code param not stripped: {url}"
    assert "session" not in url, f"Session param not stripped: {url}"
    assert "page=5" in url, f"Safe param not preserved: {url}"
    print("   ✅ All secret params stripped, safe param preserved")
    
    # Test 5: Empty path normalizes to /
    print("\n5. Empty path normalization:")
    url, host = sanitize_url("https://example.com")
    print(f"   Input:  https://example.com")
    print(f"   Output: {url}")
    print(f"   Host:   {host}")
    assert url.endswith("/"), f"Empty path not normalized to /: {url}"
    print("   ✅ Empty path normalized to /")
    
    # Test 6: Fragment stripping
    print("\n6. Fragment stripping:")
    url, host = sanitize_url("https://example.com/page#section")
    print(f"   Input:  https://example.com/page#section")
    print(f"   Output: {url}")
    print(f"   Host:   {host}")
    assert "#" not in url, f"Fragment not stripped: {url}"
    assert "/page" in url, f"Path not preserved: {url}"
    print("   ✅ Fragment stripped, path preserved")
    
    print("\n" + "=" * 80)
    print("✅ ALL sanitize_url() TESTS PASSED")
    print("=" * 80)
    print("\nVerified:")
    print("  ✅ URL paths are preserved (not stripped to /)")
    print("  ✅ Secret query parameters are stripped (token, code, auth, session, etc.)")
    print("  ✅ Safe query parameters are preserved")
    print("  ✅ Credentials are stripped")
    print("  ✅ Fragments are stripped")
    print("=" * 80)

if __name__ == "__main__":
    try:
        test_sanitize_url()
        sys.exit(0)
    except AssertionError as e:
        print(f"\n❌ TEST FAILED: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ UNEXPECTED ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
