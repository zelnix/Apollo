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

test("Site Gate offers optional setup (never an alarm) when native permission is missing", () => {
  const site = buildGatesOverview(base).gates.find((gate) => gate.id === "site")!;
  assert.equal(site.statusLabel, "Setup available");
  assert.equal(site.tone, "neutral");
  assert.equal(site.capability.automatic?.state, "permission_needed");
  assert.equal(site.primaryAction?.id, "restore_site");
});

test("declined VPN consent keeps Site Gate in permission_needed via stored intent (native requested=false)", () => {
  const overview = buildGatesOverview({ ...base, protection: protection({ requested: false }), desiredSiteOn: true });
  const site = overview.gates.find((gate) => gate.id === "site")!;
  assert.equal(site.capability.automatic?.state, "permission_needed");
  assert.equal(site.statusLabel, "Setup available");
  assert.equal(site.primaryAction?.id, "restore_site");
  assert.match(site.primaryAction?.label ?? "", /grant vpn permission/i);
});

test("no stored intent and native requested=false reads as off_by_choice", () => {
  const site = buildGatesOverview({ ...base, protection: protection({ requested: false }), desiredSiteOn: false }).gates.find((gate) => gate.id === "site")!;
  assert.equal(site.capability.automatic?.state, "off_by_choice");
  assert.equal(site.statusLabel, "Off");
});

test("a verified protection failure (enabled + permitted but not operating) reports Action needed and reduced coverage", () => {
  // Site requested + VPN granted but not operational → interrupted → Action needed; Internet Gate running → working>0.
  const overview = buildGatesOverview({
    ...base,
    protection: protection({ requested: true, operational: false }),
    permissions: [{ id: "vpn_config" as const, title: "VPN", status: "granted" as const, canAskAgain: true, why: "Required" }],
    network: netStatus(),
  });
  const site = overview.gates.find((g) => g.id === "site")!;
  assert.equal(site.capability.automatic?.state, "interrupted");
  assert.equal(site.statusLabel, "Action needed");
  assert.equal(site.tone, "action");
  const working = overview.gates.filter((g) => g.capability.automatic?.state === "running" && !g.capability.automatic?.manualOnly).length;
  assert.ok(working > 0);
  assert.equal(overview.summary, "Protection active — reduced coverage");
});

test("stale enforcement never claims Watching", () => {
  const stale = new Date(Date.now() - 11 * 60 * 1000).toISOString();
  const site = buildGatesOverview({ ...base, permissions: [permission("granted")], protection: protection({ running: true, operational: true, lastVerified: stale, visibility: "full" }), capabilities: [{ id: "site_guard" as const, title: "Site Gate", status: "active" as const, detail: "Stale" }] }).gates.find((gate) => gate.id === "site")!;
  assert.equal(site.statusLabel, "Unable to verify");
  assert.equal(site.capability.automatic?.state, "temporarily_unavailable");
});

test("fresh native evidence is required for Watching", () => {
  const site = buildGatesOverview({ ...base, permissions: [permission("granted")], protection: protection({ running: true, operational: true, lastVerified: new Date().toISOString(), visibility: "full" }), capabilities: [{ id: "site_guard" as const, title: "Site Gate", status: "active" as const, detail: "Running" }] }).gates.find((gate) => gate.id === "site")!;
  assert.equal(site.statusLabel, "Watching");
  assert.equal(site.capability.automatic?.state, "running");
});

test("Email Gate requires a fresh successful service heartbeat", () => {
  const stale = buildGatesOverview({ ...base, email: { checking: false, configured: true, connected: true, monitoringRequested: true, lastCheckedAt: null, lastErrorAt: null } }).gates.find((gate) => gate.id === "email")!;
  assert.equal(stale.statusLabel, "Unable to verify");
  const retrievalOnly = buildGatesOverview({ ...base, email: { checking: false, configured: true, connected: true, monitoringRequested: true, lastCheckedAt: new Date().toISOString(), lastErrorAt: null } }).gates.find((gate) => gate.id === "email")!;
  assert.equal(retrievalOnly.statusLabel, "Check in progress");
  const live = buildGatesOverview({ ...base, email: { checking: false, configured: true, connected: true, monitoringRequested: true, lastCheckedAt: new Date().toISOString(), lastAssessmentAt: new Date().toISOString(), lastErrorAt: null } }).gates.find((gate) => gate.id === "email")!;
  assert.equal(live.statusLabel, "Watching");
});

