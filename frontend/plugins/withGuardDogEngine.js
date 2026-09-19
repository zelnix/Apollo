// Expo config plugin: wires the certified GuardDog Android engine (Stage 1B-staged source at
// packages/guarddog-android-sdk, commit e5d11be912c76775c5a8b27b53218211484ca8bd) into Apollo's
// generated native Android project — Stage 1C, build integration only.
//
// What this plugin does NOT do (deliberately, per Stage 1C scope):
//   - It does not touch consumer UI, Higgins, SecurityPlatformAdapter.ts, Patrol, or threat-event
//     semantics.
//   - It does not start/activate the VPN from the consumer app — that is production adapter/
//     native-runtime wiring (Stage 1D), a separate, later, separately-approved stage.
//   - It does not modify a single byte of the certified GuardDog source under packages/.
//
// What it DOES wire, and why:
//   1. `:guarddog-core` and `:guarddog-vpn` are plain Android library Gradle modules (NOT Expo
//      modules — no expo-module.config.json, so Expo's autolinking correctly does not discover
//      them). They must be `include()`-d into the generated android/settings.gradle by hand, with
//      their projectDir pointed at the staged, untouched source in packages/guarddog-android-sdk.
//   2. `guarddog-expo-module` (the Expo bridge) IS an Expo module (has expo-module.config.json) and
//      is auto-discovered by expo-modules-autolinking because packages/ is registered as an extra
//      autolinking search path in frontend/package.json's "expo.autolinking.searchPaths" — no
//      action needed here for it specifically, but withSourceCheck below still verifies it exists.
//   3. guarddog-vpn's own AndroidManifest.xml already declares the VpnService + its required
//      permissions (INTERNET, ACCESS_NETWORK_STATE, FOREGROUND_SERVICE,
//      FOREGROUND_SERVICE_SYSTEM_EXEMPTED, POST_NOTIFICATIONS) — Android's own Gradle manifest
//      merger picks these up automatically once :guarddog-vpn is a real dependency (via
//      guarddog-expo-module's `implementation project(':guarddog-vpn')`). No manual manifest edit
//      needed here for that reason.
//   4. guarddog-core/guarddog-vpn apply `org.jetbrains.kotlin.plugin.serialization` with no pinned
//      version (expected to resolve from a version already registered on the including build).
//      Apollo's generated root android/build.gradle does not otherwise register this plugin id, so
//      it must be added here (root build.gradle only — never inside the certified packages/ source).
//      `com.android.library` and `org.jetbrains.kotlin.android` need no such addition: React
//      Native 0.86.3's own version catalog (node_modules/react-native/gradle/libs.versions.toml)
//      already pins agp=8.12.0 / kotlin=2.1.20 — an exact match to what guarddog-core/vpn require
//      (see build.gradle.kts comments in packages/guarddog-android-sdk) — so those two plugin ids
//      resolve from the classpath Expo/RN already puts on the root build, with no addition needed.
//
// NOT resolved by this plugin (handled instead via the "expo-build-properties" plugin entry in
// app.json — see docs/APOLLO_STAGE1C_BUILD_INTEGRATION.md "Decision: raise Android minSdk to 26"):
// guarddog-core/guarddog-vpn declare `minSdk = 26`; this app's own minSdk is raised to match via
// expo-build-properties (a product-support decision — drops Android 7.x — approved 2026-06), not
// by this plugin and not by touching certified GuardDog source.

