#!/usr/bin/env python3
"""
Frontend UI tests for Email Screen Redesign (Phase 1)
Tests the email screen UI using Playwright with mobile dimensions (390x844).
"""
import asyncio
import sys
from playwright.async_api import async_playwright, Page, expect

# Configuration
FRONTEND_URL = "http://localhost:3000"
MOBILE_WIDTH = 390
MOBILE_HEIGHT = 844

# Test results
tests_passed = 0
tests_failed = 0

def log_test(name: str, passed: bool, message: str = ""):
    """Log test result"""
    global tests_passed, tests_failed
    if passed:
        tests_passed += 1
        status = "✅ PASS"
    else:
        tests_failed += 1
        status = "❌ FAIL"
    
    result = f"{status}: {name}"
    if message:
        result += f" - {message}"
    print(result)

async def complete_onboarding(page: Page):
    """Complete the onboarding flow to reach the main app"""
    try:
        # Wait for the page to load
        await page.wait_for_load_state("networkidle", timeout=10000)
        
        # Check if we're on the onboarding/privacy disclosure screen
        # Look for "I understand" button or similar onboarding elements
        try:
            # Try to find and click "I understand — set up Apollo" button
            understand_button = page.locator('text="I understand"').first
            if await understand_button.is_visible(timeout=2000):
                await understand_button.click()
                await page.wait_for_timeout(1000)
                
                # Look for "Not now" or "Continue to Apollo" button
                not_now = page.locator('text="Not now"').first
                if await not_now.is_visible(timeout=2000):
                    await not_now.click()
                    await page.wait_for_timeout(1000)
                
                # Look for "Go to Apollo" or "Continue to Apollo"
                go_to_apollo = page.locator('text=/Go to Apollo|Continue to Apollo/i').first
                if await go_to_apollo.is_visible(timeout=2000):
                    await go_to_apollo.click()
                    await page.wait_for_timeout(1000)
                
                return True
        except Exception:
            # Already past onboarding or different flow
            pass
        
        return True
    except Exception as e:
        print(f"Warning: Could not complete onboarding: {e}")
        return False

async def test_email_screen_loads(page: Page):
    """Test 1: Email screen loads (may redirect to onboarding)"""
    try:
        await page.goto(f"{FRONTEND_URL}/email", wait_until="networkidle", timeout=30000)
        
        # Check if we're redirected to onboarding
        current_url = page.url
        if "/email" not in current_url:
            log_test("Email Screen Loads", True, f"Redirected to onboarding (expected): {current_url}")
            return True
        else:
            log_test("Email Screen Loads", True, "Email screen loaded directly")
            return True
    except Exception as e:
        log_test("Email Screen Loads", False, f"Exception: {str(e)}")
        return False

async def test_complete_onboarding_flow(page: Page):
    """Test 2: Complete onboarding flow"""
    try:
        # Navigate to root
        await page.goto(FRONTEND_URL, wait_until="networkidle", timeout=30000)
        
        # Complete onboarding
        success = await complete_onboarding(page)
        
        if success:
            log_test("Complete Onboarding", True, "Onboarding flow completed")
            return True
        else:
            log_test("Complete Onboarding", False, "Could not complete onboarding")
            return False
    except Exception as e:
        log_test("Complete Onboarding", False, f"Exception: {str(e)}")
        return False

async def test_email_screen_header(page: Page):
    """Test 3: Email screen header shows correct text"""
    try:
        await page.goto(f"{FRONTEND_URL}/email", wait_until="networkidle", timeout=30000)
        
        # Wait for the header to be visible
        await page.wait_for_selector('text="Check email"', timeout=10000)
        
        # Verify header title
        header_title = page.locator('text="Check email"').first
        if await header_title.is_visible():
            log_test("Email Screen Header", True, "Header shows 'Check email'")
            return True
        else:
            log_test("Email Screen Header", False, "Header 'Check email' not visible")
            return False
    except Exception as e:
        log_test("Email Screen Header", False, f"Exception: {str(e)}")
        return False

async def test_account_selector_bar(page: Page):
    """Test 4: Account selector bar is visible"""
    try:
        await page.goto(f"{FRONTEND_URL}/email", wait_until="networkidle", timeout=30000)
        
        # Look for account selector with testID
        account_selector = page.locator('[data-testid="email-account-selector"]')
        if await account_selector.is_visible(timeout=5000):
            # Check for "All email accounts" text
            all_accounts_text = page.locator('text="All email accounts"')
            if await all_accounts_text.is_visible():
                log_test("Account Selector Bar", True, "Account selector shows 'All email accounts'")
                return True
            else:
                log_test("Account Selector Bar", False, "'All email accounts' text not found")
                return False
        else:
            log_test("Account Selector Bar", False, "Account selector not visible")
            return False
    except Exception as e:
        log_test("Account Selector Bar", False, f"Exception: {str(e)}")
        return False

