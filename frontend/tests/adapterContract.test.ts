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
// MockSecurityAdapter.ts) import real Expo/React Native runtime code (expo-modules-core,
// expo-network, react-native) which this repo's plain `node --test` runner cannot load (Node's
// type-stripping refuses files under node_modules — see MODULE_TYPELESS_PACKAGE_JSON /
// ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING if you try). Only PlatformCapabilityProfile.ts and
// SecurityPlatformAdapter.ts are pure `import type`-only and safe to import directly here. This
// mirrors how Swift/Kotlin can never be imported into Node either way — reading source is the
// only cross-language contract check available without a native build either way.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { PLATFORM_ADAPTER_IMPLEMENTED, PLATFORM_CAPABILITY_BASELINES } from "../src/security/PlatformCapabilityProfile.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const ANDROID_KT = "modules/apollo-security/android/src/main/java/com/hucentai/apollosecurity/ApolloSecurityModule.kt";
const IOS_SWIFT = "modules/apollo-security/ios/ApolloSecurityModule.swift";
const NATIVE_ADAPTERS_TS = "src/security/NativeSecurityAdapters.ts";
const MOCK_ADAPTER_TS = "src/security/MockSecurityAdapter.ts";

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

test("mock adapter (used in Expo Go / web preview) also implements the full contract", () => {
  const src = read(MOCK_ADAPTER_TS);
  for (const method of REQUIRED_METHODS) assert.match(src, new RegExp(`\\b${method}\\s*\\(`), `MockSecurityAdapter must implement ${method}()`);
});

test("Windows and macOS have no adapter export — not implemented, not implicitly supported", () => {
  assert.equal(PLATFORM_ADAPTER_IMPLEMENTED.android, true);
  assert.equal(PLATFORM_ADAPTER_IMPLEMENTED.ios, true);
  assert.equal(PLATFORM_ADAPTER_IMPLEMENTED.windows, false);
  assert.equal(PLATFORM_ADAPTER_IMPLEMENTED.macos, false);
  // No WindowsSecurityAdapter / MacosSecurityAdapter export exists anywhere in src/security.
  for (const path of [NATIVE_ADAPTERS_TS, MOCK_ADAPTER_TS, "src/security/securityAdapter.ts"]) {
    const src = read(path);
    assert.doesNotMatch(src, /WindowsSecurityAdapter|MacosSecurityAdapter|MacOSSecurityAdapter/i, `${path} must not implicitly claim a Windows/macOS adapter`);
  }
  // The type baselines still exist as architecture documentation for a future adapter — that's
  // deliberate (see PLATFORM_CAPABILITY_BASELINES doc comment), not a contradiction of the above.
  assert.ok(PLATFORM_CAPABILITY_BASELINES.windows);
  assert.ok(PLATFORM_CAPABILITY_BASELINES.macos);
});

test("capability scope tags, where present, describe deployed reach — never implied enforcement", () => {
  // The mock adapter enforces nothing anywhere: its scope must be empty, not a copy of a real OS baseline.
  assert.deepEqual(PLATFORM_CAPABILITY_BASELINES.mock.scope, []);
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
