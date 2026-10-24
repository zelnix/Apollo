// Device Capabilities + native classification evidence. Run: yarn test:device-capabilities
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  allCapabilityRows,
  buildDeviceCapabilities,
  capabilityAdvice,
  capabilityHealth,
  capabilitySnapshotLines,
  CAPABILITY_CLASS_LABEL,
  PROTECTION_AREA_ORDER,
  protectionsByArea,
  PROTECTION_STATE_LABEL,
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
  assert.equal(PROTECTION_STATE_LABEL.active, "Active on your device");
  assert.equal(PROTECTION_STATE_LABEL.as_recommended, "Set as recommended");
  assert.equal(PROTECTION_STATE_LABEL.not_verifiable, "Apollo can’t verify this");
});

test("a browser preview reports every capability as unreadable, never as absent", () => {
  const v = buildDeviceCapabilities({ platform: "web", caps: null, native: null, hostIsDevice: false });
  assert.equal(v.notReadableHere.length, 13);
  assert.equal(v.unavailable.length, 0);
  assert.equal(v.apolloCanUse.length, 0);
  assert.match(v.summary, /not running on your phone here/);
  for (const row of v.notReadableHere) assert.match(row.detail, /Open Apollo on your phone/);
});

test("every capability sits in one of the declared categories, with the device's own protections", () => {
  const v = buildDeviceCapabilities(input());
  for (const row of allCapabilityRows(v)) {
    assert.ok(PROTECTION_AREA_ORDER.includes(row.area), `${row.id} must belong to a declared category`);
  }
  // The capability and the device protection that cover the same ground share a category, so the
  // screen can show them in one list per category.
  assert.equal(allCapabilityRows(v).find((r) => r.id === "call_history")!.area, "calls_messages");
  assert.equal(allCapabilityRows(v).find((r) => r.id === "app_permissions")!.area, "apps");
  assert.equal(allCapabilityRows(v).find((r) => r.id === "vpn_state")!.area, "web");
  assert.equal(v.deviceProtects.find((r) => r.id === "caller_id_spam")!.area, "calls_messages");
  // Grouping never loses or duplicates a row.
  const grouped = protectionsByArea(allCapabilityRows(v)).flatMap((g) => g.rows.map((r) => r.id));
  assert.deepEqual([...grouped].sort(), allCapabilityRows(v).map((r) => r.id).sort());
});

test("every capability can answer the three questions the details screen asks", () => {
  for (const row of allCapabilityRows(buildDeviceCapabilities(input()))) {
    assert.ok(row.what.length > 20, `${row.id} must say what it is`);
    assert.ok(row.benefit.length > 20, `${row.id} must say how it helps`);
    assert.doesNotMatch(row.title, /verdict/i);
    assert.doesNotMatch(row.detail, /verdict/i);
  }
});

