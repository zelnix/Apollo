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
## Iteration 6 — Alert notifications (Emergent managed push) + Guardian Reply verification
backend:
  - task: "POST /api/register-push relay + send_push helper; push to owner on background barking/biting events, to paired guardian devices in notify_guardians, and to protected owner on guardian ack"
    implemented: true
    working: "NA"
    file: "backend/server.py"
    needs_retesting: true
frontend:
  - task: "Settings → Alert notifications card (status pill, enable / open settings); _layout.tsx notification handler, channel, tap handlers, weekly nudge; registerForPush on device identity"
    implemented: true
    working: "NA"
    file: "frontend/app/_layout.tsx, frontend/app/(tabs)/settings.tsx, frontend/src/push/notifications.ts, frontend/src/store/ApolloContext.tsx"
    needs_retesting: true
  - task: "Guardian Reply UI on /family (I called them / I messaged them → ack → visible under 'Family responses to your alerts' on owner device)"
    implemented: true
    working: "NA"
    file: "frontend/app/family.tsx"
    needs_retesting: true
agent_communication:
  - agent: "main"
    message: "EMERGENT_PUSH_KEY is 'placeholder' in dev so /api/register-push returns 500 'EMERGENT_PUSH_KEY missing or invalid' (expected) and send_push failures are logged non-blocking — event/ack endpoints must still return 200. Web preview shows push as 'Native build only'."

## Iteration 7 — Bark sounds, Family alert tap + call, Quiet hours, Battery saver/minimise, hero animations, "Patrolling" rename, Guard sheet fix
backend:
  - task: "PUT/GET /api/devices/{id}/settings quiet_hours; growling background push suppressed in quiet hours; push payloads carry channel_id/sound (threats=apollo_bark.wav, family=apollo_chime.wav); /family/pair accepts phone; /family/links/phone (guardian override); /family/links + /family/shared-events expose phone + protected_device_id; guardian push action_url=/family/alert/{event_id}"
    implemented: true
    working: "NA"
    file: "backend/server.py"
    needs_retesting: true
frontend:
  - task: "Family alert detail screen /family/alert/[id] with Call/Message/save number/ack; family.tsx rows tappable, phone field in pairing, watched-people list"
    implemented: true
    working: "NA"
    file: "frontend/app/family/alert/[id].tsx, frontend/app/family.tsx"
    needs_retesting: true
  - task: "Settings: Quiet hours (switch + TimeStepper) and Battery saver (switch + Minimise); Home background card; hero animations per state; state label 'Patrolling'"
    implemented: true
    working: "NA"
    file: "frontend/app/(tabs)/settings.tsx, frontend/app/(tabs)/home.tsx, frontend/src/components/ApolloHero.tsx, frontend/src/domain/types.ts"
    needs_retesting: true
  - task: "Guard: capability 'What's needed' → permission sheet now a single Modal (fix for sheet not opening on device); capability card tappable when permission required"
    implemented: true
    working: "NA"
    file: "frontend/app/(tabs)/guard.tsx"
    needs_retesting: true

## Iteration 8 — Gate 2 Text & Messaging + 6-state model
backend:
  - task: "POST /api/message/analyse (URL reputation for message links + Gemini second-opinion explanation JSON), POST /api/message/extract (screenshot → text via Gemini vision), ApolloState Literal now includes sniffing/ears_up, PatrolEventIn category 'message' + claimed_brand/scenario/scent_id"
    implemented: true
    working: "NA"
    file: "backend/server.py"
    needs_retesting: true
frontend:
  - task: "Six-state model (Sniffing/Patrolling/Ears up/Growling/Barking/Guarding labels), on-device rule engine src/domain/messageAnalysis.ts (M01–M15), Threat Scent src/domain/threatScent.ts, /message screen (paste, screenshot, result, links hand-off, verify sender, recovery sheets, mark safe), Home 'Check a message' + Threat Scent cards, share intake routes text → /message, Message Guard capability, MessagingSdk contract stubs, yarn test:gate2 (20/20)"
    implemented: true
    working: "NA"
    file: "frontend/app/message.tsx, frontend/src/domain/messageAnalysis.ts, frontend/src/domain/threatScent.ts, frontend/src/store/ApolloContext.tsx, frontend/app/(tabs)/home.tsx"
    needs_retesting: true

## Iteration 9 — Gate 3 Phase A (Website & Browser) + patrolling GIF + Threat Scent fix
backend:
  - task: "POST /api/intel/check expand:true follows redirects (max 5 hops) → redirect_chain hosts + final_url, judges final destination; POST /api/feedback (false_positive/override/missed_threat) stored in db.feedback"
    implemented: true
    working: "NA"
    file: "backend/server.py"
    needs_retesting: true
