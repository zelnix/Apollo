// Device Capabilities + native classification evidence. Run: yarn test:device-capabilities
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  allCapabilityRows,
  buildDeviceCapabilities,
  capabilityAdvice,
  capabilitySnapshotLines,
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

test("the capability classes are exactly the declared states, in plain English", () => {
  assert.deepEqual(Object.keys(CAPABILITY_CLASS_LABEL), [
    "apollo_can_use", "permission_required", "not_exposed", "unavailable", "unknown", "not_readable_here",
  ]);
  assert.deepEqual(Object.values(CAPABILITY_CLASS_LABEL), [
    "Available to Apollo", "Permission needed", "Managed by your device",
    "Not available to Apollo", "Apollo couldn’t check", "Can’t be read in this preview",
  ]);
  // "Not on this device" must never be shown as a capability status — it was read as nonsense.
  assert.ok(!Object.values(CAPABILITY_CLASS_LABEL).includes("Not on this device"));
  // Nothing user-facing calls a provider's classification a "verdict".
  for (const label of Object.values(CAPABILITY_CLASS_LABEL)) assert.doesNotMatch(label, /verdict/i);
  assert.equal(NATIVE_STATE_LABEL.active, "Active on your device");
});

test("a browser preview reports every capability as unreadable, never as absent", () => {
  const v = buildDeviceCapabilities({ platform: "web", caps: null, native: null, hostIsDevice: false });
  assert.equal(v.notReadableHere.length, 13);
  assert.equal(v.unavailable.length, 0);
  assert.equal(v.apolloCanUse.length, 0);
  assert.match(v.summary, /not running on your phone here/);
  for (const row of v.notReadableHere) assert.match(row.detail, /Open Apollo on your phone/);
});

test("every capability can answer the three questions the details screen asks", () => {
  for (const row of allCapabilityRows(buildDeviceCapabilities(input()))) {
    assert.ok(row.what.length > 20, `${row.id} must say what it is`);
    assert.ok(row.benefit.length > 20, `${row.id} must say how it helps`);
    assert.doesNotMatch(row.title, /verdict/i);
    assert.doesNotMatch(row.detail, /verdict/i);
  }
});

test("advice is state-driven: nothing to do when Apollo already has it, a check when the device owns it", () => {
  const v = buildDeviceCapabilities(input());
  const usable = v.apolloCanUse.find((r) => r.id === "app_permissions")!;
  assert.equal(capabilityAdvice(usable), null);
  const perm = v.needsPermission.find((r) => r.id === "notification_access")!;
  assert.match(capabilityAdvice(perm)!, /Allowing notification access/);
  const managedByProvider = v.notAccessible.find((r) => r.id === "native_call_verdict")!;
  assert.match(capabilityAdvice(managedByProvider)!, /Keep Samsung Smart Call switched on/);
  assert.match(managedByProvider.action!.label, /Check Samsung Smart Call settings/);
  const managedByOs = v.notAccessible.find((r) => r.id === "overlay_apps")!;
  assert.match(capabilityAdvice(managedByOs)!, /Nothing to do. Android keeps this private/);
  const failed = buildDeviceCapabilities(input({ caps: null })).unknown[0];
  assert.match(capabilityAdvice(failed)!, /could not read this/);
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

test("a failed native protection read leaves the classification unknown and shows no device protections", () => {
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

test("a provider that does not share its classification is not exposed — Apollo never infers it", () => {
  const v = buildDeviceCapabilities(input());
  const classification = v.notAccessible.find((r) => r.id === "native_call_verdict");
  assert.ok(classification);
  assert.equal(classification!.attributedTo, "Samsung Smart Call");
  assert.match(classification!.detail, /will not guess it from blocked calls or unknown numbers/i);
});

test("a provider that DOES share its classification becomes usable evidence, still attributed to them", () => {
  const sharing = provider({ provider: "Google Phone", packageName: "com.google.android.dialer", classificationAccessible: true, note: "" });
  const v = buildDeviceCapabilities(input({ native: nativeRead({ callProtection: [sharing] }) }));
  const classification = v.apolloCanUse.find((r) => r.id === "native_call_verdict");
  assert.ok(classification);
  assert.equal(classification!.attributedTo, "Google Phone");
  assert.match(classification!.detail, /opens its own investigation/i);
});

test("no recognised protection present means there is no classification to use", () => {
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

// ── What Higgins receives ──────────────────────────────────────────

test("Higgins receives every capability with its exact state", () => {
  const lines = capabilitySnapshotLines({ view: buildDeviceCapabilities(input()), hasNativeHost: true, capsReadFailed: false, nativeReadFailed: false });
  assert.equal(lines.capabilities.length, 13, "Higgins must see all 13 capabilities, not a subset");
  assert.ok(lines.capabilities.includes("App permissions: Available to Apollo"));
  assert.ok(lines.capabilities.includes("Notification access: Permission needed"));
  assert.ok(lines.capabilities.some((l) => l === "Your phone’s own scam-call warning: Managed by your device (per Samsung Smart Call)"));
});

test("Higgins is told who owns each native protection", () => {
  const lines = capabilitySnapshotLines({ view: buildDeviceCapabilities(input()), hasNativeHost: true, capsReadFailed: false, nativeReadFailed: false });
  assert.deepEqual(lines.protections, [
    "Samsung Smart Call — Caller ID & spam filtering — Active on your device — does not share its classification with Apollo",
  ]);
});

test("Higgins is told which settings Apollo cannot read", () => {
  const lines = capabilitySnapshotLines({ view: buildDeviceCapabilities(input()), hasNativeHost: true, capsReadFailed: false, nativeReadFailed: false });
  assert.ok(lines.recommended.some((l) => l.startsWith("Google Play Protect — Recommended protection — Apollo cannot read whether this is on.")));
});

test("Higgins is told plainly when a read failed, and when Apollo is not on the device", () => {
  const failed = capabilitySnapshotLines({ view: buildDeviceCapabilities(input({ caps: null })), hasNativeHost: true, capsReadFailed: true, nativeReadFailed: false });
  assert.match(failed.summary, /Some reads failed, so those are unknown rather than clear/);
  const offDevice = capabilitySnapshotLines({ view: buildDeviceCapabilities({ platform: "web", caps: null, native: null }), hasNativeHost: false, capsReadFailed: false, nativeReadFailed: false });
  assert.match(offDevice.summary, /not running on the device itself/);
});
