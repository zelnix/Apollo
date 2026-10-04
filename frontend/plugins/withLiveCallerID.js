/* global __dirname */
// Expo config plugin: adds the "ApolloLiveCallerID" LiveCallerIDLookup extension target (iOS 18+).
// This enables real-time caller identification using Apple's Private Information Retrieval protocol.
//
// The extension queries a PIR server (configured via app group UserDefaults or Info.plist) and
// returns caller labels to iOS for display on the incoming call screen. The PIR protocol ensures
// neither Apple nor the network can determine which specific number is being queried.
//
// URL resolution in the extension (LiveCallerIDLookupHandler.swift):
//   1. Shared UserDefaults key "apollo.pir.server_url" (written by main app at startup)
//   2. Info.plist key "ApolloLiveCallerIDServerURL" (embedded at build time from app.json extra)
//
// Requirements:
//   1. Apple's "com.apple.developer.live-caller-id-lookup" entitlement (Apple-granted)
//   2. A running PIR server (see /app/docs/PIR_SERVER_DEPLOYMENT.md)
//   3. iOS 18+ device
//
// Validate on an EAS build. Expo Go cannot load app extensions.

const { withXcodeProject, withEntitlementsPlist, withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const EXT_NAME = "ApolloLiveCallerID";
const SOURCE_FILES = ["LiveCallerIDLookupHandler.swift"];

const appGroup = (bundleId) => `group.${bundleId}.apollo`;

/** Read the PIR server URL from app.json extra config (empty string if not set). */
function getPirServerUrl(config) {
  return (config.extra && config.extra.pirServer && config.extra.pirServer.url) || "";
}

function writeExtensionFiles(platformProjectRoot, bundleId, pirServerUrl) {
  const src = path.join(__dirname, "ios", EXT_NAME);
  const dest = path.join(platformProjectRoot, EXT_NAME);
  fs.mkdirSync(dest, { recursive: true });
  for (const file of SOURCE_FILES) {
    fs.copyFileSync(path.join(src, file), path.join(dest, file));
  }

  // Build the optional PIR server URL plist entry. When set in app.json extra.pirServer.url,
  // it's embedded in Info.plist as "ApolloLiveCallerIDServerURL" so the extension has a
  // build-time default. The main app can override it at runtime via shared UserDefaults.
  const pirUrlEntry = pirServerUrl
    ? `\n  <key>ApolloLiveCallerIDServerURL</key><string>${pirServerUrl}</string>`
    : "";

  // Info.plist — LiveCallerIDLookup extension
  const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleDevelopmentRegion</key><string>$(DEVELOPMENT_LANGUAGE)</string>
  <key>CFBundleDisplayName</key><string>Apollo Live Caller ID</string>
  <key>CFBundleExecutable</key><string>$(EXECUTABLE_NAME)</string>
  <key>CFBundleIdentifier</key><string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>$(PRODUCT_NAME)</string>
  <key>CFBundlePackageType</key><string>$(PRODUCT_BUNDLE_PACKAGE_TYPE)</string>
  <key>CFBundleShortVersionString</key><string>$(MARKETING_VERSION)</string>
  <key>CFBundleVersion</key><string>$(CURRENT_PROJECT_VERSION)</string>
  <key>NSExtension</key><dict>
    <key>NSExtensionPointIdentifier</key>
    <string>com.apple.identitylookup.live-caller-id</string>
    <key>NSExtensionPrincipalClass</key>
    <string>$(PRODUCT_MODULE_NAME).LiveCallerIDLookupHandler</string>
  </dict>
  <key>MinimumOSVersion</key><string>18.0</string>${pirUrlEntry}
</dict></plist>
`;
  fs.writeFileSync(path.join(dest, "Info.plist"), infoPlist);

  // Entitlements — Live Caller ID + App Group
  const entitlements = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>com.apple.developer.live-caller-id-lookup</key><true/>
  <key>com.apple.security.application-groups</key>
  <array><string>${appGroup(bundleId)}</string></array>
</dict></plist>
`;
  fs.writeFileSync(path.join(dest, `${EXT_NAME}.entitlements`), entitlements);
}

// Add the Live Caller ID entitlement to the main app as well
const withLiveCallerIDEntitlement = (config) =>
  withEntitlementsPlist(config, (mod) => {
    mod.modResults["com.apple.developer.live-caller-id-lookup"] = true;
    const group = appGroup(mod.ios.bundleIdentifier);
    const groups = mod.modResults["com.apple.security.application-groups"] || [];
    if (!groups.includes(group)) groups.push(group);
    mod.modResults["com.apple.security.application-groups"] = groups;
    return mod;
  });

const withLiveCallerIDExtension = (config) =>
  withXcodeProject(config, (mod) => {
    const proj = mod.modResults;
    const bundleId = mod.ios.bundleIdentifier;
    const extBundleId = `${bundleId}.${EXT_NAME}`;

    // Check if target already exists
    const existing = proj.pbxTargetByName(EXT_NAME);
    if (existing) return mod;

    // Add app extension target
    const target = proj.addTarget(EXT_NAME, "app_extension", EXT_NAME, extBundleId);
    const groupKey = proj.pbxCreateGroup(EXT_NAME, EXT_NAME);
    proj.addToPbxGroup(groupKey, proj.getFirstProject().firstProject.mainGroup);

    // Add source files to the target
    for (const file of SOURCE_FILES) {
      proj.addSourceFile(`${EXT_NAME}/${file}`, { target: target.uuid }, groupKey);
    }
    // Add resource files
    proj.addResourceFile(`${EXT_NAME}/Info.plist`, {}, groupKey);

    // Set build settings
    const configs = proj.pbxXCBuildConfigurationSection();
    for (const key in configs) {
      if (typeof configs[key] === "object" && configs[key].buildSettings) {
        const bs = configs[key].buildSettings;
        if (bs.PRODUCT_BUNDLE_IDENTIFIER === `"${extBundleId}"` || bs.PRODUCT_NAME === `"${EXT_NAME}"`) {
          bs.IPHONEOS_DEPLOYMENT_TARGET = "18.0";
          bs.SWIFT_VERSION = "5.0";
          bs.CODE_SIGN_ENTITLEMENTS = `${EXT_NAME}/${EXT_NAME}.entitlements`;
          bs.TARGETED_DEVICE_FAMILY = '"1,2"';
          bs.GENERATE_INFOPLIST_FILE = "NO";
          bs.INFOPLIST_FILE = `${EXT_NAME}/Info.plist`;
          bs.SKIP_INSTALL = "YES";
          bs.MARKETING_VERSION = mod.version || "1.0.0";
          bs.CURRENT_PROJECT_VERSION = (mod.ios && mod.ios.buildNumber) || "1";
          bs.CODE_SIGN_STYLE = "Automatic";
        }
      }
    }
    return mod;
  });

const withExtensionFiles = (config) =>
  withDangerousMod(config, ["ios", (mod) => {
    const bundleId = mod.ios.bundleIdentifier;
    const pirServerUrl = getPirServerUrl(mod);
    writeExtensionFiles(mod.modRequest.platformProjectRoot, bundleId, pirServerUrl);
    return mod;
  }]);

module.exports = function withLiveCallerID(config) {
  config = withLiveCallerIDEntitlement(config);
  config = withLiveCallerIDExtension(config);
  config = withExtensionFiles(config);
  return config;
};
