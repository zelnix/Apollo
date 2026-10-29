// Overall Protection Posture: the worst meaningful condition decides, never a count of green items.
// Run: node --test tests/protectionPosture.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import type { DeviceProtectionRow } from "../src/domain/deviceProtectionTypes.ts";
import { EMPTY_SECURITY_READ, securityProtectionRows, type SecurityStateRead } from "../src/domain/deviceSecurityCatalogue.ts";
import { gateName } from "../src/domain/gateRegistry.ts";
import type { GateId, GatePresentation } from "../src/domain/gates";
import { areaCounts, areaRows, countLine, protectionPosture } from "../src/domain/protectionPosture.ts";
import { resolveProtectionState, type AutomaticCapabilityState } from "../src/domain/protectionStateResolver.ts";

const NOW = Date.parse("2026-06-15T12:00:00.000Z");

type Auto = { state: AutomaticCapabilityState; manualOnly?: boolean; coverageLimited?: boolean };
function gate(id: GateId, auto?: Auto, onDemand: "ready" | "unsupported" | null = "ready"): GatePresentation {
  const r = resolveProtectionState({ automaticState: auto?.state, manualOnly: auto?.manualOnly, coverageLimited: auto?.coverageLimited, onDemandState: onDemand ?? undefined });
  return {
    id, title: gateName(id), purpose: "", currentHelp: "", statusLabel: r.statusLabel, tone: r.tone,
    capability: { automatic: auto ? { kind: "event_driven", ...auto } : undefined, onDemand: onDemand ? { state: onDemand, action: { id: "check_link", label: "Check" } } : undefined },
    resolved: { coverageState: r.coverageState, isAutomatic: r.isAutomatic },
  } as GatePresentation;
}

/** Every Apollo protection set up and working on an Android phone. */
const HEALTHY: Record<GateId, () => GatePresentation> = {
  site: () => gate("site", { state: "running" }),
  link: () => gate("link", { state: "running", manualOnly: true }),
  text: () => gate("text", { state: "running" }),
  call: () => gate("call", { state: "running" }),
  network: () => gate("network", { state: "running" }),
  email: () => gate("email", { state: "not_activated" }),
  account: () => gate("account"),
  file: () => gate("file", { state: "running", manualOnly: true }),
  app: () => gate("app", { state: "running", manualOnly: true }),
  device: () => gate("device", { state: "running" }),
};
const gates = (over: Partial<Record<GateId, GatePresentation>> = {}) => (Object.keys(HEALTHY) as GateId[]).map((id) => over[id] ?? HEALTHY[id]());

const HEALTHY_READ: SecurityStateRead = {
  ...EMPTY_SECURITY_READ, screenLockSecure: true, developerOptions: false, usbDebugging: false, unknownSources: false,
  securityPatch: "2026-06-01", osVersion: "15", deviceAdmins: [], userCertificateCount: 0, rootIndicators: [],
  privateDnsActive: false, privateDnsMode: "automatic", accessibilityServices: [], notificationListeners: [], otherVpnActive: false,
  osThreatReport: { source: "Google Play Protect", status: "on", protectionOff: false },
};
const rows = (over: Partial<SecurityStateRead> = {}) =>
  securityProtectionRows("android", { ...HEALTHY_READ, ...over }, NOW, { manufacturer: "samsung", osVersion: "15", model: "SM-S921B" });
const withHealth = (list: DeviceProtectionRow[], id: string, health: DeviceProtectionRow["health"]) => list.map((r) => (r.id === id ? { ...r, health } : r));

const posture = (g = gates(), device: DeviceProtectionRow[] | "reading" | "not_here" = rows(), checking = false) =>
  protectionPosture({ gates: g, checking, device });

// ── The five outcomes ─────────────────────────────────────────────

test("everything essential and important covered, device settings as Apollo needs them → Well protected", () => {
  const p = posture();
  assert.equal(p.status, "well");
  assert.equal(p.title, "Well protected");
  assert.equal(p.reason, "ApolloSG's important protections are working, and the device protections Apollo relies on are correctly configured.");
  assert.deepEqual(p.findings, []);
});

test("no reading yet → Protection unknown, never a guess", () => {
  const p = posture(gates(), rows(), true);
  assert.equal(p.status, "unknown");
  assert.equal(p.reason, "Apollo is still checking your protection.");
});

