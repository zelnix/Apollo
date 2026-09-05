// Expo config plugin: adds the "ApolloContentBlocker" Safari Content Blocker
// extension target (iOS) and the shared App Group used to hand the rule list
// from the app to the extension. Android needs nothing here: the DNS filter
// service lives in modules/apollo-security and is merged via its manifest.
//
// Validate on an EAS build. Expo Go cannot load app extensions.

const { withXcodeProject, withEntitlementsPlist, withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const EXT_NAME = "ApolloContentBlocker";
const SOURCE_FILES = ["ContentBlockerRequestHandler.swift"];
const RESOURCE_FILES = ["blockerList.json"];
const CONFIG_FILES = ["Info.plist", `${EXT_NAME}.entitlements`];

const appGroup = (bundleId) => `group.${bundleId}.apollo`;

function writeExtensionFiles(platformProjectRoot, bundleId) {
  const src = path.join(__dirname, "ios", EXT_NAME);
  const dest = path.join(platformProjectRoot, EXT_NAME);
  fs.mkdirSync(dest, { recursive: true });
  for (const file of [...SOURCE_FILES, ...RESOURCE_FILES, "Info.plist"]) {
    fs.copyFileSync(path.join(src, file), path.join(dest, file));
  }
  const entitlements = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>com.apple.security.application-groups</key>
  <array><string>${appGroup(bundleId)}</string></array>
</dict></plist>
`;
  fs.writeFileSync(path.join(dest, `${EXT_NAME}.entitlements`), entitlements);
}

const withAppGroupEntitlement = (config) =>
  withEntitlementsPlist(config, (config) => {
    const group = appGroup(config.ios.bundleIdentifier);
    const existing = config.modResults["com.apple.security.application-groups"] || [];
    if (!existing.includes(group)) config.modResults["com.apple.security.application-groups"] = [...existing, group];
    return config;
  });

const withContentBlockerTarget = (config) =>
  withXcodeProject(config, (config) => {
    const bundleId = config.ios.bundleIdentifier;
    const extBundleId = `${bundleId}.contentblocker`;
    writeExtensionFiles(config.modRequest.platformProjectRoot, bundleId);
    const pbx = config.modResults;
    if (pbx.pbxTargetByName(EXT_NAME)) return config;

    const allFiles = [...SOURCE_FILES, ...RESOURCE_FILES, ...CONFIG_FILES];
    const extGroup = pbx.addPbxGroup(allFiles, EXT_NAME, EXT_NAME);
    const groups = pbx.hash.project.objects.PBXGroup;
    Object.keys(groups).forEach((key) => {
      if (typeof groups[key] === "object" && groups[key].name === undefined && groups[key].path === undefined) pbx.addToPbxGroup(extGroup.uuid, key);
    });
    const objects = pbx.hash.project.objects;
    objects.PBXTargetDependency = objects.PBXTargetDependency || {};
    objects.PBXContainerItemProxy = objects.PBXContainerItemProxy || {};

    const target = pbx.addTarget(EXT_NAME, "app_extension", EXT_NAME, extBundleId);
    pbx.addBuildPhase(SOURCE_FILES, "PBXSourcesBuildPhase", "Sources", target.uuid);
    pbx.addBuildPhase(RESOURCE_FILES, "PBXResourcesBuildPhase", "Resources", target.uuid);
    pbx.addBuildPhase([], "PBXFrameworksBuildPhase", "Frameworks", target.uuid);

    const configurations = pbx.pbxXCBuildConfigurationSection();
    for (const key in configurations) {
      const bs = configurations[key].buildSettings;
      if (!bs || bs.PRODUCT_NAME !== `"${EXT_NAME}"`) continue;
      bs.INFOPLIST_FILE = `"${EXT_NAME}/Info.plist"`;
      bs.CODE_SIGN_ENTITLEMENTS = `"${EXT_NAME}/${EXT_NAME}.entitlements"`;
      bs.CODE_SIGN_STYLE = "Automatic";
      bs.PRODUCT_BUNDLE_IDENTIFIER = `"${extBundleId}"`;
      bs.SWIFT_VERSION = "5.0";
      bs.IPHONEOS_DEPLOYMENT_TARGET = "15.1";
      bs.TARGETED_DEVICE_FAMILY = `"1,2"`;
      bs.MARKETING_VERSION = config.version || "1.0.0";
      bs.CURRENT_PROJECT_VERSION = (config.ios && config.ios.buildNumber) || "1";
      bs.GENERATE_INFOPLIST_FILE = "NO";
      bs.SKIP_INSTALL = "YES";
    }
    return config;
  });

/** Make sure the plugin's own source folder exists at prebuild time (no-op mod for clarity). */
const withSourceCheck = (config) =>
  withDangerousMod(config, ["ios", async (config) => {
    const src = path.join(__dirname, "ios", EXT_NAME);
    if (!fs.existsSync(src)) throw new Error(`[withApolloSiteGuard] Missing ${src}`);
    return config;
  }]);

module.exports = function withApolloSiteGuard(config) {
  config = withSourceCheck(config);
  config = withAppGroupEntitlement(config);
  config = withContentBlockerTarget(config);
  return config;
};
