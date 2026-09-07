# Site Guard — Native Design & Contracts

Site Guard blocks websites Apollo has **verified** as threats. It is the only path that can put Apollo
into **Biting**, so every claim it makes must be backed by the platform.

## Platform mechanisms

| Platform | Mechanism | Code | Verified block means |
|---|---|---|---|
| Android | Local, DNS-only `VpnService` (`ApolloDnsVpnService.kt`). Tunnel routes only the virtual resolver `10.111.0.1/32`; all other traffic bypasses the tunnel. Queries for blocked hosts (and subdomains) get NXDOMAIN; everything else is forwarded to the real upstream over a protected socket. | `modules/apollo-security/android/.../ApolloDnsVpnService.kt`, `ApolloSecurityModule.kt` | The service is running **and** the host is in the persisted set (`verified: true, method: "dns_filter"`). |
| iOS | Safari Content Blocker extension (`ApolloContentBlocker`). App writes `blockerList.json` to the App Group `group.<bundleId>.apollo`, calls `SFContentBlockerManager.reloadContentBlocker`. | `plugins/withApolloSiteGuard.js`, `plugins/ios/ApolloContentBlocker/*`, `modules/apollo-security/ios/ApolloSecurityModule.swift` | Reload succeeded **and** `getStateOfContentBlocker` reports enabled (`verified: true, method: "content_blocker"`). Only Safari is covered — the UI says so. |
| Mock | Simulated (labelled) | `src/security/MockSecurityAdapter.ts` | Never shipped. |

Both platforms return `verified: false, method: "none"` whenever the mechanism is not active. The app then
keeps **Barking** and explains why (`ApolloContext.blockEvent`).

## Permissions (contextual, never at launch)
- Android `vpn_config`: `VpnService.prepare()` consent dialog, requested from Guard → Site Guard → Allow.
- iOS `network_filter`: user must enable the extension in Settings › Safari › Extensions; Apollo deep-links to Settings and re-checks state on return.
- Denied/blocked → Guard shows “Open Settings”; the app keeps working with Site Guard marked *Permission required*.

## Privacy
- Android: DNS queries are parsed in memory, never logged or transmitted; upstream is the device's own resolver (fallback 1.1.1.1).
- iOS: Safari never reports which pages were blocked; the extension only serves the rule list.
- Rule/host lists live on-device (SharedPreferences / App Group UserDefaults). Nothing about browsing leaves the device.

## Build & validation
- Requires an EAS development/production build (Publish → Generate builds). Expo Go cannot load `VpnService` or app extensions.
- iOS: `app.json → extra.eas.build.experimental.ios.appExtensions` declares the extension so EAS provisions it with the App Group.
- Test plan: enable protection → Guard shows Site Guard *Active* → check `https://phishing.apollo.test/login` → Block → event shows *Apollo blocked* with *Block verified* → open the host in Chrome (Android) / Safari (iOS) → page fails to load. Disable the VPN/extension → Block must **not** verify and Apollo must stay Barking.

## Known limits (stated in UI)
- Android: apps using private DNS (DoH/DoT) or hard-coded IPs bypass DNS filtering. Site Guard visibility is *limited*, never *full*.
- iOS: other browsers and in-app web views are not covered by Safari content blockers.
- Connection Guard (unsafe Wi‑Fi) remains *Coming later*.

## Truth of state (Security Hardening Gate, iteration 29)

Apollo must never say he is guarding when he isn't. `ProtectionStatus` therefore carries three separate facts,
produced by the native layer and only *reported* by the UI (`src/domain/protectionTruth.ts` → Guard master card):

