# Apollo iOS/iPadOS Source Readiness Completion Report

Generated: 2026-09-23T03:46:24Z

## A. Outcome

**`source_ready`**

Apollo's iOS/iPadOS source now reproducibly generates the host application plus Family Assist Broadcast Upload, Share, Safari Content Blocker, Call Directory and Message Filter extensions. Identifiers, one shared App Group, iOS 16.4 deployment settings, privacy metadata, extension embedding and source scope are internally consistent. All Emergent-available source/configuration checks pass except Expo Doctor advisories itemised below; Apple compilation, signing, archive, export and device results remain `not_run_external_toolchain`.

Remaining Apollo source work: **none identified**. External Apple-toolchain validation remains required and is not source work.

## B. Changed implementation

| Requirement | File / function or plugin | Implementation and resulting capability | Status |
|---|---|---|---|
| Reproducible target inventory | `frontend/app.json`, `plugins/withEasAppExtensionsDedupe.js` | Canonical host plus four unique app-extension records; final host App Group de-duplication | `implemented` |
| Protected Share intake | `plugins/withApolloShareIntake.js`, `plugins/ios/ApolloShareExtension/ShareViewController.swift` | Bounded multi-item inventory; per-item and aggregate size limits; 20-second timeout; protected App Group files; manifest-last atomic commit; opaque UUID handoff; explicit failure; 24-hour cleanup | `implemented` |
| Idempotent host Share import | `modules/apollo-security/ios/ApolloSecurityModule.swift`, `src/share/nativeShareHandoff.ts`, `app/share.tsx` | Validates opaque UUID, accepts only committed manifests, checks expiry, permits repeat import, records acknowledgement and supports discard | `implemented` |
| Safari truth states | `ApolloSecurityModule.blockDestination`, `unblockDestination`, `writeRules` | Separates prepared rules, reload request/failure, extension enablement and unobservable match state; never manufactures a per-destination block observation | `implemented` |
| Call Directory integrity | `ApolloSecurityModule`, `CallDirectoryHandler.swift` | Requires canonical E.164, sorts/deduplicates lists, persists list version, bounds reload callback and reports list/reload states separately | `implemented` |
| Message Filter intake | `MessageFilterExtension.swift` | Derives App Group from the extension identifier, stays local/bounded, stores redacted digests and deduplicates before host investigation | `implemented` |
| Lifecycle consistency | `ApolloSecurityModule.swift` | Serialises start/stop transitions, adds timeout/stale-callback guards and emits one protection-state event channel | `implemented` |
| Native build metadata | `src/config/buildInfo.ts`, `app/support.tsx` | Displays installed native application version/build via `expo-application`, with configured fallback outside an installed native binary | `implemented` |
| Platform configuration | `app.json`, extension plugins, `ApolloSecurity.podspec` | iPhone/iPad rotation, iOS 16.4 minimum, concise purpose strings and privacy manifest declarations | `implemented` |
| Source contracts | `tests/iosSourceReadiness.test.ts` | Deterministic identifier, scope, intake, lifecycle, metadata and navigation checks | `implemented` |

## C. Target matrix

All identifiers derive from canonical application identifier `app.apollo.hwg`; all extension targets are embedded by and depend on Apollo. `artifactId` is `null` until supplied by the external operator.