const { withSettingsGradle, withProjectBuildGradle, withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const MARKER = "GuardDog engine (Stage 1C)";
const SERIALIZATION_MARKER = "GuardDog kotlin.serialization plugin (Stage 1C)";

// packages/ lives inside the Expo project root (frontend/packages), i.e. one level above frontend/android/.
// It MUST be inside frontend/ because Emergent runs `eas build` from frontend/ with no VCS, and eas-cli then
// archives only the project root — anything outside frontend/ never reaches the EAS worker (Stage 1C.1 finding).
const PACKAGES_DIR_FROM_ANDROID = "../packages";
const REQUIRED_PATHS = [
  "packages/guarddog-android-sdk/guarddog-core",
  "packages/guarddog-android-sdk/guarddog-vpn",
  "packages/guarddog-expo-module",
];

/** Fail fast at prebuild time if the Stage 1B staged source is ever missing, instead of silently
 * producing a settings.gradle that points at nothing. */
const withSourceCheck = (config) =>
  withDangerousMod(config, [
    "android",
    async (config) => {
      for (const rel of REQUIRED_PATHS) {
        const abs = path.join(config.modRequest.projectRoot, rel);
        if (!fs.existsSync(abs)) {
          throw new Error(`[withGuardDogEngine] Missing staged GuardDog source at ${abs}. Stage 1B transfer must be present before Stage 1C can wire it in.`);
        }
      }
      return config;
    },
  ]);

/** include(':guarddog-core') / include(':guarddog-vpn') pointed at the staged, untouched source. */
const withGuardDogSettingsGradle = (config) =>
  withSettingsGradle(config, (config) => {
    if (config.modResults.contents.includes(MARKER)) return config;
    config.modResults.contents += `
// ${MARKER}: the certified Android engine (guarddog-core, guarddog-vpn) staged at
// packages/guarddog-android-sdk (commit e5d11be912c76775c5a8b27b53218211484ca8bd). These are plain
// Gradle library modules, not Expo modules, so they are included explicitly rather than through
// autolinking. Source is never copied or modified — projectDir points straight at the staged copy.
include(':guarddog-core')
project(':guarddog-core').projectDir = new File(rootDir, '${PACKAGES_DIR_FROM_ANDROID}/guarddog-android-sdk/guarddog-core')
include(':guarddog-vpn')
project(':guarddog-vpn').projectDir = new File(rootDir, '${PACKAGES_DIR_FROM_ANDROID}/guarddog-android-sdk/guarddog-vpn')
`;
    return config;
  });

/** Register the one Gradle plugin id guarddog-core/guarddog-vpn need that Apollo's root build
 * doesn't already provide. AGP and kotlin-android are already on the classpath at matching
 * versions via React Native's own version catalog — see file header — so only the serialization
 * plugin marker needs to be added, and only to Apollo's own generated root build.gradle. */
const withGuardDogRootBuildGradle = (config) =>
  withProjectBuildGradle(config, (config) => {
    if (config.modResults.contents.includes(SERIALIZATION_MARKER)) return config;
    const KOTLIN_VERSION = "2.1.20"; // matches react-native/gradle/libs.versions.toml's pinned "kotlin" version exactly
    config.modResults.contents = config.modResults.contents.replace(
      /buildscript\s*{\s*repositories\s*{/,
      `buildscript {\n  repositories {\n    gradlePluginPortal() // ${SERIALIZATION_MARKER}: resolves the kotlin.plugin.serialization marker artifact below`
    );
    config.modResults.contents = config.modResults.contents.replace(
      /dependencies\s*{\s*\n(\s*)classpath 'com\.google\.gms:google-services:4\.4\.4'/,
      `dependencies {\n$1classpath 'com.google.gms:google-services:4.4.4'\n$1// ${SERIALIZATION_MARKER}: required by guarddog-core/guarddog-vpn (packages/guarddog-android-sdk), which apply\n$1// org.jetbrains.kotlin.plugin.serialization without a pinned version and expect it already registered here.\n$1classpath 'org.jetbrains.kotlin.plugin.serialization:org.jetbrains.kotlin.plugin.serialization.gradle.plugin:${KOTLIN_VERSION}'`
    );
    return config;
  });

module.exports = function withGuardDogEngine(config) {
  config = withSourceCheck(config);
  config = withGuardDogSettingsGradle(config);
  config = withGuardDogRootBuildGradle(config);
  return config;
};
