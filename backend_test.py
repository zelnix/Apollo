"""Backend test for Provider.py Production Isolation and Sniffing/Growling Notifications.

Tests two P0 changes:
1. Provider.py production isolation - verify no preview imports and callback mechanism
2. Sniffing & Growling notifications - verify push notifications for sniffing events
"""
import asyncio
import httpx
import os
import sys

# Backend URL from environment
BACKEND_URL = os.getenv("REACT_APP_BACKEND_URL", "http://localhost:8001")
API_BASE = f"{BACKEND_URL}/api"

class TestResults:
    def __init__(self):
        self.passed = []
        self.failed = []
        self.warnings = []
    
    def add_pass(self, test_name: str, details: str = ""):
        self.passed.append((test_name, details))
        print(f"✅ PASS: {test_name}")
        if details:
            print(f"   {details}")
    
    def add_fail(self, test_name: str, details: str):
        self.failed.append((test_name, details))
        print(f"❌ FAIL: {test_name}")
        print(f"   {details}")
    
    def add_warning(self, test_name: str, details: str):
        self.warnings.append((test_name, details))
        print(f"⚠️  WARNING: {test_name}")
        print(f"   {details}")
    
    def summary(self):
        print("\n" + "="*80)
        print("TEST SUMMARY")
        print("="*80)
        print(f"✅ Passed: {len(self.passed)}")
        print(f"❌ Failed: {len(self.failed)}")
        print(f"⚠️  Warnings: {len(self.warnings)}")
        
        if self.failed:
            print("\nFailed Tests:")
            for name, details in self.failed:
                print(f"  - {name}: {details}")
        
        return len(self.failed) == 0


async def register_device(client: httpx.AsyncClient) -> str:
    """Register a test device and return the auth token."""
    response = await client.post(
        f"{API_BASE}/devices/register",
        json={
            "platform": "android", 
            "adapter_mode": "guarddog",
            "app_version": "1.0.0",
            "tz_offset_minutes": 0,
            "locale": "en-AU"
        }
    )
    if response.status_code != 201:
        raise Exception(f"Device registration failed: {response.status_code} {response.text}")
    data = response.json()
    return data["device_token"]


