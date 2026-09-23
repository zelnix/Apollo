import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const app = JSON.parse(read("../app.json"));

test("iOS target inventory has unique canonical identifiers and one shared App Group", () => {
  assert.equal(app.expo.ios.bundleIdentifier, "app.apollo.hwg");
  assert.equal(app.expo.android.package, "app.apollo.hwg");
  assert.equal(app.expo.orientation, "default");
  const extensions = app.expo.extra.eas.build.experimental.ios.appExtensions;
  assert.deepEqual(extensions.map((row: { targetName: string }) => row.targetName), ["ApolloFamilyAssistBroadcast", "ApolloShareExtension", "ApolloContentBlocker", "ApolloCallDirectory", "ApolloMessageFilter"]);
  assert.equal(new Set(extensions.map((row: { bundleIdentifier: string }) => row.bundleIdentifier)).size, 5);
  for (const row of extensions) assert.deepEqual(row.entitlements["com.apple.security.application-groups"], ["group.app.apollo.hwg.apollo"]);
  const share = app.expo.plugins.find((entry: unknown) => Array.isArray(entry) && entry[0] === "expo-share-intent")[1];
  assert.equal(share.iosAppGroupIdentifier, "group.app.apollo.hwg.apollo");
  assert.equal(share.iosShareExtensionBundleIdentifier, "app.apollo.hwg.shareextension");
  assert.equal(share.iosShareExtensionName, "Apollo Share Extension");
  const pluginNames = app.expo.plugins.map((entry: unknown) => Array.isArray(entry) ? entry[0] : entry);
  assert.ok(pluginNames.indexOf("./plugins/withEasAppExtensionsDedupe") < pluginNames.indexOf("./plugins/withApolloShareIntake"));
  assert.ok(pluginNames.indexOf("./plugins/withApolloShareIntake") < pluginNames.indexOf("expo-share-intent"));
  const dedupe = read("../plugins/withEasAppExtensionsDedupe.js");
  assert.match(dedupe, /com\.apple\.security\.application-groups/);
  assert.match(dedupe, /new Set\(groups\)/);
});

test("iOS privacy and deployment configuration are explicit", () => {
  const build = app.expo.plugins.find((entry: unknown) => Array.isArray(entry) && entry[0] === "expo-build-properties")[1];
  assert.equal(build.ios.deploymentTarget, "16.4");
  assert.equal(app.expo.ios.supportsTablet, true);
  assert.equal(app.expo.ios.privacyManifests.NSPrivacyTracking, false);
  assert.ok(app.expo.ios.privacyManifests.NSPrivacyAccessedAPITypes.some((row: { NSPrivacyAccessedAPIType: string }) => row.NSPrivacyAccessedAPIType === "NSPrivacyAccessedAPICategoryUserDefaults"));
});

test("Apollo Share Extension uses bounded protected atomic multi-item handoff", () => {
  const swift = read("../plugins/ios/ApolloShareExtension/ShareViewController.swift");
  for (const token of ["maximumItems = 20", "maximumItemBytes", "maximumTotalBytes", "timeoutSeconds", "manifest.pending.json", "manifest.complete.json", "FileProtectionType.completeUntilFirstUserAuthentication", "cleanupExpiredHandoffs", "UUID().uuidString.lowercased()", "expectedCount"]) assert.match(swift, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(swift, /ApolloShareHandoffs/);
  assert.doesNotMatch(swift, /UserDefaults\(suiteName:.*\)\?\.set\(.*shared/i);
  const plugin = read("../plugins/withApolloShareIntake.js");
  assert.match(plugin, /Missing generated target directory/);
  assert.match(plugin, /IPHONEOS_DEPLOYMENT_TARGET = "16\.4"/);
});

test("host import is opaque-id based, idempotent and expiry aware", () => {
  const module = read("../modules/apollo-security/ios/ApolloSecurityModule.swift");
  for (const token of ["getShareHandoff", "acknowledgeShareHandoff", "discardShareHandoff", "manifest.complete.json", "cleanupShareHandoffs", "UUID(uuidString: id)"]) assert.match(module, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const route = read("../app/share.tsx");
  assert.match(route, /nativeHandoffId/);
  assert.match(route, /loadNativeShareHandoff/);
  assert.match(route, /share-load-error-message/);
});

test("Safari source separates prepared rules, reload and unobservable match evidence", () => {
  const module = read("../modules/apollo-security/ios/ApolloSecurityModule.swift");
  assert.match(module, /rulesState/);
  assert.match(module, /reload_requested/);
  assert.match(module, /enabled_match_unobservable/);
  assert.match(module, /"verified": false/);
  assert.doesNotMatch(module, /this domain is now blocked in Safari/);
  assert.match(module, /ruleVersion/);
});

test("Call Directory requires E.164, sorts, deduplicates and separates reload state", () => {
  const handler = read("../plugins/ios/ApolloCallDirectory/CallDirectoryHandler.swift");
  assert.match(handler, /\^\\\+\[1-9\]\[0-9\]\{7,14\}\$/);
  assert.match(handler, /Array\(Set\(blocked\.compactMap/);
  const module = read("../modules/apollo-security/ios/ApolloSecurityModule.swift");
  assert.match(module, /canonicalPhoneNumber/);
  assert.match(module, /reloadState/);
  assert.match(module, /Call Directory reload timed out/);
});

test("Message Filter derives its App Group and deduplicates redacted events", () => {
  const source = read("../plugins/ios/ApolloMessageFilter/MessageFilterExtension.swift");
  assert.match(source, /Bundle\.main\.bundleIdentifier/);
  assert.match(source, /events\.removeAll/);
  assert.match(source, /"id": digest/);
  assert.doesNotMatch(source, /URLSession/);
});

test("native lifecycle calls are serialized, bounded and reject stale callbacks", () => {
  const module = read("../modules/apollo-security/ios/ApolloSecurityModule.swift");
  assert.match(module, /activeTransition/);
  assert.match(module, /transition_in_progress/);
  assert.match(module, /transition_timeout/);
  assert.match(module, /onProtectionStateChanged/);
  assert.match(module, /observation_timeout/);
});

test("Support build details read installed native metadata", () => {
  const buildInfo = read("../src/config/buildInfo.ts");
  assert.match(buildInfo, /Application\.nativeApplicationVersion/);
  assert.match(buildInfo, /Application\.nativeBuildVersion/);
  const support = read("../app/support.tsx");
  assert.match(support, /testID="support-version"/);
  assert.match(support, /testID="support-build"/);
});

test("root navigation parity remains Home Higgins Gates Check It Patrol", () => {
  const source = read("../app/(tabs)/_layout.tsx");
  const expected = ["Home", "Higgins", "Gates", "Check It", "Patrol"];
  let nativeCursor = 0; let standardCursor = source.indexOf("<Tabs");
  for (const label of expected) { nativeCursor = source.indexOf(`>${label}</NativeTabs.Trigger.Label>`, nativeCursor); assert.ok(nativeCursor >= 0); standardCursor = source.indexOf(`title: "${label}"`, standardCursor); assert.ok(standardCursor >= 0); }
});