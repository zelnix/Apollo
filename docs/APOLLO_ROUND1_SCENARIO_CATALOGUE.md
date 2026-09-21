# Apollo Round 1 user-scenario catalogue

This catalogue is permanent regression input. Scenario IDs are stable. Expected outcomes are declared in `frontend/scripts/round1-scenario-engine.ts` before execution and are held separately from values passed to Apollo's analysis functions.

## One documented command

```bash
./scripts/run-apollo-round1.sh --mode repeatable
```

Outputs:

- `test_reports/round1_expected_vs_actual_repeatable.md` — readable expected-versus-actual report
- `test_reports/round1_expected_vs_actual_repeatable.json` — machine-readable report
- `test_reports/round1_artifacts/repeatable/*.png` — journey screenshots

Live investigation mode is intentionally separate and bounded:

```bash
./scripts/run-apollo-round1.sh --mode live
```

Both modes use real configured downstream services. No verdict, investigation finding or Higgins response is injected. “Repeatable” means the scenario inputs and assessment expectations are fixed; external results and Higgins wording may vary. If a real service is unavailable or a Higgins answer fails the grounded-response contract, the journey is **INCOMPLETE** and the command exits non-zero. `--mode live` preserves a separate release/on-demand evidence record using the same real integrations.

## Permanent single-Gate situations

Each Gate has threatening, legitimate and ambiguous situations. Full submitted content, user actions, expected state, findings, uncertainty, Higgins meaning, next action and prohibited claims are encoded before execution and emitted into every report. The 35 local engine checks are preflight for Apollo logic; they are not counted as acceptance of external investigation or Higgins quality.

| Gate | Threatening ID | Legitimate ID | Ambiguous ID |
|---|---|---|---|
| Site | `site-threat-protection-gap` | `site-legitimate-active` | `site-ambiguous-stale` |
| Link | `link-threat-bank` | `link-legitimate-public` | `link-ambiguous-short` |
| Text | `text-threat-code` | `text-legitimate-appointment` | `text-ambiguous-family` |
| Call | `call-threat-code` | `call-legitimate-appointment` | `call-ambiguous-callback` |
| Network | `network-threat-dangerous` | `network-legitimate-home` | `network-ambiguous-open` |
| Account | `account-threat-reset` | `account-legitimate-requested` | `account-ambiguous-breach` |
| Email | `email-threat-bank` | `email-legitimate-receipt` | `email-ambiguous-security` |
| App | `app-threat-remote` | `app-legitimate-notes` | `app-ambiguous-cleaner` |
| File | `file-threat-disguised` | `file-legitimate-document` | `file-ambiguous-archive` |
| Device | `device-threat-remote` | `device-legitimate-observed` | `device-ambiguous-limited` |

## Realistic multi-Gate situations

| ID | Person's situation | Expected Gate path |
|---|---|---|
| `multi-unexpected-purchase-message` | “I received this unexpected purchase message.” | Text → Link → Account when the message requests account action |
| `multi-google-drive-file` | “Someone shared this file from Google Drive.” | File; cloud hosting must not lower risk |
| `multi-caller-install-app` | “A caller asked me to install an app.” | Call → App; Device only after the person reports installation/access |
| `multi-unfamiliar-installed-app` | “I found an unfamiliar app already on my phone.” | App → Device using observed capabilities where available |
| `multi-genuine-delivery-notification` | “This is a genuine delivery notification.” | Text → Link without a parcel-scam false alarm; sender remains unverified |

## Normal app journeys

The Playwright runner uses the visible Expo screens and controls; it does not call domain analyzers directly for these journeys.

| ID | Gate / flow | Key user outcome |
|---|---|---|
| `ui-site-popup` | Ten-Gate overview → recommendation | Ten Gates appear; popup dismisses before Device Gate |
| `ui-link-threat` | Threatening and ambiguous links | Trusted instructions open; “Record my choice to continue” matches behaviour |
| `ui-text-threat` | Code-request message | Grounded warning and persistent sender guidance |
| `ui-call-threat` | Caller requests code | Trusted callback guidance, no dialling suspicious content |
| `ui-network-ambiguous` | Preview network | Visibility limits remain explicit; no unsupported block claim |
| `ui-account-unknown-report` | No-evidence alert + report failure | Unknown stays unknown; failed report retries; “Mark as handled” |
| `ui-email-threat` | Bank impersonation email | Trusted verification does not open suspicious content |
| `ui-app-remote` | Caller-prompted remote app | Capability warning and working Settings guidance |
| `ui-file-handoff` | Disguised file, “I already opened it,” Higgins Retry | Evidence-first follow-up, recovery, automatic handoff and conversation continuity |
| `ui-device-setting` | Device finding, “Help me change that setting” | Visible limitation, Settings guidance and retained Higgins context |

## Semantic acceptance

Higgins text is not matched word-for-word. The runner requires the selected Gate context, a clear uncertainty statement and one explicit next action. It rejects unsupported first-person block claims and “verified safe” language. Exact **real Gemini** responses are retained in the JSON/Markdown report and screenshots exclude user secrets. The backend buffers structured responses and rejects invalid model output; it never replaces it with canned wording.

## Device-only — never passed by preview

- `site-native-confirmed-block`
- `call-native-screening-rejection`
- `file-native-share-provider`
- `device-native-settings-return`
- `app-native-inventory-permissions`
- `network-native-enforcement`

Stage 1D remains cancelled; the suite does not perform a packet-blocking acceptance exercise.

## Adding regressions

Every user-reported defect gets a permanent ID, predeclared expected meaning/action, a deterministic regression and—when the available environment supports it—a normal-screen browser journey. Run repeatable mode for every change. Run live mode on demand and before releases.