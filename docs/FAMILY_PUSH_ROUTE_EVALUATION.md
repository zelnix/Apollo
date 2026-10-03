# Backend Family & Remote-Push Route Evaluation

**Date:** 2026-10-03
**Purpose:** Product decision guidance for the family safety and push notification subsystems.
**Scope:** `routers/push.py`, `routers/family.py`, `routers/family_assist.py`, `routers/family_weekly.py` and their service dependencies.

---

## Executive Summary

The family/push subsystem comprises **45 API routes** across four routers (1,229 lines), backed by **13 MongoDB collections**, **97 dedicated tests** across 15 test files, and **3 persistent background tasks**. All routes are verified healthy and return correct responses.

**The subsystem is architecturally sound and feature-complete in source.** Operational activation is blocked solely by three sets of missing external credentials. No route is dead code; every route has either a frontend consumer or an internal caller. The recommended path is staged credential provisioning, not route removal.

---

## Route Inventory

### 1. Push Delivery Infrastructure (`push.py`)

| Route | Method | Purpose | Frontend Consumer | Internal Callers |
|---|---|---|---|---|
| `/register-push` | POST | Register Expo push token | **None** (removed during Firebase cleanup) | — |
| `/push/registration` | GET | Check registration state | Settings screen | — |
| `/push/deliveries/{id}` | GET | Delivery status lookup | — | — |
| `/push/test` | POST | Send test bark notification | Settings screen | — |

**Internal functions used by other subsystems:**
- `send_push()` — called by: `family.py` (5 call sites), `family_weekly.py` (3), `family_assist/outbox.py` (1), `investigation_projector.py` (1), `push.py` itself (2)
- `push_owner_alert()` — called by: `patrol.py` (2 call sites), `investigation_projector.py` (1)
- `reconcile_receipts()` — background loop every 5 minutes

**Verdict: KEEP (foundational infrastructure)**

`send_push()` is the sole push delivery mechanism for the entire application. Even though the frontend no longer registers tokens (Firebase removal), the backend push plumbing remains the delivery path for:
- Owner threat alerts when the app is in the background
- Guardian alert fan-out (family.py)
- Weekly check-in and Tuesday nudge notifications
- Incident sharing notifications
- Voice note notifications
- Family Assist session invitations

**Activation requirement:** Set `EXPO_PUSH_ENABLED=true` and `EXPO_PUSH_ACCESS_TOKEN` in backend `.env`, then restore frontend push token registration. This is a configuration change, not a code change.

---

### 2. Family Core (`family.py`)

#### 2a. Guardian Email Alerts (4 routes)

| Route | Method | Purpose | Status |
|---|---|---|---|
| `/family/guardians` | POST | Add email guardian | Functional (email via managed sender) |
| `/family/guardians` | GET | List guardians | Functional |
| `/family/guardians/{id}` | DELETE | Remove guardian | Functional |
| `/family/confirm/{token}` | GET | Confirm invitation (public) | Functional (single-use, 72h expiry) |

**Internal:** `notify_guardians()` fans out email + push to all confirmed guardians when a barking/biting event occurs.

**Verdict: KEEP**

This is the primary family safety notification channel. Email delivery works via the platform-managed sender (`Higgins Apollo`). Push delivery to paired guardian devices is blocked on push credentials only. The email path is fully operational today.

#### 2b. Device Pairing (7 routes)

| Route | Method | Purpose | Status |
|---|---|---|---|
| `/family/pair` | POST | Generate 6-char pairing code | Functional |
| `/family/link` | POST | Link guardian device via code | Functional |
| `/family/links` | GET | List pairings (both directions) | Functional |
| `/family/links/{id}` | DELETE | Unlink (either side) | Functional |
| `/family/links/{id}/name` | PUT | Guardian sets display name | Functional |
| `/family/links/phone` | POST | Guardian sets callback number | Functional |
| `/family/shared-events` | GET | Guardian's received alerts | Functional |

**Verdict: KEEP**