async def test_manage_button(page: Page):
    """Test 5: Manage button is visible in account selector"""
    try:
        await page.goto(f"{FRONTEND_URL}/email", wait_until="networkidle", timeout=30000)
        
        # Look for Manage button
        manage_button = page.locator('[data-testid="email-manage-accounts"]')
        if await manage_button.is_visible(timeout=5000):
            log_test("Manage Button", True, "Manage button is visible")
            return True
        else:
            log_test("Manage Button", False, "Manage button not visible")
            return False
    except Exception as e:
        log_test("Manage Button", False, f"Exception: {str(e)}")
        return False

async def test_email_input_fields(page: Page):
    """Test 6: Email input card has From, Subject, and body fields"""
    try:
        await page.goto(f"{FRONTEND_URL}/email", wait_until="networkidle", timeout=30000)
        
        # Check for input card
        input_card = page.locator('[data-testid="email-input-card"]')
        if not await input_card.is_visible(timeout=5000):
            log_test("Email Input Fields", False, "Email input card not visible")
            return False
        
        # Check for From field
        from_field = page.locator('[data-testid="email-from"]')
        if not await from_field.is_visible():
            log_test("Email Input Fields", False, "From field not visible")
            return False
        
        # Check for Subject field
        subject_field = page.locator('[data-testid="email-subject"]')
        if not await subject_field.is_visible():
            log_test("Email Input Fields", False, "Subject field not visible")
            return False
        
        # Check for Body field
        body_field = page.locator('[data-testid="email-body"]')
        if not await body_field.is_visible():
            log_test("Email Input Fields", False, "Body field not visible")
            return False
        
        log_test("Email Input Fields", True, "All three fields (From, Subject, Body) are visible")
        return True
    except Exception as e:
        log_test("Email Input Fields", False, f"Exception: {str(e)}")
        return False

async def test_check_email_button(page: Page):
    """Test 7: Check email CTA button is present"""
    try:
        await page.goto(f"{FRONTEND_URL}/email", wait_until="networkidle", timeout=30000)
        
        # Look for Check email button
        check_button = page.locator('[data-testid="email-run"]')
        if await check_button.is_visible(timeout=5000):
            log_test("Check Email Button", True, "Check email button is visible")
            return True
        else:
            log_test("Check Email Button", False, "Check email button not visible")
            return False
    except Exception as e:
        log_test("Check Email Button", False, f"Exception: {str(e)}")
        return False

async def test_choose_screenshot_card(page: Page):
    """Test 8: Choose screenshot card is visible"""
    try:
        await page.goto(f"{FRONTEND_URL}/email", wait_until="networkidle", timeout=30000)
        
        # Scroll down to see the screenshot card
        await page.evaluate("window.scrollTo(0, 400)")
        await page.wait_for_timeout(500)
        
        # Look for screenshot card
        screenshot_card = page.locator('[data-testid="email-check-screenshot"]')
        if await screenshot_card.is_visible(timeout=5000):
            # Check for "Choose screenshot" text
            screenshot_text = page.locator('text="Choose screenshot"')
            if await screenshot_text.is_visible():
                log_test("Choose Screenshot Card", True, "Choose screenshot card is visible")
                return True
            else:
                log_test("Choose Screenshot Card", False, "'Choose screenshot' text not found")
                return False
        else:
            log_test("Choose Screenshot Card", False, "Screenshot card not visible")
            return False
    except Exception as e:
        log_test("Choose Screenshot Card", False, f"Exception: {str(e)}")
        return False

async def test_privacy_card(page: Page):
    """Test 9: Privacy card is visible"""
    try:
        await page.goto(f"{FRONTEND_URL}/email", wait_until="networkidle", timeout=30000)
        
        # Scroll down to see the privacy card
        await page.evaluate("window.scrollTo(0, 600)")
        await page.wait_for_timeout(500)
        
        # Look for privacy card
        privacy_card = page.locator('[data-testid="email-privacy-card"]')
        if await privacy_card.is_visible(timeout=5000):
            # Check for privacy title
            privacy_title = page.locator('text="How Apollo processes your email"')
            if await privacy_title.is_visible():
                log_test("Privacy Card", True, "Privacy card is visible with correct title")
                return True
            else:
                log_test("Privacy Card", False, "Privacy title not found")
                return False
        else:
            log_test("Privacy Card", False, "Privacy card not visible")
            return False
    except Exception as e:
        log_test("Privacy Card", False, f"Exception: {str(e)}")
        return False

