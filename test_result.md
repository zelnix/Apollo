## 2026-09-23 Package 6 verification and GuardDog production-default source activation

- Owner authority: `memory/APOLLO_GUARDDOG_PRODUCTION_AUTHORITY.md`; its FIRST / CRITICAL boundaries were applied without changing frozen GuardDog source.
- Package 6 corrections: macOS now enables/disables and observes `NEFilterManager`; Windows WFP evidence uses contract-safe IDs/domain/protocol, bounded files and preserves adapter failures; desktop flow evidence remains Barking rather than packet-backed Biting; stale delivery matrices corrected.
- GuardDog: production/app-bundle fail closed to `guarddog_production`; native legacy activation is rejected; the accepted production engine is wired into frozen M2 DNS gateway/sinkhole/upstream DNS/allow-only override/drop-reporting paths; boot/unlock/package update and physical-network DNS changes reconcile persisted intent.
- Trust: primary/recovery public roots must be independent; private keys remain prohibited; strict signed-manifest/rule expiry, rollback, revocation and HMAC-bound state remain in force.
- Validation PASS: TypeScript; ESLint; 381/381 Node; 9/9 GuardDog source pytest; 91/91 frozen hashes; 58/58 provider-disabled backend pytest; Android Apollo Kotlin compile; production security/native-dependency preflight; Package 6 preflight; Cargo check; 5/5 Rust; Windows x64 WFP cross-link; Expo package/extensions resolution (`app.apollo.hwg`, four iOS extensions).
- Not run/claimed: testing agent, Playwright, scenario automation, live Gemini, signed artifacts, notarisation, installer production, or physical-device acceptance.

---

## 2026-09-21 continuation — Gemini-only migration (PARTIAL overall package)

See `docs/GEMINI_ONLY_MIGRATION_STATUS.md` for evidence and the AR01–AR16 acceptance matrix.
No testing agent authorised or used. Direct real-provider/API/mobile-preview checks performed instead.
Local preflight: 35/35. Full ten browser journeys: NOT_RUN; no claim of full Round 1 completion.
Immutable final run: `test_reports/round1_runs/20260921T052622-36a53a2b/round1_expected_vs_actual_repeatable.json` (194 source fingerprints).
Final checks: Python static/compile, TypeScript/ESLint, Gemini-only config, request deadlines and AI opt-out pass.
126 tracked native/package files plus Metro and the package entry remain unchanged from fork baseline 33a2383.
Managed AI/email/push/storage paths removed. Direct email, push and family audio storage remain BLOCKED on owner configuration.
Shared research/case/job engine and full-document ingestion remain unfinished. Physical Stage 1D remains CANCELLED.

---

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
## P0 remediation stage — current implementation and targeted follow-up
backend:
  - task: "P0-01/03/04/05 hardened pinned outbound transport, packet-only evidence, local-first processing and evidence receipts"
    implemented: true
    working: "NA"
    needs_retesting: false
    priority: "high"
    status_history:
      - agent: "main"
        comment: "iteration_62 has 23 passing new tests but does not cover actual numeric connect/SNI/redirect/fallback, frontend mapper-egress-auth-Mongo dispatch path or failure races. Do not close full stage on that subset. Need targeted follow-up. GuardDog remains 91/91 unchanged. No auth source changes."
frontend:
  - task: "P0-02/03/04/05/06 freshness/clock, packet gates, privacy inventory, durable queue, bounded file inspection"
    implemented: true
    working: "NA"
    needs_retesting: true
    priority: "high"
    status_history:
      - agent: "main"
        comment: "Mobile routes compile/load and legacy Gate suites passed. Fixed discovered queue ack-storage-failure/restart-status/version-reversion cases; pause before clear to prevent in-flight resurrection; bounded health probes and caller rejection qualified. Need new pure tests for queue, state clock/recovery, packet+egress, file read bounds; no physical device or live packet proof is claimed."
agent_communication:
  - agent: "main"
    message: "Current report iteration_62; not historical iteration_1. Only test/report edits by testing agent. Retire obsolete tests by rewriting unsafe inputs/expectations to current allowed behavior, preserving negatives; do not merely delete tests. Capture exact totals and remaining failures."

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

## Iteration 19 — Share Into Apollo + Incident Timeline
frontend:
  - task: "src/share/classifyShare.ts routes shared payloads (file→/file, image→/message screenshot, email headers/body→/email, login/MFA/reset text→/account, bare link→/check, else /message) + alternativeRoutes; app/share.tsx landing screen ('Looks like …', Check as …, Not that? alternatives); ShareIntakeListener now pushes /share with text/url/file params; app.json share-intent activation adds images + files; message.tsx accepts imageUri (reads base64, runs /message/extract); file.tsx accepts uri/name/mime/size and analyses on open. Incident Timeline: src/domain/incidentPlan.ts (ordered timeline, highest state, recovery kinds inferred from recorded recoveries + scenarios, one deduplicated Stay With Me plan) + app/patrol/scent/[id].tsx (summary, timeline rows → event detail, tickable steps with progress, Ask, mark whole incident handled); Home Threat Scent card is tappable → timeline; event detail shows 'View incident timeline' when linked. RECOVERY_STEPS moved to src/domain/recovery.ts (re-exported from ApolloContext). yarn test:share 11/11"
    implemented: true
    working: "NA"
    file: "frontend/app/share.tsx, frontend/app/patrol/scent/[id].tsx, frontend/src/share/classifyShare.ts, frontend/src/domain/incidentPlan.ts"
    needs_retesting: true

## Iteration 20 — fixes from iteration 19 + sniffing GIF
frontend:
  - task: "upsertEvent reads eventsRef (updated synchronously in persistEvents) so back-to-back upserts don't overwrite each other; incident timeline resolveAll upserts each linked event → all become Handled + incident-handled pill. alternativeRoutes emits message/email/account alternatives for URL-only shares. Hero shows apollo-sniffing.gif (testID apollo-hero-gif-sniffing) while refreshing (Verify now / pull-to-refresh) — transient Sniffing state."
    implemented: true
    working: "NA"
    file: "frontend/src/store/ApolloContext.tsx, frontend/app/patrol/scent/[id].tsx, frontend/src/share/classifyShare.ts, frontend/src/components/ApolloHero.tsx, frontend/app/(tabs)/home.tsx"
    needs_retesting: true

## Iteration 21 — Family Incident Sharing + Weekly Digest incidents + palette
backend:
  - task: "POST /api/family/incidents/share (fan-out to paired guardians + push), PATCH /api/family/incidents/{scent_id}/progress, GET /api/family/incidents, GET /api/family/incidents/{scent_id}; tests/test_family_incidents.py 3/3"
    implemented: true
    working: "NA"
    file: "backend/server.py"
