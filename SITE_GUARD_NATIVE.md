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
