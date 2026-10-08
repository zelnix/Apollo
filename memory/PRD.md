## Multi-Select filter verification + Scam v5 re-analysis validation (2026-06, fork)

**Multi-Select filter (`src/components/MultiSelectFilter.tsx`) — VERIFIED on Patrol + Scams:**
- Patrol (`patrol-filter`): "Filter activity" opens the Sheet (Show all / Needs you / Warnings / Threats stopped / Resolved), multi-select shows a count badge, and the activity list filters by OR semantics. Confirmed via screenshot (badge "2", "Nothing matches the filters you chose.").
- Scams (`scam-filter`): "Filter alerts" (Australia/USA/UK/Europe/Global/High/Extreme). Confirmed by text assertion: AU+EXTREME correctly HIDES ASOS (Moderate/Global/potential) while KEEPING NASC (Extreme, AU-confirmed) and the AU Scamwatch "Food delivery" alert; "Show all" restores every alert. Empty selection = show everything.

**Scam Alerts v5 re-analysis — VALIDATED (backend):** `learning_feed_items` 96/98 at `analysisVersion:5` (2 transient pending, hourly loop fills). Breakdown: 6 `specific_scam` + 5 `emerging_pattern` consumer alerts surfaced; 85 `general_education` + 27 `organisation`-audience items excluded. Spot-checks: "Incident affecting ASOS customers" → specific_scam/consumer (SHOWN); "Iranian cyber targeting of dissidents", Europol law-enforcement items → organisation (HIDDEN). Nation-state/espionage/APT correctly filtered out; consumer-brand breaches retained. Official source acronyms expanded (e.g. "UK National Cyber Security Centre").


## Home + Higgins + Patrol navigation reshuffle (2026-06)

**Home (`app/(tabs)/home.tsx`):**
- Removed the "Recent patrol" section (full feed still lives on the Patrol tab). Dropped now-unused `PatrolItem`/`projectPatrolOutcomes` imports and `recent`/`attentionEventIds`.
- Added a "Learn with Higgins" card (GraduationCap icon) just below Scam alerts → routes to `/higgins/learning` (`home-learn-higgins`).

**Home scam alerts (`src/components/HomeScamAlerts.tsx`):** fixed the misleading empty state — the card showed "No current scam alerts" while loading OR on fetch failure, so a transient hiccup looked like "no scams" even though the feed has EXTREME alerts. Now three explicit states: loading (`home-scam-loading`), error with retry (`home-scam-error`/`home-scam-retry`), and the genuine empty only when the feed truly returns zero. Ranking now prioritises severity (EXTREME→LOW) then growling, preserving the backend's most-recent-first order (stable sort).

**Higgins tab (`app/(tabs)/ask.tsx`):** removed the ⋮ three-dot menu and its Sheet. "Clear chat history" is now a trash button (`higgins-clear-chat`) next to the ⓘ About button in the header (still opens the existing confirm Sheet). About Higgins stays on the ⓘ button. Scam alerts (Scams tab), Learning (Home card), Saved reports + Higgins history (Patrol buttons) are reachable elsewhere. Removed unused `menuOpen`/`goMenu`/`EllipsisVertical` and the menu styles. Updated `tests/phase2Hub.test.ts` (5/5 pass) for the new design.

**Patrol tab (`app/(tabs)/patrol.tsx`):** added a row of 3 labelled buttons under the header — Higgins history (`patrol-nav-higgins-history` → `/higgins/history`), Saved reports (`patrol-nav-saved-reports` → `/saved-reports`), and Patrol history (`patrol-nav-history` → scrolls the FlatList to the top of the activity feed). Removed the duplicate small saved-reports header icon (export PDF icon kept).

**Verification:** tsc + ESLint clean; phase2Hub 5/5. Owner verifies visually on a native build (web preview is fail-closed Safe Start). No automated tests run per owner rule.


## Home status card now details the exact issue Apollo is reacting to (2026-06)

**Problem:** When Apollo was barking, the Home status card only showed a generic line ("This device needs your decision.") — the specific issue lived in the "Needs your attention" section below the fold. The real detail (what happened + Higgins' step) was already in the data (`resolution.drivingEvent` / `buildHomeAttention` → `attention[0]`) but the hero deliberately omitted it.

**Change (frontend only, no new data/backend):**
- `src/components/ApolloHero.tsx`: when there's a real issue (`primary = attention[0]`), the card now shows the specific gate title, a PROBLEM block (the driving event's what-happened) and a HIGGINS block (his plain-English explanation + next step), plus a smaller "See what needs attention" button that routes straight to that item. "Hear Higgins" reads the specifics aloud (unchanged `spokenText`). New testIDs: `apollo-state-problem-title`, `apollo-hero-problem`, `apollo-hero-problem-text`, `apollo-hero-higgins-text`. Reused the previously-unused `problemBox`/`higginsText` styles.
- `src/components/HigginsSpeakButton.tsx`: added optional `small` prop (slimmer height/face/label) used on the Home card.
- `app/(tabs)/home.tsx`: de-duplicated — the "Needs your attention" list now renders `attention.slice(1)` (the top issue is on the card) and only shows when more than one issue exists.

**Verification:** tsc + ESLint clean. Home renders fully only on a native build (web preview is fail-closed Safe Start); owner verifies visually. No automated tests run (owner approval rule).


## Deployment readiness health check (2026-06)

**Genuine config fixes applied (safe, verified — backend 200, preview 200):**
- Quoted two malformed `.env` values that start with `/`: `backend/.env` `INVESTIGATION_KEY_FILE="/app/backend/.secrets/investigation.key"` and `frontend/.env` `METRO_CACHE_ROOT="/app/frontend/.metro-cache"` (python-dotenv strips the quotes at runtime — confirmed).
- Removed the `.env` / `.env.*` / `*.env` lines from `/app/.gitignore` so the deployment pipeline can read the env files (`.env.local`/`*.env.local` still ignored).

**Flagged-but-ACCEPTED by owner (intentional design / platform-managed — do NOT "fix"):**
- **TTL + maintenance cleanup** (`services/higgins/retention.py` TTL indexes on `ask_messages`/`ask_handoffs`/`voice_cache`; `services/higgins/repository.py` sweep via `maintenance.supervise_maintenance`): this IS Apollo's privacy feature (submitted evidence auto-erases within ~15 min; stale investigation records swept). Owner decision: KEEP as accepted design. The static deploy check will keep flagging it as "destructive_db_startup".
- **Secrets in `backend/.env`** (SAFE_BROWSING/GEMINI/encryption/email/etc.): `backend/.env` is the platform's managed secret store; removing breaks runtime. Owner decision: KEEP.
- **Push** (`routers/push.py` sends directly to Expo with `EXPO_PUSH_ACCESS_TOKEN`, `EXPO_PUSH_ENABLED=true`): not the supported production push path. Owner decision: LEAVE enabled as-is for now; proper Emergent push is pending Task 2 (needs Firebase google-services.json).
- **`frontend/eas.json`**: retained — carries production build config (GuardDog enforcement engine, controlled host/IP, preview-harness off) that a pipeline-generated default would lose. Owner decision: KEEP.

NOTE: Because the four accepted items are deliberate, a re-run of the deployment health check will still report them as blockers by design; this is expected and acknowledged by the owner.


## Share to Apollo — multi-file correction + honest preservation (2026-06)

**Scope:** corrections to the EXISTING Share-to-Apollo feature (no new Gate/route/backend). KISS.