frontend:
  - task: "Incident timeline: tick progress persisted (apollo.incident.<id>), 'Ask my family for help' shares headline/timeline/steps/ticks (never message text) and mirrors progress + handled state; guardian screen app/family/incident/[id].tsx (read-only timeline, live progress, call); Family screen 'Incidents shared with you' section. Weekly digest: 'Connected incidents' card (handled vs still open, stopped vs still-open events per incident, tap → timeline) via buildDigestIncidents. Theme palette: sniffing Muted Silver, ears_up Watchful Amber, growling Alert Orange, barking+guarding Threat Red; export colours matched."
    implemented: true
    working: "NA"
    file: "frontend/app/patrol/scent/[id].tsx, frontend/app/family/incident/[id].tsx, frontend/app/family.tsx, frontend/app/digest.tsx, frontend/src/domain/digest.ts, frontend/src/theme.ts"
    needs_retesting: true

## Iteration 22 — Family Reassurance Note + hero GIF fixes
backend:
  - task: "POST /api/family/incidents/{scent_id}/notes (guardian only; kinds here/calling/on_way/together/custom ≤140 chars; from_name remembered on link as guardian_label; push to protected device), GET /api/family/incidents/{scent_id}/notes?device_id= (protected sees all, guardian sees own, stranger empty). tests/test_family_notes.py 2/2"
    implemented: true
    working: "NA"
    file: "backend/server.py"
frontend:
  - task: "Guardian view app/family/incident/[id].tsx: 'Send a reassurance note' card (preset chips family-note-kind-*, 'Write my own' → family-note-text, family-note-name remembered, family-note-send, sent list family-note-sent-N). Protected timeline app/patrol/scent/[id].tsx: once shared, polls notes and shows 'From your family' card (incident-family-notes / incident-family-note-N). Hero: sniffing/growling/barking GIFs re-encoded transparent; code shake/bounce removed for GIF states."
    implemented: true
    working: "NA"
    file: "frontend/app/family/incident/[id].tsx, frontend/app/patrol/scent/[id].tsx, frontend/src/components/ApolloHero.tsx"
    needs_retesting: true

## Iteration 23 — Family Weekly Check-In + Guardian Call-Back Number
backend:
  - task: "GET /api/family/weekly?device_id=<guardian> → per watched person: count-only 7-day summary (total, by_state, alerts, open_alerts, handled_alerts, blocked, active_days, shared_incidents, shared_resolved, last_seen_at, phone) — never headlines. Notes: IncidentNoteIn.phone (scrubbed), remembered on link as guardian_phone, returned on notes. tests/test_family_weekly.py 3/3"
    implemented: true
    working: "NA"
    file: "backend/server.py"
frontend:
  - task: "Family screen 'Weekly check-in' section (family-weekly, family-weekly-<pid>, -tone-, -headline-, -details-, -call-) via src/domain/familyWeekly.ts (weeklyHeadline/weeklyDetails/lastSeenLabel; yarn test:family 7/7). Guardian note composer: family-note-phone (remembered). Protected timeline: 'Call <name> back' button incident-family-note-call-N when note has phone. Pair card copy mentions weekly check-in."
    implemented: true
    working: "NA"
    file: "frontend/app/family.tsx, frontend/app/family/incident/[id].tsx, frontend/app/patrol/scent/[id].tsx, frontend/src/domain/familyWeekly.ts"
    needs_retesting: true

## Iteration 24 — Sunday check-in notification
backend:
  - task: "weekly_checkin_loop/tick (Sunday 17–20 local via device tz_offset_minutes, quiet hours respected, once per ISO week, opt-out), GET/PUT /api/family/weekly/notify, POST /api/family/weekly/send-now {preview_only}. tests/test_family_weekly_push.py 5/5"
    implemented: true
    working: true
    file: "backend/server.py"
frontend:
  - task: "Family weekly card: family-weekly-notify-switch, family-weekly-preview → family-weekly-preview-text, family-weekly-send-now (native only). Register sends tz_offset_minutes. Self-tested via screenshot: preview text renders."
    implemented: true
    working: true
    file: "frontend/app/family.tsx, frontend/src/store/ApolloContext.tsx, frontend/src/domain/privacy.ts"

## Iteration 25 — Check-In Reply
backend:
  - task: "POST /api/family/weekly/checkin {device_id, protected_device_id, reply spoke|messaged|will_call, from_name} (404 if not paired; upsert per week; push to protected), GET /api/family/weekly/checkins. tests/test_family_checkin.py 2/2"
    implemented: true
    working: true
frontend:
  - task: "Family weekly row: family-weekly-checkin-spoke-<pid> / -messaged-<pid> → family-weekly-checkin-done-<pid> pill; protected user sees family-checkins-received rows in the Family responses card. Self-tested via screenshot."
    implemented: true
    working: true

## Iteration 26 — Higgins (voice + persona), owner attribution, Tuesday nudge
backend:
  - task: "HIGGINS_VOICE persona prefix on all LLM prompts (ask/stream, gate2/7/8 explain); POST /api/voice/speak {device_id,text} → {url:/api/voice/<key>.mp3} (OpenAI tts-1 voice fable via EMERGENT_LLM_KEY, cached in Mongo voice_cache, text cleaned: emoji/links/markdown), GET /api/voice/{key}.mp3 audio/mpeg; Higgins-voiced push titles (Sunday check-in, Tuesday nudge, incident share); weekly_sentence Higgins wording; email footer 'Apollo is a brand of Harmony Wellness Group'; missed_checkin_tick Tuesday 17–20 local, POST /api/family/weekly/send-now kind=nudge. tests: test_voice.py 2/2, test_family_nudge.py 2/2, test_family_weekly_push.py 5/5"
    implemented: true
    working: true
frontend:
  - task: "Ask Apollo → Ask Higgins everywhere (tab 'Higgins', header, buttons, empty card, placeholder); HigginsSpeakButton (src/components) + src/voice/higgins.ts (module-level expo-audio player, tap again to stop): hero-hear-higgins on Home hero, ask-hear-<msgId> under each Higgins reply, check-hear-higgins (compact) on check result; Settings 'Higgins' voice' card: settings-higgins-auto switch (auto-read barking/biting check results) + settings-higgins-sample; Settings 'About' card (Harmony Wellness Group); privacy disclosure: owner sentence + 'The sentence Higgins reads aloud' row; STATE_MEANING + RECOVERY_STEPS + familyWeekly sentences in Higgins voice; Family weekly card: 'Preview Sunday's' / 'Preview Tuesday's' (family-weekly-preview / family-weekly-preview-nudge)."
    implemented: true
    working: "NA"
    needs_retesting: true

## Iteration 27 — Higgins daily greeting
frontend:
  - task: "HigginsGreeting card (higgins-greeting, -text, -hear, -dismiss) on Home once per local day, state-matched lines; auto-speak when apollo.voice.auto is on. Self-tested via screenshot."
    implemented: true
    working: true

## Iteration 28 — Higgins reads Patrol
frontend:
  - task: "HigginsReadAloud on /patrol/[id] (event-read-button/-progress) and /patrol/scent/[id] (incident-read-*); queued TTS playback with prefetch; narration builders unit-tested. Self-tested via screenshot (progress advanced 1→2 of 4)."
    implemented: true
    working: true

