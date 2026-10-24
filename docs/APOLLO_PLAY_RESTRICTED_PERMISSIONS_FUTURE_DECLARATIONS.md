# Apollo — Google Play restricted permissions (READ_CALL_LOG, READ_SMS)

> ## ⛔ NOT FOR CURRENT PLAY SUBMISSION — FUTURE USE ONLY AFTER ELIGIBILITY/APPROVAL
>
> Apollo's current Google Play build declares **neither** `READ_CALL_LOG` nor `READ_SMS`.
> Do **not** paste the declarations below into Play Console now, and do **not** turn the build switch
> on until every eligibility condition in this document is met and Google has approved the declaration.

---

## 1. Current state (what ships today)

| Area | Live protection (unchanged) | Permission-free ways in | Restricted picker (retained, OFF) |
|---|---|---|---|
| **Call Guard** | `ApolloCallScreeningService` (Android `CallScreeningService`, `ROLE_CALL_SCREENING`): the number Android hands Apollo for each incoming call is checked against the person's block / allow / previously-high-risk lists before it rings. | **Calls Apollo screened**: an on-phone list (last 50, up to 30 days) of the incoming numbers Android passed to that service, each tappable to Check with Apollo. Manual type/paste on Check a number. | "Choose from your call log" (`PhonePickers.listRecentCalls`, `READ_CALL_LOG`). |
| **Text Guard** | Opt-in notification access (`ApolloSmsListenerService`, a `NotificationListenerService`) checks new texts from the default SMS app as they arrive. | Paste or copied text, screenshots, and Share → Apollo **where the source app offers Share** (not every app does). | Inbox picker `/message-picker` (`PhonePickers.listRecentSms`, `READ_SMS`). |

The live protections don't use either restricted permission, so removing them leaves live protection exactly as it was.

### The build switch

Implemented in `frontend/plugins/withRestrictedPhonePermissions.js`:

- **Default (all builds):** neither permission is in any Apollo source manifest, and the plugin writes
  `<uses-permission … tools:node="remove">` for both, so no library can merge them back in.
  `expo.extra.restrictedPhonePermissions` is `{ callLog: false, sms: false }`, so the app hides both pickers.
  The native module also reports `declared: false` and returns empty lists if the manifest lacks them.
- `eas.json` → `build.production.env.APOLLO_ANDROID_RESTRICTED_PERMISSIONS = "off"` pins Play builds off.
- **Enabling it takes two deliberate configuration changes**, and anything ambiguous fails the build config:
  ```
  APOLLO_ANDROID_RESTRICTED_PERMISSIONS=READ_CALL_LOG            # or READ_SMS, or READ_CALL_LOG,READ_SMS
  APOLLO_ANDROID_RESTRICTED_PERMISSIONS_APPROVAL=<Play Console declaration approval reference>
  ```
  For a Play build, the `"off"` value in `eas.json` must also be changed on purpose.
- Guarded by `frontend/tests/restrictedPhonePermissions.test.ts`.

---

## 2. Eligibility and evidence required before either permission returns to a Play build

Google's policy (Permissions → *Use of SMS or Call Log permission groups*) allows these permissions only
when the app is the default SMS / Phone / Assistant handler, or qualifies for a listed exception **and**
the permission is essential to the app's **core functionality**, with no less-invasive alternative.

### 2a. READ_CALL_LOG — exception: *Caller ID, spam detection, and spam blocking*

All of the following must be true and evidenced:

1. **Core-functionality need.** Apollo must show that live call screening cannot work, or cannot work
   materially, without call-log access. Today it does work without it: `CallScreeningService` already
   receives every incoming number Android screens, and *Calls Apollo screened* covers the "check a
   recent caller" need. **Until this changes, Apollo is not eligible. Do not declare.**
2. **A documented, specific use** that the screening role can't provide. Examples to assess: outgoing or
   contact numbers the person explicitly wants re-checked, or after-the-fact spam review of calls that
   happened before Apollo held the role. Each needs a written rationale for why it's essential and why no
   alternative works.
3. **Role in place:** Apollo holds `ROLE_CALL_SCREENING` on the device whenever the feature is used.
4. **Data minimisation:** only number, cached name, date and type are read; on demand only; nothing is
   uploaded except a number the person deliberately checks; nothing is kept from the read.
5. **Prominent in-app disclosure** before the runtime prompt (the existing `PhonePickerSheet`
   "explain → ask → Open Settings" flow), plus a matching Privacy Policy section and Data safety answer
   ("Calls log" → collected only when a person checks a number, not shared, not used for ads).
6. **Demo video** showing the screening role, the picker, the prompt and the check.
7. **A recorded approval** from Play Console before the switch is set. The approval reference goes into
   `APOLLO_ANDROID_RESTRICTED_PERMISSIONS_APPROVAL`.

### 2b. READ_SMS — exception: *Anti-SMS phishing ("smishing")*

