"""
Backend API tests for Image Privacy Gate + Pipeline Enforcement

Tests the critical backend enforcement:
1. POST /api/message/extract WITHOUT sanitization_status → 422 with "privacy gate" error
2. POST /api/message/extract WITH sanitization_status=approved and non-image → 415
3. POST /api/page/extract WITHOUT sanitization_status → 422 with "privacy gate" error
4. POST /api/page/extract WITH sanitization_status=approved and non-image → 415
"""
import io
import os
import sys
from PIL import Image
import requests

# Backend URL from environment
BACKEND_URL = os.getenv("REACT_APP_BACKEND_URL", "http://localhost:8001")
API_BASE = f"{BACKEND_URL}/api"

def create_test_image():
    """Create a simple test PNG image in memory."""
    img = Image.new('RGB', (100, 100), color='red')
    buf = io.BytesIO()
    img.save(buf, format='PNG')
    buf.seek(0)
    return buf

def create_test_text_file():
    """Create a simple text file in memory."""
    return io.BytesIO(b"This is a text file, not an image")

def register_device():
    """Register a test device and return device_id and token."""
    response = requests.post(
        f"{API_BASE}/devices/register",
        json={
            "platform": "web",
            "adapter_mode": "mock",
            "app_version": "test-1.0.0"
        }
    )
    if response.status_code not in [200, 201]:
        print(f"❌ Device registration failed: {response.status_code} {response.text}")
        sys.exit(1)
    
    data = response.json()
    # Handle both camelCase and snake_case response formats
    device_id = data.get("deviceId") or data.get("device_id")
    token = data.get("token") or data.get("device_token")
    return device_id, token

def test_message_extract_without_sanitization(device_id, token):
    """Test 1: POST /api/message/extract WITHOUT sanitization_status → 422"""
    print("\n🧪 Test 1: POST /api/message/extract WITHOUT sanitization_status")
    
    img_buf = create_test_image()
    
    response = requests.post(
        f"{API_BASE}/message/extract",
        headers={"Authorization": f"Bearer {token}"},
        files={"file": ("screenshot.png", img_buf, "image/png")},
        data={"device_id": device_id}
        # NOTE: sanitization_status is intentionally missing
    )
    
    if response.status_code == 422:
        error_text = response.text.lower()
        if "privacy gate" in error_text or "sanitization" in error_text:
            print(f"✅ PASS: Got 422 with privacy gate error")
            print(f"   Response: {response.text[:200]}")
            return True
        else:
            print(f"❌ FAIL: Got 422 but wrong error message: {response.text}")
            return False
    else:
        print(f"❌ FAIL: Expected 422, got {response.status_code}")
        print(f"   Response: {response.text[:200]}")
        return False

def test_message_extract_with_sanitization_non_image(device_id, token):
    """Test 2: POST /api/message/extract WITH sanitization_status=approved and non-image → 415"""
    print("\n🧪 Test 2: POST /api/message/extract WITH sanitization_status=approved and non-image file")
    
    text_buf = create_test_text_file()
    
    response = requests.post(
        f"{API_BASE}/message/extract",
        headers={"Authorization": f"Bearer {token}"},
        files={"file": ("document.txt", text_buf, "text/plain")},
        data={
            "device_id": device_id,
            "sanitization_status": "approved"
        }
    )
    
    if response.status_code == 415:
        print(f"✅ PASS: Got 415 Unsupported Media Type for non-image")
        print(f"   Response: {response.text[:200]}")
        return True
    else:
        print(f"❌ FAIL: Expected 415, got {response.status_code}")
        print(f"   Response: {response.text[:200]}")
        return False