test("advice is state-driven: nothing to do when Apollo already has it, a check when the device owns it", () => {  const v = buildDeviceCapabilities(input());
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

test("a failed native protection read leaves the classification unknown and shows no provider protections", () => {
  const v = buildDeviceCapabilities(input({ native: null }));
  assert.deepEqual(v.deviceProtects.filter((r) => r.kind !== "device"), []);
  assert.ok(v.unknown.some((r) => r.id === "native_call_verdict"));
  assert.ok(!v.apolloCanUse.some((r) => r.id === "native_call_verdict"));
});

// ── Attribution is preserved ───────────────────────────────────────

test("an active native protection is attributed to its provider, not to Apollo", () => {
  const v = buildDeviceCapabilities(input());
  const row = v.deviceProtects.find((r) => r.title === "Samsung Smart Call");
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

// ── Capability health score (Home's Device card) ──────────────────

test("capability health scores only what the person can change, never platform facts", () => {
  // A build that declares the restricted call-log / SMS pickers (approved switch on).
  const v = buildDeviceCapabilities(input({ restrictedPickers: { callLog: true, sms: true } }));
  const h = capabilityHealth(v, true);
  // 6 available, 3 awaiting permission → 9 obtainable. The 4 the OS/provider keeps are NOT counted.
  assert.equal(h.available, 6);
  assert.equal(h.obtainable, 9);
  assert.equal(h.score, 67);
  assert.equal(h.band, "amber");
  assert.equal(h.label, "6 of 9 ready");
  assert.match(h.detail, /3 need your permission/);
});

test("the default (Play) build never scores the call-log / inbox pickers it doesn't declare", () => {
  const h = capabilityHealth(buildDeviceCapabilities(input()), true);
  // Same phone, but READ_CALL_LOG / READ_SMS are absent: they are not obtainable, so not counted.
  assert.equal(h.available, 6);
  assert.equal(h.obtainable, 7);
  assert.equal(h.label, "6 of 7 ready");
  assert.match(h.detail, /1 needs? your permission/);
});

test("green only when Apollo has everything this phone can give it", () => {
  const granted = buildDeviceCapabilities(input({ caps: { ...ALL, notificationAccess: "supported" }, platform: "android" }));
  const h = capabilityHealth({ ...granted, needsPermission: [], unknown: [] }, true);
  assert.equal(h.band, "green");
  assert.equal(h.score, 100);
  assert.match(h.detail, /everything this phone can give it/);
});

test("a failed read drags the score down and is named, never ignored", () => {
  const h = capabilityHealth(buildDeviceCapabilities(input({ caps: null })), true);
  assert.equal(h.band, "red");
  assert.ok(h.score !== null && h.score < 60);
  assert.match(h.detail, /couldn’t be checked/);
});

test("no score at all when Apollo is not on the phone", () => {
  const h = capabilityHealth(buildDeviceCapabilities({ platform: "web", caps: null, native: null, hostIsDevice: false }), false);
  assert.equal(h.band, "unknown");
  assert.equal(h.score, null);
  assert.match(h.detail, /Open Apollo on your phone/);
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

test("an unreadable protection says so plainly and still carries full guidance", () => {
  const v = buildDeviceCapabilities(input());
  const scanner = v.deviceProtects.find((r) => r.id === "app_scanner");
  assert.ok(scanner);
  assert.equal(scanner!.state, "not_verifiable");
  assert.match(scanner!.detail, /cannot read whether app scanning is currently switched on/i);
  assert.ok(scanner!.guidance);
  assert.equal(scanner!.guidance!.selfCheck, true);
  assert.ok(scanner!.guidance!.steps.length > 0);
  for (const row of v.deviceProtects) {
    assert.ok(row.what.length > 20, `${row.id} must say what it does`);
    assert.ok(row.benefit.length > 20, `${row.id} must say how it helps`);
    // Nothing unreadable may be described as on or off.
    if (row.state === "not_verifiable") assert.match(row.detail, /cannot read|does not let Apollo read|could not read|could not inspect|cannot tell/i);
  }
});

test("everything worth checking is an index into the same rows, never a second list", () => {
  const v = buildDeviceCapabilities(input());
  assert.ok(v.recommendations.length >= 5);
  for (const rec of v.recommendations) {
    assert.ok(v.deviceProtects.some((r) => r.id === rec.id), `${rec.id} must be one of the protection rows`);
    assert.ok(rec.guidance, `${rec.id} must carry guidance`);
    assert.notEqual(rec.state, "active");
  }
});

test("Samsung handlers get Samsung wording, Google handlers get Google wording", () => {
  const samsung = buildDeviceCapabilities(input());
  assert.match(samsung.deviceProtects.find((r) => r.id === "caller_id_spam")!.guidance!.steps.join(" "), /Samsung Phone app/);
  const google = buildDeviceCapabilities(input({ native: nativeRead({ defaultDialerPackage: "com.google.android.dialer", defaultSmsPackage: "com.google.android.apps.messaging" }) }));
  assert.match(google.deviceProtects.find((r) => r.id === "caller_id_spam")!.guidance!.steps.join(" "), /Google Phone app/);
  assert.match(google.deviceProtects.find((r) => r.id === "message_spam")!.guidance!.steps.join(" "), /Google Messages/);
});

test("a protection that is installed but not active is offered as something to turn on", () => {
  const v = buildDeviceCapabilities(input({ native: nativeRead({ callProtection: [provider({ isDefaultHandler: false })] }) }));
  const row = v.deviceProtects.find((r) => r.title === "Samsung Smart Call");
  assert.equal(row!.state, "installed_not_default");
  assert.match(row!.guidance!.recommended, /Samsung Smart Call/);
  assert.ok(v.recommendations.some((r) => r.id === row!.id));
});

test("Lockdown Mode is offered as a choice, never recommended to everyone", () => {
  const v = buildDeviceCapabilities(input({ platform: "ios" }));
  const lockdown = v.deviceProtects.find((r) => r.id === "lockdown_mode");
  assert.ok(lockdown);
  assert.match(lockdown!.guidance!.recommended, /leaving this off unless you believe you are being personally targeted/i);
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

test("Higgins is told who owns each protection on the device", () => {
  const lines = capabilitySnapshotLines({ view: buildDeviceCapabilities(input()), hasNativeHost: true, capsReadFailed: false, nativeReadFailed: false });
  assert.equal(lines.protections[0], "Samsung Smart Call — Caller ID & spam filtering — Active on your device (per Samsung Smart Call) — does not share its classification with Apollo");
  // Every OS/OEM protection reaches Higgins too, each with its owner and its exact state.
  assert.ok(lines.protections.length >= 13);
  assert.ok(lines.protections.some((l) => l.startsWith("Screen lock —") && l.includes("(per your device)")));
  assert.ok(lines.protections.some((l) => l.startsWith("App scanning —") && l.includes("(per Google Play Protect)")));
  for (const line of lines.protections) assert.match(line, /\(per .+\)/);
});

test("Higgins is told which settings Apollo cannot read, with the recommended configuration", () => {
  const lines = capabilitySnapshotLines({ view: buildDeviceCapabilities(input()), hasNativeHost: true, capsReadFailed: false, nativeReadFailed: false });
  const scanner = lines.recommended.find((l) => l.startsWith("App scanning"));
  assert.ok(scanner, "Higgins must be told app scanning is unverifiable");
  assert.match(scanner!, /Apollo can’t verify this/);
  assert.match(scanner!, /Higgins recommends leaving app scanning switched on/);
});

test("Higgins is told plainly when a read failed, and when Apollo is not on the device", () => {
  const failed = capabilitySnapshotLines({ view: buildDeviceCapabilities(input({ caps: null })), hasNativeHost: true, capsReadFailed: true, nativeReadFailed: false });
  assert.match(failed.summary, /Some reads failed, so those are unknown rather than clear/);
  const offDevice = capabilitySnapshotLines({ view: buildDeviceCapabilities({ platform: "web", caps: null, native: null }), hasNativeHost: false, capsReadFailed: false, nativeReadFailed: false });
  assert.match(offDevice.summary, /not running on the device itself/);
});