Google requires a **demonstrated track record of significant protection for users**. A new or
pre-launch app cannot meet that. All of the following must be true and evidenced:

1. **An established public track record.** For example: a sustained period live on Play with Text Guard
   in real use, published detection outcomes (counts of smishing messages identified, false-positive
   rate), independent recognition (security research, partner or carrier references, regulator or
   industry acknowledgement), and user-protection reporting. **Until this exists, Apollo is not
   eligible. Do not declare.**
2. **A core-functionality need** that notification access can't meet. For example: checking messages that
   arrived before Text Guard was enabled, or messages whose notification content Android hides. This needs
   a written rationale and must explain why paste, screenshot and Share can't meet it.
3. **Data minimisation:** inbox read on demand only while the picker is open; only the single message the
   person picks is checked; credentials and codes redacted before processing; nothing kept from the read.
4. **Prominent in-app disclosure** before the runtime prompt, plus a matching Privacy Policy section and
   Data safety answer ("SMS or MMS" → collected only when a person picks a message to check).
5. **Demo video** of the picker, prompt, selection and check.
6. **A recorded approval** from Play Console before the switch is set.

---

## 3. Ready-to-paste declarations (FUTURE USE ONLY)

> ⛔ **NOT FOR CURRENT PLAY SUBMISSION — FUTURE USE ONLY AFTER ELIGIBILITY/APPROVAL.**
> Update every bracketed item with real evidence first. If any eligibility item above is unmet, don't submit.

### 3a. READ_CALL_LOG — Play Console → App content → Sensitive app permissions → SMS and Call Log

- **Permission:** `android.permission.READ_CALL_LOG`
- **Core functionality / permitted use:** Caller ID, spam detection, and spam blocking
- **Description of core functionality (paste):**
  > Apollo is a scam-protection app. Its Call Guard screens incoming calls through Android's call-screening
  > role (CallScreeningService) and checks each caller's number against the person's block and allow lists
  > and numbers previously found to be high-risk. [Describe the specific feature that requires call-log
  > access and why the call-screening role alone cannot provide it, with evidence.] Apollo reads the call
  > log only when the person opens the caller picker. It reads only number, cached name, date and call
  > type, and uploads only a number the person deliberately chooses to check. Nothing from the read is
  > stored. Apollo holds the call-screening role whenever this feature is used.
- **Why less-invasive alternatives are insufficient (paste):**
  > [Explain, with evidence, why "Calls Apollo screened" (numbers Android passes to the screening
  > service) and manual entry do not meet this need.]
- **Video:** [link to the demo video covering role → picker → prompt → check]
- **Approval reference (after approval):** [record here and in `APOLLO_ANDROID_RESTRICTED_PERMISSIONS_APPROVAL`]

### 3b. READ_SMS — Play Console → App content → Sensitive app permissions → SMS and Call Log

- **Permission:** `android.permission.READ_SMS`
- **Core functionality / permitted use:** Anti-SMS phishing
- **Track record evidence (required):** [period live, user counts, smishing detections, false-positive
  rate, independent recognition and references, each with a link or attachment]
- **Description of core functionality (paste):**
  > Apollo protects people from SMS phishing. Text Guard checks new texts from the default SMS app through
  > opt-in notification access. [Describe the specific feature that requires inbox access and why
  > notification access, paste, screenshots and sharing cannot provide it, with evidence.] Apollo reads the
  > inbox only while the person has the message picker open and checks only the single message they pick.
  > Passwords and verification codes are redacted before any processing. Nothing from the read is stored.
- **Why less-invasive alternatives are insufficient (paste):**
  > [Explain, with evidence, why notification access, paste/copy, screenshots and Share → Apollo (where
  > the source app offers Share) do not meet this need.]
- **Video:** [link to the demo video covering picker → prompt → selection → check]
- **Approval reference (after approval):** [record here and in `APOLLO_ANDROID_RESTRICTED_PERMISSIONS_APPROVAL`]

---

## 4. Restoring a permission after approval (checklist)

1. Approval recorded in this document (date, reference, scope).
2. Privacy Policy and Data safety form updated to match the approved use **before** the build is published.
3. In the production build environment set `APOLLO_ANDROID_RESTRICTED_PERMISSIONS` to the approved
   permission(s) and `APOLLO_ANDROID_RESTRICTED_PERMISSIONS_APPROVAL` to the approval reference, and change
   the `"off"` pin in `eas.json` on purpose.
4. Update `tests/restrictedPhonePermissions.test.ts`, which currently asserts the production pin is `"off"`.
5. Rebuild the `.aab` and confirm the merged manifest lists **only** the approved permission(s).
6. Check on a device that the picker appears, the permission prompt follows the explain-first flow, that
   denying it leaves Call Guard / Text Guard fully working, and that *Calls Apollo screened* / notification
   access are unaffected.