Device pairing is the foundation for all in-app family features: shared events, incidents, weekly check-ins, voice notes, and screen sharing. All routes are active and have frontend consumers on the Family screen. Pairing codes expire after 24 hours; self-linking is rejected.

#### 2c. Alert Acknowledgement (2 routes)

| Route | Method | Purpose | Status |
|---|---|---|---|
| `/family/shared-events/{id}/ack` | POST | Guardian replies to alert | Functional |
| `/family/acks` | GET | Protected user sees replies | Functional |

**Verdict: KEEP**

Closes the two-way communication loop: protected user gets threat alert, guardian sees it, guardian replies ("I called them" / "I messaged them"), protected user sees the reply. Push notification to the protected user is blocked on push credentials.

#### 2d. Incident Sharing (4 routes)

| Route | Method | Purpose | Status |
|---|---|---|---|
| `/family/incidents/share` | POST | Share incident timeline | Functional |
| `/family/incidents/{id}/progress` | PATCH | Update step completion | Functional |
| `/family/incidents` | GET | Guardian's received incidents | Functional |
| `/family/incidents/{id}` | GET | Single incident detail | Functional |

**Verdict: KEEP**

The incident timeline is the structured "Stay With Me" recovery plan. Sharing it with guardians lets them track progress and provide targeted help. No content or message text is shared — only headlines, steps, and completion state.

#### 2e. Reassurance Notes (2 routes)

| Route | Method | Purpose | Status |
|---|---|---|---|
| `/family/incidents/{id}/notes` | POST | Guardian sends text note | Functional |
| `/family/incidents/{id}/notes` | GET | List notes on incident | Functional |

**Verdict: KEEP**

Preset ("I'm here", "I'm calling you now", "I'm on my way") and custom (max 140 chars) reassurance messages. Low complexity, high emotional value for vulnerable users.

#### 2f. Voice Notes (3 routes)

| Route | Method | Purpose | Status |
|---|---|---|---|
| `/family/incidents/{id}/voice` | POST | Upload voice recording | **BLOCKED** (S3 credentials) |
| `/family/voice/{id}/ticket` | GET | Get HMAC playback ticket | **BLOCKED** (no stored audio) |
| `/family/voice-play/{id}` | GET | Stream audio via ticket | **BLOCKED** (no stored audio) |

**Internal:** `sweep_voice_audio()` runs in the maintenance supervisor for retention/cleanup.

**Verdict: KEEP, activate when S3 is provisioned**

Voice notes let a guardian record a short (max 30s) familiar-voice message for a vulnerable person during an incident. Audio is stored in S3 with 30-day retention, HMAC-ticketed playback, lifecycle-aware purge on unlink, and Whisper transcription. The implementation is thorough (idempotent uploads, generation-fenced storage, orphan cleanup), but blocked on `FAMILY_STORAGE_*` S3 credentials.

---

### 3. Family Help / FF10 Screen Sharing (`family_assist.py`)

| Route | Method | Purpose | Status |
|---|---|---|---|
| `/family/assist/capabilities` | GET | Check availability | Returns `configuration_missing` |
| `/family/assist/invitations` | GET | Pending invitations | Functional |
| `/family/assist/sessions` | POST | Create sharing session | Functional (but TURN blocked) |
| `/family/assist/sessions/{id}` | GET | Session state | Functional |
| `/family/assist/sessions/{id}/respond` | POST | Accept/decline invitation | Functional |
| `/family/assist/sessions/{id}/signaling-ticket` | POST | Single-use WSS ticket | Functional |
| `/family/assist/sessions/{id}/relay-credentials` | POST | Cloudflare TURN creds | **BLOCKED** (missing token) |
| `/family/assist/sessions/{id}/pause` | POST | Pause sharing | Functional |
| `/family/assist/sessions/{id}/resume` | POST | Resume sharing | Functional |
| `/family/assist/sessions/{id}/extend` | POST | Extend session time | Functional |
| `/family/assist/sessions/{id}/native-state` | POST | Report native capture state | Functional |
| `/family/assist/sessions/{id}` | DELETE | End session | Functional |
| `/family/assist/sessions/{id}/signal` | WS | Real-time signaling | Functional |

