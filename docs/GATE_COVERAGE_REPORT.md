# Apollo Gate Coverage Report — Automatic Protection

**Date:** 2026-10-04
**Scope:** Trace all 10 gates for automatic trigger → detection → action → delivery. Fixes only — no new capabilities.

---

## Change Summary

### Phase A — Call Gate (5 fixes)
| Fix | File(s) | What changed |
|-----|---------|-------------|
| A1 | `ApolloContext.tsx` | Pending-number drain loop now calls `checkNumberRisk()` with consent gate. Numbers are assessed, not discarded. Provider failures create "could not check" events. |
| A2 | `ApolloContext.tsx` | `review` decisions warn only (PatrolEvent, no auto-block). Only `avoid` writes to `autoRisky` list. |
| A3 | `patrol/[id].tsx` | Call events display country, carrier, line type, VOIP flag, fraud score. "Caller identity unverified" when no authenticated source. Country ≠ location disclaimer. |
| A4 | `ApolloSecurityModule.swift` | iOS `callerIdentification` now correctly reports `"unsupported"` — the CallDirectory extension adds no identification entries. |
| A5 | `ApolloCallScreeningService.kt` | Evidence for call blocks records `rejection_requested` not `unverified`. Unidentified-caller handling documented (device setting, not Apollo action). |

### Phase B — Text Gate (4 fixes)
| Fix | File(s) | What changed |
|-----|---------|-------------|
| B1 | `ApolloTextHandoffWorker.kt`, `ApolloSecurityModule.kt`, `messagingSdk.ts`, `nativeBridge.ts`, `ApolloContext.tsx` | Handoff worker reads backend response to capture caseId. Stores pending assessments in SharedPreferences. App-side poll loop checks investigation results and creates PatrolEvents + warnings. |
| B3 | `ApolloSecurityModule.swift` | iOS Message Filter "recently observed" window reduced from 30 days to 72 hours. `getMessagingCapabilities` now returns `messageFilterHistoricalOnly` flag. Stubs added for `getPendingTextAssessments`/`removePendingTextAssessment`. |
| B4 | `gates.ts` | Text Gate reports limitation when only historical filter activity exists. Distinguishes "background assessment running" from "notification access granted". |
| B2 | (Verified) | `/investigations/background/text` already runs full investigation including scam-pattern analysis (M01-M15 rules). No code change needed — path was complete for assessment, only result delivery was broken (fixed by B1). |

### Phase C — Email Gate + Network Gate (4 fixes)
| Fix | File(s) | What changed |
|-----|---------|-------------|
| C1 | `mailbox_monitor.py` | Retries reconcile with existing case/job — checks if investigation is still runnable or completed before creating duplicates. Reply-To and attachment filenames preserved during intake. |
| C2 | `mailbox_monitor.py` | `monitor_last_retrieval_at` tracks mailbox access. `monitor_last_assessment_at` tracks assessment completion. Email Gate can now distinguish "retrieval works but assessment fails" from "everything works". |
| C3 | `ApolloSecurityModule.kt` | `getNetworkStatus().inspectable` now reflects actual network observability (`caps != null`) not Site Gate's `requested` boolean. `vpnActive` uses real VPN service state. |
| C4 | `gates.ts` | Network Gate shows "Enable Site Gate for DNS-level traffic observation" when network is observable but VPN is not running. No longer falsely claims "running" based solely on Site Gate intent. |

---

## 10-Gate Coverage Table

