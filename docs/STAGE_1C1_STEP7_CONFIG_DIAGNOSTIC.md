# Stage 1C.1 — Step 7 (`eas-update`) Config Gate Diagnostic

**Date:** 2026-06 (session record)
**Failing cloud build:** `aa24dd73-eab7-4d0f-8b83-4734adb870b8`
**Cloud symptom:** `eas project:init` → `node_modules/expo/bin/cli config --json` exited with code 1 (no stderr surfaced)

## Repository state under test

| Item | Value |
|---|---|
| Commit SHA | `a2c8ee0330efa6587aae7e4d5917f84cdffe22fb` |
| Branch | `main` |
| Working tree | clean (`git status --porcelain` → 0 entries) |
| Node | v24.19.0 |
| npm | 11.17.0 |
| yarn | 1.22.22 |
| `expo` | 57.0.19 |
| `@expo/cli` | 57.0.21 |
| `@expo/config` | 57.0.9 |
| `@expo/config-plugins` | 57.0.9 |
| App config | static `frontend/app.json` only (no `app.config.js/ts`) |
| Plugins (17) | expo-router, expo-notifications, expo-splash-screen, expo-font, expo-image, expo-secure-store, expo-web-browser, expo-status-bar, expo-share-intent, ./plugins/withApolloSiteGuard, ./plugins/withApolloCallGuard, ./plugins/withGuardDogEngine, expo-sharing, expo-camera, expo-image-picker, expo-audio, expo-build-properties |

## Commands executed (from `frontend/`)

| # | Command | Exit code | stderr | stdout |
|---|---|---|---|---|
| 1 | `npx expo config --json` | **0** | empty | 4002 bytes valid JSON — `name=Apollo slug=frontend version=1.0.0 sdkVersion=57.0.0 plugins=17` |
| 2 | `EAS_NO_VCS=1 npx expo config --json` | **0** | empty | 4002 bytes valid JSON (identical) |
| 3 | `EXPO_DEBUG=1 EAS_NO_VCS=1 npx expo config --json` | **0** | telemetry + env-file discovery debug lines only; no warnings, no exceptions | 4001 bytes valid JSON |
| 4 | Same as #2, run inside a pristine `git archive HEAD` extraction (no untracked files, **no `frontend/.env`**, `node_modules` symlinked) | **0** | empty | 4047 bytes valid JSON |

Debug output from #3 (complete, nothing omitted):
```
expo:telemetry Recording 1 event(s)
expo:env Loaded environment variables from: /app/frontend/.env
expo:env /app/frontend/.env.development does not exist, skipping this env file
expo:env /app/frontend/.env.local does not exist, skipping this env file
expo:env /app/frontend/.env.development.local does not exist, skipping this env file
expo:telemetry:client:detached Detached flush started
```

## Environment-difference checks

- `frontend/.env` is git-ignored (`.gitignore:95 *.env`) and untracked, so it is **absent** in the cloud checkout.
  → Verified irrelevant: `app.json` and all three local plugins contain **zero** `process.env` references, and test #4 passes without the file.
- `/packages/guarddog-android-sdk` and `/packages/guarddog-expo-module` are present in the committed tree (confirmed in the `git archive` extraction).

## Conclusion

Apollo's checked-in configuration evaluates successfully under every requested condition, including a clean
committed-tree checkout that mirrors the cloud working directory. The exit-code-1 failure is **not reproducible**
from this repository state and is specific to Emergent's Step 7 execution environment.

**No application, plugin, GuardDog, Hermes, adapter, Higgins, or UI changes were made.**

## Request to Emergent Support

For build `aa24dd73-eab7-4d0f-8b83-4734adb870b8`, please provide:
1. The complete **stderr** of `node_modules/expo/bin/cli config --json` as executed by `eas project:init`.
2. The **working directory** the command was run from (expected: the `frontend/` app root, where `app.json` lives).
3. Node / `@expo/cli` / `eas-cli` versions and any env vars set for Step 7 (e.g. `EXPO_DEBUG`, `CI`, `EXPO_NO_TELEMETRY`).
4. Whether `node_modules` were installed with yarn 1.x per `package.json` before Step 7 ran.

Locally the same command passes with exit 0 on Node v24.19.0 / `@expo/cli` 57.0.21 / `expo` 57.0.19 at commit `a2c8ee0`.