frontend:
  - task: "Brand & Impersonation engine src/domain/brand.ts (official domains, homograph deobfuscation, verifyWebsite); decision.ts: brand mismatch → barking/growling, uncertain → ears_up, redirect chain in why; check.tsx: calm 'Apollo is guarding' copy when blocked, redirect pill, brand pill, Verify website sheet, Technical details sheet, Continue anyway (override recorded), Report mistake sheet, RecoveryFlow (clicked/password/card/code/download/app/called); shared RecoveryFlow component also used by /message; WebSdk contract stubs; yarn test:gate3 18/18; Threat Scent keys now brand+host (fix from iteration 8); Home hero uses apollo-patrolling.gif in Patrolling state (testID apollo-hero-gif)"
    implemented: true
    working: "NA"
    file: "frontend/app/check.tsx, frontend/src/domain/brand.ts, frontend/src/domain/decision.ts, frontend/src/components/RecoveryFlow.tsx, frontend/src/domain/threatScent.ts, frontend/src/components/ApolloHero.tsx"
    needs_retesting: true

## Iteration 10 — Gate 3 Phase B (page screenshot checks)
backend:
  - task: "POST /api/page/extract {device_id,image_base64,url_hint?} → Gemini vision security signals JSON (visible_url, claimed_brand, page_type, asks_for[], virus_or_infection_claim, phone_number_to_call, remote_access_tool, captcha_instructions, wallet_connect_request, urgency_or_threat_text, prices_look_unrealistic, payment_methods[], business_identity, os_or_security_branding, text_excerpt)"
    implemented: true
    working: "NA"
    file: "backend/server.py"
    needs_retesting: true
frontend:
  - task: "src/domain/pageAnalysis.ts rule engine (W08/W09/W10/W11/W12/W14/W17/W18/W02/W03/W20); check.tsx 'Add a screenshot of the page' (check-page-screenshot) → check-page-card with state/scenario/verdict/why/recommendation/phone pill; merges into existing link event (escalates) or creates a website event with EventActions + RecoveryFlow; yarn test:gate3page 15/15"
    implemented: true
    working: "NA"
    file: "frontend/app/check.tsx, frontend/src/domain/pageAnalysis.ts, frontend/src/store/ApolloContext.tsx"
    needs_retesting: true

## Iteration 11 — Gate 4 Phone Call Protection
backend:
  - task: "PatrolEventIn category Literal adds 'call'"
    implemented: true
    working: "NA"
    file: "backend/server.py"
frontend:
  - task: "src/domain/callAnalysis.ts Call Risk Engine (C01–C20, transcript folding, claim inference); app/call.tsx Check This Call (big ask buttons, claim chips, optional number/transcript, result with Hang up & verify / Tell me why / Verify caller sheet / RecoveryFlow / Ask / mark safe); Home 'Check this call'; checkCall in ApolloContext creates 'call' events → Threat Scent; CallSdk stubs; yarn test:gate4 25/25"
    implemented: true
    working: "NA"
    file: "frontend/app/call.tsx, frontend/src/domain/callAnalysis.ts, frontend/src/store/ApolloContext.tsx, frontend/app/(tabs)/home.tsx"
    needs_retesting: true

## Iteration 12 — Gate 5 Scan Protection (QR / NFC payloads)
frontend:
  - task: "src/domain/scanPayload.ts (classifyPayload: url/payment/tel/sms/mailto/wifi/crypto/applink/geo/vcard/text; assessScan with physical-context mismatch + known official context domains); app/scan.tsx (expo-camera QR scanner w/ permission contract, paste fallback, context chips, Sniffing → preview → Gate 3 checkLink for URLs merged into one event, actions per payload type: Check number → /call?number, Open website only when resting / 'Open anyway' ghost otherwise, View destination → /check, copy, RecoveryFlow); Home 'Scan a code'; yarn test:gate5 19/19"
    implemented: true
    working: "NA"
    file: "frontend/app/scan.tsx, frontend/src/domain/scanPayload.ts"
    needs_retesting: true

## Iteration 13 — Gate 6 Files & Downloads + idempotent event sync fix
backend:
  - task: "POST /api/patrol/events now idempotent under races (DuplicateKeyError → update) — fixes iteration-12 500"
    implemented: true
    working: "NA"
    file: "backend/server.py"
frontend:
  - task: "src/domain/fileAnalysis.ts File & Content Engine (magic bytes vs extension, double/RTL extension, apk/profile/cert/archive/macro/links, F01–F20); app/file.tsx Check This File (expo-document-picker + expo-file-system head bytes/text sample, source chips, password switch, name-only check, result, links → /check, technical sheet, RecoveryFlow); Home 'Check a file'; yarn test:gate6 17/17"
    implemented: true
    working: "NA"
    file: "frontend/app/file.tsx, frontend/src/domain/fileAnalysis.ts"
    needs_retesting: true

## Iteration 14 — Gate 7 Apps & Device Protection
backend:
  - task: "POST /api/app/analyse (reputation hints: remote-access tools, security vendors, brand impersonation off-store; SDK hosts → intel domain check; optional Gemini second opinion never overriding); PatrolEventIn category adds 'app'/'device'; tests/test_gate7_app.py 9/9"
    implemented: true
    working: "NA"
    file: "backend/server.py, backend/tests/test_gate7_app.py"
    needs_retesting: true
