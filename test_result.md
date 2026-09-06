#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================
## Iteration 4 (main agent, 2026-06) — post-resign + recovery checklist
- Resigned real controlled bundle (Elastic IP confirmed): final v25, keyId gd-m1-test-ed25519-001, payloadHash 2581666c…, single block rule blocktest.btciq.app.
- New: backend/scripts/verify_resigned_bundle.py (10-point check → docs/evidence/resigned-bundle-verification.json).
- Live pytest suites updated to post-resign expectations and made read-only (mutating happy-path gated by GD_ALLOW_LIVE_RESIGN=1).
- Frontend harness: recovery steps (stop / tun-closed / route-cleared / recovered) after block proof; probe requires real HTTP 200 on native; HarnessResult has recovery, enforcementStats, recoveryComplete.
- Proof report m1-2: recovery chain; JSON written to device file (expo-file-system) + PDF + share sheet (expo-sharing); web shows JSON inline, PDF = print dialog.
- Native (not runtime-verifiable here): RecoveryInspector/getRecoveryStatus (Android + iOS), E2E test step 6, TunSessionRecoveryTest new case.
- Test focus: backend read APIs (/api/config isPlaceholder=false, /latest v25 single rule, /versions, /keys, /intelligence/lookup block for blocktest.btciq.app, sign guard 401/409/403 without mutating), web harness UI (honest BLOCKED/SKIPPED, Build JSON evidence shows recovery fields, no fake THREAT_BLOCKED). Do NOT POST /api/rules/sign with confirm=true for gd-m1-controlled-block.

## Iteration 5 (main agent) — review corrections + Android native gate executed
- getRecoveryStatus removed from public SDK (harness adapter src/harness/recoveryDiagnostics.ts); TRANSPORT_VPN supporting-only; bundle FROZEN v25 (GD_M1_FROZEN_BUNDLE_VERSION → POST /api/rules/sign 409 BUNDLE_FROZEN for controlled ruleset; /api/config.signing.frozenBundleVersion=25).
- Android native gate run for real in this container (JDK17/Android SDK/Gradle installed): PASSED, 29 Kotlin tests. Fixed: erdtman coordinate, fun interface, RuleBundleVerifier raw type check, config plugin serialization classpath.
- Test focus now: regression of backend read APIs + freeze guard (409 BUNDLE_FROZEN with confirm:true for gd-m1-controlled-block; latest stays 25), web harness unchanged behaviour, evidence files exist (docs/evidence/android-native-gate.txt contains "ANDROID NATIVE GATE PASSED" and "29 run, 0 failed").

## Iteration 6 (main agent) — signing-key trust boundary fix (reviewer stop)
- Bug: GitHub Actions `android-dev-build` job required secret GD_M1_SIGNING_PRIVATE_KEY_B64 (because android-dev-build.sh ran verify_controlled_endpoint.py via backend settings). Fixed: job now needs only repo var GD_BACKEND_URL; script uses `verify_controlled_endpoint.py --api <url>` (public /api/config) and asserts served bundle == frozen version and signed by the SDK-pinned public key. No secrets in that job.
- Backend distribution-only mode: GD_SIGNING_ENABLED=false → private key optional; KeyRegistryService.can_sign; main.py skips seed signing. tests/test_distribution_only_mode.py.
- Live backend unchanged (signing enabled, frozen v25). Verify: workflow yaml has no `secrets.` in android-dev-build job; `python scripts/verify_controlled_endpoint.py --api <backend>` exits 0 without any GD_* env; pytest 85 offline / 134 live pass; /api endpoints unchanged.

## Iteration 7 (main agent) — CI key hygiene + APK recheck tooling
- Workflow has zero secrets: executable-suites generates ephemeral Ed25519 seeds; GD_CI_EPHEMERAL_KEY=1 skips test_pinned_public_key_matches_env_private_key + test_regeneration_is_byte_identical.
- New tests/test_frozen_bundle_public_verification.py (4 tests; public key only; uses security/frozen/controlled-bundle-v25.json).
- New scripts/ci/apk-recheck.sh (needs aapt2 + APK; not runnable here) — python blocks unit-checked with fake dirs.
- Verify: pytest offline 89 pass; with ephemeral seeds + GD_CI_EPHEMERAL_KEY=1 + DB_NAME=ci_ephemeral → 87 pass / 39 skipped, 0 fail; live backend still v25; frozen-bundle tests pass with no env.
