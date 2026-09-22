// Cross-Platform Architecture Directive — adapter contract tests.
//
// Every RUNTIME native adapter (Android, iOS) must expose every method required by
// SecurityPlatformAdapter — tested independently per platform below (Swift file vs. Kotlin file),
// so a gap in either platform's native registration fails on its own line with its own name. This
// is exactly the kind of test that would have caught the iOS gap this pass fixed: the JS bridge
// (NativeSecurityAdapters.ts) mechanically forwards to whatever the native side registers, so a
// missing Swift AsyncFunction never showed up as a JS-side type error — only a runtime throw on a
// real device. Static source checks below catch it at test time instead.
//
// Windows/macOS are represented in PLATFORM_CAPABILITY_BASELINES (see PlatformCapabilityProfile.ts)
// so the architecture never needs a redesign when those adapters eventually land — but they must
// never be IMPLICITLY supported. This file asserts that fact is explicit and machine-checked, not
// just a comment someone could forget to update.
//
// Why static text checks, not `import` + runtime introspection: NativeSecurityAdapters.ts (and
// The former runtime-mock adapter imported real Expo/React Native runtime code (expo-modules-core,
// expo-network, react-native) which this repo's plain `node --test` runner cannot load (Node's
// type-stripping refuses files under node_modules — see MODULE_TYPELESS_PACKAGE_JSON /
// ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING if you try). Only PlatformCapabilityProfile.ts and
// SecurityPlatformAdapter.ts are pure `import type`-only and safe to import directly here. This
// mirrors how Swift/Kotlin can never be imported into Node either way — reading source is the
// only cross-language contract check available without a native build either way.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { PLATFORM_ADAPTER_IMPLEMENTED, PLATFORM_CAPABILITY_BASELINES } from "../src/security/PlatformCapabilityProfile.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const ANDROID_KT = "modules/apollo-security/android/src/main/java/com/hucentai/apollosecurity/ApolloSecurityModule.kt";
const IOS_SWIFT = "modules/apollo-security/ios/ApolloSecurityModule.swift";
const NATIVE_ADAPTERS_TS = "src/security/NativeSecurityAdapters.ts";
const WEB_ADAPTER_TS = "src/security/WebSecurityAdapter.ts";
const PREVIEW_HARNESS_TS = "tools/preview-device-harness/PreviewDeviceAdapter.ts";