**Defects fixed**
1. Multi-file shares only inspected the first file (`file.tsx` read `shared.files[0]`), yet the batch could claim it was checked. NOW: when >1 files are shared, `app/share.tsx` renders `src/components/ShareFileBatch.tsx` which accounts for EVERY file, inspects each individually with the SAME engine (`readInspection` + `analyseFile`), shows a per-file status (waiting/checking/checked/couldn't-check), per-file verdict, flags files whose contents couldn't be read, shows "N of M checked", and lets each file be opened on its own in the full File Gate (fresh single-file intake). Never a single batch "all clear".
2. iOS extension silently discarded extra URLs (`urls.first`). NOW every shared URL is preserved — `webUrl` keeps the first for routing and all URLs are merged into the combined `text` so none are lost (`ShareViewController.swift` commit()).
3. iOS extension silently truncated long text at 200k chars. NOW it appends a plain-English note that the text was shortened.
4. Image classification wording: no longer claims an image IS a message screenshot. `SHARE_KIND_LABEL.screenshot` = "an image"; reason explains the screenshot check is optional and "Apollo doesn't know what's in it until it looks".

**Reuse / helpers**
- `src/domain/fileInspection.ts`: added `readInspection(asset)` (web fetch / native File handle → Inspection), reused by the batch; single-file `analyseAsset` left untouched (no regression).
- Android `ShareIntakeListener` already mapped ALL files into the intake; batch now consumes them.

**Verification (code-level only — native Share requires a device build)**
- tsc + ESLint clean; `yarn test:share` 13/13 green; app boots with ShareIntakeListener mounted.
- NOT validated on a physical device yet: Android ACTION_SEND/SEND_MULTIPLE menu registration, iOS Share Extension activation/App Group handoff, and real multi-file/URL/screenshot shares. These must be tested in an installed development/release build (Expo Go/web are not acceptable proof).


## Scam Alerts correctness overhaul — three-tier + AI-grounded facts + UI refinements (2026-06)

**Problem:** Scam Alerts were showing generic scam *education* and generic Higgins filler as if they were newly detected campaigns. User's non-negotiable: alerts must describe specific, evidence-backed scams actually reported by official sources, with facts drawn only from the source.

**Approach (user-approved):** fetch each official advisory's article and use **Gemini 3.1 Pro** (`gemini-3.1-pro-preview` via `EMERGENT_LLM_KEY`) to classify + extract facts strictly from the text (never invent); analyse+cache once at ingest.

**Backend**
- `services/scam_analysis.py` (NEW): fetches the source article (`outbound.public_get`, HTML→text), strict JSON prompt → `{tier, severity, severityReason(cited), confidence, australianRelevance(+reason), reportedDate(YYYY-MM-DD/YYYY-MM/''), facts{who,what,how,where,when,whatCriminalsWant,evidence}, sections{whatHappened,whereHappening,whatItMeansForYou,whatToWatch,whatToDo}}`. `_coerce` clamps to the contract (a malformed reply can never yield a High alert; education forced to LOW). Free `_obviously_not_an_alert` pre-filter for nav/index/pagination links (no AI spend). `analyze_pending(limit)` caches on `learning_feed_items.scam_analysis`. `ANALYSIS_VERSION=2`.
- `services/government_alerts.py`: `refresh_all()` now also runs `analyze_pending(8)` (hourly loop). `snapshot()` returns `{coverage, generatedAt, feeds, alerts, emerging, pendingCount, lastAnalysedAt, lastSourcedAt, growling}` — **general_education excluded**; specific→alerts, emerging_pattern→emerging. Per alert: real source name, `reportedDate`, `dateLabel` ('Month YYYY'/'Date not stated'), `effectiveDate`. **Recency:** items older than ~15 months (RECENCY_CUTOFF) dropped; lists sorted most-recent-first. **Growl:** specific HIGH/EXTREME that is AU-confirmed (even undated) or AU-potential+fresh.
- Tests: `tests/test_scam_analysis.py` (10) + `tests/test_scam_intel.py` green. Live curl confirmed: specific AU HIGH/EXTREME alerts with grounded whatHappened/severityReason, dateLabel month/year, recency sort, growling, lastSourcedAt.

**Frontend**
- `app/higgins/scams.tsx`: three-tier UI (specific alerts list + 'Emerging patterns' footer + 'Learn with Higgins' link). **Removed** the redundant collapsible Higgins explanation; card now shows real source name + month/year, body = whatHappened, 'Ask Higgins about this' + 'Open official source'. Header uses the new `info` template (title + ⓘ popup) instead of a long inline paragraph; 'Last sourced <date>' line replaces the status pill.
- `src/components/InfoButton.tsx` (NEW) + `info` prop on `RootScreenHeader`/`ChildScreenHeader` = reusable 'title + ⓘ → popup' template for all screens.
- `src/components/HomeScamAlerts.tsx`: uses `r.alerts`; each row tappable → opens the official source; shows source + month/year.
- `src/higgins/hubClient.ts`: types updated (alerts/emerging/pendingCount/lastSourcedAt; tier/facts/reportedDate/dateLabel).
- `src/components/AboutApolloSheet.tsx`: added 'Social Media & Messaging Protection' section (Facebook, Instagram, TikTok, X, Messenger, WhatsApp, Snapchat; protection via existing Gates).
- tsc + ESLint clean. NOTE: v2 backlog re-analysis still filling (hourly loop); pendingCount>0 is expected transient. User will self-test (declined automated frontend test this round).


## Privacy & Data — honest retention inventory + "Delete My Apollo Data" (2026-06)

**Problem/Task 1 (P0):** Give the person an authoritative view of everything Apollo stores for their anonymous device, and a verified, complete "Delete My Apollo Data" workflow with honest offline/pending states.

**Backend:**
- New `services/account_deletion.py` — authoritative, device-scoped (owner_id == device_id). `CATEGORIES` maps 7 service-side groups (Higgins conversations, Investigations & saved reports, Patrol activity & records, Trusted links, Email & account monitoring, Family links & guardians, Diagnostics & app signals) to their collections + id fields.
  - `inventory(device_id)` → honest per-category counts (zeros reported truthfully, missing collections skipped).
  - `purge_device(device_id)` → (1) invalidates the investigation `generation` first so late workers can't publish, (2) `delete_many` across every category by `device_id`/`owner_id`/`recipient_id` (+ family keys protected/guardian/owner_device_id), (3) revokes family-assist sessions, (4) **deletes the device identity** itself. Returns per-category removed counts.
- New routes in `routers/devices.py` (device-auth): `GET /api/devices/data-inventory` and `POST /api/devices/delete-data`. Another device's data is never touched.

**Frontend:**
- `src/domain/privacyData.ts` — `RETENTION_INVENTORY` (plain-English what/where/retention per category incl. a local-only row), `wipeLocalApolloData()` (AsyncStorage.getAllKeys → multiRemove every `apollo.*` key), `DataInventory`/`DeleteDataResult` types, `PENDING_DELETE_KEY`, `CONFIRM_WORD="DELETE"`.
- `src/auth/deviceIdentity.ts` — new `clearDeviceIdentity()` (full clean wipe, no reset marker → true first-run).
- `ApolloContext.requestDataDeletion()` — calls `/devices/delete-data`; on success wipes local + clears identity + resets in-memory state (events/trust/ssids/verified cleared, deviceId null, setupDone false) + `qc.clear()`. On failure (offline) persists `PENDING_DELETE_KEY` and auto-retries on the next backend-reachable event.
- `app/privacy-data.tsx` — modal screen: intro, live inventory (service counts + "On this device" rows), pending banner, type-to-confirm `DELETE` input gating a danger button → confirm Sheet → delete → toast + `router.replace("/onboarding")`.
- Settings → "Privacy & data" section gains a top `Privacy & data` NavRow → `/privacy-data`; registered as a modal in `app/_layout.tsx`.

**Verification:** tsc + ESLint clean. Backend `tests/test_delete_my_data.py` 3/3 (inventory counts this device only; delete erases everything + kills the identity (token→401); delete doesn't touch another device); `test_device_auth.py` 11/1-skip regression green. Live curl: register→inventory(0)→delete→token 401. UI: screen renders in web preview; type-to-confirm enables the danger button and opens the confirm sheet. NOTE: the happy-path delete needs a registered device token (native/real install); in web preview with no token the live inventory shows its honest fallback and delete follows the pending path.


## Device Gate cross-platform Security & Privacy Review + positive framing + deep links (2026-06)

**Platform typing (P0):** `DevicePlatform` expanded to `ios | android | windows | macos | web`; `firstCheckSignals.currentPlatform()` and `firstCheck.platformName()` now handle Windows/macOS (desktop no longer collapsed to web); `deviceAnalysis.path()` desktop-safe.

**New engine `src/domain/deviceReview.ts` (P0):** registry-driven cross-platform review. 9 categories (access/system/malware/apps/personal_info/privacy/network/administration/data), 6 exact outcomes (`OUTCOME_LABEL`: Checked / Review recommended / Action required / Manual review required / Unavailable / Not applicable). ~18 checks, each declaring applicable platforms + per-OS Settings destinations + a pure evaluator that reuses existing `DeviceSignals`/self-report/protection health. Android/iOS read real signals; Windows/macOS return guided **Manual review** until native collectors land (never false "Checked"). `runDeviceReview()` returns per-check `{outcome, risk, evidence, remediation, settings, verifiedBy}` + honest `overall` (action/review/manual/clear/unknown) with coverage counts — **"clear"/Protected only when zero action/review AND zero skipped checks** (no-false-PASS). `groupByCategory`, `overallState`, `OUTCOME_TONE` helpers. Fully unit-tested: `tests/deviceReview.test.ts` (safe/unsafe/unknown/failed/user-confirmed/not-applicable/4-platform coverage/no-false-PASS).

**Device Gate UI (`app/device.tsx`, P2):** new "Security & privacy review" section groups results by category; each shows title + outcome Pill + risk + "What to do" (Higgins remediation) + evidence + verifiedBy note + a **deep-linked "Open Settings"** button (`openDeviceSettings` via `REVIEW_TARGET`). Status card now driven by the honest `overall`/coverage. Replaced the old single-severity findings list.

**Positive reframing (user ask):** negative "Apollo cannot…" copy reframed to what Higgins *can* do — Device Gate's "What Apollo can't see here" → "Where Higgins can help"; `deviceAnalysis.cannotSee[]` strings; app-check scope + `app-capability-evidence-note` + self-report blurb; review engine's manual/unavailable evidence. Fixed two pre-existing test failures from an earlier GateAbout edit (`fileDeviceGateUi`, restored app-check phrase) and updated `gate7` for the new positive iOS-management wording.

**Not yet done (remaining):** full First Check / Higgins Re-check UI rebuild to the per-setting model (Phase 2 remainder); native collectors for Windows/macOS + deeper iOS/Android signals (Phase 3); positive-tone pass across non-device gates; the dev-only Safe Start screen still reads "GuardDog production authority". tsc + ESLint clean; suite 485/493 (8 failures all pre-existing app.json/source/brand scans).


## Higgins starter memory (2026-06)

Higgins now remembers the ordinary questions a person asks most often and offers them back as one-tap chips. Pure logic in `src/higgins/starterMemoryCore.ts` (`recordInto`, `topStarters`; unit-tested in `tests/starterMemory.test.ts`), local-only persistence in `src/higgins/starterMemory.ts` (AsyncStorage key `apollo.higgins.starter-memory.v1`, stored as JSON string). Wired into `app/(tabs)/ask.tsx`: records each ordinary chat message (min 6 chars), shows repeated questions (count ≥ 2) — merged into the welcome starters when empty, and as a slim horizontal "ask again" row above the composer during a chat (only when the input is empty). Cleared alongside Clear chat history. tsc + lint clean, tests pass.


## Higgins tab → full chat experience (2026-06)

Rebuilt `app/(tabs)/ask.tsx` as a messaging screen ("Open Higgins. Start talking.").
- **Header**: small avatar (logo) + "Higgins" + subtitle "Apollo's trusted adviser" + discreet ⋮ menu (`higgins-menu`). Removed the old "Ask Higgins" badge / oversized heading / hub cards.
- **Header menu (Sheet)**: About Higgins, New scam alerts, Learning, Saved reports, Higgins history, and **Clear chat history** (with a confirm Sheet — `higgins-clear-confirm`/`cancel`). "About Higgins" Sheet states real capabilities + limits ("Apollo acts; Higgins interprets").
- **Conversation**: full-height ScrollView; user bubbles right (brand), Higgins bubbles left (with mini avatar) + subtle timestamps; animated typing indicator (`src/components/TypingDots.tsx`); smart auto-scroll (sticks to bottom only when the reader is already near the bottom).
- **Welcome**: when no history, one Higgins welcome bubble + 3 tappable starters ("Why is Apollo barking?", "Is my device protected?", "Explain a scam warning.") that submit as ordinary messages; disappears once chatting starts (no permanent card).
- **Composer**: anchored above the tab bar via keyboard-controller KeyboardAvoidingView, placeholder "Message Higgins…", multiline (max 120dp), prominent round Send. Error bubble has **Try again** (`retryLast`) that re-sends the last user message without duplicating it.
- **Preserved**: local + server chat history rules, redacted Apollo context, and the entire Apollo→Higgins **investigation hand-off flow** (handoff/resume params, `startInvestigation`, `InvestigationView`, investigation offers/check-it offers) — unchanged. Removed the old `higgins-hub*` dashboard; `tests/phase2Hub.test.ts` rewritten to assert the chat-first design (5/5 pass).
- Removed the bottom chip bar, the standalone "Clear chat history" button and the long redacted-context disclaimer from the body.

Verified: tsc clean, ESLint clean, phase2Hub tests pass. Visual/keyboard behaviour verifies on an Android build (web preview is fail-closed Safe Start for the whole app).


## Home redesign + specific-problem status + tappable notification (2026-06)

**Notification tap → Patrol:** `ProtectionNotificationFactory.build` now sets a `contentIntent` that deep-links `apollo:///patrol` (ACTION_VIEW, app package, NEW_TASK|SINGLE_TOP) so tapping the protection notification opens Apollo on the Patrol tab. Native → only on an Android build.

**Home (`app/(tabs)/home.tsx`) rebuilt to a 4-part hierarchy, all from REAL data (no invented text / no parallel status system):**
1. Status card (`ApolloHero`, now compact: emblem 104dp, rings shrunk, padding reduced). When there's a real issue it shows a boxed "<Gate> needs …" title + the specific Problem + "Higgins: <next step>" + action button. Driven by new `attention` prop.
2. `CoverageCard` rewritten — lists every gate that is verifiably Watching (tone good + automatic.running + !manualOnly), "N gates Watching", tap opens the gate. No hard-coded subset/count. "On" → "Watching".
3. "Needs your attention" section — renders only when real issues exist; one `AttentionCard` per issue (gate failure or active barking event) with Problem / Higgins / action / Dismiss (events).
4. Recent Patrol — `PatrolItem` redesigned: gate chip + severity + time (overlap fixed with flex), headline, summary, "Higgins recommends: <what_to_do>", "Open investigation ›" + Dismiss (barking only).
- Removed the duplicate "Gates Protection" card and the Home `GateNudge`. Compact single-line background indicator replaces the bulky wrapping card. Weekly digest headline now wraps (numberOfLines 2).

**New domain `src/domain/homeAttention.ts`** — `buildHomeAttention({gates, events})` → ordered `AttentionItem[]`: gates in verified "Action needed" first, then ACTIVE barking events (needs a decision). Optional setup and "worth checking" growls are deliberately excluded (no false barking). Problem/recommendation come from gate.currentHelp/limitation and event.what_happened/what_to_do. Pure, unit-tested (`tests/homeAttention.test.ts`).

**Gate terminology (`gates.ts`):** "Ready to check" → "Manual check", "Setup available" → "Setup required" (Watching/Action needed/Limited/Off unchanged). Updated `guard.tsx`, `settings/index.tsx` fallbacks and the label tests.

**Patrol "needs you" tightened:** `matchesPatrolFilter("needs_you")` is now barking-only (a growling "worth checking" item is no longer a "Needs you" decision). Tests updated.

Verified: `tsc` clean, ESLint clean, all touched/new unit tests green (gatesOverview, phase2Patrol, messageGuardrails, homeAttention). Pre-existing unrelated failures (app.json-based navigation/source-scan/brand tests) confirmed present at baseline with changes stashed. Home + notification only render on a production Android build (web preview is fail-closed Safe Start).


## Check screens — compact "Find out more" about headers (2026-06)

Replaced the wordy intro/about paragraphs at the top of every check screen with a compact header: a short title + a "Find out more" link that opens a popup (Sheet) holding the full detail. New reusable component `src/components/GateAbout.tsx` (title, optional `control` slot for an inline switch, optional `sheetTitle`, children = popup detail). Applied to: Call Gate (`call-guard-auto`, keeps the auto-check toggle as the `control`), Text/Email Gate (`message-privacy`), Internet Gate (`network-cannot-see`), App Gate (`app-check-scope`), Email Gate (`email-processing-scope`), Check My Accounts (`monitor-intro`), Device Gate (`device-gate-scope`), Link Gate (`check-privacy-scope`), File Gate (`file-inspection-scope`), Higgins Re-check (`recheck-intro`). Original testIDs preserved on the GateAbout card; the link adds `<testID>-more`. Each popup also shows a "WHAT TO LOOK FOR" tip block (`tip` prop, testID `<testID>-tip`) with a short, concrete example of warning signs for that gate. No logic/engine changes. tsc + ESLint clean. Visual check only on an Android build (web preview is fail-closed Safe Start).


## Unify Saved Items + Text Gate Messages-style picker (2026-06)

**Unify Saved Items:** App Gate saved reports now appear in the single **Saved checks** list. `savedCheck.ts` gained gate `"app"` (GATE_LABEL "App check"). `app/saved-checks.tsx` loads both `listSavedChecks()` and `listAppReports()`, maps app reports into the SavedCheck shape (`fromAppReport`), merges newest-first, and routes delete to the right store. App Gate's save button + intro now point to `/saved-checks` (old `/app-reports` route left in place but unreferenced). Check It "Saved checks" card copy updated to include app checks.

**Text Gate — Messages-style inbox picker (Android, READ_SMS):**
- Investigated access: the native `listRecentSms()` (READ_SMS, on-demand, already in `phonePickers.ts`) returns a flat `{address,body,date}` list — no unrestricted Google Messages inbox API exists, so a familiar inbox is built by **grouping client-side** (no new native infra). Where READ_SMS is unavailable/denied/off-build, the person is routed to **Share → Apollo** (existing share intake).
- `src/domain/smsConversations.ts` (pure, 4/4 tests): `groupSms` (group by sender, conversations newest-first, messages oldest→newest), `filterConversations` (search sender+body), `timeLabel`, avatar initials (letters→initials, numbers→last two digits).
- `app/message-picker.tsx` (new full screen, replaces the cramped bottom sheet → fixes overlap/unresponsive-row issues): conversation inbox (avatar, name/number, preview, timestamp, search) → tap → chat-bubble thread → **Check with Apollo** on a single incoming message → `router.replace("/message", { text, sender, source: "inbox_picker" })` which auto-runs the scam analysis. Never selects a whole thread. Full permission contract (checking/need_permission/requesting/denied/unsupported) with Share fallback. No message content persisted or logged.
- `app/message.tsx`: "Pick a text from your inbox" now pushes `/message-picker`; removed the old SMS `PhonePickerSheet` usage/state (Call Gate still uses the sheet).

**Note:** The re-pasted App Gate Investigation brief was already fully implemented earlier (two-layer summary, evidence-backed permission findings, direct Android settings per permission, re-verify-on-return, qualified Higgins language) — see the earlier PRD entry; no further change needed.

**Verification:** tsc + ESLint clean; tests — smsConversations 4/4, savedCheck 2/2, appPermissionFindings 7/7, gatesOverview 17/17, messageGuardrails 6/6, gate7 44/44, systemHealth 5/5 (no regressions). App bundles (expected Safe Start). The inbox picker, READ_SMS flow and selection round-trip verify on a physical Android build.


## Saved Checks Everywhere + Settings reorganisation (2026-06)

**Saved Checks Everywhere (link / message / internet):**
- `src/domain/savedCheck.ts` (pure, 2/2 tests): `SavedCheck`/`buildSavedCheck` (drops empty sections, stamps savedAt) + `GATE_LABEL`. `src/store/savedCheckStore.ts`: local save/list/delete, cap 40, newest first, no server.
- "Save this check" button added to `app/check.tsx` (link), `app/message.tsx`, `app/network.tsx` result actions — builds a snapshot (title, subject, state, summary, recommendation, sections: why/signals/technical/intelligence). After saving the button becomes "Saved ✓ — View saved checks".
- `app/saved-checks.tsx` viewer: lists all saved checks (gate label + subject + time), inline-expands to full sections, per-item delete. Entry point: new "Saved checks" card on the Check It tab (`check-it.tsx`, bookmark icon).

**Settings reorganisation (`app/settings/index.tsx`, full rewrite per brief):**
- Replaced the long stack of separately-framed cards with 6 concise grouped cards of slim rows (reusable in-file `NavRow`/`SwitchRow`, 48px targets, chevron/switch/badge — not all three):
  - **Protection & permissions** — "Website protection" nav row → Gates (`/(tabs)/guard?gate=site`); the Android Site Gate VPN enable action shows only when setup is required (no redundant healthy status card; no "Protection on"/unverified "Watching").
  - **Alerts & voice** — security-alert OS label (never a delivery claim) + contextual allow/open-settings, Preview an alert; Quiet hours toggle (times when enabled); Higgins voice toggle + Hear a sample.
  - **App preferences** — Battery saver toggle (never implies protection off); Minimise Apollo as a row.
  - **Family & trusted links** — Family sharing → /family; Trusted links count with inline expand + per-link revoke (one exact link, never overrides a confirmed threat), empty "No trusted links".
  - **Privacy & data** — Privacy statement is now a single tappable row → `/privacy-disclosure` (removed the inline `PRIVACY_POLICY_SUMMARY` bullet list from Settings only; disclosure page unchanged); Clear Patrol history (keeps the confirm dialog). Anonymous device reference removed from Settings (lives in Support).
  - **Help & about** — Get help → /support; How to share into Apollo as a brief expandable help row; concise About Apollo (Harmony Wellness Group; Apollo checks/protects, Higgins explains). "Support Apollo" contribution card feature-gated behind `SHOW_CONTRIBUTION = false` (no live payments).
- All functional testIDs preserved (push, quiet, higgins, battery/minimise, family, trust/revoke, clear-patrol, support, site-enable/status, alert-preview). systemHealth settings test still passes.

**Verification:** tsc + ESLint clean; tests — savedCheck 2/2, appReport 1/1, appPermissionFindings 7/7, gatesOverview 17/17, systemHealth 5/5, messageGuardrails 6/6 (no regressions). App bundles (expected Safe Start). Saved-check persistence and the reorganised Settings verify fully on an Android build.


## Saved App Reports + summary-first Internet Gate (2026-06)

**Saved App Reports (App Gate):**
- `src/domain/appReport.ts` (pure, 1/1 test): `AppReportSnapshot` + `buildAppReportSnapshot` — a faithful on-device copy of a completed App Gate investigation (identity, permissions+statuses, why, network, reputation, evidence, severity, coverage/limits). Keeps the honest coverage caveats; a saved report is never a safety guarantee.
- `src/store/appReportStore.ts`: local `saveAppReport`/`listAppReports`/`getAppReport`/`deleteAppReport`, capped 30, newest first. No server storage.
- `app/app-check.tsx`: "Save this check" button in secondary actions (snapshots current result + derived sections); after saving the button becomes "Saved ✓ — View saved checks". Intro has a "Saved app checks" link.
- `app/app-reports.tsx`: list of saved checks with inline full detail (same organised sections as the live full investigation) + per-item delete.

**Internet Gate summary-first (app/network.tsx):** result reorganised to outcome → **What to do** → the direct action (check sign-in page / check device / trust network) up top, with "Why Apollo reacted" + technical + scenario ref folded into a **View full details** toggle. Dropped the raw scenario pill and the redundant STATE_LABEL line from the summary (consistent with App Gate).

**Link/Site Gate (app/check.tsx):** already summary-first (decision headline → why → what-to-do → actions, technical in a sheet) — left as-is; it already matches the pattern.

**Verification:** tsc + ESLint clean; tests — appReport 1/1, appPermissionFindings 7/7, gatesOverview 17/17, gate7 44/44, messageGuardrails 6/6 (no regressions). App bundles (expected Safe Start). Saved-report persistence and the reorganised screens verify fully on an Android build.


## Gate Health Log + App Gate results redesign (2026-06)

**Gate Health Log:**
- `src/store/gateHealthLog.ts`: per-gate on-device history of "confirmed working" timestamps, recorded only when a gate's status is **Watching** (never fabricated). Throttled (1/10min per gate), capped (10). `relativeTime()` helper for friendly labels.
- `guard.tsx`: GuardScreen records working gates whenever `buildGatesOverview` reports Watching; each HealthCard shows a "Protection history" block — "Last confirmed working: X" + up to 3 recent timestamps, or "Not yet confirmed working" for gates never seen Watching.

**App Gate results redesign (app-check.tsx) — presentation + remediation only, engine untouched:**
- **Two layers.** Layer 1 summary card: Apollo status + app identity line (`result.sdk?.appName`/developer/source) + 2–3 sentence outcome + top 2 findings + the one primary action + prominent **View full investigation** toggle. Layer 2 (`showFull`): organised sections (Identity & provenance, Permissions & actual access, Why, Network, Reputation, Evidence & detection methods, Findings & severity incl. scenario ref + risk score, Confidence/coverage/limits, timestamps, raw technical) — all from existing data, no new scanning.
- **Evidence-backed permission findings** (`src/domain/appPermissionFindings.ts`, pure, 7/7 tests): maps the app engine's `permissionNotes` against the native SDK's `permissionStates`/`specialAccessStates` → `Access enabled — Review recommended` / `Access not allowed — No action needed` / `Permission requested — Access not verified` (grant unknown) / `Special access enabled — Review recommended` / `Current status unavailable` (SDK present, no evidence) / `Reported by you — …` (no SDK/iOS). Never guesses "granted". Replaces blanket "More than it needs".
- **Direct Android settings per finding** (`deviceSettings.ts` `permissionSettings()`): a "Review [X]" button opens the closest supported destination (overlay/notification-listener/accessibility/VPN/device-admin/unknown-sources/all-files screens, else app list) and shows the remaining navigation step ("then → <app> → Permissions") — honest that RN can't open another app's exact toggle. Desktop (Windows/macOS) and iOS show the path to follow.
- **Re-verify on return** (AppState listener): after opening Settings from a finding, on return Apollo re-reads that app's permission states (Android + picked package) and reports honestly — `confirmedResolved()` detects enabled→off ("Apollo confirmed: Camera is now off") or says it couldn't confirm. Never claims remediation just because the user came back.
- **Tidied actions**: primary action + View full investigation in the summary; Ask Higgins, recovery, device-check, mark-handled, report kept as secondary. Removed the raw scenario-code pill from the summary. Higgins/engine already use qualified language ("did not establish a specific concern…"); optional reviews stay ears_up/growling, never escalate to barking.

**iOS/desktop:** iOS cannot read other apps' permissions (OS limit) → findings reflect user-reported input and show the Settings path; re-verify is Android-only. Windows/macOS use the desktop adapter and path-guidance fallback.

**Verification:** tsc + ESLint clean; tests — appPermissionFindings 7/7, gatesOverview 17/17, messageGuardrails 6/6, accountMonitor 7/7, gate7 44/44 (no regressions). App bundles (renders expected Safe Start). Native deep-links, re-verify-on-return and the health log over time need an EAS Android build to verify on-device.


## Resolve & Snooze + Gate-status standardisation + Internet Gate (2026-06)

**Resolve & Snooze (Account Gate):**
- `accountMonitor.ts`: new `HandledMap`, `outstandingExposures(scan, handled)`; `deriveGateState` and `buildWeeklyReport` now take an optional `handled` map. A fully-handled address drops out of outstanding/gate-state and gets a "Marked as handled" report section; a brand-new breach name makes it outstanding again. `accountMonitorStore.ts`: `getHandled`/`markHandled`/`unmarkHandled`, cleared on email removal; `runScan` + on-open hook filter new exposures against handled so handled breaches never re-alert. Screen (`account-monitor.tsx`): "Exposures found" card with per-address Mark-as-handled / Mark-as-outstanding; report recomputed live from scan+history+handled. Test: `accountMonitor.test.ts` 7/7 (incl. handled behaviour).

**Gate-status standardisation (single source `src/domain/gates.ts`):**
- New 9 standard statuses replacing the old 10: **Watching** (good/green — verified active automatic protection ONLY), **Ready to check** (neutral — manual available), **Check in progress** (neutral), **Setup available** (neutral — optional, incl. permission/connection not yet granted; never an alarm), **Off** (grey), **Limited** (amber — active but restricted coverage), **Action needed** (red — verified failure of enabled protection), **Unavailable** (grey — unsupported), **Unable to verify** (amber — can't confirm from evidence).
- GateTone expanded to `good|limited|action|neutral|off|unavailable|unverified`; `gateTone()` maps to Pill tones (good→resting, action→barking, limited/unverified→ears_up, off/unavailable→unknown).
- Watching gating: `running && !manualOnly && !coverageLimited`. Manual-only gates (**Link, Account, File, App**) carry `manualOnly:true` → "Ready to check" even when active. Text/Call = Watching when their automatic handling is verified running. New `interrupted` automatic state (enabled+permitted but not operating) = **Action needed**; stale-but-operational = **Unable to verify**. Internet Gate without VPN = **Limited** (coverageLimited), with VPN = **Watching**. Email optional-not-connected = **Setup available**.
- Only tone `action` drives the "needs your attention" summary/primary/reduced-coverage — optional setup never barks (spec §6).
- **Home and Gates derive from the same `buildGatesOverview`**: `home.tsx` GateRow now renders `gate.statusLabel`/`gate.tone` directly (no independent recompute) → identical on both surfaces.
- **Higgins per-gate explanation**: `guard.tsx` HealthCard now shows an explanation heading + limitation + the correct action button for EVERY non-Watching state (not just attention), heading varies by tone (Needs your attention / Working with limits / Couldn't be verified / Optional — set up when ready / Turned off / Not available here / Checking).
- **Network Gate → Internet Gate** (user-facing only; internal `network`/`connection`/route unchanged): `gates.ts` TITLE + purpose, `network.tsx` header, `checkIt.ts` label ("Check my internet", Wi-Fi/mobile data), `higginsChecks.ts`, `app-check.tsx` copy, `appAnalysis.ts` recommendation, Desktop/Web adapter capability titles, healthStore placeholder title.
- Tests updated: `gatesOverview.test.ts` 17/17 (new labels, interrupted→Action needed+reduced coverage, manual gates Ready to check, optional setup not an alarm, Internet Gate Limited/Watching), `messageGuardrails.test.ts` ALLOWED_GATE_LABELS updated 6/6. Consumers updated: `ask.tsx`, `ApolloHero.tsx`, `healthStore.ts`.

**Native capability/evidence gaps (deliverable #7):** status derivation relies on the native SecurityPlatformAdapter (`protection.operational`/`lastVerified`, capability `status`, `messaging`/`calls`, `network.vpnActive`/`inspectable`). Web preview is fail-closed (Safe Start) so these states, the `interrupted`→Action-needed path, and Internet Gate Wi-Fi/mobile reporting can only be visually verified on an EAS Android build.

**Verification:** tsc + ESLint clean; node --test suites: accountMonitor 7/7, gatesOverview 17/17, messageGuardrails 6/6, gate3–8 + messageAnalysis + firstCheck + support + messageVoice + higginsGreeting all pass; app bundles (renders expected Safe Start). On-device Android build needed to confirm live gate states.


## Account Gate — exposure monitoring BUILT (2026-06)

Built the full personal account-exposure monitoring feature with XposedOrNot (free, no key); HIBP is a drop-in for later.

**Backend:**
- `services/breach_check.py` — provider-agnostic: `scan_email(email)` routes to HIBP when `HIBP_API_KEY` is set, else XposedOrNot (`/v1/check-email/{email}`, rate-limited 0.6s floor, serialized). Honest statuses clear/found/unavailable; never fabricates "clear" on failure; no passwords/secrets. `active_provider()`/`source_label()` carry attribution.
- `POST /api/account/monitor/scan` (in `routers/analysis.py`, device-auth, bounded): body `{device_id, emails[≤10]}`; validates each address; returns `{provider, source_label, checked_at, results:[{email,status,breaches:[{name,date}],password_exposed,detail}]}`. Live-verified: `test@example.com`→found(25), random→clear, `notanemail`→unavailable.

**Frontend:**
- `src/domain/accountMonitor.ts` (pure, unit-tested 6/6): `maskEmail`, `isDue`/`DUE_MS`(7d), `scanSummary`, `deriveGateState` (8 states: not_set_up/monitoring/checking/no_exposure/exposure_found/action_needed/unavailable/overdue), `diffExposures` (new vs resolved), `buildWeeklyReport` (Higgins Weekly Account Exposure Report — sections accounts monitored/new/exposures found/no-longer-showing/couldn't-check/what-to-do/coverage; generated even when clean; partial coverage flagged; never leaks raw email — masked only; attributes source).
- `src/store/accountMonitorStore.ts` — local persistence: monitored emails (add/remove, cap 10), last scan, scan history (cap 12), last report, lastCheckedAt. `runScan(deviceId)` calls backend, diffs vs previous, builds+persists report; preserves prior good scan on total failure.
- `app/account-monitor.tsx` — "Check My Accounts" screen: status card, monitored-email management, "Check my accounts now", weekly report render, XposedOrNot attribution + "exposure ≠ compromise" / "not found ≠ secure" copy.
- `src/hooks/useAccountMonitorDueCheck.ts` — on-app-open due check (mounted in `(tabs)/_layout.tsx`): if emails exist and 7+ days elapsed, runs scan in background; raises ONE Patrol `account` event only for newly-appeared exposures (dedup); best-effort, never blocks app or overwrites good results.
- Check It tab (`check-it.tsx`): new dedicated "Check My Accounts" card → `/account-monitor`. Gates tab (`guard.tsx`): read-only "Account exposure" status card (controls live only in Check It), opens the screen.
- Egress: new `account_monitor` endpoint (`{device_id, emails}`) in `privacy.ts`; `/account/monitor/scan` added to client LONG_PATHS.

**History Card extended (P1):** "Your recent checks" `CheckHistoryCard` now wired into `app/app-check.tsx` (gate `app`), `app/network.tsx` (gate `network`) and `app/device.tsx` (gate `device`) — previously only Call/Message.

**Deferred:** HIBP wiring (P2) awaits the user's HIBP key — abstraction is ready, no code change needed beyond setting `HIBP_API_KEY`.

**Verification:** tsc + ESLint clean; `tests/accountMonitor.test.ts` 6/6; firstCheck 9/9, support 6/6, messageVoice 11/11, messageGuardrails 6/6, gate8 34/34 (no regressions); backend endpoint live-verified against real XposedOrNot data; web bundle compiled (2256 modules). NATIVE: UI not visually testable in web preview (fail-closed Safe Start — needs EAS Android build to verify on-device). On-app-open trigger + Patrol event need a device build to confirm end-to-end.


## Specific Gate Links + Check History Card + Scrub Everywhere (2026-06) + Account Gate PLAN

**Done & verified this session:**
- **Scrub Everywhere:** `scrubMessage` now also wraps saved-report overview/explanation (`app/saved-report/[id].tsx` + the report row in `InvestigationView.tsx`) and family alert headline/what_to_do (`app/family/alert/[id].tsx`). Live model/synced free text is scrubbed of internal codes everywhere it renders.
- **Specific Gate Links:** protection-health notifications (`localAlerts.protectionLocalAlert`) now deep-link to `/(tabs)/guard?gate=site`; `guard.tsx` reads the `gate` param and highlights the targeted gate card ("Opened from your alert", gold border).
- **Check History Card:** new `src/store/checkHistoryStore.ts` (per-gate, cap 10, plain-English summaries only) + `src/components/CheckHistoryCard.tsx` ("Your recent checks", outcome chip via `resultChip`). Wired into `app/call.tsx` and `app/message.tsx` (record on each manual check + render). Pattern ready to extend to app-check/network/device.
- Verification: tsc + ESLint clean; full suite 445/452 (same 7 pre-existing env/native/tab-order/brand-asset failures); Android bundle HTTP 200.

**ACCOUNT GATE — audit + agreed plan (NOT yet built; next build):**
- Audit: `/account/status` (reports `HIBP_API_KEY` configured bool — currently NOT set), `/account/breach` (real HIBP v3 breachedaccount, server-side key, honest not_configured/clear/found/unavailable, no passwords), `/account/analyse`. Frontend `app/account.tsx` = one-shot manual lookup, no persistence/monitoring/weekly/report.
- User decisions: (1) Provider = **XposedOrNot** (free, documented) for dev/testing now; **HIBP wired later** when key provided. (2) Weekly check = **on-app-open "due check"** (runs when app opens and 7+ days elapsed) — must be labelled truthfully (OS may delay; not a guaranteed background job). (3) Sequencing: the two follow-ups first (done) → then Account Gate.
- MUST route XposedOrNot through `integration_expert` before coding (free API: `https://api.xposedornot.com/v1/check-email/{email}` + breach-analytics endpoint; attribute + respect rate limits).
- Phases: (A) backend monitored-accounts (add/verify/enable-weekly/remove/status) + scan storage + XposedOrNot provider abstraction (provider-agnostic so HIBP drops in) + findings diff/persistence; (B) Check-tab Account Gate card (monitored count, last check, unresolved count, weekly status, "Check My Accounts") + 8 states (Not set up / Monitoring enabled / Checking / No exposure / Exposure found / Action needed / Check unavailable / Monitoring overdue); (C) on-app-open weekly due-check that persists scan outcome, diffs vs previous (no dup alerts), never overwrites good results on failure, records Patrol activity; (D) **Higgins Weekly Account Exposure Report** generated from the actual stored scan (sections: accounts monitored, new exposures, previous exposures, outstanding, resolved, recommended actions, coverage/sources, next scan) — generated even when clean, explains failures instead of false-clean, partial coverage flagged, each report linked to its scan, history retained; Higgins interprets in plain English and distinguishes exposure vs confirmed compromise. Gates = passive status only (no manual controls); Check = manual only.
- Privacy: never store passwords/secrets; authorise each monitored address; opt-out removes data; keys server-side only; "no breach returned" ≠ "secure".


## Scan Gate Chat + History Everywhere (2026-06)

- **Scan Gate Chat (live free-text scrub):** `messageVoice.scrubMessage()` rewrites any internal-code token (snake_case / known map like known_threat→"website safety", ears_up→"worth a look") to plain English before display, and `console.warn`s in `__DEV__` so the source leak gets fixed too. Applied to EVERY Higgins free-text render in `InvestigationView.tsx` — turn/response overview, attentionReason, explanation (`plain()` now scrubs), findings text, uncertainties, scope, question text/reason, source retrieval, and the recheck observation note. This closes the one real remaining gap in the standing requirement: model-authored replies could previously echo a code.
- **History Everywhere:** `messageVoice.investigationHistory()` builds a plain-English, code-free progress list (opened → follow-ups → current status: investigating / waiting on you / completed within scope / partial / has a question / stopped), rendered as an "Investigation history" card (`inv-history`) in `InvestigationView.tsx`. Check results already carry history via Higgins Re-check diff; event detail has the `eventHistory` "Status history" card from the prior pass.
- Guardrails extended: `messageGuardrails` now asserts the investigation view live-scrubs `response.overview`; `messageVoice` tests cover `scrubMessage` and `investigationHistory`.

Standing-requirement status: substantially complete. §1 offenders all fixed; §2 examples honoured; §3 six-part standard applied on covered surfaces; §4 deep-links carry specific event ids (a couple of protection-health notices still open the Gates tab — minor); §5 surfaces covered; §6 acceptance enforced by automated guardrails incl. live free-text scrubbing.

Verification: tsc + ESLint clean; messaging tests 17/17; full suite 445/452 (same 7 pre-existing env/native/tab-order/brand-asset failures); Android bundle HTTP 200.


## Messaging follow-ups 2 — guardrails, timeline, smart links, inbox (2026-06)

Notification naming check: PASS — all notification copy uses "Apollo" (+ retained "Apollo is barking/biting/growling" vocabulary); no "guard dog"/"guarddog" in `src/push`.

- **Expanded guardrails** (`tests/messageGuardrails.test.ts`, now 6 tests): added (1) Gate-alert coverage — every `buildGatesOverview` presentation's statusLabel is from the allowed set, currentHelp/purpose/limitation carry no code, and primaryAction has a non-empty label+id to route with; (2) Higgins-reply coverage — `assessmentLabel`/`attentionLabel` cover all enums with no raw passthrough, and a source assertion that `InvestigationView.tsx` never interpolates raw `assessment`/`attention` enums.
- **Status Timeline**: `messageVoice.eventHistory()` builds a plain-English, time-ordered history (detected → updates → resolved), replacing the raw "Issue timeline" in `app/patrol/[id].tsx` with a "Status history" card that always shows (even with one revision) and never leaks a revision code.
- **Smart Reply Links**: notification deep-links now carry `?focus=alert` (`localAlerts.ts`); `patrol/[id].tsx` reads `focus` and shows an "Opened from your Apollo alert" banner pre-selecting that exact finding.
- **Support Inbox**: `supportReference.ts` records a reference history (cap 25) on every mint/new-request; `reopenSupportReference` makes a past reference current again; Support screen shows a "Past requests" list (`support-inbox`) with a Reopen action.

Verification: tsc + ESLint clean; messageVoice+guardrails 15/15 (incl. eventHistory); full suite 443/450 (same 7 pre-existing env/native/tab-order/brand-asset failures); Android bundle HTTP 200.


## Messaging audit — Phases 2–4 + Email copy (2026-06)

Completed the four follow-ups to the Phase-1 message-voice foundation:

- **Finish The Sweep:** Higgins investigation verdicts no longer show raw enums — `messageVoice.assessmentLabel`/`attentionLabel` map them to plain English in `InvestigationView.tsx` (assessment/attention Pills), and the action note no longer exposes raw observation status/`unavailableReason`. Check results already use proper STATE label maps (raw intel values stay under the "Technical details" expander, which the spec permits). Onboarding title fixed earlier; error copy is already friendly.
- **Universal Deep Links:** Notifications deep-link to the exact event (`/patrol/{id}`), and the Home/Apollo status reason now carries `reasonRoute` to the specific driving event instead of a generic tab (`stateMachine.ts`). Patrol list/detail already route by event id.
- **Message Guardrails:** NEW `tests/messageGuardrails.test.ts` (4 tests) fails the build if any generated message leaks an internal code (`looksLikeInternalCode` across every category×state×verified), overstates a block without verified enforcement, or routes to a non-existent screen (checks the deep-link target route file exists). Covers `projectedEventVoice`, `patrol_sync` egress output, `resolveApolloState` reasons, and `eventLocalAlert` routing.
- **Email Me A Copy:** Support screen has an optional "Your email (for a copy)" field, persisted (`apollo.support.user_email.v1`); `openSupportEmail` CCs the user (MailComposer `ccRecipients` + mailto `cc=`), so a copy lands in their inbox as well as their Sent folder.

Verification: tsc + ESLint clean on all touched files; new guardrails + messageVoice 12/12; full suite 440/447 (same 7 pre-existing env/native/tab-order/brand-asset failures, none messaging-related); Android bundle HTTP 200.


## Apollo-wide message & event-messaging audit — Phase 1 + partial 2/3 (2026-06)

Standing requirement: every user-facing message answers What/Where/Why/What-Apollo-is-doing/What-to-do/Where-to-go, never leaks internal codes, never overstates status, and deep-links to the exact record. Root cause of the screenshot ("known_threat check", "ears_up", "Something changed", "server_projection_of_recorded_outcome") was the privacy/sync projection layer substituting code-exposing text that the UI rendered verbatim.

**Phase 1 (done, tested) — central voice + generation fix:**
- NEW `src/domain/messageVoice.ts` — single source of truth: `areaLabel` (category→plain, e.g. known_threat→"a website safety check"), `resultChip` (ears_up→"Worth a look", not "Something changed"), `sourceLabel` (user_started→"Started by you"), `displayStateLabel` (PatrolDisplayState→plain, no snake_case), `humanizeReason` (strips snake_case codes like server_projection_of_recorded_outcome, keeps genuine prose), `apolloStatusLabel` (never "stopped" without verified block), `projectedEventVoice` (privacy-preserving synced-event text with zero codes/detail leak), `looksLikeInternalCode`.
- `privacy.ts` (authoritative patrol_sync egress) + `patrolPayload.ts` now emit `projectedEventVoice` text — no raw category/state codes on the wire or on any device that renders the projection.
- `patrolOutcomes.ts`: `result()`→resultChip; investigation title no longer generic "completed an investigation update" (evidence-based); resultBasis via `humanizeReason`.
- `app/patrol/[id].tsx`: humanises title/what-happened/what-to-do/read-aloud for any already-synced cached event that still carries codes; source + timeline use plain labels.
- Tests: `tests/messageVoice.test.ts` 8/8; updated `p0TruthPrivacyFile` verified-block headline.

**Phase 2/3 (partial, tested):**
- `stateMachine.ts` barking/growling/ears_up reasons now name the area ("A phone call needs your decision.") instead of "Something needs your decision."
- `localAlerts.ts` notifications deep-link to the specific event (`/patrol/{id}`) not a generic tab (retained dog-vocab titles kept).
- `InvestigationView.tsx` action note no longer exposes raw observation status/`unavailableReason` codes.

**Remaining (not yet done):** Gates alert tone (optional setup like Email-Gate-not-connected must not bark), Home dashboard status surfaces, Check results wording, Higgins conversation surfaces, onboarding/permissions/error messages, universal deep-linking for every message type (gate details, Check result, permission screens, Support), and automated routing/consistency tests. Then the "Copy of support email to user" item (user chose: CC the user + Sent copy; capture email once in Support).

Verification: tsc + ESLint clean on all touched files; full suite 436/443 (7 failures are pre-existing/environmental — app.json missing for iosSourceReadiness, native-bridge/iOS-config/tab-order/brand-asset source assertions — none reference the message layer). Android bundle HTTP 200.


## Support screen enhancement + Apollo naming standard (2026-06)

**Apollo naming standard** — Customer-facing wording uses "Apollo", internal `GuardDog` identifiers retained (per rule). Thorough repo scan done: the ONLY user-facing rendered "guard dog" string was the onboarding hero title → now "Meet Apollo, your calm guard dog for the links you tap." (keeps the allowed dog metaphor). App display name is already "Apollo"; notifications already say "Apollo". All other ~249 hits are internal (Kotlin `com.guarddog.*`, class/method names, `guarddog_production` env, config plugin, SharedPreferences keys) or code comments — correctly left untouched. The email body keeps the spec-mandated product descriptor "Apollo Cyber Security Guard Dog".

**Support screen (app/support.tsx, full reorganise into 5 collapsible sections):**
1. App & Device Details — real metadata via expo-application/expo-device/expo-updates (`src/support/supportInfo.ts`). OTA bundle date vs native install/update dates reported distinctly; unknown → "Unavailable"; preview builds flagged, never fabricated. Kept `support-version`/`support-build`/`support-more-details-panel` testIDs.
2. Protection & Services — plain-English states from `ProtectionStatus`/`NetworkStatus`/`EnforcementEvidence`/intel (`buildProtectionRows`). A reachable/enabled service is never shown as a verified block; only "Active and verified" = OS-confirmed enforcement; preview = "Available".
3. Protection Issues & Higgins Checkup — last checkup time/result/warnings + missing permissions + the 4 system-health rows (display only). "Check now" replaced with **Go to Check** → Check tab. Higgins Re-check now also refreshes system health so Support reflects it.
4. App Logs & Diagnostics — View recent activity, Copy Support Summary (expo-clipboard), Export Higgins Diagnostic Report (expo-print + expo-sharing). Redacted: only status/counts/dates, no credentials/tokens/browsing history.
5. Contact Apollo Support — **Email Apollo Support** to support@harmonywellnessgroup.com.au via expo-mail-composer (mailto fallback with correct encoding + oversize guard; Copy Summary fallback when no email app). Never auto-sends, never auto-attaches. Subject `Apollo Support [AP-YYYYMMDD-<128-bit hex>]`; reference minted with expo-crypto CSPRNG (`src/support/supportReference.ts`), reused on reopen, new on "Start a new support request"; identical reference across subject/body/report.

New deps: expo-mail-composer. New modules: src/support/{supportReference,supportInfo,supportSummary,supportEmail}.ts. Tests: tests/support.test.ts (6/6 — protection states, preview truthfulness, higgins merge, shared reference, redaction, reference format). tsc + ESLint clean; firstCheck 9/9, systemHealth 4/4 (incl. updated Go-to-Check assertion), gate7/higgins 67/67; Android bundle HTTP 200. Note: tests/iosSourceReadiness.test.ts fails at load reading app.json (generated only at build time) — pre-existing env issue, unrelated.


## Higgins First Check + Re-check (2026-06)

- **Problem:** Apollo must never assume a newly installed device is clean. Added an onboarding malware/virus/compromise BASELINE assessment ("Higgins First Check") and a manual "Higgins Re-check" in the Check tab, per the owner's detailed spec. Point-in-time, capability-based, local-first — NOT an antivirus engine and NOT a background scanner.
- **Architecture (all frontend):**
  - `src/domain/firstCheck.ts` — pure, unit-tested engine. Per-check states PASS/INFORMATION/CAUTION/SUSPICIOUS/CONFIRMED_THREAT/NOT_AVAILABLE/ERROR; overall CLEAR/ATTENTION/HIGH_RISK/CONFIRMED_THREAT/LIMITED_CHECK/ERROR. Checks: apollo_integrity, device_integrity (root/jailbreak — NOT_AVAILABLE on current build, never upgraded to PASS), application_risk (Android signals only; iOS/web NOT_AVAILABLE), network_config (VPN/profile/cert), os_security (OS version = INFORMATION only). `deriveOverall` + `diffFirstCheck` + Higgins copy. **Heuristics alone can never produce CONFIRMED_THREAT** — only a deterministic `osReportedThreat`.
  - `src/security/firstCheckSignals.ts` — collector reusing existing Diagnostic Core adapters (`AppDeviceSdk.getDeviceSecuritySignals`, `securityAdapter.getProtectionStatus`/`getDeviceProfileFacts`). No new native subsystem; nothing uploaded. Collection failure → honest ERROR report.
  - `src/store/firstCheckStore.ts` — local baseline + history (cap 30), reuses `storage`.
  - `src/components/FirstCheckResult.tsx` — shared result UI (checked / found / couldn't-check), embeds `GateInvestigation` for the AI/Higgins plain-English pass (owner chose on-device signals + AI summary).
  - `app/first-check.tsx` — onboarding screen. Onboarding order is now setup-gates → `/first-check` (runs baseline, saves it) → `/(tabs)/home`. Never shows all-clear before First Check completes; a concern never blocks entry.
  - `app/recheck.tsx` + Check It card ("Higgins Re-check") — manual re-run, diffs against previous baseline, auto-runs the AI pass, saves to history. Not duplicated in Gates.
- **Also (P1):** "Trust this number" / "Trusted — tap to remove" button added to the Call Gate RESULT card (`app/call.tsx`), not just the picker overlay.
- **Verification:** `tsc --noEmit` clean; ESLint clean on all touched files; `tests/firstCheck.test.ts` 9/9 (CLEAR/ATTENTION/HIGH_RISK/CONFIRMED_THREAT/LIMITED/ERROR + NOT_AVAILABLE-never-PASS + re-check diff); gate7/higginsChecks regressions 67/67; Android Metro bundle compiles (HTTP 200). Testing agent NOT used (project rule: not authorised without explicit owner approval; web preview is fail-closed for native). Device-side behaviour of native signals needs an EAS Android build to confirm.


## Expo preview startup crash correction (2026-10-02)

- **Problem:** The boot heartbeat passed `locale` from `deviceMeta()`, but the frontend `device_register` privacy allow-list omitted that backend-supported field. Egress validation throws synchronously, before the previous `.catch()` existed, so startup emitted an unhandled `EgressViolation` that could be reported as a preview crash.
- **Correction:** The egress contract now includes the backend `DeviceRegister.locale` field, remains deny-by-default for unknown fields, and heartbeat construction runs inside its contained Promise chain so a future contract mismatch cannot escape boot.
- **Verification:** TypeScript and ESLint pass; focused privacy/security tests pass 13/13; bounded backend health pytest passes 12/12; `/api/health` is healthy; Android Metro bundle generation succeeds; fresh external preview reaches Home without an error fallback or fresh `EgressViolation` console entry. Independent iteration 77 repeated the cold-load, console, privacy, security-boot, Android bundle and health checks with no startup-crash regression. Backend pytest discovery is now location-independent through `backend/pytest.ini`; the tester's root-directory invocation passes 6/6.
- **Expo Go boundary:** Apollo requires its custom native security module. Expo Go cannot load that module and therefore remains intentionally fail-closed on the existing Safe Start screen; native protection must never be simulated to make Expo Go appear operational.

## Android EAS/CNG build input follow-up (2026-09-24)

- **Problem:** Android APK build reported `script: line 199: expo: command not found`. The complete failed-build log/build ID is unavailable in this workspace; a previous preparer emitted this *same* message non-fatally (`docs/APOLLO_BUILD_RECORD.md`). Do not assign an unverified root cause or claim an APK was built.
- **Source correction:** The locally present, untracked npm `package-lock.json` has been deleted and excluded by `.gitignore` and `.easignore`, preserving Yarn 1 and its updated `yarn.lock`. CI now rejects either tracked CNG native folder or a competing npm lockfile. `frontend/android/gradle/wrapper/gradle-wrapper.jar` remains deleted in the working tree and needs a saved source commit to disappear from Git's tracked index. An existing local generated `ios/` folder is ignored and excluded from EAS; it was not modified.
- **Verification:** `yarn install --frozen-lockfile`, staging EAS pre-install security preflight, Expo SDK 57 config/app ID, TypeScript, bounded backend health pytest, and CNG/build-input checks pass. No EAS cloud run or physical-device acceptance was available. Standard npm/Yarn scripts have the local Expo binary on PATH; project pre-install hooks do not invoke `expo` directly. The external preparer message cannot be fixed by changing npm script spelling alone; a fresh EAS build with its full terminal log is still required to verify resolution.
- **Static deployment scan boundary:** The generic scanner still reports ignored `.env` secrets, the read-only proxy supervisor without `--tunnel`, and deliberate short-lived OAuth CSRF state expiry as blockers. None is evidence of the reported APK CLI failure. Committing the owner key or weakening CSRF cleanup would contradict product security requirements; these were not changed.
- **P0:** Save deletion of the final tracked native JAR and build-input changes to source, then retry an Android APK build and identify the *fatal* failing step (not just the preparer warning). **P1:** Physical-device Android acceptance. **P2:** Decide the future of family/remote push routes.

## P0 in-app Apollo and Higgins health check (2026-09-24)

- **Problem:** Replace production benchmark/acceptance and alert-delivery test controls with one truthful, manual, owner-scoped four-part health check on Support. Keep Android CNG/JAR cleanup as a separate repository task.
- **Architecture:** `/api/health` is strict public DB-independent schema-1 liveness (`service: apollo-v1`); `/api/health/readiness` is bearer-protected and maps database, maintenance, queue, privacy cleanup, encrypted report store and existing owner-configured Gemini provider into bounded codes. `/api/health/higgins-checks` has the documented minimal 202 admission (checkId/state/createdAt/expiresAt) and a terminal response with a top-level cleanup status; it accepts an empty body, device-scoped idempotency key and a 15-minute cooldown. A durable content-free job invokes the existing Higgins Gemini client exactly once with a fixed fictional scenario, validates with the existing schema/redaction, round-trips through the same encrypted Saved Report store, explicitly deletes its separate TTL-backed artifact and verifies absence. Stale jobs are recovered without repeating provider calls. No user content or provider answer is persisted in diagnostic job documents.
- **Mobile:** Support has one four-result health card with the required Working/Needs attention/Could not check labels, observed timestamps, one primary Check now action and technical data behind More details. Both ordinary saved reports and the synthetic fixture share one escaped PDF preparation path; the diagnostic file is disposed after validation. A cached Higgins result is labelled earlier/degraded. Production benchmark and GuardDog acceptance routes, mobile benchmark corpus/code, and Settings test-delivery button are removed; benchmark corpus is now backend test-only.
- **Verification:** Backend full `pytest -q`: 414 passed, 16 skipped. Targeted health suites: 24 passed. Frontend: TypeScript, ESLint and 451 Node tests pass; native singleton guard and CNG source preflight pass. The **one** authorized live backend owner-key Higgins diagnostic completed with encrypted report round-trip and zero retained temporary artifacts; the key value and provider text were never output. Android/iOS device PDF rendering, real UI interaction and native build acceptance remain **PENDING**; use a supported device/build host before claiming them.
- **P0 remaining:** Independently reviewed CLI/source acceptance contract; verify native device-side PDF preparation and user interaction on supported builds. Commit the already-deleted final `frontend/android/gradle/wrapper/gradle-wrapper.jar` separately; it is still tracked in Git until committed.
- **P1/P2 backlog:** Re-evaluate device-side PDF retention on physical iOS/Android and privacy cleanup monitoring. Existing family/remote push routes remain unchanged pending a separate product decision.

## Android Firebase removal / CNG handoff (2026-09-24)

- **Problem:** Remove Apollo-owned Google Services configuration and Expo remote push registration without losing local protection alerts or modifying GuardDog enforcement, evidence, Higgins diagnostics, or signed trust/rules.
- **Architecture:** `app.json` no longer references Google Services; the GuardDog Kotlin serialization config plugin no longer relies on the Google Services Gradle anchor. Local notification permissions, channels, Apollo sounds and evidence-gated on-device alert scheduling remain with `expo-notifications`. The frontend no longer registers Expo push tokens. Backend family-alert/owner push routes remain unchanged pending a separate delivery decision.
- **CNG safety gate:** Before deleting the 47 tracked `frontend/android/` files locally, a clean temporary Android prebuild reproduced 42 files byte-for-byte, omitted only the Firebase JSON file and changed four generated files solely for Google/FCM metadata removal and preserved Kotlin serialization. Autolinking, module manifests, notification sounds, permissions and the frozen GuardDog 91/91 checks passed. `.gitignore` and `.easignore` already exclude `/android`. Evidence: `/tmp/apollo-cng-parity.2N89Fe/parity-audit.json` (temporary; rerun after a workspace reset).
- **Verification:** Final clean Android prebuild and generated-project check pass using nonproduction CI trust fixtures. TypeScript, ESLint, 443/443 Node tests, CNG source preflight and native dependency guard pass. Android `:app:assembleDebug` did **not** compile here (no JDK/Android SDK); Android JS bytecode export did **not** complete (ARM64 host versus bundled Hermes compiler). Neither launch nor local alert delivery/sounds, background behavior, runtime Firebase logs or physical enforcement have been verified on a device.
- **P0 handoff:** The 47 native paths are deleted in the working tree but remain tracked in Git until the deletion is committed. Compile a clean CNG Android project with release-owner trust inputs in a compatible Android/JDK toolchain before claiming build success.
- **P1 owner acceptance:** Validate Android launch, local protection/Higgins alerts, sound/channels, true packet-proof-only Biting and runtime logs on a physical device. Local JS alerts need an active observation path; closed-process VPN-event alert delivery must not be assumed without device/native verification. Decide separately whether existing backend Expo family/owner delivery remains part of the product.

## Apollo brand logo and app icon (2026-09-23)

- User-supplied shield-and-guard-dog artwork now drives the in-app Apollo logo, iOS/legacy Android icon, Android adaptive foreground and web favicon.
- Native variants use platform-safe padding; the iOS icon is opaque and Android adaptive foreground is transparent over Apollo's configured `#F5F7FA` background.
- Original artwork is preserved and variants are reproducible with `frontend/scripts/prepare-apollo-logo.py`.
- Launch splash remains unchanged because the confirmed scope was the in-app logo plus app icon.

## Apollo downloadable media kit (2026-09-23)

- Public gallery and ZIP now expose 28 faithful screen exports plus 12 state GIFs.
- Media is reproducible with `frontend/scripts/generate-apollo-media-kit.py` and served from `frontend/public/apollo-media-kit`.
- The existing dark preference currently uses the Light Sentinel palette, so light/dark export pairs intentionally match source rather than inventing an unsupported theme.

## Gmail production OAuth readiness (2026-09-23)

- Production callback: `https://threat-patrol-1.emergent.host/api/gmail/oauth/callback`; Gmail API scope remains exactly `gmail.readonly`.
- OAuth state is now opaque, hashed, single-use and TTL-limited; redirect destinations are allow-listed and expanded Google scope sets are rejected.
- Unreadable legacy refresh grants are deleted safely and require explicit reconnect; mailbox scans with no connection return a truthful 404.
- P0 external/user action: refresh the hosted backend to the latest source, then have an allow-listed Google test user complete **Connect Gmail read-only**. Restricted-scope verification/custom-domain ownership remains necessary before unrestricted public OAuth access.

## Higgins Apollo transactional email (2026-09-23)

- Migrated guardian invitations/alerts from owner-managed Resend credentials to the platform-managed verified transactional sender.
- Sender identity: `Higgins Apollo`; no Reply-To inbox configured.
- Backend retains stable event idempotency and truthful delivery receipts; caller cannot supply subject or HTML, and all templates pass a structural credential/link safety gate.
- Provider-owned test-sink submission and the authenticated guardian invitation route both returned provider acceptance references.

## FF10 Family Help — configuration-gated source complete (2026-09-23)

### Problem statement
Let one paired family helper watch an owner-consented mobile screen session without control, audio or recording, while the backend owns authorization, lifecycle and time limits and no media/SDP/ICE enters durable product storage.

### Architecture implemented
- FastAPI/MongoDB owns relationship/device authorization, revisions/generations, invitation/consent/active deadlines, stale callback rejection, one-session concurrency, single-use WSS tickets, closed bounded signaling and minimal terminal events.
- A server-only Cloudflare broker requests temporary `iceServers` through the Cloudflare Calls TURN credential API. Provider token/Key ID stay server-only; response fields/hosts are strictly validated; credentials last at most one hour and are refreshed natively before an ICE restart. Generic coturn realm/shared-secret settings are ignored.
- Apollo-owned Expo module uses Android MediaProjection + foreground service and iOS ReplayKit Broadcast Upload; WebRTC frames and helper rendering remain native. First release has no microphone, system audio, recording, remote control or data channel.
- Mobile routes cover overview, helper/scope selection, invitation wait, accept/decline, native consent, owner pause/resume/extend/stop, helper view and neutral pause state.

### Backlog
- **P0 application source:** none identified for configuration-gated FF10.
- **P1 sole activation dependency:** an authorised infrastructure operator places the associated Cloudflare TURN API token directly in server secrets and runs `docs/FF10_TURN_DEPLOYMENT_SPECIFICATION.md` preflight, then performs two-device forced-relay acceptance. Until then Family Help stays unavailable.
- **P2 external evidence:** Apple Xcode compile/signing, physical-device lifecycle, NAT/relay matrix and production capacity/incident drills.

## Phase 2 execution — authorised baseline (2026-09-22)

### Controlling scope
- `Apollo_Consolidated_Architecture_and_Execution_Mandate-3.md` Phase 2 execution cover controls current work.
- Exact pre-change source HEAD: `d1ab4ff22f7476fefd3999e6c292c3ac92f2e30b` on local `main`; no remote/upstream is configured in this workspace.
- M1–M4 remain complete. Execute only P2.1–P2.6, using C19–C25 and V27–V36 as the active register.

### Architecture and delivery order
- **P2.1:** remove SecureCore completely; ship Home, Higgins, Gates, Check It, Patrol navigation with shared top-right Settings.
- **P2.2:** replace manual/automatic Gate labels with independent truthful automatic and on-demand capabilities.
- **P2.3:** separate ordinary Higgins chat from investigations and add typed owner-scoped context access.
- **P2.4:** project meaningful deduplicated Patrol outcomes rather than commands and diagnostics.
- **P2.5:** build the Higgins hub, redacted history, saved reports, learning and recognised-government New scams.
- **P2.6:** integrate one compatible release, complete traceability and produce a fresh Android candidate while isolating genuine signing/toolchain blockers.

### Verification boundary
- TypeScript, ESLint, provider-disabled pytest and Cargo/native source checks only.
- No testing agent, Playwright, scenario suite or live Gemini probe.
- Owner `GEMINI_API_KEY` only; no Emergent-managed LLM key.
- Android package remains `app.apollo.hwg`.

### Implemented Phase 2 release
- P2.1–P2.5 are complete in source: exact root navigation, Check It, truthful Gate capabilities, ordinary Higgins chat, typed owner context, consumer Patrol outcomes and the Higgins hub/history/learning/government-alert surfaces.
- P2.6 integrated source candidate is Apollo `1.1.0`, Android `2`, iOS `2`, desktop `1.1.0`.
- TypeScript, ESLint, Python lint, 53 provider-disabled pytest checks, security/native preflight, Cargo and Apollo-owned Android release Kotlin modules pass.

### Backlog
- No remaining application-source item from Phase 1, Phase 2 or Package 6.
- Signed builds, installer production, notarisation, store work and physical-device acceptance are build-owner responsibilities and are not development backlog items here.

## Phase 2 source remediation — completed locally (2026-09-22)

- Production and app-bundle profiles now default to Apollo-owned GuardDog production authority and fail closed when signed trust is unavailable.
- Retired references are absent from active source/test/config/support/design inputs; navigation and reusable Settings behaviour are stable.
- Gates use one consumer model/card each; ordinary chat has registered read-only context tools; unavailable reasons are canonical; Patrol uses five meaningful states.
- Higgins provides stable current/recent/history/report/learning/New scams entry points. History survives case evidence cleanup as redacted summaries.
- Backend owns 35 curated learning articles and official-source feed/admin lifecycle; consumer learning is no-store and ships no article bodies.
- Validation: TypeScript, ESLint, Python lint, 373 Node tests, 61 provider-disabled pytest tests, staging/production preflight and Cargo pass.
- Final GitHub save remains required before build-owner handoff. No artifact/deployment/device/signing work was performed in this source package.

## Package 6 native source delivery — complete locally (2026-09-22)

- iOS/iPadOS: real Content Blocker, Call Directory, unknown-sender Message Filter and Share Extension targets; App Group queue stores no raw message content.
- Windows: WFP ALE service, dynamic exact-destination filters, WFP drop evidence with app/process attribution, service lifecycle and NSIS packaging source.
- macOS: Network Extension system extension, source-app attribution, bounded enforcement evidence, activation helper, required entitlements and unsigned embedding source.
- Desktop host reports actual installed/active state and canonical missing/permission states; no native source is represented as live protection.
- Validation: TypeScript, ESLint, Python lint, 381 Node tests, 58 provider-disabled backend pytest tests, 9 GuardDog source pytest tests, Cargo, 5 Rust tests, Windows x64 cross-link, Expo extension resolution and both security preflights pass.
- No signed/native artifact or device result is claimed. Final Package 6 GitHub save is the only source-handoff action remaining.

## GuardDog production-default authority — controlling update (2026-09-23)

- The owner's uploaded `Apollo GuardDog Production-Default Activation` instructions are FIRST / CRITICAL and authoritative over earlier GuardDog wording.
- GuardDog must be the Android production-default engine with the existing M2 Website Gate DNS/sinkhole path active under the same process-lifetime Apollo owner; selector-only cutover is insufficient.
- Frozen `frontend/packages/guarddog-*` files remain immutable. Production has no legacy/acceptance/simulated fallback and accepts public roots plus signed artifacts only—never private keys.
- Biting remains restricted to fresh authorised packet-drop evidence. Developer scope is GD-PROD-01 through GD-PROD-08 source/configuration/checks/handoff; signed artifacts and physical-device review remain release-owner scope.
- Authoritative source URL and continuation boundary: `memory/APOLLO_GUARDDOG_PRODUCTION_AUTHORITY.md`.
- GD-PROD-01 through GD-PROD-08 developer source scope is complete: production-only selection, single owner, independent-root signed trust, frozen M2 Website Gate wiring, lifecycle reconciliation, truthful coverage/evidence, bounded checks and handoff manifest.
- External completion remains: owner public trust/feed inputs, release-host signed candidate production, and physical-device enforcement/expiry/revocation/rollback evidence. Detailed handoff: `docs/APOLLO_GUARDDOG_PRODUCTION_HANDOFF.md`.

## Phase 2 remediation and Learn with Higgins — implemented (2026-09-23)

- Authority: `memory/APOLLO_PHASE2_LEARNING_AUTHORITIES.md`.
- C22: canonical device-result absence values now pass the pre-provider serializer; safe retry preserves request/result identity.
- C23/C21: ordinary chat has bounded retention and read-only access to the authoritative capability/Gate registry, existing investigation/report history, Patrol outcomes, learning preferences and recognised-government alerts. It cannot start investigative work.
- C24: immutable server Patrol records own revisions, deduplication and effective display state. Consumer history uses server projections and timelines; Biting still requires fresh validated enforcement evidence.
- C25/Learning: governed backend catalogue, source/feed registries, editorial workflow, permissions, audit, candidate review queue, safe feed transport, filters/preferences and structured mobile reader are implemented. The explicit import path published 43 Australian starter articles in this environment.
- Verification: TypeScript/ESLint, 385 Node checks, Python lint/compile, 77 bounded provider-disabled pytest checks, and local no-provider APIs pass. Scamwatch was fresh in development; ACSC truthfully reported unavailable after a read timeout; no feed candidate auto-published.
- Developer verification and exact boundaries: `docs/APOLLO_PHASE2_LEARNING_IMPLEMENTATION_RECORD.md`.
- P1 external operation: configure least-privilege admin keys, verify each registered government feed from production egress, and conduct editorial acceptance. Live Gemini and physical-device acceptance remain separate.

## C15 / GuardDog production-default activation — source implemented (updated 2026-09-23)

### Problem statement
Create a production-distinct GuardDog authority without promoting the frozen M1 acceptance profile: one process/runtime owner, pinned production roots, signed update trust, rollback/recovery authority, validity/revocation, offline key custody, explicit build selection and truthful cutover evidence.

### Architecture implemented
- **Selection:** production, app-bundle and guarddog-production all select only `guarddog_production`; legacy activation is rejected natively in production, and `guarddog_acceptance` remains forbidden.
- **Trust:** pinned primary/recovery public roots sign strict domain/profile manifests. Manifests introduce ordinary rule keys only; recovery can permanently disable primary authority. Generations, versions and envelopes are rollback/conflict checked.
- **Persistence:** accepted trust/rules are HMAC-bound to Android Keystore state with backup disabled. Missing/replaced integrity state fails closed.
- **Runtime:** one Apollo-owned engine/verifier/registry/version-store/listener/VPN route. The accepted engine is wired into the frozen M2 Website Gate DNS gateway, sinkhole /32 routes, physical-network IPv4 DNS forwarding, allow-only override cache and packet-drop reporter before start.
- **Updates/expiry:** HTTPS signed refresh every six hours plus expiry stop, boot/unlock/package-replace reconciliation and physical-network DNS-change restart; persisted valid authority can bridge temporary network loss but never its deadline.
- **Key custody:** offline Ed25519 signing tools reject private key paths inside `/app`. App/plugin/preflight reject M1 acceptance key material and accept only public roots/signed artifacts.

### Verification and boundaries
- TypeScript compilation and ESLint pass.
- 9 GuardDog production source/configuration pytest checks plus 58 provider-disabled backend lifecycle pytest tests pass.
- TypeScript, ESLint, frozen GuardDog 91/91 hash checks, production preflight, Cargo check, 5 Rust tests and Windows x64 cross-link pass.
- No Playwright, scenario agent, live Gemini call or Emergent-managed key was used.
- Android Kotlin source compilation is performed in this continuation. Physical-device trust/rollback enforcement remains unrun and is not implied by compilation.

### Priorities
- **P0:** C15 production source track complete.
- **P1:** Owner supplies only public roots, signed update artifacts and HTTPS locations; the build/device owners then produce signed candidates and device evidence.
- **P2:** Release evidence packet and long-term rotation/recovery drill records follow device acceptance; production never falls back to legacy.

## Consolidated architecture mandate — M3 implemented (2026-09-22)

### Problem statement
Close the remaining lifecycle semantics: cancellation must report the actual race winner and fence downstream effects; saved reports, speech, family voice, captions and retry UX must have explicit identity, ownership and cleanup.

### Architecture implemented
- **Cancellation:** server outcomes are typed as cancelled/completed/failed/superseded. Accepted turns are detected from the encrypted accepted-commit ledger; the mobile case store refreshes and displays completion if it won. Duplicate cancel is idempotent and stale cancel preserves newer work.
- **Narration:** speech jobs enter an observable active state, verify epoch/work epoch before and after provider calls, and purge partial chunks on cancellation, deletion, expiry or provider/unexpected failure.
- **Saved reports:** persistent historical scope/sources/actions/revision/retention notice, stable list/detail retry controls, and owner-scoped deletion of report plus speech scope/cache.
- **Family voice:** stable recording submission ID, relationship generation, idempotent attachment, pre/post publication link validation, unlink transcript fencing and caption updates conditional on an unrevoked matching generation.

### Verification and boundaries
- TypeScript compilation and ESLint pass.
- 58 investigation/lifecycle pytest tests pass with `GEMINI_API_KEY` explicitly disabled.
- Cargo check passes.
- No Playwright, scenario/testing agent, live Gemini call or Emergent-managed key was used.
- Android Gradle/Kotlin compilation remains intentionally outside the owner-approved verification commands.

### Priorities
- **P0:** M3 source implementation complete.
- **P1:** Continue the C15 production GuardDog source track, then preserve explicit legacy/production cutover separation.
- **P2:** Production-default cutover remains separate.

## Consolidated architecture mandate — M2 implemented (2026-09-22)

### Problem statement
Close the six case/job coordinator findings in M2: durable automatic Text intake, one Gmail pipeline, mixed-document evidence fidelity, restart-safe source/model continuity, honest app/device provenance and first-class Saved Reports.

### Architecture implemented
- **Automatic Text:** encrypted revision-aware Android queue with fixed expiry, serialised read/modify/write, explicit overflow/key failures and WorkManager delivery. Foreground and background consumers use one owner-authenticated idempotent case intake.
- **Gmail:** a single leased manual/monitored intake with durable page cursor and receipt deduplication. Raw email remains request-scoped until encrypted temporary evidence; final Patrol projection is model-free.
- **Evidence:** mixed PDF visual pages are rendered beside text; DOCX expansion is pre-bounded, images are extracted under secret admission, and undecodable drawings remain explicit gaps. Complete provider transcripts are not silently clipped.
- **Coordinator continuity:** immutable fetched-source snapshots back every URL cursor; jobs persist their original Gemini model; a replay-safe non-model projector translates accepted case state into Patrol.
- **App/device facts:** exact package visibility without vendor-prefix trust; requested, granted, special-access and user-reported permission origins remain distinct.
- **Reports:** independent Patrol list/detail UX, historical labeling, stable keyset paging, reopen/speech and owner-scoped report/speech deletion.

### Verification and boundaries
- `tsc --noEmit` and ESLint pass.
- 53 M2-focused backend pytest tests pass with `GEMINI_API_KEY` explicitly disabled.
- `cargo check` passes.
- No Playwright, scenario/testing agent, live Gemini call or Emergent-managed key was used.
- Android Gradle/Kotlin compilation was not run because the owner permitted only TypeScript, ESLint, pytest and Cargo checks. Native changes remain source-verified rather than Android-compiler-verified in this milestone.

### Priorities
- **P0:** M2 source implementation complete; owner/native build verification remains separate.
- **P1:** Continue M3 (`C13`, `C14`) and then subsequent consolidated-mandate milestones without weakening the M1/M2 ownership boundaries.
- **P2:** Production-default cutover remains separate.

## Consolidated architecture mandate — M1 implemented (2026-09-22)

### Problem statement
Apply the consolidated Apollo architecture starting with every M1 finding while preserving the Gemini-only owner-key boundary and avoiding scenario/browser automation. Repair lifecycle ownership, background supervision, Settings contracts, single-investigator behavior, durable Patrol continuity, ambiguous audio cleanup, consumer status language, settings-return recovery and shared protection health.

### Architecture implemented
- **Investigation lifecycle:** fixed 15-minute client deadline reserved before I/O, explicit UUID/event submission identity, generation guards after async boundaries, owner-bound server event→case association, and terminal disposal of transient references/indexes.
- **Backend workers/storage:** lifespan-owned maintenance supervisor with bounded per-component work, independent failure containment, component telemetry/backlog health, and durable `outcome_unknown` family-audio cleanup.
- **One investigator/actions:** App and Account compatibility APIs perform lookup-only non-AI work; the shared case engine is the only Higgins presenter. Settings plan/recheck egress matches Pydantic exactly and binding failures are visible.
- **Protection recovery:** one shared health coordinator/store owns startup, foreground, periodic, Support and post-action checks. Android reports whether system UI opened, was already granted, failed or is unsupported; a durable typed attempt resumes on return/cold boot and deduplicates prompts.
- **Consumer UI:** Home and Protection show component-scoped status and direct actions. Technical build/provider diagnostics are separated under Support. Recurring visibility alarms and routine verification controls were removed.

### Verification and boundaries
- Frontend TypeScript compilation and ESLint pass.
- Focused M1 backend pytest passes with `GEMINI_API_KEY` disabled; no live provider call was used.
- Desktop `cargo check` passes after installing the container's standard Rust/Tauri build prerequisites.
- No Playwright, automated scenario/testing agent or Emergent-managed LLM key was used.
- The full legacy pytest attempt still contains unrelated environment-dependent failures where email, family object storage or voice delivery credentials are absent; no application fallback or mock was added.

### Priorities
- **P0:** M1 source implementation complete; owner verification remains separate.
- **P1:** Continue subsequent consolidated-mandate milestones and unblocked Package 6/7 source work. Keep `app.apollo.hwg` and native EAS profiles free of browser preview harnesses.
- **P2:** Production-default protection cutover remains a separate evidence decision.

## Production deployment build correction — EAS app-bundle pre-install

- Diagnosed failed Android app-bundle build `4dee4d9b-99ba-48db-825d-1f63c22414db`: the generated `app-bundle` profile inherited development-web preview-harness values, and the native security preflight correctly stopped the build before compilation.
- Added a production-safe `app-bundle` EAS profile, explicit production environment fail-closed values, and profile-aware preflight resolution that never inherits `.env` development-web defaults for a native EAS build.
- Added `.easignore` and removed 3.6 GB of ignored generated caches from deployment input. No Docker changes were made.
- Verification: four native profile preflights pass; deliberately unsafe app-bundle preview input remains rejected; security tests 6/6, TypeScript and lint pass; deployment health agent reports PASS.
- The failed build has no artifact. The corrected source requires a fresh Android app-bundle build; success is not claimed until that build finishes.

## Current continuation — 7-package mandate repair and Packages 3–5 completion

### Problem statement
Complete the remaining Apollo investigation lifecycle without reopening supported prior corrections: restore automatic durable recovery/retention, make mobile operations case-owned beyond screen lifetime, deliver recoverable PDF continuation images to Gemini, fix the generated Windows filter command, then complete investigation depth/limits, Gate background behaviour, guided actions, saved reports and cleanup. Use only the owner's `GEMINI_API_KEY`; keep live provider access disabled during bounded verification.

### Architecture now implemented
- **FastAPI/MongoDB:** supervised maintenance independently runs temporary-content cleanup, expiry/deletion retry, tombstone cleanup, job/device-inbox recovery and family-audio cleanup with component heartbeat/failure reporting. Gmail monitoring now creates durable temporary Higgins cases and only projects redacted terminal summaries to Patrol.
- **Expo:** `transferManager.ts` owns create/upload/append execution, retry identity, terminal result retention and expiry by strict operation/case pair. Screens subscribe by explicit operation ID; they no longer attach the global latest operation.
- **Evidence/research:** PDF continuation manifest replay repairs image delivery and parent coverage. Clue overflow has `continue_clues`; public research has an explicit entity cursor; device observations retain structured provenance; full protected Gate handoffs and Gmail link destinations are preserved.
- **Lifecycle UX:** unobservable Settings changes may be recorded only as user-reported confirmation; saved reports are paged/deletable; voice uploads create durable orphan-cleanup ownership before object storage.
- **Desktop/native:** Windows PowerShell generation uses `$apolloTargetHost`; Android Text notification content is protected with Android Keystore AES-GCM and removed only after exact durable submission acknowledgement.

### Verification
- Frontend: `tsc --noEmit` passed; `frontend/src` and `frontend/app` ESLint passed.
- Backend bounded suites: recovery/PDF/ownership-adjacent lifecycle **35/35**, maintenance **3/3**, mailbox shared-engine **1/1**, Gmail **11/11**; `/api/health` returned healthy worker/component status. Provider calls were hard-disabled.
- Desktop: generated-command assertion passed; Windows command Rust unit **1/1**; `cargo check --jobs 2` passed.
- Not used for acceptance: live Gemini, scenario/browser automation, testing agent or managed AI keys.

### Priorities
- **P0:** No outstanding finding from the four-item repair list. Keep health datetime normalization and strict operation/case pairing covered.
- **P1:** Produce the next Android correction candidate after this repair pass, then obtain device feedback for the protected Text queue and screen reattachment. Build iOS when Apple signing/team and device UDIDs are available. Produce Windows/macOS packages on matching signed hosts.
- **P2:** Production-protection implementation remains backlog; production-default cutover is a separate approval/evidence decision. Continue desktop WFP/Network Extension implementation separately from manual Gate availability.

### Artifact truth and external blockers
- Existing APK remains available but does not contain this continuation's frontend/native changes.
- Apple credentials/UDIDs block only signed iOS delivery. Windows/macOS hosts/signing block only trusted desktop installers.
- Owner-managed family storage and separately configured email/push credentials block only those service-backed flows.

## Session 5 (2026-09-21) — builds + source-review corrections

- **Android `device-test` APK BUILT**: EAS build `e32f6068-b349-4de8-ab5d-8c950a6596bf`, commit `fa9bf2f`, APK https://expo.dev/artifacts/eas/-R5J9ohNQ6k-MxXloAh_NuawortWikr6zDUyXPbaRlE.apk
  (details/inspection in `docs/APOLLO_BUILD_RECORD.md`). First build `d54b2c70` failed on a pre-existing Kotlin error (fixed).
  EAS is logged in in this workspace (`emergent-em-user-…`, project `threat-patrol-1`) — `npx eas-cli build --platform android --profile device-test --non-interactive --no-wait` works from `/app/frontend`.
- iOS: blocked only on Apple credentials + device UDIDs (recorded).
- Review corrections done: work_epoch vs content epoch (cancel keeps evidence); device submission claimed→stored→resumed with persisted
  result + sweeper; exclusive recoverable upload finalisation; pending tool batch persisted/answered before Gemini (arg-hashed call ids);
  strict preflight validation + targeted redaction (verbatim text with only secrets [REDACTED], visual description, coverage);
  settings plan bound before opening Settings, attempts recorded before launch, native permission requests observed on return, failed
  rechecks retained with retry button; desktop hosts explicit windows/macos identity + descriptors + failures propagate.
- Product gaps: Patrol "Ask Higgins" continues the Gate's case (event→case index); scanned-PDF pages rasterised (pypdfium2) for Gemini
  vision; family voice-note storage lifecycle (retention/purge/unlink/410); tablet/desktop max-width column.
- NEXT EXACT TASK: (1) owner installs APK on Pixel 10 → report native-module behaviour; (2) iOS credentials then `eas build --platform ios --profile device-test`;
  (3) desktop: real manufacturer/model (WMI/IOKit), SSID, WFP/Network Extension filtering service; (4) Text Gate duplicate-guidance dedupe;
  (5) rerun Android build after any native change (`modules/apollo-security`).

## Current continuation status — 2026-09-21, session 4 (revision-1 package; supersedes the blocks below)

Controlling doc: `memory/Apollo_Complete_Developer_Instructions-1.md` (owner revision: **developer scenario testing STOPPED**; no
testing agent, no Playwright/Gemini scenario suites, no new scenario scripts/reports; finish functionality, bounded checks only —
compile/tsc/lint/focused local tests; deliver installable builds; Windows/macOS are REQUIRED targets; zero runtime mocks).

DONE this session (committed locally; owner must "Save to GitHub"):
- S01 zero-mock runtime: `EXPO_PUBLIC_SECURITY_MODE`/`SECURECORE_MODE` removed; `MockSecurityAdapter*`, `securecore/SecureCore.ts`,
  `securecore/mock/*`, `app/dev-tools.tsx` deleted; SecureCore boot dependency removed (Settings: "Not included"); real
  `WebSecurityAdapter`; platform-split `hostAdapter.ts`/`.web.ts`; development-web-only preview harness in `frontend/tools/preview-device-harness/`
  (label "MOCKED DEVICE INPUT — PREVIEW ONLY", `EXPO_PUBLIC_DEVICE_PREVIEW_HARNESS=enabled` in dev `.env` only); preflight scans sources.
- S02 real permissions/facts: Kotlin/Swift `getProtectionPermissions` read real notification/listener/blocker state with recorded
  request history (`requested`/`lastRequestedAt`/`enabled`/`observedAt`/`unavailableReason`); `getDeviceProfileFacts` (manufacturer/model/OS/
  form factor/locale); broker advertises only implemented capabilities; `DeviceProfile.formFactor`, `DeviceResult.unavailableReason` (backend contracts too).
- S03 Settings: `src/settings/guidance.ts` descriptors (Android intents / iOS paths), `actions.ts` executes the bound descriptor and records
  an `ActionAttempt`, `recheck.ts` takes a fresh observation on return and calls `/settings-plan/{id}/recheck`; backend binds plan to the
  advertised descriptor by target; `research_settings` "exact" requires manufacturer AND OS in the same source.
- S04 push protocol: `routers/push.py` rewritten (Expo token + projectId, registrationId, durable `push_deliveries` with unique
  (owner,event,channel,recipient), per-ticket inspection, receipt reconciliation loop, 202 DeliveryStatus / 409 recipient_unregistered / 503 setup,
  `GET /push/deliveries/{id}`, `GET /push/registration`, sound + `threats` channel fixed); frontend `getExpoPushTokenAsync({projectId})`,
  permission vs registration state, bounded pending retry, Settings shows registration.
- S05 writer-lease/tombstone: `settle_write`, epoch-fenced `emit`, `sweep_tombstones` in the job sweeper.
- S06 Gemini-only image secret preflight (ephemeral admission; secret-bearing originals never stored; redacted description retained; fails closed) — verified live.
- S07 client integrity: generation-guarded `refresh`/callbacks/ask/retry/cancel/attach, orphan-case abandonment, persisted deletion retry,
  `GateInvestigation` bound to an immutable submission object on all nine Gate screens (typing never starts/deletes cases).
- S08 durable per-call tool ledger; accepted-turn-first deadline recovery; atomic `(owner,case,request)` claim with canonical hashing,
  superseded-request 409, recoverable continuation record + sweeper completion.
- S09 Text screenshot original image + prior Apollo check, App typed native SDK observation + server lookups carried onto the case.
- S10 clue inventory: document order, phone priority, explicit omitted counts/offsets to the model; clue reads never examine parents; read marks deferred.
- S11 delivery: `eas.json` `device-test` profile (Android APK + iOS internal); `desktop/` Tauri v2 host scaffold + `DesktopSecurityAdapter`
  (typed commands; filtering explicitly `not_implemented`); docs `APOLLO_PLATFORM_DELIVERY_MATRIX.md`, `APOLLO_RUNTIME_SIMULATION_AUDIT.md`.
Checks: tsc clean, eslint 0 errors, frontend security/adapter/guard tests 49/49, backend engine+persistence 10/10, push tests 24/24, preflight OK.
Builds: NO artifact produced in this sandbox (no EAS/Gradle/Xcode/Windows runner). Operator action: Publish → Android `device-test` profile.

NEXT EXACT TASK: (1) trigger Android `device-test` build via Publish and record build ID/SHA in the delivery matrix; (2) iOS signing inputs;
(3) desktop real manufacturer/model (WMI/IOKit), SSID, WFP/Network Extension filtering service; (4) S09 remaining entry routes
(Home quick checks/share/Patrol onto the case; Text still runs `/message/analyse` first as the deterministic initial observation — keep,
but stop showing contradictory duplicate guidance); (5) email idempotency/ambiguous outcomes + family storage lifecycle (§10A);
(6) R06 upload-finalisation claim; (7) tablet/desktop layouts audit. Scenario execution: owner.

---

## Current continuation status — 2026-09-21, session 3 (supersedes the blocks below)

Controlling docs: `memory/Apollo_Complete_Developer_Instructions.md` + `memory/Apollo_Saved_Source_Review_59725fc.md` (R01–R10).
DONE this session (all committed locally; user must "Save to GitHub"): R01 immutable per-attempt commits + crash repair; R02 epoch-fenced
content writes, TTL backstop at expires_at, cleanup revisit; R03 originals purged when they carry secrets, TXT as document; R04 per-round
checkpoints, interrupted-call marker, retry_wait heartbeat, deadline reconciliation; R05 true page totals, tables/headers, whole-page rule,
deferred examination marks, coverage-aware completion validation; R06 separate upload chunks, atomic digest, idempotent finalisation;
R07 clue registration (links/numbers as child evidence), `register_clue` tool, full research snapshots, stable source IDs; R08 plans bound
to capability/expected value/created_at, fresh-observation recheck; R09 generation-fenced store, sequence continuation, retryable deletion;
R10 action dispatcher (`src/settings/actions.ts`), inert actions as text, case-bound narration, honest completion label.
Gate integration: `GateInvestigation` on all ten Gate screens (initial investigation via shared case; Ask continues same case);
device broker bound to `securityAdapter`; mock adapter platform-split out of native bundles; delivery adapters (Resend/Expo push/S3) implemented,
credential-blocked; legacy failures classified (`docs/APOLLO_LEGACY_TEST_CLASSIFICATION.md`); US runner `tests/run_us_scenarios.py`
(US01/03/05/06/24 complete via screens, US11/US35 via API). Tests: engine 7/7, persistence 3/3.
REMAINING: full US01–US35 matrix (US02/04/07–10/12/14–23/25–29/32–34 through normal screens incl. File upload + Device recheck UI),
`src/settings/{guidance,recheck}.ts` Device-screen UI, native Kotlin requested-vs-granted contract, simulated-observation badge in the view,
image secret preflight (Gemini-only), 6 open legacy-route test defects (see classification), Home quick checks/share targets onto the case.

---

## Previous — 2026-09-21, session 2

Controlling specifications: `memory/Apollo_Complete_Developer_Instructions.md` (Stages A–D, US01–US35) consolidating
`memory/Apollo_Final_Code_Review_and_Developer_Package-2.md`. Gemini only via owner `GEMINI_API_KEY`; no testing agent
without explicit approval; Stage 1D cancelled; frozen `frontend/packages/guarddog-*` untouched.

DELIVERED THIS SESSION (verified live with the owner key, no mocks):
- Shared engine `backend/services/higgins/{contracts,repository,evidence,tools,validation,coordinator,jobs}.py` and
  `backend/routers/investigations.py` (all spec §8 routes). Encrypted owner-scoped collections `investigation_*`,
  lifecycle epoch, lease/fence, staged→single-CAS accepted turn commits, SSE events with `after=` reconnect,
  resume/cancel/delete/expiry sweep, resumable uploads, PDF/DOCX/TXT/PNG/JPEG intake with page-level coverage,
  9 typed tools incl. Search-grounded research, device-observation pause/resume, settings plan + recheck, case speech, saved reports.
- `routers/ask.py` is now a thin adapter over the same engine (one engine). Obsolete keyword-validator/fallback tests removed.
- Frontend `src/investigation/{types,client,caseStore,deviceBroker}.ts`, `src/components/InvestigationView.tsx`;
  `app/(tabs)/ask.tsx` rewritten onto cases; all ten Gate screens' Higgins handoffs carry original evidence (`original_evidence`, incl. Link/Site via `EventActions`).
- Probes: `backend/tests/probe_investigation.py`, `probe_document.py`; regressions `backend/tests/test_investigation_engine.py` (7/7).
  Legacy suite: 279 pass / 23 fail — identical to pre-change baseline failures (voice mp3, push placeholder, gate4, prompt tests).

STATUS: Stage A ✅ (native picker lifecycle unverified). Stage B ✅ core (frontend device broker returns honest `unavailable`;
Gate screens' local state not yet case-driven). Stage C 🟡 (backend settings plan/recheck done; Site/Link/Network/App/Device
handoffs summary-only; native permission semantics, preview isolation, `src/settings/*` not started). Stage D ⬜ (US01–US35 NOT RUN
as a suite; only direct probes). Delivery adapters (email/push/storage) remain 503 stubs — blocked on owner credentials and unimplemented.

NEXT: C18 remaining Gate handoffs with originals (Site/Link screenshot+URL, Network, App, Device); bind native observation
adapters to `deviceBroker`; `src/settings/*` + Device screen recheck UI; AR-09 native contract; AR-11 preview isolation;
extend `tests/run_round1_user_scenarios.py` with US01–US35 + `ScenarioOutcome` schema and run live; delivery adapters.
Docs: `docs/APOLLO_IMPLEMENTATION_MATRIX.md`, `APOLLO_INVESTIGATION_ARCHITECTURE.md`, `APOLLO_CAPACITY_AND_RETENTION.md`,
`APOLLO_SETTINGS_CAPABILITIES.md`, `APOLLO_INTEGRATION_CONFIGURATION.md`.

---

## Current continuation status — 2026-09-21 (supersedes conflicting older handoffs)

Controlling specification: owner-uploaded `Apollo_Final_Code_Review_and_Developer_Package-2.md`.
All AI must use the existing owner GEMINI_API_KEY through direct Google SDK; no managed keys or other AI providers.
The testing agent must not be invoked without explicit user approval. Stage 1D remains CANCELLED.

Implemented: direct Gemini text/vision/transcription/speech adapter; removal of active managed dependencies/config;
encrypted fixed-expiry Ask and speech storage with owner isolation, deletion fencing and cleanup; distinct turn retry
identity, strict provider/application completion, opaque handoff navigation, no canned Higgins substitution or prose
clipping; full-length speech segmentation; picker-copy ownership cleanup; conservative incident correlation;
larger explicitly bounded primary text inputs; immutable regression reporting with NOT_RUN accounting.

Verification: real Gemini text, follow-up replay, protected WAV, transcription, screenshot, 13,863-character input,
encrypted DB content, expiry, live deletion race and mobile preview passed direct checks; local preflight 35/35.
All ten full browser journeys were NOT_RUN in this iteration. No testing agent used. Not full architectural acceptance.

BROKEN/BLOCKED pending direct owner credentials: guardian email, push delivery/registration, family voice object storage.
These legacy relays were disconnected as instructed; direct replacements and historical remote-object cleanup are unfinished.
Gmail OAuth/security-data services and frozen native packages preserved.

P0: finish shared typed InvestigationCase/evidence/coverage models and durable job/tool coordinator; full original-evidence
ingest, progress/resume/cancel, semantic claim/action grounding and image secret-preflight. P1: full Gate migrations,
legitimate/ambiguous/threatening and failure matrix, native-free privacy/capacity validation; restore blocked integrations
using owner configuration. P2/P4: existing backlog, native desktop adapters; physical Stage 1D remains cancelled.

Full architecture, current models, key lifecycle, actual failures/fixes, configuration blockers and AR01–AR16 matrix:
`docs/GEMINI_ONLY_MIGRATION_STATUS.md`. Preserve `INVESTIGATION_KEY_FILE` outside Git; never print key values.
Current direct verification credentials are recorded by file reference in `memory/test_credentials.md`.

---

# Apollo V1 — PRD & Build Log

## Current delivery — ten first-class Gates with File and Device health (iteration 74)

### Problem statement
Make File Gate and Device Gate first-class members of Apollo's ten-Gate overview. File Gate must accept selected or shared downloads and attachments without treating a cloud host as proof of safety. Device Gate must assess existing visible app capabilities, permissions, security configuration and Apollo protection health without claiming continuous scanning or malicious behaviour without evidence. Higgins must explain findings, guide remediation, open relevant settings and support re-checks. Stage 1D physical-device work remains cancelled; the product focus is how Apollo and Higgins handle people's real situations.

### Architecture
- **Mobile:** Expo Router + React Native. `message.tsx`, `text-guard.tsx` and `check.tsx` use the shared `MessageAssessmentResult`, guided screenshot-access hook/sheet and the Apollo context.
- **Backend:** FastAPI routes `/api/message/analyse`, `/api/message/extract` and new `/api/link/investigate` call deterministic checks, bounded reputation/web/caller evidence and Gemini through `services/investigation.py`.
- **Persistence:** MongoDB stores sanitised Patrol summaries/evidence only. Raw submitted assessment content is request-scoped and excluded from Patrol, logs and analytics.
- **Native candidate:** `guarddog-acceptance` remains an Android-only staging profile over one Apollo-owned runtime; production remains `legacy`. Imported `frontend/packages/guarddog-*` source is frozen.

### Implemented
- **Ten first-class Gates:** The main Gates overview now contains Site, Link, Text, Call, Network, Account, Email, File, App and Device. File and Device are selectable overview cards that reuse `/file` and `/device`; both truthfully show **Ready to check** because they are user-triggered checks, not continuous monitors.
- **File Gate:** Accepts selected/shared downloads and attachments from any source, keeps cloud hosting source-neutral, performs bounded local signature/extension/text-sample inspection, explains limits through Higgins, and hands relevant URLs or installed/profile/certificate concerns to Link, App or Device Gate. Email Gate now states that a pasted attachment name is not the file and routes to File Gate with Email attachment context selected.
- **Device Gate:** Re-checks existing visible app capabilities, sensitive permissions, VPN/profile/accessibility/notification/developer settings and Apollo protection health. It records observable snapshot drift, separates capability from malicious behaviour, keeps dormant capabilities reviewable, labels protection gaps without alleging tampering, and reserves suspected-tampering wording for specific high-risk/high-confidence change evidence. Higgins opens relevant Settings and offers an explicit outcome re-check.
- **Iteration 73 frontend closure:** Cleared the current frontend lint gate and removed the final warning. Email Gate now leaves its Gmail status wait after eight seconds, presents a truthful retry state, and displays disabled loading labels/spinners while Gmail OAuth opens or a connected inbox scan runs. App Gate remains unchanged functionally and renders correctly.
- **Credential policy correction:** Generic IMAP connection and every mailbox username/app-password input, route and storage function were removed. Existing `imap_connections` rows were purged. Gmail read-only OAuth remains the only mailbox connection path; Apollo never asks for or stores mailbox usernames or passwords. Text/Ask request boundaries redact passwords, usernames, PINs, recovery codes and one-time codes before external processing or history storage; existing Ask history was purged. See `docs/CREDENTIAL_REMOVAL_RECORD.md`.
- Text, Link and screenshot results now show submitted content, scam/clear/uncertain hierarchy, findings, visible unresolved questions, Higgins' exact response, one primary action, safe sources and the processing boundary.
- Chosen screenshots show a preview, run Gemini extraction and automatically continue into the same full investigation. Photo access is explained before prompting; denied settings access is rechecked when the app becomes active.
- Added dedicated `/api/link/investigate`, client egress allow-list/redaction, safe long-request handling and Patrol-safe supporting references.
- Replaced obsolete cloud-denial and raw-Patrol expectations with current purpose-limited, secret-redaction, SSRF and truthful-enforcement contracts; repaired legacy Biting fixtures without weakening packet-evidence validation.
- Live scam, genuine-looking and ambiguous demonstrations are recorded in `docs/HIGGINS_SCENARIO_EVIDENCE.md`; screenshot completion evidence is in `test_reports/iteration_71_screenshot_retest.md`.
- Stage 1D acceptance profile and frozen source preflight pass. `docs/STAGE1D_CANDIDATE_RECORD.md` preserves the still-missing source/build/APK/Pixel fields instead of claiming acceptance.

### Verification
- Iteration 74: independent testing report `/app/test_reports/iteration_74.json` passed **23/23** focused checks. Main-agent regression passes: frontend **352/352**, backend **301/301**, TypeScript and lint clean. Preview confirms exactly ten Gate cards, File/Device **Ready to check** states, direct overview navigation, cloud-file → App Gate → Device Gate handoff, Device protection-health/Higgins recheck UI, truthful Email preview/attachment limits, and accessible Email-source selection in File Gate. Frozen GuardDog packages were not modified.
- Iteration 73: frontend lint and TypeScript compile clean; Gate 1 **13/13**, Gate 7 **37/37**, Gates Overview **6/6**. Preview verification confirms Email Gate reaches an enabled Gmail connect CTA instead of remaining in “Checking connection…”, the OAuth launch shows a disabled “Opening Google…” state, and App Gate enables its assessment action after app-name input. Independent report: `/app/test_reports/iteration_73.json`.
- Backend current regression: **301 passed** (`python -m pytest -q`), including purpose-limited account/link contracts, secret redaction, SSRF boundaries, content-aware fallback and Stage 1D evidence rules.
- Frontend current regression: **352 passed** (`node --test tests/*.test.ts`), TypeScript compile clean, JavaScript/Python lint clean.
- Browser: scam and genuine-looking Text Guard results rendered; genuine content uses “Assessment only — nothing was blocked.” A real nonblank JPEG completed preview → Gemini extraction → automatic Higgins investigation.
- Testing report: `/app/test_reports/iteration_71.json`; deterministic screenshot retest: `/app/test_reports/iteration_71_screenshot_retest.md`.
- Stage 1D: profile/frozen-source/key-permission preflight passes, but controlled acceptance inputs are incomplete and the documented endpoint returns HTTP 404. Android build, APK hash and Pixel acceptance remain not run.

### Priorities
- **P0:** Complete. Keep all purpose-limited privacy, queue/evidence and Truth-of-State regressions green. No investigation may produce Biting.
- **P1:** Evaluate and improve how Apollo and Higgins handle people’s real situations across Text, Link, Email, Call, Account, App, File and Device checks: useful questions, clear uncertainty, relevant evidence, practical next actions and consistent follow-up. Gmail OAuth human consent remains a separate user-verification item, not the main product workstream.
- **Stopped by user:** Do not pursue the controlled endpoint, acceptance signing, Android candidate build, APK hashing or Pixel acceptance run. Physical acceptance remains **NOT RUN** and must not be implied.
- **P2:** Consider macOS/Windows native enforcement adapters only if separately requested.

## Usability and Higgins handoff correction — completed

### Problem statement
Apollo performs supported checks and protective actions; Higgins interprets bounded findings and guides one truthful next action. Manual Gates inspect available evidence first, preserve unknowns, and never turn user selections into proof of safety or compromise.

### Architecture implemented
- Unique issue handoffs carry bounded Gate/state/provenance/uncertainty/confirmed-action/user-report context. Frontend and FastAPI/Pydantic boundaries reject extra fields and redact secrets/direct identifiers.
- Mongo-backed handoff state provides processing/failed/completed idempotency. Conversation IDs isolate issue follow-ups; frontend states cover queued/submitting/streaming/failed/completed with persistent Retry, short references and per-issue counters.
- Structured handoffs pass through a deterministic final Higgins boundary after Gemini review, guaranteeing explicit provenance, uncertainty, no unsupported capability promise and exactly one supported action.
- Generated investigation actions use a shared validated dispatcher with fixed truthful labels and Gate-specific handlers.
- New recovery actions use `recovery_kinds`; legacy “You told Apollo…” records remain parseable.

### Implemented UX and evidence
- File Gate begins with selected/shared evidence, displays supplied metadata/signature/sample limits, asks source/password only when relevant after inspection, and provides truthful filename-only fallback plus picker Retry.
- Account Gate begins with screenshot/paste/description, extracts claims for correction, asks one relevant follow-up at a time, and preserves uncertainty in offline/cloud-assisted analysis.
- Reports await success and retain Retry on failure. Event resolution says “Mark as handled.” Submitted-copy clearing never claims to delete originals.
- Visibility-loss recommendations route to Device Gate; recommendation sheets dismiss before navigation.
- Verification: final frontend **359/359** and backend **305/305**, TypeScript and JavaScript/Python lint clean. Scenario evidence and screenshot paths: `docs/APOLLO_SCENARIO_VERIFICATION.md`; action audit: `docs/APOLLO_BUTTON_AUDIT.md`; independent report: `test_reports/iteration_74.json` (its initial observability gap was closed by per-issue references/counters plus dedicated dedupe tests).

### Current priorities
- **P0:** None open for this correction.
- **P1:** Physical-phone verification for native pickers/share metadata, Settings return, real app/device signals, large accessibility text and keyboard behavior.
- **P2:** macOS/Windows native enforcement adapters.
- **Cancelled:** Stage 1D packet-blocking/physical acceptance exercise; do not resume.

## Round 1 reusable user-scenario regression suite

- Permanent semantic catalogue: `docs/APOLLO_ROUND1_SCENARIO_CATALOGUE.md`.
- One repeatable command: `./scripts/run-apollo-round1.sh --mode repeatable`.
- Separate bounded live mode: `./scripts/run-apollo-round1.sh --mode live`.
- Coverage: threatening, legitimate and ambiguous situations for all ten Gates; five realistic multi-Gate situations; ten complete browser journeys including popups, trusted actions, offline Retry, automatic Higgins handoff, “I already opened it,” “Help me change that setting,” and simpler-explanation continuity.
- Synthetic inputs and preview-only device observations are allowed and explicitly labelled. All Gate selection, investigation, external lookups and Higgins responses are real; no expected verdict or response is injected. Unavailable services produce **INCOMPLETE**, never a substituted pass.
- The 35/35 local semantic matches are preflight only, not investigation/Higgins acceptance. Browser reports carry the real downstream acceptance status and exact live Higgins responses.
- Readable reports: `test_reports/round1_expected_vs_actual_repeatable.md` and `test_reports/round1_expected_vs_actual_live.md`; machine reports use the matching `.json` names; screenshots are under `test_reports/round1_artifacts/{repeatable,live}`.
- Regression totals after Round 1: frontend **364/364**, backend **305/305** (plus focused Higgins handoff **4/4**), TypeScript and JavaScript/Python lint clean.
- Independent verification: `test_reports/iteration_75.json` (full Round 1 repeatable suite) and `test_reports/iteration_76.json` (fresh onboarding smoke selector/navigation).

## P0 remediation stage — VERIFIED CLOSED (iteration 64)
- User approved completion of the full P0 stage. P0-01 through P0-06 are implemented and individually recorded as **VERIFIED CLOSED** in `docs/STAGE1D_P0_REMEDIATION_BACKLOG.md`; original review identities and archived source remain intact.
- Final punch list closed: durable evidence queue rejects acknowledged stale-version replay over newer pending state; `public_get` performs bounded per-hop HEAD preflight with explicit safe GET fallback; changed evidence identity binding returns 409 before fresh truth validation while new invalid Biting stays 422; `__apollo_test_setup=1` provides a non-persistent development-web-only test entry and is unavailable in production/native.
- Verification: main-agent full relevant backend P0 matrix **81/81**, frontend P0 suites **19/19**, direct preview bypass pass; independent iteration 64 **32/32 backend**, **19/19 frontend + 2/2 preview checks**, no critical/minor issues; GuardDog SHA manifest **91/91 unchanged**.
- Boundaries: this closes software P0 remediation only. Expo/web native-security fallback remains **MOCKED** and is not enforcement evidence. Stage 1D is still NOT STARTED; physical start/stop, genuine packet-drop, A4E device persistence and actual notification delivery remain separate native acceptance work. ChatGPT model integration remains a separate requested task and was not started during P0 closure.
- **P0:** complete. **P1:** finish Stage 1D candidate build/device acceptance, then resolve T1–T5 production certification separately. **P2:** future consumer enhancements only when explicitly requested; ChatGPT integration was cancelled by the user.

### P0-03/P0-05 post-closure hardening — iteration 65
- Historical Patrol retrieval now revalidates and persistently downgrades invalid pre-gate call-screening Biting across Patrol, weekly and admin retrieval paths.
- Identical evidence replay is read-only and returns the current stored event; replacement event evidence and cross-event evidence reuse are atomically rejected through dual Mongo unique bindings, including real concurrent requests.
- Delivery pending capacity is 256 with explicit persisted overflow and no pending eviction; locally retained Patrol events retry when space returns. Receipt history is capped at 1,024 with 30-day TTL pruning persisted to storage.
- Verification: main backend P0 **84/84**, frontend **21/21**, preview PASS, GuardDog **91/91 unchanged**; independent iteration 65 backend **50/50**, frontend **21/21 + 2/2 preview**, live Mongo indexes/races PASS.
- Stage 1D test-candidate work proceeded under explicit authorization. Production T1–T5 certification remains separate.

### Stage 1D acceptance candidate — iteration 66
- Added one Apollo-owned Android runtime over frozen GuardDog core/VPN and excluded the competing frozen Expo bridge from autolinking. The reporter wrapper captures original evidence ID, observation time, protocol number and ports before invoking the engine, then correlates only matching genuine engine event ID/IP; missing values are never inferred.
- Added test-only `guarddog_acceptance` selection, `packet_filter` truth mapping, durable native-evidence acknowledgement ordering, isolated signed-fixture provisioning, internal APK build profile, and `/guarddog-acceptance` consolidated Pixel workflow. Production policy and build profile remain explicitly `legacy`.
- Recovered assets: pinned test public key exists; referenced signed bundle/private signing fixture are absent from the current tree and all reachable git object names. Historical `m1-block-test.guarddog.example` does not resolve and its `203.0.113.7/10` values are TEST-NET, not usable infrastructure.
- Verification: TypeScript PASS; candidate/P0 frontend selected suite **58/58**; backend selected P0 **50/50**; Expo config/prebuild PASS; generated Android includes core/VPN and excludes Expo bridge; default preview harness PASS; GuardDog **91/91 unchanged**. Independent iteration 66 repeated frontend/backend/config/prebuild checks with only two minor findings, both fixed and retested.
- Acceptance trust no longer depends on the historical signer. New key `apollo-stage1d-acceptance-ed25519-001` is injected only into the Apollo-owned candidate verifier; its mode-0600 private key remains outside the repository/APK. Current valid/tampered/expired/unknown-key fixtures pass independent real-clock crypto checks, while production prebuild/native metadata rejects acceptance trust.
- Concrete remaining run blockers: allocate/configure an Apollo-owned dedicated public IPv4 endpoint and exact DNS/TLS baseline, then sign its host-scoped bundle; trigger managed Android profile `guarddog-acceptance` through Publish. Native compilation/build ID and physical Pixel 10 acceptance are **NOT RUN** until those actions produce evidence.
- Iteration 67 independent handoff verification passed crypto **2/2**, source guards **4/4**, and backend P0/Stage1D **50/50**. Main GuardDog manifest remains **91/91** when run from its manifest-relative `frontend/packages` directory.

### Stage 1D post-`bb1a5fa` corrections — iteration 68
- Acceptance evidence is now unique-run proof: generated run/probe IDs, observed native session, deliberate TCP source port, exact host/IP/port and packet observation window are all required; historical or untagged inbox records cannot pass.
- Candidate runtime is one lazy process owner guarded by native build eligibility. Candidate/legacy start-stop operations share one serialized coordinator, and GuardDog start verifies legacy shutdown first.
- Start/stop return only after observed session/TUN/route/reporter transitions or explicit timeout. Protection freshness is based on current native inspection, not lifecycle intention.
- Native and JS boundaries validate supported protocol/source/action/result/confidence values. Unsupported protocol becomes `unknown`/`unverified` with raw metadata preserved. Native durable evidence is capped at 256 and exposes overflow/storage errors without crashing packet processing.
- Historical signer dependency is absent from runtime/provisioner. Production remains legacy and generated default Android metadata is reset to acceptance=false.
- Verification: frontend **60/60**, focused follow-up **11/11**, crypto **2/2**, backend independent **50/50**, candidate prebuild/autolinking PASS, preview isolation PASS, GuardDog **91/91**. Native compilation/JUnit, APK identifiers and Pixel acceptance remain **NOT RUN**.

## D3 policy reconciliation — signed runtime manifests restored; no implementation
- User verified first D1/D3 doc sync at `09bb101d396c35ea4e6795c2a4794825961cf15e`, then correctly identified conflict with Stage 0 §§9–10. **The prior APK-pinned ordinary bundle-key / APK-only rotation proposal is WITHDRAWN.** Stage 0 is unchanged and remains the governing policy mirror; its authoritative engine-owner record is in the other project.
- Added `docs/STAGE1D_D3_SIGNED_MANIFEST_RECONCILIATION.md`, answering the four concrete questions. Pinned primary/recovery ROOTS authenticate runtime signed trust manifests; manifests authorize/revoke everyday bundle keys with validity, overlap and monotonic trust state. Roots do not sign ordinary bundles. A fetched key is never trusted just because a backend supplies it. Recovery/version ordering requires certified engine-owner protocol; no ad-hoc override implemented here.
- Verified manifest updates use the SAME native owner/registry and a durable staged/committed generation with admission quiescence, invalidation/revalidation of BOTH M1/M2 accepted authority, and observed restart/recovery. `.trust/.retire` only affect future lookups; clear-authorization/binding calls leave private accepted bundles that can re-arm. Rejecting an update does not erase old caches. Requested certified T1–T5 interfaces explicitly cover these gaps.
- **Three separate outcomes:** known expiry requires defined cutoff/invalidation; a newly VERIFIED revocation invalidates affected authority without fallback to the revoked cache; offline without new revocation knowledge keeps valid LKG known-bad rules and fails open for unknown traffic, with stale/degraded disclosure. Backend outage alone never kills ordinary access. No unsigned expiry grace or instantaneous offline revocation promise. Proposed shutdown targets must be ratified/measured; timeout/contradiction remains unresolved.
- Frozen SDK offers registry mutation, Ed25519/JCS helpers, bundle validation/version primitives and some lifecycle/clear operations—not a complete primary/recovery manifest controller, trust journal or coordinated accepted-authority transition. Engine owner may certify a composition reusing existing primitives, adding hooks only where needed. Apollo main must not reconstruct that engine trust logic from prose or edit the 91 frozen files.
- **Historical D3 disposition:** policy conflict corrected; D3 production approval remains OPEN pending certified interfaces, inputs and evidence. D1 topology remains proposed/unapproved; D2/D4–D6 unchanged, Stage 1D NOT STARTED, CE-01/cutover unapproved, Stage 1C.1 launch PASS. At the time of this design record the six P0s were open; the iteration 64 closure above supersedes that status and unblocks—but does not pass—the separate native delivery/call acceptance rows.
- Earlier D1/D3 §4/current plan/Stage1C/device template now reference the reconciliation instead of presenting APK-only key rotation as current policy. Validation passed: all four questions and separate validity cases recorded; old current-policy assertions withdrawn; Stage 0, public contracts, runtime/dependencies/CI and P0 tracker unchanged; original review hash and GuardDog 91/91 intact; all six P0s and D1–D6 remain OPEN. New D3 documentation follows the verified `09bb101` snapshot and is not automatically assumed synced. No native trust/expiry/device test was performed; proposed timing targets are not measured guarantees.

## Focused D1/D3 concrete design — production bridge verdict, no implementation
- User requested engine ownership and trust construction together, not a general plan revision. Source baseline `956db060ec6905877371eeaeb703286f0b9c8f81`. Added `docs/STAGE1D_D1_D3_OWNERSHIP_TRUST_DESIGN.md`; only D1/D3 links/disposition updated in the main plan.
- **Existing frozen-bridge production route is NOT feasible through its public API:** private engine/verifier created with `TrustedKeyRegistry.m1Default()`, no registry/verifier/owner injection. A second owner would overwrite global references while active readers retain their captured reporter. Current Apollo module has no GuardDog constructor; no competing-owner device bug is claimed as already reproduced.
- **Conditional alternative for approval:** exclude `guarddog-expo-module` from Android registration/compilation while preserving its source; new process-lifetime `ApolloGuardDogRuntime` in Apollo's native module owns one core engine, injected public registry/verifier, durable version store and subscriptions. Direct public core/VPN constructors support this; CLI-only exclusion query kept Apollo and removed the vendor bridge without editing config. This is a topology/scope change, NOT proof both modules can safely coexist. If both must remain, defer production until an approved certified bridge exposes ownership/trust interfaces.
- Initial build-pinned ordinary-key rotation proposal is **withdrawn** by the D3 reconciliation above. Native test/prod isolation remains necessary, but production must use pinned primary/recovery roots plus runtime signed manifests, not mandatory APK updates for routine keys. Frozen core's public test literal may remain as unused code; active production trust must exclude it.
- **Production validity limit:** expiry/admitted-authority updates need explicit certified semantics and measured shutdown behavior. Post-drop suppression cannot prevent the drop. Offline revocation discovery delay is already accepted policy; instantaneous offline revocation is not a requirement. This is a D3 interface/evidence limitation, not an invented P0-07.
- D1/D3 design is provided for disposition; **D1–D6 remain OPEN, Stage 1D NOT STARTED, CE-01/cutover unapproved**. At this historical design point the six original P0s were open; iteration 64 later verified them closed. Native/Patrol acceptance remains split and physical-device delivery/call negatives remain required. Stage 1C.1 user launch PASS unchanged. No source/config/runtime changes, native build or device test occurred in the D1/D3 design task.
- The previous eight-document handoff was verified at `956db060`, and the first focused D1/D3 design was user-verified at `09bb101`. Their pending-sync notes are superseded. The later D3 reconciliation above is new workspace content; Stage 1C §§18–19 record the progression.

## Stage 1D revised plan / original review intake complete — implementation NOT STARTED (2026-09-20)
- User supplied `Apollo_Review_2026-09-20.md`, reviewing `da60c0372650dead26caeb25c458f8ca7cebd6a2`. Full original archived unchanged at `docs/reviews/Apollo_Review_2026-09-20.md`; SHA-256 `e2704cf1ee89850d8ca39fa50b136ce09575ff4e45e8cfafeb986288c6de2788`. Original historical launch-pending wording does not override subsequent **Stage 1C.1 fresh Pixel 10 launch PASS**.
- **Historical intake state:** P0-INTAKE was resolved while all six findings were still open. P0-01 backend internal-address/redirect connections; P0-02 misleading freshness/recovery; P0-03 call rejection to biting; P0-04 privacy disclosure/processing conflict including automatic messages; P0-05 privacy policy rejects evidence upload/no reliable delivery; P0-06 unread/limited files get unsafe reassurance. No fix was attempted in that plan-only task; the iteration 64 closure above is the current authority.
- `docs/APOLLO_STAGE1D_PLAN_REVIEW.md` revision 2 incorporates the user's six directions. **D1–D6 remain OPEN pending detailed design/approval:** prove one owner even with both modules loaded; truthful selective-filter status; explicitly separate test trust from production trust; original event identity with replay/dedup/retention/privacy rules; unsupported block/unblock returns unsuccessful with no implicit allow-policy bypass; bounded fresh start/stop observations with timeout/conflict UNRESOLVED and recovery separate.
- `docs/STAGE1D_CONTRACT_EXTENSION_PROPOSAL.md` CE-01 proposes one `packet_filter` enum addition plus exhaustive label/tests, **separately reviewed and NOT implemented/approved**. Current contracts and all frozen GuardDog source remain unchanged. If no truthful contract is approved, defer incompatible integration; do not label it dns_filter/none/simulated.
- Device template requires source SHA + APK build ID/hash on each new run, exact trust scope/contract revision, dual-module owner evidence and separate results. **A4N native intentional packet blocking may pass independently; A4E full Patrol/backend/eligible notification acceptance is BLOCKED by P0-05 until fixed/verified.** P0-04 constrains the narrow payload; call rejection is a mandatory negative blocked by P0-03; consumer freshness/recovery acceptance is blocked by P0-02.
- **P0:** separately plan and verify the six remedies; backend exposure risk is not postponed by mobile stage work. **P1:** resolve D1–D6 and get implementation approval; no runtime changes or production-default cutover approved now. **P2:** source review's P1/P2 consumer/Higgins/other-platform recommendations remain preserved/deferred, not closed.
- Revision 2's eight handoff files were subsequently verified byte-for-byte on GitHub main `956db060ec6905877371eeaeb703286f0b9c8f81`, superseding earlier `da60c03`/pending-sync observations. Stage 1C §§16–17 record that handoff. Original review matches its upload hash; six P0s remain OPEN, intake alone resolved; native/pipeline dependencies unchanged. The later focused D1/D3 document above is new work and is not claimed to have been included in that earlier sync.

## Current acceptance — fresh Pixel 10 launch PASSED (user-verified, 2026-09-20)
- User reported **“App is running as expected”**, then answered **“Yes”** when asked explicitly if this was the freshly built APK running on their Pixel 10. **Stage 1C.1 physical-device launch gate is passed**; the prior post-splash blocker is closed on that user evidence. No independent device test by the agent is claimed.
- Exact APK/build ID/hash, Android version, APK-to-source mapping, explicit repeat/reboot test, native start/stop, packet blocking and push delivery were not supplied or demonstrated; do not imply those passed.
- **Stage 1D remains NOT STARTED, awaiting separate approval**, rather than blocked on initial launch. **P0:** retain the passed launch record and preserve GuardDog. **P1:** approved runtime/adapter integration, then native start/stop and packet-block tests. **P2:** later Higgins/consumer/iOS/desktop integration remains deferred.
- Canonical acceptance record: `docs/APOLLO_STAGE1C_BUILD_INTEGRATION.md` §15. Saved dependency-guard implementation SHA is **`6d71e8f4a48a8a0e22d5a74b4d6e395e7cc62094`** (verified from Git history); supersedes the prior report's pending-save caveat. GuardDog hashes 91/91 unchanged. Recording this acceptance changes documentation only.

## Native dependency duplication guard — implemented and independently verified
- User requested a read-only post-merge/native-build safeguard after the SVG launch crash. `frontend/scripts/native-dependency-guard.cjs` + `scripts/native-dependencies/{policy,scan}.cjs` scan nested/scoped/hoisted installed packages and Expo search roots, failing on multiple native physical copies (even same-version copies); symlinks to one copy are not duplicates. Prints all versions/paths; never changes dependencies.
- Explicit coverage: SVG, Reanimated, Screens, Gesture Handler, Safe Area Context, WebView, Worklets, React Native, Keyboard Controller, AsyncStorage, Expo and Expo Modules Core. Native metadata automatically includes other Expo/scoped/third-party native modules.
- Wiring: `.github/workflows/native-dependencies.yml` PR/push post-install job; existing `yarn security:preflight`; Android/iOS `withNativeDependencyGuard` prebuild plugin. EAS's early pre-install lifecycle logs DEFERRED for dependencies only; post-install managed prebuild is mandatory. No package manifest/lockfile changes; existing SVG 15.15.4 pin preserved.
- One-time audit: **888 packages inspected / 50 native packages / zero duplicates / zero errors**. Focused tests **44/44**, changed-code lint, resolved Expo config and actual combined preflight pass. Independently verified in `test_reports/iteration_61.json`, including workflow wiring, preview load, SVG pin preservation and GuardDog hashes **91/91 unchanged**. Full details/inventory: `docs/NATIVE_DEPENDENCY_GUARD.md`; Stage 1C §14 links it. No hosted CI or physical/native build success claimed here. No package/lockfile changes.
- **P0:** initial fresh-APK Pixel 10 launch is now user-verified above. **P1:** Stage 1D awaits separate approval; start/stop and packet blocking remain separate. **P2:** Higgins/consumer/other-platform wiring deferred. Stop/report any duplicates before changing versions; GuardDog remains frozen.

## Support's SVG crash fix — provenance (subsequent Pixel confirmation recorded above)
- **Exact post-splash cause:** duplicate `react-native-svg` copies registered `RNSVGCircle` twice. Support ticket **257445**, commit **`01a30ae72accc3c366492f0217d7fec3cdce866a`** (2026-09-19 18:10:55 UTC), records: `Invariant Violation: Tried to register two views with the same name RNSVGCircle`.
- **Dependency chain:** app uses SVG `15.15.4`; `@nandorojo/heroicons@0.3.0` requested `^13.1.0`, resolving separately to `13.14.1`. Support added `resolutions.react-native-svg = 15.15.4` and regenerated `frontend/yarn.lock` to retain one copy. Only these two dependency files changed in that fix.
- **Verification:** Support reports successful deploys/Android builds and emulator launch to Home. On 2026-09-20, local commit/patch inspection, `yarn why` and Node resolution from both consumers confirm the single `15.15.4` copy; GuardDog manifest 91/91 matches. No new emulator/physical-device run was performed for this documentation update.
- **P0:** User has confirmed that the freshly built APK runs as expected on Pixel 10. Exact build ID/commit/APK hash/Android version and repeat/reboot results remain unspecified, not fabricated. **P1:** Stage 1D has not begun and awaits approval; native start/stop and packet-block evidence remain separate. **P2:** Higgins/consumer integration and later iOS/desktop engine adapters remain deferred.
- **Canonical incident record:** `docs/APOLLO_STAGE1C_BUILD_INTEGRATION.md` §13 contains the exact exception, commit/ticket, fix, evidence boundaries, and recurrence checklist. Earlier “non-blocking” SVG notes and SecureCore root-cause attribution below are historical, not the resolved cause of this crash. Do not repeat the retracted native-init timing hypothesis.
- Documentation-only update; no application code or GuardDog changes. Support's statement that the blocked GitHub push did not expose keys is recorded with attribution, not as a new security audit.

## Investigation before Support's fix was identified — historical, superseded by §13
- User reports: **"App installed and still stopping"** after the Firebase replacement. Follow-up confirms the Android **"Apollo keeps stopping"** dialog (not SafeStart) and apparent continued background presence. Background presence is not evidence of live protection: surviving notifications/recent-task entries or service/process restarts remain possibilities, not established causes. Physical-device launch is NOT verified; prior SafeStart/policy work did not establish resolution. Stage 1D remains blocked.
- Supplied production logs show successful Uvicorn startup and repeated `/health` 200 responses, plus one `/` 404. They contain no Android crash stack or MongoDB startup error. Sandbox `/api/health` was also verified to return healthy JSON; that is not proof of production device behavior.
- Deployment scan's transient OAuth TTL and secret `.gitignore` findings were retracted after source verification. Remaining scan flag about Expo `--tunnel` is a development-preview setting, not an evidenced APK/backend connectivity blocker; independent troubleshooting confirmed this. No infrastructure, auth, or secret-tracking changes were made.
- An initial troubleshooting hypothesis blaming module-scope native access was retracted after inspecting Expo 57's synchronous native-module initialization. Do NOT lazify the selectors as a guess: deferred validation could bypass the layout's existing boot-error snapshot. No native root cause has been established.
- Android autolinking resolves ApolloSecurity, GuardDogExpoModule and required Expo modules. Firebase/app identifiers match. Device confirmed by user: **Google Pixel 10**; Android version not provided. No `adb`, JDK, device logcat, or current APK/build ID is available here. The user confirmed Android's crash dialog, not SafeStart. Pixel on-device bug-report instructions were supplied, but the follow-up marked every step skipped and attached no report; do NOT treat skipped steps as completed or assume crash data. Next required evidence: Android crash log from launch through failure. The exact installed APK can also help verify packaged configuration, but cannot on its own prove the crash cause or resolution. No application code changed during this investigation.

## Firebase configuration replacement — historical configuration-only verification
- User supplied `f60xq9zf_google-services.json`; replaced `frontend/google-services.json` with its configuration for Firebase project `apollo-243ad` and Android package `app.apollo.hwg`. This supersedes the older `fit-beyond-50` configuration and its unrelated clients. `app.json` already points to this file with the correct package and bundle identifiers; no application code, security policy, or certified GuardDog source changed.
- Focused validation passed: full supplied JSON object matches the saved file; Android/iOS identifiers match; exactly one Firebase client matches the Android package; Firebase project number/app ID are consistent; `npx expo config --json` resolves the correct package, file, and notifications plugin; security/boot tests 15/15; GuardDog SHA-256 provenance manifest 91/91. Restarted Expo and verified onboarding renders in the external preview. No full regression run for this config-only change; no APK generated or physical-device/push sign-off claimed.
- **P0:** A fresh native Android build and physical-device launch past splash are still required. SafeStart is a fail-closed error screen, not proof of a successful native launch. This configuration update does not prove native launch or push delivery.
- **P1:** Stage 1D runtime/adapter wiring remains blocked until explicit successful physical-device launch evidence. Then verify native start/stop and real packet blocking before claiming enforcement.
- **P2:** Higgins/consumer UI integration and later iOS/desktop engine adapters remain deferred.
- Firebase project changed: Android push-sending service-account credentials must belong to `apollo-243ad`. The uploaded client config is not a service-account credential; existing server-side push configuration was not changed or validated here.

## Original problem statement
Privacy-first mobile security app (iOS/Android, Expo + FastAPI + MongoDB) that detects, explains and — only where verified — blocks dangerous links, suspicious websites, unsafe connections and known threats. Four exact user-facing states: Patrolling / Growling / Barking / Biting. Apollo's Patrol shows what happened. Capability-aware, truthful UI; on-device-first; minimal indicators to backend; native module bridge (Swift/Kotlin) from day one; HuCentAI SecureCore mock SDK contract. The legacy internal key `resting` is storage-only and must never be shown to users.

## User choices
- Ask Apollo: Gemini 3 Flash (user's own Google key, via emergentintegrations)
- Patrol: anonymous device ID + backend sync of event summaries (no accounts)
- Reputation: Google Safe Browsing (user key — currently rejected 401 by Google; surfaced truthfully as "Unavailable") + Apollo managed blocklist
- Design: dark "sentinel" palette (Sentinel Navy #0B1220, Charcoal, Slate, state colours green/amber/orange/red), Outfit + Geist fonts
- Native shell: TypeScript adapters + Swift/Kotlin Expo Module stubs + HuCentAI SecureCore mock SDK

## Architecture
- backend/server.py — FastAPI: /api/health, /api/devices/register, /api/intel/status, /api/intel/check (HMAC digest cache, blocklist + Safe Browsing), /api/patrol/events (upsert/list/patch/soft-delete), /api/trust, /api/ask/stream (SSE) + /api/ask/history
- frontend/src/domain — types, stateMachine (fast escalation, strict recovery: cooldown + fresh verification), risk (local deterministic URL checks), decision (local + intel → state), privacy (egress allow-list enforced in code), capability
- frontend/src/security — SecurityPlatformAdapter + Mock/IOS/Android adapters, fail-closed selector (EXPO_PUBLIC_SECURITY_MODE); securecore/ (HuCentAISecureCore contract, MockSecureCore + 21 scenarios, NativeSecureCore bridge, errors, safe logger, fail-closed selector EXPO_PUBLIC_SECURECORE_MODE)
- frontend/modules/apollo-security — local Expo Module: Swift + Kotlin stubs (truthful capabilities, blocks return verified:false)
- frontend/app — onboarding, (tabs)/{home,guard,patrol,ask,settings}, check (modal), patrol/[id], dev-tools (mock only)
- Docs: /app/SECURECORE_INTEGRATION.md

## Implemented (2026-06)
- Phase 1–5 MVP: domain layer, state machine, Patrol, capability model, privacy guardrails; native shell + truthful status UI; Check-a-link with local + intel; four states w/ thresholds; Patrol timeline + detail + Trust This (growling only, exact link) + revoke; verified block → Biting (mock adapter simulated, labelled); cautious de-escalation (2-min cooldown, verify-now freshness 10 min); Ask Apollo streaming explanation-only.
- Testing iteration 1: backend 13/13 after 422 fix; frontend flows verified (barking→biting→contained→growling→verify→resting; growling→trust→settings).
- Iteration 2 (2026-06): Share Intake (expo-share-intent config plugin for iOS Share Extension + Android ACTION_SEND; `/check?url=&source=` deep link auto-run; clipboard link banner on Home, native only). Threat Benchmark (shared corpus `src/benchmark/corpus.json` 60/60; in-app `/benchmark` screen scoring detection/FP vs gates; backend `POST /api/intel/check-batch`; pytest `tests/test_benchmark.py` → `/app/test_reports/benchmark_report.json`). Site Guard native: Android DNS-only `VpnService` filter (Kotlin) + module wiring; iOS Safari Content Blocker extension + `plugins/withApolloSiteGuard.js` config plugin + EAS appExtensions config; `SITE_GUARD_NATIVE.md`. Australian privacy disclosure screen in onboarding + Settings. Testing iteration 2: all pass.
- Iteration 3 (2026-06): Connection Guard (NetworkStatus wifiSecurity/captivePortal/vpnActive; Android WifiInfo.currentSecurityType + NET_CAPABILITY_CAPTIVE_PORTAL; iOS NEHotspotNetwork limited; `domain/connection.ts` → growling connection events, deduped). Weekly Patrol Digest (`domain/digest.ts`, Home card, `/digest`). Benchmark History (local, bar charts, `/benchmark`). Family Sharing (`/family`; backend `/api/family/*`: guardian email via Emergent Resend w/ confirm link + 5/day cap, pairing codes, shared_events fan-out on barking/biting). Testing iteration 3: 30/30 backend, all frontend flows pass.

- Iteration 4–6 (2026-06): Production security hardening (`src/security/securityConfig.ts` validator; `EXPO_PUBLIC_APP_ENV`; `.env.production` pins native; `scripts/security-preflight.mjs` as EAS `eas-build-pre-install`; `tests/securityConfig.test.ts` 8/8 via `yarn test:security`; docs in SECURECORE_INTEGRATION.md §7). Guardian Reply (`POST /api/family/shared-events/{id}/ack`, `GET /api/family/acks`; UI in /family). Wi‑Fi Memory (NetworkStatus.ssid; trusted SSIDs local; Guard trust/forget). Export Patrol (expo-print PDF + expo-sharing; Patrol header button). Biting → green "Threat contained" confirmation after containment. Brand logo/app icon/adaptive icon/splash/favicon from user asset (`assets/images/logo.png`, `ApolloLogo` component in Home header, onboarding, hero). Testing iterations 4–5 all pass.
- Iteration 7 (2026-06): New Doberman logo/app icon applied to icon, adaptive-icon, splash, favicon, logo.png. **Alert notifications** via Emergent-managed push relay: backend `POST /api/register-push` + `send_push()`; pushes to (a) owner when a barking/biting event is synced with `background: true` (native Site Guard, app closed), (b) paired guardian devices on fan-out, (c) protected owner when a guardian acks. Frontend: `src/push/notifications.ts` (lazy-loads expo-notifications — null in Expo Go/web to avoid SDK 53+ crash), `_layout.tsx` handler/channel/tap handlers/weekly nudge, Settings "Alert notifications" card, registration on device identity and after setup. `EMERGENT_PUSH_KEY=placeholder` in backend/.env (set by deploy pipeline). Guardian Reply UI verified end-to-end (iteration 6 tests 14/14).
- Iteration 8 (2026-06): Shield Doberman logo applied to all icon assets (ApolloLogo now contentFit=contain). Push sounds: `assets/sounds/apollo_bark.wav` (threats channel, MAX) + `apollo_chime.wav` (family channel, HIGH) + `growling` channel (DEFAULT); backend payloads set channel_id/sound. Family alert tap → `/family/alert/[id]` (Call/Message via tel:/sms:, phone from owner at pairing `phone` or watcher override `POST /api/family/links/phone`, ack buttons). Quiet hours (`PUT/GET /api/devices/{id}/settings`, growling background pushes + in-app growling toasts held; barking/biting always through; Settings card with TimeStepper). Battery saver (slower tick, hero animations off) + "Minimise Apollo" (Android BackHandler.exitApp; iOS/web guidance toast) on Settings and Home. Hero animations per state (patrolling breath+look-around, growl rumble, bark bounce, bite lunge). "Resting" renamed to "Patrolling" in UI (STATE_NAME; internal key unchanged). Guard fix: capability→permission sheets merged into one Modal. Google Safe Browsing key updated → status ok. Iteration 7 tests: backend 15/15, frontend pass.
- Test Alert Button (2026-06): Settings → Alert notifications → "Send me a test bark" (shown when push permission granted on a native build) → `POST /api/push/test {device_id}` relays a sample barking alert on the threats channel with the bark sound. Returns 500 with friendly detail when the relay isn't configured (dev placeholder key).
- In-App Alert Preview (2026-06): Settings → "Preview an alert" opens `AlertPreviewSheet` (mock notification card, Threat/Family tabs, plays bundled bark/chime via expo-audio; plugin microphonePermission=false).
- Gate 2 — Text & Messaging (2026-06): six-state model (sniffing/resting=Patrolling/ears_up/growling/barking/biting=Guarding; STATE_NAME/LABEL/MEANING in types.ts; theme colours sniffing/ears_up). On-device rule engine `src/domain/messageAnalysis.ts` (M01–M15) + backend `POST /api/message/analyse` (URL reputation for message links + Gemini second-opinion explanation JSON, never overrides verdict) + `POST /api/message/extract` (screenshot → text via Gemini vision). Screen `app/message.tsx` (paste/screenshot, result, links hand-off to /check, Verify Sender sheet, Tell me more → Ask, recovery, Mark as safe). Threat Scent `src/domain/threatScent.ts` (30-min window, brand+host keys incl. brand-in-hostname, 2 gates → barking; Home 'Connected events' cards). Share intake routes text → /message. Message Guard capability; `MessagingSdk` contract stubs. `yarn test:gate2` 20/20.
- Gate 3 Phase A — Website & Browser (2026-06): `POST /api/intel/check {expand:true}` follows redirects (≤5 hops) → redirect_chain/final_url, judges final destination; `POST /api/feedback` (Report mistake / override). `src/domain/brand.ts` Brand & Impersonation engine (OFFICIAL_DOMAINS list, homograph deobfuscation, verifyWebsite). decision.ts: brand mismatch → barking (login context/homograph) or growling; uncertain → ears_up ("I don't know this website well yet"); redirect chain in Why. check.tsx: calm "Apollo is guarding — I blocked a dangerous website." copy, redirect/brand pills, Verify website, Technical details, Continue anyway (override recorded + feedback), Report mistake, shared `RecoveryFlow` (clicked/password/card/code/download/app/called). `WebSdk` contract stubs. `yarn test:gate3` 18/18. Patrolling GIF (`assets/images/apollo-patrolling.gif`, watermark cropped, transparent) in Home hero. tsconfig: allowImportingTsExtensions for node:test runtime imports.
- Gate 3 Phase B (2026-06, DONE): `POST /api/page/extract` (Gemini vision → security-signal JSON, image not stored) + `src/domain/pageAnalysis.ts` rule engine (W08 fake virus, W09 fake support, W14 remote access, W10 fake shop, W11 payment, W12 wallet drainer, W18 fake CAPTCHA, W02/W03 fake logins, W17, W20). check.tsx 'Add a screenshot of the page' → check-page-card; merges/escalates existing link event via `recordPageAnalysis` or creates a website event. `yarn test:gate3page` 15/15. Backlog: W16 notification spam, downloads/app-install hand-offs (Gates 6/7), Gate 4 phone calls.
- Android push: `frontend/google-services.json` (Firebase project fit-beyond-50) wired via `expo.android.googleServicesFile`; app identity changed to `app.hwg.apollo` (iOS bundle ID + Android package + content blocker `app.hwg.apollo.contentblocker` + app group `group.app.hwg.apollo.apollo`) to match Firebase. Push only works on Publish → native builds (not Expo Go / web).

## Known gaps / notes
- Safe Browsing key returns 401 (API not enabled on the key's Google Cloud project or key restricted to Generative Language API). Enable "Safe Browsing API" for that project or create a separate key; backend picks it up from SAFE_BROWSING_API_KEY.
- Native code (share extension, DNS filter, Safari content blocker, Wi‑Fi security) only runs in EAS dev/prod builds (Publish → build); Expo Go/web use labelled mocks.
- PUBLIC_API_BASE in backend/.env must be the production https host after deploy so guardian confirm links work.

## Backlog
- P0: Real Safe Browsing key; EAS dev build validation of ApolloSecurity module, DNS filter, Safari content blocker, share extension
- P1: Connection Guard (Wi‑Fi safety), store permission copy review
- P2: Benchmark history/export; iOS Network Extension for non-Safari coverage
- Gate 7 — Apps & Device (2026-06, iteration 14): `src/domain/appAnalysis.ts` App & Device Engine (A01–A20; context-aware score: source + unexpected-for-purpose permissions + call/scent timing + brand/update impersonation + SDK network; off-store impersonators get no purpose credit) + `deviceAnalysis.ts` (Protected/Review/Action/Recovery, D01–D11, truthful cannot-see list). Screens `app/app-check.tsx` (Check This App: name/dev, source/purpose chips, permission multi-select with long-press plain-language explainer, context switches, Access/Network/Reputation cards, Open Settings via `utils/deviceSettings.ts` Android intents / iOS openSettings+path toast, Stay With Me, Keep/Report) and `app/device.tsx` (Check My Device: status, findings with Open Settings, self-report switches, Save to Patrol). Backend `POST /api/app/analyse` (remote-tool/security-vendor/brand-impersonation hints, SDK hosts → intel, Gemini second opinion never overriding). Categories `app`/`device`; recovery kinds remote/accessibility/profile/banking_during_access; handoffs File→App (keeps scent), Call→App. `AppDeviceSdk` contract stubs. Tests: `yarn test:gate7` 36/36, `tests/test_gate7_app.py` 9/9.
- Gate 8 — Network & Accounts (2026-06, iteration 15): `src/domain/networkAnalysis.ts` (N00–N12: public≠malicious, lookalike SSID, open Wi‑Fi ears_up, captive portal → Gate 3, VPN trusted/unexpected, DNS change, SDK blocked → Guarding calm, C2 → bark + Gate 7) + `accountAnalysis.ts` (AC01–AC20: unexpected MFA → BARK "Don't approve this login", MFA fatigue, fake reset/alert off official domain → BARK + web handoff, genuine alerts ears_up, expected activity resting, code/password entered → Stay With Me, locked out, recovery changed; takeover risk). Screens `app/network.tsx` (Network Guard dashboard: protection status from capabilities, current network, 24h activity + Check This Network) and `app/account.tsx` (Account Guard dashboard of open account events + Check Account Alert + breach exposure card). Backend `POST /api/account/analyse` (URL intel + per-provider official-domain match + password-scrub validator + Gemini), `POST /api/account/breach` (HIBP when `HIBP_API_KEY` set, else truthful not_configured). Category `account`; recovery kinds mfa_approved/locked_out; handoffs Message→Account, Call(code/password)→Account. `connection.ts` open Wi‑Fi background event now ears_up (N04). Hero shows `assets/images/apollo-barking.gif` for barking/biting. Tests: `yarn test:gate8` 34/34, `tests/test_gate8_account.py` 8/8.
- Backlog: HIBP key for live breach checks; Gate 1 (Email) PRD; native Swift/Kotlin SDK implementations behind the documented contracts; stale assertions cleanup in tests/test_apollo_backend.py; web bytes path in file.tsx.
- Gate 1 — Email (2026-06, iteration 17/18): `src/domain/emailAnalysis.ts` (parseEmail headers/body/attachments; E01–E13: official sending-domain check per brand, off-domain login links, risky attachments, changed bank details/BEC, code/identity asks, reply-to mismatch) + `app/email.tsx` Check an Email (From/Subject/Body or pasted forwarded email; links → /check, attachments → /file, account alerts → /account with scent, Verify sender, RecoveryFlow). Category `email`; reuses `POST /api/message/analyse`. Guard tab "Network & Accounts" section: Network Guard card (connection_guard status + summary → /network) and Account Guard card (open account events → /account). Home "Check an email". `yarn test:gate1` 13/13.
- Fixes: Site Guard permission now persisted by MockSecurityAdapter (`apollo.mock.permissions`, iteration 16); account.tsx recentLinked includes `email` (iteration 18). Hero GIFs: patrolling / growling (`apollo-growling.gif` — currently identical to barking, user to supply distinct file) / barking+guarding.
- Share Into Apollo (iteration 19/20): `src/share/classifyShare.ts` routes shared payloads (file → /file, image → /message screenshot, email headers/body → /email, login/MFA/reset text → /account, bare link → /check, else /message) + alternatives; `app/share.tsx` landing ("Looks like …", Check as …, Not that?); `ShareIntakeListener` → /share; app.json share-intent accepts text/images/files (native build only; web uses /share?text=|url=). message.tsx accepts `imageUri`, file.tsx accepts `uri/name/mime/size`. Home "Share to Apollo" capability now "available" on native.
- Incident Timeline (iteration 19/20): `src/domain/incidentPlan.ts` (ordered timeline, highest state, recovery kinds inferred from recorded "You told Apollo" entries + scenarios, one deduplicated Stay With Me plan) + `app/patrol/scent/[id].tsx` (tickable steps, Ask, mark whole incident handled → resolves all linked events). Home Threat Scent card tappable; event detail "View incident timeline". `RECOVERY_STEPS` moved to `src/domain/recovery.ts`. Store: `eventsRef` makes back-to-back upserts safe; `refresh(minVisibleMs)` — Verify now holds Sniffing ≥900ms. Hero GIFs: sniffing / patrolling / growling (distinct 43-frame file) / barking+guarding. `yarn test:share` 11/11.
- Family Incident Sharing (iteration 21): protected user taps "Ask my family for help" on an incident timeline → `POST /api/family/incidents/share` fans out headline/timeline/steps/ticks (never message text) to paired guardians + push; ticks/handled mirrored via `PATCH /api/family/incidents/{scent_id}/progress` (tick state persisted locally at `apollo.incident.<id>`). Guardian: Family → "Incidents shared with you" → `app/family/incident/[id].tsx` (read-only timeline, live progress, Call). Weekly Digest: "Connected incidents" card (`buildDigestIncidents`: handled vs open, stopped vs still-open events, tap → timeline). Palette locked to spec: sniffing #9EABB8, ears_up #D9A441, growling #E47A3F, barking/biting #D9534F (+ tints, export colours). Tests: `test_family_incidents.py` 3/3, `yarn test:share` 12/12.
- Cleanup (2026-06): `tests/test_apollo_backend.py` assertions made Safe-Browsing-state agnostic (clean/full when key ok, unknown/partial otherwise) and rerun-safe (cached flag, blocklist >= 4) — 14/14. Incident-share push idempotency key uses `ts.isoformat()`.
- Hero GIF fixes (2026-06): sniffing/growling/barking GIFs re-encoded with transparent backdrop (`scripts/gif-transparent.py`, edge flood-fill so shield highlights stay). Code-driven dog shake/bounce/lunge removed for all GIF states (growling rumble, sniffing ticks/tilt, barking bounce, biting lunge) — GIFs carry the motion; ring + glow pulses remain. Resting breath and ears_up (static logo) unchanged.
- Family Reassurance Note (iteration 22): guardian → `POST /api/family/incidents/{scent_id}/notes` (kinds here/calling/on_way/together/custom ≤140; `from_name` remembered as link `guardian_label`; push to protected device → `/patrol/scent/<id>`), `GET …/notes` (protected sees all, guardian own). Guardian screen "Send a reassurance note" card (chips, optional custom line, name); protected timeline "From your family" card (polls 15s, warns never to give codes/passwords even to family). Tests: `test_family_notes.py` 2/2; E2E `/app/tests/test_family_notes_e2e.py` full pass.
- Deployment health check (2026-06): blocker fixed — reputation_cache TTL index removed (plain index; expiry checked at read time; existing TTL index dropped). Integration base URLs now env-driven (`EMERGENT_INTEGRATIONS_BASE_URL`). Root .gitignore no longer excludes .env files. Status: pass with one warning — Android push needs `frontend/google-services.json` from Firebase (user to supply).
- Family Weekly Check-In + Guardian Call-Back (iteration 23): `GET /api/family/weekly?device_id=<guardian>` — count-only 7-day rollup per watched person (total, by_state, alerts/open/handled, blocked, active_days, shared incidents, last_seen_at, phone; never headlines). Family screen "Weekly check-in" cards (`src/domain/familyWeekly.ts`: calm/handled/needs-a-call/no-news sentences, last-active line, Call button); pair card copy discloses it to the protected user. Reassurance notes carry an optional guardian `phone` (scrubbed, remembered on link) → protected timeline shows "Call <name> back". Tests: `test_family_weekly.py` 3/3, `yarn test:family` 7/7, E2E `/app/tests/test_family_weekly_e2e.py` full pass.
- Sunday Check-In notification (iteration 24): backend loop (`weekly_checkin_loop`, every 15 min) pushes one gentle summary per guardian per ISO week inside their local Sunday 17:00–20:59 (device `tz_offset_minutes` now sent on register; falls back to quiet-hours offset), respects quiet hours, dedupes via `weekly_checkin_sends`, skips opted-out devices. `weekly_sentence()` mirrors frontend wording. Endpoints: `GET/PUT /api/family/weekly/notify` (pref + last_sent), `POST /api/family/weekly/send-now {preview_only}` (text preview on web; real push on native). Family screen weekly card: Sunday toggle, "Preview the notification", native-only "Send it to me now". Tests: `test_family_weekly_push.py` 5/5. Push delivery itself needs a native build.
- Check-In Reply (iteration 25): guardian taps "All good, spoke to Mum" / "Messaged them" on the weekly card → `POST /api/family/weekly/checkin` (one per guardian/person/week, upsert; push to protected device "Sam checked in"), `GET /api/family/weekly/checkins` (protected: received, guardian: sent). Guardian sees "Checked in · … · Sun" pill; protected user sees "Sam checked in — All good, spoke to you" in Family → Family responses. Tests: `test_family_checkin.py` 2/2; self-tested in web.
- Higgins, owner attribution, Tuesday nudge (iteration 26): **Owner**: Apollo is a brand of Harmony Wellness Group (privacy disclosure intro, Settings About card + footer, guardian email footer). **Higgins** = Apollo's handler (proper old English gentleman, butler-like; never "sir/madam") and the voice of the app: `HIGGINS_VOICE` persona prefix on all Gemini prompts; "Ask Apollo" → "Ask Higgins" (tab "Higgins"); STATE_MEANING, RECOVERY_STEPS, weekly/nudge sentences and push titles in Higgins voice. **Spoken audio**: `POST /api/voice/speak` → OpenAI TTS `tts-1`, voice `fable`, speed 0.95 via EMERGENT_LLM_KEY, cached in `voice_cache`, served `GET /api/voice/<key>.mp3`; frontend `src/voice/higgins.ts` (single expo-audio player, playsInSilentMode) + `HigginsSpeakButton`: Home hero, each Ask reply, check result (compact), Settings "Hear a sample"; Settings toggle "Read alerts aloud automatically" (`apollo.voice.auto`) auto-reads barking/guarding check results. Disclosure lists TTS as overseas processing. **Tuesday nudge**: `missed_checkin_tick` (Tue 17–20 local, once/week, opt-out shared with Sunday toggle) names people not checked in since Sunday; preview via `send-now kind=nudge` ("Preview Tuesday's"). Tests: test_voice 2/2, test_family_nudge 2/2, weekly push 5/5; E2E iteration 26 full pass. (on_event → lifespan migration done in the backend split.)
- Higgins Greets You (iteration 27): `src/domain/higginsGreeting.ts` (time-of-day opener + state line, deterministic per day; `yarn test:higgins` 6/6) + `HigginsGreeting` card under the Home hero — shown on the first open of each local day (`apollo.higgins.greeted`), matches Apollo's state (incl. visibility lost → Guard), Hear Higgins button, spoken automatically when the Settings auto-read toggle is on, dismiss with X. Self-tested in web (show → dismiss → hidden after reload).
- Higgins Reads Patrol (iteration 28): `src/domain/higginsNarration.ts` (`narrateEvent`: state → what → why with ordinals → what to do → handled/contained; `narrateIncident`: summary → events in order with times → plan intro → "Step N[, already done]" → closing; `yarn test:narration` 3/3). Voice module gained a queue (`speakHigginsSteps`, `useHigginsReader`): plays chunks back-to-back via the player's finish status, prefetches the next mp3, Stop cancels. `HigginsReadAloud` component (button + "Reading 2 of 4 — What happened") on event detail (`event-read-*`) and incident timeline (`incident-read-*`). Self-tested in web: auto-advance verified.
- Security Hardening Gate — step 1 truth of state (iteration 29): `ProtectionStatus` now {requested, operational, enforcementMethod, coverage, coverageScope, lastVerified, degradedReason} (+ `running` alias = operational). Android: `requested`/`since` persisted in SharedPreferences, `operational` = `ApolloDnsVpnService.isRunning` read live, start waits ≤2 s for establish(), degraded reasons (VPN permission / other VPN); pure `DnsPacket.kt` extracted + JUnit `DnsPacketTest.kt`. iOS: `requested` persisted in App Group, operational = extension enabled (observed) ∧ rules written, status/start/stop async after Safari callbacks, stop writes empty rules; pure `SiteGuardTruth.swift` + XCTest. Mock: never operational, `blockDestination` never verified (preview can't show biting). Guard master card: "Apollo is guarding / guarding what he can / off duty" + Requested/Enforcement/Verified pills + coverage + degraded reason (`src/domain/protectionTruth.ts`, `yarn test:truth` 5/5). Home/Network gates use `requested`; "Guarding in the background" card only when operational. Docs: SITE_GUARD_NATIVE.md "Truth of state" (coverage definitions, device QA list, sign-off rule). Native tests cannot run in this sandbox (no JDK/Xcode). Next: step 2 device auth (server-issued id + 256-bit token, hashed, rotation/revocation, no legacy binding) + CORS; then native tests on device; then split server.py.
- Security Hardening Gate — step 2 device authentication (iteration 30, IMPLEMENTED, E2E sweep pending): `POST /api/devices/register` (public) now issues a SERVER-generated device_id + 256-bit token (only SHA-256 stored, 365-day expiry; returned once); `GET /devices/me`, `POST /devices/heartbeat`, `POST /devices/token/rotate` (atomic), `POST /devices/revoke` (204). Router-wide `enforce_device_auth` dependency: everything except PUBLIC_PATHS (/health, /intel/status, /devices/register) and prefixes (/family/confirm/, /voice/) needs `Authorization: Bearer` (401 + WWW-Authenticate) and any `device_id`/`user_id` in path/query/JSON body must equal the token's device (403). No legacy binding: pre-token installs get a fresh identity. CORS: only `CORS_ORIGINS` env (empty; web preview is same-origin). Frontend: `src/auth/deviceIdentity.ts` (SecureStore native; AsyncStorage on web = preview-only, documented), API client attaches bearer & fails closed without identity; 401 → identity reset → toast → re-register new identity; SSE stream also authenticated. ApolloContext boot/completeSetup register/heartbeat via server identity (SecureCore mock identity no longer used for API). Tests: `tests/test_device_auth.py` 8/8 (raw, no shim); `tests/conftest.py` auth shim maps legacy ids→real registered devices for the older suites (documented); full backend suite 143/145 (2 known flakes: Gemini second-opinion timing, shared-events 2.5 s fan-out wait). Frontend smoke: register→heartbeat→all calls bearer-authenticated, no 4xx. TODO next: testing_agent E2E sweep (note: web identity key is `apollo.device.identity.v2`, tests pairing via API must use each context's token), device truth QA, failure-mode tests, backend split.
- Hardening Gate step 2 — E2E sign-off (iterations 30/31): two-device Family/Guardian sweep under device auth PASSED (create/join, incident share + note + check-in, cross-device 403s, 401 + WWW-Authenticate, revocation no-restore, second guardian, public paths, SSE authenticated). Bug found+fixed: reload after 401 silently re-registered → now `apollo.device.identity.reset.v1` marker persists the explicit reset state; boot never auto-registers while it is set; Home `identity-reset-card` → user taps "Register this phone again". Email confirm tokens single-use + 72 h expiry. `test_device_auth.py` 12/12 incl. lifecycle. Known gap flagged by tester: there is no "unlink a paired device" endpoint/UI (only guardian email removal) — candidate for the next session. **STATUS: Hardening Gate Step 2 — Device Authentication: COMPLETE.** Next: Device Truth QA (native builds) → Failure Mode Testing → Backend split into authenticated routers.
- Hardening Gate step 3 — failure modes (iteration 32): failure contract "unreachable ≠ unprotected; unknown ≠ safe". Frontend: `src/domain/serviceHealth.ts` (pure reducer + banner/stale copy + 401/403/5xx classification), `src/domain/intelContract.ts` (`parseIntelResult` rejects malformed intel → unavailable), `src/api/backendHealth.ts` (live reachability from every call + `/health` probes; recovery only on fresh success; 30 s/120 s re-probe while down + on foreground; on recovery: refetch + late registration), API client time budgets (20 s / 60 s long paths) + offline/timeout/malformed ApiError kinds, 403 never resets identity, boot never blocked by a hung service (15 s bounded register, fire-and-forget heartbeat). UI: `ServiceBanner` (Home/Guard/Family) with the agreed wording, Guard `masterCopy(p, online)` mixed states ("guarding what he can · DNS active · Online checks unavailable"), check.tsx intel unavailable/partial pills, `StaleNote` on Family/incident/notes, offline-specific copy on family incident/alert screens. Backend: SB wrong-shape guard, redirect expansion bounded 12 s. Tests: `yarn test:failure` 15/15, `tests/test_failure_modes.py` 17/17. Self-tested outage → banner → auto-recovery in web.
- External admin console (iteration 32): `X-Admin-Key` shared secret (`APOLLO_ADMIN_KEY` in backend/.env, constant-time compare, separate router, never mixed with device auth) → `/api/admin/{ping,stats,blocklist,feedback,devices,devices/{id},devices/{id}/revoke}`; blocklist edits flush the reputation cache; CORS allows the header (console origin must be added to `CORS_ORIGINS`). `tests/test_admin.py` 10/10. Test infra: conftest shim map shared across xdist workers.
- Hardening Gate step 4 — backend split (iteration 33, DONE, zero behaviour change): `backend/server.py` is now the 68-line entry point (FastAPI `lifespan` replaces `on_event`; indexes + blocklist seed + weekly loop task; router mounting; CORS). Code lives in `core/{config,db,models,auth}.py`, `services/{intel,email}.py`, `routers/{health,devices,intel,patrol,ask,family,family_weekly,voice,push,analysis,admin}.py`. Every `/api` router is mounted behind `enforce_device_auth`; `/api/admin` behind `require_admin_key`. Verified: identical route table (68 routes, same paths/methods/handlers), dependency wiring per route, full pytest 173/174 (1 pre-existing xdist log-tail race), testing-agent frontend regression PASS (iteration 33). Tests that import backend code now target `routers.family_weekly`, `services.intel`, `core.db`.
- Hardening Gate step 5 — native security tests (iteration 33, CODE DONE, DEVICE SIGN-OFF PENDING): Android `SiteGuardTruth.kt` extracted (pure truth derivation + `verifiedBlock`; module `statusJson()`/`blockDestination` delegate to it) + `SiteGuardTruthTest.kt` (8 JUnit tests incl. full packet→NXDOMAIN path, offline known-bad). iOS `SiteGuardTruthTests.swift` +5 tests (extension enabled but off duty, every degraded state explains itself, pure derivation, valid content-blocker JSON, case-insensitive dedupe — `rules(for:)` now dedupes). `SITE_GUARD_NATIVE.md` gained run commands and an 11-row physical-device verification matrix (permission denied/revoked, second VPN, reboot, backend down + filter on, offline unknown, background block, biting only with verified enforcement, recovery, admin revoke). Native tests cannot run in this sandbox (no JDK/Xcode) — they run in the Publish build pipeline / a dev machine; Expo Go and web preview are never sign-off evidence.
- Unlink Device (iteration 34): `GET /api/family/links` now returns `watchers` (link_id, guardian_label, since — never the guardian's device id) and `link_id` on each `i_watch` row; `DELETE /api/family/links/{link_id}?device_id=` (204) lets EITHER side end a pairing (soft delete + `unlinked_by`; strangers → 404, mismatched id → 403). All fan-outs/pushes/weekly rollups already filter `deleted_at: None`, so the removed phone stops receiving alerts immediately; re-pairing with a new code creates a fresh link. Family screen: "Who receives your alerts" rows with **Remove** (`family-watcher-remove-<link_id>`) and **Stop** on each watched person (`family-watch-stop-<pid>`), confirm dialog (Alert / web confirm). Tests: `tests/test_family_unlink.py` 3/3.
- Phase A — Android Apps & Device real signals (iteration 34, native build only): `AppDeviceCatalog.kt` (pure: 17-app remote-access RISK_CATALOG, store/browser/messenger → installSource mapping, accessibility/notification-listener setting parser, permission → plain-name map, `VISIBLE_PACKAGES`) + `AppDeviceSignals.kt` (real reads: Settings.Secure accessibility + notification listeners, ConnectivityManager VPN transport, DevicePolicyManager active admins, developer options, PackageManager lookups for catalog packages incl. `getInstallSourceInfo`, first-install time, requested permissions). Module now implements the AppDeviceSdk contract (`getAppDeviceCapabilities`, `getInstalledAppAssessment`, `getDeviceSecuritySignals`; install/security event feeds stay `[]`). Manifest `<queries>` lists exactly the 46 catalog packages — **no QUERY_ALL_PACKAGES, no AccessibilityService** (asserted by `AppDeviceCatalogTest.kt`, 5 JUnit tests). Fields Android cannot expose stay null (unknown sources per-app, overlay apps, user CA certs) and surface under "cannot see". app-check.tsx merges observed install source/permissions/remote capability into the on-device engine (`sdkPermissionsToApp`). Web/Expo Go keep the mock → verify on a Publish Android build.
- Watcher Names (iteration 35): `POST /family/link` accepts `guardian_name` (from the guardian's "Your name" field) → stored as `guardian_label`; `PUT /family/links/{link_id}/name` (guardian only) renames later; `i_watch[].my_label` exposes the current label. Family screen: watcher rows show the real name ("Sarah"), guardian rows show 'They see you as “…”' with a one-tap 'Use “<new name>” instead' rename. Empty name keeps the neutral "A family member". Egress allow-list (`src/domain/privacy.ts` family set) gained `guardian_name` — REMINDER: any new client-posted field must be added there or the request is blocked on-device. Tests: `test_family_unlink.py` 5/5; two-context E2E 10/10 (iteration 35).
- iOS Device Signals (iteration 35, native build only): `ios/DeviceSignalsTruth.swift` (pure) + module `getAppDeviceCapabilities` / `getDeviceSecuritySignals` / stubs. VPN on/off from tunnel interfaces (utun/ipsec/ppp/tap/tun via NWPathMonitor + scoped proxy keys) with `vpnProviderKnown` always null (Apple never names the provider); management profile reported "present" only when the app itself received a managed configuration, otherwise "unknown" — never "none". All other fields null → "cannot see". `deviceAnalysis.ts` D04b: observed VPN with unknown provider is an *info* fact ("Apollo can see that it's on but not who runs it"), Apollo's own Android filter produces no finding; iOS "cannot see" copy explains management can be confirmed but never ruled out. `DeviceSignalsTruthTests.swift` 5 tests; `yarn test:gate7` 37/37.
- Guardian Voice Note (iteration 36): guardian records ≤ 30 s on a shared incident (`VoiceNoteRecorder`, expo-audio; permission contract: explain → ask → respect canAskAgain → "Open Settings"; auto-stop at 30 s; review → Send/Discard). Upload `POST /family/incidents/{scent_id}/voice` (multipart, ≤ 1 MB, audio/* incl. webm on web; form device_id bound to bearer; 403 if unpaired) → bytes in **Emergent Object Storage** (`services/storage.py`, path `apollo-v1/family-voice/{guardian}/{note_id}.{ext}`), row in `incident_notes` kind "voice" (audio_path never returned). Playback: `GET /family/voice/{note_id}/ticket` (either side) → 10-min HMAC-signed public URL `/api/family/voice-play/{note_id}?exp&sig` (forged/expired/other-note → 403) so web `<audio>` and native play alike (`VoicePlayButton`, shared player, one at a time). Mum sees "Hear Sarah · 0:07" in "From your family"; guardian sees "Listen back". Push "Sarah left you a voice note". app.json: NSMicrophoneUsageDescription + RECORD_AUDIO. Egress allow-list += duration_s. Tests `test_family_voice.py` 3/3 (real storage round-trip).
- Admin Audit Trail (iteration 36): append-only `admin_audit` rows for blocklist.add / blocklist.remove / device.revoke with actor (`X-Admin-Actor` header, default "console"), IP, target, detail, time; failed actions log nothing. `GET /api/admin/audit?limit&action&actor&target`; `/api/admin/stats.audit` = total, last_7d, by_action_7d, recent[10]. `test_admin.py` 12/12.
- Voice Note Transcript (iteration 37): every voice note is captioned asynchronously with OpenAI Whisper (`whisper-1`, Emergent LLM key via `emergentintegrations.llm.openai.OpenAISpeechToText`) in `services/transcribe.py`; the upload returns immediately with `transcript_status: "pending"`, a background task writes `transcript` (≤ 500 chars) + `transcript_language` + `transcript_status ready|unavailable` (empty/failed transcription → "unavailable", never stuck pending). Notes API exposes these; `VoiceCaption` shows “…” under the play button on Mum's incident and the guardian's "Sent" list ("Caption coming…" while pending, guardian screen polls every 5 s until ready). Verified with real speech (TTS → upload → caption contains the spoken words). Tests `test_family_voice.py` 5/5.
- Light Sentinel palette (iteration 38): `src/theme.ts` is now a single light theme applied to both system schemes — background #F5F7FA, cards #FFFFFF, secondary surface #EAF0F6, navy text #0B1220, secondary text #52606D, borders #D7E0EA, deep navy accent/CTA #162235 (brand/brandPrimary), states: sniffing #52606D, resting #4FAF83, ears_up Apollo amber #F4B942, growling #E8943A, barking/biting #D9534F, unknown #7A8794; light-surface tints; scrim/glass adjusted. app.json userInterfaceStyle light + #F5F7FA backgrounds; StatusBar dark; exportPatrol HTML colours aligned. No literal colours elsewhere (verified by grep).
- Higgins Reads Captions (iteration 38): `VoiceCaption` gained deviceId/speaker → "Can't play it? Let Higgins read it" (Volume icon) which speaks "<Guardian> says: <caption>" through the existing `useHiggins` TTS (toggle to stop); playback errors now point to it. Wired on Mum's incident (`incident-family-note-caption-<i>-higgins`) and the guardian's Sent list (`family-note-caption-<i>-higgins`).
- Palette refinements (iteration 39, per user): background now soft sky blue #E6F0FA (secondary surface #D9E7F5, borders #C9D9EA); navigation bar is app navy #162235 with Apollo-amber active icons (#F4B942) and muted #9FB0C3 inactive (`nav`/`onNav`/`onNavMuted` tokens). Contrast fix from the iteration-38 sweep: new text-safe state tokens (`restingText #1E7A50`, `ears_upText #7A5200`, `growlingText #9A4A0B`, `barkingText #B3261E`, `sniffingText`, `unknownText`) used by `toneText()` for Pill labels and every state-coloured text; dots/borders/icons keep the bright hues; tint alphas raised. Web theme-color/background set in app.json.
- Higgins names & tracks checks (iteration 40): system prompt now lists Apollo's six checks by exact name and requires a machine-readable trailer `CHECKS: link|message|app|device|account|network` when advising a check. `src/domain/higginsChecks.ts` (`parseChecks`, `isDone`, `progressLine`; `yarn test:higgins-checks` 5/5) strips the trailer from the shown/spoken text; `HigginsChecks` renders "Higgins suggests" link chips (`higgins-check-<id>`) under the reply that route to /check, /message, /app-check, /device, /account, /network; completion is tracked on-device (`src/store/checkCompletion.ts`, `apollo.checks.completed.v1`) — each check screen calls `markCheckDone()` when it produces a result (link/message in ApolloContext; app/account/device/network screens) — and a chip turns green "Done" only if completed after Higgins asked, with a "1 of 2 done / All 2 done — thank you." progress line.
- Buttons (iteration 40, per user): secondary buttons are now white with a navy outline and navy label (no longer near the sky-blue background); ghost text navy; danger uses the text-safe red (#B3261E). Contrast fixes from iteration 39: onboarding wordmark → restingText; restingText darkened to #1B6B47.
- Higgins guidance upgrade (iteration 41, per user): the system prompt now lists each check with its purpose and WHERE TO FIND IT (Home → …, Guard tab → Open … Guard) and ties advice to Apollo's state (Growling → run the confirming check; Barking → act first, then Account Guard if codes/details were shared and Check my device if someone connected remotely; Biting → reassure, Account Guard only if something was typed). Verified reply: "…use Check my device, found on the Home screen… Account Guard, also on the Home screen… CHECKS: device, account". Chips now show the path under the label ("Home → Check a message"). HigginsSpeakButton restyled to the white/navy secondary face. Note: link/message completion is marked inside ApolloContext.checkLink/checkMessage (used by /check and /message), app/device/account/network in their screens.
- Home has ONE "Hear Higgins" (iteration 42, per user): removed the hero's speak button (`hero-hear-higgins`); the Higgins card's button (`higgins-greeting-hear`) now reads the greeting followed by Apollo's status line from the hero.
- Higgins Follow-Up (iteration 43): suggestions Higgins makes in Ask are recorded on-device (`apollo.higgins.suggestions.v1`, idempotent per message). A day later (`FOLLOW_UP_AFTER_MS` 24 h), Home shows one gentle `higgins-followup` card — "Yesterday I suggested Check my device and Account Guard. No rush at all — they're still waiting whenever you have a quiet moment." — with the same link chips (only checks still not done since he asked; a check appears once, from its latest suggestion) and a "Remind me tomorrow" snooze (24 h). Pure logic `pendingFollowUps`/`followUpLine` in `higginsChecks.ts` (`yarn test:higgins-checks` 9/9). Device check now counts as done when the device screen has assessed signals (not only on Save). Storage stores parse JSON values themselves — both stores accept string or object.
- Hear Higgins placement (iteration 43, per user): the single button lives inside the Apollo state card (`hero-hear-higgins`, reads state title + meaning + reason); the Higgins greeting card has no button.
- "Run a check" always names the checks (iteration 44, per user): `recommendedChecks()`/`checksSpoken()` in `higginsChecks.ts` — **mock standard list** (`RECOMMENDED_CHECKS_ARE_MOCK`) until native enforcement can report which protections failed verification: stale verification → Check my device, Network Guard, Account Guard; post-incident cooldown → by the resolved event's category. The Home hero renders them as tappable `HigginsChecks` chips ("The checks to run", `hero-checks`, `higgins-check-<id>`, Done tracking from start of today, not recorded for follow-up) plus a truthful note (`hero-checks-note`); Hear Higgins reads the list with where to find each. State reasons no longer say a bare "Run a check." `yarn test:higgins-checks` 12/12; iteration 44 E2E pass. TODO when enforcement lands: replace the table with real verification results.

- Light Sentinel Navy/Gold theme + Ask Higgins rename + Truth-of-State hardening (prior session, undocumented until now): Navy/Gold "Light Sentinel" visual language rolled out across Home, Guard, Patrol, Ask, Settings; Quick Checks on Home redesigned into one control strip; `/api/ask/history` Pydantic response-model crash fixed; Settings gained a Version/Build label (logo removed from Home header); iOS Swift `ApolloSecurityModule` capabilities contract now strictly returns `[]` for evidence per the documented platform contract; server-side Biting invariant (`_derive_verified_block()` in `routers/patrol.py`/`core/models.py`) rejects any `verified_block=True` not backed by real `enforcement_evidence` — a rule match, requested block or manual tap can never become "biting" on its own; `docs/android-consolidation-plan.md` + non-wired `src/security/future/GuardDogSecurityAdapter.ts` stub created for a future Android native-consolidation migration (M2), left unimplemented per user instruction; Android native DNS/VPN enforcement (`ApolloDnsVpnService`) left untouched — this track stays on hold until the user confirms a physical-device APK test passes.
- RDAP Domain Lookup for Check a Link (2026-06): keyless registrar/registration-date/registrant-org lookup — `backend/services/rdap.py` (IANA `dns.json` bootstrap, right-to-left longest-suffix TLD match → authoritative registry `GET {base}domain/{domain}`, jCard/vCard + `events[eventAction=registration]` parsing), Mongo-cached 48h (`domain_info_cache`, unique index on `domain` + plain `expires_at` index checked at read time, mirrors `reputation_cache` pattern). `POST /api/intel/check` fires the RDAP lookup as a background `asyncio.create_task` at request start (using the original submitted host) so it runs fully in parallel with the existing Safe-Browsing/blocklist verdict (incl. the `expand=true` redirect-following path) and is awaited with a bounded 6 s timeout at the end — best-effort by design: any RDAP failure/timeout/unknown-TLD degrades to `domain_info.available=false`, never blocking, delaying past a few seconds, or affecting the malicious/clean verdict. Domains registered <30 days ago are flagged `newly_registered=true` ("elevated scam risk"). `core/models.py` gained `DomainInfo`/`DomainInfoCache`; `IntelCheckResponse.domain_info` is optional and additive. Frontend: `check.tsx` result card shows a "Domain info" line (`formatDomainInfoLine` in new `src/domain/domainInfo.ts`) + a growling-tone "Newly registered — elevated scam risk" pill when flagged, or a muted "unavailable" hint when the lookup failed; Technical Details sheet shows the full breakdown (registrar/registered date/age/registrant org/RDAP server). `intelContract.ts`'s `parseDomainInfo` is defensive — a malformed `domain_info` is dropped silently, never rejects the whole intel result (RDAP is presentational, not a security verdict). Backend: `backend/tests/test_rdap_domain_info.py` (5 tests) + full pre-existing intel suite (25 tests) all pass, zero regression. Testing agent verified end-to-end on both backend (google.com/apple.com/microsoft.com real registrar data, cache reuse <200ms, bad-TLD best-effort <1s) and frontend (Domain info section, unavailable hint, Technical Details line) with no regressions elsewhere in Check a Link or the rest of the app.
- Gmail read-only connection — Gate 1 add-on, Phase 1 of 3 (2026-06): optional, manual-scan-only Gmail inbox connection for "Check an Email" (coexists with the pre-existing paste-email flow; user's planned sequence is Gmail → Outlook/Microsoft 365 → generic IMAP, each as its own phase). Architecture: server-side OAuth 2.0 Authorization Code flow against a **Web-application** Google Cloud OAuth client (`gmail.readonly` scope only — never send/delete/modify/label). `backend/services/gmail.py` — manual httpx-based token exchange/refresh (no google-auth-oauthlib dependency added), Fernet-encrypted refresh token stored in Mongo `gmail_connections` (device_id unique index), MIME-part text extraction (`text/plain` preferred, crude tag-strip fallback for `text/html`, capped ~4000 chars) via the Gmail API (`messages.list` + `messages.get`, last 30 days, capped 15/scan). `backend/routers/gmail.py`: `GET /gmail/connect` (authenticated, mints a single-use 10-min `state` in `gmail_oauth_states` — real Mongo TTL index via `expireAfterSeconds=0`, unlike the reputation/domain caches which check expiry at read time on purpose) → `GET /gmail/oauth/callback` (the ONE new public path in `core/auth.py` PUBLIC_PATHS — Google's redirect carries no bearer token; trust comes solely from the single-use state, never from caller input) → redirects back to whatever `app_redirect` the app itself supplied via `Linking.createURL('/email')` (validated against an `apollo/exp/https/http` scheme allow-list to prevent open-redirect abuse) with `gmail=connected|denied|error`. `GET /gmail/status`, `DELETE /gmail/connection` (disconnect), `POST /gmail/scan` (device_id-only body) round out the router. **Privacy contract: message content from `scan_inbox()` is returned to the caller for that one request only and is NEVER written to Mongo** — only the encrypted OAuth refresh token persists, and only until the user disconnects; this matches the "checked and discarded" pattern already used for the page-crawl and screenshot flows. Frontend: `ApolloContext.tsx` gained `scanGmailInbox()` (fetches via `/gmail/scan`, runs each message through the SAME on-device `analyseEmail()` engine as the paste flow, files Patrol events for anything non-resting — zero duplicated rule logic); `email.tsx` gained a "Connect Gmail (optional)" card above the paste form (`expo-web-browser` + `expo-linking`, no `expo-auth-session` needed) with connect/status/scan/disconnect states, per user's choices: manual scan only for now (settings toggle for automatic background scanning is a planned follow-up, needs a native build — background scanning cannot run in Expo Go), read-only Patrol alerts only for now (a settings toggle to allow archive/delete from within Apollo is also a planned follow-up). Egress allow-list (`gmail_scan`: device_id only) + updated `PRIVACY_POLICY_SUMMARY`. Real Google OAuth credentials configured (GOOGLE_CLIENT_ID/SECRET in backend/.env, user-created Web-application client; GMAIL_TOKEN_ENCRYPTION_KEY generated locally) — see `/app/memory/test_credentials.md`. Tests: `backend/tests/test_gate_gmail.py` (11/11: status/connect/open-redirect-protection/bogus-callback-state/scan-without-connection/idempotent-disconnect) + full regression 230/230 (pre-existing unrelated flakes excluded). **The real Google consent-screen login cannot be completed by an automated test agent (bot-login blocked by Google) — that step is unverified end-to-end and needs the user to manually connect a real Gmail account and confirm "Scan my inbox now" surfaces expected Patrol events.** Native OAuth (iOS/Android) needs a development/standalone build to test — the web preview's browser-popup flow is what's usable/testable right now.
- NEXT (approved by user, sequenced after Gmail): Outlook/Microsoft 365 connection (Phase 2, Microsoft Graph OAuth) and generic IMAP connection (Phase 3, app-password based) for the same "Check an Email" inbox-scan capability — followed by settings toggles for automatic periodic background scanning and in-app archive/delete of flagged emails (both currently manual-only / read-only per user's initial choice, explicitly deferred).
- "Let Apollo read the page" — Gate 3 Phase C (2026-06): second, manual/opt-in button on Check a Link (coexists with the pre-existing screenshot flow), fetches the target page's live HTML server-side instead of a screenshot. `backend/services/webcrawl.py` — SSRF-safe fetch: only http/https, resolves + rejects private/loopback/link-local/reserved/multicast/unspecified IPs before every hop (redirects followed manually, max 3), caps response size (~1.5MB) and time (~14s), no JS execution, strips `<script>/<style>`, extracts title/visible text/input-field types (password/email/tel only)/button labels/outbound link hosts. **Fetched content is never persisted or cached anywhere — checked in memory and discarded**, unlike the RDAP registrar cache. `POST /api/page/crawl` (routers/analysis.py) sends the extracted text (never raw HTML) to Gemini for the exact same `PageSignals` JSON contract as the existing screenshot `/page/extract` endpoint, plus a purely-descriptive `higgins_note` field (never a verdict — the on-device `analysePage()` engine stays sole decision-maker, exactly like every other Gemini "second opinion" in the app). Frontend `check.tsx`: new "Let Apollo read the page" button reuses the existing `check-page-card` UI end-to-end (zero duplicated rule logic) plus a new "Higgins's take" section for the note; friendly errors surface in the existing `check-page-error` card for SSRF-blocked/invalid/unreachable targets. Egress allow-list (`page_crawl`: device_id, url only) + updated `PRIVACY_POLICY_SUMMARY` disclosure line. Tests: `backend/tests/test_gate3_page_crawl.py` (9/9, real fetches of example.com/developers.strava.com, SSRF-blocks of 127.0.0.1/localhost/169.254.169.254 all <15s). Testing agent flagged `CORS_ORIGINS` was empty in backend/.env, blocking the web-preview testing tool's cross-origin calls (localhost:3000 page bundle calling the public preview HTTPS backend URL) — added the preview domain + localhost dev ports to `CORS_ORIGINS`; harmless for real usage (native apps ignore CORS; real end users hit frontend+backend through the same public origin, so no cross-origin request occurs there either way).
- Gmail read-only connection shipped (see Gate 1 add-on entry above, tested 11/11 + full regression). "Email Guard" requested next (2026-06): a richer, automatic pre-click assessment layer, requested to sit alongside the paste flow AND the Gmail auto-scan (retrofit both together). Scope agreed: (1) auto-run full link assessment (redirect-chain expansion + Safe Browsing/blocklist + RDAP domain-info, no manual "Check" tap needed) on every URL found in a checked/scanned email or message; (2) NEW capability — displayed-link-text vs real-destination-href mismatch detection (the classic "says paypal.com, goes to evil.ru" pattern), requiring the raw HTML anchor structure (available from the Gmail API's `text/html` MIME part; best-effort regex fallback for plain-text paste, which rarely carries this signal). Hard rule carried over from the existing Truth-of-State invariant: heuristics/URL-reputation findings here may only ever raise state to `growling` or `barking` — they must NEVER produce `biting` (that stays reserved for verified native block evidence elsewhere in the app). Explanations must be specific and human ("Display name says PayPal, but the sender domain is unrelated", "This link redirects through three domains and ends at a known malicious host"), not a generic red banner. **SHIPPED (2026-06)**: `services/intel.py` gained `assess_indicator()` — a pure extraction of the previous `/intel/check` body (redirect-chain expansion + Safe Browsing/blocklist + parallel/best-effort RDAP), now shared by both `/intel/check` (unchanged behavior, verified via full regression) and the enriched `/message/analyse` (runs it concurrently — `asyncio.gather` — for every URL in a checked/scanned message). `MessageUrlResult` extended with `redirect_chain`/`final_url`/`domain_info`. `services/gmail.py`'s `_extract_text()` became `_extract_content()`, additionally pulling `(text, href)` anchor pairs from the `text/html` MIME part via BeautifulSoup — `routers/gmail.py`'s `ScanMessage` gained a `links` field carrying them through to the frontend. New shared frontend module `src/domain/linkGuard.ts`: `evaluateLinkGuardFindings()` (redirect-chain-length + RDAP newly-registered + malicious-verdict → growling/barking with specific why-lines; the Truth-of-State invariant is enforced **by construction** — its internal `escalate()` helper only ever receives the literals `"growling"`/`"barking"`, so it's structurally impossible for this path to produce `"biting"`), `detectAnchorMismatch()` (compares a claimed domain-shaped token in the link's visible text against the real href's host), `extractAnchorsFromPlainText()` (best-effort markdown/`text (url)` pattern recovery for paste flow, which otherwise has no anchor structure at all). Wired into `ApolloContext.tsx`'s `checkMessage()` (paste-message/email flow) and `scanGmailInbox()` (now also calls the enriched `/message/analyse` per scanned message, which it didn't before, plus merges the real Gmail anchor pairs) and into `email.tsx`'s paste-flow `run()`. Tests: `backend/tests/test_email_guard.py` (10/10 — enriched `/message/analyse`, unchanged `/intel/check` behavior post-refactor, `_extract_content()`'s anchor-mismatch extraction on a synthetic paypal.com-text/evil-href HTML payload) + full regression 254/257 (3 pre-existing documented flakes, all passed individually on retry). Frontend verified end-to-end: paste-email escalating to barking with brand-mismatch why-lines, SMS paste escalating to growling, Check-a-Link unaffected, zero regressions anywhere.
- Full protection-stack roadmap captured 2026-06 (Websites → Email → Calls → Text, all sharing one evidence-backed reputation engine and feeding Patrol; **the same Truth-of-State rule applies to all four**: `resting`/`growling`/`barking` may come from heuristics/AI, `biting` must always require deterministic known-bad threat intel, an explicit user rule, or equivalently strong verified evidence — never a heuristic/AI judgment call alone):
  - **Website Guard** — shipped (Check a Link + RDAP + "Let Apollo read the page").
  - **Email Guard** — shipped, see above (automatic pre-click link assessment + link-mismatch detection, applied to paste flow, Gmail scan, and IMAP scan).
  - **Outlook (Microsoft Graph OAuth)** — SKIPPED per user decision (2026-06): generic IMAP (below) already covers Outlook.com/Office365 via IMAP + app password without needing a separate Azure AD app registration, so the dedicated OAuth integration wasn't built.
  - **Generic IMAP connection** — SHIPPED (2026-06), Gate 1 add-on Phase 3: connect ANY email provider (Gmail app password, Outlook, Yahoo, iCloud, custom domains) via host/port/username/app-password entered directly in the app — no OAuth app to register, unlike Gmail. `backend/services/imapmail.py`: read-only IMAP only (`SELECT INBOX` with `readonly=True`, `BODY.PEEK[]` — never `STORE`/`COPY`/`MOVE`/`EXPUNGE`), TLS via `ssl.create_default_context()`, Fernet-encrypted app-password storage (`IMAP_CREDENTIAL_KEY` — deliberately a SEPARATE key from Gmail's `GMAIL_TOKEN_ENCRYPTION_KEY`, different credential type/blast radius) in Mongo `imap_connections`, capped message count (15)/bytes (2MB)/text length (4000 chars)/timeout (20s). `imaplib` (synchronous) wrapped in `asyncio.to_thread()` throughout so it never blocks the event loop. `_parse_message()` uses Python's built-in `email` module (RFC822 parsing) + BeautifulSoup for `text/html` anchor extraction — same `(text, href)` pairs feeding Email Guard's link-mismatch check as the Gmail path. `backend/routers/imapmail.py`: `GET /imap/providers` (Gmail/Outlook/Yahoo/iCloud presets), `POST /imap/connections` (validates via one real `test_connection` call before saving), `GET /imap/status`, `DELETE /imap/connection`, `POST /imap/scan` (device_id-only body, same "checked and discarded, never stored" privacy contract as Gmail). Frontend: `ApolloContext.tsx`'s `scanGmailInbox`/`scanImapInbox` now share one `_scanInboxMessages()` helper (DRY — both run the same on-device engine + Email Guard assessment + Patrol filing). `email.tsx` gained a second "Connect another inbox (optional)" card below the Gmail card, with a bottom-sheet connect form (provider preset chips, host/port/username/app-password, `secureTextEntry`). Egress allow-list (`imap_connect`: device_id/host/port/ssl/username/app_password; `imap_scan`: device_id only) + updated `PRIVACY_POLICY_SUMMARY`. Tests: `backend/tests/test_gate_imap.py` (9/9: providers list, status before connection, invalid-host rejection, unreachable-host graceful failure, scan-without-connection 404, idempotent disconnect, synthetic-message anchor-mismatch extraction) + full regression 263/266 (3 pre-existing flakes, all passed individually on retry) + frontend verified (card rendering, sheet + preset auto-fill, error-on-invalid-host with sheet staying open, zero regression in Gmail card/paste flow/rest of app). **No real IMAP mailbox has been connected/scanned end-to-end yet** — no test mailbox was available to either this session or the testing agent; error paths are fully verified, but a real connect-then-scan needs a human with real app-password credentials for any provider.
  - **Call Guard** — SHIPPED (2026-06). Android: real `RoleManager.ROLE_CALL_SCREENING` request flow + `ApolloCallScreeningService.kt` (CallScreeningService) — checks an incoming number against three on-device sets (personal `block`, personal `allow`, and `autoRisky` — numbers THIS device previously found high-risk via a lookup, per-device only, no cross-user sharing in this build); a match in block/autoRisky is REJECTED before it ever rings (`respondToCall(disallow=true, reject=true)`), which is the verified enforcement action itself, recorded via `EnforcementEvidence.verifiedCallBlock` (new `call_screening` mechanism, reuses `destinationDomain` for the caller's E.164 number — documented shortcut, no new field added across the Kotlin/Swift/Python/TS layers for a v1) and synced through the SAME generic `getEnforcementEvidence()`/`syncEnforcementEvidence` pipeline Site Guard already uses (extended, not replaced, to branch on mechanism for call-specific Patrol copy + `local_indicator` instead of `indicator_host` for the number — matching Check This Call's existing choice to never sync a raw phone number to the backend). Everything else rings completely normally — Apollo never delays/silences a call on a guess — and unknown numbers are queued (bounded, deduped) for a background reputation lookup done by the app, never inside the ~5s screening window. iOS: real `CXCallDirectoryExtension` ("ApolloCallDirectory", new Xcode extension target via `plugins/withApolloCallGuard.js`, mirroring the EXACT proven pattern of the existing Safari content-blocker extension — same shared App Group, same target-creation approach) reads a `block`/`allow`/`autoRisky` JSON file the main app writes and adds ascending-sorted blocking entries; `CXCallDirectoryManager.getEnabledStatusForExtension`/`reloadExtension` used for real (not guessed) status + instant reload after any list change. Apple's newer "Live Caller ID Lookup" (PIR/relay, `IdentityLookup` framework, real API names confirmed via research) is scaffolded in `LiveCallerIDLookupHandler.swift` but explicitly NOT wired into any build target — needs its own extension target, Apple-granted entitlement, AND a from-scratch PIR backend server (a multi-week build on its own), clearly flagged as future work rather than claimed as working. **Caller number reputation**: integrated IPQualityScore (`services/phonerisk.py`, `POST /api/call/risk-check`, backend-proxied — key never reaches the client) — note the correct live API takes the key as a URL path segment (`/api/json/phone/{key}/{number}`), NOT the `IPQS-KEY` header the initial integration playbook suggested; fixed after a live-call verification. Response is Truth-of-State-honest: `decision` ("allow"/"review"/"avoid" — deliberately never "block") is heuristic/probabilistic and may only reach "growling"/"barking" in the app; ONLY a native CallScreeningService/CXCallDirectory rejection may ever produce a verified "biting" event. Cached 24h in Mongo `phone_risk_cache` by E.164 number (not hashed — this is the caller's number, already visible in the person's own call log, same privacy tier as a domain). New DEDICATED screen `app/call-guard.tsx`: automatic-screening status card (Android: role request button; iOS: honest Settings-deep-link explainer; web/other: "needs a native build"), "Recently flagged calls" (call-category Patrol events), "Check this number" quick action (phone-pad input + optional 2-letter country, shows fraud score/line type/carrier, "Add to block list"/"Always allow" actions), personal block/allow list management — "Check this call" (`app/call.tsx`) stays completely unchanged, per explicit instruction, as the mid-call-under-pressure path. Guard tab gained a "Calls" section → Call Guard card, matching the Network/Account/Text Guard card pattern. **Scope simplification flagged to the user**: the originally-discussed "community-wide synced scam-number list across all Apollo users" was intentionally NOT built this session (per-device `autoRisky` only) — reduces privacy/legal surface and native complexity for a v1; noted as a natural fast-follow. Tests: backend regression 261/269 (8 pre-existing, unrelated failures in guardian-invite/weekly-checkin email flows — not touched by this work) + 12/12 new Call Guard tests (7 risk-check + 5 pre-existing call-patrol tests) all passing, using IPQS's own documented test number live (no mocking, matching this repo's existing convention). Frontend verified end-to-end on web: "Check this number" reaching "High risk" (fraud score 100/100) on a live IPQS lookup, instant Patrol logging, "Add to block list" flow, honest capability messaging on web/iOS. **Native CallScreeningService (Android) and CXCallDirectoryExtension (iOS) cannot be tested in Expo Go/web preview — both need a development/production build on a real device to verify end-to-end (including generating a genuine iOS extension target via EAS/Xcode).**
  - **Flaky backend test fix (2026-06)**: the recurring `test_family.py`/`test_device_auth.py` (and other guardian-invite/weekly-checkin) failures were caused by `services/email.py`'s `send_email()` making a real, live HTTP call to the Emergent email relay for every test that adds a guardian — under full-suite/xdist concurrency this reliably tripped the relay's 429 concurrency rate limit. Fix: `send_email()` now short-circuits for the Resend test-safe sentinel address `delivered@resend.dev` — confirmed via grep to be the ONLY email address used anywhere in `tests/*.py` — returning a synthetic id without ever touching the network; real recipient addresses go through the exact same safety checks + semaphore + retry/backoff as before (zero behaviour change for actual users). Verified: `test_family.py` 12/12 + `test_device_auth.py` 16/16 clean on two separate full runs; full suite 273/273 on the second run (one unrelated, pre-existing Gemini "second opinion" timeout seen once under `-n2` load, not reproducible in isolation — untouched, out of scope).
  - **Flaky Gemini "second opinion" timeout fix (2026-06)**: that unrelated flake (test_gate2_message.py's explanation occasionally coming back None) was itself a second, separate concurrency issue — `gemini_second_opinion`/`gemini_app_opinion`/`gemini_account_opinion` (gate2/7/8) each wrapped their Gemini call in a bare `asyncio.wait_for(..., timeout=20)` with zero retry, so one slow response under concurrent load (several requests hitting the Gemini relay at once during a full-suite/xdist run) silently degraded to `explanation=None`. Fix: all three collapsed onto one shared `_gemini_second_opinion_call()` helper in `routers/analysis.py` that retries once on ANY failure (including the timeout) before falling back to `None` — same "retry only if it can actually help" philosophy as the email fix, and still never overrides the on-device verdict either way. DRY bonus: 3 near-identical call/parse/truncate blocks collapsed into 1. Verified: full backend suite run 3× post-fix — 273/273, 272/273 (the 1 = a different, already-documented pre-existing `test_iter7` log-tail race under xdist, confirmed passes alone, unrelated to Gemini), 273/273 — zero recurrence of the gate2/7/8 timeout across all three runs; `test_gate2_message.py`+`test_gate7_app.py`+`test_gate8_account.py` also run standalone, 25/25 clean.
  - **Project split clarified + Stage 0 protection-integration plan (2026-06, doc-only)**: this `/app` workspace is now explicitly the **Apollo main** project (active consumer product development). `m2-native-acceptance` and the proven `com.guarddog.*` native engine belong to a **different** Emergent project/session and are not present here and were not recreated. Working rule: consumer-app changes → Apollo main (here); native-engine changes/re-certification → m2-native-acceptance (not here). Wrote `docs/APOLLO_PROTECTION_STAGE0.md` (Stage 0, documentation only, zero code changes) covering: production signing authority (today: no local keystore/eas.json — signing is via the Emergent-managed Publish pipeline under `app.hwg.apollo`; the frozen GuardDog APK SHA-256 is a certification hash only, never treated as this app's signing key), Apollo-facing adapter ownership (`SecurityPlatformAdapter.ts` contract frozen; `frontend/modules/apollo-security`/`com.hucentai.apollosecurity` stays the Apollo-facing adapter layer, GuardDog becomes the engine underneath it, never called directly by product code), the import path for `com.guarddog.*` (human-mediated transfer of a pinned snapshot at commit `e5d11be912c76775c5a8b27b53218211484ca8bd` onto a dedicated consolidation branch — never a merge of `m2-native-acceptance`, never a rewrite from description), the production-vs-certification boundary, the Higgins truth/diagnostic interface (today's plain-language-only explainer + the future "Higgins Checkup"'s data contract, fixed now as read-only over `ProtectionStatus`/`PlatformCapabilityProfile`/`EnforcementEvidence` via `SecurityPlatformAdapter` only, so it stays engine-agnostic), 5-stage migration plan with rollback boundaries (Stage 5 — deleting the legacy `ApolloDnsVpnService.kt` — is the only non-free rollback point), explicit do-not-touch areas, and 5 open decisions requiring sign-off before any Stage 1 work begins (transfer mechanism, vendor-vs-dependency, new Gradle namespace, signing-identity confirmation, re-certification ownership). Builds directly on the pre-existing `docs/android-consolidation-plan.md` + `docs/android-physical-device-acceptance.md` (already-written decision records covering the Android-specific half of this) rather than duplicating them. **No migration/implementation started — stopped after Stage 0 per explicit instruction, awaiting review.**
  - **Cross-project relay clarified (2026-06)**: user asked me to relay a key/trust-architecture correction to "the m2 team." Confirmed via platform support: Emergent agent sessions are fully isolated per project — there is no mechanism for one project's session to act inside or send instructions to another. The user must open the `m2-native-acceptance` project's own chat directly for that. Similarly, "Save to GitHub" is a manual UI button the user clicks themselves (requires GitHub connected + paid plan) — not an agent-invocable action; no git remote is configured in this workspace and no push tool exists. Added §9 "Key & trust architecture for rule-bundle signing and revocation" (build-time pinned bootstrap trust — primary + recovery root keys — verifying a runtime-updatable signed Trusted Key Manifest with active/revoked key IDs, expiry, monotonic version, rotation overlap, rollback protection; a fetched key is never trusted merely because the backend supplied it; revocation latency for offline devices documented honestly as an unavoidable limitation; root-compromise recovery needs a controlled app update unless the recovery root was pre-pinned) and §10 "Corrected offline/backend-unreachable semantics" (last-known-good signed trust set + rule bundle kept; locally-known-bad still blocked; unsigned/unknown-key/rolled-back/unverifiable bundles never accepted; but unknown/unverified traffic while offline now correctly FAILS OPEN rather than breaking ordinary connectivity; degraded/stale state surfaced via the existing `ProtectionStatus.degradedReason`/`lastVerified` fields for Higgins to explain later — no new field needed) to `docs/APOLLO_PROTECTION_STAGE0.md`. Explicitly flagged as informational-only in this repo — the durable copy must be corrected by the user directly in the m2 project's own decision document, which this session cannot access or edit.
  - **Stage 1A — Production Engine Source Transfer Planning (2026-06, doc-only)**: user confirmed m2-native-acceptance's Stage 0 trust/revocation correction is closed there (commit `df26765`); only remaining actions are the user personally clicking "Save to GitHub" in both projects. Wrote `docs/APOLLO_STAGE1A_TRANSFER_PLAN.md` (planning only — zero code imported, zero GuardDog code written/recreated, `ApolloDnsVpnService.kt`/consumer UI/Higgins/`SecurityPlatformAdapter.ts` all untouched). Empirically tested (not assumed) what's actually available from this sandbox: outbound HTTPS/git access to github.com works (`curl`/`git ls-remote` against a public repo both succeeded); a locally-run `git bundle create` → `git clone` round-trip reproduced the exact same commit hash, confirming a single-commit git bundle preserves full content-addressed integrity; `get_assets_tool` confirmed working for receiving user-attached files (checked — 14 pre-existing unrelated attachments present, no GuardDog source attached yet). Recommended primary transfer method: **git bundle of the single pinned commit** `e5d11be912c76775c5a8b27b53218211484ca8bd` (needs no shared repo/token/live network at fetch time, cannot carry in anything beyond the pinned ref); secondary: pinned-SHA GitHub fetch (needs repo URL + a minimally-scoped read-only token if private — neither known/available to this session); fallback only: archive + manifest (weakest — no git-native integrity). Provenance procedure: `git rev-parse` of the imported ref must equal the pinned SHA exactly (primary proof); CI run `35171369548` + APK SHA-256 `905d66a9ab5d9f70c22c4a2fce897cdf668d975908546e583b404db01f774335` recorded as certification pointer only — explicitly NOT expected to be reproducible once rebuilt inside Apollo main's own signing identity (consistent with Stage 0 §1.2); a file-level SHA-256 manifest of the approved paths generated as a durable audit record. Scope discipline: allow-list `packages/guarddog-android-sdk`, `packages/guarddog-expo-module`, production `com.guarddog.*` native code only; explicit deny-list for certification-only code (test/acceptance harnesses, CI workflow config, m2-only fixtures) — final allow-list confirmed by manual review only after the pinned tree is actually visible, never a blind whole-repo copy. Landing location (forward-looking, not executed): a new `packages/`/`vendor/guarddog/` path, never mixed into `frontend/modules/apollo-security`. **Stopped after producing the plan per explicit instruction — no transfer executed; awaiting user's choice of method + the actual file/credentials to proceed to Stage 1B.**
  - **Repo discovered live (2026-06)**: user shared the m2 project's actual GitHub URL, `https://github.com/zelnix/Apollo` (public, no token needed). Read-only inspection (scratch `/tmp` clone, nothing copied into this workspace at the time) confirmed: it's genuinely the other project (`frontend/app.json` → "Apollo Native Gates" / `com.emergent.guarddogm.k6cugf`); pinned commit `e5d11be912c76775c5a8b27b53218211484ca8bd` is the exact tip of `main` and an ancestor of `m2-native-acceptance` (3 commits behind: `e5d11be`→`f0aecd5`→`df26765`→tip `df7a4fd`, `df26765`'s message matched exactly what the user reported); `docs/APOLLO_INTEGRATION_STAGE0_DECISIONS.md` and native `TrustedKeyRegistry.kt`/`RuleBundleVerifier.kt`/`BundleVersionStore.kt` are real; `packages/` at the pinned commit has 4 dirs, not 2: `guarddog-android-sdk`, `guarddog-expo-module` (approved) plus previously-unnamed `guarddog-contracts` and `guarddog-ios-sdk` (flagged as open scope questions). Updated `docs/APOLLO_STAGE1A_TRANSFER_PLAN.md` to promote live pinned-SHA GitHub fetch to the primary method (bundle demoted to fallback).
  - **Stage 1B — Production Engine Source Transfer, EXECUTED (2026-06)**: user resolved the two open scope questions: include `guarddog-contracts` *only if* it's a real build/runtime dependency of the approved packages (verify from build config, don't assume); defer `guarddog-ios-sdk` entirely (separate future iOS stage). Verified from actual Gradle/npm config (not assumed): `guarddog-android-sdk` depends only on external libs + its own internal `vpn→core` edge; `guarddog-expo-module`'s `android/build.gradle` depends on `project(':guarddog-core')`/`project(':guarddog-vpn')` only. **Zero** Gradle/npm dependency edge onto `guarddog-contracts` from either — the only hits were 2 doc-comment "Mirrors ..." lines plus a `sync-to-app.mjs` script that copies into *the other project's own* frontend, not into either approved package. Per the user's own conditional rule, `guarddog-contracts` is therefore **excluded**. Also found and excluded one certification-only file nested inside the otherwise-approved `guarddog-expo-module`: `android/src/androidTest/.../AndroidBlockingProofE2ETest.kt`, self-labelled "Physical-device acceptance (Phase 5)" requiring special instrumentation args — a certification harness, not a unit test, so excluded even though colocated inside an approved package. Re-verified source commit == `e5d11be912c76775c5a8b27b53218211484ca8bd` via a fresh scratch clone, then staged 91 files (72 `guarddog-android-sdk` + 19 `guarddog-expo-module`) into a **new top-level `packages/` directory** in this repo (chosen over `vendor/guarddog/` per instruction to preserve the source's own monorepo layout) — every file individually byte-verified via SHA-256 against the pinned commit's git blobs, zero mismatches; manifest stored at `docs/APOLLO_STAGE1B_SHA256_MANIFEST.txt`. `packages/guarddog-ios-sdk` was never cloned/touched. Wrote `docs/APOLLO_STAGE1B_TRANSFER_MANIFEST.md` (source→destination→action→reason table for every path, dependency-closure evidence, existing-tree conflict check [zero — `packages/` didn't exist before], and forward-looking Stage-2 build-system notes: this is an Expo *managed* workflow app with no checked-in `android/` project, so `:guarddog-core`/`:guarddog-vpn` will need a new Expo config plugin — matching the existing `./plugins/withApolloSiteGuard` pattern — to register into the generated `settings.gradle` at prebuild time, not a static edit; positive signal: this app is already on Expo SDK `57.0.19`, an exact match to what `guarddog-expo-module` was built against). **Nothing wired up**: `SecurityPlatformAdapter.ts`, `frontend/modules/apollo-security`, `ApolloDnsVpnService.kt`, consumer UI, Higgins, and `frontend/package.json` all confirmed untouched (`git diff --stat` empty on all of them). Source is staged and provenance-verified only — explicitly not ready for production integration; that's a distinct, later, separately-approved stage.
  - **Stage 1C — Production Build Integration, EXECUTED (2026-06)**: goal — wire the Stage 1B staged, certified GuardDog Android engine into Apollo's native build config with zero behavior/UX/Higgins change, Android-only. New `frontend/plugins/withGuardDogEngine.js` config plugin: (1) `withSourceCheck` fails prebuild fast with a clear error if the Stage 1B staged source ever goes missing; (2) `withSettingsGradle` appends `include(':guarddog-core')`/`include(':guarddog-vpn')` with `projectDir` pointed straight at the untouched `packages/guarddog-android-sdk/*` source (raw Gradle library modules, not Expo modules, so not autolinked); (3) `withProjectBuildGradle` adds `gradlePluginPortal()` + one classpath entry (`org.jetbrains.kotlin.plugin.serialization:...:2.1.20`) to Apollo's own generated root `build.gradle` — the one Gradle plugin id `guarddog-core`/`guarddog-vpn` need that wasn't already provided. Registered in `app.json`'s `plugins` array. Separately, `frontend/package.json` gained `"expo":{"autolinking":{"searchPaths":["../packages"]}}` — verified empirically (via `npx expo-modules-autolinking resolve`) to be the correct, documented way to make autolinking discover `guarddog-expo-module` living outside `frontend/` (unlike `apollo-security`, which is auto-discovered because it's inside `frontend/modules/`); confirmed it resolves exactly once, with zero effect on `apollo-security`'s own discovery. `guarddog-vpn`'s own `AndroidManifest.xml` already declares its `VpnService` + required permissions — no manual manifest edit needed, Android's own Gradle manifest merger picks it up automatically once `:guarddog-vpn` is a real dependency. Empirically confirmed (not assumed) React Native 0.86.3's own version catalog (`node_modules/react-native/gradle/libs.versions.toml`) already pins `agp=8.12.0`/`kotlin=2.1.20` — an exact match to what `guarddog-core`/`guarddog-vpn` require — so `com.android.library`/`org.jetbrains.kotlin.android` needed zero addition, only the one missing serialization plugin id. Verified via two independent clean `expo prebuild --platform android` runs (Node-only, no JDK needed — confirmed this sandbox has **no Java/Gradle/Android SDK at all**): identical output both times, `:guarddog-core`/`:guarddog-vpn`/`guarddog-expo-module` each appear exactly once, generated `android/` deleted afterward (not checked in, fully reproducible on demand). **Honest limitation, stated explicitly in the report:** actual Gradle build/Kotlin compilation could NOT be executed in this sandbox — everything verified is structural/version-string-based, not an executed compile; a real native build via the Emergent pipeline is required before this can be called proven. Re-verified all 91 Stage 1B files still byte-identical via the SHA-256 manifest — zero mismatches, nothing under `packages/` touched. Ran regression-level frontend tests (per the user's credit-efficient testing policy, not a full `testing_agent` pass): `test:adapter-contract` 7/7, `test:security` 8/8, `test:platform` 11/11, `test:truth` 5/5, `test:evidence-sync` 4/4, `expo-doctor` (4 pre-existing unrelated failures, none new), `eslint` clean; web preview restarted, confirmed still logs `SecureCore initialized {"implementation":"mock"}` (Expo Go/web still honestly not pretending native VPN enforcement exists). **Flagged, not executed, awaiting user decision:** `guarddog-core`/`guarddog-vpn` require `minSdk=26`; this app's current effective minSdk is 24 (RN's default, no `expo-build-properties` override) — a real AGP manifest-merge constraint requiring the app's own minSdk to rise (drops Android 7.x support app-wide), reported per the "stop and report, don't guess-fix" instruction rather than silently applied — this is a change to Apollo's own build config, not certified GuardDog source, and doesn't affect certified behavior either way. Wrote `docs/APOLLO_STAGE1C_BUILD_INTEGRATION.md` with the full report. Consumer UI, Higgins, `SecurityPlatformAdapter.ts`, Patrol, threat-event semantics, `guarddog-contracts`, `guarddog-ios-sdk` — all confirmed untouched. **Stopped here per instruction — not proceeding to Stage 1D (production adapter/native-runtime wiring), live VPN activation, Higgins integration, UI changes, or physical-device proof.**
  - **minSdk 24→26 approved + Stage 1C.1 native-build gate attempted (2026-06)**: user approved raising Android minSdk to 26 at the Apollo Production/config-plugin level (not by patching certified GuardDog source). Implemented via `npx expo install expo-build-properties` (57.0.20) + `["expo-build-properties",{"android":{"minSdkVersion":26}}]` in `app.json` — the standard reproducible Expo mechanism, no manual `android/` edits. `targetSdk` unaffected (stays at RN's pinned 36). Verified via clean `expo prebuild`: generated `android/gradle.properties` now has `android.minSdkVersion=26` exactly; `:guarddog-core`/`:guarddog-vpn`/`guarddog-expo-module` still each resolve exactly once; re-ran all 5 regression suites (35/35 pass), `eslint`/`expo-doctor` unchanged (same 4 pre-existing unrelated flags); re-verified all 91 Stage 1B certified files still byte-identical via the SHA-256 manifest (zero mismatches). Recorded the product-support consequence explicitly (drops Android 7.x/7.1) and the future runtime test the user flagged (must prove `ForegroundServiceTypeNotAllowedException` doesn't fire on a real device — a successful manifest merge does not prove systemExempted foreground-service eligibility). **Stage 1C.1 (real native build gate) could NOT be executed**: this sandbox has no JDK/Android SDK/Gradle at all, and no tool available to this agent triggers Emergent's actual native build pipeline (Gradle config, Kotlin compilation, manifest merge, APK build all require the user-triggered Emergent Publish flow). Stated this plainly in `docs/APOLLO_STAGE1C_BUILD_INTEGRATION.md` §11 rather than approximating a result — every check possible without a real compiler was done and is clean, but the mandatory compile-gate items remain unverified pending an actual build. Stage 1D (runtime/adapter integration) explicitly not begun.


  - **Text Guard** — SHIPPED (2026-06), decision resolved: Android uses opt-in **NotificationListenerService** (NOT default-SMS-app role, NOT READ_SMS ever). New Kotlin `ApolloSmsListenerService.kt` (NotificationListenerService subclass) restricted to the device's default SMS package + the two catalogued messaging apps (Google Messages/Samsung Messages) — WhatsApp/Telegram/Messenger deliberately excluded (user asked for SMS, not every chat app). Captures sender+text metadata into a capped (20-item) SharedPreferences queue on `onNotificationPosted` (group/summary notifications skipped, per-notification-key dedup up to 200 keys), fires a best-effort LOCAL heuristic notification ("Apollo noticed a message worth checking" — URL or obvious scam-keyword regex, never a verdict) so the person hears something even before reopening the app, then defers the REAL, authoritative check to the app. `ApolloSecurityModule.kt` gained `getMessagingCapabilities` (live `Settings.Secure` "enabled_notification_listeners" read — never cached), `getRecentMessageSecurityEvents` (drains/clears the queue — mailbox semantics, no double-processing), `openSmsListenerSettings` (deep-links to `Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS`). AndroidManifest gained the `<service>` declaration (`BIND_NOTIFICATION_LISTENER_SERVICE`). iOS: honestly reports `smsFiltering: "unsupported"` — Apple gives third-party apps NO mechanism to observe Messages notifications at all (no NotificationListenerService equivalent); `TextGuardFilterExtension.swift` is a clearly-labelled, NOT-wired-into-any-build-target scaffold for a future `ILMessageFilterExtension` (needs its own Xcode extension target + `com.apple.developer.message-filter` entitlement — deliberately not attempted as "working" this session). Frontend: `ApolloContext.tsx` gained an Android-only poll `useEffect` (45s interval + AppState-active trigger, `lowPower`-aware) that drains the native queue and runs each captured item through the EXACT SAME `checkMessage()` used for pasted text (zero duplicated rule logic — same on-device engine + Email/Text Guard link-mismatch assessment + Patrol filing), showing a toast for anything non-resting. New DEDICATED screen `app/text-guard.tsx` (per user's explicit choice, not a retrofit of the existing `/message` screen): "Automatic scanning" status card (Android: live capability + "Turn on notification access" button when off; iOS/web: honest "Apple doesn't let apps read your Messages automatically" copy, no misleading button), "Recently flagged from your messages" (message-category Patrol events), "Paste a message" fallback (same `checkMessage()` call), links hand-off to `/check`, Verify Sender sheet, RecoveryFlow, Mark as safe. Guard tab gained a "Messages" section → Text Guard card (status pill from open message-category events, `Open Text Guard` button), matching the existing Network/Account Guard card pattern exactly. No new backend endpoints — reuses `POST /api/message/analyse` entirely. Tests: full backend regression 265/266 (1 pre-existing transient pytest-xdist flake, passed individually), frontend verified end-to-end on web (paste flow reaching Barking on a synthetic bank-phishing text, live Patrol update, Guard tab card, honest iOS/web capability messaging, zero regressions in /message, /check, /patrol). **Native NotificationListenerService capture (Kotlin) cannot be tested in Expo Go/web preview — needs a development build on a physical Android device/emulator to verify capture → local heuristic nudge → app-open drain → Patrol.**


## Stage 1C.1 — Step 7 config gate diagnostic (this session)
- Ran `npx expo config --json` plain, with `EAS_NO_VCS=1`, with `EXPO_DEBUG=1 EAS_NO_VCS=1`, and from a pristine `git archive HEAD` checkout (no `.env`): all exit 0, valid JSON, no stderr exceptions.
- Node v24.19.0, expo 57.0.19, @expo/cli 57.0.21, commit a2c8ee0 (clean tree).
- Failure is NOT reproducible locally → requires Emergent stderr for build aa24dd73-eab7-4d0f-8b83-4734adb870b8.
- Record: /app/docs/STAGE_1C1_STEP7_CONFIG_DIAGNOSTIC.md. No code changes made. Stage 1D NOT started.

## Stage 1C.1 → 1D gate order (confirmed by user, binding)
1. **Diagnose & Apply Exact Cloud Fix** — obtain Emergent's real Step 7 (`eas-update` → `expo config --json`) stderr; fix ONLY the exact exception; GuardDog source untouched unless the error directly implicates it. No speculative changes.
2. **Rerun Publish** — confirm Step 7 clears and pipeline reaches native Android Gradle/Kotlin build (this is the actual Stage 1C.1 test).
3. **Runtime Wiring (Stage 1D)** — only after native build succeeds; wire certified GuardDog engine into SecurityPlatformAdapter; preserve Truth-of-State rules.
4. **Physical Device Proof** — install APK on real Android device; prove VPN start/stop; prove a real packet observed and intentionally blocked; verify enforcement evidence generated; only then allow THREAT_BLOCKED / "Apollo is biting."
Current position: waiting on step 1 input (Step 7 stderr for build aa24dd73-eab7-4d0f-8b83-4734adb870b8). Do NOT start step 3.

## Stage 1C.1 Step 7 — RESOLVED (this session)
- Root cause (reproduced deterministically): Emergent removes projectId → `eas project:init` re-links → writes plugin-evaluated `extra` back to app.json via deepmerge (array CONCAT) → `appExtensions` doubled → expo-share-intent throws "more than one appExtensions for ShareExtension (2)" → exit 1. **GuardDog exonerated** (fresh install, no-git, Node 18/20/22/24, packages/ absent — all pass).
- Fix (user-approved): `frontend/plugins/withEasAppExtensionsDedupe.js` (dedupe appExtensions by targetName, first occurrence kept) registered FIRST in app.json plugins. Nothing else changed.
- Verified: config/introspect exit 0; 3 write-back rounds clean; Android prebuild exit 0; GuardDog includes ×1 each, autolinking 1 project; SHA manifest 91/91; 35/35 regression tests.
- Next: user reruns Publish → success criterion = Step 7 passes and pipeline reaches native Android build. Stage 1D NOT started.

## Deployment health probe fix (this session)
- Deployed backend log showed platform liveness probe `GET /health` (root, unauthenticated) → 404 → container restart loop. Added `@app.get("/health", include_in_schema=False)` returning `{"status":"ok"}` in server.py (no DB/auth). `/api/health` and all auth gating unchanged. Verified 200 locally; auth still 401 on protected routes; 71 backend tests (auth/admin/api-regression/failure-modes/health-touching) green.
- Status board: Step 7 eas-update PASS ✅ · backend deployment reached ✅ · health probe FIXED 🔧 · Stage 1C.1 Android Gradle/Kotlin build NOT YET PROVEN ⏳ (need log lines: gradlew/assemble/compileKotlin/guarddog-core/guarddog-vpn/APK/AAB) · Stage 1D NOT STARTED.
- Redeploy after /health fix: platform probe now 200 OK on all calls (127.0.0.1 + 10.22.x). Backend deployment HEALTHY ✅. Android Gradle/Kotlin build evidence still NOT seen (backend container log does not contain it) — user must trigger the Android build from the deployment panel and paste that log.

## Stage 1C.1 — first EAS Android build reached PREBUILD, failed on package location; FIXED (this session)
- EAS build f2359ee5 failed in PREBUILD: withGuardDogEngine source check — /home/expo/workingdir/packages missing. Cause: eas-cli (no VCS) archives only frontend/; repo-root packages/ sibling never uploaded.
- Fix (user-approved): `git mv packages frontend/packages` (91 renames, byte-identical). Updated withGuardDogEngine.js (REQUIRED_PATHS 'packages/...', PACKAGES_DIR_FROM_ANDROID '../packages') and package.json searchPaths ['./packages']. Docs updated (1B manifest note, 1C §11b).
- Verified: SHA 91/91 from new location; config+introspect exit 0; archive simulation ships 91/91; prebuild inside simulated worker archive (no sibling packages) exit 0; core×1 vpn×1 expo-module autolinks ×1; 35/35 tests.
- Deployment-agent .gitignore ".env" findings = false positives for this pipeline (workspace upload includes .env); deliberately NOT changed (secret hygiene).
- Historical build-warning backlog: expo-asset peer dep missing (expo-audio), duplicate react-native-svg (@nandorojo/heroicons). **Correction:** duplicate SVG was later proven to be the post-splash runtime blocker and fixed by Support in `01a30ae`; it is not an outstanding harmless warning. See Stage 1C §13. No claim about the other warning is made by that fix.
- Status: Step 7 ✅ · backend deploy/health ✅ · EAS Android build reached ✅ · PREBUILD fixed 🔧 · Gradle/Kotlin NOT YET REACHED · Stage 1C.1 IN PROGRESS · Stage 1D NOT STARTED. Next: user generates fresh APK; need Gradle log.
- User re-pasted the SAME EAS log (build f2359ee5, code version 676c6260, unzip shows root-level source/packages) — predates relocation commit 0efef7a. No new fix needed. A fresh Publish (new code snapshot) + Android build is required; new unzip log must show `source/frontend/packages/...`.
- EAS build eb022c0b: PREBUILD ✅ (relocation confirmed), RUN_GRADLEW ❌ "project ':apollo-security' does not specify compileSdk" — Apollo-owned modules/apollo-security legacy ExpoModulesCorePlugin path. Fixed by migrating to expo-module-gradle-plugin (same as certified module). Certified source untouched (SHA 91/91). Next: fresh Publish + Android build; watch for :guarddog-core/:guarddog-vpn compile.
- Stage 1C.1 iteration 3 (2026-06): EAS build `737fa306` proved the certified GuardDog engine (`guarddog-core`, `guarddog-vpn`, `guarddog-expo-module`) and `apollo-security` all compile natively inside Apollo. Remaining failure `:app:processReleaseResources` (AAPT: `<package android:name>` must be a valid Java package name) traced to nine `SYSTEM_PREFIXES` strings (`com.google.` …) wrongly listed in `modules/apollo-security/android/src/main/AndroidManifest.xml` `<queries>`; removed them, added `INSTALLERS` to `AppDeviceCatalog.VISIBLE_PACKAGES` so the JUnit manifest-contract test still matches (37 entries). GuardDog SHA-256 manifest verified intact. Non-blocking: `google-services.json` has a stale `life.fb50.app` client beside `app.hwg.apollo`. Awaiting next Publish → Build; if `bundleRelease` succeeds Stage 1C.1 is closed and Stage 1D (runtime wiring) may begin.
- Stage 1C.1 device run #1 (historical): Android app closed after splash. An invalid native SecureCore configuration was reproduced with the pure validator, but **was not verified as the cause of the installed APK crash**; Support later identified the exact `RNSVGCircle` duplicate-registration exception (Stage 1C §13). User-approved policy/SafeStart work remains separate: production still requires native Apollo Security Adapter; native SecureCore is required only while `NATIVE_SECURECORE_DEPENDENT_FEATURES` is non-empty; `.env.production` selects SecureCore mock / security adapter native. Settings labels SecureCore "NOT ACTIVE (MOCK)". Selectors record configuration errors via `securityBoot.ts`; `_layout.tsx` renders SafeStart without app providers/navigation when blocked. This is a configuration-error boundary, **not protection against all OS/process crashes**. Earlier tests: security 9/9, boot 6/6 and web SafeStart/onboarding checks. App identity changed to `app.apollo.hwg` (including iOS extension/app-group identifiers); the stale Firebase file noted at that time was subsequently replaced with the matching `apollo-243ad` config. These earlier changes did not deduplicate SVG. Stage 1D still requires a successful physical-device launch of the fresh Support-fixed APK.

## 2026-09-21 product status (review `9cfb377` supersession)
- **Problem statement:** Apollo must provide one durable, evidence-backed Higgins investigation across every Gate,
  preserve original evidence until authoritative publication, recover safely from process/lease races, and ship
  honest Android/iOS/desktop candidates while using only the owner's `GEMINI_API_KEY`.
- **Architecture:** Expo mobile client and Tauri desktop shell; FastAPI/MongoDB Higgins coordinator with encrypted
  temporary evidence, durable jobs/events/device requests, fenced leases, conditional checkpoints and 15-minute
  scope expiry. EAS creates native Android/iOS candidates; Tauri creates desktop targets.
- **Implemented now (P0):** durable device request identity and consume-before-ack; one-root atomic evidence manifest
  publication; File Gate navigation-safe cache ownership; stable Device case; one shared Text/Email investigator;
  complete opaque multi-item share envelope; Patrol event→case continuation.
- **Delivery:** Android EAS build `18706c6e-cf91-418e-9536-94b1cf592f93` (fingerprint
  `31a0394db69ca674b79ef91a3d0cf3c2b0e2e083`) finished successfully against the healthy compatible backend; APK
  SHA-256 `50e51aff03ee69ed859386b734365a205fe9040fc240c5af896e7a3342503e91`. Linux Tauri
  release binary SHA-256 is `f3d79697729e558c3351b4c6b44b4c2a739966e2a7ba0b1074bd216e5e794a2a`.
- **P1 backlog:** Packages 3–5 limits/background/guided-action lifecycle; Android physical acceptance; signed iOS
  build after Apple credentials; target-host Windows/macOS packages.
- **P2 backlog:** Package 7 production GuardDog/configuration closure and credential-gated integrations.
- **Verification policy:** no testing agent, Playwright, scenarios or live Gemini probes. Current bounded checks:
  backend 42 focused Higgins tests + 2 Call Guard tests, frontend TypeScript/ESLint, Share suite 13/13, Rust
  `cargo check`, Linux Tauri release compile, backend health HTTP 200.

## 2026-09-22 deployment readiness
- Deployment-agent final health check: **PASS**.
- Startup is non-destructive: no collection drop and no automatic bulk legacy-content migration. Explicit migration
  tooling is fenced, operator-only and regression-tested (18/18 focused recovery/migration tests).
- Expo managed preview now starts with `--tunnel`; `@expo/ngrok` 4.1.3 is installed and Metro reports the tunnel ready.
- Backend `/health` and `/api/health` return HTTP 200; Python lint, TypeScript and ESLint are clean.

## 2026-09-22 correction status from reviewed commit `4c03315`
- **Package 1 P0:** immutable upload/session replay, fenced root publication, abandoned-attempt-only cleanup,
  consumed-observation reconciliation, pending-ledger observation restoration and active-job/work-epoch cancellation
  are implemented and bounded-tested.
- **Package 2 P0:** main Text Gate now starts shared Higgins; Text/Email project one accepted current assessment; File
  transfer ownership begins before I/O and survives navigation; Device appends timestamped rechecks/user reports to
  one case and binds later Patrol events.
- **Package 3 P1:** bounded later-page PDF extraction is implemented as addressable evidence without conflating parser
  extraction with semantic reading. Remaining limit/observation audits stay active.
- **Package 6 P1:** desktop manufacturer/model/form factor, real notification permission, administrator-approved exact
  domain hosts/DNS filtering, block/unblock/status and native-before-fixture host selection are implemented. Packet
  inspection/app attribution remain explicitly unsupported; target-host acceptance remains.
- **Repository hygiene:** 8,240 tracked files under `desktop/src-tauri/target/` were removed from the index and the
  directory is ignored; generated artifacts remain local/outside source tracking.
- **Corrected source identity:** digest `01e4723d48cd34c3129701adebd2947249cb174f94d2ae21a699d30567ea0110`;
  existing Android build `18706c6e...` predates these corrections and is not relabelled.

## 2026-09-22 final deployment health
- Deployment Agent status: **PASS**, zero blockers.
- Readiness-remediated working source SHA-256:
  `b70cdffb4ca7441313c928ec9acc4a946ab7c1b310de55707c6353bc9bdabb10`; preceding saved commit
  `63d60d861104902cfaed0970f9010899ded1f2b3`.
- API process startup performs idempotent initialization only; no retention/investigation/family-audio deletion loop is
  tied to startup or restart.
- Explicit maintenance entry point: `python -m scripts.run_retention_sweep`, reserved for an operator-controlled
  maintenance schedule.
- Repository-wide `.env` ignores were removed for deployment automation; injected local values remain excluded through
  workspace-local Git configuration and were not exposed.
- Verified: backend lint/compile, 25 focused tests, startup cleanup static check, and both health endpoints.

## 2026-09-22 seven-defect correction package
- Package 1/2 P0 now includes control-document evidence publication manifests, checkpoint-revision device-result merge,
  complete application-owned transfer/observation retries, authoritative client cancellation, all Text presenters, and
  bounded exact-host desktop filtering with privileged readback verification.
- Package 3 PDF continuation now preserves later-page links and scanned-page visuals and replays only committed slices.
- Bounded tests prohibit provider calls at both pytest fixture and Higgins provider entry-point boundaries.
- Pre-build source digest: `fe41defb4f0fd0bc6fa85cd0dfb9d9db5412a75445c6be88c4f7d65d694770da`.
- Verification: 56 focused backend tests, TypeScript/ESLint, and 3 Rust native tests pass.
- **Fresh Android candidate:** EAS `047bc183-37e9-447b-b0f8-48012f591550`, source
  `7fd6f9a61d292bdab17700152f7e47e457afc411`, fingerprint
  `565f42d9b04dd39c836360eeccd12c4e442b800f`, APK SHA-256
  `c15804e04597e09628575cc58734bd97fc10c2cbe1f89dd4c1ddae239e102e97`.

## 2026-09-23 review closure
- Closed Gmail disconnected-state, locale-aware Australian callback extraction and `temporary_copy_policy` metadata defects.
- Reconciled the preserved historical 24-failure JUnit artifact; the missing 24th node was
  `TestPatrolEventsGate2::test_upsert_and_list_message_event` (`claimed_brand` contract drift).
- Current provider-disabled backend JUnit is clean: **386 passed, 19 credentialed integrations skipped, 0 failed**.
- Credentialed Gemini/voice/screenshot/public-page/email coverage is explicitly separated behind
  `APOLLO_RUN_CREDENTIALED_INTEGRATION=1`; no managed LLM key or live owner key was used.
- Verification passes: TypeScript, repository ESLint, GuardDog production source **9/9**, frozen manifest **91/91**,
  Android GuardDog/Family Assist Kotlin compilation and desktop `cargo check`.
- Identity: base commit `dac83b072bba9a541dde431b78b8668659625e27`; closure source digest
  `e7ca068ff6a902d4d347760fb7b8dab259f3ea1d081875930590b66961d87c3e`; package remains `app.apollo.hwg`.
- Detailed evidence: `docs/APOLLO_REVIEW_CLOSURE_RECORD.md`.

## Update — Android VPN consent gate in completeSetup (ApolloContext.tsx)
- `completeSetup` now scopes the VPN-consent flow to `Platform.OS === "android"`.
- Flow: read `vpn_config` → if not granted, call `requestProtectionPermission("vpn_config")`
  (→ native `requestGuardDogProductionProtectionPermission`); on `system_ui_opened` poll until
  the user returns; on `launch_failed`/`unsupported` throw.
- A FRESH `getProtectionPermissions()` check is the only gate permitting `startProtection()`
  (→ native `startGuardDogProduction`). Setup/protection are NOT marked complete unless the
  fresh check confirms `vpn_config === "granted"`.
- Native-only: must be validated on an Android dev build (not Expo Go / web preview).

## Update — Declining Android VPN consent no longer disables Apollo (reduced coverage)
- `completeSetup` (ApolloContext.tsx): records protection intent (`apollo.protection.on=true`),
  then `ensureAndroidVpnConsent()` (new, non-throwing helper). On Android it requests `vpn_config`,
  waits for the system consent screen, and detects return promptly via AppState→active (≈4s window)
  with a 120s ceiling. `startGuardDogProduction` (startProtection) is called ONLY when a fresh read
  confirms consent granted. If declined, setup still completes — Apollo is not disabled as a whole.
- `gates.ts`: Site Gate shows `permission_needed` from stored intent (`desiredSiteOn`) even though
  native `requested` only flips true after a successful start. Overview summary reads
  "Protection active — reduced coverage" when Site Gate awaits VPN and other Gates run. Primary
  action label becomes "Grant VPN permission" (id stays `restore_site`).
- `healthCoordinator.ts`: passes `desiredSiteOn` (from `apollo.protection.on`) into the gates overview.
  Existing `decideSiteRecovery` auto-starts once consent lands; declined stays `ask_permission` (no crash).
- `guard.tsx`: Gates summary title mirrors the reduced-coverage wording.
- Tests: tests/gatesOverview.test.ts (+4 cases, 12/12 pass). Native-only flow — validate on an Android dev build.

## Update — Graceful permission handling across all permission/connection Gates
- New `src/domain/gatePermissions.ts`: shared copy/config (what/why/enableLabel/pendingLabel) + ~3-day
  snooze keys for Site, Text, Call, Email; `gateAppliesToPlatform`.
- New `src/domain/gmailConnect.ts`: extracted read-only Gmail OAuth (`connectGmailOAuth`), reused by
  email.tsx and the setup walkthrough.
- New `app/setup-gates.tsx`: after the privacy disclosure, Apollo walks through each applicable Gate
  needing permission/connection one at a time (Enable / Not now), launches the system/OAuth flow,
  verifies the REAL state on return (waitForForeground), and never blocks setup. Declines snooze ~3 days.
  Registered in app/_layout.tsx; privacy-disclosure now routes here after completeSetup.
- `completeSetup` (ApolloContext): no longer requests Android VPN inline (walkthrough owns it); records
  intent and starts protection only on non-Android. Setup never fails on a missing permission.
- `GateNudge` (generalizes old SiteGateNudge; SiteGateNudge.tsx now re-exports it): Home reminder for
  ANY pending Gate (Site/Text/Call/Email), one at a time, respecting the per-gate ~3-day snooze.
- gates.ts + guard.tsx: "Protection active — reduced coverage" now shows whenever ANY permission/
  connection Gate is pending while others run (generalized from Site-only).
- Truthful per-Gate states already existed (Text/Call permission_needed, Email setup_needed) with
  enable-later actions; pendingLabel copy provides "Permission required" / "Not connected" wording.
- Tests: tests/gatesOverview.test.ts 13/13 pass (added non-Site reduced-coverage case).
- NATIVE-ONLY: VPN/notification/call-role flows can't run in Expo Go or the web preview (web fails
  closed). Validate the walkthrough end-to-end on an Android dev build.

## Fix — Android VPN consent now waits for the user's real response (device bug)
- Root cause: VPN consent was fire-and-forget (startActivity) + JS polling with a 4s "shrink on first
  active" window. A transient AppState=active (or the consent screen not backgrounding fast enough)
  ended the wait BEFORE the user tapped Allow → Site Gate reported "needs VPN permission" even when
  the user intended to grant.
- Native (ApolloSecurityModule.kt): `requestGuardDogProductionProtectionPermission("vpn_config")` now
  accepts a Promise and launches the consent intent via `activity.startActivityForResult(VPN_REQUEST_CODE)`
  (no FLAG_ACTIVITY_NEW_TASK). A new `OnActivityResult` handler resolves the Promise ONLY when the user
  responds, returning requestState "granted"/"denied" (VpnService.prepare==null = granted). Also returns
  "launch_failed" when no current Activity. Added `Promise` import + `vpnConsentPromise` + VPN_REQUEST_CODE.
- JS (ApolloContext.ensureAndroidVpnConsent): treats native "granted"/"already_granted" as true and
  "denied"/"launch_failed"/"unsupported"/"cancelled" as false. Legacy "system_ui_opened" fallback now
  waits for a genuine background→active return (no premature bail) then settles.
- setup-gates.tsx & CoverageCard.tsx `waitForForeground` (text/call settings): only start the short
  grace window after a real background→active return; 8s no-show safety only if the screen never opened.
- Type: added "granted"/"denied"/"cancelled" to ProtectionPermission.requestState.
- Stage1B SHA256 manifest unaffected (covers guarddog-android-sdk/ only, not modules/apollo-security/).
- REQUIRES A NATIVE ANDROID REBUILD to take effect (native module changed).

## Fix — Call Gate role request now shows the dialog & waits for response (device bug)
- Root cause (same class as VPN): Android call-screening role was launched with startActivity +
  FLAG_ACTIVITY_NEW_TASK, which does NOT show RoleManager's role dialog and can't deliver a result.
- Native (ApolloSecurityModule.kt): `requestCallScreeningRole` is now Promise-based and launches
  `createRequestRoleIntent(ROLE_CALL_SCREENING)` via `startActivityForResult(CALL_ROLE_REQUEST_CODE)`
  (no NEW_TASK). OnActivityResult resolves `{opened:true, held:<isRoleHeld>}` after the user responds.
  Returns `{opened:false, held}` when unavailable/already-held/no-activity.
- JS: callSdk type adds `held?`. call-guard/setup-gates/CoverageCard use `r.held` as authoritative
  (fall back to waitForForeground for legacy builds). call-guard shows "Call screening is on" on held.
- iOS unchanged and already consistent: opens Settings + verifies CXCallDirectory state on return.
- Cross-platform note: all graceful-permission/reduced-coverage/nudge/coverage-card/setup-walkthrough
  behavior is platform-agnostic JS; the native for-result fix is Android-only because the bug was.
- REQUIRES A NATIVE ANDROID REBUILD (native module changed).

## Feature — Multiple Gmail accounts (Email Gate)
- Also fixed: Google "Error 403 access_denied" is a Cloud Console setting (OAuth consent screen in
  Testing mode) — user adds Gmail addresses as Test Users (or publishes/ verifies the app). Not a code bug.
- Backend gmail_connections now stores ONE ROW PER (device_id, email). server.py drops the legacy
  unique index on device_id, backfills email="", and creates a compound unique (device_id, email) index.
- services/gmail.py: save_connection(device_id, refresh, email) + fetch_profile_email; get_connections();
  get_connection(device_id, email?); disconnect(device_id, email?) (one or all); _access_token_for(device_id, email?);
  scan_inbox aggregates the first page of EVERY connected account (items tagged with `account`);
  scan_inbox_page/download_attachment accept optional email.
- routers/gmail.py: callback fetches the account email and saves per-account; /gmail/status returns
  `accounts: [{email, monitoring_enabled, monitor_state,...}]` (plus back-compat single fields);
  /gmail/monitoring is device-wide (update_many — monitor all together); DELETE /gmail/connection
  accepts optional ?email to remove one account, omitted = all.
- services/mailbox_monitor.py: scan_gmail_through_shared_pipeline(device_id, mode, email?) leases &
  scans per (device,email); the enabled-mailbox loop passes each account's email.
- Frontend app/email.tsx: lists connected accounts with per-account Disconnect, "Connect another
  account", "Disconnect all", and device-wide monitoring/scan across all accounts.
- Validated service-layer multi-account (store 2, per-account + all disconnect) PASS. HTTP endpoints are
  device-credential protected; OAuth connect needs the Google test-user/verification fix + a device to
  test end-to-end. Native build not required (JS+backend only).

## Bug fix — Network Gate: no option to set as Home (2026-06)
- Report: "Network gate not active. There also is no option to set as home network." (screenshot showed
  N02 "Wi-Fi you haven't classified" result card whose recommendation says "Pick a context above" — but
  the home/work/public context chips only rendered in the pre-check view, never in the result view).
- Fix (app/network.tsx): the "Where are you?" context chips are now ALWAYS visible (moved above the
  result/actions block). Tapping a chip calls pickContext(), which re-runs analysis live reusing the same
  Patrol event id (no event spam). Classifying as Home/Work/Trusted yields N01 "resting" and quietly
  resolves the earlier active N02 network item via upsertEvent(status:"resolved").
- "Protection off / Unknown" on the dashboard is the connection/VPN protection state (reduced-coverage when
  VPN consent declined) — a native-build + permission matter, not a code bug. "Check this network" works
  regardless of that state.
- NOTE: Network Gate is native-only; web preview is hard-gated ("GuardDog production authority can be
  selected only in a production build"), so this must be verified on the user's Android build.

## Bug fix (part 2) — Network Gate should be ON and monitoring independent of the VPN (2026-06)
- User pushback: "I should be on and monitoring especially when network changes." The Network Gate showed
  "Protection off / Unknown" because it was reading the Website-Gate VPN status, and the Android production
  runtime never reports a `connection_guard` capability (only `site_guard`).
- Root cause: (a) ApolloContext.refresh() only raised Connection-Guard events when the VPN was running
  (`status.running` gate on line ~284); (b) network.tsx dashboard headline/pill derived from the VPN
  `protection` object + absent connection_guard capability; (c) gates.ts marked Network "running" only when
  `vpnActive`, else "not_activated".
- Fixes:
  - ApolloContext.tsx: removed the `status.running` gate — assessConnection() runs on the OS network snapshot
    (needs no VPN) and raises one deduped event per distinct unsafe condition (open/WEP Wi-Fi, captive portal)
    on every foreground/periodic/network-change refresh.
  - app/network.tsx: dashboard now reflects the Network Gate's own live monitoring — "Monitoring this
    connection" / Active when there is a current connected reading; honest detail: re-checks on every app
    open and network change; reads connection type, Wi-Fi security, captive-portal flags only.
  - src/domain/gates.ts: Network Gate = "running" (Watching) whenever connected + inspectable (or VPN on).
    Honest limitation when VPN off: "Apollo checks the connection on every app open and network change. Turn
    on Site Gate for continuous background watching." permission_needed only when platform withholds net info.
- Truthfulness preserved: foreground watching is real; continuous *background* observation still needs Site
  Gate's VPN and is disclosed, never claimed otherwise.
- Tests: tests/gatesOverview.test.ts +3 cases (16/16 pass). tsc + eslint clean on all three files.
- Native-only screen; verify on the user's Android production build (web preview is hard-gated).

## Bug fix — Account Gate wrongly showed "Status unavailable" (2026-06)
- Report: Account Gate card read "Status unavailable" / "Breach lookup is currently unavailable" even
  though its core "Check an account alert" action works fully.
- Root cause: gates.ts set accountAuto.state = "temporarily_unavailable" whenever
  accountBreachConfigured !== true (backend /account/status → breach_lookup_configured = bool(HIBP_API_KEY),
  and HIBP_API_KEY is unset). presentation() maps temporarily_unavailable → "Status unavailable" (tone
  unavailable), making a working, on-demand gate look broken.
- Fix (gates.ts): the optional live breach-list lookup (HIBP) no longer gates the whole Account Gate.
  When configured → event_driven "running" ("Watching"). When NOT configured → automatic = undefined so it
  falls through to onDemand "ready" → "Ready when you need it" (neutral), with currentHelp: "You can check a
  login, breach or recovery alert anytime. Live breach-list lookup isn't set up, but alert analysis still works."
- Tests: updated the two Account-Gate cases in tests/gatesOverview.test.ts to assert "Ready when you need it"
  (16/16 pass). eslint + tsc clean.
- To actually enable the live breach lookup, the user must provide a HIBP_API_KEY in backend/.env.

## Bug fix — Device Gate false "Action required / high-risk" + unhelpful findings (2026-06)
- Report (multiple screenshots): Device Gate barked "Barking / Action required / 1 high-risk item" for a
  benign device-admin ("Device management profile — High risk"), listed benign Google/Samsung system apps
  under notification access, and findings didn't explain consequences or a concrete action. User: "This is
  legitimate... does not explain consequences and action to take."
- Root causes:
  1. Native AppDeviceSignals.kt set managementProfile = admins.isNotEmpty() ? "present" : "none" — ANY active
     device-admin (Find My Device, Samsung Find My Mobile, Play Protect) became "present", which
     deviceAnalysis.ts D02 flagged severity:"high" → barking. False positive on virtually every consumer phone.
  2. notification/accessibility lists only filtered Apollo's own package, so OS/OEM components (gms,
     gearhead, ringplugin, launcher, smartmirroring) showed as noise.
- Fixes:
  - Native AppDeviceSignals.kt: classify managementProfile = "managed" (device-owner/profile-owner via
    DevicePolicyManager.isDeviceOwnerApp/isProfileOwnerApp), else "device_admin" (ordinary admin), else
    "none"/"unknown". Added managementAdmins[] (friendly labels via KNOWN_ADMINS + PackageManager).
  - Native AppDeviceCatalog.kt: thirdPartyServices(setting, own, pm?) now drops first-party system packages
    (FLAG_SYSTEM when visible, else vendor-prefix fallback: com.google.android./com.android./com.samsung./
    com.sec./OEM prefixes). Added KNOWN_ADMINS map. (Aligns the existing JVM test.)
  - deviceAnalysis.ts: DeviceSignals.managementProfile union now "none"|"device_admin"|"managed"|"present"|
    "unknown" + optional managementAdmins. "managed"/"present" (incl. iOS) → high when unexpected, info when
    expected. Ordinary "device_admin" → benign INFO finding D02b that NAMES the apps and explains the
    consequence ("can lock your screen, reset your passcode or erase the phone — powerful but normal…") and a
    concrete action ("open Device admin apps, tap it to see what it controls, then turn it off"). User can
    still escalate via the "unexpected profile" self-report → high.
- Tests: tests/gate7.test.ts +3 cases (44 pass); gatesOverview 16 pass; fileDeviceGateUi pass; tsc+eslint clean.
- Native-only: verify on the user's Android production build after redeploy + rebuild.

## UX Refinement Package UX-01…UX-16 (2026-06) — presentation/wording/hierarchy only
No architecture, infrastructure, security behaviour, routes, Gate types or product scope changed.
- UX-01 Gate wording: gates.ts presentation() now maps running→ enforcement:"Protection on" / monitoring:"Watching" / event_driven:"Ready automatically" (new user-facing label added to GateStatusLabel union; no new capability type). Home GateRow replaced the blanket "Auto" badge with compact capability-derived labels: On / Watching / Ready / Needs you / Off / Checking / Unavailable.
- UX-02 Home hierarchy: ApolloHero now shows a prominent primary action Button (testID hero-primary-action) when state is a warning and a corrective route exists; Hear Higgins stays below as secondary. Calm states keep Hear Higgins prominence.
- UX-03 dedup: Home suppresses GateNudge when the hero is already naming attention Gates (heroNamingAttention); CoverageCard + Gates Protection list remain as secondary coverage below the hero; HigginsFollowUp unchanged (distinct follow-up).
- UX-04 background copy: "Guarding in the background — minimise to save battery." → "Apollo continues protecting in the background." Minimise control retained as secondary ghost button.
- UX-05 Check It intro: "These checks start only when you tap one." → "These are checks you start yourself. Apollo may also protect or watch automatically where supported."
- UX-06 Patrol summary: new patrolConsumerSummary() + ListHeaderComponent at top of Patrol: "Nothing needs you right now" / "N thing(s) need you" / "Apollo is checking N concern(s)". Header "{n} outcomes" pill kept as secondary.
- UX-07 Patrol empty: removed engineering explanation. Now "No Patrol activity yet." (all) / "Nothing here currently needs your attention." (filtered).
- UX-08 Filters: unchanged (All activity / Needs you / Warnings / Threats stopped / Resolved).
- UX-09 Patrol cards: PatrolItem adds a "Needs you" pill (from matchesPatrolFilter) and shows primaryAction.label as the footer hint when present — existing fields only.
- UX-10 Higgins hub reorder: Ask Higgins → Current investigations → Recent activity → reference grid [New scams, Learn, Saved reports] → History.
- UX-11 "Ordinary chat" removed from user-facing: header pill "Ask Higgins", hub card "Ask Higgins", "Return to ordinary chat"→"Back to chat", empty/disclaimer/error copy reworded. Internal investigationMode var unchanged.
- UX-12 technical wording: "Retry server deletion"→"Try deleting again"; "Investigation answer complete within its stated scope"→"Higgins has finished this investigation." Scope/uncertainty still shown in supporting disclaimer + investigation details.
- UX-13 roles: no Higgins copy claims Apollo actions — no change needed.
- UX-14 vocabulary: plain-English result strings retained; Growling/Barking only used as Apollo character language in educational Q&A, never as instructions — no change needed.
- UX-15 Biting: hero still reuses barking GIF but accessibility label already "Apollo biting after a confirmed block" and biting only resolves with verified_block — animation never presented as proof; unchanged.
- UX-16 reduced motion: ApolloHero now reads AccessibilityInfo reduce-motion and routes it through the existing animate-disable path (motionOn) — no new a11y subsystem. (Previously only manual battery-saver lowPower existed.)
- Tests: gatesOverview 19, phase2Patrol 4 (incl. new patrolConsumerSummary + link-gate "Ready automatically" + account label change). Full gate/higgins suites pass; eslint + tsc clean.
- NOTE: web preview is hard-gated (GuardDog production authority only in a production build) so UI cannot be smoke-tested here; verify on a production build.

## Feature — App Gate: pick from a list of installed apps (2026-06)
- Request: "When checking an app should be able to pick from a list of installed apps."
- Implementation (Android only; iOS can't enumerate apps, falls back to manual entry):
  - AndroidManifest (apollo-security): added a <queries><intent> MAIN/LAUNCHER block so Apollo can list
    launchable user apps WITHOUT QUERY_ALL_PACKAGES (keeps the app's no-broad-visibility stance).
  - Native AppDeviceSignals.installedLaunchableAppsJson(): queryIntentActivities(MAIN/LAUNCHER) → sorted
    [{packageId, appName}], excludes Apollo itself. Registered AsyncFunction("listInstalledApps").
  - appDeviceSdk.listInstalledApps() + InstalledAppRef type; nativeBridge method added.
  - app-check.tsx: "Pick from installed apps" button (Android) opens a searchable Sheet (app-picker-sheet)
    listing installed apps; selecting one fills the name AND stores the packageId, which is passed to
    getInstalledAppAssessment(pickedPackage) so Apollo reads real install source + permissions for the
    chosen app (the launcher <queries> now makes getPackageInfo resolve). Manual typing still works and
    clears any picked package. Scope copy updated for Android.
- tsc + eslint clean. Pre-existing adapterContract.test.ts failures (getCapabilities / AndroidSecurityAdapter
  / dns:udp-53) are unrelated and were present before this change (verified by stash).
- Native-only: requires a production Android build; web preview is hard-gated and Expo Go returns an empty
  list (handled with a "needs a production Android build" message in the picker).
- PENDING (from the prior message, not yet actioned): recognise Apollo's own VPN so the Network Gate doesn't
  ask the user to "confirm you recognise the VPN service"; recognise Apollo-caused device changes; add a
  security/privacy/protection setting-change log with date-time attributing Apollo-caused changes.

## Feature — Call/Text pickers + SMS/email data-handling rule (2026-06)
User decisions: Call Gate number from recent calls (READ_CALL_LOG), number-first; Text Gate pick via Share
AND inbox (READ_SMS); same privacy rule for email. User accepts the Play-restricted permissions.
- Native (apollo-security): new PhonePickers.kt reads CallLog.Calls (recent, de-duped) and Telephony.Sms.Inbox
  (incoming only) on demand, returning [] when the permission isn't held (never throws). Module adds
  hasRuntimePermission/requestRuntimePermission (maps call_log→READ_CALL_LOG, sms→READ_SMS via
  Activity.requestPermissions) + listRecentCalls/listRecentSms. Manifest: added READ_CALL_LOG, READ_SMS.
- JS: src/security/phonePickers.ts (PhonePickers SDK, isSupported=android+native). New shared
  src/components/PhonePickerSheet.tsx implements the permission contract (contextual explain → request →
  poll grant → Open Settings on denial) and a searchable list; Android-only, else "needs production build".
- Call Gate (app/call.tsx): number-first "Who called?" card with "Pick a recent caller" → fills number.
- Text Gate (app/message.tsx): "Pick a text from your inbox" (incoming only) + Share-from-Messages already
  supported via shareIntake. Privacy copy rewritten to the rule: reads incoming only, assesses once,
  discards raw, keeps only if flagged until dismissed.
- Email Gate (app/email.tsx): policy copy rewritten to the same rule. Backend already compliant — stores
  only hashed mailbox_assessment_receipts + flagged outcomes, never raw bodies (services/mailbox_monitor.py).
- tsc + eslint clean. Native-only; requires a production Android build (web preview hard-gated; Expo Go
  returns empty lists, handled gracefully). READ_CALL_LOG/READ_SMS are Play-restricted — user accepted.
- Earlier same session: App Gate "pick from installed apps" (listInstalledApps, launcher <queries>).
- STILL PENDING (older message): recognise Apollo's own VPN in Network Gate; recognise Apollo-caused device
  changes; dated security/privacy/protection setting-change log attributing Apollo-caused changes.

## Next-steps batch (2026-06) — VPN recognition, Call Guard move, device change log, easy dismiss
- Apollo's own VPN recognised (networkAnalysis.ts): new input apolloVpn; new scenario N11 "Apollo's own
  protection VPN" (resting) takes priority over N09/N10 so the Network Gate never asks the user to confirm
  Apollo's own Site Gate tunnel. network.tsx passes apolloVpn = protection.running === true. connection.ts
  never flagged VPNs (no change). Test: gate8 N11 (34 pass).
- Call Guard "Automatically check incoming numbers" MOVED from Settings → Call Gate (app/call.tsx): toggle +
  disclosure card at top of the pre-result view, bound to storage apollo.call.auto_check. Removed the
  Settings Call Guard section. Defaulted ON during onboarding: ApolloContext.completeSetup seeds
  apollo.call.auto_check="true" when never set (so a later user choice is preserved).
- Device security-settings change log + Apollo attribution:
  - deviceAnalysis.ts: DeviceSecurityChange gains attributedTo ("apollo" | "user_or_unknown");
    deriveDeviceSecurityChanges takes apolloVpnActive — a VPN that turns on while Apollo's protection is
    running is attributed to "apollo" and downgraded to low_risk (not flagged). Added DEVICE_CHANGE_LABEL.
  - app/device.tsx: persists a dated log (apollo.device.changelog.v1, newest-first, cap 50) and renders a
    "Recent security setting changes" card with date-time + an "Apollo"/"Review" tag per entry. Passes
    protection.running as apolloVpnActive.
- Easy dismiss for flagged items (PatrolItem.tsx): flagged ("Needs you") list cards now show a one-tap
  "Dismiss" that calls resolveEvent without opening the detail (detail already had Mark as handled/contained).
- tsc + eslint clean. Suites: gate5/6/7/8, gatesOverview, phase2Patrol all pass.
- Native-only pieces (call/SMS pickers, VPN/device signals) still require a production Android build to test;
  web preview hard-gated. READ_CALL_LOG/READ_SMS are Play-restricted (user accepted).

## Nav + Check It/Gates separation, Change Log Detail, Trusted Callers (2026-06)
- Navigation reorder (app/(tabs)/_layout.tsx): tab order is now Home → Higgins → Check It → Gates → Patrol
  (both the iOS-26 NativeTabs and the standard Tabs blocks). Gates sits directly after Check It, before Patrol.
- Gates = passive status (app/(tabs)/guard.tsx): each gate still shows purpose ("What this Gate helps with"),
  status pill, current help, and attention alert. The primaryAction button now renders ONLY when
  tone === "attention" (a required corrective action, e.g. Restore protection) — the check_* diagnostic
  buttons no longer appear on non-attention gates (those belong to Check It). Intro now says "To check
  something yourself, use Check It." No check/test/scan/diagnostic controls remain on Gates. Enforcement and
  evidence rules unchanged.
- Check It unchanged (already manual-only).
- Change Log Detail (app/device.tsx): change-log rows are now Pressable; tapping opens the matching settings
  screen (openChange maps vpn_change→vpn, profile_change→security, service_enabled→accessibility, else apps;
  web shows guidance text) to confirm the change.
- Trusted Callers: new src/domain/trustedCallers.ts (AsyncStorage key apollo.call.trusted.v1, matches on last
  10 digits). PhonePickerSheet caller rows have a Trust/Trusted toggle. ApolloContext auto-check poll now
  skips trusted numbers (acknowledges from queue, no assessment/event) so Apollo stays quiet for them.
- tsc + eslint clean; gatesOverview/gate8/phase2Patrol pass. Native-only pieces need a production Android build.

## Trusted callers/senders mgmt + change-log filter (2026-06)
- Manage Trusted Callers (app/call.tsx): a "Trusted numbers" card lists trusted numbers with Remove
  (untrustCaller), refreshes after the picker closes. getTrustedCallers/untrustCaller from trustedCallers.ts.
- Change Log Filters (app/device.tsx): the change-log card has All / Review-only buttons; Review-only hides
  "Apollo"-attributed entries; empty state "No changes need review."
- Trusted Senders (src/components/PhonePickerSheet.tsx + ApolloContext): SMS picker rows show a Trust/Trusted
  toggle (numeric senders, reusing trustedCallers store). The JS Text-Guard background assess loop now skips
  trusted senders (acknowledge, no assessment/Patrol item) so Apollo stays quiet for them.
- tsc + eslint clean.
## PENDING (large, deferred to a focused session): Higgins First Check + Re-check malware/compromise
  baseline (onboarding step 3, capability-based FirstCheckCapability, result model
  CLEAR/ATTENTION/HIGH_RISK/CONFIRMED_THREAT/LIMITED/NOT_AVAILABLE/ERROR, per-platform adapters reusing
  Diagnostic Core + device signals, Check-tab "Higgins Re-check", Checkup history, full test matrix). Spec
  captured in this message; not yet implemented.

## Device Gate — Phase 3 (native collectors extended) — DONE (2026-06)
Extended each platform's native collector to read two more signals the OS legitimately exposes to a normal
app (no new permissions), and wired them into the registry-driven review engine (src/domain/deviceReview.ts):
- New DeviceSignals field `screenLockSecure: boolean | null` (deviceAnalysis.ts, EMPTY_SIGNALS).
  - Android: KeyguardManager.isDeviceSecure() (AppDeviceSignals.kt).
  - iOS: LAContext.canEvaluatePolicy(.deviceOwnerAuthentication) = a passcode is set (DeviceSignalsTruth.swift,
    ApolloSecurityModule.swift). Windows/macOS → null → stays Manual.
  - `lock` check now returns Checked (secure) / Action required (no lock) / Manual (unreadable).
  - iOS `encryption` check now returns Checked when a passcode is set (iOS encrypts automatically), Action when
    none, Manual when unreadable.
- Android `userTrustedCertificates` now populated via the AndroidCAStore keystore ("user:" aliases) instead of
  always null, so the `certificates` check reports real extra user-trusted CAs on Android.
Truth rules preserved: anything the build can't read stays null → Manual/Unavailable, never a false Checked.
Tests: deviceReview.test.ts (+ screen-lock & iOS-encryption cases), DeviceSignalsTruthTests.swift updated. Full
TS/Node suite green. Also fixed the last legacy failure: package6Source.test.ts now loads app.config.js (there
is no app.json), matching iosSourceReadiness.test.ts.
NOTE: native reads (KeyguardManager / LAContext / AndroidCAStore) only verify on a real Android/iOS build — the
web preview shows the Safe Start build-gate and cannot exercise them.

## Device Gate — Desktop collectors read firewall + OS updates directly — DONE (2026-06)
Windows/macOS desktop host (Tauri) now observes two more review signals directly instead of leaving them Manual:
- New Rust command `security_audit` (desktop/src-tauri/src/lib.rs) returns `{ firewallEnabled, firewallDetail,
  updatesCurrent, updatesDetail }`:
  - Windows firewall via `netsh advfirewall show allprofiles state` (ON for every profile → on); updates via the
    Windows Update Agent searcher (0 pending → current).
  - macOS firewall via `/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate`; updates via
    `softwareupdate -l --no-scan` ("No new software available." → current).
  - Linux/other → all null (not_implemented) so the crate still compiles. Registered in generate_handler!.
- DeviceSignals gained `firewallEnabled` and `osUpdatesCurrent` (deviceAnalysis.ts, EMPTY_SIGNALS).
- DesktopSecurityAdapter.getDeviceSecuritySignals() (new, optional on SecurityPlatformAdapter) invokes
  `security_audit` + `network_status` and maps them into DeviceSignals (vpnActive, firewallEnabled, osUpdatesCurrent).
- device.tsx now detects a desktop host (desktopHostKind) → runs the review as "windows"/"macos" and collects
  signals from the desktop adapter instead of the mobile AppDeviceSdk.
- deviceReview.ts: `firewall` → Checked/Action/Manual from firewallEnabled; `os_updates` (windows/macos) →
  Checked/Review/Manual from osUpdatesCurrent (mobile stays Manual — not readable there).
Tests: deviceReview.test.ts (firewall + OS-update desktop cases). Full TS/Node suite green, tsc + lint clean.
NOTE: the native reads only verify on a real Windows/macOS desktop build; cargo check here stops at a system
GTK/pkg-config dependency (container limitation), not a code error.

## About Apollo popup + Higgins headshot + Desktop antivirus/settings-jump + Preview boot — DONE (2026-06)
- About Apollo: new scrollable popup `src/components/AboutApolloSheet.tsx`, opened from Settings → Help & about →
  "About Apollo" (replaced the old static text block). Uses the supplied Higgins+Apollo photos
  (assets/images/higgins-apollo-full.png hero, higgins-apollo-portrait.png in Meet Higgins) and the full approved
  copy (10 Gates chips, Scam Alerts, Meet Higgins, Your Privacy & Data, Free Forever, Harmony Wellness Group).
- Higgins headshot (assets/images/higgins-headshot.png): now shown on the "Hear Higgins" button
  (src/components/HigginsSpeakButton.tsx), the Higgins chat header + message avatars (app/(tabs)/ask.tsx), and the
  About Apollo "Meet Higgins" section. NOTE: after adding new image assets, Metro needed a cache clear
  (rm -rf .metro-cache/* then restart expo) or the images render as blank circles.
- Desktop antivirus: security_audit (lib.rs) now also reads Windows antivirus via Security Center2 productState
  (macOS/Linux → null, stays manual). DeviceSignals.antivirusEnabled + deviceReview `antivirus` evaluator (Windows
  Checked/Action; mac/android Manual).
- Desktop "Open Settings" jump: lib.rs open_settings_target gained "firewall" and "updates" targets (Win:
  ms-settings:windowsdefender / ms-settings:windowsupdate; mac: Network / Software-Update settings). device.tsx
  openCheck now calls openDesktopSettings(desktopReviewTarget(id)) on a desktop host and the button reads "Open
  Settings" there.
- PREVIEW BOOT: the app is hard-gated to only boot in a production config ("no mocks in runtime"); dev/staging show
  SafeStartScreen. To let the in-container web/Expo-Go preview run for UX/content review, frontend/.env now sets
  EXPO_PUBLIC_APP_ENV=production and EXPO_PUBLIC_DEVICE_PREVIEW_HARNESS=off. On web this uses the honest browser
  adapter (reports "no native protection"), so no fake protection is shown. The simulated-device harness is off.
  securityConfig/boot unit tests are unchanged (they test the function, not .env). Verified: onboarding → setup →
  Home/Gates/Higgins all render in the preview.

## QUEUED (large, not yet started) — two product briefs received, to be done one at a time:
1. Global Scam Early Warnings + Higgins "growling" alerts (AU/US/UK/EU sources, severity LOW/MODERATE/HIGH/EXTREME,
   Australian-relevance, Home section, scams.tsx filters, growling push, Higgins explanations). Extend existing
   government_alerts/learning_feeds/context_tools/ask.py/push.py + home.tsx/ask.tsx/scams.tsx/hubClient.ts.
2. Privacy, Data Storage, Retention & Deletion corrections (authoritative inventory, retention rules, Clear Patrol
   + "Delete My Apollo Data" device-scoped deletion, per-Gate privacy audit, Settings → Privacy & Data screen,
   onboarding/About consistency, honest deletion-state messaging, tests).

## Global Scam Early Warnings (#1) — FOUNDATION DONE (2026-06)
- NEW backend/services/scam_intel.py (pure, tested): region_for, classify_severity (LOW/MODERATE/HIGH/EXTREME,
  evidence/keyword rules — NOT AI; official_advice & tips stay LOW; alarming words alone never reach EXTREME),
  australian_relevance (confirmed/potential/overseas_only/unknown), is_growling (HIGH|EXTREME + confirmed|potential),
  is_fresh_advisory (<=21d), higgins_explanation (structured AU-English, never claims a personal attack), enrich().
- government_alerts.snapshot() now attaches region/severity/sourceSeverity/australianRelevance/higgins + a top-level
  `growling` advisory (freshest eligible). Coverage string updated (AU/US/UK/EU).
- International sources+feeds added to content/learning_catalogue_au.json (FTC, FBI/IC3, Europol, ENISA, NCSC UK)
  with country/region; import_package persists country/region. NEW learning.seed_catalogue_sources_feeds() runs on
  startup (idempotent, sources+feeds only) — server.py wired. 9 sources / 7 feeds configured & verified.
- context_tools.scams: fixed published_at→publishedAt bug; now returns region/severity/australianRelevance.
- tests/test_scam_intel.py (9) pass; updated test_phase2_remediation allowlist to the per-source invariant.
- Frontend: hubClient GovernmentAlert extended (region/severity/relevance/growling/higgins); app/higgins/scams.tsx
  rebuilt with filters (All/Australia/Global/USA/UK/Europe/High/Extreme), severity+region+AU-relevance pills,
  expandable Higgins explanation, growling highlight, "Ask Higgins about this".
- DEFERRED in #1: server-side push delivery of growling advisories (localAlerts already titles "Apollo is growling"
  for growling/ears_up; a server trigger for new HIGH/EXTREME advisories is not yet wired), ask.tsx consuming the
  scamTitle/scamSource params as bounded Higgins context, and live-feed availability verification (feeds will show
  unavailable/stale honestly until reachable).

## Navigation + Scams tab (#2) — DONE (2026-06)
- app/(tabs)/_layout.tsx: tabs are now Home · Higgins · Check It · Scams · Patrol (NativeTabs + Tabs). Gates tab
  removed; guard kept as href:null hidden tab for compatibility. Scams icon = ExclamationTriangle / sf
  exclamationmark.triangle.fill. Tab label is "Scams" (screen title stays "Scam Alerts").
- Gates moved to /gates stack route (app/gates.tsx re-exports (tabs)/guard; registered in app/_layout.tsx). guard.tsx
  shows a ChildScreenHeader (back) when rendered under /gates (useSegments) else the RootScreenHeader tab header.
  Legacy /(tabs)/guard still resolves.
- app/(tabs)/scams.tsx re-exports higgins/scams; that screen picks RootScreenHeader when under (tabs) else
  ChildScreenHeader.
- Check It: "View Gates" card added at top (→/gates). Settings: Protection & permissions now a single "View Gates"
  row (→/gates); removed the duplicate Website-protection shortcut + Site Gate status panel + in-settings activation
  (VPN activation still lives on the Gates screen). Removed now-unused useProtectionHealth/enableSiteProtection.
- Home: NEW src/components/HomeScamAlerts.tsx compact section (top 3, growling first, severity+region, "View all
  scam alerts"→/(tabs)/scams), separate from Gate coverage.
- appDestination ApolloRoute += "/gates","/(tabs)/scams". Tests updated: phase2Navigation + iosSourceReadiness parity.
  Full TS/Node suite green, tsc+lint clean. Verified in preview: tab bar + Scams screen render.

## Privacy & Data / Deletion (#3) — NOT STARTED (next session; large standalone spec)

## Home — eliminate repetition + honest findings (P0 brief) — DONE (2026-06)
- ApolloHero no longer embeds the specific incident (removed the problemBox showing attention[0].title/problem/
  higgins). The hero now shows only Apollo's OVERALL state + honest reason + a single "See what needs attention"
  action. The specific incident(s) live solely in the "Needs your attention" section → no duplicate presentation.
- home.tsx: Recent Patrol now EXCLUDES event ids already surfaced in "Needs your attention" (attentionEventIds)
  so history doesn't echo the active alert. Removed the "This week" weekly digest card from Home (reduced scroll +
  removed a Pressable>Card that was a likely nested-button source). Dropped now-unused imports (Sparkles,
  ChevronRight, buildWeeklyDigest).
- Attention gate routes updated to /gates (was /(tabs)/guard).
- Earlier backend fix already maps raw states (ears_up→"something worth a closer look") so no internal status leaks.
- Verified in preview: hero shows "Apollo is growling / Protection is unavailable or unverified." + "See what needs
  attention"; no runtime error banner; Scam Alerts section renders a HIGH AU growling item. Full TS/Node suite,
  tsc, lint all green.
- NOTE: the exact "nested <button>" React error could not be reproduced in the current state; the structural
  simplifications remove the most likely causes. If it recurs in a specific state, capture that state to pinpoint.

## STILL QUEUED (large, not started) — in requested order:
1. Privacy & Data / Deletion (settings screen, Delete My Apollo Data, retention, verified deletion).
2. Growling Push (server push for new HIGH/EXTREME scam advisories, deep-link to the alert).
3. Ask Higgins Link (carry scamTitle/scamSource into Higgins chat context).
4. Live Feed Check (verify/adjust overseas source feed URLs).
5. Social Media & Messaging Scam Protection (reuse Internet Gate + add "Scam Check" in Check tab + Share to Apollo;
   NO new Gate/infra).
