# Apollo runtime simulation audit (spec §1A / S01) — 2026-09-21

## Removed from the application runtime
| Item | Was | Now |
|---|---|---|
| `EXPO_PUBLIC_SECURITY_MODE=mock\|native` | build flag selecting `MockSecurityAdapter` (allowed in development/staging devices) | **removed**. Android/iOS always use the native module; missing module → fail-closed SafeStart (never a substitute). |
| `EXPO_PUBLIC_SECURECORE_MODE=mock` (both EAS profiles, `.env.production`) | dormant `MockSecureCore` selected in every build; `SecureCore.initialize()` on boot | **removed**: `securecore/SecureCore.ts`, `securecore/mock/*` deleted; boot no longer depends on SecureCore; Settings reports it "Not included" (optional capability unavailable, `not_implemented`). Contract + native bridge files retained (no runtime selection). |
| `src/security/MockSecurityAdapter.{web,native,d}.ts` | simulated adapter in the ordinary web app | **deleted**. Ordinary web uses `WebSecurityAdapter` (real browser capabilities; native ones unavailable with reasons). |
| `app/dev-tools.tsx` (mock scenario switcher) | route bundled into every build | **deleted**. |
| `PLATFORM_CAPABILITY_BASELINES.mock` | "mock" platform | renamed `web` (empty scope). |

## Permitted fixtures and their isolation
| Fixture | Location | Reachability | Label |
|---|---|---|---|
| Device-preview harness `PreviewDeviceAdapter` | `frontend/tools/preview-device-harness/` (outside `src/` and `app/`) | Only `src/security/hostAdapter.web.ts` may reference it (enforced by `scripts/security-preflight.mjs` and `tests/adapterContract.test.ts`). Selection requires the build-time literal `EXPO_PUBLIC_DEVICE_PREVIEW_HARNESS=enabled` **and** `securityConfig` validation (development only; web only — native hosts reject the flag). Native bundles resolve `hostAdapter.ts`, which contains no web/harness code. Ordinary web builds leave the flag unset → dead branch removed by release minification. EAS profiles never set the flag (preflight rejects it for any `EAS_BUILD_PROFILE`). | Every observation carries `simulation: {kind:"preview_device", label:"MOCKED DEVICE INPUT — PREVIEW ONLY"}`; Settings and onboarding show the label; backend rejects simulated observations for native profiles (409) and never lets them become native proof. |
| Frozen `frontend/packages/guarddog-*` test fixtures | unchanged source | not imported by application code; excluded from deliverable artifacts by not being referenced. | — |
| GuardDog Stage 1D acceptance engine | `guarddog-acceptance` EAS profile only | `securityConfig` rejects it in production. | — |

## Artifact inspection performed
- `node scripts/security-preflight.mjs` → OK (161 app sources scanned: no `MockSecurityAdapter|MockSecureCore|EXPO_PUBLIC_SECURITY_MODE|EXPO_PUBLIC_SECURECORE_MODE`; harness referenced only by `hostAdapter.web.ts`), native-dependency guard PASS (51 native packages, no duplicates).
- `node --test tests/securityConfig.test.ts tests/securityBoot.test.ts tests/adapterContract.test.ts tests/nativeDependencyGuard.test.cjs` → 49 passed.
- `npx tsc --noEmit` clean; ESLint 0 errors on changed files.
- Not performed (no runner in this sandbox): native bundle byte inspection of an actual APK/IPA. The platform-split (`hostAdapter.ts` vs `.web.ts`) is the exclusion mechanism; verify on the first `device-test` build by grepping the JS bundle for `PreviewDeviceAdapter` (expected absent).

## Failure behaviour
A missing native module records a `SecurityConfigurationError` on the boot registry and renders SafeStart; no adapter is substituted and no protection state can be derived (`securityBoot.ts`). A native profile submitting a simulated observation is rejected server-side (409) as an implementation/configuration defect.
