# Apollo Package 6 native source delivery

## Scope and baseline

- Package 6 is complete as a **source-delivery package** for iOS/iPadOS, Windows and macOS.
- Saved remediation baseline: `e5ad1c35980d03be7d04005ab35f99e5dbdc051b`; workspace metadata HEAD at Package 6 execution: `884da36eea4a8d1887a986185195cc078826f73a`.
- Mobile identity remains `app.apollo.hwg`; desktop identity remains `app.apollo.hwg.desktop`.
- Frozen GuardDog package roots are byte-unchanged (`git diff` exit 0).
- Owner-only `GEMINI_API_KEY`, completed Phase 1/2 lifecycle and evidence rules, observed-evidence-only Biting and the no-runtime-mock boundary remain unchanged.
- Signed builds, installers, notarisation, store submission and physical-device acceptance are explicitly outside this source package.

## iOS and iPadOS source delivery

- The Apollo Swift module remains the single mobile bridge and reports notification, content-blocker, device, messaging and call capabilities from observable state.
- Four extension targets resolve from Expo configuration:
  - `app.apollo.hwg.contentblocker` — Safari Content Blocker.
  - `app.apollo.hwg.calldirectory` — Call Directory identification/block list.
  - `app.apollo.hwg.messagefilter` — local `ILMessageFilterExtension` for SMS/MMS from unknown senders.
  - `app.apollo.hwg.share-extension` — explicit user Share intake.
- `ApolloMessageFilter` classifies locally, stores no raw sender/body, and writes only a digest, bounded reasons, score, source and observation time to the shared App Group.
- The containing module drains/acknowledges the bounded Message Filter queue and treats a recent real extension event as positive evidence. No event is not misrepresented as proof of enablement.
- Apple limitations remain truthful: Message Filter cannot inspect iMessage, known contacts or arbitrary third-party messaging apps; Call Directory has no general live call-content callback; Safari Content Blocker scope is Safari web content.
- App Group and extension credential metadata use `group.app.apollo.hwg.apollo` and remain subordinate to the unchanged containing bundle identity.

## Windows source delivery

- Added `ApolloProtectionService`, a Windows service using WFP ALE outbound authorization layers for IPv4 and IPv6 exact destinations.
- Rules are re-resolved and refreshed every five seconds from `%ProgramData%\Apollo\rules.txt`; filters live in an Apollo-owned dynamic sublayer and disappear if the service dies.
- WFP classify-drop events are subscribed and emitted as bounded one-event JSON files with a contract-safe ID, matched rule domain, protocol, destination, actual WFP filter ID and bounded WFP-provided application/process attribution. The queue is capped at 256 files.
- Tauri observes service installation/running state, activates/deactivates through a bounded named service action, synchronises exact-domain rules, reads/acknowledges evidence and returns `configuration_missing` when the service is absent.
- NSIS packaging config bundles the sidecar and installs/starts/removes the service. The repeatable source command builds with CMake/MSVC and invokes Tauri with the Windows override.
- Exact-domain hosts filtering remains a narrower labelled fallback for direct user block actions; it is never represented as WFP packet/flow evidence.

## macOS source delivery

- Added an Apollo-owned `NEFilterDataProvider` system extension using App Group rules and flow metadata.
- Matching outbound domains are dropped and recorded with destination, source app identifier, observed time, mechanism and verified enforced action. The Tauri bridge reads and acknowledges these records.
- Added a bounded `OSSystemExtensionRequest` activation/deactivation helper that also enables/disables `NEFilterManager`, plus System/Network Extension and App Group entitlements, an XcodeGen project and repeatable preparation/embedding scripts.
- Tauri observes the actual `systemextensionsctl` state; source presence never becomes an active claim. Missing embedding returns `configuration_missing`; installed but inactive returns `permission_needed`.
- The macOS source preparation emits an **unsigned** `.app` source candidate only. Nested signing, containing-app signing and notarisation remain build-owner operations.

## Shared truth boundaries

- The desktop adapter now distinguishes WFP/Network Extension flow filtering, exact-domain hosts fallback and no protection.
- Native status, activation, rules and evidence use fixed Tauri commands; web content cannot provide arbitrary commands, paths or shell text.
- “Threat stopped” remains evidence-only. Source presence, installation, activation intent and a stored rule are not enforcement evidence. WFP ALE and Network Extension flow drops are shown below Biting because the preserved P0 contract reserves Biting for correlated packet drops.
- Platform profiles are narrowed to observed mechanisms. Windows app/process attribution is supplied by WFP drop records; macOS app attribution is supplied by `NEFilterFlow.sourceAppIdentifier`.

## Bounded verification

- TypeScript: pass.
- ESLint: pass.
- Python lint: pass.
- Frontend Node source/unit tests: **381 passed**.
- Provider-disabled backend pytest: **61 passed**; no live Gemini call.
- Rust/Tauri: `cargo check` pass; **5 Rust unit tests passed**.
- Windows native source: MinGW x64 cross-compile and link pass; temporary PE check reported `pei-x86-64` and was deleted after verification.
- Expo public config: containing bundle plus Content Blocker, Call Directory, Message Filter and Share Extension all resolve.
- Package 6 preflight: pass.
- Staging and production security/native-dependency preflight: pass; **311 active source/config files scanned**.
- iOS/macOS native compilation: not run because this Linux host has no Xcode/Swift Apple SDK. Source/config contracts are covered by Expo resolution and focused tests; no Apple artifact is claimed.
- Source manifest: 625 frontend/backend/desktop/shared files, SHA-256 `facb85bf40e186fcb6bc61ef668a2b81b72e9250d21962914c38b66a25bff6f6` (dependencies, generated builds, caches, env files and prepared native outputs excluded).

## Handoff

- Package 6 has no remaining application-source item in this workspace.
- Save the completed Package 6 source to GitHub and provide the resulting final SHA to the build owner.
- The build owner separately performs Apple entitlement/signing/notarisation, trusted Windows installer signing, platform-host builds and physical acceptance. Those are not development backlog items for this package.
