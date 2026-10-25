/* global __dirname */
// Replaces expo-share-intent's generated iOS controller with Apollo's bounded,
// protected, atomic multi-item handoff while retaining the package's Android path.
const { withXcodeProject } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const TARGET = "ApolloShareExtension";
const APP_GROUP = "group.app.apollo.hwg.apollo";
const SOURCE = "ShareViewController.swift";
const INFO_PLIST = "ShareExtension-Info.plist";
// The name under the icon in the iPhone share sheet. The Xcode target keeps its own name ("Apollo Share Extension"
// in expo-share-intent's settings), because renaming the target would change the build's extension setup.
const SHARE_SHEET_NAME = "ApolloSG";

module.exports = function withApolloShareIntake(config) {
  return withXcodeProject(config, (value) => {
    const source = path.join(__dirname, "ios", TARGET, SOURCE);
    const target = path.join(value.modRequest.platformProjectRoot, TARGET, SOURCE);
    if (!fs.existsSync(source)) throw new Error(`[withApolloShareIntake] Missing ${source}`);
    if (!fs.existsSync(path.dirname(target))) throw new Error(`[withApolloShareIntake] Missing generated target directory ${path.dirname(target)}; register this plugin immediately before expo-share-intent so its Xcode mod executes after package generation.`);
    const content = fs.readFileSync(source, "utf8").replaceAll("<APP_GROUP>", APP_GROUP).replaceAll("<URL_SCHEME>", "apollo");
    fs.writeFileSync(target, content);
    const infoPath = path.join(path.dirname(target), INFO_PLIST);
    if (!fs.existsSync(infoPath)) throw new Error(`[withApolloShareIntake] Missing generated ${infoPath}`);
    const info = fs.readFileSync(infoPath, "utf8");
    const renamed = info.replace(/(<key>CFBundleDisplayName<\/key>\s*<string>)[^<]*(<\/string>)/, `$1${SHARE_SHEET_NAME}$2`);
    if (renamed === info && !info.includes(`<string>${SHARE_SHEET_NAME}</string>`)) throw new Error(`[withApolloShareIntake] No CFBundleDisplayName in ${infoPath}`);
    fs.writeFileSync(infoPath, renamed);
    // pbxTargetByName is unreliable immediately after addTarget in node-xcode.
    // The generated directory proves package ordering; persisted prebuild checks prove target count.
    const configurations = value.modResults.pbxXCBuildConfigurationSection();
    for (const key in configurations) {
      const settings = configurations[key].buildSettings;
      if (!settings || settings.PRODUCT_NAME !== `"${TARGET}"`) continue;
      settings.IPHONEOS_DEPLOYMENT_TARGET = "16.4";
      settings.APPLICATION_EXTENSION_API_ONLY = "YES";
      settings.SKIP_INSTALL = "YES";
    }
    return value;
  });
};