**Backend services:** `services/family_assist/` (5 modules: sessions, config, signaling, outbox, relay_credentials, authorization, projector)
**Native modules:** Android MediaProjection + iOS ReplayKit Broadcast Upload Extension
**Background task:** Maintenance loop runs every 15 seconds for stale session cleanup.

**Verdict: KEEP (configuration-gated, complete implementation)**

This is the most complex subsystem: paired-device authorization, revision/generation fencing, single-use WSS signaling, Cloudflare temporary TURN credentials, native screen capture (video-only, view-only, no recording). The single activation dependency is `CLOUDFLARE_TURN_API_TOKEN`. The user-facing message is already truthful: "Family Help is not available yet. Your other Apollo features still work."

---

### 4. Family Weekly (`family_weekly.py`)

| Route | Method | Purpose | Status |
|---|---|---|---|
| `/family/weekly` | GET | 7-day count-only rollup | Functional |
| `/family/weekly/notify` | PUT | Opt in/out of Sunday push | Functional |
| `/family/weekly/notify` | GET | Check notification preference | Functional |
| `/family/weekly/checkin` | POST | Guardian check-in reply | Functional |
| `/family/weekly/checkins` | GET | List check-in replies | Functional |
| `/family/weekly/send-now` | POST | Manual send or preview text | Functional (preview works without push) |

**Background tasks:**
- `weekly_checkin_tick()` — Sunday 17:00–20:59 local time, sends to eligible guardians
- `missed_checkin_tick()` — Tuesday 17:00–20:59 local, nudges guardians who haven't checked in

Both respect quiet hours and device timezone. The loop runs every 15 minutes.

**Verdict: KEEP**

The weekly check-in is a gentle, recurring family connection point. Push delivery is blocked on credentials, but the in-app rollup data, text previews, and check-in replies all work without push. The Sunday/Tuesday cadence with quiet hours and opt-out is well-designed for elder care use cases.

---

## Credential Activation Roadmap

| Priority | Credential Set | Routes Unblocked | Effort |
|---|---|---|---|
| **P1** | `EXPO_PUSH_ENABLED=true` + `EXPO_PUSH_ACCESS_TOKEN` + restore frontend token registration | All push delivery: owner alerts, guardian alerts, weekly check-ins, nudges, incident shares, voice note notifications, Family Assist invitations | Config + small frontend change |
| **P2** | `FAMILY_STORAGE_*` (S3 bucket, endpoint, key, secret) | Voice note upload, playback, retention | Config only |
| **P3** | `CLOUDFLARE_TURN_API_TOKEN` (+ existing `CLOUDFLARE_TURN_KEY_ID`) | Family Help screen sharing | Config only |

---

## Collections & Data Footprint

| Collection | Router | Records per active user (est.) | Retention |
|---|---|---|---|
| `push_registrations` | push.py | 1 per device | Permanent (cleared on DeviceNotRegistered) |
| `push_deliveries` | push.py | ~5–50/week | Permanent (receipt history capped at 1024) |
| `guardians` | family.py | 0–3 | Soft-deleted |
| `pair_codes` | family.py | Transient | 24h expiry |
| `family_links` | family.py | 0–5 | Soft-deleted |
| `shared_events` | family.py | ~0–10/week | Permanent |
| `family_acks` | family.py | ~0–10/week | Permanent |
| `shared_incidents` | family.py | ~0–2/month | Permanent |
| `incident_notes` | family.py | ~0–5/incident | Permanent (voice audio: 30-day retention) |
| `family_audio_cleanup` | family.py | Transient | Cleaned by sweeper |
| `weekly_checkin_sends` | family_weekly.py | 1/guardian/week | Permanent |
| `weekly_nudge_sends` | family_weekly.py | 1/guardian/week | Permanent |
| `weekly_checkins` | family_weekly.py | 1/guardian/person/week | 8-week query window |

