// "Apollo must never say he is guarding when he isn't."
//
// The old version of this file imported src/domain/protectionTruth.ts (masterCopy), which no longer
// exists — so the guard had been silently dead. It now asserts the SAME invariants against the code
// the app actually renders: buildGatesOverview (src/domain/gates.ts) and the single resolver it uses
// (src/domain/protectionStateResolver.ts). Run: node --test tests/protectionTruth.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { buildGatesOverview } from "../src/domain/gates.ts";
import { resolveProtectionState } from "../src/domain/protectionStateResolver.ts";
import type { ProtectionStatus } from "../src/security/SecurityPlatformAdapter.ts";

const st = (o: Partial<ProtectionStatus>): ProtectionStatus => ({
  running: false, requested: false, operational: false, enforcementMethod: "none", coverage: "",
  coverageScope: [], lastVerified: null, degradedReason: null, visibility: "none", since: null,
  adapterLabel: "x", checkedAt: new Date().toISOString(), ...o,
});

const unsupportedMessaging = { smsFiltering: "unsupported", linkInterception: "unsupported", senderReputation: "unsupported", shareExtension: "unsupported", notificationIntegration: "unsupported" } as const;
const unsupportedCalls = { callerIdentification: "unsupported", callScreening: "unsupported", numberReputation: "unsupported" } as const;

const overview = (protection: ProtectionStatus | null, patch: Record<string, unknown> = {}) =>
  buildGatesOverview({
    platform: "android", checking: false, protection, permissions: [], capabilities: [],
    messaging: unsupportedMessaging, calls: unsupportedCalls, ...patch,
  } as Parameters<typeof buildGatesOverview>[0]);

const site = (protection: ProtectionStatus | null, patch: Record<string, unknown> = {}) =>
  overview(protection, patch).gates.find((gate) => gate.id === "site")!;

test("protection the person switched off never reads as active, whatever the adapter claims", () => {
  const gate = site(st({ operational: true, running: true, enforcementMethod: "dns_filter", lastVerified: new Date().toISOString() }), { desiredSiteOn: false });
  assert.notEqual(gate.statusLabel, "Watching");
  assert.equal(gate.capability.automatic?.state, "off_by_choice");
  assert.equal(gate.resolved.coverageState, "disabled_by_user");
});

test("active requires requested AND operational AND a fresh verification", () => {
  const gate = site(st({ requested: true, operational: true, running: true, enforcementMethod: "dns_filter", lastVerified: new Date().toISOString() }),
    { desiredSiteOn: true, capabilities: [{ id: "site_guard", title: "Website protection", status: "active", detail: "On" }] });
  assert.equal(gate.capability.automatic?.state, "running");
  assert.equal(gate.resolved.coverageState, "active_verified");
});

test("requested but not operational is never active — it asks for action", () => {
  const gate = site(st({ requested: true, operational: false, enforcementMethod: "dns_filter" }), { desiredSiteOn: true });
  assert.notEqual(gate.statusLabel, "Watching");
  assert.notEqual(gate.resolved.coverageState, "active_verified");
  assert.ok(["Action needed", "Setup required", "Unable to verify"].includes(gate.statusLabel));
});

test("an operational claim with no fresh verification can never read as confirmed active", () => {
  const gate = site(st({ requested: true, operational: true, running: true, enforcementMethod: "dns_filter", lastVerified: null }),
    { desiredSiteOn: true, capabilities: [{ id: "site_guard", title: "Website protection", status: "active", detail: "On" }] });
  assert.notEqual(gate.resolved.coverageState, "active_verified");
});

test("no protection status at all is a check in progress, not a clear result", () => {
  const gate = site(null);
  assert.equal(gate.capability.automatic?.state, "checking");
  assert.equal(gate.resolved.coverageState, "unknown");
});

test("the resolver never turns a manual-only capability into automatic watching", () => {
  const resolved = resolveProtectionState({ automaticState: "running", manualOnly: true });
  assert.equal(resolved.statusLabel, "Manual check");
  assert.equal(resolved.isAutomatic, false);
});

test("a failed capability read is unverified — never watching, off or unsupported", () => {
  const resolved = resolveProtectionState({ automaticState: "unverified" });
  assert.equal(resolved.statusLabel, "Unable to verify");
  assert.equal(resolved.tone, "unverified");
  assert.notEqual(resolved.coverageState, "active_verified");
  assert.notEqual(resolved.coverageState, "unsupported");
});

test("a failed messaging capability READ reports unverified, not Off and not unsupported", () => {
  const gate = overview(st({ requested: true }), { messagingReadFailed: true, messaging: null })
    .gates.find((g) => g.id === "text")!;
  assert.equal(gate.capability.automatic?.state, "unverified");
  assert.equal(gate.statusLabel, "Unable to verify");
});

test("a failed call capability READ reports unverified, not unsupported", () => {
  const gate = overview(st({ requested: true }), { callsReadFailed: true, calls: null })
    .gates.find((g) => g.id === "call")!;
  assert.equal(gate.capability.automatic?.state, "unverified");
  assert.equal(gate.statusLabel, "Unable to verify");
});