| Product | Source/config plugin | Target / expected scheme | Identifier | App Group | Framework / extension point | Required entitlement | IPC/storage | Minimum | Prebuild | Source status | Native compile | artifactId |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Apollo host | `modules/apollo-security`, Expo Router, `app.json` | `Apollo` | `app.apollo.hwg` | `group.app.apollo.hwg.apollo` | Expo Modules, UIKit, Network, SafariServices, CallKit, IdentityLookup | App Group; Wi-Fi info; notifications as provisioned | Expo native bridge plus protected App Group | 16.4 | yes | `implemented` | `not_run_external_toolchain` | `null` |
| Family Assist Broadcast | `modules/apollo-family-assist/plugin/withApolloFamilyAssist.js`, `Broadcast/SampleHandler.swift` | `ApolloFamilyAssistBroadcast` | `app.apollo.hwg.familyassistbroadcast` | same | ReplayKit, WebRTC / `com.apple.broadcast-services-upload` | App Group | one-time protected handoff; native-only transient media | 16.4 | yes | `implemented_configuration_gated` | `not_run_external_toolchain` | `null` |
| Share Extension | `withApolloShareIntake.js`, `ApolloShareExtension/ShareViewController.swift` | `ApolloShareExtension` | `app.apollo.hwg.shareextension` | same | UIKit, UniformTypeIdentifiers / `com.apple.share-services` | App Group | `ApolloShareHandoffs/<uuid>/manifest.complete.json` | 16.4 | yes | `implemented` | `not_run_external_toolchain` | `null` |
| Safari blocker | `withApolloSiteGuard.js`, `ApolloContentBlocker` | `ApolloContentBlocker` | `app.apollo.hwg.contentblocker` | same | SafariServices / `com.apple.Safari.content-blocker` | App Group | `siteguard-blocker.json`; version/prepared state in group defaults | 16.4 | yes | `implemented` | `not_run_external_toolchain` | `null` |
| Call Directory | `withApolloCallGuard.js`, `ApolloCallDirectory` | `ApolloCallDirectory` | `app.apollo.hwg.calldirectory` | same | CallKit / `com.apple.callkit.call-directory` | App Group | `callguard-lists.json`; version/prepared state in group defaults | 16.4 | yes | `implemented` | `not_run_external_toolchain` | `null` |
| Message Filter | `withApolloTextGuard.js`, `ApolloMessageFilter` | `ApolloMessageFilter` | `app.apollo.hwg.messagefilter` | same | IdentityLookup / `com.apple.identitylookup.message-filter` | App Group | bounded `apollo.messagefilter.events.v1` redacted event queue | 16.4 | yes | `implemented` | `not_run_external_toolchain` | `null` |

Each extension `Info.plist` declares its listed `NSExtensionPointIdentifier` and principal class where required. Share activation rules explicitly admit bounded URLs, text, web URLs, images, movies and files.

## D. iOS Gate capability matrix

| Gate | implementation | runtimeState | Exact iOS scope / observations | Action descriptors | Package target | Native compile | artifactId |
|---|---|---|---|---|---|---|---|
| Site | Safari Content Blocker rule preparation and reload | Requires extension user enablement; exact URL match unobservable | Safari-only enablement status, prepared rule version/time, reload result; no device-wide claim | prepare/remove Safari host rule; open extension guidance | Host + Content Blocker | `not_run_external_toolchain` | `null` |
| Link | Manual entry, clipboard and Share intake with backend investigation | Available when host launches; online intelligence may be unavailable | User-submitted URL and bounded shared context only | inspect, investigate, hand to Site Gate | Host + Share | `not_run_external_toolchain` | `null` |
| Text | Manual paste/share plus Message Filter | Filter requires user enablement; extension classification is local | Submitted message or redacted extension digest/sender digest/risk flags; no full message persisted by extension | inspect sender/message; acknowledge filtered event | Host + Share + Message Filter | `not_run_external_toolchain` | `null` |
| Call | Manual investigation plus Call Directory lists | List reload requires enabled Call Directory; no live-call observation | Canonical submitted E.164 and list/reload status only | add/remove allow/block/risky list entry; open system settings | Host + Call Directory | `not_run_external_toolchain` | `null` |
| Network | `NWPathMonitor`, supported Wi-Fi metadata and VPN interface indication | Observation may be unavailable or time out | Reachability/interface type, supported SSID/security indication and VPN presence; no Android TUN/packet claim | refresh observation; route suspicious evidence to relevant Gate | Host | `not_run_external_toolchain` | `null` |
| Account | Submitted warning evidence and authorised service evidence | Depends on user submission/provider authorisation | Warning/account event fields; never passwords, PINs, MFA codes or recovery secrets | deny unexpected prompt; recover through official service | Host + backend | `not_run_external_toolchain` | `null` |
| Email | Approved read-only OAuth and backend investigation | Depends on explicit authorisation/connectivity | Authorised email metadata/content within approved scope; attachments explicitly handed to File Gate | investigate message; inspect attachment separately | Host + backend | `not_run_external_toolchain` | `null` |
| App | Shared links/store listings and exposed device facts | No installed-app inventory on iOS | User-selected app evidence and platform-exposed facts only | inspect listing/evidence; explain settings action | Host + Share | `not_run_external_toolchain` | `null` |
| File | Explicit picker/Share intake | User-selected files only | Bounded copied item metadata and inspected bytes; no silent device/cloud scan | inspect selected file; preserve source context | Host + Share | `not_run_external_toolchain` | `null` |
| Device | Apollo state, supported permissions and exposed device facts | Limited by Apple APIs and granted permissions | Apollo lifecycle, extension states and supported device/network facts; no full-device malware scan | refresh state; show permission/settings guidance | Host | `not_run_external_toolchain` | `null` |

