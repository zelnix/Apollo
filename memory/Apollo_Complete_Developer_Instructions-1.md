# Apollo — complete developer implementation instructions

**Issued:** 21 September 2026. **Revised:** 21 September 2026 — developer scenario testing stopped at owner direction. **Assignment:** finish implementation and installable delivery across all ten Gates on Android, iOS/iPadOS, Windows and macOS. Preserve the saved-source review at `2983492`; this revision changes work allocation, not the review findings.

**Controlling instruction — stop developer scenario testing:** Do not run live Gemini scenario suites, Playwright/browser journeys, automated end-to-end scenarios, device scenario campaigns or testing/grading agents. Do not spend the current development sessions creating missing scenario scripts, expanding the US01–US35 runner or producing new scenario reports. Preserve the existing scripts and catalogue for later use. Scenario execution is reserved for the owner’s real-device evaluation and is not a condition of developer implementation completion or build delivery. Resume developer scenario work only on an explicit later owner request.

**Developer quality checks remain bounded:** compile/build, type checks, lint and focused local checks directly needed for changed code or a concrete defect are allowed. Basic launch checks establish that a build opens; they must not expand into an acceptance campaign. Do not replace scenario work with repeated full-suite runs, paid provider probes or test-framework construction. Development now means complete the feature, fix known defects, package it and hand it over.

**Owner scope correction — takes precedence:** Windows and macOS are required product targets, including real applicable native detection/protection integration, not optional future backlog. Phones, tablets, PCs and laptops are in scope on their relevant operating systems. An inactive mock is still prohibited application-runtime code. This revision supersedes contrary platform-backlog wording in previous handoffs and in the companion `Apollo_Saved_Source_Review_59725fc.md`; that review's R01–R10 corrections remain required. This updates the specification, not the application's implementation status.

**Reviewed source:** `2983492e9a1fa94b2675a0cc28ea11e071c9337b` in `zelnix/Apollo`, saved 21 September 2026 at 07:58:53 UTC. Compared with previous review `59725fc093c46b1e8bfac1196ea95ee9a004ab15`; the original package baseline was `8e1412d72214f9c5a878688dacc65457818617b4`. Preserve the useful implementation now present. This document is the consolidated specification and current source assessment; historical findings are not automatically current defects or automatically closed.

**Execution authority:** proceed without routine approval requests. Implement the remaining functionality, fix discovered regressions, produce installable builds and continue independent work when a specific integration lacks credentials. Do not invoke a testing agent. The developer no longer owns scenario execution, scenario-script expansion or a full scenario matrix as a delivery gate.

**Current delivery direction:** prepare a normal Android test build for the Pixel 10, advance an iPhone/iPad build alongside it, and keep Windows/macOS implementation in scope. The owner will assess real-life behavior on installed devices. Do not revive the old controlled-endpoint/signing-bundle Stage 1D acceptance plan as an installation prerequisite. A production-default engine cutover is not implied.

**Preserved boundaries:** frozen `frontend/packages/guarddog-*` source stays unchanged. Preserve working detection and valid P0 fixes; implement missing host/adapters in Apollo-owned code. Report actual outcomes and fix defects discovered on devices. Honest action reporting is product behavior to assess during those scenarios, not another approval or installation gate.

## 🏛️ System Architecture & Data Flow

### 0. Saved-source assessment and delivery priorities

**Review method:** read-only source and saved-report review at the SHA above, including the seven commits since `59725fc`, application/build configuration, native permission surfaces, shared engine persistence/tools, client continuation, delivery adapters and scenario runner. No application tests, paid Gemini calls, builds, physical-device runs or testing agents were executed in this review. Failure sequences below are source findings, not claimed runtime reproductions. The comparison changes no files under frozen `frontend/packages/guarddog-*`; this is a diff observation, not a fresh 91-file hash audit.

**Useful progress to retain:** Gate-embedded shared cases and continuation into Ask; immutable per-attempt answer/history bundles; accepted-turn recovery; encrypted separate upload chunks; longer research answers retained by reference; real Resend, Expo and S3-compatible adapter implementations; device broker wiring; a native platform split for the main mock security adapter. This work is materially beyond the earlier provider-only migration.

**Completion is still partial.** The saved `docs/APOLLO_IMPLEMENTATION_MATRIX.md` explicitly says PARTIAL and lists unfinished Stage C work. The developer's opening “Stages A–C plus R01–R10 are done” is broader than both that matrix and the code support. Do not restart completed work, and do not blanket-close the remaining items.

Severity below describes impact when the affected feature is used. Delivery priority describes what to work on next; it does not require every row to be resolved before the first device installation.

| ID | Importance / severity | Current finding and affected files | Required closure |
|---|---|---|---|
| S01 | Immediate / high scope violation | `frontend/eas.json` selects `EXPO_PUBLIC_SECURECORE_MODE=mock` in both profiles. `src/security/securecore/SecureCore.ts` statically imports and selects `MockSecureCore`. `securityConfig.ts` still permits mock adapters on development/staging devices and dormant mock SecureCore in production. The main adapter's `.native.ts` throw-only replacement is a useful narrower fix. | Remove runtime mock implementations and selectors, including dormant SecureCore. If SecureCore has no shipped dependents, remove that dependency from normal boot and report its optional capability unavailable. Do not simply flip it to an absent native module and break launch. Isolate permitted device fixtures in a separate preview host; normal web also needs genuine browser capabilities/unavailable native capabilities. |
| S02 | Immediate / high user-facing correctness | `src/investigation/deviceBroker.ts` assigns `requestedByApollo: true` to every returned permission, advertises a generic capability list and has null manufacturer/model. Android `ApolloSecurityModule.kt` always returns notifications as `undetermined`; non-VPN permission requests say “Not implemented.” These values cannot support the promised requested-versus-granted behavior. | Read the real platform permission state, store actual request intent separately, advertise implemented capabilities and bind observable app/device SDK signals to the broker. Collect available device profile facts. Implement missing relevant operations in Apollo-owned code. |
| S03 | Immediate / high usability | `src/settings/actions.ts` sends every `open_settings` action to `Linking.openSettings()`. Device still uses legacy `deviceSettings.ts`. `tools.py::research_settings` calls guidance “exact” when a manufacturer appears in a result title/host, without establishing OS/target applicability. | Wire plan → exact supported action → return → fresh target recheck through Device and Higgins. Reuse supported platform intents and native methods. An OEM name alone cannot establish an exact match. Keep guidance visible and show the actual outcome. |
| S04 | High / high delivery correctness | `src/push/notifications.ts` obtains an FCM/APNs token using `getDevicePushTokenAsync`; `backend/routers/push.py` accepts only Expo token syntax. Registration errors are swallowed and the frontend returns `granted`. The backend can return `sent: true` with no registered recipient and records only a ticket count rather than receipt IDs. | Align the token protocol end to end, separate permission/registration/delivery state, retain and reconcile real provider tickets/receipts, and report no-recipient/error outcomes. Credentials alone do not fix this. Complete the related email/storage reliability work described below. |
| S05 | High / high lifecycle correctness | `repository.py::insert_evidence` checks liveness before an awaited insert; `store_bytes` checks around writes, but process failure can skip the compensating delete. `emit` can insert after cleanup between sequence allocation and insert. `_speech_job` has the same check/insert window. Completed cleanup is rescanned for one hour, which is useful but not an atomic write barrier. | Bind all writers/readers to case epoch and operation lifetime, revoke reads immediately, and keep cleanup pending until active writes are drained or safely reconciled. Cover metadata, chunks, uploads, events, jobs, sources, plans and audio. Use a transaction where supported or a documented writer-lease/tombstone protocol compatible with the actual database deployment. |
| S06 | High / high content handling | `evidence.py::ingest_file` stores original bytes before extraction and secret removal; `_purge_original_if_secret` runs later. Images are sent directly as original vision input with no implemented secret preflight. Scanned PDF regions and embedded document visuals are recorded as gaps, not processed. | Implement ephemeral admission/secret handling and original-evidence processing as a complete path, preserving useful surrounding content. Complete Gemini-only visual processing, bounded document/attachment ingestion and accurate omissions. Do not restore summary-only investigation to avoid this work. |
| S07 | High / high conversation integrity | `caseStore.ts::refresh` mutates state after awaited requests without checking the captured generation. Completed-event callbacks call it and later update state; switching/deleting a case during those awaits can display old content in a new case. File upload, attach, ask and several catch callbacks also lack a complete post-await guard. `GateInvestigation` keys automatic work from editable context and deletes the previous case when that key changes. | Guard every async publication by the captured case/generation/job, cancel obsolete work, and bind investigation creation to an explicit immutable submission ID. Typing into an editable result screen must not start billed investigations or delete the last case. Preserve a failed server-deletion retry across later navigation/start. |
| S08 | High / high recovery correctness | `coordinator.py` checkpoints completed tool rounds, but not each completed tool result within a multi-call response; a later call failure can lose earlier completed results. `jobs.py::recover` fails expired-deadline jobs before checking whether their turn was already accepted. Several retry/waiting-device case transitions still omit the worker fence. Device-result completion is a multi-write path without an atomic fulfilled claim. | Persist a durable per-call ledger and budgets; repair accepted turns first; fence every transition; atomically claim device results and reconcile interrupted completion. Do not rerun a paid completed tool call merely because a later call failed. |
| S09 | High / high product coherence | Text still calls `/message/analyse` before rendering `GateInvestigation`; App still calls `/app/analyse`. New case results sit beside older assessments. Text screenshot handoff supplies extracted text but omits the original image; App obtains native SDK facts but its case handoff is a user-description string. Home/share/Patrol remain partly on older paths. | Make one shared case the investigation owner for every entry route. Retain real deterministic detection as an initial observation; reuse useful lookups as evidence. Eliminate duplicate AI investigations and contradictory final guidance. Carry original screenshot/file bytes and typed native observations, not only their paraphrase. |
| S10 | High / medium-to-high completeness | PDF true totals and DOCX tables/header/footer extraction improve coverage. However `read_text` marks a tool result examined before the next successful Gemini call; reading a short registered clue can update its parent coverage as examined. `register_clues` silently stops creating clues at 64 and processes URLs before phones, so enough URLs can omit all callback-number clues. Settings/source authority still uses a fixed vendor-domain hint list. | Separate extracted, delivered and dispositioned ranges. Never infer parent-document completion from a clue. Inventory all accepted clues with explicit paging/continuation, preserve omitted ranges/visuals and display actual processing limits. Verify source applicability and organization relationships through real research; use domain hints only as hints. |
| S11 | Next artifact / high delivery gap | The tree contains Android/iOS mobile modules and configuration, but no Windows/macOS application hosts were found. EAS has the specialized GuardDog acceptance profile and production profile, with no dedicated ordinary device-test profile. No current installable build was established in this review. | Produce a normal Android device-test APK now using the existing real engine path, advance provisioned iOS/iPadOS delivery, and implement Windows/macOS hosts/adapters as required work. Report build service/signing/access blockers precisely; do not call absent implementation an OS limitation. |
| S12 | Deferred testing work / medium reporting correctness | The existing runner and saved reports have the grading/coverage limitations identified in the source review. | Preserve the finding and existing artifacts. Do not extend or run the scenario suite in current development sessions. Record historical results accurately and leave future scenario evaluation to the owner. |

