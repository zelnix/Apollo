# Apollo build record

## Android — 2026-09-21 Package 1/2 closure candidate

| Field | Value |
|---|---|
| Build id | `18706c6e-cf91-418e-9536-94b1cf592f93` |
| Result | **FINISHED** at `2026-09-21T18:52:03.479Z` |
| Build page | https://expo.dev/accounts/emergent-em-user-fb71a8d3-adc2-4275-b1ec-2692228557b8/projects/threat-patrol-1/builds/18706c6e-cf91-418e-9536-94b1cf592f93 |
| **APK download** | https://expo.dev/artifacts/eas/e6U7nUAuNc-tULLCTfLftpltfy7wll9oithASkmvk7U.apk |
| EAS source fingerprint | `31a0394db69ca674b79ef91a3d0cf3c2b0e2e083` (`01a0c541-21a7-7d83-a8b9-5e0d153493a3`) |
| EAS informational git field | `58fb1a066eaabe06a96c143da8d4ce171e254d6c`; working-source identity is the EAS fingerprint above |
| App | `Apollo` 1.0.0 (versionCode 1), package `app.apollo.hwg`, Expo SDK 57 |
| Profile | `device-test`: internal APK, staging backend, legacy enforcement selection; GuardDog/Apollo native modules still compiled successfully |
| Compatible backend | `https://device-file-gate.preview.emergentagent.com` (`/api/health` HTTP 200) |
| Size | 147,531,093 bytes |
| SHA-256 | `50e51aff03ee69ed859386b734365a205fe9040fc240c5af896e7a3342503e91` |
| Local verification copy | `/app/Apollo-Android-18706c6e.apk` |

Native build log reached and completed release Kotlin/CMake/Gradle tasks for Apollo Security, GuardDog dependencies,
`expo-share-intent` multi-item support and the application. This is compilation proof, not physical-device behavior proof.

## Android — `device-test` profile (installable candidate)

| Field | Value |
|---|---|
| Build id | `e32f6068-b349-4de8-ab5d-8c950a6596bf` |
| Build page | https://expo.dev/accounts/emergent-em-user-fb71a8d3-adc2-4275-b1ec-2692228557b8/projects/threat-patrol-1/builds/e32f6068-b349-4de8-ab5d-8c950a6596bf |
| **APK download** | https://expo.dev/artifacts/eas/-R5J9ohNQ6k-MxXloAh_NuawortWikr6zDUyXPbaRlE.apk |
| Source commit | `fa9bf2f6955eee34e15f10c46d88448069be200d` (branch main; later commits are backend/desktop/docs and do not change the APK) |
| Profile | `device-test`: internal distribution, APK, `EXPO_PUBLIC_APP_ENV=staging`, `EXPO_PUBLIC_ANDROID_ENFORCEMENT_ENGINE=legacy` (GuardDog acceptance engine not selected) |
| App | `Apollo` 1.0.0 (versionCode 1), package `app.apollo.hwg`, Expo SDK 57 |
| Size / ABIs | 147,519,401 bytes; arm64-v8a, armeabi-v7a, x86, x86_64 |
| SHA-256 | `0755c7f37b19623f76d6dda23c2a8c11d0feec31449496631f49ca3291489103` |
| Signing | EAS cloud-generated keystore for project `47cd97c4-e5a6-41fa-9fde-257a5de031af` (internal testing; not a store key) |
| Backend | `EXPO_PUBLIC_BACKEND_URL` from `frontend/.env.production` (the stable reachable backend) |

### Artifact inspection (performed on the downloaded APK)
- JS bundle (`assets/index.android.bundle`, 5.10 MB): `PreviewDeviceAdapter`, `MOCKED DEVICE INPUT`, `MockSecurityAdapter`, `MockSecureCore`, `WebSecurityAdapter`, `EXPO_PUBLIC_SECURITY_MODE` — **all absent**; `getDeviceProfileFacts`, `open_settings.vpn`, fail-closed message — present.
- DEX: `ApolloSecurityModule`, `ApolloSmsListenerService`, `GuardDogVpnService` present. Manifest declares `POST_NOTIFICATIONS`.

### Install (Pixel 10)
Open the APK link on the phone (or `adb install apollo-device-test.apk`), allow "install unknown apps" for the browser once, install, open Apollo. First run shows onboarding; the Settings tab shows the real adapter label (`Android — Apollo DNS filter`) and no preview banner.

### Build history
| Build | Result | Cause / fix |
|---|---|---|
| `d54b2c70-6a1d-4f17-8255-f9cce2ed2b7f` | errored (Gradle, 9m38s) | `:apollo-security:compileReleaseKotlin` — `Unresolved reference 'activeSessionId'` ×3 in `ApolloGuardDogCandidateRuntime.kt` (frozen SDK e5d11be has no such field). Fixed in `fa9bf2f` by deriving the live TUN-session identity from `GuardDogVpnRuntime.activeSession`. Pre-existing packaging fixes in the same run: `app.json` slug → `threat-patrol-1` (EAS project mismatch), `gradle-wrapper.jar` tracked. |
| `e32f6068-b349-4de8-ab5d-8c950a6596bf` | **finished** (25m) | — |

Known build warnings (non-blocking): `expo-updates` not installed although the profile declares a channel (channels unused); `expo-doctor` warns about the tracked `android/` directory (bare workflow is intentional for the GuardDog modules).

## iOS / iPadOS — `device-test` profile
Attempted (`eas build --platform ios --profile device-test --non-interactive`): stops at **credential setup** — `EAS CLI couldn't find any credentials suitable for internal distribution`. Targets recognised: `app.apollo.hwg`, `app.apollo.hwg.contentblocker`, `app.apollo.hwg.share-extension`.
Genuinely missing owner inputs: Apple Developer team credentials (App Store Connect API key `.p8` + key id + issuer id, or an interactive Apple ID login) and the test devices' UDIDs (`eas device:create`) for ad-hoc internal distribution — or TestFlight instead. Nothing else blocks the iOS build.

## Windows / macOS
Tauri host in `/desktop`; no Windows/macOS runner in this workspace, so no installer produced yet (see `APOLLO_PLATFORM_DELIVERY_MATRIX.md`).