## Iteration 29 — Security Hardening Gate: truth of state
frontend:
  - task: "Guard master card testIDs guard-master-title/-line/-truth/-coverage/-degraded, pills guard-truth-requested/-operational/-verified; switch bound to requested. Mock: 'Apollo is guarding what he can · Site Guard simulated', blockDestination never verified (biting unreachable in mock). Native Kotlin/Swift truth changes untestable here."
    implemented: true
    working: true

## Iteration 30 — Device authentication (needs E2E sweep)
backend:
  - task: "Server-issued device identity + bearer tokens, router-wide enforcement, rotate/revoke. tests/test_device_auth.py 8/8; conftest auth shim for legacy suites."
    implemented: true
    working: true
frontend:
  - task: "src/auth/deviceIdentity.ts + authenticated API client + identity reset on 401. E2E scripts must read localStorage 'apollo.device.identity.v2' ({deviceId, token}) and send Authorization: Bearer for API-side pairing. Smoke-tested only."
    implemented: true
    working: "NA"
    needs_retesting: true
  - Update (iter 30b): 401 no longer auto re-registers. ApolloContext exposes identityReset + reRegisterDevice(); Home shows identity-reset-card (identity-reset-why, identity-reset-register). Email confirm token single-use + 72h expiry. tests/test_device_auth.py 12/12 (lifecycle: expiry, concurrent rotation, revoked never restored, confirm single-use/expiry).

## Iteration 32 — Hardening Gate step 3: failure modes + external admin console key
backend:
  - task: "Safe Browsing malformed-shape guard (non-dict / non-list matches → unavailable, never clear); redirect expansion bounded 12 s total; tests/test_failure_modes.py 17/17 (combine matrix, SB timeout/401/5xx/unreadable/wrong-shape → unavailable, expired reputation_cache row never served as fresh, 422 for malformed body, /health public)."
    implemented: true
    working: true
  - task: "Admin console: X-Admin-Key (APOLLO_ADMIN_KEY in backend/.env, hmac.compare_digest, generic 401, 503 if unconfigured) on separate router /api/admin/{ping,stats,blocklist[GET/POST/DELETE {host}],feedback,devices,devices/{id},devices/{id}/revoke}. Device bearer never opens admin; admin key never opens device routes. Blocklist changes flush reputation_cache. tests/test_admin.py 10/10."
    implemented: true
    working: true
  - conftest: legacy→real id map now shared across xdist workers via a per-run /tmp JSON file (fixes cross-class pairing flake in test_family.py). test_device_auth tamper case made deterministic.
  - NOTE: test_family.py guardian-email tests fail while the Resend relay returns 429 (rate limit) → backend answers 502 "Failed to send email" by design. Environmental, not a regression.
frontend:
  - task: "Failure contract: API client per-endpoint time budgets (20 s default, 60 s for AI/vision/TTS/intel/ask) via AbortController → ApiError(kind offline|timeout|malformed); 401 → identity reset, 403 → NEVER resets identity; 5xx → degraded. Backend health tracker (src/api/backendHealth.ts) fed by every call; /health re-probe every 30 s (120 s battery saver) while down + on foreground; recovery ONLY on a fresh successful observation, then queries refetch and a setup-complete install that couldn't register at boot registers now (unless identity-reset). registerDeviceIdentity bounded 15 s + shape-checked; boot heartbeat no longer blocks readiness. ServiceBanner (service-banner, -title, -line, -last, -retry) on Home, Guard, Family: 'Apollo can't reach the security service / … having trouble / … slow to answer' + 'Local protection continues where available. New online checks may be unavailable.' Guard master card mixed state: operational + service down → 'Apollo is guarding what he can · … · Online checks unavailable right now'. check.tsx pills check-result-intel-unavailable / -partial, check-result-intel-error. parseIntelResult rejects malformed intel (→ unavailable, never clean); message/analyse urls/explanation shape-guarded. StaleNote (family-stale-note, family-incident-stale, incident-family-notes-stale) 'Showing what Apollo last saw at HH:MM — may be out of date'; family incident/alert screens say 'can't reach the security service' instead of 'isn't available' when offline with no data. tests/failureModes.test.ts 15/15 (yarn test:failure). Self-tested in web: backend stopped → banner + Guard mixed copy; backend restarted → banner auto-cleared on the 30 s probe and the device registered (recovery registration observed in DB)."
    implemented: true
    working: true
    needs_retesting: true

## Iteration 33 — Hardening Gate step 4: backend split (zero behaviour change)
backend:
  - task: "server.py (2100 lines) → server.py (app + lifespan + router mounting, 68 lines), core/{config,db,models,auth}.py, services/{intel,email}.py, routers/{health,devices,intel,patrol,ask,family,family_weekly,voice,push,analysis,admin}.py. Route table verified identical to the monolith (68 routes: same paths/methods/handler names); every /api route carries enforce_device_auth, every /api/admin route carries require_admin_key. on_event → lifespan (deprecation gone). Tests importing `server` now import routers.family_weekly / services.intel / core.db. Full suite 173/174 (1 = pre-existing log-tail race in test_iter7 under xdist; passes alone)."
    implemented: true
    working: true
    needs_retesting: true

## Iteration 33b — Hardening Gate step 5: native security tests (code only; cannot execute here)
native:
  - task: "Android: SiteGuardTruth.kt (pure) + SiteGuardTruthTest.kt (8 tests); module delegates status/verified-block to it. iOS: SiteGuardTruthTests.swift +5 tests; rules(for:) dedupes hosts. SITE_GUARD_NATIVE.md: run commands + 11-row physical-device matrix. No JDK/Xcode in sandbox — compile/run in Publish builds."
    implemented: true
    working: "NA"

## Iteration 34 — Unlink Device + Phase A Android signals
backend:
  - task: "GET /api/family/links {i_watch[].link_id, watching_me, watchers[]}; DELETE /api/family/links/{link_id}?device_id= 204 (either side), 404 stranger/unknown, 403 mismatched id. tests/test_family_unlink.py 3/3."
    implemented: true
    working: true
frontend:
  - task: "Family: watcher rows family-watcher-<link_id> with family-watcher-remove-<link_id>; watched rows get family-watch-stop-<protected_device_id>; confirm dialog then DELETE; toast 'Pairing removed…'. app-check merges native SDK facts (installSource/permissions/remote capability) when available (native only)."
    implemented: true
    working: "NA"
    needs_retesting: true
native:
  - task: "Android AppDeviceCatalog.kt + AppDeviceSignals.kt + module functions + manifest <queries>; AppDeviceCatalogTest.kt 5 tests. Cannot compile/run here."
    implemented: true
    working: "NA"

## Iteration 35 — Watcher Names + iOS device signals
backend:
  - task: "POST /family/link guardian_name → guardian_label; PUT /family/links/{link_id}/name (guardian only, 404 others, 422 empty); i_watch[].my_label. test_family_unlink.py 5/5."
    implemented: true
    working: true
frontend:
  - task: "Family: watcher rows show guardian's name; family-watch-label-<pid> 'They see you as “…”' + family-watch-rename-<pid>. privacy.ts family allow-list += guardian_name (tester fix, intended). E2E 10/10."
    implemented: true
    working: true
