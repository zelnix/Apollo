import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { isVerifiedDesktopFlowDrop, parseDesktopEnforcementEvidence } from "../src/security/desktopEvidence.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("Package 6 iOS configuration registers all native extension targets under app.apollo.hwg", () => {
  const app = JSON.parse(read("../app.json"));
  assert.equal(app.expo.ios.bundleIdentifier, "app.apollo.hwg");
  const extensions = app.expo.extra.eas.build.experimental.ios.appExtensions;
  assert.deepEqual(extensions.map((item: { targetName: string }) => item.targetName), ["ApolloFamilyAssistBroadcast", "ApolloShareExtension", "ApolloContentBlocker", "ApolloCallDirectory", "ApolloMessageFilter"]);
  for (const item of extensions) assert.ok(item.bundleIdentifier.startsWith("app.apollo.hwg."));
  assert.ok(app.expo.plugins.includes("./plugins/withApolloTextGuard"));
  assert.ok(app.expo.plugins.includes("./plugins/withApolloShareIntake"));
});

test("iOS Message Filter is a real local extension with bounded, redacted event handoff", () => {
  const source = read("../plugins/ios/ApolloMessageFilter/MessageFilterExtension.swift");
  assert.match(source, /ILMessageFilterExtension/);
  assert.match(source, /ILMessageFilterQueryHandling/);
  assert.match(source, /SHA256\.hash/);
  assert.match(source, /prefix\(maxEvents\)/);
  assert.doesNotMatch(source, /URLSession|http:\/\/|https:\/\//);
  const module = read("../modules/apollo-security/ios/ApolloSecurityModule.swift");
  assert.match(module, /messageFilterRecentlyObserved/);
  assert.match(module, /getRecentMessageSecurityEvents/);
  assert.match(module, /acknowledgeMessageSecurityEvents/);
});

test("Windows source uses WFP ALE authorization and a service installer hook", () => {
  const source = read("../../desktop/native/windows-wfp/ApolloWfpService.cpp");
  for (const api of ["FwpmEngineOpen0", "FwpmSubLayerAdd0", "FwpmFilterAdd0", "FwpmNetEventSubscribe0", "FWPM_LAYER_ALE_AUTH_CONNECT_V4", "FWPM_LAYER_ALE_AUTH_CONNECT_V6", "appId"]) assert.match(source, new RegExp(api));
  assert.match(source, /filterDomains/);
  assert.match(source, /evidenceId\.substr/);
  assert.match(source, /pruneEvidence/);
  assert.match(read("../../desktop/src-tauri/tauri.windows.conf.json"), /apollo-wfp-service/);
  const hooks = read("../../desktop/src-tauri/windows/installer-hooks.nsh");
  assert.match(hooks, /ApolloProtectionService/);
  assert.match(hooks, /NSIS_HOOK_PREUNINSTALL/);
});

test("macOS source uses a Network Extension system extension with required entitlements", () => {
  const provider = read("../../desktop/native/macos/ApolloNetworkExtension/FilterDataProvider.swift");
  assert.match(provider, /NEFilterDataProvider/);
  assert.match(provider, /handleNewFlow/);
  assert.match(provider, /return \.drop\(\)/);
  assert.match(provider, /sourceAppIdentifier/);
  const extensionEntitlements = read("../../desktop/native/macos/ApolloNetworkExtension/ApolloNetworkExtension.entitlements");
  assert.match(extensionEntitlements, /content-filter-provider-systemextension/);
  assert.match(extensionEntitlements, /group\.app\.apollo\.hwg\.apollo/);
  assert.match(read("../../desktop/src-tauri/entitlements.macos.plist"), /com\.apple\.developer\.system-extension\.install/);
  assert.match(read("../../desktop/src-tauri/entitlements.macos.plist"), /content-filter-provider-systemextension/);
  const manager = read("../../desktop/native/macos/ApolloExtensionManager/main.swift");
  assert.match(manager, /NEFilterManager\.shared/);
  assert.match(manager, /filterDataProviderBundleIdentifier/);
  assert.match(manager, /saveToPreferences/);
});

test("desktop adapter observes real native status and preserves evidence-only Biting", () => {
  const adapter = read("../src/security/DesktopSecurityAdapter.ts");
  assert.match(adapter, /native_filter_status/);
  assert.match(adapter, /native_enforcement_evidence/);
  assert.match(adapter, /acknowledge_native_evidence/);
  assert.doesNotMatch(adapter, /simulated/);
  const rust = read("../../desktop/src-tauri/src/lib.rs");
  assert.match(rust, /systemextensionsctl/);
  assert.match(rust, /ApolloProtectionService/);
  assert.match(rust, /configuration_missing/);
});

test("platform delivery manifest keeps identities and mechanism names stable", () => {
  const manifest = JSON.parse(read("../../desktop/native/platform-delivery.json"));
  assert.equal(manifest.windows.serviceName, "ApolloProtectionService");
  assert.equal(manifest.windows.mechanism, "wfp_ale_authorization");
  assert.equal(manifest.macos.extensionIdentifier, "app.apollo.hwg.desktop.networkextension");
  assert.equal(manifest.macos.appGroup, "group.app.apollo.hwg.apollo");
});

test("desktop evidence parser admits bounded native flow drops and rejects malformed records", () => {
  const windows = {
    evidenceId: "19b6d578-9097-4adf-bef0-c301f22403bb", eventId: null, deviceId: null, platform: "windows",
    osVersion: "Windows 11", sdkVersion: "1.1.0", observedAt: "2026-09-22T10:00:00Z",
    mechanism: "wfp_ale_authorization", direction: "outbound", protocol: "tcp",
    destination: { ip: "203.0.113.7", domain: "blocked.example", port: 443 },
    attribution: { appId: "C:\\Program Files\\Browser\\browser.exe", processName: "browser.exe", confidence: "high" },
    matchedRuleId: "wfp-filter-12", threatId: null, requestedAction: "block", enforcedAction: "blocked",
    result: "verified", ruleSource: "local_blocklist", confidence: "high", sourceMetadata: {}, correlationId: null,
  };
  const parsed = parseDesktopEnforcementEvidence([windows, { ...windows, evidenceId: "{invalid-braces}" }]);
  assert.equal(parsed.length, 1);
  assert.equal(isVerifiedDesktopFlowDrop(parsed[0]), true);
});

test("desktop flow evidence remains distinct from packet-filter evidence", () => {
  const source = read("../src/security/desktopEvidence.ts");
  assert.match(source, /wfp_ale_authorization/);
  assert.match(source, /network_extension/);
  assert.doesNotMatch(source, /mechanism\s*=\s*["']packet_filter/);
});