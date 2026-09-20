# Post-merge / native-build dependency singleton safeguard

**Saved implementation commit:** `6d71e8f4a48a8a0e22d5a74b4d6e395e7cc62094`.
Verified from history after the implementation was saved; supersedes the completion report's
temporary “commit pending” note. This is the guard's source revision, not a verified APK hash.

Added 2026-09-20 after Support ticket 257445 / fix `01a30ae`: two installed versions of
`react-native-svg` registered `RNSVGCircle` twice and crashed the Android app after splash.
This guard is read-only. It does not install, deduplicate, upgrade, pin, delete, or rewrite dependencies.
The existing SVG dependency **and** Yarn resolution remain **15.15.4**; the lockfile is unchanged.

## Implementation and coverage

- CLI/API: `frontend/scripts/native-dependency-guard.cjs`
- Filesystem traversal: `frontend/scripts/native-dependencies/scan.cjs`
- Explicit policy / native metadata detection: `frontend/scripts/native-dependencies/policy.cjs`
- Native-build gate: `frontend/plugins/withNativeDependencyGuard.js`, registered in `app.json`
- Regression tests: `frontend/tests/nativeDependencyGuard.test.cjs`

Explicit singletons: `react-native-svg`, `react-native-reanimated`, `react-native-screens`,
`react-native-gesture-handler`, `react-native-safe-area-context`, `react-native-webview`,
`react-native-worklets`, `react-native`, `react-native-keyboard-controller`,
`@react-native-async-storage/async-storage`, `expo`, and `expo-modules-core`.

Additionally discovers **all installed packages with native metadata**, including `expo-*`,
scoped `@expo/*` and third-party packages. Evidence: `expo-module.config.json` or legacy
`unimodule.json` with Android/iOS/Apple platforms, a root `.podspec`, or
`android/build.gradle[.kts]`. Pure JS tooling is not made singleton just because it starts with
`expo-` or has a `react-native` JS entry point. Web-only Expo metadata is not native evidence.
If any version is native, **all installed copies of that package name** are checked, including
older copies lacking that metadata.

The scan follows nested and scoped `node_modules` at every depth (not only direct dependencies),
includes ancestor workspace-hoisted node_modules and configured Expo autolinking search roots /
local module directory, and checks actual installed package manifests, not just lockfile strings.
Aliases are grouped by manifest package name. A realpath visited set terminates symlink cycles.
Unversioned local native source projects are not npm package versions; their existing build
checks and the separate GuardDog provenance manifest remain authoritative.

**Failure policy:** more than one physical installation of a native package fails, whether
the versions differ or are identical. Two copies of one version can also register a view twice.
Multiple symlinks to the **same** physical package do not fail. Every installation's version,
logical path and (where different) real path is printed. Malformed metadata, broken package
symlinks and missing/empty installations fail closed rather than reporting a clean audit.
This implementation supports the project's Yarn Classic / node_modules layout; pnpm virtual
stores explicitly fail as unsupported, and an absent PnP-only node_modules tree cannot pass.

## Invocation and failure propagation

From the Expo project directory, **after installing from the committed lockfile**:

```sh
cd frontend
node scripts/native-dependency-guard.cjs
node scripts/native-dependency-guard.cjs --json
yarn security:preflight
node --test tests/nativeDependencyGuard.test.cjs tests/securityConfig.test.ts tests/securityBoot.test.ts
```

CLI exit codes: **0** clean, **1** native duplicates, **2** incomplete/unreadable/unsupported
installation or invalid CLI usage. `--root PATH` is available for isolated audit fixtures.
JSON includes full inventory, discovery reasons, versions, physical/logical paths, errors,
duplicates and status. Human output prints the checked inventory and a STOP message on duplicates.

### CI / post-merge

`.github/workflows/native-dependencies.yml` runs on relevant pull requests, pushes (including
post-merge), and manual dispatch. It uses Node 24 / Yarn 1.22.22, installs with
`yarn install --frozen-lockfile --non-interactive`, then runs the standalone guard, focused
tests, combined security preflight, and the frozen GuardDog SHA-256 manifest check. A nonzero
guard exit fails the job. The workflow does not require application secrets. Repository-required
status/branch rules are external settings; adding this workflow does not configure those rules.

### Preflight / native build

The existing `yarn security:preflight` now validates security policy **and** the installed native
tree, propagating duplicate/error exit codes. It does not skip an absent installation.

**Important timing:** EAS invokes `eas-build-pre-install` before dependencies are installed.
Only that actual npm lifecycle (`npm_lifecycle_event=eas-build-pre-install`) logs **DEFERRED**
for the dependency scan; security policy validation still runs and can fail. This is not a
successful dependency audit. The registered native config plugin enforces the same guard in
both Android and iOS prebuild mods, **after installation and before native compilation**. Any
failure throws the full report and aborts prebuild. The guard requires only Node built-ins.

