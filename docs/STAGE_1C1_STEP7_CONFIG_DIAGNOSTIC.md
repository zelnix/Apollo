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

---

# RESOLVED — Root cause found, reproduced, fixed (build `b0ab6f08-2b2f-46a0-a7a3-b735869fff6d` log)

## GuardDog is exonerated

**GuardDog was NOT the cause of Step 7.** Neither the certified source under `packages/`, nor
`withGuardDogEngine.js`, nor `expo.autolinking.searchPaths`, nor Hermes/ARM64, nor Node version,
nor the missing `.env`, nor a fresh `yarn install` had any effect (each was tested in isolation —
see "Ruled out" below). Do not reopen that line of investigation for this failure.

## Actual root cause: repeated EAS config write-back → duplicate iOS `ShareExtension` entries

The second build log revealed the sequence inside Emergent's Step 7:

```
[EAS_LOG] Removing projectId from app.json (first-time deploy, will be auto-generated)...
[EAS_LOG] Initializing EAS project...
✔ Project successfully linked (ID: 47cd97c4-…) (modified app.json)
/workspace/frontend/node_modules/expo/bin/cli config --json exited with non-zero code: 1
```

Traced through eas-cli source (`project/projectInitialization.ts`, `project/expoConfig.ts`,
`commandUtils/context/contextUtils/getProjectIdAsync.ts`, `utils/expoCli.ts`):

1. Emergent's script deletes `extra.eas.projectId`, forcing `eas project:init` to re-link.
2. `project:init` spawns `node_modules/expo/bin/cli config --json` (with `EXPO_NO_DOTENV=1`).
   **This first evaluation succeeds** — it is what produced the slug used to link.
3. `saveProjectIdToAppConfigAsync` then writes `{ extra: { ...evaluatedExtra, eas: { …, projectId } } }`
   back into `app.json` via `@expo/config` `modifyConfigAsync`. Two facts combine here:
   - The `skipPlugins: true` hint is ignored on the CLI-spawn path, so `evaluatedExtra` contains
     **plugin-generated** content — specifically the `ShareExtension` entry that `expo-share-intent`'s
     plugin injects into `extra.eas.build.experimental.ios.appExtensions`.
   - `modifyConfigAsync` merges with `deepmerge`, whose default array strategy is **concatenation**.
   Result in the cloud copy of `app.json`:
   `appExtensions = [ApolloContentBlocker, ShareExtension, ApolloContentBlocker, ShareExtension]`.
4. `ensureOwnerSlugConsistencyAsync` spawns `expo config --json` a **second** time. expo-share-intent's
   `withCompatibilityChecker` now counts two `ShareExtension` entries and throws:
   ```
   Error: [expo-share-intent] Incompatibility found, you have more than one appExtensions for
   "ShareExtension" (2). Please remove all "eas.build.experimental.ios.appExtensions" with
   targetName "ShareExtension" in your app.json!
   ```
   → exit 1. eas-cli surfaces only `error.message` from `@expo/spawn-async`, swallowing stderr —
   hence the bare "exited with non-zero code: 1" in the cloud log.

Why it never failed locally: nothing in the sandbox ever removed `projectId`, so the
re-link/write-back cycle never ran. Reproduced deterministically in a pristine copy by replaying
steps 1–4 exactly (exit 1 with the error above).

## Ruled out (each tested directly, all exit 0)

| Hypothesis | Test | Result |
|---|---|---|
| Fresh dependency tree | `git archive HEAD` → `yarn install --frozen-lockfile` → `expo config --json` | pass |
| No git / `EAS_NO_VCS=1` / `EXPO_NO_DOTENV=1` | exact eas-cli spawn (`./node_modules/expo/bin/cli` via shebang) | pass |
| `--type public` / `prebuild` / `introspect` | all three | pass |
| Builder Node version | Node 18.20.8, 20.20.2, 22.23.2, 24.19.0 | pass (18 prints an "outdated" warning only) |
| `packages/` absent next to `frontend/` | directory temporarily hidden | pass |
| Plain `projectId` re-insertion without plugin-evaluated `extra` | `modifyConfigAsync` with raw `app.json` extra | pass |
| **Faithful `saveProjectIdToAppConfigAsync` replay (plugin-evaluated `extra`)** | as eas-cli does it | **exit 1 — reproduced** |

## Fix applied (approved by user, 2026-06)

- **New** `frontend/plugins/withEasAppExtensionsDedupe.js` — de-duplicates
  `extra.eas.build.experimental.ios.appExtensions` by `targetName`, keeping the first occurrence
  and its original object contents/order. Scope is strictly that one array; nothing else is read
  or written.
- `frontend/app.json` — registered as the **first** plugin (must run before `expo-share-intent`).
- Rejected alternative: moving the ApolloContentBlocker declaration into `withApolloSiteGuard.js`
  clears one write-back only; it fails again on any subsequent write-back. The dedupe makes the
  config idempotent under repeated EAS write-backs.
- Untouched: GuardDog source, `withGuardDogEngine.js`, Site Guard/Call Guard behaviour, Hermes,
  `SecurityPlatformAdapter.ts`, Higgins, Patrol, consumer UI.

## Verification (all pass)

| # | Check | Result |
|---|---|---|
| 1 | `expo config --json` (exact eas-cli invocation) | exit 0; `plugins[0] = ./plugins/withEasAppExtensionsDedupe` |
| 2 | `expo config --json --type introspect` (executes all mods) | exit 0 |
| 3–5 | 3 consecutive EAS-style write-back → evaluate rounds on a pristine copy | exit 0 every round; evaluated set exactly `[ApolloContentBlocker, ShareExtension]`; 0 duplicate targetNames |
| 6 | `expo prebuild --platform android --clean` (sandbox copy) | exit 0, no warnings |
| 7 | GuardDog resolves exactly once | `include(':guarddog-core')` ×1, `include(':guarddog-vpn')` ×1 in settings.gradle; serialization classpath ×1; autolinking: `guarddog-expo-module` → 1 project; `android.minSdkVersion=26` |
| 8 | Stage 1B SHA-256 manifest | `sha256sum -c` → 91/91 OK |
| 9 | Regression suites | adapter-contract 7/7, security 8/8, platform 11/11, truth 5/5, evidence-sync 4/4 = **35/35** |
| — | `eslint` on new plugin | no issues |

## Next success criterion

Step 7 `eas-update` passes and the pipeline proceeds beyond `eas project:init` into the
deployment / native Android build stages (Stage 1C.1). Stage 1D not started.

---

## (Historical) Request to Emergent Support — no longer needed

For build `aa24dd73-eab7-4d0f-8b83-4734adb870b8`, please provide:
1. The complete **stderr** of `node_modules/expo/bin/cli config --json` as executed by `eas project:init`.
2. The **working directory** the command was run from (expected: the `frontend/` app root, where `app.json` lives).
3. Node / `@expo/cli` / `eas-cli` versions and any env vars set for Step 7 (e.g. `EXPO_DEBUG`, `CI`, `EXPO_NO_TELEMETRY`).
4. Whether `node_modules` were installed with yarn 1.x per `package.json` before Step 7 ran.

Locally the same command passes with exit 0 on Node v24.19.0 / `@expo/cli` 57.0.21 / `expo` 57.0.19 at commit `a2c8ee0`.