Source references for these findings are pinned: [build profiles](https://github.com/zelnix/Apollo/blob/2983492e9a1fa94b2675a0cc28ea11e071c9337b/frontend/eas.json), [device broker](https://github.com/zelnix/Apollo/blob/2983492e9a1fa94b2675a0cc28ea11e071c9337b/frontend/src/investigation/deviceBroker.ts), [native Android surface](https://github.com/zelnix/Apollo/blob/2983492e9a1fa94b2675a0cc28ea11e071c9337b/frontend/modules/apollo-security/android/src/main/java/com/hucentai/apollosecurity/ApolloSecurityModule.kt), [Settings dispatcher](https://github.com/zelnix/Apollo/blob/2983492e9a1fa94b2675a0cc28ea11e071c9337b/frontend/src/settings/actions.ts), [push frontend](https://github.com/zelnix/Apollo/blob/2983492e9a1fa94b2675a0cc28ea11e071c9337b/frontend/src/push/notifications.ts), [push backend](https://github.com/zelnix/Apollo/blob/2983492e9a1fa94b2675a0cc28ea11e071c9337b/backend/routers/push.py), [repository](https://github.com/zelnix/Apollo/blob/2983492e9a1fa94b2675a0cc28ea11e071c9337b/backend/services/higgins/repository.py), [evidence processing](https://github.com/zelnix/Apollo/blob/2983492e9a1fa94b2675a0cc28ea11e071c9337b/backend/services/higgins/evidence.py), [client state](https://github.com/zelnix/Apollo/blob/2983492e9a1fa94b2675a0cc28ea11e071c9337b/frontend/src/investigation/caseStore.ts), [jobs](https://github.com/zelnix/Apollo/blob/2983492e9a1fa94b2675a0cc28ea11e071c9337b/backend/services/higgins/jobs.py), [coordinator](https://github.com/zelnix/Apollo/blob/2983492e9a1fa94b2675a0cc28ea11e071c9337b/backend/services/higgins/coordinator.py), [scenario runner](https://github.com/zelnix/Apollo/blob/2983492e9a1fa94b2675a0cc28ea11e071c9337b/tests/run_us_scenarios.py).

#### What happened to R01–R10

These are review observations, not ten new approval gates. Preserve implemented fixes and finish the remaining behavior in the same work package.

| Prior finding | Material improvement now present | Remaining work / current assessment |
|---|---|---|
| R01 answer/history | Immutable per-attempt bundles and accepted references; recovery recognizes accepted turns on its normal path | Improved. Also repair accepted turns on deadline/error recovery; don't claim complete solely from the normal path. |
| R02 deletion | Before/after content checks, speech post-provider check, zero-offset TTL and repeat cleanup | Improved but S05 still open; cleanup completion must account for late writers. |
| R03 originals/secrets | TXT originals are not passed as raw text; secret-bearing extracted originals can be purged | Partial: storage precedes the scan; image/document visual handling unfinished (S06). |
| R04 recovery | Per-round checkpoints, persisted research-call count and retry-wait heartbeat | Partial: per-call interruption and remaining fence/continuation cases (S08). |
| R05 coverage | Actual PDF totals, omitted-page ranges, more DOCX content, whole-page range checks, oversized-image exclusion | Partial: delivery timing, clue-parent accounting and visual extraction (S06/S10). |
| R06 uploads | Separate bounded chunk records, duplicate chunk digest checks, stable evidence reference after successful finalization | Improved. Finalization still needs a claim/recovery path if ingestion succeeds but the upload record update fails; retries must return that evidence instead of an unrecoverable duplicate conflict. |
| R07 leads/sources | Registered URL/phone clues, selector support, canonical source-ID mapping, full research answer reference | Improved. Keep public-source authority grounded; preserve explicit paging and budgets, and prevent duplicate work on recovery (S08/S10). |
| R08 Settings | Expected value/capability parameters and plan timestamp now exist | Partial: real target dispatcher, native observations, device applicability and recheck continuation (S02/S03). |
| R09 client | Stream cursor resume, failed-job retry, generation token and deletion retry state | Partial: checks do not surround every await; canonical device-result replay must normalize fields before hashing (S07/S08). |
| R10 UI/actions | Shared case view, action dispatcher, case-scoped narration and partial/waiting labels | Improved. Device Settings and remaining entry paths must complete the actual user flow (S03/S09). |

**Model-value assessment:** this save demonstrates useful engineering progress, but it does not establish Fable 5.1's value over Sol 5.6. Commit metadata does not identify which model produced which work, and per-session credit charges are absent. Assess future reports by accepted working capability, defects requiring rework, user steering required and actual credits—not model branding, test totals or elapsed “worked for” time. Do not spend more credits on a separate model comparison without a request; use the existing work records. Earlier conflicting architectural instructions are also part of the delivery problem and must not be misattributed to the developer model.

### 1. Product outcome and non-negotiable requirements

The person brings Apollo a concern through a Gate. Apollo collects relevant evidence and performs supported detection/protection. Higgins uses Gemini to investigate the evidence, follow meaningful leads, explain the result and help the person take the appropriate next action. **Apollo acts. Higgins investigates, interprets and guides.**

The investigation must benefit from information Apollo can obtain: original submissions, available device/app observations, prior answers in the current case and external research. Higgins must resolve questions through available tools before asking the user to find information Apollo can retrieve. Questions about the person's intentions, experience or consent are appropriate.

1. **Gemini only.** Use the existing owner-provided server-side Gemini configuration for investigation, research synthesis, image interpretation, model-based OCR, transcription, follow-ups and narration. Use Google's supported client/API directly. No Emergent-managed service keys and no alternate AI-provider fallback, including in preview or recovery. Emergent hosting/development is permitted. Specialist data APIs, Gmail OAuth, email delivery, push and object storage are separate services and must use directly owner-managed credentials where required.
2. **Real investigations and explanations.** No canned Higgins answer, fabricated research, substituted verdict, forced warning, arbitrary response shortening or hidden template rewrite. Deterministic detection and deterministic operational messages such as “Still checking” remain legitimate. They must not impersonate a completed Gemini investigation.
3. **Faithful relevant evidence.** Preserve useful text, images, links, relationships and observations within the processing lifecycle. Phone numbers, public organisation names, email addresses, domains and IPs are not automatically authentication secrets. Apply purpose-specific handling; do not destroy investigation context with blanket redaction.
4. **No credential collection.** Remove or keep removed login-username/password forms, generic IMAP password flows and credential storage. Never ask the person to disclose a password, OTP, recovery code or session token. OAuth credentials are server-held service access, not an invitation for Apollo to collect mailbox passwords. An email address voluntarily submitted for a breach check is an investigation identifier, not a login workflow.
5. **Temporary processing, then deletion.** Process data deeply enough for the requested investigation, then discard original copies when no longer required. Necessary active-case content has a hard 15-minute ceiling that retries cannot extend. User-saved redacted Patrol reports and minimum local device-change baselines have separate explicit purposes and deletion controls.
6. **Truthful conclusions.** Initial detection is a hypothesis. Gemini may raise, lower or qualify concern with reasons. It cannot fabricate an observation or completed action. `THREAT_BLOCKED` / “Apollo is biting” is derived only by the existing enforcement pipeline from an observed packet intentionally dropped with valid correlated evidence. A rejected call, warning, failed request, rule match, blocked research fetch or model assertion cannot create Biting.
7. **Simple help.** Plain English first; one immediate action when needed; useful questions allowed; deeper explanation, sources and limitations available without losing information. The user should not need to become a Settings expert.
8. **Exactly ten Gates.** Site, Link, Text, Call, Network, Account, Email, App, File and Device remain selectable. File and Device manual checks display “Ready to check” unless genuine continuous observation is implemented and enabled.
9. **No mocks in the application runtime.** Remove mock implementations, canned investigation results, simulated protection/identity/cryptography, fake observations and runtime switches that select them from shipped application code and dependencies. This applies to mobile, desktop, deployed web and backend, including ordinary development, staging and production builds. Only synthetic scenario inputs and visibly labelled preview substitutes for native device observations the browser cannot obtain are allowed, injected from a separate test/preview harness. Gemini, research, external lookups and investigation logic remain real. Unused or labelled-inactive mocks are not an exception.
10. **Stage completion is delivery.** A provider migration, prompt adjustment, set of types, green local tests or documentation update alone does not complete this assignment.
11. **Four platforms are mandatory.** Deliver Android phones/tablets; iPhone/iPad; Windows PCs/laptops/tablets/2-in-1 devices; and macOS desktops/laptops. Each target needs an installable application, responsive and accessible input/layout, real supported native capabilities, all ten Gate entry points, shared Gemini investigation, actionable guidance and honest capability-specific limitations. A browser preview is not desktop-native delivery. Do not remove a platform or defer its core implementation as an ordinary engineering decision.

### 1A. Mandatory platform delivery and the zero-mock boundary

| Target | Device classes | Required delivery |
|---|---|---|
| Android | Phones and tablets | Real Android application, applicable native observation/protection adapters, permissions/Settings/rechecks, share/file intake, audio and notifications, signed build artifact. |
| iOS/iPadOS | iPhones and iPads | Real Apple mobile application, applicable native adapters/extensions and entitlements, permissions/Settings/rechecks, share/file intake, audio and notifications, provisioned build artifact. |
| Windows | PCs, laptops, tablets and 2-in-1 devices | Installable desktop application, Windows-native observation/protection services as needed, permission/admin-consent handling, Settings/rechecks, local-file intake, desktop input/accessibility, signed distribution path. |
| macOS | Mac desktops and laptops | Installable desktop application, macOS-native observation/protection services/extensions as needed, permission/extension approval, Settings/rechecks, file intake, desktop input/accessibility, signed/notarized distribution path where required. |

Reuse the shared backend, Gemini engine, case schemas and applicable presentation/domain code. Add platform hosts and native adapters rather than duplicating investigation logic. Establish the desktop host/build toolchain compatible with the existing stack as part of implementation, recording its architecture in the same delivery matrix; this is not another planning approval gate. Mobile Expo packaging alone does not supply Windows/macOS installers: its documented `--platform all` build covers Android and iOS. [Expo build targets](https://docs.expo.dev/build/introduction/).

Keep privileged platform work behind a narrowly scoped native service/extension and typed operation interface. UI content, Gemini text and external pages cannot become arbitrary shell commands or privileged IPC calls. Request actual OS consent when needed. Investigate supported native APIs for the required behavior; Windows has a native filtering API family, so a missing desktop adapter must not be described as inherently impossible. [Windows Filtering Platform](https://learn.microsoft.com/en-us/windows/win32/fwp/windows-filtering-platform-start-page).

Feature parity means the same product purpose and coherent user journey; it does not mean pretending every OS exposes the same observations. For every Gate × platform, separately record: implementation complete/incomplete; API/device/permission availability; real input and output; scope; required consent; observed outcome; supported alternative; build/scenario status. A limitation attributed to the OS must cite current applicable vendor documentation and distinguish OS restrictions from missing implementation, missing entitlements, signing, device hardware or configuration. Keep `not_implemented` open as work to finish. Do not relabel it `unsupported` to close a stage.

Do not promise unrestricted inspection of other apps, all messages, encrypted traffic or every setting on any platform. Implement what the platform permits and preserve useful user-submitted checks and real research where direct observation is unavailable. A device without telephony can still investigate a submitted call concern; it cannot claim local call screening. No permission, rule reload or failed request becomes packet-backed Biting.

**Immediate mock removal:** trace `EXPO_PUBLIC_SECURECORE_MODE`, `MockSecureCore`, `MockSecureCoreScenarios`, mock selectors, fallback imports and every call site. Remove mock-only runtime modules and configuration. Where no feature needs SecureCore, remove the dormant dependency/path rather than manufacturing a replacement service. Where a feature does depend on it, implement the real required operation or expose an explicit typed unavailable/incomplete state. Do not simply switch to `native` when no real implementation exists; do not fabricate keys, identities, signatures, encryption, attestation or protection results.

Place permitted scenario data and device-preview fixtures outside production application modules, for example under `tests/scenarios/` and `tools/preview-device-harness/`. The normal application uses only a real adapter or a truthful unavailable result. Only the dedicated preview host may inject browser-inaccessible device observations. Display `MOCKED DEVICE INPUT — PREVIEW ONLY` on affected observations and carry that origin through investigation, explanation and reports. The actual Higgins/Gemini result is real and must disclose reliance on the simulated observation. Mocked inputs cannot create real enforcement history.

Every ordinary app build must exclude preview fixtures and activation paths, including dynamic imports, remote flags, fallback selection and bundled fixture assets. Enforce this with dependency/bundle inspection and runtime configuration validation, not a blanket search for the word “mock” in docs/tests. Frozen SDK test fixtures remain unchanged in source but are excluded from deliverable application artifacts. If a required adapter fails to load, show its real failure without selecting simulation or displaying fabricated empty/safe results.

Support compact phone layouts, tablet portrait/landscape and split views, resizable desktop windows, keyboard/mouse/touch, screen readers, focus order and readable text scaling. Do not infer device class from screen width alone or infer device capabilities from a form-factor label. Record minimum OS versions and supported CPU architectures per target using actual SDK/build compatibility; unbuilt targets remain explicitly incomplete.

### 2. Required end-to-end flow

1. A normal Gate screen creates or continues a case. A shared file/email attachment/link retains its parent relationship and Gate context.
2. Evidence ingress inventories every submitted item, detects supported format, performs secret handling, encrypts necessary temporary copies and records coverage and transformations.
3. Apollo's original observations enter the case separately from inferences. Protection health and enforcement records remain separate from Gemini's assessment.
4. A durable coordinator assembles relevant original evidence, unresolved questions, available capabilities and case history for Gemini.
5. Gemini requests evidence reads, external research or supported device observations. The coordinator validates and executes each permitted tool and returns real results to the same investigation.
6. Newly discovered entities or contradictions can trigger further investigation. A tool result may be unavailable; that is evidence of a limitation, not a clean result or proof of fraud.
7. If only the person can supply a needed fact, Higgins asks a contextual question. Their answer continues the same case with a new immutable turn ID.
8. The system validates structure, references, actions and completion, commits the answer with its conversation context, and renders the accepted Gemini explanation faithfully.
9. A proposed action uses a known application capability and appropriate user/OS consent. Returning from Settings triggers the specific available observation needed to check the outcome.
10. Original evidence is purged when its processing purpose ends. All remaining temporary case content and audio expire at the original deadline. Cancellation/deletion prevents late results from becoming visible.

### 3. Component boundaries and implementation files

Paths below are repository-relative. Existing files are modification targets; new paths are proposed implementation locations. Equivalent organisation is acceptable if one shared engine remains and the requirement mapping identifies the final paths.

| Layer | Files/components | Responsibility |
|---|---|---|
| Gemini boundary | `backend/services/higgins/provider.py` | Sole AI client; modality/capability routing; real tool calls; finish, usage and grounding metadata; classified failures. |
| Case contracts | `backend/services/higgins/contracts.py`; generated `frontend/src/investigation/types.ts` | Strict request/response schemas, versioned contracts and common statuses. |
| Evidence | `evidence.py`, `ingestion.py`, `documents.py`, existing `capacity.py` | Inventory, safe extraction, original/derived links, segmentation, encrypted storage, model context and coverage. |
| Research | `coordinator.py`, `tools.py`, `research.py`, `validation.py` | Real Gemini investigation loop, source registration, inference revision, supported actions and structured repair. |
| Durable execution | `jobs.py`, `repository.py`, existing `retention.py`, `encryption.py` | Idempotency, leases, commit fencing, event replay, cancellation, expiry and cleanup. |
| Guided Settings | `settings_guidance.py`; `frontend/src/settings/{guidance,actions,recheck}.ts` | OEM research, device applicability, safe actions and target-specific rechecks. |
| HTTP | new `backend/routers/investigations.py`; existing `analysis.py`, `ask.py`, `voice.py` | Authenticated case API. Old endpoints adapt to the same coordinator during migration. |
| Shared UI | `frontend/src/investigation/{client,caseStore,deviceBroker}.ts`; `InvestigationView.tsx` | Case-specific state, progress, explanation, sources, questions, retries, actions and expiry. |
| Gate integration | existing Gate screens, `ApolloContext.tsx`, `higginsHandoff.ts`, `privacy.ts`, `threatScent.ts` | Preserve useful detection; replace lossy handoffs; associate evidence without manufactured escalation. |
| Observation boundary | Apollo-owned native modules and capability adapters | Available/requested/granted/observed distinctions; explicit unavailable results. No frozen GuardDog edits. |
| Platform hosts and adapters | Existing Android/iOS modules; proposed `desktop/`; shared `frontend/src/platform/` contracts | Required Android, iOS/iPadOS, Windows and macOS hosts; real native services, lifecycle, consent and capability-specific outcomes. Equivalent paths are allowed; desktop work is not optional. |
| Distribution and isolation | Mobile profiles, desktop packaging, platform CI and separate preview/test entry points | Reproducible installable artifacts, signing/entitlement setup, native fixture exclusion and per-platform build records. No mock selection in ordinary app profiles. |
| Delivery | `backend/services/email.py`, `backend/routers/push.py`, `backend/services/storage.py` | Working owner-configured adapters, honest delivery states and migration of managed-key dependencies. |
| Regression reference | Existing runner/scripts and scenario catalogue | Preserve for future use; scenario expansion/execution is outside the current developer assignment. |

### 4. Shared logical contracts

Use strict Pydantic models as the authoritative wire schema and generate corresponding TypeScript. Reject unknown request fields. Resource IDs are server-issued opaque UUIDs; client turn IDs and idempotency keys are independently generated UUIDs validated and owner-scoped by the server. UTC timestamps are ISO 8601; ranges are zero-based, half-open. Evidence and source arrays are paginated; paging must never silently lose an inventory item. These are data contracts, not application implementation code.

```typescript
type Id = string;
type UTC = string;
type Gate = 'site'|'link'|'text'|'call'|'network'|'account'|'email'|'app'|'file'|'device';
type CaseStatus = 'queued'|'investigating'|'waiting_device'|'waiting_user'|
  'retry_wait'|'partial'|'complete'|'failed'|'cancelled'|'expired';
type Origin = 'user_submission'|'device_observation'|'external_source'|'apollo_inference';
type CoverageStatus = 'not_started'|'partial'|'examined'|'unavailable'|'out_of_scope';
type Assessment = 'concern_found'|'no_concern_found_within_scope'|'uncertain';
type PreviewOrigin = null | {kind:'preview_device'; label:string; fixtureId:string};

interface Coverage {
  status: CoverageStatus;
  unit: 'bytes'|'characters'|'pages'|'items';
  total: number|null;
  examined: number;
  examinedRanges: Array<{start:number; end:number}>;
  omittedRanges: Array<{start:number; end:number; reason:string}>;
  reason: string|null;
  materialGap: boolean;
}
interface EvidenceItem {
  id: Id; caseId: Id; clientItemId: string;
  origin: Origin;
  kind: 'text'|'url'|'image'|'document'|'audio'|'attachment'|'observation'|'source_snapshot';
  parentId: Id|null; relatedEvidenceIds: Id[];
  collectedAt: UTC; observedAt: UTC|null; expiresAt: UTC;
  availability: 'available'|'unavailable'|'permission_required'|'purged';
  mediaType: string|null; byteLength: number|null;
  coverage: Coverage; simulation: PreviewOrigin;
  transformations: Array<{
    kind:'secret_redaction'|'ocr'|'decode'|'chunk'|'normalise';
    description:string; sourceStart:number|null; sourceEnd:number|null;
  }>;
}
interface SourceReference {
  id: Id; url: string; title: string; retrievedAt: UTC;
  retrieval: 'fetched'|'search_result'|'unavailable';
  authority: 'official'|'independent'|'self_claimed'|'unknown';
  authorityBasis: string;
  publishedAt: UTC|null; evidenceIds: Id[];
}
interface Finding {
  id: Id; text: string;
  basis: 'observation'|'user_report'|'inference';
  confidence: 'low'|'medium'|'high';
  evidenceIds: Id[]; sourceIds: Id[]; supersedesFindingIds: Id[];
}
interface Question {
  id: Id; text: string; reasonNeeded: string;
  answerType: 'text'|'yes_no'|'choice'; choices: string[];
}
interface ActionProposal {
  id: Id;
  kind: 'instruction'|'open_settings'|'request_permission'|'recheck'|'open_verified_source';
  label: string; instruction: string; capabilityId: string|null;
  executionDescriptorId: Id|null;
  requiresUserGesture: boolean; sourceIds: Id[];
}
interface HigginsResponse {
  revision: number; overview: string; explanationMarkdown: string;
  assessment: Assessment;
  attention: 'none'|'review'|'action_needed'|'urgent';
  attentionReason: string|null; findings: Finding[];
  uncertainties: string[]; scope: string;
  sourceIds: Id[]; remainingEvidenceIds: Id[];
  actions: ActionProposal[]; recommendedActionId: Id|null;
  question: Question|null;
  completion: 'complete'|'partial'|'waiting_user';
}
interface InvestigationCase {
  schemaVersion: 1; id: Id; revision: number; gates: Gate[];
  status: CaseStatus; createdAt: UTC; updatedAt: UTC; expiresAt: UTC;
  response: HigginsResponse|null; activeJobId: Id|null;
  pendingDeviceRequestIds: Id[];
  inventory: {total:number; examined:number; partial:number; unavailable:number; purged:number};
  cleanupStatus: 'not_due'|'pending'|'complete'|'failed';
}
interface Page<T> {items:T[]; nextCursor:string|null; total:number}
interface Failure {
  code: 'invalid_input'|'unauthenticated'|'not_found'|'conflict'|
    'provider_configuration'|'rate_limited'|'provider_unavailable'|
    'transport_interrupted'|'incomplete_output'|'unsupported_format'|
    'evidence_expired'|'budget_exhausted'|'device_unavailable'|
    'permission_denied'|'response_invalid'|'cleanup_failed';
  message: string; retryable: boolean; retryAfterSeconds: number|null;
  missingEvidenceIds: Id[];
}
interface Job {
  id: Id; caseId: Id; turnId: Id; status: CaseStatus;
  startedAt: UTC|null; deadlineAt: UTC; retryAt: UTC|null;
  attempt: number; lastEventSequence: number; failure: Failure|null;
}
interface DeviceProfile {
  platform: 'android'|'ios'|'windows'|'macos'|'web';
  formFactor: 'phone'|'tablet'|'desktop'|'laptop'|'convertible'|'unknown';
  manufacturer: string|null; model: string|null; osVersion: string|null;
  locale: string;
  evidenceOrigin: 'native'|'user_reported'|'browser';
  capabilityIds: string[];
}
interface DeviceRequest {
  id: Id; caseId: Id; caseRevision: number; capabilityId: string;
  fields: string[]; reason: string; expiresAt: UTC;
}
interface DeviceResult {
  requestId: Id; caseRevision: number; capabilityId: string;
  status: 'observed'|'unavailable'|'permission_required'|'denied'|'failed';
  unavailableReason: null|'not_implemented'|'os_restricted'|'hardware_absent'|
    'configuration_missing'|'entitlement_missing'|'adapter_failed';
  observedAt: UTC|null;
  values: Record<string,string|number|boolean|string[]|null>;
  simulation: PreviewOrigin;
}
interface SettingsPlan {
  id: Id; caseId: Id; target: string; device: DeviceProfile;
  match: 'exact'|'platform_only'|'unresolved';
  mode: 'permission_request'|'settings_link'|'instructions';
  instructions: string[]; sourceIds: Id[];
  executionDescriptorId: Id|null;
  expectedObservation: {
    capabilityId:string; field:string; expectedValue:boolean|string;
  }|null;
}
interface RecheckResult {
  planId: Id; checkedAt: UTC;
  outcome: 'correct'|'not_yet_correct'|'cannot_observe'|'failed';
  evidenceIds: Id[]; explanation: string;
}
interface ProviderResult {
  provider: 'gemini'; model: string; apiVersion: string;
  finishReason: string; providerComplete: boolean;
  usage: {inputTokens:number|null; outputTokens:number|null; totalTokens:number|null};
  sourceIds: Id[];
}
interface TurnCommit {
  turnId: Id; caseId: Id; inputRevision: number; committedRevision: number;
  question: string; answerToQuestionId: Id|null;
  response: HigginsResponse; provider: ProviderResult;
  evidenceIds: Id[]; sourceIds: Id[]; committedAt: UTC;
}
```

`DeviceResult.values` is not an unrestricted bag: validate it against the registered schema for `capabilityId` and the exact outstanding request. Unadvertised fields, mismatched request IDs, fabricated freshness and native submissions marked simulated must be rejected appropriately. Native observations are app-reported measurements; they are not hardware attestation unless an actual attestation mechanism exists.

Migrate `formFactor` and `unavailableReason` consistently across generated schemas, producers and consumers. Use `unknown` when form factor cannot be established. An `observed` result has no unavailable reason; an unavailable result supplies its actual reason and no invented values. A `not_implemented` result keeps the corresponding delivery requirement open. Native applications accept no non-null simulation origin; the dedicated preview boundary is the sole runtime exception. Keep a separate server-owned implementation matrix rather than accepting client claims that an OS inherently forbids a capability.

The coordinator assigns IDs, source records, coverage and origin. Gemini supplies analysis, relationships and proposed actions using those registered references. It cannot award itself observed provenance, promote a source's self-claim to official authority, or create enforcement events. Keep historical records immutable and represent revised findings explicitly.

Keep a small explicit state projection separate from the explanation. `review` maps a supported concern to Growling; `action_needed`/`urgent` maps a supported need for action to Barking. Require reasons tied to the actual findings. `none` with a complete scoped no-concern result can show a resting result for that check; it cannot establish whole-device safety or an active protection service. Waiting/partial/unavailable states remain visibly incomplete and may retain independently established concern. “Biting” is never an `attention` value or model assessment: only the existing native-evidence gate can produce it. Gate readiness/protection health uses the real capability/lifecycle state independently of this investigation projection. This projection changes status presentation, not Gemini's explanation text.

### 5. Mongo persistence and an authoritative completion boundary

Use the existing Mongo deployment. Avoid introducing a new paid queue or object store as a prerequisite for core investigations. Necessary encrypted file chunks can use the existing database with bounded documents; a configured owner-controlled blob store may be substituted behind the same interface.

| Collection | Required keys/indexes | Contents and lifecycle |
|---|---|---|
| `investigation_cases` | Unique `(owner_id, case_id)`; `expires_at`; active lease index | Authoritative revision, lifecycle epoch, active turn/job, lease fence and accepted commit references. Content fields encrypted. Keep minimal tombstones while cleanup is pending. |
| `investigation_evidence` | Unique `(owner_id, case_id, evidence_id)` and `(owner_id, case_id, client_item_id)`; expiry | Inventory and encrypted metadata; opaque payload references. Sensitive filenames/URLs are not plaintext indexed fields. |
| `investigation_content_chunks` | Unique `(owner_id, case_id, evidence_id, chunk_index)`; expiry | Independently authenticated encrypted chunks and an ordered manifest. Start with 1 MiB plaintext chunks to stay below document-size limits after encoding. |
| `investigation_jobs` | Unique `(owner_id, case_id, idempotency_key_digest)`; lease/deadline indexes | Job and checkpoint data; content-bearing fields encrypted. Case control is authoritative for publication/cancellation. |
| `investigation_turn_commits` | Unique `(owner_id, case_id, turn_id)`; expiry | Immutable staged or accepted complete `TurnCommit`, encrypted. Includes the question, answer and history context together. |
| `investigation_events` | Unique `(owner_id, job_id, sequence)`; expiry | Replayable events; sensitive payload encrypted; access governed by current case lifecycle. |
| `investigation_cleanup` | Unique `(owner_id, case_id, target_type, target_id)`; retry index | Opaque deletion work. Do not expire failed/pending cleanup tasks before completion. |
| `integration_deliveries` | Unique `(owner_id, purpose, idempotency_key_digest)`; retry index | Delivery status/receipts and minimum permitted encrypted payload with purpose-specific expiry. |

Never mark an answer complete before its conversation context is durable. Preserve the implemented shared-engine answer/history improvement and complete its recovery paths using these semantics:

1. Stage one immutable encrypted turn bundle containing the question, accepted answer, sources and complete history contribution.
2. Commit its reference through a compare-and-swap on the case control record matching owner, expected revision, lifecycle epoch, active turn, current lease fence, non-deleted state and unexpired deadline.
3. The accepted reference makes both the answer and history contribution authoritative at once. An unreferenced staged bundle is never readable as a completed answer and is reclaimed.
4. Derive history and final events from accepted bundles. Publish completion only after that commit; rebuild a missing event projection after a crash. Reconnect must find the accepted result without re-running Gemini.
5. Cancellation/deletion changes the same authoritative case epoch and revokes reads. Old workers cannot commit after it. Fence values must remain attached to every stage/tool/result.

Use a transaction if the existing deployment supports it and it simplifies these semantics. Do not require a database migration merely to claim atomicity: the single authoritative case commit above is the required non-transaction alternative. Per-case bounds and paginated turn storage prevent an ever-growing Mongo document. Do not describe a best-effort series of independent writes as atomic.

### 6. Capacity, evidence coverage and data lifecycle

Keep the existing versioned text/item admission policy where useful. Preserve the shared case's replacement for the old 240-character summary/eight short findings/500-character question bottleneck, and remove remaining lossy paths. Display summaries may be short; the investigation must retain references to the full permitted evidence.

**Actual saved defaults at `2983492`:** 262,144 text characters; 256 submitted items per request; 32 MiB per file and 64 MiB active-case payload; 200 parsed PDF pages; 40 megapixels per image; 24,000 characters for full inline text, then a 2,000-character preview plus ranged reads; 30,000 characters per read; 10 tool rounds and 6 grounded research calls per turn; 120-second work slice; 15-minute case lifetime. These are source defaults, not measured native/deployed capacity or Gemini's intrinsic limits. The inline preview/ranged-read design is valid only if the rest remains reachable and material unprocessed content is disclosed.

**Remaining hidden cutoffs:** clue registration stops at 64 without reporting the omitted count; URL metadata is sliced at 512; research entities are sliced at 32. Replace silent omission with full inventory, paged work and explicit deferred counts/cursors. A turn may stop at a resource budget while preserving what remains; it must not treat that cutoff as all evidence investigated. Retain and process decisive URLs/numbers beyond the early batch. Record the greater-than-64 mixed URL/phone limit as a case for later owner evaluation alongside US04; do not build or run a new scenario script now.

| Control | Initial operational instruction |
|---|---|
| Text transport | Existing 262,144-character ceiling may remain, published before submission. Overflow requires explicit continuation/another evidence item, never truncation. |
| Item transport | Existing 256-item ceiling may remain per request; paginate/batch the case inventory. Do not silently accept only the first N URLs. |
| Files | Start with a documented 32 MiB per-file upload ceiling, 64 MiB aggregate active-case payload budget and 200-page supported-document budget; stream admission and support chunked upload. These are application defaults, not Gemini capability claims. Adjust through the versioned policy if deployment measurements require it. |
| Extraction | Bound expanded bytes, archive depth, image dimensions and parser time independently. Initial expanded-content budget: 64 MiB per case; archive recursion depth: 2; decoded image budget: 40 megapixels per image. Do not execute macros, scripts or binaries. |
| Model context | Obtain applicable model limits; count complete assembled content and reserve tools, retrieval, reasoning/output overhead. Segment or retrieve relevant original ranges when necessary. No arbitrary tail deletion. |
| Work scheduling | A 120-second active slice controls scheduling. Persist progress and permit continuation for useful unfinished work within the original content lifetime. |
| Calls/retries | Default call timeout 50 seconds, capped by remaining work/lifetime. At most two transient retries, one semantic repair and one capability-compatible Gemini model switch per turn. All consume one total budget. |
| Output | The existing 8,192-token setting may remain an initial budget. Output-token termination is incomplete; continue or repair explicitly. It is not a fixed user-facing response-length limit. |
| Temporary lifetime | At most 15 minutes from scope creation. No retry, new turn, reconnect, speech request or tool call extends it. Child objects inherit the parent ceiling. |
| Tombstones | Retain only opaque metadata long enough to finish cleanup and enforce idempotency. Expiry of a tombstone must never recreate content or reuse a case ID. |

All policy entries expose value, unit, purpose, version and overflow behaviour through the capabilities API. A rejected upload remains visible as a failed/unavailable submission; do not claim to inventory contents that were never received. Provide an item-specific error and useful next step. Never misrepresent proposed limits as measured deployment capacity.

Coverage is a processing ledger, not a guess from what the model happened to mention. Union examined ranges without double counting. Distinguish parser extraction, model examination, external lookup and inaccessible content. Mark a material unread portion as partial, even if the provider returned valid JSON. “Complete” means the scoped question was addressed and evidence was properly dispositioned; it does not mean universally safe.

Required supported content includes plain text, JPEG/PNG screenshots, text-based and scanned PDF, and DOCX. Extract text, link targets and relevant visual/layout context. Represent other formats, encrypted documents, archives and executable content truthfully; use safe metadata/signature and bounded inspection where supported. A text sample is not a full malware scan. Maintain page/paragraph/character references so the model can revisit originals.

Authentication-secret handling must be precise. Parse text layers and known structured credentials before avoidable transmission; redact secrets while retaining surrounding threat context. Image-only content may require an inline Gemini vision preflight to locate sensitive regions: keep the original request-scoped, return no secret values, mask identified regions before durable temporary storage/research, and discard the original. Do not claim this prevents the first Gemini processing of an otherwise unreadable secret. Offer crop/redaction/resubmission when known secret-bearing content cannot be safely isolated. Do not add another AI provider for this step or apply a blanket ban to relevant investigation identifiers. Record redactions without recording the removed values.

Keep necessary originals through active multi-step assessment, then purge them when no longer required. Retain only necessary encrypted derived conversation/context until case expiry so ordinary follow-up works. A new follow-up may reopen a completed case before expiry, but cannot resurrect deleted originals; request a specific resubmission only when those originals are actually needed. User-saved reports are separately selected, redacted and clearly historical.

Delete covers ingress spools, parser outputs, encrypted chunks, model file uploads, Ask/handoff caches, event payloads, audio, frontend query state, object URLs and application-created picker copies. Never delete the person's source file. Enforce expiry on reads even while Mongo TTL or cleanup workers lag. On mobile resume, check absolute expiry again; a JavaScript timer alone is insufficient. One expired case must not clear or interrupt another case.

Use the existing dedicated content-encryption configuration. Ensure the key survives the actual deployment lifecycle via a protected mounted secret/owner secret manager. Do not regenerate it on each startup, derive it from the Gemini key, or commit it to Git. Preserve existing key compatibility; record unreadable legacy content and dispose it according to policy. Provider account retention is distinct from Apollo deletion. If provider files are uploaded, explicitly delete them and track failure; do not claim zero provider retention without evidence.

### 7. Gemini investigation and source architecture

Use a capability registry for the configured model/API/SDK, rather than assuming a preview model supports every modality and tool combination. Reuse the current owner key and working Gemini modalities. Do not change model solely because an example in documentation names a newer model. Record the selected model and required capabilities per job.

Google exposes function calling and Search grounding through distinct interfaces. Preserve required continuation fields, tool-call IDs, citation/grounding metadata and usage. If the chosen API cannot combine a desired tool set, split the work into coordinated Gemini calls in the same case; never silently omit research. [Function calling](https://ai.google.dev/gemini-api/docs/function-calling), [Search grounding](https://ai.google.dev/gemini-api/docs/google-search).

Separate private evidence assessment from public research-query construction. Give the public research call the minimum useful public identifiers and research questions; do not give an unrestricted search-enabled prompt the person's whole private submission. The private coordinator receives both the original evidence and sourced research. Relevant phone/name/domain associations may be investigated, but common-name matches and caller-ID matches remain leads rather than identity proof.

Dynamic research replaces hardcoded organisation/domain authority tables and app-name catalogues as the basis for verification. Small catalogues may supply explicitly labelled hints or safe navigation identifiers. They cannot declare an unknown organisation fraudulent, a familiar brand genuine, or an installed app authentic. Verify an official-source claim using actual source relationships and context. Record conflicting sources and dates.

URL context does not by itself establish that every linked page was inspected. The coordinator must track retrieved URLs and follow relevant additional leads explicitly. Preserve redirect chains and meaningful URL paths/query context; do not strip evidence down to hostname before private investigation. Block credential-bearing action links from automatic execution and reuse SSRF-safe fetching. [URL context](https://ai.google.dev/gemini-api/docs/url-context).

Structured output validation is an interface check, not proof that a statement is true. Validate registered references and supported actions; request one targeted Gemini repair for an invalid response. Do not reject ordinary questions, varied phrasing, long explanations or quoted scam language using a broad keyword/style filter. Do not ask for or expose hidden chain-of-thought. Present concise reasons, evidence and uncertainty. [Structured outputs](https://ai.google.dev/gemini-api/docs/structured-output).

## 🔌 API & Interface Contracts

### 8. Authenticated case API

All routes use existing device/session bearer authentication. Derive the owner server-side. Client-supplied `device_id`, case IDs, job IDs or storage references never authorize another owner's data. Use `Cache-Control: private, no-store` on investigation content and speech. Raw question/context must not appear in navigation URLs, analytics or access logs.

Use an `Idempotency-Key` UUID for every create/submit/resume/delivery operation. Scope it to authenticated owner and operation. Store a keyed digest of the canonical request. Same key and payload returns the original operation; a changed payload returns 409. A follow-up gets a new key and turn ID. Retry retains the failed turn's identity.

| Method and path | Request | Response and required behaviour |
|---|---|---|
| `GET /api/ai/capabilities` | None | 200 `CapabilityResponse`; sanitized actual configuration and policy; no key values. |
| `POST /api/investigations` | `CreateCase` | 201 `{case: InvestigationCase}`; replay returns same case. |
| `GET /api/investigations/{caseId}` | None | 200 `{case: InvestigationCase}`; 404 non-owned; 410 expired/deleted while tombstone retained. |
| `POST /api/investigations/{caseId}/evidence` | JSON `EvidenceSubmission` | 201 `{evidence: EvidenceItem, caseRevision:number}`. Reject stale revision/conflicting item ID. |
| Same evidence route, multipart | `metadata` JSON plus `file` | Same response. Stream limits and temporary cleanup apply before expensive parsing. |
| `POST /api/investigations/{caseId}/uploads` | `CreateUpload` | 201 `{uploadId, chunkBytes, expiresAt}` for resumable larger uploads. |
| `PUT /api/investigations/{caseId}/uploads/{uploadId}/chunks/{index}` | Binary body with declared length | 204; duplicate identical chunk safe, conflicting chunk 409. Owner/case/expiry bound. |
| `POST /api/investigations/{caseId}/uploads/{uploadId}/complete` | `{expectedRevision:number}` | 201 evidence after size/count/integrity verification; gaps cannot appear as a complete file. |
| `GET /api/investigations/{caseId}/evidence?cursor=...` | None | 200 `Page<EvidenceItem>`. |
| `GET /api/investigations/{caseId}/sources?cursor=...` | None | 200 `Page<SourceReference>`. |
| `POST /api/investigations/{caseId}/turns` | `SubmitTurn` | 202 `{job:Job, caseRevision:number}` promptly; provider calls execute outside the request lifecycle. |
| `GET /api/investigations/{caseId}/turns?cursor=...` | None | 200 `Page<TurnCommit>` for accepted, unexpired turns only. |
| `GET /api/investigations/{caseId}/jobs/{jobId}` | None | 200 `{job:Job, caseRevision:number, responseRevision:number\|null}`. |
| `GET /api/investigations/{caseId}/jobs/{jobId}/events?after={sequence}` | None | SSE ordered `InvestigationEvent`; reconnectable. Polling job/case is equivalent recovery. |
| `POST /api/investigations/{caseId}/jobs/{jobId}/resume` | `{expectedRevision:number}` | 202 same logical work with preserved checkpoints; no replay of another turn. |
| `POST /api/investigations/{caseId}/jobs/{jobId}/cancel` | `{expectedRevision:number}` | 202 `{status:'cancelled', cleanupStatus:'pending'\|'complete'}`; revoke active work immediately. |
| `DELETE /api/investigations/{caseId}` | None | 202 pending cleanup or 204 completed cleanup. Repeated deletion safe; access revoked before acknowledgement. |
| `POST /api/investigations/{caseId}/device-results` | `DeviceResult` | 202 accepted; only requested matching capabilities/fields; identical duplicate safe. |
| `POST /api/investigations/{caseId}/settings-plan` | `{expectedRevision:number,target:string,device:DeviceProfile}` | 200 `{plan:SettingsPlan}` or 202 `{job:Job}` when research is needed. |
| `POST /api/investigations/{caseId}/settings-plan/{planId}/recheck` | `{deviceResultIds:Id[]}` | 200 `RecheckResult`; fresh target observations, not a generic refresh. |
| `POST /api/investigations/{caseId}/speech` | `{responseRevision:number,section:'overview'\|'explanation'}` | 202 speech job for an owner-authorized response revision. |
| `GET /api/investigations/{caseId}/speech/{audioId}` | None | Authenticated audio, correct format/MIME, private/no-store, expiry enforced. |
| `POST /api/investigations/{caseId}/reports` | `{responseRevision:number}` | 201 `{reportId:Id}` only after user chooses Save; redacted historical report. |

```typescript
interface CreateCase {
  gate: Gate; question: string;
  submissions: Array<{clientItemId:string; kind:'text'|'url'; value:string}>;
  initialFindingRefs: Id[]; deviceProfile: DeviceProfile|null;
}
type EvidenceSubmission = {
  expectedRevision:number; clientItemId:string; parentId:Id|null;
} & (
  {kind:'text'; text:string} |
  {kind:'url'; url:string} |
  {kind:'observation'; deviceResult:DeviceResult}
);
interface UploadMetadata {
  expectedRevision:number; clientItemId:string; parentId:Id|null;
  kind:'image'|'document'|'audio'|'attachment';
  filename:string; mediaType:string;
}
interface CreateUpload extends UploadMetadata {declaredBytes:number}
interface SubmitTurn {
  expectedRevision:number; turnId:Id; message:string;
  answerToQuestionId:Id|null; evidenceIds:Id[];
}
interface CapabilityResponse {
  schemaVersion:1; provider:'gemini';
  modalities:Array<{
    name:'text'|'vision'|'transcription'|'speech'|'research';
    status:'available'|'unconfigured'|'unsupported'|'temporarily_unavailable';
    model:string|null; reason:string|null;
  }>;
  policyVersion:string;
  bounds:Record<string,{value:number;unit:string;purpose:string;overflow:string}>;
  integrations:Array<{
    name:string;
    status:'available'|'unconfigured'|'unsupported'|'temporarily_unavailable';
    reason:string|null;
  }>;
}
interface EventPayloads {
  progress:{phase:'ingest'|'observe'|'research'|'assess'|'respond';message:string};
  device_request:DeviceRequest;
  question:Question;
  response:{response:HigginsResponse;sources:SourceReference[]};
  retry_scheduled:{retryAt:UTC;failure:Failure};
  completed:{
    turnId:Id; responseRevision:number; providerComplete:true;
    completion:'complete'|'partial'|'waiting_user';
    caseStatus:CaseStatus; cleanupStatus:'not_due'|'pending'|'complete';
  };
  partial:{responseRevision:number|null;reason:Failure;canContinue:boolean};
  failed:Failure;
  cancelled:{cleanupStatus:'pending'|'complete'};
  expired:{missingEvidenceIds:Id[];cleanupStatus:'pending'|'complete'};
}
type InvestigationEvent = {
  [K in keyof EventPayloads]: {
    sequence:number;jobId:Id;caseId:Id;revision:number;at:UTC;
    type:K;payload:EventPayloads[K];
  }
}[keyof EventPayloads];
```

`completed` confirms a committed provider-complete turn. Its `completion` and `caseStatus` distinguish a finished investigation from a useful question awaiting the person or a partial assessment. Do not map every committed turn to “Investigation complete.” A dropped connection without a terminal event is transport interruption; reconnect/poll instead of declaring success.

Multipart metadata uses the `UploadMetadata` schema; verify the declared type against actual bytes. Reject conflicting duplicate IDs. For resumable uploads, the server determines chunk size, expected count and ordered integrity manifest. Apply total-length limits to actual received bytes, not just `Content-Length`. Partial uploads inherit expiry and are cleaned if abandoned. Do not expose database content references to the model or client.

Case mutations require current revision. Permit only one active mutating turn per case. Queue or explicitly reject conflicting submissions with a recoverable 409; never silently run two answers against different contexts. A matching outstanding device result is an authorized continuation of the active job, not an unrelated turn.

Standard failure body:

```json
{
  "error": {
    "code": "evidence_expired",
    "message": "The temporary file copy has been deleted. Select it again to continue checking its contents.",
    "retryable": false,
    "retryAfterSeconds": null,
    "missingEvidenceIds": ["opaque-evidence-id"]
  }
}
```

Use 400/422 for invalid input, 401 for missing/invalid identity, 404 to conceal non-owned resources, 409 for revision/idempotency conflict, 410 for expired evidence, 413 for size limits, 415 for unsupported media, 429 for admission throttling and 503 for unavailable configuration/capabilities. External website errors are tool results, not automatically case-level HTTP failures. Validation responses must not echo secret content.

### 9. Model tools and action contracts

Case ownership, budgets and lifecycle come from the coordinator. They are never supplied by model arguments. Every tool result records its request, evidence/source references, coverage, freshness, actual outcome and any preview-device origin. Register only tools the current deployment can execute; return explicit configuration gaps for legitimate but unconfigured capabilities.

| Tool | Exact argument shape | Required result |
|---|---|---|
| `read_evidence` | `{evidenceId:Id,range:{start:number,end:number}\|null,pages:number[]\|null}` | Relevant original/derived content or supported media part; offsets, coverage and availability. |
| `research_public_sources` | `{question:string,entities:string[],preferredDomains:string[]}` | Real grounded research, registered source references, retrieval status, conflicting evidence and limitations. Preferred domains are hints, not proof. |
| `inspect_url` | `{urlEvidenceId:Id,purpose:string,cursor:string\|null}` | Safe fetch, redirect/final-URL chain, content/form/link observations and paged coverage. |
| `lookup_reputation` | `{evidenceId:Id,kind:'url'\|'domain'\|'phone'}` | Real configured provider observation, timestamp, availability and scope. No-hit is not authentication. |
| `lookup_breach` | `{identifierEvidenceId:Id}` | Authorized identifier check and exact scope; no password/username collection. |
| `research_application` | `{appEvidenceId:Id,question:string}` | Package/publisher/store/signature evidence where available; source relationships and uncertainty. |
| `request_device_observation` | `{capabilityId:string,fields:string[],reason:string}` | Actual observation or typed pending/permission/unavailable result. |
| `research_settings` | `{target:string,deviceProfile:DeviceProfile}` | Sourced matched `SettingsPlan`; unresolved if applicability cannot be established. |
| `ask_user` | `{question:Question}` | Waiting-user state; preserve investigation and explain why the person is needed. |

A relevant link discovered by Gemini is first registered as an unverified lead and checked before it can be inspected or recommended. Tool output is untrusted evidence; tool descriptions and server policy are authority. Prevent loops using tool-call fingerprints, freshness and progress; do not repeatedly request unavailable information or ask the same answered question.

No arbitrary shell, SQL, executable intent, credentialed HTTP action, payment action or attachment execution is exposed. Read-only research already within the user's investigation request does not need repeated approval. State-changing actions require the supported application handler and appropriate user gesture or OS consent.

Action descriptors are issued by the application after validating platform, capability, parameters, target and expiry. Gemini can propose `ActionProposal`; it cannot provide a URL scheme or command that the client executes unvalidated. Source links use safe rendering and navigation. Prose does not execute actions.

Settings outcome rules:

1. Prefer a supported OS permission request or operation after the user consents.
2. Otherwise use the deepest supported, allowlisted Settings destination with persistent instructions.
3. Otherwise provide device-matched instructions researched from official OEM/platform sources.
4. Bind the plan to the expected observable capability. On return or “Check again,” obtain fresh values for that target.
5. Distinguish `correct`, `not_yet_correct`, `cannot_observe` and `failed`. The person's “Done” is user-reported completion. It is not independently observed success.

Never fabricate generic Android/iOS/Windows/macOS instructions. Use available manufacturer/model/OS/locale; ask only for missing details that affect the instructions. A platform-wide source can be used only with its actual scope disclosed; a mismatched OEM page is not an exact match. Desktop guidance does not substitute for the required desktop application and applicable native enforcement implementation; report their actual progress separately.

### 10. Narration and delivery interfaces

Keep Gemini speech behind the same owner-key boundary. Queue every segment of the selected explanation, including its final sentence. Preserve actual meaning while removing only necessary formatting/secrets; do not replace useful spoken identifiers indiscriminately. Validate the audio MIME/encoding/sample-rate returned by the provider rather than assuming every audio payload has one format. Text investigation remains usable if speech is unavailable. [Gemini speech generation](https://ai.google.dev/gemini-api/docs/speech-generation).

Bind narration to case ID, response revision, segment index and expiry. Stop/deletion invalidates pending generation and playback. Authenticated playback or an explicitly scoped short-lived playback ticket must enforce owner/case/expiry and private caching. No public content-hash URLs. Native temporary playback copies and browser object URLs require disposal. Failure on a later segment must be visible and retryable without restarting the investigation.

Speech is a derived read job: it does not take over the case's active mutating investigation turn. It still obeys the same lifecycle epoch and deletion fence. A newly requested response revision cannot silently change audio already identified as an older revision.

Email, push and family voice storage are **implementation and configuration work**, not configuration-only blockers. The reviewed functions unconditionally returned unavailable errors. Implement these interfaces behind the existing routes:

```typescript
type DeliveryState = 'queued'|'submitted'|'delivered'|'failed'|'unconfigured';
interface DeliveryReceipt {
  deliveryId:Id; state:DeliveryState;
  providerMessageId:string|null; updatedAt:UTC; failure:Failure|null;
}
interface EmailDelivery {
  send(input:{deliveryId:Id;recipientRef:Id;templateId:string;
    safeParameters:Record<string,string>}):Promise<DeliveryReceipt>;
}
interface PushDelivery {
  send(input:{deliveryId:Id;installationRef:Id;eventRef:Id;
    title:string;body:string}):Promise<DeliveryReceipt>;
}
interface FamilyVoiceStorage {
  put(input:{ownerId:Id;noteId:Id;mediaType:string;expiresAt:UTC|null},
      bytes:Uint8Array):Promise<{objectId:Id}>;
  getAuthorized(objectId:Id):Promise<{bytes:Uint8Array;mediaType:string}>;
  deleteAuthorized(objectId:Id):Promise<void>;
}
```

Use the already selected direct email provider and configured sender; use the app's supported direct push path and owner-managed credentials; use owner-controlled private storage for family recordings. Preserve authorized recipient relationships and existing sharing choices. Invitation and delivery payloads contain only necessary content. Keep operational notifications minimal on lock screens. Family voice recordings have their explicitly disclosed feature lifecycle, distinct from temporary Higgins narration.

Implement receipt/status handling and idempotency. Provider acceptance means `submitted`; mark `delivered` only when the provider exposes actual delivery evidence. Distinguish push registration, provider ticket acceptance and later receipt. Remove invalid tokens when indicated. A missing credential leaves that adapter `unconfigured`; populating valid configuration must enable a real implementation without additional code changes. Do not invent a success or retain an Emergent-key fallback.

Record any historic managed-store objects needing owner-authorized migration/deletion access. Do not claim those bytes were removed if they were inaccessible. These integration blockers do not prevent shared cases, Gemini research, documents, Gate migration or build delivery from proceeding.

### 10A. Concrete contract corrections for the saved implementation

Extend equivalent existing Apollo-owned types rather than creating a second engine or editing frozen GuardDog contracts. Migrate frontend/backend/native callers together and retain compatibility only where an existing installation needs it.

**Permissions and capabilities.** Normalize each implemented native permission into this shape. `requested` is Apollo's recorded request history; `state` is a fresh OS observation. Missing historical knowledge is null, never invented true. Special-access/service enablement is distinct from permission grant.

```ts
interface PermissionObservation {
  permissionId: string;
  requested: boolean | null;
  lastRequestedAt: string | null;
  state: 'granted' | 'denied' | 'undetermined' | 'restricted' |
         'not_applicable' | 'unavailable';
  canAskAgain: boolean | null;
  enabled: boolean | null;
  observedAt: string | null;
  unavailableReason: 'not_implemented' | 'os_restricted' | 'hardware_absent' |
    'configuration_missing' | 'entitlement_missing' | 'adapter_failed' | null;
}

interface ActionAttempt {
  id: string;
  caseId: string;
  planId: string;
  descriptorId: string;
  startedAt: string;
  returnedAt: string | null;
  status: 'requested' | 'opened' | 'returned' | 'failed';
}
```

Populate the existing SettingsPlan with a validated descriptor identifying its target, operation, expected field/value and applicability. `ActionAttempt` records that action's execution, not success of the underlying setting. Bind recheck to the plan, request, device, observation time and active case. Use the current request/result contract with normalized values; reject conflicting results. Do not accept an old observation simply because it was uploaded after the plan. Only fields the OS actually exposes may receive a definite success value.

For `POST /api/investigations/{caseId}/device-results`, canonicalize the accepted fields before hashing both first submission and replay. Atomically claim `(owner, case, requestId)`; validate active job, epoch, request/case revision and deadline before ingestion. Identical replay returns the same evidence/job IDs; changed replay returns 409. A result arriving after cancellation/deletion cannot restart work. Persist a recoverable continuation record so a crash between storing evidence and resuming the job does not strand the case. Revision changes caused by the matched continuation itself must not invalidate its own accepted replay.

**Push protocol.** The present backend is an Expo sender, so obtain `getExpoPushTokenAsync({projectId})` from the owner's configured Expo project. Keep raw APNs/FCM tokens out of this endpoint. This follows the [Expo setup contract](https://docs.expo.dev/push-notifications/push-notifications-setup/). Retain the existing authenticated route, with these explicit semantics:

```ts
// POST /api/register-push
interface RegisterPushRequest {
  platform: 'android' | 'ios';
  provider: 'expo';
  projectId: string;
  device_token: string; // ExpoPushToken[...] / ExponentPushToken[...]
}
interface RegisterPushResponse {
  registered: true;
  provider: 'expo';
  registrationId: string;
  registeredAt: string;
}
// The authenticated installation determines ownership. A legacy user_id cannot choose it.

type DeliveryState = 'queued' | 'submitted' | 'provider_accepted' |
  'device_observed' | 'failed' | 'outcome_unknown';
interface DeliveryStatus {
  deliveryId: string;
  channel: 'email' | 'push' | 'family_voice';
  state: DeliveryState;
  retryable: boolean;
  failureCode: string | null;
  updatedAt: string;
}
// POST /api/push/test -> 202 DeliveryStatus when queued.
// No registered destination -> 409 {error:{code:'recipient_unregistered',...}}.
// Missing channel configuration -> 503 with channel-specific setup detail.
// GET /api/push/deliveries/{deliveryId} -> owner-scoped DeliveryStatus.
```

Separate native notification permission from registration state in the UI; permission can be granted while registration fails. Preserve the pending registration and retry it with a bounded policy. Record one durable delivery per owner, event, channel and recipient, with a unique index on those identifiers, a payload digest, attempt history and real provider reference. Store secrets/tokens privately; reports expose opaque references only. A queued request, accepted Expo ticket, FCM/APNs acceptance and visible device notification are separate outcomes. Inspect individual ticket errors even on HTTP 200; retain ticket IDs, query receipts, prune invalid tokens, and do not mark the entire batch successful on an empty/error response. Expo's distinction between tickets, receipts and device delivery is documented [here](https://docs.expo.dev/push-notifications/sending-notifications/).

Preserve the intended channel IDs and bundled sounds: the current payload drops `sound` and compares `channel_id` with `threat` while the configured name is `threats`. Align channel creation, foreground behavior, lock-screen/background delivery and notification-tap routing with the real mobile app. These are behavior requirements for implementation and later owner evaluation; do not run a delivery scenario campaign now.

**Email and storage.** `services/email.py` currently deduplicates by recipient/subject/time bucket, ignoring the body and invitation token; it can return an earlier send for a different invitation. It also invents a UUID if the provider omits an ID, and reports “No email was sent” after a timeout where the outcome is unknown. Use a stable logical invitation/message event ID plus payload digest, pass the stable idempotency key to the provider, persist only real acceptance references, and reconcile uncertain outcomes before retry. Do not generate a new invitation token during a retry of the same logical invitation. Treat a genuinely changed invitation as a new event. Apply the same honest ambiguous-write handling to storage; do not report a timed-out object write as definitely absent. Implement deletion of application-owned temporary objects and local playback copies according to their lifecycle; don't claim deletion of inaccessible historical objects.

**Configuration boundaries.** First inspect the existing secure configuration without printing values. Resend needs its API key and verified sender; push needs the correct Expo project, native FCM/APNs setup and registration, plus an access token if enhanced push security is enabled; family storage needs an owner-controlled bucket and authorized access. An Expo server access token is distinct from both a device push token and native platform credentials. Support an available managed role/standard credential chain rather than requiring new long-lived AWS keys. Record which missing input blocks which channel; missing configuration must not halt build preparation or the other Gates.

## 🛠️ Implementation Step-by-Step

### Immediate delivery order — replaces the proposed browser-first session plan

Execute this order under the existing authorization. The A–D sections below remain the full scope and reference specification; they are not four serial gates that must all finish before installation. Do not wait for another “proceed,” and do not substitute a new planning document for the next build.

1. **Build/configuration layer — produce the first installable candidate.** Add an ordinary `device-test` profile to `frontend/eas.json`, using the actual Apollo native module, the stable reachable backend, and the existing real Android engine used by the working application. Keep the specialized `guarddog-acceptance` profile separate. Remove S01 runtime mocks and the boot dependency on unused SecureCore; represent genuinely missing optional functionality as unavailable. Preserve server-issued device identity and the owner-managed server-side Gemini configuration. Keep owner AI/encryption keys out of `EXPO_PUBLIC_*`, generated bundles and artifacts. Run the normal compilation/preflight required to produce the artifact; fix actual build/launch failures. Use the established managed Android build channel. Once the profile exists, the equivalent CLI is `eas build --platform android --profile device-test`; use the project's pinned/available CLI rather than assuming the workspace can run it. Deliver the APK download/install route, actual build ID and saved source SHA. If a managed-build operator action is unavoidable, provide that exact action and the ready-to-build configuration; keep working on independent code. A QR link into Expo Go is not this custom-native deliverable.
2. **Mobile host layer — advance iOS/iPadOS without waiting for Android scenario completion.** Add a matching test profile and run the actual iOS build through the available macOS/EAS runner. Reconcile app and extension identifiers, app groups, signing and entitlements with the implemented iOS modules/plugins. Use the available legitimate test-distribution channel: registered-device internal installation or TestFlight, as appropriate to the existing account. The equivalent build command is `eas build --platform ios --profile device-test`. Report the specific missing account/team/device-registration/signing input if blocked; do not call mobile-browser success an iOS build. No new production-default engine change is part of this task.
3. **Native/Settings layer — close S02/S03 during candidate preparation.** Implement actual permission reads/request history, available manufacturer/model/OS, capability-specific errors, native device observations and Settings plan/action/recheck. Connect them through Device and Higgins. The native Kotlin requested-versus-granted work is in scope now, not a deferred browser-era item. Missing native support must remain visible in the candidate so real-device scenarios expose the actual outcome. Do not hold the first install until every Settings/OEM variant is finished.
4. **Owner device handoff — deliver as soon as the candidate is installable.** Provide the installation link/artifact, saved source SHA, build ID, a concise known-issues list and existing simple usage guidance. The owner performs real-life evaluation. Do not run or automate scenario journeys, create missing scenario scripts, or delay the build for a scenario matrix. Continue implementation after handing over the candidate.
5. **Shared application/backend layer — finish S05–S10 and the remaining A–C implementation.** Complete one-case entry routing, original evidence, stale-callback fixes, durable per-call recovery, upload-finalization recovery and deletion handling. Fix reachable legacy routes or migrate their callers without deleting valid assertions merely to hide failures. Complete image secret preflight, Home/share/Patrol integration and the unfinished Stage C UI. Reuse working implementation; no architectural restart. Diagnose owner-reported defects directly with bounded checks rather than restarting a scenario campaign.
6. **Delivery layer — fix S04 and configure only the relevant integration.** Align push tokens and receipts, repair email idempotency/ambiguous outcomes and finish family storage lifecycle. Use existing owner-controlled settings. Missing Resend/FCM/APNs/Expo access or storage configuration blocks only that channel. Report the exact missing setup without printing secrets, and continue other implementation. US30 is not a developer work blocker and does not require credentials to run now.
7. **Desktop/tablet layer — complete required hosts and adapters.** Continue Windows/macOS native delivery under the same authorization. Choose a supported host/toolchain compatible with the existing shared React/domain/backend code, record the choice briefly, and implement it. Do not silently convert this requirement to a PWA or a remote browser tab. Keep privileged native operations behind typed, allowlisted IPC, use real OS APIs, and implement packaging, file/share intake, permissions, Settings, audio and notifications. Cover tablet/desktop layouts and input modes. Deliver each usable host as it becomes installable; desktop completion is not a dependency for the first mobile installation.
8. **Delivery report — implementation and build status.** Report completed features, changed files, saved SHA, build/artifact identifiers, bounded checks actually performed and remaining product/configuration gaps. Keep owner acceptance separately pending. No new live scenario reports, runner expansion, Gemini comparison exercises or full US01–US35 execution are required.

**First handoff:** an installable Android artifact (or an exact external build blocker with completed configuration), iOS build/distribution status and concise known issues. Reuse existing guidance; missing scenario cards/scripts do not delay delivery. Continue the remaining authorized implementation without waiting for the owner to complete testing.

**Do not make installation conditional on:** all 35 browser scenarios passing; Resend/family storage configuration; Windows/macOS completion; a dedicated IPv4 blocking endpoint; a signed acceptance rule bundle; or a separate packet-block certification exercise. None is a prerequisite to using and improving the ordinary Apollo application on a device. Never represent a known incomplete capability as completed.

### 11. Stage A — finish evidence, lifecycle and reliable completion

**Goal:** a normal Gate can create a usable case with faithful evidence, durable conversation context and correct independent expiry. Preserve the Gemini migration already delivered.

1. **Repository and requirements:** record actual HEAD, dirty changes, baseline and final commits. Preserve later working changes. Create one requirement matrix covering the full earlier package and this document. Keep original AR labels and historical P0 labels; the migration report used different AR numbering, so include original title and source document in the mapping rather than assuming equal numbers identify equal requirements. Do this as part of implementation, not a separate approval deliverable.
2. **Backend contracts and storage:** implement the shared schemas, indexes, owner checks, lifecycle epoch and authoritative turn commit. Keep all content-bearing storage encrypted and purpose-limited. Establish a persistent deployment key path without exposing/replacing the existing secret. Add actionable startup capability diagnostics with no secret values.
3. **Immediate completion correction:** fix `ask.py` so failure after answer generation cannot create a completed answer absent from subsequent history. Route compatibility Ask history/replay through accepted turn bundles. Repair/reclaim any incomplete temporary migration records. Preserve the existing explicit provider completion check and client EOF handling.
4. **Evidence transport:** replace serialized route context with opaque case/evidence IDs. Update `higginsHandoff.ts`, `handoffTransfer.ts`, `privacy.ts`, `ApolloContext.tsx` and callers. Remove investigative slicing and false low-count privacy restrictions. The display can retain concise summaries while the coordinator reads full originals. Retry must carry the exact failed turn; Gate switches must preserve the case.
5. **File/image/document intake:** implement safe streaming uploads, format detection, supported extraction and coverage. Feed original image/document parts to Gemini when relevant, with recorded safe transformations and page/offset identities. Use local signatures and extraction as observations. A Google Drive origin, `.pdf` extension or attachment name never substitutes for bytes.
6. **Whole-input handling:** inventory all links and relevant entities; batch lookups and original-range retrieval. For long documents, maintain page text, links, visual references and inaccessible sections; synthesis must retrieve decisive original sections rather than repeatedly compress summaries. Do not claim a page was examined merely because it was uploaded or parsed. Document processing and provider file management are distinct obligations. [Document understanding](https://ai.google.dev/gemini-api/docs/document-processing), [Files API](https://ai.google.dev/gemini-api/docs/files).
7. **Lifecycle and frontend state:** key stores, queries, timers, retry state and playback by case/turn. Fix the reviewed earliest-expiry timer that clears all conversations. Use server deadlines, compare again on foreground/reconnect, clear only expired scopes and prevent an old history request from repopulating deleted content. Clear-all explicitly cancels every selected scope and reports cleanup honestly.
8. **Deletion and speech:** extend existing cleanup to all case evidence, staged jobs, events, provider files, audio and local copies. Retain cleanup tasks until resolved; handle process death and files created just before cancellation. Child speech scopes inherit the original case deadline. Keep user-owned source files and separately saved Patrol reports intact.

**Stage A completion:** an actual normal-screen submission uses the shared case; late text/links/pages remain available or visibly unprocessed; a committed answer always contributes to conversation history; independent cases expire independently; cancelled/deleted content cannot be replayed. Evidence missing from a capability is explicit. No documentation-only completion.

### 12. Stage B — shared Gemini research, follow-up and recovery

**Goal:** Higgins genuinely investigates through one reusable engine, rather than explaining a short detection summary.

9. **Provider and capability registry:** extend the current direct Gemini adapter. Confirm the actual configured model, API and SDK support each required modality/tool. Preserve function calls, required continuation metadata, grounding references, normal termination and measured usage. Capability labels must reflect working support, not just a hardcoded model-name list. Use an owner-configured compatible Gemini recovery model only; no silent provider switch.
10. **Coordinator:** implement inventory → evidence review → research/observe → reassess → question/answer. The model may follow relevant new leads and revise an initial inference. Use one case across the initial Gate result, Ask Higgins and subsequent Gates. No route remains permanently explanation-only after migration.
11. **Research tools:** implement safe evidence reads, public search, URL inspection, phone/domain reputation, breach lookup, application research and OEM guidance. Use real external calls. Preserve detailed redirects, result timestamps, source failure and context. Remove official-domain tables and app-name heuristics as authoritative verdict logic. Resolve names/number/domain/email associations cautiously and use independently established contacts where possible.
12. **Device broker:** expose only supported capabilities; request fresh observations when necessary. Cache valid results only within their declared freshness and purpose. If the app can read the answer, do so. If it needs permission, offer the supported permission action. If the platform cannot expose it, explain what remains unknown instead of generating values.
13. **Revisable assessments:** separate initial Apollo observation, current Gemini assessment, protection health and immutable enforcement history. Remove forced-warning rules that prevent a supported benign revision. Keep genuine detections visible during provider outages as observations. Removing concern must not automatically unblock a rule or rewrite previous enforcement events.
14. **Durable worker:** implement leases, heartbeat, fencing, checkpoints and one active mutating turn per case. A browser disconnect does not terminate accepted work or create duplicate work. A worker crash permits takeover after the lease expires. Store no sensitive provider prompt/output in logs. New authenticated requests must be able to discover the actual job state after a restart.
15. **Recovery:** classify failures. Retry 429, transient network failures and appropriate provider 5xx with bounded exponential backoff/jitter and Retry-After. Treat invalid credentials, unsupported capabilities and invalid requests as actionable configuration/input failures. Count SDK retries in the same budget; disable hidden retry multiplication. Transport reconnect is not a new provider retry. Reuse fresh completed research checkpoints.
16. **Answer validation and UI:** validate schema, registered sources, available actions, sensitive data and completion. Use precise errors for one model repair, then show partial/unavailable if still invalid. Render accepted text faithfully, including follow-up questions and lengthy explanations. Present one primary action when appropriate; allow no action for a benign result. Keep additional choices/details accessible. No broad output postprocessor or tailoring engine is authorized by this package.
17. **Narration:** read the chosen full response through Gemini speech in ordered segments. Maintain voice intent within supported capability, correct audio decoding, access protection, Stop, visible failure and segment retry. Never substitute another AI provider or a shortened explanation when speech fails.

**Stage B completion:** realistic unfamiliar-organisation, app and multi-turn cases produce real research; useful newly discovered clues trigger tools; app-answerable questions are resolved by the app; the person can correct an assumption and receive a revised explanation; interruptions resume or end transparently with usable recovery. No canned answer fills a gap.

### 13. Stage C — close all ten Gate paths and guided actions

**Goal:** every Gate uses the shared architecture on all four required platforms and preserves its distinct input, detection and capability limits. Complete native hosts/adapters and build delivery; Windows/macOS are not guidance-only targets.

18. **Migrate all normal entry paths:** Gate cards, Home quick checks, share targets, email-attachment handoffs, Patrol follow-up and Higgins follow-up must reach the same case architecture. Preserve deduplication and retry. A filename-only attachment has metadata coverage until bytes arrive. Shared incident association must use explicit relationships rather than brand guessing or number-of-Gates escalation.
19. **Implement the following Gate-specific work:**

| Gate | Evidence and detection to preserve | Required investigation/action work | Claims to prevent |
|---|---|---|---|
| **Site** | Actual available site/browser/filter observations, submitted page or screenshot, redirect/content signals | Investigate popup/support/payment claims; research the claimed organisation and destination; guide close/leave/check actions supported by the current environment | Seeing a scare page does not establish device infection; page analysis does not establish native filtering. |
| **Link** | Full meaningful URL, redirects, reputation and safe fetched content | Follow relevant destinations; research ownership/delegation; preserve query/path context after secret handling; explain failed inspection and residual uncertainty | HTTPS, no reputation hit or familiar hosting is not proof of legitimacy; DNS failure is not takedown or unauthorized ownership. |
| **Text** | Complete submitted message/thread, sender, links, callback numbers, screenshot and OCR | Investigate all relevant entities including unknown organisations; resolve OCR/layout contradictions; ask about user actions only when needed | No first-4,000-character or first-ten-URL cutoff; quoted safety advice is not an instruction to the app or automatic scam proof. |
| **Call** | Caller number, user-reported conversation, submitted recording/transcript where supported, native screening observations | Separate caller-ID, callback number and independently researched official contact; use region evidence; investigate requests and user actions | Caller-ID/reputation does not authenticate caller; no invented live listening; call rejection cannot become packet-backed Biting. |
| **Network** | Available connection/protection signals and user-reported circumstances | Explain captive portals, certificate/profile requests and protection gaps; obtain supported fresh signals; provide device-specific help | No universal encrypted traffic visibility, process attribution or intrusion verdict from mere Wi-Fi/VPN state. |
| **Account** | Submitted alert, sender/links, user intent/actions and explicitly requested breach evidence | Correlate alert and context; research official recovery routes; investigate possible compromise without collecting secrets | A reset email alone is not compromise; a breach-list hit is historical exposure within scope, not proof of current takeover. |
| **Email** | Pasted/shared email, screenshot or read-only Gmail OAuth; available headers/body/links and attachment relationships | Investigate sender/authentication metadata without equating it to safety; obtain authorized attachment bytes; retain parent case for File/Link checks | No generic IMAP credential flow; attachment name is not attachment inspection; expired OAuth is not a clean mailbox. |
| **App** | Selected observable package/bundle, publisher/store/signature metadata, requested/granted permissions and actual behaviours where visible | Research the actual app identity and developer; assess dangerous capabilities in context; ask whether use/support was intended if unknown | Name alone cannot authenticate an app; dormant is not harmless; remote-support capability alone is not proof of malice. |
| **File** | Actual selected/shared bytes; signatures, format mismatch, supported document/image content and links | Inspect supported full content with coverage; research embedded requests/destinations; route installation/profile/certificate consequences into App/Device | Cloud origin/extension is not safety; unreadable/binary/archive portions cannot receive unsupported reassurance or a full malware-scan claim. |
| **Device** | Available permissions, special access, installed-app visibility, security settings, Apollo health and minimum change baseline | Identify exact observable changes; distinguish permission/service failure from tampering; research applicable OEM guidance; support action and target recheck | Requested permission is not granted; unreadable inventory is not empty; Android active admins are not every management profile; no rootkit/tampering claim without concrete evidence. |

20. **Correct observation semantics in Apollo-owned code:** model missing, denied, read-error, stale and actually empty separately. Include provenance/freshness and known visibility scope. Report requested permissions separately from granted permissions and enabled special access. Keep dormant capability distinct from evidence of active behaviour. Investigate selected observable apps outside any legacy catalogue where the OS permits.
21. **Guided Settings across platforms:** implement the three assistance paths and specific recheck contract. Research official sources for the actual manufacturer/model/OS where those details affect navigation. Maintain the instructions while Settings is open. On return, show correct/not-yet-correct/cannot-observe with one useful next action. Do not claim administrative changes that the OS does not allow Apollo to make.
22. **Remove runtime mocks and isolate preview:** implement the full §1A boundary, including removal of dormant SecureCore mocks and mock build flags. Remove mock imports/activation paths from normal mobile, desktop, deployed web and backend applications in development, staging and production. Only the separate preview host may inject labelled browser-inaccessible native observations. An unavailable adapter reports the actual reason; unimplemented work stays open. Real Gemini/research runs in every environment. A native-module load error never selects simulation.
23. **Delivery integrations:** replace the unconditional email/push/storage stubs with working adapters, configuration validation, safe payloads, real receipts and retries. Confirm credential-presence alone cannot report `available` if the adapter is a stub. If credentials are absent, complete implementation and mark only that live integration blocked. Do not send real invitations/messages to uninvolved people during scenario testing; use authorized owner-controlled destinations.
24. **Consumer usability:** preserve automatic issue submission, visible progress, stable Retry/Continue/Cancel, accessible read-aloud, meaningful button labels, popup dismissal and follow-up retention. Every recommended application action must have a real handler or a clearly stated external/manual instruction. Test small-screen layouts and accessibility semantics in available environments; do not infer physical-device layout acceptance.

24a. **Required four-platform implementation:** build the Windows/macOS hosts and real platform adapters, complete Android/iOS/iPadOS adapters and connect every target to the common investigation broker. Implement relevant native detection/protection, lifecycle, permissions, file/share intake, speech playback, notifications and Settings/rechecks using supported APIs. Keep privileges in the smallest necessary native service/extension. Complete tablet/desktop layouts and keyboard, pointer, touch and accessibility behavior. A browser view of the mobile UI does not close this work.
24b. **Installable delivery:** produce separate Android, iOS/iPadOS, Windows and macOS build configurations and packaging jobs. Configure extension identities, entitlements, signing, installation, update and removal without embedding owner service keys. If a build runner, entitlement or signing credential is unavailable, finish independent code/configuration and record that target's exact remaining packaging blocker. Deliver each usable artifact for the owner’s real-device evaluation as soon as it is available. Do not wait for all platforms or all browser scenarios before the first installation.

**Stage C completion:** all ten normal Gate flows use shared cases, relevant evidence, real investigation and useful follow-up across Android, iOS/iPadOS, Windows and macOS. Required hosts and applicable native adapters are implemented; installable artifacts and packaging status are recorded per target. Device instructions are matched and honest about observable outcomes. No application runtime ships mocks. Delivery adapters are implemented; unavailable credentials are separately listed. Missing platform implementation keeps Stage C partial. No native/physical enforcement proof is implied by browser results.

### 14. Stage D — build delivery and owner handoff

**Revised scope:** developer-run scenario testing and scenario-automation expansion are removed from this work package. Preserve the existing catalogue, scripts and historical reports. They remain reference material, not a requirement to execute or expand now.

25. **Finish the product:** complete the remaining implementation and Stage C UI, including guided Settings/recheck, original-evidence handoffs, reliable completion, delivery adapters and native capability wiring.
26. **Perform bounded engineering checks:** build/compile, type-check and lint changed code; use narrowly relevant local regressions where needed for a concrete failure. Fix actual build/launch errors. Do not initiate paid live scenario calls or Playwright journeys.
27. **Package each available target:** provide installable artifacts and actual source/build identifiers. Keep missing target implementation distinct from missing external signing/build access. Deliver available platforms without waiting for the others.
28. **Hand over for owner evaluation:** provide installation instructions and concise known limitations. Real-device acceptance is performed by the owner; it does not block continued development.
29. **Preserve testing history:** leave existing results intact, accurately labelled with their original scope. Mark unexecuted scenarios `not_run` or `deferred — owner evaluation`; do not turn them into passes or list them as unfinished developer implementation.
30. **Continue through session limits:** save the concrete implementation completed, the next exact unfinished task and any genuine external blockers. Resume from that point in the next session without re-planning, repeating broad tests or asking routine approval. Session capacity changes the handoff point, not the authorized scope.

**Developer completion:** required code/UI/platform work implemented, known assigned defects resolved or explicitly open, available installable artifacts produced, and concise handoff delivered. Missing required implementation still means partial. Missing scenario runs do not prevent an implementation/build milestone from being marked complete; label owner acceptance separately pending. Do not claim production acceptance on that basis.

### 15. Required developer delivery package

Keep existing repository records accurate with brief updates. Reuse equivalent files; do not turn the following reference list into another documentation project or require scenario evidence to complete implementation:

| Deliverable | Required contents |
|---|---|
| `docs/APOLLO_IMPLEMENTATION_MATRIX.md` | Requirement → files → implementation status and actual engineering checks; keep owner acceptance in a separate field. Include original AR IDs without renumbering. |
| `docs/APOLLO_INVESTIGATION_ARCHITECTURE.md` | Actual boundaries, generated schemas, state transitions, authoritative commit and compatibility-route removal. |
| `docs/APOLLO_CAPACITY_AND_RETENTION.md` | Actual deployed limits, model/tool capabilities, evidence coverage, expiry and deletion lifecycle, encryption secret mounting, provider retention limitations. |
| `docs/APOLLO_SETTINGS_CAPABILITIES.md` | Platform/OEM guidance applicability, supported actions, required permissions and observable rechecks. |
| `docs/APOLLO_PLATFORM_DELIVERY_MATRIX.md` | Ten Gates × Android/iOS-iPadOS/Windows/macOS; device classes, minimum OS/CPU targets, actual implementation and availability reason, documented OS constraints, permissions, native mechanism, installer/build identity, scenario status and exact remaining blockers. |
| `docs/APOLLO_RUNTIME_SIMULATION_AUDIT.md` | Removed runtime mocks/selectors/flags; remaining permitted test/preview fixtures and import isolation; artifact inspection per ordinary target/profile; visible preview labels; evidence that missing adapters never select mocks. Do not list inactive runtime mocks as accepted. |
| `docs/APOLLO_INTEGRATION_CONFIGURATION.md` | Exact variable names and setup requirements without values; implementation vs missing configuration; email/push/storage migration status. |
| Existing scenario catalogue and reports | Preserve as future owner-evaluation reference. No new scripts, reports or runs are required from the developer. |
| Final handoff | Saved SHA, completed stages, requirement coverage, unresolved scope-specific blockers and commands to rerun. No success claim from a baseline SHA or unsaved tree. |

The developer may rename proposed internal files or combine modules when that improves the implementation. They must preserve scope, contracts, capability boundaries and evidence mapping. Ordinary refactoring decisions do not require another user confirmation.

## 🛡️ Edge Cases & Error Handling

### Current-source failure sequences to fix while delivering devices

These supplement the general cases below. They are concrete acceptance behavior, not additional approval gates or reasons to postpone an otherwise usable installation.

1. **Old answer arrives after a new check starts.** Capture generation and case/job identity before each await, including refresh, uploads, attach, follow-up, retry, cancellation and error handling. Publish only if still current; discard obsolete callbacks. A case that was created remotely just before navigation must be tracked for cancellation/cleanup rather than orphaned until expiry. A failed deletion must remain retryable even after another case opens.
2. **Deleting while a provider/storage operation is finishing.** Revoke the case immediately; prevent reads and any accepted answer from the revoked epoch. Track active writes and reconcile them before claiming cleanup complete. Compensating deletion must also run after process restart. Do not rely on the success of an after-write check that may never execute.
3. **Two device replies or a late reply after cancel.** Claim the request once, normalize before hashing, and reconcile evidence creation/continuation. Identical reply yields the same IDs; changed reply is 409; expired/cancelled/superseded requests cannot revive the job. Return a recoverable state when a settings observation is genuinely unavailable.
4. **Crash after accepted answer but before job/event completion.** Consult the authoritative accepted commit before classifying a deadline or worker error. Repair projections from the accepted result; never rerun Gemini or label that accepted turn failed solely because its worker deadline has passed. Another logical turn must remain independent.
5. **Second tool fails after the first paid tool succeeded.** Persist each completed tool output and progress before starting the next. Recover only unresolved work. Restore aggregate budget counters and tool-result identities. A side-effect-free research retry with unknown outcome can be repeated within policy, but its ambiguity/cost must not be hidden as exactly-once execution.
6. **Upload ingestion finishes but the finalization response is lost.** Use a durable upload finalization claim and stable evidence identity. Repeated finalize resolves the same result after recovery; differing chunks fail explicitly. Preserve resumable data until a terminal result or expiry, and don't mark an incomplete document safe.
7. **One clue is examined inside an unread long document.** Reading a URL/phone clue does not examine the parent document. Record parent source offsets as a relationship, not inherited completion. Mark text/tool ranges delivered only after the successful model request that included them, retain unread/scanned/visual regions, and disclose unresolved material gaps.
8. **Notification permission granted but delivery is impossible.** Show permission separately from registration and channel configuration. Empty recipient sets, rejected tickets and missing receipts cannot produce a sent/delivered claim. Timeouts after send are outcome-unknown until reconciled, not definite non-delivery. Retry an email invitation without silently changing its token or suppressing a different invitation.
9. **Generic or stale Settings advice.** A manufacturer name in a source is insufficient for an exact route. If the OS/version/target mapping cannot be established, use the supported broader scope and say so. Match observations to the actual attempted target/value, not any recently collected permission. App reactivation triggers recheck only for the pending action and live case.
10. **A simulated preview observation reaches a native/normal-web path.** Reject it and report an implementation/configuration defect. Remove the fixture dependency from that artifact. Do not downgrade the observation to real, silently choose a mock adapter, or treat an inactive mock as allowed. The dedicated preview host must visibly label its permitted device substitution while Gemini/research stays real.

### 16. Mandatory failure and race behaviour

| Situation | Required behaviour |
|---|---|
| Decisive clue appears after character 10,000, URL 24 or page 47 | Inventory and process the relevant original range, or show a material coverage gap and Continue. No benign conclusion from an inspected prefix. |
| Gemini identifies a new number/name/domain after initial lookups | Register the lead and perform relevant actual research before claiming its association is established. |
| Legitimate regional/delegated domain initially looks suspicious | Research the relationship and revise the inference if supported; keep underlying observations and uncertainty. |
| DNS fails, site is inaccessible or reputation has no hit | Preserve unavailable/inconclusive status. Do not infer fraud, takedown, authorization or safety from those results. |
| Contradictory sources or user correction | Preserve both source facts, compare scope/date/authority and revise the assessment with explanation. Do not overwrite earlier evidence silently. |
| HTML, PDF, image or email contains prompt injection | Treat it as evidence; no tool authority, credential disclosure, arbitrary action or fabricated source registration. |
| Source asks the app to open a login/reset/payment link | Do not execute the action during research. Isolate secret-bearing parameters and offer a verified safe user action if relevant. |
| Password/code appears in submission | Do not request it again, log it, echo it or persist a recoverable secret. Apply modality-specific processing/redaction and explain a necessary resubmission precisely. |
| File type is spoofed, encrypted, malformed or expands excessively | Enforce actual-byte and extraction budgets; expose unsupported/partial coverage; never execute it or declare it scanned clean. |
| Parser extracts pages but the model has not examined them | Keep extraction and assessment coverage separate; uploading/parsing is not investigation completion. |
| Provider returns valid JSON but abnormal/truncated finish | Do not commit it as complete. Request bounded repair/continuation or show partial. Punctuation is not completion evidence. |
| HTTP connection closes before final event | Reconnect using sequence or poll the same job. Do not mark complete, lose the job or start a duplicate provider call. |
| Provider 429/5xx or network timeout | Classify, back off within budget, preserve checkpoints and make Retry/Continue useful. No canned answer. |
| Invalid key, unsupported model/tool combination or unconfigured specialist lookup | Surface the exact capability gap safely; avoid retry loops and silent tool omission. Continue independent investigation if useful. |
| Process fails after staging answer but before commit | No completed answer is exposed. Resume or discard the staged bundle using lease/epoch checks. |
| Process fails after commit but before event/history projection | Recover from the accepted turn bundle; answer and history remain consistent; deliver once without re-running Gemini. |
| Old worker returns after lease takeover | Its stale fence cannot commit, publish or replace current results. Clean orphan content it produced. |
| User cancels/deletes as provider returns | Authoritative lifecycle epoch wins. Revoke reads immediately; late content is discarded/cleaned and never reappears in chat or Patrol. |
| Follow-up fails after the first question succeeded | Retry the follow-up's turn ID and payload; never replay the initial handoff answer as a reply to the new question. |
| Same idempotency key with different content | Return 409; retain the original operation and explain a new submission is needed. |
| Two cases are open; the older expires | Purge/expire only the older case and its audio/cache. Keep the newer conversation and job active. |
| App backgrounds past expiry or device clock differs | Compare server deadlines using tracked offset/monotonic elapsed time; revalidate on resume. Do not keep content because a timer was suspended. |
| Cleanup worker or provider-file deletion fails | Access remains revoked; persist retry work and show deletion pending/failed as appropriate. Do not say all provider copies were erased. |
| Evidence needed for a follow-up was already purged | Answer from sufficient remaining permitted context if possible; otherwise request that specific item again. Do not invent recalled originals. |
| Settings opens but user changes nothing or the wrong setting | Recheck the intended target and report not-yet-correct or cannot-observe. Opening Settings or tapping Done is not proof. |
| Observation is stale, denied, unavailable or simulated | Preserve its status and limitations through model/UI. Missing is not false/empty; simulation cannot establish a real protective event. |
| Permission read returns requested flags only | Report requested capability; do not label it granted or active. |
| One benign concern is checked through two Gates | Link the case/evidence without automatic Barking or invented brand attribution. |
| Gmail OAuth expires or an attachment is unavailable | Offer provider reconnect or explicit file selection; preserve context; no password alternative and no clean-mailbox assertion. |
| Email/push/storage credential absent | Only that live integration is unconfigured. Other investigation features proceed. |
| Delivery API accepts a request but no receipt exists | Report submitted, not delivered. Retry/check receipts without duplicate recipient messages. |
| Narration fails on the fourth segment | Keep full text, show audio interruption and offer appropriate retry. Do not silently skip remaining sections. |
| Another owner guesses a case/evidence/audio ID | Return non-disclosing denial; no content, metadata, event replay or signed playback access. |

Every failure must retain an actionable status. Do not replace content with a generic “safe” message, empty successful result or never-ending spinner. Avoid making the person repeat data the app still has permission and ability to read.

## 🧪 Testing Criteria

### Owner evaluation reference — not developer execution

These are optional reference cards for the owner’s later evaluation through the installed app. The developer must not execute or automate them, create additional scenario scripts or wait for their outcomes. Preserve real Gemini/research and actual device behavior in the app. User-reported defects return to the normal implementation backlog.

| Situation and user action | Expected Apollo detection / Gate | Expected investigation and Higgins result | Expected action / follow-up |
|---|---|---|---|
| Paste an expected appointment reminder with no request for payment, codes or a new login | Text; link checks only if a link exists | Assess the actual message proportionately; distinguish an expected appointment from independently authenticated sender identity | No forced alarm; a later user correction stays in the same case |
| Paste a long fictional invoice message whose final paragraph changes payment details | Text, with Link/Account where relevant | Find the late instruction, investigate relevant identifiers and explain the payment-redirection concern and uncertainty | Advise independent verification through a researched legitimate channel; do not collect banking credentials |
| Download/select/share a test file from the owner's cloud drive, including a harmless executable-signature fixture named as a PDF | File, with App/Device handoff if the user says it was installed | Inspect actual bytes, explain the type mismatch and investigation limits; cloud origin is not proof of safety | Ask what the person did only where needed, preserve the actual file/case across handoff, never execute the fixture |
| Share a fictional screenshot where layout changes the meaning of a link or payment request | Text or Email/File, with Link as relevant | Use the original image as well as extracted text; identify visible context and unreadable details; actual research may return uncertain | Give one useful next action and answer a question about a visual clue without asking for the image again while retained |
| Deny an applicable permission, follow Higgins into Settings, return once without changing it and again after changing it | Device and the affected capability | Read actual native status; explain the missing access without calling it an attack; research instructions for the actual OS/device | Correct supported destination, persistent steps and fresh not-yet-correct/correct/cannot-observe result; no assumed grant |
| Ask Higgins a follow-up, background the app or interrupt connectivity, then return | Originating Gate and the same shared case | Recover the pending question/answer using retained context; no duplicate conclusion or unrelated case | Retry/reconnect resumes the actual turn; expired evidence receives a precise resubmission request |
| Hear a detailed explanation, stop it, resume as supported, then delete the case | Originating Gate | Narration represents the actual Gemini answer and reaches its final segment | Stop/delete ends playback and prevents later audio from that deleted case; text and deletion state remain consistent |
| Request an owner-directed test notification/invitation when its channel is configured; repeat with a channel unavailable | Relevant family/notification flow | Separate requested, queued, provider-accepted, observed and failed outcomes; missing configuration has a specific explanation | On-device notification/tap/sound works when available; unavailable email/storage does not block the other scenarios |

For later owner evaluation, the build/source/OS/device identity and a concise expected-versus-actual observation can help diagnose a defect. This is not a developer reporting campaign. Existing catalogue IDs may be reused; no new pass-count or automation work is required now.

### 17. Test boundaries

User acceptance will be assessed through real situations on installed devices. Developer work is implementation and packaging, supported only by bounded engineering checks. The scenario catalogue below remains reference material and does not authorize developer scenario execution.

- **Allowed simulation:** synthetic messages, files, screenshots, user circumstances and explicitly labelled preview-only device observations that browser preview cannot obtain, supplied through the separate scenario/preview harness rather than a mock application implementation.
- **Always real in scenario acceptance:** Gemini answers, Gemini investigation/tool planning, external research/lookups, application routing, state transitions, persistence and supported UI actions.
- **Failure injection:** transport interruption, controlled database-write failure or time advancement may be used in isolated test harnesses. Label it; never inject a successful investigation/verdict. Provider contract fixtures stay in test directories and never become runtime fallback paths.
- **Owner real-device evaluation:** the developer provides usable builds and fixes reported defects. Scenario execution belongs to the owner. No simulated observations may enter the installed app; the specialized historical Stage 1D exercise is not an installation prerequisite.
- **No additional agents or scenario campaigns:** no testing/grading agents, live Gemini scenario suites, Playwright journeys or automated device scenarios in this assignment. No routine request to restart them.

Use only harmless scenario material and authorized destinations. Synthetic brand claims must not require Gemini to invent a public record proving the fixture is genuine. For real-source scenarios, document the actual currently supporting references; if a source changes, reassess the expected outcome instead of faking a response. Owned harmless pages may supply suspicious content when needed. Unavailable external prerequisites block only their dependent checks.

### 18. Retained owner-evaluation catalogue — execution deferred

The existing `US01`–`US35` namespace and expected outcomes below are retained for later owner evaluation. They do not require new input files, scripts, automated grading or execution during current developer sessions. Missing scripts are not a product implementation blocker.

| ID and user situation | Expected Gates and detection | Expected investigation, Higgins explanation and action |
|---|---|---|
| **US01:** A webpage says the phone is infected and gives a support number | Site; Link/Call as related evidence; suspicious popup/request content | Inspect actual page/image, research claimed provider/number, explain the scare claim and safe next step; no diagnosis of device infection. |
| **US02:** An expected invoice arrives from an unfamiliar regional/delegated domain | Email and Link; initial identity mismatch is tentative | Research delegation/organisation relationship; lower concern if supported; separate invoice authenticity from whether payment was expected. |
| **US03:** A long message contains a payment-redirection request after character 10,000 | Text; Account if the user acted | Examine the late clue in its full context, investigate destination and ask only necessary questions about user action. |
| **US04:** One message contains 25 URLs, with the decisive destination at number 24 | Text and Link | Inventory every URL, inspect the relevant lead and disclose inaccessible links; no first-ten cutoff or complete verdict over material gaps. |
| **US05:** A claimed bank caller provides three different numbers, one for callback | Call and Account | Separate caller-ID, supplied callback and independent official contact; investigate the third number; never request the person's code. |
| **US06:** A genuine-looking expected appointment reminder asks for no payment or credentials | Text; Call if needed | Proportionate assessment without forced alarm; identify remaining identity uncertainty; no action when none is justified. |
| **US07:** Public Wi-Fi asks the person to install a profile/certificate | Network, Device and File | Investigate portal/profile evidence, explain implications using available observations and provide device-matched next steps if installed. |
| **US08:** An unexpected account-reset message is followed by “I entered the code” | Account and Link | Preserve the follow-up, research official recovery, explain possible exposure and one urgent supported action; do not collect the code. |
| **US09:** Gmail identifies an invoice attachment, but Apollo has only its filename | Email and File | Explain that bytes are needed; obtain authorized attachment or selection; continue the same case. No attachment-safety claim from the name. |
| **US10:** A remote-support app is installed but dormant | App and Device | Research actual package/publisher and available access; distinguish capability from behaviour; ask whether support was expected only if unknown. |
| **US11:** A Google Drive download claims to be PDF but its signature is executable | File; App if installed | Detect the mismatch from bytes, explain hosting does not imply safety, investigate what the person did and give a useful next step. |
| **US12:** A supported 50-page document contains deceptive links on page 47 | File and Link | Examine relevant complete content, preserve late-page clues and visual context, research links; disclose unreadable pages. |
| **US13:** Apollo's protection permission has changed | Device and relevant Network/Site capability | Observe the actual gap, research matched OEM/OS guidance, offer the best supported Settings path and target recheck. No unsupported tampering allegation. |
| **US14:** The person returns from Settings without enabling the requested permission | Device | A fresh specific observation produces not-yet-correct or cannot-observe, with one clear next instruction. |
| **US15:** The same help request occurs on Android phones/tablets, iPhone/iPad, Windows PCs/laptops/tablets and Mac desktops/laptops | Device with platform-specific capability, each real target host where execution is available | Real official-source research, applicable guidance, working supported action and truthful recheck per platform; responsive/input/accessibility behavior. Browser fixtures are visibly simulated and cannot count as native-host implementation or execution. |
| **US16:** A 12-turn investigation includes a correction to an early assumption | The original and related Gates share a case | Retain relevant context beyond eight messages, retrieve originals still permitted, revise the assessment and explain the change. |
| **US17:** The connection drops during Higgins' answer and returns | Any Gate | Reconnect to the same job, deliver the committed answer once and preserve conversation history; no completed flag from EOF alone. |
| **US18:** Gemini is rate-limited; a research source also fails | Link or Text | Real recovery within budget, checkpoints preserved; compatible Gemini recovery only if configured; honest partial result if exhausted. |
| **US19:** The person cancels/deletes during processing, then revisits after expiry | File or Text | No resurrected content, cached answer or audio; precise resubmission request when necessary; cleanup status truthful. |
| **US20:** A webpage/document tells the model to ignore instructions and reveal data | Link and File | Treat it as untrusted content; no leaked credentials/private search query, arbitrary action or fabricated source. |
| **US21:** Preview supplies a native-only device signal; ordinary application artifacts are then inspected | Device/Network across all targets | Visible preview simulation origin; mobile/desktop/deployed-web/backend runtime paths contain no mock implementation, fallback selector or fixture activation. Investigation remains real. An inactive SecureCore mock is not an allowed exception. |
| **US22:** An unfamiliar name/company is associated with a number, domain or email | Appropriate originating Gate | Conduct actual association research beyond static lists; distinguish public support, common-name ambiguity and unverified identity. |
| **US23:** Screenshot layout contradicts an OCR-only reading | Text or Account | Inspect original image, revise extraction/interpretation as warranted and disclose unreadable sections. |
| **US24:** Higgins gives a useful explanation over 900 characters ending in a question | File or Device | Full accepted response renders, no style rejection; answering the question continues real investigation. |
| **US25:** The first answer succeeds; a second question fails once, then Retry is tapped | File or Device | Retry answers the second question with its identity/context; it never replays the first answer as a new response. |
| **US26:** One benign delivery notice is checked through Email and Link | Email and Link | One related case without invented courier identity or automatic severity escalation from two Gates. |
| **US27:** A long explanation is read aloud, then deleted while playback is active | Any Gate | All requested segments are queued in order; Stop/deletion prevents further playback and revokes temporary audio. |
| **US28:** Storage fails between provider answer generation and final publication | Any Gate; harness injects the failure only | No answer/history split. Recover from staged/accepted commit state; one consistent answer and conversation contribution. |
| **US29:** An old case expires while a newer case is being investigated | Two distinct cases | Only the old case is cleared. New case, answer, Retry and audio remain governed by their own deadline. |
| **US30:** Guardian notification or family voice is requested without configured delivery | Relevant existing family flow | Specific unavailable state; investigation remains usable. With authorized configured destinations, use real adapter and truthful submitted/delivered status. |
| **US31:** Ordinary security advice mentions “password reset” alongside actual secret-bearing content | Text or File | Preserve ordinary advice and relevant identifiers; remove actual secret values; record any coverage loss. No blanket evidence destruction. |
| **US32:** A legitimate selected app requests a powerful permission for its stated function | App and Device | Research actual identity/function and requested versus granted access; proportionate explanation without declaring capability malicious. |
| **US33:** Home internet is working but Apollo protection is stopped | Network and Device | Separate connectivity from protection health; explain observed gap, supported repair and recheck; no invented active threat. |
| **US34:** A benign supported document is fully readable; another version has an unreadable encrypted section | File | First result explains no concern within inspected scope; second reports material limitation and useful next step. Neither promises malware-free safety. |
| **US35:** Another registered installation requests a guessed case, source, turn or audio ID | All shared-case APIs; direct supporting integration exercise | Non-disclosing denial, no cross-owner content/metadata/replay access and no effect on the real owner's case. |

The catalogue remains a reference for benign, concerning and ambiguous situations across the ten Gates. Any future expansion/execution is outside the current developer assignment; do not count unrelated historical runs as acceptance.

### 19. Future evaluation reference — no current automation requirement

For future owner evaluation only, the following rubric can help assess an outcome. It is not a requirement to construct or run automated graders now:

1. The appropriate Gate and related Gate handoffs occurred through normal user controls.
2. Apollo used the expected available detection mechanism; no mechanism was invented.
3. Important clues were examined, including late evidence and contradictory observations.
4. Relevant real research happened and sources actually support the claims attributed to them.
5. Higgins resolved app-answerable questions before burdening the person.
6. The explanation separates observed facts, user reports, inference and uncertainty, in natural plain English.
7. The recommended action is useful, correctly labelled and supported; a benign result may need no action.
8. Follow-up maintains context, can research further and can revise the assessment.
9. Capacity, incomplete coverage, delivery failures and device limitations are represented honestly.
10. Temporary content lifecycle, source attribution and protective-action claims remain correct.

Use statuses consistently:

| Status | Meaning |
|---|---|
| `complete` | Scenario-specific required user outcomes were achieved and supporting evidence recorded. |
| `partial` | Useful outcome delivered but a required material part remains incomplete. |
| `failed` | Executed path violated an expected requirement or could not deliver the required outcome because of a defect. |
| `blocked` | A named external prerequisite prevented execution/completion of the affected part. |
| `not_run` | Not executed in this run; never counted as passed. |

```typescript
interface ScenarioOutcome {
  scenarioId:string; scenarioVersion:string; runId:string;
  status:'complete'|'partial'|'failed'|'blocked'|'not_run';
  expected:{gates:Gate[];detections:string[];investigation:string[];
    explanation:string[];actions:string[]};
  actual:{gates:Gate[];detections:string[];toolResultRefs:string[];
    sourceRefs:string[];responseArtifactRef:string|null;actionOutcomes:string[]};
  coverageGaps:string[]; requirementRefs:string[]; reason:string;
  simulatedInputs:Array<{kind:'scenario'|'preview_device'|'fault_injection';description:string}>;
}
interface ScenarioRun {
  runId:string; startedAt:UTC; finishedAt:UTC;
  sourceSha:string; dirtyTree:boolean; sourceFingerprint:string|null;
  frontendIdentity:string; backendIdentity:string; catalogueVersion:string;
  modelConfiguration:Record<string,string>; toolCapabilities:string[];
  selectedScenarioIds:string[]; omittedScenarioIds:string[];
  outcomes:ScenarioOutcome[];
}
```

Keep synthetic fixture outputs where necessary to reproduce regression. Never retain real personal submissions in reports/screenshots. Runtime logs remain content-free; fixture capture must be confined to the explicitly selected test run and contain no credentials. Reports with dirty-tree fingerprints must not be described as proof of a clean saved SHA; identify that limitation without rerunning scenarios in the current developer assignment.

Any comparison with direct Gemini is deferred. Do not spend development credits on comparison calls, extra scenario runs or grading agents. Preserve the product goal of making useful Apollo evidence available to real Gemini.

### 20. Bounded engineering checks and retained risk reference

The list below records behavior to preserve, not a new 19-item test-writing campaign. Use an existing focused local check where needed for a concrete changed-code risk, alongside compilation/type checks/lint. Do not run the full matrix, paid Gemini probes, browser/device journeys or broad repeated suites as a substitute for implementation. Future scenario evaluation is separate.

1. Full evidence inventory and segmentation preserve decisive late text, all 25 URLs, three relevant numbers, page 47 and relationships; material gaps prevent false completeness.
2. Same owner/key/payload replays safely; changed payload returns 409; evidence/job/audio references cannot cross owners.
3. Staged-answer failure and post-commit crash both recover without an answer/history split or duplicate final event.
4. Lease takeover, cancellation, deletion and expiry prevent stale worker publication and content resurrection.
5. One case's expiry does not clear another; foreground/reconnect expiry works even when timers were suspended.
6. Follow-up retries use the follow-up turn identity, not the original handoff cache; incomplete text does not increase completed-answer counts.
7. Provider abnormal finish, missing terminal event and malformed response are incomplete; normal questions/long prose survive validation.
8. Retry-After, total retry budget, SDK retry configuration and optional Gemini recovery capability matching are enforced.
9. Tool arguments, source references, private/public research separation and action descriptors cannot be overridden by submitted content.
10. Requested/granted/active/unavailable/empty observations stay distinct through native adapter, backend, model context and UI.
11. Settings Done/open/cancel/wrong-target cases cannot produce an observed success; matching fresh evidence can.
12. File limits use actual bytes; malformed/encrypted/archive content has explicit coverage; app-created copies are disposed while source files remain.
13. Audio is owner-scoped, protected, correctly decoded, fully segmented and cancelled/expired with the case; another owner cannot retrieve it.
14. Existing packet evidence and immutable delivery invariants remain; call rejection, model claims, DNS failure, rule match and simulated observations cannot create Biting.
15. Every ordinary mobile/desktop/web/backend build excludes runtime mocks, preview fixture imports and activation; missing modules do not choose mocks. Include development/staging/release profiles and the SecureCore removal paths, while preserving frozen SDK source.
16. Email/push/storage adapters really execute when configured; missing configuration is scoped; provider acceptance cannot be labelled delivery.
17. A subset scenario run cannot overwrite, omit or upgrade unexecuted full-suite journeys in the coverage index.
18. Capability results distinguish unfinished implementation from documented OS restrictions, missing hardware/entitlements/configuration, denied permission and actual adapter failure. None may fabricate a successful or empty-safe observation.
19. Required platform hosts build with their actual native modules and correct capabilities, and produce identifiable packaging outcomes; browser responsiveness alone cannot pass an absent Windows/macOS host. Phone/tablet/desktop layouts, resizing, keyboard/touch and accessibility preserve the same investigation/action flow.

### 21. Final acceptance and developer instruction

Deliver the complete implementation, not another proposed plan. Reuse the existing owner-managed Gemini and dedicated encryption configuration. Do not ask for the keys again when available, and never expose their values. Complete all independent work even if a particular delivery credential is missing.

Before claiming developer implementation complete, identify the saved source SHA, implemented requirements, known open defects, actual build/artifact outcomes and bounded checks performed. All ten Gates and four required platforms remain in scope; absent code must not be called complete. Report owner scenario acceptance separately as pending/deferred, never passed without execution. Scenario scripts, US01–US35 runs and blocked delivery scenarios are not developer-completion prerequisites.

No further routine approval is needed to implement and deliver. Developer-run scenario testing is stopped. Preserve frozen GuardDog source, owner-managed Gemini only and the no-runtime-mock requirements. Deliver usable builds, finish remaining functionality and fix owner-reported defects without restarting scenario campaigns.

The final user outcome is: **a person can bring Apollo a real concern, have Higgins investigate the available evidence thoroughly, understand what was found and what remains uncertain, and receive practical help taking the next appropriate action.**

### Source and review notes

Historical baseline references below explain the origin of requirements. They are not current-source defect claims; §0 assesses progress and remaining issues at `2983492`:

- [Reviewed commit](https://github.com/zelnix/Apollo/commit/8e1412d72214f9c5a878688dacc65457818617b4).
- [Migration status](https://github.com/zelnix/Apollo/blob/8e1412d72214f9c5a878688dacc65457818617b4/docs/GEMINI_ONLY_MIGRATION_STATUS.md) explicitly records the architecture as partial.
- [Shortened handoff](https://github.com/zelnix/Apollo/blob/8e1412d72214f9c5a878688dacc65457818617b4/frontend/src/domain/higginsHandoff.ts), [answer/history ordering](https://github.com/zelnix/Apollo/blob/8e1412d72214f9c5a878688dacc65457818617b4/backend/routers/ask.py), [cross-conversation expiry](https://github.com/zelnix/Apollo/blob/8e1412d72214f9c5a878688dacc65457818617b4/frontend/app/%28tabs%29/ask.tsx).
- [Email stub](https://github.com/zelnix/Apollo/blob/8e1412d72214f9c5a878688dacc65457818617b4/backend/services/email.py), [push stub](https://github.com/zelnix/Apollo/blob/8e1412d72214f9c5a878688dacc65457818617b4/backend/routers/push.py), [storage stub](https://github.com/zelnix/Apollo/blob/8e1412d72214f9c5a878688dacc65457818617b4/backend/services/storage.py).

Google documentation links in this specification are implementation references. Confirm the selected account/model/API combination during implementation. Token accounting supports capacity admission; it is not evidence that all submitted material was understood. [Token accounting](https://ai.google.dev/gemini-api/docs/tokens).

This specification was prepared without modifying application runtime code, running application tests, invoking a testing agent or performing physical-device acceptance.