// Derive the required method list DIRECTLY from the interface source, so this test can never
// silently drift out of sync with SecurityPlatformAdapter.ts the way a hand-maintained copy could.
function requiredAdapterMethods(): string[] {
  const src = read("src/security/SecurityPlatformAdapter.ts");
  const start = src.indexOf("export interface SecurityPlatformAdapter");
  const body = src.slice(start, src.indexOf("\n}\n", start));
  const methods: string[] = [];
  for (const line of body.split("\n")) {
    const m = /^\s*(\w+)\(/.exec(line); // skips `readonly kind:` / `readonly label:` (no parens)
    if (m) methods.push(m[1]);
  }
  return methods;
}

const REQUIRED_METHODS = requiredAdapterMethods();

test("the method extractor found the full SecurityPlatformAdapter contract (sanity check on this test itself)", () => {
  assert.ok(REQUIRED_METHODS.length >= 14, `expected >=14 methods, found ${REQUIRED_METHODS.length}: ${REQUIRED_METHODS.join(", ")}`);
  for (const m of ["getCapabilities", "blockDestination", "getPlatformCapabilityProfile", "getEnforcementEvidence"]) {
    assert.ok(REQUIRED_METHODS.includes(m), `extractor missed ${m}`);
  }
});

test("Android native module (ApolloSecurityModule.kt) registers every required method — independent check", () => {
  const src = read(ANDROID_KT);
  for (const method of REQUIRED_METHODS) {
    assert.match(src, new RegExp(`AsyncFunction\\("${method}"`), `Android ApolloSecurityModule.kt must register AsyncFunction("${method}")`);
  }
});

test("iOS native module (ApolloSecurityModule.swift) registers every required method — independent check", () => {
  // Before this pass, getPlatformCapabilityProfile and getEnforcementEvidence had no Swift
  // registration at all — this assertion would have failed. Passing here proves the registration
  // exists; it cannot prove runtime correctness (needs a device build — see the physical-device
  // acceptance checklist).
  const src = read(IOS_SWIFT);
  for (const method of REQUIRED_METHODS) {
    assert.match(src, new RegExp(`AsyncFunction\\("${method}"`), `iOS ApolloSecurityModule.swift must register AsyncFunction("${method}")`);
  }
  // The iOS profile must describe the DEPLOYED Safari Content Blocker, not the theoretical
  // NEFilterDataProvider ceiling — dnsVisibility/packetVisibility/realTimeEvents must not be
  // copy-pasted from PLATFORM_CAPABILITY_BASELINES.ios (which are "partial", the ceiling).
  const profileBlock = src.slice(src.indexOf('AsyncFunction("getPlatformCapabilityProfile")'), src.indexOf('AsyncFunction("getEnforcementEvidence")'));
  for (const field of ["dnsVisibility", "packetVisibility", "realTimeEvents"]) {
    assert.match(profileBlock, new RegExp(`"${field}"\\s*:\\s*"none"`), `iOS getPlatformCapabilityProfile.${field} must be "none" for a Content Blocker, not the NE ceiling`);
  }
  // getEnforcementEvidence must be a hard [] — Safari gives Apollo no per-hit evidence at all.
  assert.match(src, /AsyncFunction\("getEnforcementEvidence"\)\s*\{\s*\(\)\s*->\s*String\s*in\s*"\[\]"/);
});

test("Android and iOS JS bridge (NativeSecurityAdapters.ts) forwards every required method for both adapters", () => {
  const src = read(NATIVE_ADAPTERS_TS);
  for (const method of REQUIRED_METHODS) assert.match(src, new RegExp(`\\b${method}\\s*\\(`));
  assert.match(src, /AndroidSecurityAdapter[^=]*=\s*new NativeAdapterBase\("android"/);
  assert.match(src, /IOSSecurityAdapter[^=]*=\s*new NativeAdapterBase\("ios"/);
});

test("real browser adapter and the development-only preview harness both implement the full contract", () => {
  for (const [name, file] of [["WebSecurityAdapter", WEB_ADAPTER_TS], ["PreviewDeviceAdapter", PREVIEW_HARNESS_TS]] as const) {
    const src = read(file);
    for (const method of REQUIRED_METHODS) assert.match(src, new RegExp(`\\b${method}\\s*\\(`), `${name} must implement ${method}()`);
  }
});

test("no runtime mock exists in application source; the preview harness is reachable only from the web host selector", () => {
  const retiredName = ["Secure", "Core"].join("");
  const retiredMock = ["Mock", "Security", "Adapter"].join("");
  const retiredMode = ["EXPO", "PUBLIC", "SECURITY", "MODE"].join("_");
  const walk = (dir: string): string[] => readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [join(dir, e.name)] : []);
  for (const file of [...walk("src"), ...walk("app")]) {
    const src = read(file);
    assert.equal(src.includes(retiredMode), false, `${file} references a removed runtime mode`);
    assert.equal(src.includes(retiredMock), false, `${file} references a removed runtime mock`);
    assert.equal(src.toLowerCase().includes(retiredName.toLowerCase()), false, `${file} references the retired security boundary`);
    if (file !== "src/security/hostAdapter.web.ts") assert.doesNotMatch(src, /tools\/preview-device-harness/, `${file} must not import the preview harness`);
  }
  // Native bundles resolve hostAdapter.ts, which must not know about the web adapter or the harness at all.
  assert.doesNotMatch(read("src/security/hostAdapter.ts"), /WebSecurityAdapter|preview-device-harness/);
  assert.ok(existsSync(join(root, "src/security/hostAdapter.web.ts")));
});

test("Windows and macOS use the explicit Tauri desktop adapter", () => {
  assert.equal(PLATFORM_ADAPTER_IMPLEMENTED.android, true);
  assert.equal(PLATFORM_ADAPTER_IMPLEMENTED.ios, true);
  assert.equal(PLATFORM_ADAPTER_IMPLEMENTED.windows, true);
  assert.equal(PLATFORM_ADAPTER_IMPLEMENTED.macos, true);
  const desktop = read("src/security/DesktopSecurityAdapter.ts");
  for (const method of REQUIRED_METHODS) assert.match(desktop, new RegExp(`\\b${method}\\s*\\(`), `DesktopSecurityAdapter must implement ${method}()`);
  assert.match(read("src/security/hostAdapter.web.ts"), /DesktopSecurityAdapter/);
  assert.ok(PLATFORM_CAPABILITY_BASELINES.windows);
  assert.ok(PLATFORM_CAPABILITY_BASELINES.macos);
});

test("capability scope tags, where present, describe deployed reach — never implied enforcement", () => {
  // The browser (and the preview harness that reuses its baseline) enforces nothing anywhere: scope must be empty.
  assert.deepEqual(PLATFORM_CAPABILITY_BASELINES.web.scope, []);
  for (const platform of ["android", "ios", "windows", "macos"] as const) {
    const scope = PLATFORM_CAPABILITY_BASELINES[platform].scope;
    assert.ok(Array.isArray(scope) && scope.length > 0, `${platform} baseline should document its scope`);
    for (const tag of scope!) assert.equal(typeof tag, "string");
  }
  // Capability presence is a ceiling, never a fact: the Android module's REAL deployed scope
  // ("dns:udp-53", set in ApolloSecurityModule.kt) is narrower than this documented ceiling
  // ("packet:all"/"dns:all") — the two must never be conflated.
  assert.ok(PLATFORM_CAPABILITY_BASELINES.android.scope!.includes("dns:all"));
  assert.ok(PLATFORM_CAPABILITY_BASELINES.ios.scope!.includes("network_extension:flow-metadata"));
  const androidKt = read(ANDROID_KT);
  assert.match(androidKt, /"scope",\s*JSONArray\(listOf\("dns:udp-53"\)\)/, "Android's REAL deployed scope must self-report dns:udp-53, narrower than the ceiling above");
  const iosSwift = read(IOS_SWIFT);
  assert.match(iosSwift, /"scope":\s*self\.coverageScope/, 'iOS must self-report its real scope (["browser:safari"]), not a ceiling constant');
});