**Recommendation:** Add TTL indexes on `shared_events`, `family_acks`, `weekly_checkin_sends`, `weekly_nudge_sends` (90-day retention) to prevent unbounded growth in production. Not urgent for MVP.

---

## Background Tasks Impact

| Task | Frequency | CPU/IO Cost | Can Disable? |
|---|---|---|---|
| `weekly_checkin_loop` | Every 15 min | Low (DB reads, push sends only on Sunday/Tuesday windows) | Yes, remove from lifespan |
| `push_receipt_loop` | Every 5 min | Negligible (no-op when push not configured) | Auto-skips when unconfigured |
| `family_assist_loop` | Every 15 sec | Negligible (no-op when no active sessions) | Yes, but stale sessions would linger |

All three are well-behaved: they catch exceptions individually, log warnings, and continue. None blocks the event loop.

---

## Test Coverage Summary

| Test File | Tests | Subsystem |
|---|---|---|
| `test_family.py` | 16 | Guardian email, pairing, shared events |
| `test_family_assist.py` | 10 | Screen sharing sessions |
| `test_family_checkin.py` | 2 | Weekly check-in reply |
| `test_family_incidents.py` | 3 | Incident sharing |
| `test_family_notes.py` | 2 | Reassurance notes |
| `test_family_nudge.py` | 2 | Tuesday nudge |
| `test_family_unlink.py` | 5 | Unlink + rename |
| `test_family_voice.py` | 5 | Voice note lifecycle |
| `test_family_weekly.py` | 3 | Weekly rollup |
| `test_family_weekly_push.py` | 5 | Sunday push logic |
| `test_iter6_push.py` | 14 | Push registration/delivery |
| `test_iter4_guardian_ack.py` | 10 | Guardian ack flow |
| `test_iter7_quiet_and_phone.py` | 15 | Quiet hours, phone, channels |
| `test_voice.py` | 2 | TTS (Higgins voice) |
| `test_managed_email.py` | 3 | Managed email sender |
| **Total** | **97** | |

All 97 tests pass in the current suite (414 passed, 16 skipped overall).

---

## Recommendation Matrix

| Subsystem | Verdict | Rationale |
|---|---|---|
| **Push infrastructure** (`push.py`) | **KEEP** | Foundational. Used by 5+ internal callers. Dormant only because credentials aren't set. |
| **Guardian email** (`family.py` guardians) | **KEEP** | Operational today via managed email. Primary safety notification channel. |
| **Device pairing** (`family.py` pair/link) | **KEEP** | Foundation for all in-app family features. |
| **Alert ack** (`family.py` ack) | **KEEP** | Closes the family communication loop. |
| **Incident sharing** (`family.py` incidents) | **KEEP** | Core "Stay With Me" recovery feature. |
| **Reassurance notes** (`family.py` notes) | **KEEP** | Low complexity, high emotional value. |
| **Voice notes** (`family.py` voice) | **KEEP** | Complete implementation, blocked on S3 only. |
| **Family Help** (`family_assist.py`) | **KEEP** | Complete implementation, blocked on TURN only. |
| **Weekly check-in** (`family_weekly.py`) | **KEEP** | Well-designed elder care cadence. Preview works without push. |

**No routes recommended for removal or deprecation.** The subsystem is cohesive — every route serves a distinct purpose within the family safety product. The only action needed is staged credential provisioning.

---

## Security Notes

- All family routes require device bearer authentication (enforced at the router level via `enforce_device_auth`)
- Voice playback uses HMAC-ticketed URLs (10-minute expiry, note-specific) — never bearer tokens in URLs
- Guardian confirmation links are single-use with 72-hour expiry
- Pairing codes are 6-character, 24-hour expiry, single-use
- Family Assist uses single-use WSS tickets and revision/generation fencing
- Push tokens are validated against Expo format regex; raw FCM/APNs tokens are rejected
- Voice notes have 30-day retention with lifecycle-aware purge on unlink
- No raw message content is shared in incident timelines — only headlines and steps