async def test_provider_isolation(results: TestResults):
    """Test 1: Provider.py Production Isolation (P0)"""
    print("\n" + "="*80)
    print("TEST 1: Provider.py Production Isolation (P0)")
    print("="*80)
    
    # Test 1.1: Verify provider.py has NO imports from services.higgins.preview
    print("\n1.1: Checking provider.py for preview imports...")
    provider_path = "/app/backend/services/higgins/provider.py"
    
    with open(provider_path, 'r') as f:
        content = f.read()
        lines = content.split('\n')
    
    # Check for any import statements containing services.higgins.preview
    preview_imports = []
    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        if stripped.startswith('import ') or stripped.startswith('from '):
            if 'services.higgins.preview' in line and not line.strip().startswith('#'):
                preview_imports.append((i, line))
    
    if preview_imports:
        details = f"Found {len(preview_imports)} preview imports:\n"
        for line_num, line in preview_imports:
            details += f"  Line {line_num}: {line}\n"
        results.add_fail("provider.py contains NO preview imports", details)
    else:
        results.add_pass("provider.py contains NO preview imports", 
                        "Verified: No 'import' or 'from' statements reference services.higgins.preview")
    
    # Test 1.2: Verify generate() function has no simulate_generate or mock_generate references
    print("\n1.2: Checking generate() function for simulate/mock references...")
    
    # Find the generate function
    generate_start = None
    for i, line in enumerate(lines):
        if 'async def generate(' in line or 'def generate(' in line:
            generate_start = i
            break
    
    if generate_start is None:
        results.add_fail("generate() function exists", "Could not find generate() function")
    else:
        # Find the end of the function (next function definition or end of file)
        generate_end = len(lines)
        for i in range(generate_start + 1, len(lines)):
            if lines[i].startswith('async def ') or lines[i].startswith('def '):
                generate_end = i
                break
        
        generate_code = '\n'.join(lines[generate_start:generate_end])
        
        # Check for simulate_generate or mock_generate (excluding comments)
        code_lines = [l for l in generate_code.split('\n') if not l.strip().startswith('#')]
        code_text = '\n'.join(code_lines)
        
        if 'simulate_generate' in code_text or 'mock_generate' in code_text:
            results.add_fail("generate() has no simulate/mock references",
                           "Found simulate_generate or mock_generate in generate() function")
        else:
            results.add_pass("generate() has no simulate/mock references",
                           "Verified: No direct calls to simulate_generate or mock_generate")
    
    # Test 1.3: Verify callback mechanism exists
    print("\n1.3: Checking callback mechanism (_preview_generate)...")
    
    if '_preview_generate = None' in content:
        results.add_pass("Callback mechanism exists", 
                        "Found _preview_generate = None declaration")
    else:
        results.add_fail("Callback mechanism exists",
                        "_preview_generate variable not found")
    
    if 'def register_preview_handler(' in content:
        results.add_pass("register_preview_handler() exists",
                        "Found register_preview_handler() function")
    else:
        results.add_fail("register_preview_handler() exists",
                        "register_preview_handler() function not found")
    
    # Test 1.4: Verify dispatch.py exists and has install_preview_provider
    print("\n1.4: Checking dispatch.py...")
    dispatch_path = "/app/backend/services/higgins/preview/dispatch.py"
    
    try:
        with open(dispatch_path, 'r') as f:
            dispatch_content = f.read()
        
        if 'def install_preview_provider()' in dispatch_content:
            results.add_pass("dispatch.py has install_preview_provider()",
                           f"Found at {dispatch_path}")
        else:
            results.add_fail("dispatch.py has install_preview_provider()",
                           "install_preview_provider() function not found")
    except FileNotFoundError:
        results.add_fail("dispatch.py exists", f"File not found: {dispatch_path}")
    
    # Test 1.5: Check backend is running and get capabilities
    print("\n1.5: Checking backend health and AI capabilities...")
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            # Check backend health
            health_response = await client.get(f"{API_BASE}/health")
            if health_response.status_code == 200:
                results.add_pass("Backend is running", f"Health check returned 200")
            else:
                results.add_fail("Backend is running", 
                               f"Health check returned {health_response.status_code}")
            
            # Register a device to get auth token for capabilities endpoint
            try:
                token = await register_device(client)
                headers = {"Authorization": f"Bearer {token}"}
            except Exception as e:
                results.add_fail("Device registration for capabilities test", f"Error: {str(e)}")
                return
            
            # Check AI capabilities endpoint (requires auth)
            cap_response = await client.get(f"{API_BASE}/ai/capabilities", headers=headers)
            if cap_response.status_code == 200:
                cap_data = cap_response.json()
                provider_mode = cap_data.get("provider", "")
                
                # Check if provider mode indicates live (not mock)
                # In preview environment with APOLLO_PROVIDER_MODE=simulated, 
                # the provider will show "Gemini" but mode will be handled via callback
                if "MOCK" in provider_mode.upper():
                    results.add_warning("Provider mode check",
                                      f"Provider shows as MOCK: {provider_mode}")
                else:
                    results.add_pass("Provider mode is not mock",
                                   f"Provider: {provider_mode}")
                
                # Check models are configured
                models = cap_data.get("models", {})
                results.add_pass("AI capabilities endpoint works",
                               f"Models configured: {', '.join(models.keys())}")
            else:
                results.add_fail("AI capabilities endpoint",
                               f"Returned {cap_response.status_code}")
        
        except Exception as e:
            results.add_fail("Backend connectivity", f"Error: {str(e)}")