native:
  - task: "iOS DeviceSignalsTruth.swift + module functions + 5 XCTests; deviceAnalysis D04b. Cannot run here."
    implemented: true
    working: "NA"

## Iteration 36 — Guardian Voice Note + Admin Audit Trail
backend:
  - task: "POST /family/incidents/{scent}/voice (multipart → Emergent Object Storage), GET /family/voice/{note_id}/ticket, public HMAC-ticketed GET /family/voice-play/{note_id}; admin_audit + GET /admin/audit + stats.audit. tests: test_family_voice.py 3/3, test_admin.py 12/12 (-n 0)."
    implemented: true
    working: true
frontend:
  - task: "VoiceNoteRecorder (voice-note-record/explain/allow/recording/timer/stop/review/send/discard/blocked/open-settings testIDs) on family/incident/[id]; VoicePlayButton voice-play-<note_id> on both incident screens."
    implemented: true
    working: true  # iteration 36 E2E PASS (record → send → Mum plays via ticket URL)

## Iteration 37 — Voice Note Transcript
backend:
  - task: "services/transcribe.py Whisper caption (background task), incident_notes.transcript/transcript_status; test_family_voice.py 5/5 incl. real TTS→Whisper round-trip."
    implemented: true
    working: true
frontend:
  - task: "VoiceCaption under voice notes: family-note-caption-<i> (guardian) / incident-family-note-caption-<i> (Mum)."
    implemented: true
    working: true  # iteration 37 E2E PASS; prompt-echo hallucination guard added after tester note

## Iteration 38 — Light Sentinel palette + Higgins reads captions
frontend:
  - task: "Theme switched to Light Sentinel (single light palette). Smoke screenshots OK (onboarding, Home, Guard). VoiceCaption Higgins read-aloud button <captionTestID>-higgins."
    implemented: true
    working: "NA"
    needs_retesting: true

## Iteration 39 — sky-blue background, navy nav bar, contrast fixes
frontend:
  - task: "theme.ts surface #E6F0FA, nav tokens, *Text state tokens; ui.tsx toneText for Pill labels; state text sites migrated. Smoke screenshots OK."
    implemented: true
    working: "NA"
    needs_retesting: true

## Iteration 40 — Higgins names/links/tracks checks; button distinctiveness; contrast fixes
frontend:
  - task: "Ask tab: parseChecks + HigginsChecks chips (higgins-checks-<msgId>, higgins-check-<id>, -done, higgins-checks-progress-<msgId>); markCheckDone wired in link/message/app/account/device/network. Secondary buttons white+navy outline; danger #B3261E; onboarding eyebrow restingText; restingText #1B6B47. Backend prompt emits CHECKS: trailer (verified via curl)."
    implemented: true
    working: true  # iteration 40 tester PASS on chips/navigation/Done/reload; iteration 41 added where-to-look + state-tied advice (verified via curl + screenshot); HigginsSpeakButton restyled

## Iteration 43 — Higgins follow-up card; Hear Higgins back in the state card
frontend:
  - task: "HigginsFollowUp on Home (higgins-followup, -text, -later; chips reuse HigginsChecks). Self-tested in web: planted 26 h-old suggestion → card shown; visiting Check my device removed its chip; snooze hides the card. Single Hear Higgins in ApolloHero."
    implemented: true
    working: true

## Iteration 44 — "Run a check" always names the checks (mock list until enforcement)
frontend:
  - task: "higginsChecks.ts recommendedChecks()/checksSpoken() (RECOMMENDED_CHECKS_ARE_MOCK). ApolloHero renders HigginsChecks chips (hero-checks, higgins-checks-hero, higgins-check-<id>) + hero-checks-note when resolution.recovering (stale verification → device,network,account; post-resolve cooldown → by event category). Hear Higgins text appends the spoken list. stateMachine reason wording changed. HigginsChecks gains record/title props. Unit tests 12/12."
    implemented: true
    working: true  # iteration 44 tester PASS (chips, Done tracking, Verify now clears list, Ask/follow-up regressions)

## Iteration 61 — Fix flaky backend tests (email relay 429 under concurrency)
backend:
  - task: "services/email.py: send_email() now short-circuits for the Resend test-safe sentinel address 'delivered@resend.dev' — the ONLY address used anywhere in tests/*.py — returning a synthetic id without ever calling the live relay. Real recipient addresses are unaffected (still go through the existing safety checks + semaphore + retry/backoff). Removes the concurrency load that was tripping the relay's 429 rate limit during full-suite / xdist parallel runs, which surfaced as flaky failures in test_family.py and test_device_auth.py (per iteration 32 NOTE above)."
    implemented: true
    working: true  # full suite re-run twice: test_family.py 12/12 + test_device_auth.py 16/16 clean both times; full suite 273/273 on second pass (one unrelated Gemini second-opinion timeout seen once under -n2 load, not reproducible in isolation — pre-existing, unrelated to email fix, not touched)

## Iteration 62 — Fix flaky Gemini "second opinion" timeout under concurrency
backend:
  - task: "routers/analysis.py: gemini_second_opinion (gate2/message), gemini_app_opinion (gate7/app), gemini_account_opinion (gate8/account) refactored onto one shared _gemini_second_opinion_call() helper that retries ONCE on any failure (including the asyncio.wait_for 20s timeout) before falling back to explanation=None. A single transient timeout under concurrent load (e.g. several requests hitting the Gemini relay at once during a full-suite/xdist run) is otherwise recoverable and shouldn't silently drop an explanation that would normally succeed — same philosophy as the email retry-worth-it check. Never overrides the on-device verdict either way; only widens the window before the graceful None fallback. DRY bonus: 3 near-identical call/parse/truncate blocks collapsed into 1."
    implemented: true
    working: true  # full backend suite run 3x after the fix: 273/273, 272/273 (1 = pre-existing, already-documented test_iter7 log-tail race under xdist, confirmed passes alone — unrelated to Gemini), 273/273. Zero recurrence of the gate2/gate7/gate8 second-opinion timeout across all 3 runs. test_gate2_message.py + test_gate7_app.py + test_gate8_account.py also run standalone, 25/25 clean.

## Stage 1C.1 — Firebase configuration replacement
frontend:
  - task: "Replace stale google-services.json with user-supplied apollo-243ad / app.apollo.hwg configuration"
    implemented: true
    working: true
    file: "frontend/google-services.json"
    needs_retesting: false
    status_history:
      - agent: "main"
        working: true
        comment: "Full uploaded JSON parity, matching app identity and unique client, Firebase project/app ID consistency, and resolved Expo config validated. SecurityConfig + SecurityBoot tests 15/15. GuardDog provenance SHA-256 checks 91/91. External preview onboarding renders after Expo restart. Config-only change: no backend or runtime edits."
  - task: "Fresh Android build, physical-device launch past splash, and push delivery"
    implemented: true
    working: "NA"
    priority: "high"
    needs_retesting: true
    status_history:
      - agent: "main"
        working: "NA"
        comment: "Awaiting user device evidence. No APK generated in this session. New Firebase project requires matching Android push-sending service-account credentials; these were not changed or verified. Stage 1D remains blocked until successful physical-device launch is explicitly confirmed."

