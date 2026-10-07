import assert from "node:assert/strict";
import { test } from "node:test";
import { buildGatesOverview } from "../src/domain/gates.ts";

const permission = (status: "granted" | "denied" | "blocked") => ({ id: "network_filter" as const, title: "Network filter", status, canAskAgain: status !== "blocked", why: "Required" });
const protection = (patch = {}) => ({ running: false, requested: true, operational: false, enforcementMethod: "dns_filter" as const, coverage: "Website traffic", coverageScope: [], lastVerified: null, degradedReason: "Permission missing", visibility: "none" as const, since: null, adapterLabel: "Native", checkedAt: new Date().toISOString(), ...patch });
const base = { platform: "android", checking: false, protection: protection(), permissions: [permission("denied")], capabilities: [{ id: "link_guard" as const, title: "Link Gate", status: "available" as const, detail: "Manual" }, { id: "site_guard" as const, title: "Site Gate", status: "permission_required" as const, detail: "Permission" }], messaging: { smsFiltering: "unsupported" as const, linkInterception: "unsupported" as const, senderReputation: "unsupported" as const, shareExtension: "unsupported" as const, notificationIntegration: "unsupported" as const }, calls: { callerIdentification: "unsupported" as const, callScreening: "unsupported" as const, numberReputation: "supported" as const, voicemailTranscript: "unsupported" as const, liveTranscript: "unsupported" as const } };

test("C21 produces one truthful consumer presentation per Gate", () => {
  const result = buildGatesOverview(base);
  assert.equal(result.gates.length, 10);
  assert.deepEqual(new Set(result.gates.map((gate) => gate.id)), new Set(["site", "link", "text", "call", "network", "account", "email", "file", "app", "device"]));
  for (const gate of result.gates) {
    assert.ok(gate.purpose.length > 30);
    assert.ok(gate.currentHelp.length > 20);
    assert.ok(gate.statusLabel);
    assert.equal("automaticStatus" in gate, false);
    assert.equal("onDemandStatus" in gate, false);
    assert.ok(!gate.primaryAction || Object.keys(gate.primaryAction).sort().join(",") === "id,label");
  }
});

test("Site Gate needs attention when native permission is missing", () => {
  const site = buildGatesOverview(base).gates.find((gate) => gate.id === "site")!;
  assert.equal(site.statusLabel, "Needs your attention");
  assert.equal(site.capability.automatic?.state, "permission_needed");
  assert.equal(site.primaryAction?.id, "restore_site");
});

test("declined VPN consent keeps Site Gate in permission_needed via stored intent (native requested=false)", () => {
  // After a decline, native start() never ran, so protection.requested stays false. The user's
  // stored intent (desiredSiteOn) must still surface Site Gate as permission_needed, not "off".
  const overview = buildGatesOverview({ ...base, protection: protection({ requested: false }), desiredSiteOn: true });
  const site = overview.gates.find((gate) => gate.id === "site")!;
  assert.equal(site.capability.automatic?.state, "permission_needed");
  assert.equal(site.statusLabel, "Needs your attention");
  assert.equal(site.primaryAction?.id, "restore_site");
  assert.match(site.primaryAction?.label ?? "", /grant vpn permission/i);
});

test("no stored intent and native requested=false reads as off_by_choice", () => {
  const site = buildGatesOverview({ ...base, protection: protection({ requested: false }), desiredSiteOn: false }).gates.find((gate) => gate.id === "site")!;
  assert.equal(site.capability.automatic?.state, "off_by_choice");
});

test("Site Gate awaiting VPN permission while other Gates work reports reduced coverage", () => {
  // numberReputation is "supported" in base, so Call Gate is running → working > 0.
  const overview = buildGatesOverview({ ...base, protection: protection({ requested: false }), desiredSiteOn: true });
  const working = overview.gates.filter((g) => g.capability.automatic?.state === "running").length;
  assert.ok(working > 0);
  assert.equal(overview.summary, "Protection active — reduced coverage");
});

test("stale enforcement never claims protection on", () => {
  const stale = new Date(Date.now() - 11 * 60 * 1000).toISOString();
  const site = buildGatesOverview({ ...base, permissions: [permission("granted")], protection: protection({ running: true, operational: true, lastVerified: stale, visibility: "full" }), capabilities: [{ id: "site_guard" as const, title: "Site Gate", status: "active" as const, detail: "Stale" }] }).gates.find((gate) => gate.id === "site")!;
  assert.notEqual(site.statusLabel, "Protection on");
  assert.equal(site.capability.automatic?.state, "temporarily_unavailable");
});