test("most essential protections unconfirmed → Protection unknown, naming them", () => {
  const p = posture(gates({ site: gate("site", { state: "temporarily_unavailable" }), text: gate("text", { state: "unverified" }) }));
  assert.equal(p.status, "unknown");
  assert.match(p.reason, /^Apollo doesn't have enough reliable evidence yet/);
  assert.match(p.reason, /It couldn't confirm website protection or message screening\.$/);
  // One unconfirmed essential out of three is still enough evidence to decide.
  assert.notEqual(posture(gates({ text: gate("text", { state: "unverified" }) })).status, "unknown");
});

test("an essential protection that has stopped → Protection at risk, however much else is green", () => {
  const p = posture(gates({ site: gate("site", { state: "interrupted" }) }));
  assert.equal(p.status, "at_risk");
  assert.equal(p.title, "Protection at risk");
  assert.equal(p.findings[0].code, "ESSENTIAL_FAILED:site");
  assert.equal(p.reason, "ApolloSG's website protection has stopped, so it isn't protecting you right now. Turn it back on now.");
});

test("a critical device dependency defeated → Protection at risk", () => {
  const p = posture(gates(), withHealth(rows(), "system_integrity", "action"));
  assert.equal(p.status, "at_risk");
  assert.equal(p.findings[0].code, "DEVICE_CRITICAL:system_integrity");
});

test("an essential protection not set up → Protection reduced, saying why in one sentence", () => {
  const p = posture(gates({ text: gate("text", { state: "permission_needed" }) }));
  assert.equal(p.status, "reduced");
  assert.equal(p.findings[0].code, "ESSENTIAL_NOT_SET_UP:text");
  assert.equal(p.reason, "ApolloSG can't currently provide automatic message screening because notification access is off. Turn it on to restore this protection.");
});

test("a material device finding → Protection reduced; several add a count, never a different status", () => {
  // Private DNS set to a provider sends website lookups past Apollo — verified, so its full impact counts.
  const dns = rows({ privateDnsActive: true, privateDnsMode: "hostname", privateDnsHost: "dns.google" });
  const one = posture(gates(), dns);
  assert.equal(one.status, "reduced");
  assert.equal(one.findings[0].code, "DEVICE_MATERIAL:private_dns");
  const two = posture(gates({ call: gate("call", { state: "interrupted" }) }), dns);
  assert.equal(two.status, "reduced");
  assert.match(two.reason, / 1 more item needs attention too\.$/);
});

test("only moderate gaps remain → Mostly protected, with ApolloSG working normally", () => {
  // Apollo can't screen calls here, and the device's own spam protection can't be read.
  const p = posture(gates({ call: gate("call", { state: "unsupported" }) }));
  assert.equal(p.status, "mostly");
  assert.equal(p.title, "Mostly protected");
  assert.equal(p.reason, "ApolloSG is working normally. Most important protections are covered, but call screening still needs to be checked on your device.");
  const finding = p.findings[0];
  assert.equal(finding.code, "IMPORTANT_SUBSTITUTE_UNCONFIRMED:call");
  assert.equal(finding.route, "/capability/caller_id_spam");
});

test("the device's own protection standing in for Apollo's counts as covered", () => {
  const p = posture(gates({ call: gate("call", { state: "unsupported" }) }), withHealth(rows(), "caller_id_spam", "protected"));
  assert.equal(p.status, "well");
  const call = p.capabilities.find((c) => c.id === "call")!;
  assert.equal(call.coverage, "device");
  assert.equal(call.substitute?.id, "caller_id_spam");
});

test("minor gaps never lower the status, but are still recorded", () => {
  const p = posture(gates({ network: gate("network", { state: "running", coverageLimited: true }) }), rows({ screenLockSecure: false }));
  assert.equal(p.status, "well");
  assert.ok(p.findings.some((f) => f.code === "DEVICE_MINOR:screen_lock"));
  assert.ok(p.findings.some((f) => f.code === "IMPORTANT_LIMITED:network"));
  assert.ok(p.findings.every((f) => f.effect === "minor"));
});

test("optional automatic email checking left off is not a gap", () => {
  for (const state of ["not_activated", "off_by_choice"] as const) {
    const p = posture(gates({ email: gate("email", { state }) }));
    assert.equal(p.status, "well", state);
    assert.equal(p.capabilities.find((c) => c.id === "email")!.effect, "none");
  }
});

test("device settings that can't be read here keep the status at Mostly protected at best", () => {
  assert.equal(posture(gates(), "not_here").status, "mostly");
  assert.equal(posture(gates(), "reading").status, "mostly");
});

test("the worst condition decides: unknown before at risk before reduced before mostly", () => {
  const unknownAndFailed = posture(gates({ site: gate("site", { state: "interrupted" }), link: gate("link", { state: "temporarily_unavailable" }), text: gate("text", { state: "unverified" }) }));
  assert.equal(unknownAndFailed.status, "unknown");
  const failedAndReduced = posture(gates({ site: gate("site", { state: "interrupted" }), text: gate("text", { state: "permission_needed" }) }));
  assert.equal(failedAndReduced.status, "at_risk");
  const reducedAndModerate = posture(gates({ text: gate("text", { state: "permission_needed" }), call: gate("call", { state: "unsupported" }) }));
  assert.equal(reducedAndModerate.status, "reduced");
  // Findings are worst first.
  const order = { critical: 4, material: 3, moderate: 2, minor: 1, none: 0 } as const;
  const effects = failedAndReduced.findings.map((f) => order[f.effect]);
  assert.deepEqual(effects, [...effects].sort((a, b) => b - a));
});

// ── What the Protection screen and Home show ─────────────────────

test("area rows show the worst effect in each area, or who covers it", () => {
  const p = posture(gates({ site: gate("site", { state: "interrupted" }), text: gate("text", { state: "permission_needed" }), call: gate("call", { state: "unsupported" }) }), withHealth(rows(), "caller_id_spam", "check_manually"));
  const byId = Object.fromEntries(areaRows(p).map((r) => [r.id, r]));
  assert.deepEqual(areaRows(p).map((r) => r.id), ["websites_links", "email_accounts", "messages_calls", "device_internet", "apps_files"]);
  assert.equal(byId.websites_links.status, "at_risk");
  assert.equal(byId.websites_links.note, "1 issue");
  assert.equal(byId.messages_calls.label, "Needs attention");
  assert.equal(byId.device_internet.label, "Protected");
  assert.equal(byId.device_internet.note, "By ApolloSG");
  assert.equal(byId.apps_files.label, "Ready");
  assert.equal(byId.apps_files.note, "When you check");
  assert.deepEqual(areaCounts(areaRows(p)), { protected: 3, attention: 2, toCheck: 0 });
});

test("count lines keep what needs the person when there are three parts", () => {
  assert.equal(countLine({ protected: 4, attention: 1, toCheck: 0 }), "4 protected · 1 needs attention");
  assert.equal(countLine({ protected: 5, attention: 1, toCheck: 15 }), "1 needs attention · 15 to check");
  assert.equal(countLine({ protected: 0, attention: 0, toCheck: 0 }), "None available here");
});
