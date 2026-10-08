import assert from "node:assert/strict";
import { test } from "node:test";

import { EMPTY_SIGNALS, type DeviceSignals, type SelfReport } from "../src/domain/deviceAnalysis.ts";
import { groupByCategory, OUTCOME_LABEL, runDeviceReview, type ReviewPlatform } from "../src/domain/deviceReview.ts";

const sig = (p: ReviewPlatform, over: Partial<DeviceSignals> = {}): DeviceSignals => ({ ...EMPTY_SIGNALS(p), ...over });
const okProtection = { requested: true, operational: true, degradedReason: null, permissionIssues: [], checkedAt: "2026-10-08T04:00:00Z" };

test("exact outcome labels match the spec wording", () => {
  assert.deepEqual(OUTCOME_LABEL, { checked: "Checked", review: "Review recommended", action: "Action required", manual: "Manual review required", unavailable: "Unavailable", not_applicable: "Not applicable" });
});

test("all four platforms are assessed (desktop is no longer collapsed to web)", () => {
  for (const p of ["android", "ios", "windows", "macos"] as ReviewPlatform[]) {
    const r = runDeviceReview({ platform: p, signals: sig(p), self: {} });
    assert.ok(r.coverage.total > 0, `${p} produced checks`);
    assert.ok(groupByCategory(r).length >= 5, `${p} covers multiple categories`);
  }
});

test("SAFE observation → Checked, and never a false Protected while checks remain manual", () => {
  const r = runDeviceReview({ platform: "android", signals: sig("android", { unknownSourcesEnabled: false, developerOptions: false, vpnActive: false, remoteAccessApps: [], thirdPartyAccessibilityServices: [], notificationAccessApps: [], managementProfile: "none", userTrustedCertificates: 0 }), self: {}, protection: okProtection });
  const unknownSources = r.results.find((x) => x.id === "unknown_sources")!;
  assert.equal(unknownSources.outcome, "checked");
  // Even with everything observed safe, OS-update/lock/backup etc. are still manual → honest overall, not "clear".
  assert.equal(r.overall, "manual");
  assert.ok(r.coverage.needsManual > 0);
});

test("UNSAFE observation → Action required with a risk and remediation", () => {
  const r = runDeviceReview({ platform: "android", signals: sig("android", { vpnActive: true, vpnProviderKnown: false }), self: {}, protection: okProtection });
  const vpn = r.results.find((x) => x.id === "vpn")!;
  assert.equal(vpn.outcome, "action");
  assert.ok(vpn.risk && vpn.remediation);
  assert.equal(r.overall, "action");
});

test("UNKNOWN (signal not readable) → Unavailable, never assumed safe", () => {
  const r = runDeviceReview({ platform: "android", signals: sig("android", { developerOptions: null }), self: {} });
  const dev = r.results.find((x) => x.id === "developer_mode")!;
  assert.equal(dev.outcome, "unavailable");
  assert.equal(dev.verifiedBy, "none");
});

test("USER-CONFIRMED report is recorded as user_confirmed, not independently verified", () => {
  const self: SelfReport = { gaveRemoteAccess: true };
  const r = runDeviceReview({ platform: "ios", signals: sig("ios"), self });
  const remote = r.results.find((x) => x.id === "remote_access")!;
  assert.equal(remote.outcome, "action");
  assert.equal(remote.verifiedBy, "user_confirmed");
});

test("FAILED protection reading → malware/protection check is Action required", () => {
  const r = runDeviceReview({ platform: "android", signals: sig("android"), self: {}, protection: { requested: true, operational: false, degradedReason: "service stopped", permissionIssues: ["VPN permission"], checkedAt: null } });
  const prot = r.results.find((x) => x.id === "apollo_protection")!;
  assert.equal(prot.outcome, "action");
  assert.ok(prot.remediation?.includes("VPN permission"));
});

test("checks that don't apply to a platform are Not applicable, not failed", () => {
  const r = runDeviceReview({ platform: "ios", signals: sig("ios"), self: {} });
  const unknownSources = r.results.find((x) => x.id === "unknown_sources")!;
  assert.equal(unknownSources.outcome, "not_applicable");
  // Not-applicable checks are hidden from category groups.
  assert.ok(!groupByCategory(r).some((g) => g.results.some((x) => x.id === "unknown_sources")));
});

test("screen lock: observed secure → Checked; observed insecure → Action; unreadable → Manual", () => {
  const locked = runDeviceReview({ platform: "android", signals: sig("android", { screenLockSecure: true }), self: {} }).results.find((x) => x.id === "lock")!;
  assert.equal(locked.outcome, "checked");
  assert.equal(locked.verifiedBy, "observation");
  const unlocked = runDeviceReview({ platform: "android", signals: sig("android", { screenLockSecure: false }), self: {} }).results.find((x) => x.id === "lock")!;
  assert.equal(unlocked.outcome, "action");
  assert.ok(unlocked.risk && unlocked.remediation);
  const unknown = runDeviceReview({ platform: "android", signals: sig("android"), self: {} }).results.find((x) => x.id === "lock")!;
  assert.equal(unknown.outcome, "manual");
});

test("iOS encryption follows the observed passcode state", () => {
  const withPass = runDeviceReview({ platform: "ios", signals: sig("ios", { screenLockSecure: true }), self: {} }).results.find((x) => x.id === "encryption")!;
  assert.equal(withPass.outcome, "checked");
  const noPass = runDeviceReview({ platform: "ios", signals: sig("ios", { screenLockSecure: false }), self: {} }).results.find((x) => x.id === "encryption")!;
  assert.equal(noPass.outcome, "action");
  const unknown = runDeviceReview({ platform: "ios", signals: sig("ios"), self: {} }).results.find((x) => x.id === "encryption")!;
  assert.equal(unknown.outcome, "manual");
});