async def test_sniffing_notifications(results: TestResults):
    """Test 2: Sniffing & Growling Notifications"""
    print("\n" + "="*80)
    print("TEST 2: Sniffing & Growling Notifications")
    print("="*80)
    
    async with httpx.AsyncClient(timeout=30.0) as client:
        # Register device and get auth token
        print("\n2.1: Registering test device...")
        try:
            token = await register_device(client)
            headers = {"Authorization": f"Bearer {token}"}
            results.add_pass("Device registration", "Successfully registered test device")
        except Exception as e:
            results.add_fail("Device registration", f"Error: {str(e)}")
            return
        
        # Test 2.2: Check notification preferences endpoint
        print("\n2.2: Checking notification preferences endpoint...")
        try:
            prefs_response = await client.get(
                f"{API_BASE}/push/preferences",
                headers=headers
            )
            
            if prefs_response.status_code == 200:
                prefs_data = prefs_response.json()
                categories = prefs_data.get("categories", [])
                
                # Check for sniffing_growling category
                sniffing_category = None
                for cat in categories:
                    if cat.get("id") == "sniffing_growling":
                        sniffing_category = cat
                        break
                
                if sniffing_category:
                    results.add_pass("sniffing_growling category exists",
                                   f"Label: {sniffing_category.get('label')}, "
                                   f"Always on: {sniffing_category.get('always_on')}")
                else:
                    results.add_fail("sniffing_growling category exists",
                                   "Category not found in preferences")
                
                # Verify all 5 categories exist
                category_ids = [c.get("id") for c in categories]
                expected = ["barking", "biting", "sniffing_growling", "scam_alerts", "learn_with_higgins"]
                
                if set(category_ids) == set(expected):
                    results.add_pass("All 5 notification categories present",
                                   f"Categories: {', '.join(category_ids)}")
                else:
                    missing = set(expected) - set(category_ids)
                    extra = set(category_ids) - set(expected)
                    details = ""
                    if missing:
                        details += f"Missing: {missing}. "
                    if extra:
                        details += f"Extra: {extra}."
                    results.add_fail("All 5 notification categories present", details)
            else:
                results.add_fail("GET /api/push/preferences",
                               f"Returned {prefs_response.status_code}: {prefs_response.text}")
        
        except Exception as e:
            results.add_fail("Notification preferences check", f"Error: {str(e)}")
        
        # Test 2.3: Verify push.py code maps sniffing correctly
        print("\n2.3: Verifying push.py code for sniffing event mapping...")
        
        push_path = "/app/backend/routers/push.py"
        try:
            with open(push_path, 'r') as f:
                push_content = f.read()
            
            # Check for sniffing title in push_owner_alert
            if '"Apollo is sniffing"' in push_content:
                results.add_pass("Sniffing events get correct title",
                               'Found "Apollo is sniffing" in push.py')
            else:
                results.add_fail("Sniffing events get correct title",
                               '"Apollo is sniffing" not found in push.py')
            
            # Check for sniffing_growling category mapping
            if 'category = "sniffing_growling"' in push_content or "'sniffing_growling'" in push_content:
                results.add_pass("Sniffing maps to sniffing_growling category",
                               "Found sniffing_growling category mapping")
            else:
                results.add_fail("Sniffing maps to sniffing_growling category",
                               "sniffing_growling category mapping not found")
        
        except Exception as e:
            results.add_fail("push.py code verification", f"Error: {str(e)}")
        
        # Test 2.4: Verify patrol.py triggers push for sniffing events
        print("\n2.4: Verifying patrol.py triggers push for sniffing events...")
        
        patrol_path = "/app/backend/routers/patrol.py"
        try:
            with open(patrol_path, 'r') as f:
                patrol_content = f.read()
                patrol_lines = patrol_content.split('\n')
            
            # Find the section that handles sniffing/growling events
            found_sniffing_push = False
            for i, line in enumerate(patrol_lines):
                # Look for the condition that checks for sniffing/growling
                if 'sniffing' in line.lower() and 'growling' in line.lower():
                    # Check if push_owner_alert is called nearby
                    context = '\n'.join(patrol_lines[max(0, i-2):min(len(patrol_lines), i+5)])
                    if 'push_owner_alert' in context:
                        found_sniffing_push = True
                        break
            
            if found_sniffing_push:
                results.add_pass("Patrol triggers push for sniffing events",
                               "Found push_owner_alert call for sniffing/growling events")
            else:
                results.add_fail("Patrol triggers push for sniffing events",
                               "Could not verify push_owner_alert is called for sniffing events")
        
        except Exception as e:
            results.add_fail("patrol.py code verification", f"Error: {str(e)}")


async def main():
    """Run all tests."""
    print("="*80)
    print("APOLLO BACKEND TESTING")
    print("Provider.py Production Isolation + Sniffing/Growling Notifications")
    print("="*80)
    print(f"Backend URL: {BACKEND_URL}")
    print(f"API Base: {API_BASE}")
    
    results = TestResults()
    
    try:
        await test_provider_isolation(results)
        await test_sniffing_notifications(results)
    except Exception as e:
        print(f"\n❌ CRITICAL ERROR: {str(e)}")
        import traceback
        traceback.print_exc()
        results.add_fail("Test execution", str(e))
    
    # Print summary
    success = results.summary()
    
    # Exit with appropriate code
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    asyncio.run(main())