Current app is managed / native directories are generated by prebuild. If generated `android/`
or `ios/` projects are committed later and a pipeline skips prebuild, that pipeline MUST run the
standalone guard after install and before Gradle/Xcode; CI remains applicable regardless.
Ordering reference: https://docs.expo.dev/build-reference/android-builds/ .

## One-time installed dependency audit — 2026-09-20

**PASS: 888 installed package directories inspected; 50 native package names checked;
0 duplicate native packages; 0 scan errors.** Every entry below has exactly one physical copy.
This is the current workspace's installed tree, not proof of a future hosted CI install or APK.

Except the local GuardDog bridge, each path below is `frontend/node_modules/<package name>`:

| Native package | Installed version |
|---|---|
| @expo/dom-webview | 57.0.1 |
| @expo/log-box | 57.0.4 |
| @expo/ui | 57.0.15 |
| @react-native-async-storage/async-storage | 2.2.0 |
| @react-native-masked-view/masked-view | 0.3.2 |
| expo | 57.0.19 |
| expo-application | 57.0.2 |
| expo-asset | 57.0.16 |
| expo-audio | 57.0.4 |
| expo-blur | 57.0.2 |
| expo-camera | 57.0.4 |
| expo-clipboard | 57.0.1 |
| expo-constants | 57.0.17 |
| expo-crypto | 57.0.2 |
| expo-device | 57.0.1 |
| expo-document-picker | 57.0.1 |
| expo-file-system | 57.0.6 |
| expo-font | 57.0.3 |
| expo-glass-effect | 57.0.1 |
| expo-haptics | 57.0.2 |
| expo-image | 57.0.4 |
| expo-image-loader | 57.0.1 |
| expo-image-picker | 57.0.16 |
| expo-keep-awake | 57.0.1 |
| expo-linear-gradient | 57.0.1 |
| expo-linking | 57.0.9 |
| expo-modules-core | 57.0.15 |
| expo-modules-jsi | 57.0.7 |
| expo-network | 57.0.1 |
| expo-notifications | 57.0.17 |
| expo-print | 57.0.1 |
| expo-router | 57.0.18 |
| expo-secure-store | 57.0.3 |
| expo-share-intent | 8.0.1 |
| expo-sharing | 57.0.18 |
| expo-splash-screen | 57.0.8 |
| expo-status-bar | 57.0.1 |
| expo-symbols | 57.0.2 |
| expo-system-ui | 57.0.3 |
| expo-web-browser | 57.0.2 |
| guarddog-expo-module (frontend/packages/guarddog-expo-module) | 0.1.0 |
| react-native | 0.86.3 |
| react-native-gesture-handler | 2.32.0 |
| react-native-keyboard-controller | 1.21.9 |
| react-native-reanimated | 4.5.1 |
| react-native-safe-area-context | 5.7.0 |
| react-native-screens | 4.26.2 |
| react-native-svg | **15.15.4** |
| react-native-webview | 13.16.1 |
| react-native-worklets | 0.10.1 |

No duplicates were found, so no version remediation was undertaken. If a later audit finds
duplicates, **stop and report every version/path before changing versions**. The guard must not
silently repair or accept a duplicate tree. The deliberate SVG override can still produce a
Yarn range warning for heroicons; the physical installed tree, not that warning alone, is checked.

## Verification / remaining acceptance

- Final focused verification: **44/44 tests pass** (29 guard tests + 15 existing security/boot tests), independently re-run with the same result in `test_reports/iteration_61.json`.
  Includes a reproduction of the 13.14.1/15.15.4 nested SVG incident, every explicit singleton,
  automatic native discovery, same-version copies, symlinks/cycles, scoped packages, workspace
  hoisting, incomplete/malformed installs, JSON/exit codes and no mutation. Both native mod
  callbacks pass clean fixtures and reject duplicates; combined preflight tests cover EAS timing.
- Changed-code ESLint, resolved Expo config, standalone audit and actual combined preflight pass.
- Independent verification also confirms CI YAML/command wiring, all 91 GuardDog hashes, SVG pin/lockfile preservation, the 888/50/0 audit and a loading preview. Raw audit: `test_reports/native_guard_audit_iter61.json`. No blocking defects or application-code changes were reported by the tester.
- Hosted CI, full Gradle/Xcode builds and physical-device startup are **not claimed** by these checks.
- Frozen GuardDog source must continue matching `APOLLO_STAGE1B_SHA256_MANIFEST.txt` (91 entries).
- **Physical launch prerequisite passed by user confirmation on 2026-09-20:** the user reported
  “App is running as expected” and explicitly confirmed a freshly built APK on Pixel 10.
  This is separate device evidence, not a result of the automated guard tests. See Stage 1C §15.
- **Stage 1D remains unstarted pending separate approval.** Native packet-block proof, repeated
  reboot/reopen testing, push delivery and exact APK/build provenance were not established by
  this confirmation or this dependency safeguard.