| Field | Meaning | Android source | iOS source |
|---|---|---|---|
| `requested` | The person turned protection on (intent). Persisted so it survives process death. | `SharedPreferences apollo_siteguard/protection_requested` | `UserDefaults(appGroup) apollo.siteguard.requested` |
| `operational` | Enforcement is happening **right now**, observed from the OS. Never stored. | `ApolloDnsVpnService.isRunning` (set only after `Builder.establish()` succeeds; cleared on stop/`onRevoke`/destroy) | `SFContentBlockerManager.getStateOfContentBlocker(...).isEnabled == true` **and** `blockerList.json` exists in the App Group |
| `enforcementMethod` | `dns_filter` / `content_blocker` / `none` / `simulated` (mock only) | | |
| `coverage`, `coverageScope` | Exactly what is and is not covered, in words + tags | `ApolloSecurityModule.COVERAGE` | `coverage` constant |
| `lastVerified` | When the OS observation was made | the instant `isRunning` was read | last successful `getStateOfContentBlocker` |
| `degradedReason` | Why `requested ≠ operational` (VPN permission revoked / another VPN / extension disabled / rule file missing) | | |
| `running` | Compatibility alias — always equals `operational` | | |

Guard wording: **Apollo is guarding** (requested ∧ operational) · **Apollo is guarding what he can** (requested ∧ ¬operational,
"Link checks remain active") · **Apollo is off duty** (¬requested). Pills show Requested / Enforcement / Verified separately.
`startProtection` on Android waits up to 2 s for `establish()` before answering; on iOS it answers only after Safari's
reload callback and a fresh extension-state read. `stopProtection` on iOS writes an empty rule list and reloads, so
"off" also stops enforcing.

### Coverage definition — Android DNS filter
Covered: DNS over **IPv4 / UDP / destination port 53** from apps using the system resolver (`DnsPacket.isFilterableQuery`).
**Not covered:** IPv6 DNS, DNS over TCP, Private DNS / DoH / DoT, apps with their own resolver, captive-portal networks,
and the period after a reboot until the app is opened (no boot receiver; status shows *degraded*, not *on*).
Before marketing "website protection", real-device tests must cover: Chrome/Firefox/Samsung Internet with Private DNS
off/automatic/on, IPv6-only Wi‑Fi, a second VPN taking over, VPN consent revoked in Settings, reboot.

### Coverage definition — iOS content blocker
Covered: Safari and SFSafariViewController. **Not covered:** Chrome/Firefox/other browsers, non-Safari in-app browsers,
non-browser apps. Real-device tests: extension toggled off in Settings while protection is requested (must read degraded),
rules reload after adding/removing a host, relaunch after force-quit (requested must persist, operational must be re-observed).

### Mock adapter rule
`EXPO_PUBLIC_SECURITY_MODE=mock` is preview-only. It reports `operational=false`, `enforcementMethod="simulated"`,
and `blockDestination` returns `verified=false` — so the preview can never show *Apollo is biting*, a verified block or
`THREAT_BLOCKED`. Production config rejects mock (`securityConfig.ts`).

### Native tests (Hardening Gate step 5)
- Android JVM (JUnit 4, no device):
  - `DnsPacketTest.kt` — coverage boundary (IPv4/UDP/53 only), QNAME parsing, subdomain matching, NXDOMAIN bit layout,
    reply address/port swap + IP checksum.
  - `SiteGuardTruthTest.kt` — truth derivation (`SiteGuardTruth.kt`, the pure object `ApolloSecurityModule.statusJson()`
    now delegates to): off duty never operational, permission ≠ operational, every degraded state has a reason, verified
    block needs a running filter AND an enforced host, full packet → NXDOMAIN reply path, offline known-bad stays blockable.
  - Run inside the generated android project: `cd android && ./gradlew :apollo-security:testDebugUnitTest`
    (report: `modules/apollo-security/android/build/reports/tests/testDebugUnitTest/index.html`). Needs a JDK — the Emergent
    sandbox has none; run on a dev machine or in the Publish build pipeline.
