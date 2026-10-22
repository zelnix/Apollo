// Device Capabilities + native classification evidence. Run: yarn test:device-capabilities
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildDeviceCapabilities,
  CAPABILITY_CLASS_LABEL,
  NATIVE_STATE_LABEL,
  type DeviceCapabilityInput,
  type NativeCapabilityReads,
  type NativeProtectionRead,
  type ProviderRead,
} from "../src/domain/deviceCapabilities.ts";
import {
  nativeClassificationAttribution,
  nativeClassificationHigginsLine,
  nativeClassificationProvenance,
  nativeClassificationWhyLine,
  triggersInvestigation,
  type NativeClassificationFact,
} from "../src/domain/nativeClassification.ts";

const ALL: NativeCapabilityReads = {
  installEvents: "unsupported", appPermissions: "supported", accessibilityServices: "supported",
  overlayApps: "unsupported", notificationAccess: "permission_required", vpnState: "supported",
  profileState: "supported", appNetworkCorrelation: "supported",
};

const provider = (over: Partial<ProviderRead> = {}): ProviderRead => ({
  provider: "Samsung Smart Call", packageName: "com.samsung.android.smartcallprovider",
  installed: true, isDefaultHandler: true, feature: "Caller ID & spam filtering",
  classificationAccessible: false,
  note: "Samsung Smart Call verdict is not accessible through a supported Samsung API.",
  ...over,
});

const nativeRead = (over: Partial<NativeProtectionRead> = {}): NativeProtectionRead => ({
  callProtection: [provider()], messageProtection: [],
  defaultDialerPackage: "com.samsung.android.dialer", defaultSmsPackage: "com.samsung.android.messaging",
  ...over,
});

const input = (over: Partial<DeviceCapabilityInput> = {}): DeviceCapabilityInput => ({
  platform: "android", caps: ALL, native: nativeRead(), ...over,
});

// ── The five declared classes ──────────────────────────────────────

test("the capability classes are exactly the five declared states plus an honest unknown", () => {
  assert.deepEqual(Object.keys(CAPABILITY_CLASS_LABEL), [
    "apollo_can_use", "permission_required", "not_exposed", "unavailable", "unknown",
  ]);
  assert.equal(CAPABILITY_CLASS_LABEL.unknown, "Apollo couldn’t tell");
  assert.equal(NATIVE_STATE_LABEL.active, "Active on your device");
});

test("a supported read becomes Apollo-can-use; permission_required stays its own class", () => {
  const v = buildDeviceCapabilities(input());
  assert.ok(v.apolloCanUse.some((r) => r.id === "app_permissions"));
  assert.ok(v.needsPermission.some((r) => r.id === "notification_access"));
  assert.ok(!v.apolloCanUse.some((r) => r.id === "notification_access"));
});

test("an unsupported read on Android is reported as not exposed, never as unavailable", () => {
  const v = buildDeviceCapabilities(input());
  const overlay = v.notAccessible.find((r) => r.id === "overlay_apps");
  assert.ok(overlay, "overlay_apps must be reported as not exposed");
  assert.equal(overlay!.attributedTo, "Android");
  assert.match(overlay!.detail, /does not let Apollo list/i);
});

// ── A failed read is never an all-clear ────────────────────────────

test("a failed capability read stays unknown and is never upgraded", () => {
  const v = buildDeviceCapabilities(input({ caps: null }));
  assert.ok(v.unknown.length >= 6);
  assert.ok(!v.apolloCanUse.some((r) => r.id === "app_permissions"));
  for (const row of v.unknown) assert.match(row.detail, /not an all-clear|could not read|genuinely unknown/i);
  assert.match(v.summary, /could not be read/i);
});

test("a failed native protection read leaves the verdict unknown and shows no device protections", () => {
  const v = buildDeviceCapabilities(input({ native: null }));
  assert.deepEqual(v.deviceProtects, []);
  assert.ok(v.unknown.some((r) => r.id === "native_call_verdict"));
  assert.ok(!v.apolloCanUse.some((r) => r.id === "native_call_verdict"));
});

// ── Attribution is preserved ───────────────────────────────────────

test("an active native protection is attributed to its provider, not to Apollo", () => {
  const v = buildDeviceCapabilities(input());
  const row = v.deviceProtects.find((r) => r.provider === "Samsung Smart Call");
  assert.ok(row);
  assert.equal(row!.state, "active");
  assert.match(row!.detail, /Samsung Smart Call’s protection/);
  assert.match(row!.detail, /not Apollo’s/);
});

test("a provider that does not share its verdict is not exposed — Apollo never infers it", () => {
  const v = buildDeviceCapabilities(input());
  const verdict = v.notAccessible.find((r) => r.id === "native_call_verdict");
  assert.ok(verdict);
  assert.equal(verdict!.attributedTo, "Samsung Smart Call");
  assert.match(verdict!.detail, /will not guess it from blocked calls or unknown numbers/i);
});

test("a provider that DOES share its verdict becomes usable evidence, still attributed to them", () => {
  const sharing = provider({ provider: "Google Phone", packageName: "com.google.android.dialer", classificationAccessible: true, note: "" });
  const v = buildDeviceCapabilities(input({ native: nativeRead({ callProtection: [sharing] }) }));
  const verdict = v.apolloCanUse.find((r) => r.id === "native_call_verdict");
  assert.ok(verdict);
  assert.equal(verdict!.attributedTo, "Google Phone");
  assert.match(verdict!.detail, /opens its own investigation/i);
});