| Gate | Automatic Trigger | Detection Method | Block/Warning Action | Background Operation | Platform Limits |
|------|------------------|-----------------|---------------------|---------------------|----------------|
| **Site** | DNS query to blocked host | VPN DNS sinkhole intercept (Android); Safari Content Blocker rules (iOS); WFP IP filters (Windows) | **Block**: DNS sinkhole returns local IP (Android), Safari blocks resource load (iOS), WFP drops connection (Windows) | Yes — runs as VPN service (Android), Content Blocker extension (iOS), Windows service | iOS: no per-match confirmation from Safari. Windows: IP-level blocking affects shared-hosting neighbors. Rule refresh now idempotent. |
| **Link** | User submits link OR other gate extracts link from message/email | Safe Browsing API + managed blocklist + WHOIS/domain age + Gemini analysis | **Warning**: PatrolEvent with risk assessment. **Block**: if added to Site Gate blocklist | Event-driven — runs on trigger, not continuously | Path-specific reputation preserved. Origin-only checks labeled as such. Blocklist no longer capped at 5,000. |
| **Text** | Android: notification capture (ApolloSmsListenerService). iOS: Message Filter extension (unknown SMS senders only) | Backend investigation: scam-pattern rules (M01-M15) + link reputation + sender analysis | **Warning**: PatrolEvent + push notification. iOS: `.junk` classification request (not verified block) | **Android**: Yes — capture → encrypted queue → handoff → investigation → result poll → PatrolEvent. **iOS**: local scoring in extension; no backend investigation path | Android: requires notification access permission + auto-check consent. iOS: only unknown-sender SMS; no iMessage/WhatsApp; classification ≠ blocking; 72h freshness window. |
| **Call** | Android: incoming call (ApolloCallScreeningService). iOS: static CallDirectory extension | IPQualityScore number reputation (fraud score, carrier, VOIP, recent abuse) | **avoid**: auto-reject + PatrolEvent. **review**: warning PatrolEvent only (no auto-block). **allow**: no action | **Android**: Yes — numbers queued during ring → assessed in background → PatrolEvent + toast. **iOS**: static block list only; no per-call assessment | Android: requires call-screening role + auto-check consent. iOS: no real-time lookup; CallDirectory adds blocking entries only, no identification. Provider timeout respected. |
| **Network** | Connection change (ConnectivityManager callback) | Wi-Fi security type, captive portal detection, VPN status, DNS observation (when Site Gate active) | **Warning**: PatrolEvent for open/WEP Wi-Fi, captive portal | Yes — network observer runs on connection changes | Observable without Site Gate (basic info). DNS-level observation requires active VPN. No deep packet inspection. |
| **Email** | Gmail mailbox monitoring (OAuth read-only) | Backend investigation: sender verification, Reply-To mismatch, link reputation, urgency/payment patterns, attachment filenames | **Warning**: PatrolEvent when investigation identifies concerns | Yes — periodic mailbox scan → submit to investigation pipeline → poll results | Requires Gmail OAuth connection + monitoring enabled. Retrieval ≠ assessment (now tracked separately). Temporary failures retryable; duplicates prevented. Attachment content not inspected (filename only). |
| **Account** | Triggered by other gates finding account-related indicators (email, password, breach alert) | Breach database lookup (when configured) + investigation analysis | **Warning**: PatrolEvent with breach details | Event-driven — reacts to triggers from other gates | No continuous monitoring. Breach lookup availability depends on backend configuration. |
| **File** | On-demand only (Share-to-Apollo, manual upload) | Investigation analysis of file content | **Warning**: PatrolEvent with findings | **No automatic intake** — purely on-demand | No file-system monitoring. Risky attachment types flagged by filename during email intake; actual content requires manual File Gate check. |
| **App** | On-demand only (user checks installed app or considers one) | Investigation analysis of app metadata | **Warning**: PatrolEvent with findings | **No automatic intake** — purely on-demand | iOS: no app list API. Android: can list installed packages. No background app monitoring. |
| **Device** | On-demand only (user requests device check) | Platform security signals: VPN presence, managed config, jailbreak indicators | **Warning**: PatrolEvent with security signals | **No automatic intake** — purely on-demand | Limited to platform-exposed signals. No root/jailbreak detection beyond what APIs report. |

---

## Automatic Path Status Detail

### Complete Automatic Paths (trigger → detection → action → delivery)
1. **Site Gate** (Android/iOS/Windows): DNS/Content Blocker/WFP filters ← enforcement, not just warning
2. **Call Gate** (Android): incoming call → ApolloCallScreeningService → queue → checkNumberRisk → PatrolEvent + notification
3. **Text Gate** (Android): notification capture → encrypted queue → handoff → investigation → result poll → PatrolEvent + notification
4. **Network Gate** (Android/iOS): connection change → observer → Wi-Fi security assessment → PatrolEvent
5. **Email Gate** (Gmail): OAuth scan → submit to investigation → poll result → PatrolEvent

### Partially Automatic Paths
6. **Text Gate** (iOS): Message Filter extension scores unknown SMS → `.junk` classification. No backend investigation; no PatrolEvent delivery from extension activity (events in UserDefaults, readable by app).
7. **Call Gate** (iOS): CallDirectory extension blocks numbers from static list. No per-call reputation lookup. No assessment path.

### No Automatic Path (on-demand only)
8. **File Gate**: No file-system monitoring. Attachment filenames flagged during Email Gate intake.
9. **App Gate**: No background app monitoring. Manual check only.
10. **Device Gate**: No automatic device scanning. Manual check only.
11. **Account Gate**: Event-driven from other gates. No independent automatic trigger.

---

## Status Reporting Corrections

| Gate | Before | After |
|------|--------|-------|
| Link | "Watching" (always) | "Ready when triggered" — event-driven, not continuous monitoring |
| Account | "Watching" (always) | "Ready when triggered" — event-driven, not continuous monitoring |
| Text (iOS) | "Watching" if Message Filter active in last 30 days | "Watching" only if active in last 72 hours. Historical-only gets limitation note |
| Text (Android) | "Watching" if notification access granted | "Watching" with note: background assessment runs for captured messages |
| Call | "Watching" if screening role held | "Watching" with note: automatic assessment requires consent |
| Network | "Watching" only when Site Gate VPN requested | "Watching" whenever connected (network info observable without VPN). Limitation when VPN not active. |
| Email | "Watching" after successful mailbox retrieval | Now tracks retrieval AND assessment separately — degraded state visible |

---

## Remaining Platform Limitations (cannot be fixed without new capabilities)
- iOS Call Gate: no per-call reputation lookup (Apple provides no real-time callback)
- iOS Text Gate: limited to unknown-sender SMS (no iMessage, WhatsApp, etc.)
- iOS Message Filter: classification request ≠ verified block
- File/App/Device Gates: no automatic intake mechanism exists on either platform
- Windows WFP: IP-level blocking affects all domains sharing an address (now disclosed in evidence)
- Email Gate: attachment content not inspected (filename-only heuristics)
- Call Gate: VOIP/spoofed caller ID cannot be verified by Apollo
