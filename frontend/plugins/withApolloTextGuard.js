/* global __dirname */
// Adds ApolloMessageFilter as a real iOS Message Filter extension target. Classification is local;
// the extension stores only a digest, score and reasons in Apollo's shared App Group.
const { withDangerousMod, withEntitlementsPlist, withXcodeProject } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const EXT_NAME = "ApolloMessageFilter";
const SOURCE_FILES = ["MessageFilterExtension.swift"];
const CONFIG_FILES = ["Info.plist", `${EXT_NAME}.entitlements`];
const appGroup = (bundleId) => `group.${bundleId}.apollo`;

function registerCredentialTarget(config) {
  const ios = config.extra?.eas?.build?.experimental?.ios;
  if (!ios) return;
  ios.appExtensions = ios.appExtensions || [];
  if (!ios.appExtensions.some((item) => item.targetName === EXT_NAME)) {
    ios.appExtensions.push({ targetName: EXT_NAME, bundleIdentifier: `${config.ios.bundleIdentifier}.messagefilter`, entitlements: { "com.apple.security.application-groups": [appGroup(config.ios.bundleIdentifier)] } });
  }
}

function writeFiles(root, bundleId) {
  const src = path.join(__dirname, "ios", EXT_NAME);
  const dest = path.join(root, EXT_NAME);
  fs.mkdirSync(dest, { recursive: true });
  for (const file of [...SOURCE_FILES, "Info.plist"]) fs.copyFileSync(path.join(src, file), path.join(dest, file));
  fs.writeFileSync(path.join(dest, `${EXT_NAME}.entitlements`), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>com.apple.security.application-groups</key><array><string>${appGroup(bundleId)}</string></array></dict></plist>\n`);
}

module.exports = function withApolloTextGuard(config) {
  registerCredentialTarget(config);
  config = withDangerousMod(config, ["ios", async (value) => {
    const src = path.join(__dirname, "ios", EXT_NAME);
    if (!fs.existsSync(src)) throw new Error(`[withApolloTextGuard] Missing ${src}`);
    return value;
  }]);
  config = withEntitlementsPlist(config, (value) => {
    const group = appGroup(value.ios.bundleIdentifier);
    const existing = value.modResults["com.apple.security.application-groups"] || [];
    if (!existing.includes(group)) value.modResults["com.apple.security.application-groups"] = [...existing, group];
    return value;
  });
  return withXcodeProject(config, (value) => {
    const bundleId = value.ios.bundleIdentifier;
    writeFiles(value.modRequest.platformProjectRoot, bundleId);
    const pbx = value.modResults;
    if (pbx.pbxTargetByName(EXT_NAME)) return value;
    const files = [...SOURCE_FILES, ...CONFIG_FILES];
    const group = pbx.addPbxGroup(files, EXT_NAME, EXT_NAME);
    const groups = pbx.hash.project.objects.PBXGroup;
    Object.keys(groups).forEach((key) => { if (typeof groups[key] === "object" && groups[key].name === undefined && groups[key].path === undefined) pbx.addToPbxGroup(group.uuid, key); });
    const objects = pbx.hash.project.objects;
    objects.PBXTargetDependency = objects.PBXTargetDependency || {};
    objects.PBXContainerItemProxy = objects.PBXContainerItemProxy || {};
    const target = pbx.addTarget(EXT_NAME, "app_extension", EXT_NAME, `${bundleId}.messagefilter`);
    pbx.addBuildPhase(SOURCE_FILES, "PBXSourcesBuildPhase", "Sources", target.uuid);
    pbx.addBuildPhase([], "PBXFrameworksBuildPhase", "Frameworks", target.uuid);
    const configurations = pbx.pbxXCBuildConfigurationSection();
    for (const key in configurations) {
      const bs = configurations[key].buildSettings;
      if (!bs || bs.PRODUCT_NAME !== `"${EXT_NAME}"`) continue;
      bs.INFOPLIST_FILE = `"${EXT_NAME}/Info.plist"`;
      bs.CODE_SIGN_ENTITLEMENTS = `"${EXT_NAME}/${EXT_NAME}.entitlements"`;
      bs.CODE_SIGN_STYLE = "Automatic";
      bs.PRODUCT_BUNDLE_IDENTIFIER = `"${bundleId}.messagefilter"`;
      bs.SWIFT_VERSION = "5.0";
      bs.IPHONEOS_DEPLOYMENT_TARGET = "16.4";
      bs.TARGETED_DEVICE_FAMILY = `"1,2"`;
      bs.MARKETING_VERSION = value.version || "1.0.0";
      bs.CURRENT_PROJECT_VERSION = value.ios?.buildNumber || "1";
      bs.GENERATE_INFOPLIST_FILE = "NO";
      bs.SKIP_INSTALL = "YES";
    }
    return value;
  });
};