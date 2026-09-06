// Expo config plugin: links the standalone Android SDK modules into the prebuilt app so the
// Guard Dog Expo module (which depends on :guarddog-core and :guarddog-vpn) compiles.
// Library manifests (VPN service, FGS type, permissions) merge automatically from :guarddog-vpn.
// The plugin lives outside the app's node_modules: resolve expo's plugin API from the app root.
const { withSettingsGradle, withProjectBuildGradle, withAppBuildGradle, withAndroidManifest, withDangerousMod, AndroidConfig } = require(require.resolve("expo/config-plugins", { paths: [process.cwd(), __dirname] }));
const fs = require("fs");
const path = require("path");

const MODULES = ["guarddog-core", "guarddog-vpn"];

// :guarddog-core applies org.jetbrains.kotlin.plugin.serialization without a version (versions live in the standalone SDK
// root build). Inside the prebuilt app the plugin must be on the root buildscript classpath, matching the app's Kotlin version.
function reactNativeKotlinVersion(projectRoot) {
  const toml = fs.readFileSync(path.join(projectRoot, "node_modules", "react-native", "gradle", "libs.versions.toml"), "utf8");
  const m = toml.match(/^kotlin\s*=\s*"([^"]+)"/m);
  if (!m) throw new Error("guarddog plugin: cannot determine React Native Kotlin version");
  return m[1];
}

function withGuardDogAndroidSdk(config) {
  config = withProjectBuildGradle(config, (mod) => {
    const line = `    classpath('org.jetbrains.kotlin:kotlin-serialization:${reactNativeKotlinVersion(mod.modRequest.projectRoot)}') // guarddog-core`;
    if (!mod.modResults.contents.includes("kotlin-serialization")) {
      mod.modResults.contents = mod.modResults.contents.replace(/(classpath\('org\.jetbrains\.kotlin:kotlin-gradle-plugin'\)\n)/, `$1${line}\n`);
    }
    return mod;
  });
  config = withAppBuildGradle(config, (mod) => {
    // The M1 proof APK is a self-contained development build (debuggable, no Metro). React Native's default
    // `debuggableVariants = ["debug"]` SKIPS JS bundling for the debug variant and the phone shows "Unable to load script"
    // (ReactInstance.loadJSBundleFromAssets). Bundling every variant embeds assets/index.android.bundle (Hermes bytecode with the
    // EXPO_PUBLIC_GIT_SHA / EXPO_PUBLIC_CI_RUN_ID provenance inlined). Metro still takes precedence when a dev server is reachable.
    const line = '    debuggableVariants = [] // guarddog: embed the JS bundle in the dev (debug) APK for standalone device proof';
    if (!/^\s*debuggableVariants\s*=/m.test(mod.modResults.contents)) {
      mod.modResults.contents = mod.modResults.contents.replace(/(\n\s*bundleCommand = "export:embed"\n)/, `$1${line}\n`);
      if (!mod.modResults.contents.includes("guarddog: embed the JS bundle")) throw new Error("guarddog plugin: could not locate the react { bundleCommand } block in app/build.gradle");
    }
    return mod;
  });
  config = withSettingsGradle(config, (mod) => {
    const sdkDir = path.relative(path.join(mod.modRequest.projectRoot, "android"), path.join(mod.modRequest.projectRoot, "..", "packages", "guarddog-android-sdk"));
    for (const m of MODULES) {
      const line = `include(':${m}')\nproject(':${m}').projectDir = new File(rootProject.projectDir, '${sdkDir.split(path.sep).join("/")}/${m}')`;
      if (!mod.modResults.contents.includes(`include(':${m}')`)) mod.modResults.contents += `\n${line}\n`;
    }
    return mod;
  });
  config = withAndroidManifest(config, (mod) => {
    for (const perm of ["android.permission.ACCESS_NETWORK_STATE", "android.permission.FOREGROUND_SERVICE", "android.permission.FOREGROUND_SERVICE_SYSTEM_EXEMPTED", "android.permission.POST_NOTIFICATIONS"]) {
      AndroidConfig.Permissions.addPermission(mod.modResults, perm);
    }
    return mod;
  });
  config = withDangerousMod(config, [
    "ios",
    async (mod) => {
      // CocoaPods integration for the Swift core package consumed by the Expo iOS module.
      const podfile = path.join(mod.modRequest.platformProjectRoot, "Podfile");
      let contents = fs.readFileSync(podfile, "utf8");
      const line = "  pod 'GuardDogCore', :path => '../../packages/guarddog-ios-sdk/GuardDogCore'";
      if (!contents.includes("pod 'GuardDogCore'")) {
        contents = contents.replace(/(target ['"][^'"]+['"] do\n)/, `$1${line}\n`);
        fs.writeFileSync(podfile, contents);
      }
      return mod;
    },
  ]);
  return config;
}

module.exports = withGuardDogAndroidSdk;