test("fresh native evidence is required for Protection on", () => {
  const site = buildGatesOverview({ ...base, permissions: [permission("granted")], protection: protection({ running: true, operational: true, lastVerified: new Date().toISOString(), visibility: "full" }), capabilities: [{ id: "site_guard" as const, title: "Site Gate", status: "active" as const, detail: "Running" }] }).gates.find((gate) => gate.id === "site")!;
  assert.equal(site.statusLabel, "Protection on");
  assert.equal(site.capability.automatic?.state, "running");
});

test("Email Gate requires a fresh successful service heartbeat", () => {
  const stale = buildGatesOverview({ ...base, email: { checking: false, configured: true, connected: true, monitoringRequested: true, lastCheckedAt: null, lastErrorAt: null } }).gates.find((gate) => gate.id === "email")!;
  assert.equal(stale.statusLabel, "Status unavailable");
  const retrievalOnly = buildGatesOverview({ ...base, email: { checking: false, configured: true, connected: true, monitoringRequested: true, lastCheckedAt: new Date().toISOString(), lastErrorAt: null } }).gates.find((gate) => gate.id === "email")!;
  assert.equal(retrievalOnly.statusLabel, "Checking");
  const live = buildGatesOverview({ ...base, email: { checking: false, configured: true, connected: true, monitoringRequested: true, lastCheckedAt: new Date().toISOString(), lastAssessmentAt: new Date().toISOString(), lastErrorAt: null } }).gates.find((gate) => gate.id === "email")!;
  assert.equal(live.statusLabel, "Watching");
});

test("File Gate purpose keeps cloud-hosting limitation", () => {
  const file = buildGatesOverview(base).gates.find((gate) => gate.id === "file")!;
  assert.match(file.purpose, /cloud download is not automatically trusted/i);
  assert.equal(file.capability.onDemand?.state, "ready");
});

test("Account Gate is Watching when accountBreachConfigured is true", () => {
  const account = buildGatesOverview({ ...base, accountBreachConfigured: true }).gates.find((gate) => gate.id === "account")!;
  assert.equal(account.capability.automatic?.state, "running");
  assert.equal(account.statusLabel, "Watching");
  assert.equal(account.capability.automatic?.kind, "event_driven");
  assert.match(account.capability.automatic?.limitation ?? "", /responds when triggered/i);
});

test("Account Gate is temporarily_unavailable when accountBreachConfigured is false", () => {
  const account = buildGatesOverview({ ...base, accountBreachConfigured: false }).gates.find((gate) => gate.id === "account")!;
  assert.equal(account.capability.automatic?.state, "temporarily_unavailable");
  assert.equal(account.statusLabel, "Status unavailable");
});

test("Account Gate is temporarily_unavailable when accountBreachConfigured is omitted (status fetch failure)", () => {
  const account = buildGatesOverview(base).gates.find((gate) => gate.id === "account")!;
  assert.equal(account.capability.automatic?.state, "temporarily_unavailable");
  assert.equal(account.statusLabel, "Status unavailable");
  assert.match(account.capability.automatic?.limitation ?? "", /breach lookup is unavailable/i);
});

test("reduced-coverage summary generalizes to a non-Site gate (Text permission) while Site runs", () => {
  // Site running + Text awaiting notification permission → overall "Protection active — reduced coverage".
  const siteRunning = {
    ...base,
    protection: protection({ operational: true, running: true, lastVerified: new Date().toISOString(), degradedReason: null, visibility: "list" as const }),
    permissions: [{ id: "vpn_config" as const, title: "VPN", status: "granted" as const, canAskAgain: true, why: "Required" }],
    capabilities: [{ id: "link_guard" as const, title: "Link Gate", status: "available" as const, detail: "Manual" }, { id: "site_guard" as const, title: "Site Gate", status: "active" as const, detail: "On" }],
    messaging: { ...base.messaging, smsFiltering: "permission_required" as const },
  };
  const overview = buildGatesOverview(siteRunning);
  const site = overview.gates.find((g) => g.id === "site")!;
  const text = overview.gates.find((g) => g.id === "text")!;
  assert.equal(site.capability.automatic?.state, "running");
  assert.equal(text.capability.automatic?.state, "permission_needed");
  assert.equal(overview.summary, "Protection active — reduced coverage");
});