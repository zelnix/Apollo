# ApolloSG: unexpected OnePlus8Pro device investigation (27 Oct 2026)

Method: read-only. I used the production admin-key GET routes (`/api/admin/devices`, `/devices/{id}`, `/audit`,
`/feedback`), which never return token hashes, plus the preview database. I did not write, revoke, reset, merge or
delete anything in either environment. The production admin portal pages that show make, model, country, install date
and counts need the owner's Google login, so the agent could not read those fields itself. They come from the owner's
screenshot.

## OnePlus8Pro: what the evidence shows

- **Record:** production device `db0ac8b8f6b74e24b899ea201b777dab`. Platform android, adapter android, app 1.1.23.
  Created, registered and last seen at the same moment: 2026-10-26 22:41:58 UTC. Token issued 22:41:58, expires
  2027-10-26. Not revoked. 0 Patrol events. 0 family links. No feedback rows. No account (ApolloSG has none).
  The record has its own anonymous ID from the server. It does not exist in the preview database.
- **Why it is this record:** production has 31 Android records in total (the full list, under the 500-row limit).
  Exactly two report app 1.1.23:
  - `3b83c58b`: registered 22 Oct, last updated 26 Oct 09:11 UTC. That is before the reported install time, so it
    cannot carry a 27 Oct install date.
  - `db0ac8b8`: matches. The install time "27 Oct 6:37 am" in Perth time (UTC+8) is 26 Oct 22:37 UTC, about
    5 minutes before this record registered.
- **How it registered:** `POST /api/devices/register`. This route is open by design, because anonymous onboarding
  ("Set up Apollo") needs it. It never sent the heartbeat that a second app launch sends, so this was one session.
- **Model and country:** both come from the phone itself via expo-device / expo-localization.
  - `Build.MANUFACTURER` = OnePlus.
  - `Build.MODEL` = "OnePlus8Pro". Retail OnePlus 8 Pro phones normally report a number such as IN2023 or IN2025.
  - "US" is the phone's region setting (`Localization.getLocales()[0].regionCode`). It is not IP geolocation.
    Google's test devices default to the en-US region.
- **Activity:**
  - Device check 1: `/first-check`, which runs automatically at step 4 of setup.
  - Device check 2: `/recheck`, which needs a tap.
  - Learn read 1: opening an article, which is a plain database read.
  - None of these calls the AI provider. The Higgins health check that a re-check starts only reads stored usage.
    TC FlyBy, Magnum DI and Ask Higgins are all 0.
  - **No AI or API cost is attributable.**
- **Build origin:** 1.1.23 is a genuine ApolloSG build version. One other device records it (`3b83c58b`), and three
  of the owner's devices are now on 1.1.24. The repo has no release log, and `app.config.js` says 1.1.0, so the
  build pipeline sets the 1.1.x version. The production build profile makes an Android App Bundle (AAB) for the
  Play Store.

**Classification: EXPECTED SYSTEM/TEST ACTIVITY (high confidence; one owner check outstanding).**
This is most likely Google Play's automatic pre-launch test (the Firebase Test Lab Robo crawler). Play installs it
after a build is uploaded to a testing track. The record has the robot's typical shape:
- one short session
- the onboarding path only
- US region
- an internal-style model name
- no investigations

Owner confirmation:
- Play Console → Testing → Pre-launch report for 1.1.23: look for a OnePlus 8 Pro / Android 11 run on 26–27 Oct.
- Admin → Devices: the row's ID should start with `db0ac8b8`.

## The ~13,485 device count

- **What it counts:** `db.devices.count_documents({})`, which is every anonymous identity ever registered. That
  includes scripts, tests and revoked records. It is not unique phones. A reinstall or cleared app data creates a
  new identity by design.
- **Copied preview data:** the production database was seeded from a copy of the preview database taken about
  2026-09-22 01:05 UTC.
  - All 348 production audit rows also exist in preview, with identical IDs. They include 116 automated
    `test_admin.py` runs from Google Cloud IPs, 8–21 Sep.
  - 506 of the 531 production device IDs fetched also exist in preview.
  - Before the snapshot, preview held 13,440 records:
    - 13,421 web, almost all `adapter_mode=mock` with the default `app_version=1.0.0` sent by test payloads
      such as `{"platform":"web","adapter_mode":"mock"}`
    - 19 Android, mock or test
  - None of the 13,440 have phone details or usage counts. 12,635 were never seen again after registering.
- **Created in production (25):**
  - 13 web script registrations: 2 parity-check devices on 23 Sep, and 11 on 23–24 Oct.
  - 6 Android "standard" script registrations on 20 Oct, with no app version sent.
  - 6 real app installs: `6f2d4e56`, `7dfe79aa`, `dd3717f3`, `8b4ed99d`, `3b83c58b` and `db0ac8b8` (the OnePlus).
- **Breakdown:** Android 31 (exact), iOS 0 (exact), Web about 13,454 (the remainder).
- **Real phones: about 6 records.** About 5 are the owner's (owner to confirm), plus the OnePlus robot.

## Security

- No evidence of unauthorised access. Registration is anonymous by design. A device token can reach only that
  device's own data. Admin routes reject device tokens.
- No ApolloSG evidence or user content was exposed. The record has no cases, Patrol events or family links.
- No sign of token misuse: one session, and the record was never seen again.
- No immediate containment is required.

## Recommended correction (diagnosis only; none applied)

1. With owner approval, after this report closes, archive or remove the roughly 13,440 copied preview test records.
   They can be identified exactly by matching IDs against the preview database. Keep `db0ac8b8` until the owner
   releases it.
2. Make the Devices page show real phones by default: android or ios, a non-mock adapter, and an app version that was
   actually sent. Keep an "All records" view.
3. Label Google's pre-launch devices. Test Lab sets the Android system setting `firebase.test.lab="true"`.
   ApolloSG's existing native module could send one `test_lab` flag at registration. No fingerprinting is needed.
4. Have scripts send a recognisable `app_version` (for example "parity-check") so script traffic is never counted
   as users.