test("File Gate purpose keeps cloud-hosting limitation", () => {
  const file = buildGatesOverview(base).gates.find((gate) => gate.id === "file")!;
  assert.match(file.purpose, /cloud download is not automatically trusted/i);
  assert.equal(file.capability.onDemand?.state, "ready");
});

test("Account Gate is a manual check — reads 'Ready to check', never 'Watching'", () => {
  const account = buildGatesOverview({ ...base, accountBreachConfigured: true }).gates.find((gate) => gate.id === "account")!;
  assert.equal(account.capability.automatic?.state, "running");
  assert.equal(account.capability.automatic?.manualOnly, true);
  assert.equal(account.statusLabel, "Ready to check");
  assert.equal(account.capability.automatic?.kind, "event_driven");
});

test("Link Gate (manual) reads 'Ready to check', never 'Watching'", () => {
  const link = buildGatesOverview({ ...base, online: true }).gates.find((gate) => gate.id === "link")!;
  assert.equal(link.capability.automatic?.kind, "event_driven");
  assert.equal(link.capability.automatic?.manualOnly, true);
  assert.equal(link.statusLabel, "Ready to check");
});


test("Account Gate stays Ready to check when breach lookup is not configured (core alert checks still work)", () => {
  const account = buildGatesOverview({ ...base, accountBreachConfigured: false }).gates.find((gate) => gate.id === "account")!;
  assert.equal(account.capability.automatic, undefined);
  assert.equal(account.statusLabel, "Ready to check");
  assert.equal(account.capability.onDemand?.state, "ready");
});

test("Account Gate stays Ready to check when /account/status fetch fails (configured omitted)", () => {
  const account = buildGatesOverview(base).gates.find((gate) => gate.id === "account")!;
  assert.equal(account.statusLabel, "Ready to check");
  assert.match(account.currentHelp, /breach-list lookup isn.t set up/i);
});

test("optional setup (Text permission) is never an alarm; it does not trigger reduced coverage", () => {
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
  assert.equal(site.statusLabel, "Watching");
  assert.equal(text.capability.automatic?.state, "permission_needed");
  assert.equal(text.statusLabel, "Setup available");
  assert.equal(text.tone, "neutral");
  assert.equal(overview.summary, "1 Gate is helping automatically");
});

const netStatus = (patch = {}) => ({ connected: true, type: "wifi" as const, isInternetReachable: true, inspectable: true, wifiSecurity: "wpa" as const, captivePortal: false, vpnActive: false, ssid: null, checkedAt: new Date().toISOString(), ...patch });

test("Internet Gate is Limited (active but restricted) on an inspectable connection without the VPN", () => {
  const network = buildGatesOverview({ ...base, network: netStatus() }).gates.find((gate) => gate.id === "network")!;
  assert.equal(network.capability.automatic?.state, "running");
  assert.equal(network.statusLabel, "Limited");
  assert.equal(network.title, "Internet Gate");
  assert.match(network.capability.automatic?.limitation ?? "", /continuous background watching/i);
});

test("Internet Gate is Watching with no caveat when the VPN is active", () => {
  const network = buildGatesOverview({ ...base, network: netStatus({ vpnActive: true }) }).gates.find((gate) => gate.id === "network")!;
  assert.equal(network.capability.automatic?.state, "running");
  assert.equal(network.statusLabel, "Watching");
  assert.equal(network.capability.automatic?.limitation, undefined);
});

test("Internet Gate offers setup only when the platform withholds network info", () => {
  const network = buildGatesOverview({ ...base, network: netStatus({ inspectable: false }) }).gates.find((gate) => gate.id === "network")!;
  assert.equal(network.capability.automatic?.state, "permission_needed");
  assert.equal(network.statusLabel, "Setup available");
});
