# Higgins consumer scenario evidence

Live purpose-limited checks executed on 2026-09-20 against the configured Gemini integration. Every exact output below was captured from a response with `model_used=true`. These are product demonstrations, not native enforcement evidence. Every card retained `raw_retained_by_apollo=false`, a 15-minute maximum processing-retention boundary, and no packet-block claim.

## 1. Scam — fake bank lock alert

**Submitted sender:** `CommBank Alert`

**Submitted content:** `URGENT: Your account is locked. Verify now at https://commbank-secure-verify.xyz/login or your account will be suspended.`

**Findings:**
- **Suspicious — Unofficial Domain:** The link uses a `.xyz` domain, contradicting CommBank's official `commbank.com.au` address.
- **Suspicious — Content Warning:** Local text patterns match fraudulent-alert techniques.
- **Unresolved — Connection Failure:** Apollo could not inspect the webpage; that failure neither confirms nor clears the concern.

**Uncertainty:** Sender identity; whether the website was previously active or recently removed.

**Higgins' exact response:** “A link to an unofficial .xyz domain. Official bank communications will always originate from their verified domain. I could not establish: the identity of the sender. Delete the message without clicking the link.”

**Action offered:** **Avoid and delete** — “Delete the message without clicking the link.”

## 2. Genuine-looking — dental appointment

**Submitted sender:** `City Dental`

**Submitted content:** `Hi Sarah, your dental appointment is confirmed for Tuesday at 3:30 pm. No payment is due. To reschedule, use the number on our official website.`

**Findings:**
- **Unresolved — Identity of City Dental:** The generic display name alone does not authenticate a specific sender.

**Uncertainty:** Which branch sent it; whether the appointment exists in the dentist's booking system.

**Higgins' exact response:** “A message confirming a dental appointment for Tuesday at 3:30 pm. While this message appears benign, verifying appointments through known channels prevents any potential confusion or social engineering. I could not establish: the specific branch or location of the 'city dental' mentioned. Check your personal calendar to see if this appointment matches your records.”

**Action offered:** **Review your calendar** — “Check your personal calendar to see if this appointment matches your records.”

## 3. Ambiguous — family member on a new number

**Submitted sender:** `Unknown mobile`

**Submitted content:** `Hi Mum, I dropped my phone and this is my new number. Can you send $600 today? I will pay you back Friday.`

**Findings:**
- **Suspicious — Impersonation pattern detected:** The new-number story followed by a money request matches a known impersonation script.
- **Unresolved — Unverified sender identity:** Apollo cannot establish who owns the number.

**Uncertainty:** The sender's actual identity; whether the family member really lost their phone.

**Higgins' exact response:** “A request for $600 from an unknown mobile number. This is a common tactic used to trick individuals into sending money to fraudsters. I could not establish: the actual identity of the person sending the message. Contact your family member on their original, known phone number to verify this request.”

**Action offered:** **Call known number** — “Contact your family member on their original, known phone number to verify this request.”

## Truth and privacy checks

- Submitted content is shown locally in the result so the person knows what was assessed.
- Higgins separates findings from uncertainty and offers one primary action.
- Credentials, URL fragments and secret query parameters are removed before remote processing.
- Raw submissions are not copied into Patrol, logs or analytics.
- No scenario used “Apollo is biting” or claimed a packet was blocked.

Stage 1D candidate building and Pixel acceptance are outside the current scope and are not follow-up actions for this delivery.