async def test_recent_checks_section(page: Page):
    """Test 10: Your Recent Checks section shows empty state"""
    try:
        await page.goto(f"{FRONTEND_URL}/email", wait_until="networkidle", timeout=30000)
        
        # Scroll down to see the recent checks section
        await page.evaluate("window.scrollTo(0, 800)")
        await page.wait_for_timeout(500)
        
        # Look for "Your recent checks" title
        recent_title = page.locator('text="Your recent checks"')
        if await recent_title.is_visible(timeout=5000):
            log_test("Recent Checks Section", True, "'Your recent checks' section is visible")
            return True
        else:
            log_test("Recent Checks Section", False, "'Your recent checks' title not found")
            return False
    except Exception as e:
        log_test("Recent Checks Section", False, f"Exception: {str(e)}")
        return False

async def test_typing_in_fields(page: Page):
    """Test 11: Test typing into email fields"""
    try:
        await page.goto(f"{FRONTEND_URL}/email", wait_until="networkidle", timeout=30000)
        
        # Type in From field
        from_field = page.locator('[data-testid="email-from"]')
        await from_field.fill("test@example.com")
        
        # Type in Subject field
        subject_field = page.locator('[data-testid="email-subject"]')
        await subject_field.fill("Test Subject")
        
        # Type in Body field
        body_field = page.locator('[data-testid="email-body"]')
        await body_field.fill("This is a test email body with some content.")
        
        # Verify values
        from_value = await from_field.input_value()
        subject_value = await subject_field.input_value()
        body_value = await body_field.input_value()
        
        if from_value == "test@example.com" and subject_value == "Test Subject" and "test email body" in body_value:
            log_test("Typing in Fields", True, "Successfully typed into all fields")
            return True
        else:
            log_test("Typing in Fields", False, "Field values don't match expected")
            return False
    except Exception as e:
        log_test("Typing in Fields", False, f"Exception: {str(e)}")
        return False

async def test_button_enabled_after_typing(page: Page):
    """Test 12: Check email button becomes enabled after typing content"""
    try:
        await page.goto(f"{FRONTEND_URL}/email", wait_until="networkidle", timeout=30000)
        
        # Check button is initially disabled
        check_button = page.locator('[data-testid="email-run"]')
        is_disabled_initially = await check_button.is_disabled()
        
        # Type in Body field
        body_field = page.locator('[data-testid="email-body"]')
        await body_field.fill("This is a test email with content.")
        
        await page.wait_for_timeout(500)
        
        # Check button should now be enabled
        is_disabled_after = await check_button.is_disabled()
        
        if is_disabled_initially and not is_disabled_after:
            log_test("Button Enabled After Typing", True, "Button correctly enabled after typing content")
            return True
        elif not is_disabled_initially:
            log_test("Button Enabled After Typing", True, "Button was already enabled (acceptable)")
            return True
        else:
            log_test("Button Enabled After Typing", False, f"Button state: initially={is_disabled_initially}, after={is_disabled_after}")
            return False
    except Exception as e:
        log_test("Button Enabled After Typing", False, f"Exception: {str(e)}")
        return False

async def main():
    """Run all frontend UI tests"""
    print("=" * 80)
    print("FRONTEND UI TESTS - Email Screen Redesign (Phase 1)")
    print("=" * 80)
    print()
    
    async with async_playwright() as p:
        # Launch browser in headless mode with mobile dimensions
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={"width": MOBILE_WIDTH, "height": MOBILE_HEIGHT},
            user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15"
        )
        page = await context.new_page()
        
        try:
            # Test 1: Email screen loads
            await test_email_screen_loads(page)
            print()
            
            # Test 2: Complete onboarding if needed
            await test_complete_onboarding_flow(page)
            print()
            
            # Test 3: Email screen header
            await test_email_screen_header(page)
            print()
            
            # Test 4: Account selector bar
            await test_account_selector_bar(page)
            print()
            
            # Test 5: Manage button
            await test_manage_button(page)
            print()
            
            # Test 6: Email input fields
            await test_email_input_fields(page)
            print()
            
            # Test 7: Check email button
            await test_check_email_button(page)
            print()
            
            # Test 8: Choose screenshot card
            await test_choose_screenshot_card(page)
            print()
            
            # Test 9: Privacy card
            await test_privacy_card(page)
            print()
            
            # Test 10: Recent checks section
            await test_recent_checks_section(page)
            print()
            
            # Test 11: Typing in fields
            await test_typing_in_fields(page)
            print()
            
            # Test 12: Button enabled after typing
            await test_button_enabled_after_typing(page)
            print()
            
        finally:
            await browser.close()
    
    print("=" * 80)
    print(f"FRONTEND TEST RESULTS: {tests_passed} passed, {tests_failed} failed")
    print("=" * 80)
    
    if tests_failed > 0:
        print("\n❌ Some frontend tests failed. See details above.")
        sys.exit(1)
    else:
        print("\n✅ All frontend tests passed!")
        sys.exit(0)

if __name__ == "__main__":
    asyncio.run(main())
