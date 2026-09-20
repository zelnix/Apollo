# Apollo visible-action audit

Static audit covered the visible `onPress`/navigation/action sites under `frontend/app` and `frontend/src/components` (protected packaged engines excluded). Labels below are bound to validated handlers; model-provided labels are not rendered as executable capability promises.

| Area / action | Label now shown | Bound handler | Expected and observed code outcome |
|---|---|---|---|
| Any issue result → Higgins | “Ask Higgins about this…” / Gate-specific equivalent | `openHigginsHandoff` | Creates unique bounded handoff, closes source popup where applicable, opens Higgins and auto-submits once |
| Higgins recommendation check | Gate name | `HigginsChecks` dismiss callback then route push | Parent recommendation popup dismisses before navigation |
| Generated verify recommendation | “Show me how to check” | `dispatchInvestigationAction.showVerification` | Opens persistent instructions; does not claim to open an external destination |
| Generated call recommendation | “Show me how to call safely” | `showCallingGuidance` | Shows persistent independently sourced guidance; does not dial suspicious content |
| Generated account recommendation | “Open Account Gate” | Account route handler | Navigates to Account Gate (or persistent guidance when already there) |
| Generated discard recommendation | “Clear submitted copy” | Gate-specific clear handler | Clears only Apollo’s submitted screen copy; explicitly says original email/message/call history/app was not deleted |
| Generated review recommendation | “Show what to review” | Gate-specific review/settings handler | Shows details or persistent instructions; native builds open supported Settings destination |
| Account / caller primary result actions | Truthful dispatcher label above | Persistent guidance, Account route or clear handler | No toast-only primary action remains |
| Report a mistake | “Report a mistake” / “Retry report” | Awaited feedback request | Success appears only after request completion; failure remains visible with Retry and keeps result |
| Link override | “Record my choice to continue” | Patrol update + best-effort feedback | Records the disclosed choice; no false promise to navigate to the link |
| Resolve event | “Mark as handled” | `resolveEvent` | Resolves event only; explicitly does not verify sender/caller or suppress future alerts |
| File picker | “Choose a file” / “Try choosing again” | guarded DocumentPicker call | Cancel is harmless; exceptions remain visible and retryable |
| Filename fallback | “Check filename only” | bounded local filename analysis | Clearly limited; never described as file inspection or safety verification |
| Verification sheets | “Show me how to check…” | sheet visibility state | Instructions remain visible until dismissed |
| Settings actions in browser preview | “Show Settings steps” | persistent guidance card | Does not say “Open” when preview cannot open a native Settings destination |
| Settings actions on native OS | “Open Settings” / “Open removal settings” | `openDeviceSettings` | Attempts the supported OS destination and retains fallback path text |
| Recovery choice | “I already called, clicked or shared…” | Recovery sheet | Records a structured recovery kind and displays ordered steps |
| Breach lookup | “Check breach exposure” | configured breach endpoint | Existing not-configured/unavailable result remains explicit; HIBP configuration is outside this task |

## Loading, cancellation, retry and repeated use

- Submit buttons disable while their operation is active.
- Higgins tracks queued/submitting/streaming/failed/completed states; route rerenders and rapid taps do not consume a handoff early.
- Each active issue shows a short reference and per-issue question/answer counters, independent of virtualized message rendering.
- File and screenshot cancellation leaves the originating action available.
- Report and Higgins errors are persistent, preserve context/input and expose Retry.
- “Start an unrelated question” explicitly clears issue context; follow-ups keep the selected issue until then.
- Modal close/Back remains available through shared `Sheet` and screen headers; essential instructions use cards/sheets instead of transient toasts.

## Items awaiting phone verification

1. Native document/image picker cancellation and provider-specific metadata on Android/iOS.
2. OS share-sheet delivery of unknown-origin files and Android content URI reads.
3. Actual Settings/deep-link destinations and return-to-app refresh on supported OS versions.
4. Native call-screening/local block and allow behavior; preview only verifies labels/state transitions.
5. Real app inventory, permission, VPN/profile/certificate and Apollo protection-health signals.
6. Large accessibility text and keyboard behavior across physical phone sizes.

No HIBP setup or packet-blocking acceptance exercise was performed.