## Stage 1C.1 — recurring physical Android startup failure (historical pre-Support APK)
frontend:
  - task: "Installed Android app launches past splash without stopping"
    implemented: true
    working: false
    priority: "high"
    stuck_count: 1
    needs_retesting: true
    status_history:
      - agent: "user"
        working: false
        comment: "App installed and still stopping. Follow-up: Android shows Apollo keeps stopping, with apparent continued background presence; not a SafeStart screen. No device crash trace received yet."
      - agent: "main"
        working: false
        comment: "No Android stack trace supplied. Server log shows healthy startup and /health 200, not a native crash. Firebase identifiers match; native autolinking includes ApolloSecurity and GuardDog. Initial native-initialization timing hypothesis retracted after inspecting Expo implementation. No speculative code/security/infrastructure changes made. Need logcat FATAL EXCEPTION/ReactNativeJS stack or SafeStart Why screenshot plus current build identification. Stage 1D blocked."

## Stage 1C.1 — Support fix provenance and current acceptance (recorded 2026-09-20)
frontend:
  - task: "Record Support's exact SVG launch-crash cause and dependency fix"
    implemented: true
    working: true
    file: "docs/APOLLO_STAGE1C_BUILD_INTEGRATION.md, memory/PRD.md"
    needs_retesting: false
    status_history:
      - agent: "main"
        working: true
        comment: "Inspected Support ticket 257445 fix commit 01a30ae72accc3c366492f0217d7fec3cdce866a: exact exception is Invariant Violation: Tried to register two views with the same name RNSVGCircle. heroicons 0.3.0 introduced SVG 13.14.1 beside app SVG 15.15.4; resolution plus lockfile force a single 15.15.4. Current yarn why and both consumers' Node resolution confirm deduplication. GuardDog SHA manifest 91/91. Documentation only; not a new native test run."
  - task: "Fresh Support-fixed Android APK launches and runs as expected on the user's Pixel 10"
    implemented: true
    working: true
    priority: "high"
    needs_retesting: false
    status_history:
      - agent: "user"
        working: "NA"
        comment: "User relayed Support's successful deploy/build and emulator-to-Home result; Support says the phone's existing APK predates the fix. No post-fix Pixel result supplied."
      - agent: "main"
        working: "NA"
        comment: "Await a fresh APK including 01a30ae, build ID/source commit/APK hash/Android version and launch-to-Home/reopen result. Emulator success is Support-reported, not independently rerun here. Stage 1D remains paused; startup success does not verify native packet blocking or push delivery."
      - agent: "user"
        working: true
        comment: "2026-09-20: App is running as expected. User explicitly answered Yes when asked whether this is the freshly built APK running on their Pixel 10. Stage 1C.1 physical launch gate PASSED by user verification."
      - agent: "main"
        working: true
        comment: "Recorded Stage 1C §15. Launch only: exact APK/build ID/hash, Android version, binary/source mapping, repeated reopen/reboot and native enforcement/push tests were not provided. No independent device run claimed. Stage 1D remains NOT STARTED pending separate approval. Guard implementation source commit confirmed as 6d71e8f4a48a8a0e22d5a74b4d6e395e7cc62094. No application changes during acceptance recording."

## Stage 1C safeguard — native dependency duplication guard (2026-09-20)
frontend:
  - task: "Fail CI/preflight/native prebuild on duplicate installed native packages"
    implemented: true
    working: true
    priority: "high"
    needs_retesting: false
    file: "frontend/scripts/native-dependency-guard.cjs, frontend/scripts/native-dependencies/*, frontend/scripts/security-preflight.mjs, frontend/plugins/withNativeDependencyGuard.js, .github/workflows/native-dependencies.yml"
    status_history:
      - agent: "main"
        working: true
        comment: "Read-only guard reports every native version/path, inspects nested/scoped/hoisted packages and native metadata, rejects different/same-version physical duplicates, resolves symlink aliases without false duplicates. CI post-install + combined preflight + managed Android/iOS prebuild gates. Actual EAS pre-install defers dependency scan only until mandatory prebuild after installation. SVG pin15.15.4 and lockfile unchanged; no GuardDog edits."
      - agent: "testing"
        working: true
        comment: "Independent report test_reports/iteration_61.json: 44/44 focused tests, ESLint/config checks, workflow wiring and preview smoke pass; actual audit888 packages/50 native names/0 duplicates/0 errors; SVG only15.15.4; GuardDog hashes91/91. No blocking defects. No hosted CI/native build/Pixel startup sign-off. Stage1D remains paused."

## Stage 1D implementation/acceptance plan review only (2026-09-20)
frontend:
  - task: "Check proposed Stage 1D scope against frozen contract, evidence and P0-tracking requirements"
    implemented: true
    working: true
    file: "docs/APOLLO_STAGE1D_PLAN_REVIEW.md, docs/STAGE1D_DEVICE_TEST_RECORD_TEMPLATE.md, docs/STAGE1D_P0_REMEDIATION_BACKLOG.md"
    needs_retesting: false
    status_history:
      - agent: "main"
        working: true
        comment: "Plan-only source inspection at 0154e186fb4601495c3f4468f9a89ae0d18ce1f1. No pre-existing detailed Stage 1D plan or original P0 finding list located. Wrote explicitly proposed candidate file scope and exclusions; unresolved mapping/ownership/configuration/evidence decisions D1–D6; separate launch/start/stop/observed intentional packet-block gates; exact source commit and APK build ID mandatory per new device test; operational rollback plan. P0 source intake unresolved, no individual review findings fabricated or closed."
      - agent: "user"
        working: true
        comment: "Supplied original Apollo_Review_2026-09-20.md at reviewed commit da60c0372650dead26caeb25c458f8ca7cebd6a2 and assigned P0-01–P0-06 to findings 1–6. Identifying findings closes intake only. Recommended six design directions, required separate native-vs-upload acceptance and call-rejection negative; no runtime or production cutover approved."
      - agent: "main"
        working: true
        comment: "Revised plan/tracker/device template; archived original byte-for-byte (SHA-256 e2704cf1ee89850d8ca39fa50b136ce09575ff4e45e8cfafeb986288c6de2788); added CE-01 proposal only. P0 intake RESOLVED; all six findings OPEN, D1–D6 OPEN. A4E pipeline blocked by P0-05 while A4N native proof is independent; call negative blocked by P0-03; consumer freshness/recovery by P0-02. Documentation validations pass: six distinct open rows, dependencies and call negative, balanced code fences, unchanged public contract hashes/GuardDog91/91, no frontend/backend/config/dependency/CI changes. No fixes, new reproductions or device tests claimed. Remote main read-only verified da60c03; sync pending Save to GitHub and content verification."
  - task: "Stage 1D runtime implementation and real packet-blocking acceptance"
    implemented: false
    working: "NA"
    priority: "high"
    needs_retesting: true
    status_history:
      - agent: "main"
        working: "NA"
        comment: "NOT STARTED per user instruction. Stage 1C.1 user-verified Pixel 10 launch remains PASS. Original P0 report now received and six findings separately OPEN; intake alone resolved. Need D1–D6 decisions, separate truthful contract approval or defer, final exact files/mappings and implementation approval. No runtime/contract/GuardDog changes, production-default cutover or device tests during this review. Full pipeline acceptance blocked by P0-05; native packet proof separate and unexecuted."

