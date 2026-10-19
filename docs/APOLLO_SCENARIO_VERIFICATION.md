# Apollo usability scenario verification

Expected outcomes were recorded before browser and full-regression execution. “Observed” is completed after each run. Browser evidence is not physical-device evidence.

| Scenario | Expected Gate | Expected detection / investigation | Expected Higgins explanation | Expected button outcome | Evidence / observed |
|---|---|---|---|---|---|
| Recommendation popup → selected check | Recommended Gate | Popup dismisses before route transition | No assistant claim needed | Selected Gate is unobstructed | **PASS, browser:** visibility-loss recommendation routed to Device Gate; sheet detached before destination |
| Issue A, then issue B with identical question wording | Source Gate → Higgins | Each issue carries a unique handoff ID and bounded structured context | Two context-specific answers | Each tap auto-submits; no Send tap | **PASS, browser + API + unit:** distinct references/contexts; 2 same-wording user records for 2 issues |
| Double tap issue action | Source Gate → Higgins | One handoff starts; backend deduplicates the ID | One answer | No duplicate user question | **PASS, unit + API:** rapid repeat reservation rejected; completed handoff cached; history count unchanged |
| Handoff while response streams | Higgins | New issue is shown as queued | Current answer completes, then queued issue is answered | No issue/context loss | **PASS, browser:** B arrived during A submit and completed with B reference, summary and 1/1 counters |
| Failed answer → Retry → follow-up | Higgins | Failed question and context remain | Retry answers same issue; follow-up uses same conversation only | Persistent Retry; no duplicate initial question | **PASS, browser:** offline error retained context/question; Retry completed; follow-up produced 2/2 per-issue counters |
| Report mistake while offline | Result Gate | No success state until API resolves | N/A | Persistent failure plus Retry; result retained | **PASS, browser:** no success state; persistent error and “Retry report” |
| File picker cancel, failure and retry | File Gate | Cancel leaves picker usable; exception creates persistent error | N/A | “Try choosing again” retries picker | **PASS, browser cancel/retry; automated source contract for exception path.** Native provider exceptions still await phone verification |
| Shared file, origin unknown | File Gate | Signature/sample/size/type inspected; origin remains unknown | Explains inspection limits | Relevant follow-up only for risky/archive types | **PASS, automated contract + browser unknown-source flow.** Native share metadata awaits phone verification |
| Ordinary document | File Gate | Limited local signature/sample; no safety claim | Explains full content was not scanned | No unnecessary origin/password question | **PASS, automated signature analysis. Browser provider did not expose bytes and Apollo truthfully reported “File not inspected,” with no preliminary questions** |
| Suspicious executable/archive | File Gate | Type/signature mismatch or archive is detected | Explains risk and uncertainty | Source/password question appears only after inspection | **PASS, browser + automated:** disguised filename source follow-up after inspection attempt; archive password follow-up after evidence card |
| Genuine-looking account alert | Account Gate | Visible sender/link/service remain claims; configured-domain match is supporting evidence | Explains sender is not authenticated | One relevant follow-up; trusted instructions only | **PASS, browser:** requested reset stayed unverified; no “Fine to use” |
| Suspicious account alert | Account Gate | Off-domain/pressure evidence escalates without claiming takeover unless user reports exposure | Explains observed versus inferred facts | One working official-route action | **PASS, browser:** off-domain Microsoft reset reached Barking without safety claim |
| Ambiguous account alert | Account Gate | Unknown stays unknown | Explains what cannot be established | Requests only an assessment-changing answer | **PASS, browser:** explicit no-evidence path remained unknown and did not ask irrelevant request question |
| Empty account submission | Account Gate | Does not default to MFA | N/A | Assessment unavailable until evidence or explicit no-evidence path | **PASS, automated + browser** |
| Password-change text | Account Gate | Infers password-change wording, independent of UI default | Explains claim and asks whether user made it | Does not use unrelated alert type | **PASS, automated** |
| Selected breach notice | Account Gate | Selection does not confirm a breach | Says the notice claims a breach | Offers independent lookup/official check | **PASS, automated** |
| Requested reset without verified destination | Account Gate | User report does not establish official domain or safety | Explains request is expected but alert unverified | Uses independently configured official route | **PASS, automated + browser** |
| Legacy recovery record | Incident / recovery | “You told Apollo…” remains parseable | New display says “You reported…” | Correct recovery plan remains available | **PASS, automated:** legacy + structured fields combined |
| Narrow screen / larger text / keyboard | File, Account, Higgins | No clipped controls or horizontal overflow | N/A | Password switch remains visible; keyboard does not hide submit | **PASS, browser at 320 px / 115% scale.** Physical accessibility text/keyboard remains pending |

## Evidence classes

- **Automated:** deterministic domain/unit/API tests; suitable for classification, validation, privacy and compatibility claims.
- **Browser preview:** routing, popup dismissal, responsive layout, keyboard and visible-state evidence only.
- **Physical device:** operating-system picker/share sheet, Settings deep links, real platform signals, native blocking and accessibility font scaling. No physical-device result is inferred from browser evidence.

## Screenshot evidence

- Before/after File Gate: `/app/test_reports/apollo_usability/before-file-gate.jpeg`, `/app/test_reports/apollo_usability/after-file-gate.jpeg`
- Before/after Account Gate: `/app/test_reports/apollo_usability/before-account-gate.jpeg`, `/app/test_reports/apollo_usability/after-account-gate.jpeg`
- Before/after Higgins handoff: `/app/test_reports/apollo_usability/before-higgins-handoff.jpeg`, `/app/test_reports/apollo_usability/after-higgins-handoff.jpeg`
- Narrow File password layout: `/app/test_reports/apollo_usability/after-file-password-narrow.jpeg`
