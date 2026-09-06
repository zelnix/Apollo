// Expo config plugin: links the standalone Android SDK modules into the prebuilt app so the
// Guard Dog Expo module (which depends on :guarddog-core and :guarddog-vpn) compiles.
// Library manifests (VPN service, FGS type, permissions) merge automatically from :guarddog-vpn.
// The plugin lives outside the app's node_modules: resolve expo's plugin API from the app root.
const { withSettingsGradle, withAndroidManifest, withDangerousMod, AndroidConfig } = require(require.resolve("expo/config-plugins", { paths: [process.cwd(), __dirname] }));
const fs = require("fs");
const path = require("path");

const MODULES = ["guarddog-core", "guarddog-vpn"];

function withGuardDogAndroidSdk(config) {
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