def test_page_extract_without_sanitization(device_id, token):
    """Test 3: POST /api/page/extract WITHOUT sanitization_status → 422"""
    print("\n🧪 Test 3: POST /api/page/extract WITHOUT sanitization_status")
    
    img_buf = create_test_image()
    
    response = requests.post(
        f"{API_BASE}/page/extract",
        headers={"Authorization": f"Bearer {token}"},
        files={"file": ("page.png", img_buf, "image/png")},
        data={"device_id": device_id}
        # NOTE: sanitization_status is intentionally missing
    )
    
    if response.status_code == 422:
        error_text = response.text.lower()
        if "privacy gate" in error_text or "sanitization" in error_text:
            print(f"✅ PASS: Got 422 with privacy gate error")
            print(f"   Response: {response.text[:200]}")
            return True
        else:
            print(f"❌ FAIL: Got 422 but wrong error message: {response.text}")
            return False
    else:
        print(f"❌ FAIL: Expected 422, got {response.status_code}")
        print(f"   Response: {response.text[:200]}")
        return False

def test_page_extract_with_sanitization_non_image(device_id, token):
    """Test 4: POST /api/page/extract WITH sanitization_status=approved and non-image → 415"""
    print("\n🧪 Test 4: POST /api/page/extract WITH sanitization_status=approved and non-image file")
    
    text_buf = create_test_text_file()
    
    response = requests.post(
        f"{API_BASE}/page/extract",
        headers={"Authorization": f"Bearer {token}"},
        files={"file": ("page.txt", text_buf, "text/plain")},
        data={
            "device_id": device_id,
            "sanitization_status": "approved"
        }
    )
    
    if response.status_code == 415:
        print(f"✅ PASS: Got 415 Unsupported Media Type for non-image")
        print(f"   Response: {response.text[:200]}")
        return True
    else:
        print(f"❌ FAIL: Expected 415, got {response.status_code}")
        print(f"   Response: {response.text[:200]}")
        return False

def test_message_extract_with_approved_image(device_id, token):
    """Bonus Test: POST /api/message/extract WITH sanitization_status=approved and valid image → should work"""
    print("\n🧪 Bonus Test: POST /api/message/extract WITH sanitization_status=approved and valid image")
    
    img_buf = create_test_image()
    
    response = requests.post(
        f"{API_BASE}/message/extract",
        headers={"Authorization": f"Bearer {token}"},
        files={"file": ("screenshot.png", img_buf, "image/png")},
        data={
            "device_id": device_id,
            "sanitization_status": "approved"
        }
    )
    
    # Should return 200 or 503 (if Gemini not configured), but NOT 422
    if response.status_code in [200, 503]:
        print(f"✅ PASS: Approved image accepted (status {response.status_code})")
        return True
    elif response.status_code == 422:
        print(f"❌ FAIL: Approved image was rejected with 422")
        print(f"   Response: {response.text[:200]}")
        return False
    else:
        print(f"⚠️  WARN: Unexpected status {response.status_code}")
        print(f"   Response: {response.text[:200]}")
        return True  # Not a failure of the privacy gate

def main():
    print("=" * 80)
    print("Backend API Tests: Image Privacy Gate + Pipeline Enforcement")
    print("=" * 80)
    print(f"Backend URL: {BACKEND_URL}")
    print(f"API Base: {API_BASE}")
    
    # Register device
    print("\n📱 Registering test device...")
    device_id, token = register_device()
    print(f"✅ Device registered: {device_id[:20]}...")
    
    # Run tests
    results = []
    results.append(("Test 1: message/extract without sanitization", 
                   test_message_extract_without_sanitization(device_id, token)))
    results.append(("Test 2: message/extract with sanitization + non-image", 
                   test_message_extract_with_sanitization_non_image(device_id, token)))
    results.append(("Test 3: page/extract without sanitization", 
                   test_page_extract_without_sanitization(device_id, token)))
    results.append(("Test 4: page/extract with sanitization + non-image", 
                   test_page_extract_with_sanitization_non_image(device_id, token)))
    results.append(("Bonus: message/extract with approved image", 
                   test_message_extract_with_approved_image(device_id, token)))
    
    # Summary
    print("\n" + "=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    
    passed = sum(1 for _, result in results if result)
    total = len(results)
    
    for name, result in results:
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{status}: {name}")
    
    print(f"\nTotal: {passed}/{total} tests passed")
    
    if passed == total:
        print("\n🎉 All backend API tests PASSED!")
        return 0
    else:
        print(f"\n⚠️  {total - passed} test(s) FAILED")
        return 1

if __name__ == "__main__":
    sys.exit(main())