test("no recognised protection present means there is no verdict to use", () => {
  const v = buildDeviceCapabilities(input({ native: nativeRead({ callProtection: [provider({ installed: false, isDefaultHandler: false })] }) }));
  assert.ok(v.unavailable.some((r) => r.id === "native_call_verdict"));
});

// ── iOS boundaries ─────────────────────────────────────────────────

test("iOS keeps call history, messages and the app list private, with Apple named as the reason", () => {
  const v = buildDeviceCapabilities(input({ platform: "ios", caps: { ...ALL, appPermissions: "unsupported", accessibilityServices: "unsupported" } }));
  for (const id of ["call_history", "message_inbox", "installed_apps"]) {
    const row = v.notAccessible.find((r) => r.id === id);
    assert.ok(row, `${id} must be reported as not exposed on iOS`);
    assert.equal(row!.attributedTo, "iOS");
    assert.match(row!.detail, /Apple does not/);
  }
});

test("web claims nothing as usable", () => {
  const v = buildDeviceCapabilities({ platform: "web", caps: null, native: null });
  assert.equal(v.apolloCanUse.length, 0);
});

// ── Recommendations: never claim a setting is on ───────────────────

test("every recommendation admits Apollo cannot verify it and says exactly what to check", () => {
  const v = buildDeviceCapabilities(input());
  const playProtect = v.recommendations.find((r) => r.id === "play_protect");
  assert.ok(playProtect);
  assert.equal(playProtect!.badge, "Recommended protection");
  assert.equal(playProtect!.unverified, "Apollo can’t verify whether this is currently enabled.");
  assert.equal(playProtect!.recommendation, "Higgins recommends checking that Play Protect is turned on.");
  assert.equal(playProtect!.actionLabel, "Check Play Protect");
  for (const rec of v.recommendations) {
    assert.ok(rec.steps.length > 0, `${rec.id} must tell the person exactly which setting to enable`);
    assert.ok(rec.why.length > 0, `${rec.id} must say why it matters`);
    assert.doesNotMatch(rec.badge, /\benabled\b|\bactive\b|\bon\b/i);
  }
});

test("Samsung handlers get Samsung steps, Google handlers get Google steps", () => {
  const samsung = buildDeviceCapabilities(input());
  assert.match(samsung.recommendations.find((r) => r.id === "caller_id_spam")!.steps.join(" "), /Smart Call/);
  const google = buildDeviceCapabilities(input({ native: nativeRead({ defaultDialerPackage: "com.google.android.dialer", defaultSmsPackage: "com.google.android.apps.messaging" }) }));
  assert.match(google.recommendations.find((r) => r.id === "caller_id_spam")!.steps.join(" "), /See caller and spam ID/);
});

test("a protection that is installed but not active is offered as something to turn on", () => {
  const v = buildDeviceCapabilities(input({ native: nativeRead({ callProtection: [provider({ isDefaultHandler: false })] }) }));
  const row = v.deviceProtects.find((r) => r.provider === "Samsung Smart Call");
  assert.equal(row!.state, "installed_not_default");
  const rec = v.recommendations.find((r) => r.id.startsWith("default_call_"));
  assert.ok(rec);
  assert.match(rec!.recommendation, /Samsung Smart Call/);
});

test("Lockdown Mode is offered as optional, never recommended to everyone", () => {
  const v = buildDeviceCapabilities(input({ platform: "ios" }));
  const lockdown = v.recommendations.find((r) => r.id === "lockdown_mode");
  assert.equal(lockdown!.badge, "Optional protection");
  assert.match(lockdown!.recommendation, /only recommends this if/i);
});

// ── Native classification → evidence + trigger ─────────────────────

const fact: NativeClassificationFact = {
  provider: "Samsung Smart Call", classification: "Suspected spam", confidence: "high",
  communicationType: "call", subject: "+447700900123", classifiedAt: "2026-06-01T10:00:00.000Z",
};

test("a native classification is recorded as the provider's finding, never as Apollo's", () => {
  const line = nativeClassificationWhyLine(fact);
  assert.match(line, /^Samsung Smart Call classified this call/);
  assert.match(line, /not an Apollo detection/);
});

test("Higgins names the device as the first source and Apollo as the investigator", () => {
  const line = nativeClassificationHigginsLine(fact);
  assert.match(line, /Samsung Smart Call called it/);
  assert.match(line, /Apollo’s own investigation, not theirs/);
});

test("attribution and provenance keep the provider on the record", () => {
  const attribution = nativeClassificationAttribution(fact);
  assert.equal(attribution.provider, "Samsung Smart Call");
  assert.equal(attribution.provider_classification, "Suspected spam");
  assert.equal(attribution.preview, "Samsung Smart Call: Suspected spam");
  assert.equal(nativeClassificationProvenance(), "native_protection");
});

test("a permitted native classification always triggers Apollo's existing investigation", () => {
  assert.equal(triggersInvestigation(fact), true);
  assert.equal(triggersInvestigation(null), false);
});