## Focused D1/D3 ownership/trust design — source and read-only topology checks
frontend:
  - task: "Produce concrete ownership/trust construction and frozen-bridge feasibility verdict"
    implemented: true
    working: true
    file: "docs/STAGE1D_D1_D3_OWNERSHIP_TRUST_DESIGN.md"
    needs_retesting: false
    status_history:
      - agent: "main"
        working: true
        comment: "Design only at source956db060. Current bridge hides its test registry/verifier; public API cannot inject production trust. Source shows global runtime writes and captured reporter risk; no native competing-owner reproduction claimed. Public SDK constructors permit separate Apollo-owned construction if frozen Expo bridge is excluded. Normal read-only autolinking lists both modules; CLI --exclude guarddog-expo-module lists Apollo only; actual configuration unchanged. Conditional native owner/profile/store file list and sequence documented, not implemented."
      - agent: "main"
        working: true
        comment: "Proposed alternative changes topology, not proof of safe coexistence. Build-pinned production public trust construction is specified; actual approved pins and runtime-validity guarantee remain blockers. Admission-time verification/post-drop callback cannot establish atomic in-flight expiry/revocation. D1/D3 await disposition; D2/D4–D6 and six P0s remain OPEN. Stage1D NOT STARTED. Prior eight-doc sync956db060 verified; focused design is a later workspace update."
      - agent: "user"
        working: true
        comment: "First design sync09bb101 verified. Identified production-policy conflict: Stage0 requires pinned PRIMARY/RECOVERY roots and runtime signed manifests, not APK-only ordinary-key rotation. Requested focused D3 reconciliation; offline revocation delay is already acknowledged, not an instantaneous guarantee. No implementation approval."
      - agent: "main"
        working: true
        comment: "The prior build-pinned ordinary-key proposal is WITHDRAWN. New STAGE1D_D3_SIGNED_MANIFEST_RECONCILIATION.md defines root/manifest verification, single-owner generation transition/revalidation, separate known-expiry/newly-verified-revocation/offline behaviors, and requested certified T1–T5 semantics. Policy conflict corrected only; D3 production implementation/interfaces/proof remain open. No trust/auth/runtime code or device tests performed."
      - agent: "main"
        working: true
        comment: "Documentation/source validation passed: four D3 questions addressed, old APK-only ordinary-key claims superseded, separate offline/expiry/revocation outcomes, certified interfaces labelled absent/proposed, Stage0 unchanged, no frontend/backend/config/dependency/CI edits, public contract/original-review hashes unchanged, GuardDog91/91 and all six P0s/D1–D6 OPEN. No native tests run; candidate timing bounds require ratification/measurement and are not current SDK guarantees."


## Iteration 63 — P0 completion follow-up (testing-agent)
backend:
  - task: "P0 relevant suites rerun incl outbound transport, evidence gate, legacy disabled routes, mapper E2E fixture"
    implemented: true
    working: false
    file: "backend/tests/*.py"
    needs_retesting: true
    status_history:
      - agent: "testing"
        comment: "Relevant backend suites: 70 total, 68 pass, 2 fail. Fails: test_head_405_then_get_headers_only_no_body_consumption (HEAD fallback missing), test_frontend_mapper_payload_hits_live_patrol_once_and_rejects_changed_reuse (changed binding returns 422 not expected 409)."
frontend:
  - task: "P0 delivery + truth/privacy/file node tests and focused payload-capture checks"
    implemented: true
    working: false
    file: "frontend/tests/p0Delivery.test.ts, frontend/tests/p0TruthPrivacyFile.test.ts"
    needs_retesting: true
    status_history:
      - agent: "testing"
        comment: "Node tests: 18 total, 17 pass, 1 fail (older acknowledged version re-enqueue replaces newer pending version). Browser payload capture was partially blocked by onboarding route-state; one run showed no cloud screenshot/call-risk requests but could not complete reliable API body capture across setup redirects."
agent_communication:
  - agent: "testing"
    message: "Only test/report files edited. Two backend failures + one frontend queue regression remain blocking full P0 closure."

## Iteration 64 — P0 punch-list remediation (main-agent)
backend:
  - task: "P0-01 HEAD preflight and P0-05 evidence conflict contract"
    implemented: true
    working: true
    file: "backend/services/outbound.py, backend/routers/patrol.py"
    needs_retesting: false
    priority: "high"
    status_history:
      - agent: "main"
        working: true
        comment: "public_get now performs a bounded HEAD preflight per hop, explicitly falls back to GET for 400/403/405, and validates/re-resolves redirects. Existing evidence identity conflicts are checked before fresh Biting validation so changed reuse consistently returns 409; new invalid claims remain 422 and do not reserve a receipt. Focused backend 32/32 and full relevant P0 matrix 81/81 pass."
      - agent: "testing"
        working: true
        comment: "Iteration 64 independently passed backend blocker suites 32/32; no critical or minor backend issues."
frontend:
  - task: "P0-05 monotonic delivery queue and deterministic payload-capture setup"
    implemented: true
    working: true
    file: "frontend/src/store/deliveryQueue.ts, frontend/src/testing/setupBypass.ts, frontend/src/store/ApolloContext.tsx"
    needs_retesting: false
    priority: "high"
    status_history:
      - agent: "main"
        working: true
        comment: "An exactly acknowledged older payload can no longer replace a newer pending payload. Added explicit __apollo_test_setup=1 bypass restricted to development web preview and never persisted or enabled in production/native. Frontend P0 node tests 19/19 pass; direct /message preview route showed message-sender without onboarding. GuardDog provenance remains 91/91 unchanged."
      - agent: "testing"
        working: true
        comment: "Iteration 64 independently passed frontend P0 tests 19/19 and 2/2 preview bypass/default checks; GuardDog manifest 91/91 unchanged."
test_plan:
  current_focus:
    - "P0-01 through P0-06 software remediation closed; retain native device acceptance as separate Stage 1D work"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"
agent_communication:
  - agent: "main"
    message: "Please independently verify the four iteration 63 blockers. Use /message?__apollo_test_setup=1 for deterministic preview entry. Do not alter frozen GuardDog source."
  - agent: "testing"
    message: "Iteration 64 PASS: backend 32/32, frontend 19/19 plus 2/2 preview checks, GuardDog 91/91; no blocker regressions reproduced."

## Iteration 65 — P0-03/P0-05 post-closure persistence hardening
backend:
  - task: "Historical truth revalidation and immutable dual-unique evidence bindings"
    implemented: true
    working: true
    file: "backend/services/patrol_policy.py, backend/routers/patrol.py, backend/server.py, backend/routers/family_weekly.py, backend/routers/admin.py"
    needs_retesting: false
    priority: "high"
    status_history:
      - agent: "main"
        working: true
        comment: "Historical retrieval persistently downgrades invalid call-screening Biting; identical evidence replay returns current stored status; event and evidence identities each have Mongo unique bindings with 409 conflict semantics under races. Full P0 backend matrix 84/84."
      - agent: "testing"
        working: true
        comment: "Independent localhost/live-Mongo regressions 50/50, including real race and unique-index proof."
