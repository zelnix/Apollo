# Apollo Gates scenario acceptance

Expected outcomes were defined before execution. Actual results are filled only after the corresponding automated, browser or physical-device run.

**Mailbox credential rule:** Email Gate supports pasted email and Gmail read-only OAuth only. Generic IMAP username/password connection was removed and legacy credential rows were purged.

## 1. PayPal alleged-charge callback trap

- **Encounter:** Sender `+5591981395859` claims PayPal flagged an unauthorised A$412.50 transaction to NovaTech Electronics Pty Ltd, supplies `+61 (1800) 316556`, demands a call within four hours, threatens release of funds and automatic account lock.
- **Gates:** Text Gate; Call Gate reputation lookup for the callback number; Account Gate as recovery/independent-account context.
- **Expected investigation:** Identify PayPal, NovaTech Electronics, A$412.50, sender, callback number, four-hour deadline, lock/funds threat and requested callback. Classify as an alleged-charge callback trap, not a payment request. Check caller reputation and PayPal official guidance independently. Treat no reports or number geography as inconclusive.
- **Expected Apollo behaviour:** Barking. No Biting because no protective block occurred.
- **Expected Higgins:** Explain the callback trap and pressure tactics; distinguish message evidence, external checks and inference; state that sender, number and charge remain unauthenticated; direct the person to open their existing PayPal app and check Activity. Never claim the charge is absent.
- **Actual:** Pending execution.

## 2. Legitimate-looking appointment from an unfamiliar sender

- **Encounter:** A dental appointment confirmation with no link, payment, code or identity request.
- **Gates:** Text Gate.
- **Expected investigation:** No strong scam request; unfamiliar display name remains unauthenticated.
- **Expected Apollo behaviour:** Resting after completed checks.
- **Expected Higgins:** Compare with an expected appointment/calendar; no automatic scam label.
- **Actual:** Pending execution.

## 3. Suspicious bank link

- **Encounter:** Urgent account-lock message with a non-bank login domain.
- **Gates:** Text Gate and Link Gate.
- **Expected investigation:** Brand/domain contradiction, urgency and credential request; safe webpage/reputation checks where available.
- **Expected Apollo behaviour:** Barking. No Biting without block evidence.
- **Expected Higgins:** Keep the link closed and use the bank's existing app independently.
- **Actual:** Pending execution.

## 4. Legitimate link with incomplete identity evidence

- **Encounter:** A normal public site link with no threat-list match.
- **Gates:** Link Gate.
- **Expected investigation:** Report completed checks and source times. “No reports found” remains limited evidence and does not authenticate the sender.
- **Expected Apollo behaviour:** Resting only if completed checks identify no concern; otherwise Growling for unresolved material risk.
- **Expected Higgins:** Explain what was checked and what remains unknown.
- **Actual:** Pending execution.

## 5. Inconclusive investigation

- **Encounter:** A private/unreachable target or temporarily unavailable external provider.
- **Gates:** Link Gate or Call Gate.
- **Expected investigation:** Preserve local assessment; mark unavailable checks and unresolved questions explicitly.
- **Expected Apollo behaviour:** Growling when a material concern remains; never reassuring styling beside a high-risk local result.
- **Expected Higgins:** State exactly what could not be checked and offer one safe independent action.
- **Actual:** Pending execution.

## 6. Site Gate permission missing

- **Encounter:** Link Gate manual checks are available, Site Gate automatic filtering is requested but its permission is missing or stale.
- **Gates:** Gates overview, Link Gate, Site Gate.
- **Expected protection summary:** `Some protection needs attention`.
- **Expected Higgins:** “Your link checks are available, but Site Gate is off. Restore Apollo’s protection permission to enable its automatic filtering.”
- **Expected action:** `Restore protection`; open the relevant permission flow, then show Checking status until fresh evidence confirms running.
- **Expected Apollo behaviour:** Protection gap is separate from threat severity; it does not itself cause Barking or Biting.
- **Actual:** Pending execution.

## 7. Site Gate restoration

- **Encounter:** Person completes the required protection permission/activation step and returns.
- **Expected:** App rechecks automatically. Gate changes to Active only with a fresh operational observation; otherwise Higgins identifies the remaining step.
- **Actual:** Pending physical-device execution.

## 8. Suspicious and legitimate calls

- **Encounter:** One reported/high-risk callback number and one unfamiliar number with no strong reputation signal.
- **Gates:** Call Gate.
- **Expected:** Strong reputation evidence can Bark; missing reports remain unresolved rather than safe. Country code never proves caller location. Blocking requires an active native screening path and actual rejection evidence.
- **Actual:** Pending execution.

## 9. Supported blocking

- **Encounter:** Controlled traffic or call reaches a supported native protection path and is intentionally blocked.
- **Expected Apollo behaviour:** Biting only after the device records valid enforcement evidence tied to the actual block.
- **Expected Higgins:** Explain the confirmed block and any recovery action without implying every threat is contained; never claim Higgins blocked it.
- **Actual:** **Untested on a physical device. Physical acceptance is not complete.**