- iOS XCTest (no device): `ios/Tests/SiteGuardTruthTests.swift` — truth derivation incl. unknown ≠ on, extension-enabled-
  but-off-duty, every degraded state explains itself, pure/repeatable derivation, rule-list JSON validity, case-insensitive
  host dedupe, empty-list placeholder. Podspec `test_spec 'Tests'`; run from the generated workspace:
  `xcodebuild test -workspace ios/Apollo.xcworkspace -scheme ApolloSecurity-Unit-Tests -destination 'platform=iOS Simulator,name=iPhone 16'`.
- TypeScript (runs here): `yarn test:truth` (Guard wording from the three facts) and `yarn test:failure`
  (offline/timeout/malformed/401-vs-403 contracts, mixed state "DNS active + service down = guarding what he can").

### Physical-device verification matrix (required for sign-off)
Web preview and Expo Go run the mock adapter and are **never** evidence. Use Publish → Android + iOS builds on real phones.
Record for each row: build id, device/OS, pass/fail, screenshot of the Guard master card.

| # | Scenario | Do | Expected in Guard (requested / enforcement / verified) | Expected on the wire |
|---|----------|----|--------------------------------------------------------|----------------------|
| 1 | Fresh install, protection on | Onboard → allow VPN (Android) / enable Safari extension (iOS) | "Apollo is guarding" · Requested: on · Enforcement: active · Verified HH:MM | Android: `nslookup phishing.apollo.test` → NXDOMAIN. iOS Safari: blocked host shows Safari's blocked page |
| 2 | Permission denied | Onboard, tap Cancel on the VPN prompt / leave the extension off | "Apollo is guarding what he can" · Enforcement: not active · degraded reason names the permission / Settings › Safari › Extensions | Lookups resolve normally (nothing filtered) |
| 3 | Permission revoked mid-session | Android: Settings › VPN › Apollo → disconnect/forget. iOS: disable the extension | Within one refresh (pull down): Enforcement flips to not active, reason shown; hero never says biting | Lookups resolve normally |
| 4 | Second VPN takes over (Android) | Start any other VPN app while Apollo is on | "guarding what he can" · reason: another VPN may have taken over | Apollo's NXDOMAIN stops; other VPN's DNS answers |
| 5 | Reboot / relaunch during protection | Reboot phone, open Apollo | `requested` restored from storage; `operational` re-observed live — if the service did not restart, row 3 wording appears until you toggle | Matches the observed state, never the stored one |
| 6 | Backend unreachable + filter running | Airplane mode Wi-Fi off / block the API host, keep protection on | Banner "Apollo can't reach the security service …"; master card "Apollo is guarding what he can · DNS protection active … · Online checks unavailable right now" | Known-bad host still NXDOMAIN (decision is local) |
| 7 | Offline unknown host | Same as 6, check a never-seen clean link | "Apollo is patrolling" · pill "Online check unavailable — on-device checks only" · confidence low; no "No listing found" | Resolves normally (fail open, reported as unverified) |
| 8 | App killed, background block | Force-stop Apollo (Android), visit a blocked host from another app | Push "Apollo blocked …" arrives; Patrol shows the event with `background: true` on next open | NXDOMAIN while the VpnService keeps running |
| 9 | Verified block → Biting | Check https://phishing.apollo.test/login → "Block this destination" | Only with row 1 green: "Apollo is guarding — I blocked a dangerous website" (biting). Rows 2–4: stays barking, "Block not verified" | Row 1: NXDOMAIN for the host and subdomains |
| 10 | Recovery | Restore network after 6/7 | Banner clears only after a fresh successful call/probe; identity is NOT re-registered (same device id) | — |
| 11 | Credential revoked (admin) | `POST /api/admin/devices/{id}/revoke` from the console | "Apollo needs to re-register this phone" card; nothing syncs until the person taps "Register this phone again" | Site Guard keeps enforcing locally throughout |

### Gate sign-off rule
No green gate on unit tests alone. Step 5 is signed off when every row above passes on at least one Android and one iOS
physical device, with screenshots attached to the release notes. Until then the Home/Guard "Mock" pill and the
`securityConfig.ts` production check are the only honest statements Apollo can make about enforcement.