frontend:
  - task: "src/domain/appAnalysis.ts App & Device Engine (A01–A20, context-aware scoring, permission plain-language notes); src/domain/deviceAnalysis.ts (device status Protected/Review/Action/Recovery, D01–D11, cannot-see list); app/app-check.tsx Check This App (name/developer, source/purpose chips, permission multi-select + long-press explainer, context switches, Threat Scent notice, result: state/why/recommendation, Access/Network/Reputation cards, Open Settings/Review permissions/Stay With Me/Tell me why/Keep/Report/technical); app/device.tsx Check My Device (status card, findings with Open Settings, self-report switches, cannot-see, Save to Patrol + RecoveryFlow); Home 'Check an app' + 'Check my device'; File gate → 'I installed it — check the app' handoff keeps scent; Call gate → 'They asked me to install an app' handoff; new recovery kinds remote/accessibility/profile/banking_during_access; yarn test:gate7 36/36"
    implemented: true
    working: "NA"
    file: "frontend/app/app-check.tsx, frontend/app/device.tsx, frontend/src/domain/appAnalysis.ts, frontend/src/domain/deviceAnalysis.ts, frontend/src/security/appDeviceSdk.ts, frontend/src/utils/deviceSettings.ts"
    needs_retesting: true

## Iteration 15 — Gate 8 Network & Accounts + barking GIF + Gate 7 label fix
backend:
  - task: "POST /api/account/analyse (URL intel + official-domain match per provider + password scrubbing validator + optional Gemini second opinion); POST /api/account/breach (HIBP when HIBP_API_KEY set, else truthful not_configured); PatrolEventIn category adds 'account'; tests/test_gate8_account.py 8/8"
    implemented: true
    working: "NA"
    file: "backend/server.py, backend/tests/test_gate8_account.py"
    needs_retesting: true
frontend:
  - task: "src/domain/networkAnalysis.ts (N00–N12, lookalike SSID, VPN trust, captive portal handoff, SDK summary); src/domain/accountAnalysis.ts (AC01–AC20, official-domain link check, takeover risk, recovery kinds); app/network.tsx Network Guard dashboard (protection status from capabilities, current network, 24h activity) + Check This Network (context chips, expected name, VPN switch, captive URL) → connection events; app/account.tsx Account Guard dashboard (open account events + Review) + Check Account Alert (kind/provider chips, yes/no/unsure, paste text, flags, Threat Scent linking) + breach exposure card; Home 'Network Guard' + 'Account Guard'; message → Account Guard handoff (message-check-account), call code/password → Account Guard (call-check-account); new recovery kinds mfa_approved/locked_out; connection.ts open Wi‑Fi now ears_up (N04); ApolloHero shows apollo-barking.gif for barking/biting; appAnalysis: off-store impersonators get no purpose credit (all perms flagged); yarn test:gate8 34/34, test:gate7 36/36"
    implemented: true
    working: "NA"
    file: "frontend/app/network.tsx, frontend/app/account.tsx, frontend/src/domain/networkAnalysis.ts, frontend/src/domain/accountAnalysis.ts, frontend/src/security/networkAccountSdk.ts, frontend/src/components/ApolloHero.tsx"
    needs_retesting: true

## Iteration 16 — Bug fix: Site Guard permission not persisting
frontend:
  - task: "MockSecurityAdapter now persists granted/denied protection permissions (network_filter for Site Guard, notifications) in AsyncStorage key apollo.mock.permissions and hydrates before the first capability/permission read — Site Guard no longer reverts to 'Permission required' after reload"
    implemented: true
    working: "NA"
    file: "frontend/src/security/MockSecurityAdapter.ts"
    needs_retesting: true

## Iteration 17 — Gate 1 Email + Guard tab Network/Account summary cards
backend:
  - task: "PatrolEventIn category adds 'email' (email checks reuse POST /api/message/analyse for link intel + Gemini second opinion)"
    implemented: true
    working: "NA"
    file: "backend/server.py"
frontend:
  - task: "src/domain/emailAnalysis.ts (parseEmail headers/body/attachments; E01–E13: brand impersonation via official sending domains, off-domain login links, risky attachments, changed bank details/BEC, code/identity asks, reply-to mismatch, genuine brand-domain emails); app/email.tsx Check an Email (From/Subject/Body fields or pasted forwarded email; result, sender card, links → /check, attachments → /file, 'It's about my account' → /account with scent, Verify sender sheet, RecoveryFlow, technical sheet); Home 'Check an email'; Guard tab 'Network & Accounts' section with Network Guard card (status pill from connection_guard + connection summary + open network items → /network) and Account Guard card (open account events count → /account); yarn test:gate1 13/13"
    implemented: true
    working: "NA"
    file: "frontend/app/email.tsx, frontend/src/domain/emailAnalysis.ts, frontend/app/(tabs)/guard.tsx, frontend/app/(tabs)/home.tsx"
    needs_retesting: true
