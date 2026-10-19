# Apollo settings capabilities (as built, 2026-09-21)

## Contract

`POST /api/investigations/{caseId}/settings-plan` `{expectedRevision, target, device: DeviceProfile}` → `SettingsPlan`:

- `match`: `exact` when a grounded source names the supplied manufacturer/model; `platform_only` when only platform-vendor support domains (Google/Apple/Microsoft/Samsung/Android developer docs) were found; `unresolved` otherwise.
- `mode`: `permission_request` if the device advertises a `permission.*` capability matching the target; `settings_link` if it advertises an `open_settings*` capability; else `instructions`.
- `instructions`: sourced steps from official OEM/platform research (Gemini Search grounding, owner key). `sourceIds` reference registered `SourceReference`s with authority labels.
- `expectedObservation`: bound to the matching capability (`field: enabled`, `expectedValue: true`) when observable; `null` when Apollo cannot observe the setting.

`POST .../settings-plan/{planId}/recheck` `{deviceResultIds}` → `RecheckResult`: `correct` only from a fresh observation of the bound capability matching the expected value; `not_yet_correct` when a fresh observation disagrees; `cannot_observe` when no matching fresh observation exists or the device reported unavailable/denied; the person's "Done" is never observed success.

Live check: Samsung SM-S918B / Android 14 / en-AU, target "allow Apollo's VPN-based protection to always run in the background" → `match=exact`, `mode=instructions`, sourced steps (Always-on VPN + Samsung battery settings).

## Platform applicability

| Platform | Observation | Action | Guidance |
|---|---|---|---|
| Android (native build) | Apollo-owned adapters (not yet bound to the device broker) | Permission request / settings intent after user gesture — **not yet wired** | Researched, OEM-matched |
| iOS | Limited to app-scoped permissions | Permission request / `Linking.openSettings()` — not yet wired | Researched, platform-only |
| Windows / macOS | None (enforcement backlog) | None | Researched guidance only; no enforcement implied |
| Web preview | None; requests answered `unavailable` | None | Researched guidance |

## Not yet delivered

`frontend/src/settings/{guidance,actions,recheck}.ts`, replacement of `utils/deviceSettings.ts` on the Device screen, native requested-vs-granted permission contract, and preview-fixture isolation (Stage C steps 19–22).