## E. Verification

| Command/check | Result | Important output | Remaining failure |
|---|---|---|---|
| `npx tsc --noEmit` | pass | no diagnostics | none |
| JS/TS ESLint | pass | no issues | none |
| `node --test tests/*.test.ts` | pass | full frontend TS contract suite, including 10 iOS readiness tests | none |
| `node --test tests/nativeDependencyGuard.test.cjs` | pass | 29/29 | none |
| `node scripts/security-preflight.mjs` | pass | security configuration OK | none |
| `node scripts/package6-preflight.mjs` | pass | `ios-extensions=5`, package `app.apollo.hwg` | none |
| `node scripts/native-dependency-guard.cjs` | pass | 51 native singleton names; no duplicate physical installs | none |
| `npx expo config --json` | pass | canonical identifiers, four extension records, default orientation | none |
| Disposable clean iOS prebuild, followed by a second prebuild | pass | exactly one host and five extension targets on both runs | none |
| Generated Xcode project inspection | pass | host has four dependencies and four extension embed copy phases; every target minimum 16.4 | none |
| Generated plist/privacy/entitlement parsing | pass | 14 property lists valid; host has one App Group value | none |
| Expo modules autolinking inspection | pass | `apollo-security` resolves for Apple; frozen GuardDog Expo bridge absent | none |
| `sha256sum -c APOLLO_STAGE1B_SHA256_MANIFEST.txt` from `frontend/packages` | pass | 91/91 frozen GuardDog files OK | none |
| SecureCore executable/config/native search | pass | zero references | none |
| Production/runtime-selection tests | pass | one production owner; no mock/acceptance/automatic legacy fallback | none |
| Expo Doctor | advisory | detects both lock files, dynamic-config/CNG heuristics and newer SDK patch recommendations; direct native peer is now declared | Exact scoped advisories; native singleton guard and project contract suites pass. No package-wide upgrade was performed as part of this mandate. |
| Swift/Obj-C and Xcode compilation | `not_run_external_toolchain` | Swift/Xcode toolchain absent in container | External Apple toolchain |

## F. Frozen and prohibited-source checks

- **GuardDog frozen-source integrity:** pass, 91/91 manifest entries.
- **SecureCore:** zero executable/configuration/native-project references.
- **Preview/mock native exclusion:** pass through security preflight and source contracts; development preview remains web-only.
- **Native dependency duplication:** pass; 51 native singleton package names, one physical installation each.
- **Production profile selection:** pass; production resolves only to `guarddog_production` and does not auto-fallback.

## G. External Apple build handoff

See [`APOLLO_IOS_EXTERNAL_APPLE_HANDOFF.md`](./APOLLO_IOS_EXTERNAL_APPLE_HANDOFF.md).

Build entry point is the `frontend` Expo project using the selected iOS profile in `frontend/eas.json`; clean generation is `npx expo prebuild --platform ios --clean`. Secure external inputs are Apple Developer team, distribution certificate, provisioning profiles/capability authorisations and any owner-selected distribution credentials. No secret value belongs in source.

## H. Claims explicitly not made

This report does **not** claim a new external repository SHA, CocoaPods resolution, Apple-platform Swift/Objective-C compile, Xcode scheme build, signed archive, IPA, TestFlight upload/processing, installation, physical iPhone/iPad behavior, entitlement authorisation, or artifact ID. Those remain external evidence.
