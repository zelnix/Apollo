# Android Physical-Device Acceptance Test Checklist

**Date:** 2026-10-03
**App Version:** 1.1.0 (versionCode 2)
**Package:** app.apollo.hwg
**Prerequisite:** Fresh APK built via EAS `device-test` or `production` profile

---

## Pre-Test Setup

| # | Step | Expected | Result |
|---|---|---|---|
| S1 | Install APK on physical Android device | Installs without error | |
| S2 | Record: Device model, Android version, build profile used | — | |
| S3 | Ensure device has internet connectivity | Connected | |
| S4 | Ensure backend is deployed and `/api/health` returns 200 | `{"status":"ok","service":"apollo-v1"}` | |

---

## 1. Launch & Onboarding

| # | Test | Expected Behaviour | Result | Notes |
|---|---|---|---|---|
| L1 | Cold launch from home screen | App opens to onboarding or Home (if previously set up). No crash, no "Apollo keeps stopping" | | |
| L2 | Complete onboarding ("Set up Apollo") | Device registers successfully, reaches Home screen | | |
| L3 | Kill app and relaunch | Home screen loads with previous state intact | | |
| L4 | Reboot device, launch app | App starts normally, device identity persists | | |
| L5 | Check Apollo state on Home | Shows "Patrolling" with correct hero animation | | |

---

## 2. UI / Navigation

| # | Test | Expected Behaviour | Result | Notes |
|---|---|---|---|---|
| U1 | Bottom tabs: Home, Guard, Higgins, Patrol | All four tabs load without crash | | |
| U2 | Home: all gate cards visible | Site, Link, Text, Call, Network, Account, Email, File, App, Device cards present | | |
| U3 | Guard tab: capabilities list | Shows protection capabilities with correct status | | |
| U4 | Settings (top-right gear) | Opens Settings screen with all sections | | |
| U5 | Family screen (from Settings or tab) | Opens with pairing, guardian, and weekly sections | | |
| U6 | Support screen | Health check card visible and functional | | |
| U7 | Scroll performance | Smooth scrolling on all screens, no jank | | |
| U8 | Back navigation | Hardware back button works correctly on all screens | | |
| U9 | Text input | Keyboard appears/dismisses correctly, no overlap | | |

---

## 3. Core Gate Checks (Manual)

| # | Test | Expected Behaviour | Result | Notes |
|---|---|---|---|---|
| G1 | Check a link: paste `https://www.abc.net.au` | Returns Patrolling/clean assessment | | |
| G2 | Check a link: paste `http://testsafebrowsing.appspot.com/s/phishing.html` | Returns Barking/threat assessment | | |
| G3 | Check a message: paste suspicious text | Returns assessment with findings | | |
| G4 | Check a call: select "Asked for money" | Returns risk assessment | | |
| G5 | Ask Higgins: type a question | Higgins responds via streaming | | |

---

## 4. PDF Generation & Saved Reports

| # | Test | Expected Behaviour | Result | Notes |
|---|---|---|---|---|
| P1 | Complete a link check, view Patrol result | Patrol card shows with headline and state | | |
| P2 | Open a Patrol event detail | Detail screen renders with findings/actions | | |
| P3 | Support > Health Check > "Check now" | Health check runs (may take ~30s), shows results | | |
| P4 | If Higgins check completes: view saved report | Report renders (may show PDF-like view or text) | | |

---

## 5. Notifications (Local)

| # | Test | Expected Behaviour | Result | Notes |
|---|---|---|---|---|
| N1 | Grant notification permission when prompted | Permission granted, Settings shows enabled | | |
| N2 | Check a known-threat link while app is in background | Local notification appears with "Apollo is barking" | | |
| N3 | Tap notification | Opens relevant Patrol event detail | | |
| N4 | Notification sound | `apollo_bark.wav` plays for threat channel | | |
| N5 | Notification channels in Android Settings | "Threats" and "Family" channels visible | | |
| N6 | Quiet hours: enable in Settings | Growling notifications suppressed during window | | |

---

## 6. Remote Push Notifications

> **NOTE:** Remote push requires `EXPO_PUSH_ENABLED=true` and `EXPO_PUSH_ACCESS_TOKEN` in backend `.env`, plus frontend token registration. Currently **NOT CONFIGURED**.

| # | Test | Expected Behaviour | Result | Notes |
|---|---|---|---|---|
| RP1 | Settings > Notifications status | Shows "Native build only" or registration state | | |
| RP2 | (If push configured) Settings > Test notification | Bark notification received | | |
| RP3 | (If push configured) Threat detected in background | Push notification received | | |

---

## 7. GuardDog Enforcement (Site Guard)

> **NOTE:** GuardDog requires signed trust inputs (manifest URL, rule bundle URL). Production engine is `guarddog_production`. This is the binary gate — see `docs/android-physical-device-acceptance.md` for the full positive/negative path matrix.

| # | Test | Expected Behaviour | Result | Notes |
|---|---|---|---|---|
| GD1 | Guard tab > Site Guard status | Shows current protection state (may be "Not included" in dev) | | |
| GD2 | (If VPN active) Browse to blocked domain in Chrome | Domain blocked (NXDOMAIN), Apollo shows "Biting" | | |
| GD3 | (If VPN active) Browse to clean domain | Normal browsing, no interference | | |
| GD4 | Check enforcement evidence via Patrol | Biting event has `verified_block=true` | | |
| GD5 | Tap "Block this destination" without real DNS query | Stays "Barking", never reaches "Biting" | | |

---

## 8. Family Features

| # | Test | Expected Behaviour | Result | Notes |
|---|---|---|---|---|
| F1 | Add email guardian | Invitation email sent via managed sender | | |
| F2 | Generate pairing code | 6-character code displayed, 24h expiry | | |
| F3 | Link second device via code | Devices paired, names visible | | |
| F4 | Weekly check-in data | Shows count-only 7-day rollup | | |
| F5 | Family Help > Overview | Shows "Not available yet" (TURN not configured) | | |
| F6 | (If push configured) Guardian receives alert | Push + in-app shared event | | |
| F7 | (If paired) Unlink device | Pairing removed, alerts stop | | |

---

## 9. Offline / Error Handling

| # | Test | Expected Behaviour | Result | Notes |
|---|---|---|---|---|
| E1 | Airplane mode: open app | ServiceBanner appears: "can't reach the security service" | | |
| E2 | Airplane mode: check a link | Shows offline/timeout error gracefully | | |
| E3 | Restore connectivity | ServiceBanner clears within 30s, app recovers | | |
| E4 | Backend down: open app | ServiceBanner appears, local features continue | | |

---

## 10. Privacy & Security

| # | Test | Expected Behaviour | Result | Notes |
|---|---|---|---|---|
| PR1 | Onboarding privacy disclosure | Shows what leaves the device and when | | |
| PR2 | Settings > Privacy section | Disclosure items visible | | |
| PR3 | No credentials in logs (logcat) | API keys, tokens, user content not logged | | |
| PR4 | Device identity persists across sessions | Same device_id after kill/relaunch | | |

---

## Final Result

| Section | Pass/Fail | Notes |
|---|---|---|
| Launch & Onboarding | | |
| UI / Navigation | | |
| Core Gate Checks | | |
| PDF / Reports | | |
| Local Notifications | | |
| Remote Push | | |
| GuardDog Enforcement | | |
| Family Features | | |
| Offline / Error | | |
| Privacy & Security | | |
| **OVERALL** | | |

**Tester:** _______________
**Date:** _______________
**Build ID/SHA:** _______________
**Device:** _______________
**Android Version:** _______________
