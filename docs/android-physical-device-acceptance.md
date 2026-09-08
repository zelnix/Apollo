# Android Physical-Device Acceptance — Site Guard Enforcement Evidence

Operational checklist for proving the real Kotlin enforcement chain on a physical Android
device. This is a **binary gate**: the SAME build must pass the positive path AND every negative
path below. If any negative path leaks a verified block, or the positive path fails, this
milestone is **NOT** production-validated — see merge caveat at the bottom.

Do not fake, skip, or "reason about" any row — every result must come from actually operating
the device. If a step can't be exercised, mark it `N/A` with a reason, never `PASS`.

## Build under test

| Field | Value |
|---|---|
| Commit SHA | `254a7d2de4fd66d957c1744f72b0e51974e16f0e` *(update to the SHA actually built)* |
| apollo-security module version | `1.0.0` (`modules/apollo-security/android/build.gradle`) |
| App version | `1.0.0` (`app.json`) |
| Build type (APK/AAB, debug/release) | |
| Device model | |
| Android OS version | |
| Tester | |
| Date/time (UTC) | |
| Test domain used | *(a domain you control or are explicitly authorized to test against)* |

## Positive path

Apollo VPN is ON. The test domain is already on Site Guard's blocklist (add it via "Block this
destination" in-app, or pre-seed it) **before** generating the query.

| # | Step | Expected | Result (PASS/FAIL) | Notes |
|---|---|---|---|---|
| P1 | Generate a real DNS query for the test domain from another app (e.g. Chrome, not Apollo itself — Apollo's own traffic is excluded from the tunnel) | Query is observed by `ApolloDnsVpnService.handlePacket()` | | |
| P2 | Apollo intentionally returns NXDOMAIN | Browser/app reports the domain as unreachable/not found | | |
| P3 | `getEnforcementEvidence()` | Contains a NEW record: `mechanism="dns_filter"`, `result="verified"`, `enforcedAction="blocked"`, `destination.domain` = test domain, fresh `evidenceId`/`observedAt` | | |
| P4 | Backend `POST /api/patrol/events` (from the app's sync) | `verified_block=True` in the stored/returned event (derived server-side, not because the client claimed it) | | |
| P5 | App UI | The corresponding Patrol card shows **THREAT_BLOCKED / "Apollo is biting"** | | |
| P6 | Repeat the exact same lookup a second time | **No duplicate** Patrol card/event is created (same event upgraded in place; evidence dedup by `evidenceId`) | | |

## Negative paths (must ALL fail to verify)

| # | Scenario | Action | Expected | Result (PASS/FAIL) | Notes |
|---|---|---|---|---|---|
| N1 | Manual block tap only | Tap "Block this destination" on a flagged link, do **not** generate any real traffic to it | UI stays at "barking"/current state, message reads "block rule active... will confirm once Apollo sees a connection" — never "biting"; `verified_block=False` server-side | | |
| N2 | Mock mode | Run the app in Expo Go / mock adapter, tap "Block" | "Block not verified... Apollo is still barking" — never "biting" | | |
| N3 | Flagged but not blocked | A destination is flagged/rule-matched (barking) but never added to the enforcement blocklist / no real query occurs | Never reaches THREAT_BLOCKED | | |
| N4 | Unrelated failed request | A normal network failure unrelated to Apollo (e.g. domain genuinely doesn't exist, no connectivity) | Never produces `verified_block=True` / never shows "biting" | | |

## Platform-behaviour capture (document as-is — do not "fix" by overclaiming)

| # | Scenario | Action | Result | Notes |
|---|---|---|---|---|
| D1 | Private DNS (DoT) ON | Settings → Network → Private DNS → Automatic or a hostname. Repeat the positive path (P1–P3) | Apollo sees the query and blocks it \| Apollo is **bypassed** (query never reaches `handlePacket()`) | Record whichever actually happened. If bypassed, this confirms the documented `ApolloDnsVpnService.kt` limitation — capture it, do not treat as a bug to silently patch. |
| D2 | App-level DoH (where practical, e.g. a browser with built-in DoH to a hardcoded resolver) | Repeat the positive path via that app | Apollo sees the query and blocks it \| Apollo is **bypassed** | Same as D1 — document honestly. If not practical to test, mark `N/A` with the reason. |

## Final result

`DEVICE ACCEPTANCE PASSED` / `DEVICE ACCEPTANCE FAILED` *(circle or delete one)*

Notes:

---

## Merge caveat

> Code integrated. Native Kotlin compilation and physical-device enforcement proof remain
> outstanding.

This file's result is what lifts that caveat — until a `DEVICE ACCEPTANCE PASSED` run exists for
a given commit SHA, the Android native enforcement path is **not** production-validated,
regardless of how much backend/frontend unit test coverage exists.