frontend:
  - task: "Bounded durable evidence outbox and receipt retention"
    implemented: true
    working: true
    file: "frontend/src/store/deliveryQueue.ts, frontend/src/store/patrolDelivery.ts, frontend/src/components/PatrolDeliveryBanner.tsx"
    needs_retesting: false
    priority: "high"
    status_history:
      - agent: "main"
        working: true
        comment: "Pending capacity 256 with no eviction, explicit persisted overflow, local-event retry, receipt cap 1024 and 30-day TTL. Frontend P0 21/21 and preview PASS."
      - agent: "testing"
        working: true
        comment: "Independent frontend 21/21 plus 2/2 preview checks; overflow/retention cases pass."
test_plan:
  current_focus:
    - "P0 corrections complete; Stage 1D external certified inputs and physical-device run remain"
  stuck_tasks:
    - "Stage 1D candidate cannot produce truthful packet evidence from frozen bridge because protocol/port are omitted"
  test_all: false
  test_priority: "high_first"
agent_communication:
  - agent: "testing"
    message: "Iteration 65 P0 PASS. Main-agent manifest run from frontend/packages confirms 91/91; tester's missing-path note came from a different working directory, not a digest mismatch."

## Iteration 66 — Stage 1D test-only acceptance candidate
frontend:
  - task: "Apollo-owned GuardDog candidate runtime, adapter, packaging and consolidated acceptance"
    implemented: true
    working: "source/prebuild verified; native build/device not run"
    file: "frontend/modules/apollo-security/android/src/main/java/com/hucentai/apollosecurity/ApolloGuardDogCandidateRuntime.kt, frontend/src/security/guarddog/, frontend/app/guarddog-acceptance.tsx"
    needs_retesting: false
    priority: "high"
    status_history:
      - agent: "main"
        working: true
        comment: "Single Apollo owner wraps frozen reporter, preserves original packet fields, correlates genuine event, excludes Expo bridge, keeps candidate non-production, and prepares one-run Pixel harness. TS/frontend 58/58, backend 50/50, prebuild PASS, SHA 91/91."
      - agent: "testing"
        working: true
        comment: "Independent source/config/prebuild/frontend/backend checks pass. Native Gradle/EAS compile and physical run unavailable in workspace. Two minor findings (test URL fallback and disabled affordance) were fixed and self-tested."
      - agent: "main"
        working: true
        comment: "Removed hardcoded backend test URL fallback; disabled acceptance controls now expose accessibility state and visible opacity. Lint, TS, 14/14 focused tests and 4/4 live Mongo tests pass."
backend:
  - task: "Stage 1D candidate compatibility with P0 truth/persistence"
    implemented: true
    working: true
    file: "backend packet evidence and patrol persistence gates"
    needs_retesting: false
    priority: "high"
    status_history:
      - agent: "testing"
        working: true
        comment: "Selected live backend P0/evidence gate 50/50."
test_plan:
  current_focus:
    - "Managed candidate APK compile and single Pixel 10 physical run"
  stuck_tasks:
    - "No owned dedicated globally-routed single-IP HTTPS controlled endpoint"
    - "Managed Android profile guarddog-acceptance must be triggered by the user through Publish"
  test_all: false
  test_priority: "physical_acceptance_next"
agent_communication:
  - agent: "deployment"
    message: "Actual startup data-deletion risk found and fixed: duplicate receipt bindings now fail closed without deletion; 15/15 targeted backend tests pass."
  - agent: "troubleshoot"
    message: "The remaining --tunnel warning is a false positive: platform-managed EXPO_PACKAGER_PROXY_URL is externally healthy, /etc supervisor is read-only, and adding a second tunnel would conflict. It is not an Android build blocker."

## Iteration 67 — Stage 1D candidate handoff hardening
frontend:
  - task: "Independent acceptance trust, dedicated endpoint package, managed build handoff"
    implemented: true
    working: "source/prebuild verified; native compilation/device not run"
    file: "frontend/modules/apollo-security/android/src/main/java/com/hucentai/apollosecurity/ApolloGuardDogCandidateRuntime.kt, frontend/plugins/withGuardDogCandidateProfile.js, frontend/modules/apollo-security/android/src/test/resources/guarddog-acceptance/, infra/guarddog-acceptance/"
    needs_retesting: true
    priority: "high"
    status_history:
      - agent: "main"
        working: true
        comment: "Generated distinct Ed25519 acceptance key outside repo/APK; injected public key through Apollo-owned TrustedKeyRegistry; added native production metadata gate; signed current valid/tampered/expired/unknown-key vectors; real-clock Python crypto 2/2 and selected frontend 31/31 pass. Candidate/production/legacy prebuild metadata true/rejected/false."
      - agent: "testing"
        working: true
        comment: "Iteration 67 independent pass: crypto 2/2, source guards 4/4, backend P0/Stage1D 50/50, key/private-material/endpoint guards verified. Native compilation/JUnit/Pixel remain NOT RUN."
test_plan:
  current_focus:
    - "Independent source/prebuild/crypto review, then user Save to GitHub"
    - "Dedicated endpoint hosting/DNS/TLS, host-scoped bundle, managed build, one Pixel 10 run"
  stuck_tasks:
    - "No hosting/DNS credentials for a dedicated Apollo-owned public IPv4 endpoint"
    - "GitHub Save and managed Publish are user-triggered platform actions"
agent_communication:
  - agent: "main"
    message: "Main frozen-source check executed from frontend/packages: 91/91 OK. Iteration 67 tester's path-layout warning is a working-directory issue, not a digest mismatch."

## Iteration 68 — Stage 1D post-bb1a5fa acceptance corrections
frontend:
  - task: "Run-scoped proof, process owner, observed transitions, strict evidence boundary and bounded native inbox"
    implemented: true
    working: "source/prebuild verified; native compile/device not run"
    file: "frontend/modules/apollo-security/android/src/main/java/com/hucentai/apollosecurity/ApolloGuardDogCandidateRuntime.kt, ApolloGuardDogLifecycle.kt, ApolloEvidenceInbox.kt, frontend/src/security/guarddog/GuardDogEvidenceBoundary.ts"
    needs_retesting: true
    priority: "critical"
    status_history:
      - agent: "main"
        working: true
        comment: "New acceptance run requires run/probe/session/host/IP/port/time/new-ID correlation; runtime is one eligible process owner; all engine transitions serialize and await observed TUN/route/session/reporter state; native inbox capped 256 with surfaced non-throwing failures; public contract normalized/validated; historical signer absent."
      - agent: "testing"
        working: true
        comment: "Independent iteration 68: backend 50/50, source/evidence/crypto 8/8, preview isolation PASS. Native compile/JUnit/Pixel NOT RUN. Requested stricter JS result validation; main aligned full JS/native public contract and follow-up 11/11 passed."
test_plan:
  current_focus:
    - "Save corrected source to GitHub, provision dedicated endpoint, generate host-scoped bundle"
    - "User triggers Publish Android profile guarddog-acceptance; run native JUnit and one Pixel workflow"
  stuck_tasks:
    - "No dedicated Apollo-owned public IPv4 host/DNS/TLS infrastructure or credentials"
    - "Managed Publish and Pixel device access are user-triggered"
agent_communication:
  - agent: "main"
    message: "GitHub bb1a5fa is now a reviewed baseline only. These iteration 68 corrections need a new Save to GitHub commit before build evidence can be linked."

## Iteration 73 — Final frontend lint and Email Gate state remediation
frontend:
  - task: "Clear the iteration 72 frontend lint gate and make Gmail status/connect/scan progress truthful and actionable"
    implemented: true
    working: true
    file: "frontend/app/email.tsx, frontend/src/domain/protectionTruth.ts"
    needs_retesting: false
    priority: "high"
    status_history:
      - agent: "main"
        working: true
        comment: "Current no-cache ESLint baseline has zero errors; removed the final unused protectionTruth warning. Email Gate now bounds its connection-status wait at 8 seconds, shows a truthful unavailable/retry state, and binds visible/disabled loading states to Gmail connect and inbox scan actions. TypeScript, yarn lint, Gate 1 13/13, Gate 7 37/37 and Gates Overview 6/6 pass. Preview confirms Email Gate reaches an enabled email-gmail-connect CTA and App Gate renders with an enabled app-run action."
      - agent: "testing"
        working: true
        comment: "Iteration 73 frontend verification passed: lint/typecheck clean; Gate 1 13/13, Gate 7 37/37 and Gates Overview 6/6; Email Gate left Checking within 12 seconds, connect CTA was enabled and changed to disabled Opening Google state; App Gate form rendered and enabled app-run after input. Connected-mailbox scan busy state was source-verified because no connected Gmail session was available."
  - task: "Human Gmail OAuth consent using the stable deployed callback"
    implemented: true
    working: "NA"
    file: "backend/routers/gmail.py, backend/services/gmail.py"
    needs_retesting: true
    priority: "medium"
    status_history:
      - agent: "main"
        working: "NA"
        comment: "Code-side OAuth URL construction remains verified. Human Google consent still depends on registering the exact stable deployed callback in Google Cloud Console; preview automation cannot complete provider login."
test_plan:
  current_focus:
    - "Frontend iteration 72 remediation is verified complete"
    - "Human Gmail OAuth consent remains the only current user-verification item"
  stuck_tasks:
    - "Real Gmail OAuth consent requires user Google account interaction and exact stable deployed callback registration"
  test_all: false
  test_priority: "high_first"
agent_communication:
  - agent: "main"
    message: "Do not touch frontend/packages/guarddog-*. Stage 1D physical Pixel acceptance was cancelled by the user and is outside this retest. No mailbox username/password flow may be added."
  - agent: "testing"
    message: "Iteration 73 PASS for requested frontend scope; report: test_reports/iteration_73.json. No GuardDog or credential-flow regressions found."
  - agent: "user"
    message: "Clarified that File inspection and Device checks must remain represented in the handoff. Stage 1D physical-device work stays cancelled; next focus is Apollo and Higgins handling real situations well."
  - agent: "main"
    message: "Pre-iteration 74 clarification: File and Device remained available at /file and /device. Superseded by iteration 74, which promotes both to first-class main-overview Gate cards while preserving their manual Ready to check state."

## Iteration 74 — File Gate and Device Gate promoted to ten-Gate overview
frontend:
  - task: "Add File Gate and Device Gate as first-class selectable cards in the main Gates overview"
    implemented: true
    working: true
    file: "frontend/src/domain/gates.ts, frontend/app/(tabs)/guard.tsx, frontend/app/(tabs)/home.tsx"
    needs_retesting: false
    priority: "high"
    status_history:
      - agent: "main"
        working: true
        comment: "Overview now contains exactly ten Gate cards. File and Device reuse /file and /device and show Ready to check because they are manual checks, never Active without actual monitoring."
      - agent: "testing"
        working: true
        comment: "Iteration 74 passed source, focused tests and mobile preview: 10 cards, File and Device Ready to check, both direct routes open."
  - task: "Make File Gate source-neutral and route relevant file findings"
    implemented: true
    working: true
    file: "frontend/app/file.tsx, frontend/src/domain/fileAnalysis.ts, frontend/src/share/classifyShare.ts, frontend/app/email.tsx"
    needs_retesting: false
    priority: "high"
    status_history:
      - agent: "main"
        working: true
        comment: "Selected/shared files use bounded local inspection; Google Drive/cloud hosting supplies no safety verdict. Disguised executables route to App Gate, profile/certificate concerns route to Device Gate, and Email attachment handoff discloses that the actual file must be selected."
      - agent: "testing"
        working: true
        comment: "Cloud-source unit case passed and File Gate preview showed source-neutral copy. Follow-up disclosure issue was fixed with deterministic UI tests and direct Email-source route verification."
  - task: "Assess existing device risks, Apollo protection health and observable configuration drift with evidence-aware language"
    implemented: true
    working: true
    file: "frontend/app/device.tsx, frontend/src/domain/deviceAnalysis.ts, frontend/app/app-check.tsx"
    needs_retesting: false
    priority: "high"
    status_history:
      - agent: "main"
        working: true
        comment: "Device Gate checks current visible existing-app capabilities and settings, stores snapshots to detect changes, separates capability from behaviour, detects protection off/stopped/missing-permission states, and only uses suspected-tampering wording for specific high-risk/high-confidence observed changes. Higgins opens Settings and rechecks outcomes."
      - agent: "testing"
        working: true
        comment: "Gate 7 scenarios and Device preview passed, including dormant capability, protection-gap wording, drift detection and Higgins recheck controls."
  - task: "Extend Higgins routing to File Gate and Device Gate"
    implemented: true
    working: true
    file: "frontend/src/domain/higginsChecks.ts, backend/routers/ask.py"
    needs_retesting: false
    priority: "medium"
    status_history:
      - agent: "main"
        working: true
        comment: "Higgins can recommend exact File and Device Gate routes, explains capability versus behaviour, and applies the evidence threshold for tampering language."
verification:
  frontend: "352/352 full suite; TypeScript and Expo lint clean"
  backend: "301/301 full pytest suite; Python lint clean"
  independent: "/app/test_reports/iteration_74.json — 23/23 focused checks passed"
  preview: "10-Gate count/status/navigation, cloud file handoff, App→Device handoff, Device health/recheck, Email disclosure and accessible source context passed"
  frozen_guarddog: "No changes"
remaining_user_verification:
  - "Gmail OAuth human consent still requires the exact stable callback in Google Cloud Console; it is separate from this ten-Gate work."
cancelled:
  - "Stage 1D physical-device acceptance remains cancelled and must not be restarted."
next_focus:
  - "Evaluate Apollo and Higgins against people's real situations: questioning quality, evidence, uncertainty, remediation and follow-up across all ten Gates."
