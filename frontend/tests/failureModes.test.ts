// Hardening Gate step 3 — failure contracts. "Unreachable ≠ unprotected; unknown ≠ safe." Run: yarn test:failure
import assert from "node:assert/strict";
import { test } from "node:test";

import { decide } from "../src/domain/decision.ts";
import { parseIntelResult } from "../src/domain/intelContract.ts";
import { buildGatesOverview } from "../src/domain/gates.ts";
import { analyseUrlLocally } from "../src/domain/risk.ts";
import { classifyHttpFailure, INITIAL_HEALTH, observeFailure, observeOk, serviceBannerCopy, staleNote } from "../src/domain/serviceHealth.ts";
import type { ProtectionStatus } from "../src/security/SecurityPlatformAdapter.ts";

const st = (o: Partial<ProtectionStatus>): ProtectionStatus => ({ running: false, requested: false, operational: false, enforcementMethod: "none", coverage: "", coverageScope: [], lastVerified: null, degradedReason: null, visibility: "none", since: null, adapterLabel: "x", checkedAt: "", ...o });
const good = { verdict: "clean", coverage: "full", threat_types: [], sources: [{ name: "apollo_blocklist", status: "clear", detail: "", threat_types: [] }], indicator_digest: "abc", checked_at: "2026-06-01T00:00:00Z", cached: false };

// --- Service health reducer -------------------------------------------------------------------------------------
test("banner appears on failure and describes exactly what failed", () => {
  const h = observeFailure(INITIAL_HEALTH, "offline", "2026-06-01T10:00:00Z");
  assert.equal(h.reachable, false);
  assert.match(serviceBannerCopy(h)!.title, /can't reach the security service/);
  assert.match(serviceBannerCopy(h)!.line, /Local protection continues/);
  assert.doesNotMatch(serviceBannerCopy(h)!.line, /unprotected|off duty/i);
  assert.match(serviceBannerCopy(observeFailure(INITIAL_HEALTH, "timeout", "t"))!.title, /slow to answer/);
  assert.match(serviceBannerCopy(observeFailure(INITIAL_HEALTH, "server_error", "t"))!.title, /having trouble/);
});
test("degraded state clears only on a fresh successful observation", () => {
  let h = observeOk(INITIAL_HEALTH, "2026-06-01T09:00:00Z");
  h = observeFailure(h, "timeout", "2026-06-01T10:00:00Z");
  assert.equal(serviceBannerCopy(h)!.lastSeen, "2026-06-01T09:00:00Z"); // last-known timestamp shown, not hidden
  h = observeOk(h, "2026-06-01T10:01:00Z");
  assert.equal(serviceBannerCopy(h), null); assert.equal(h.failure, null);
});
test("never-observed is not degraded (no banner before the first call)", () => { assert.equal(serviceBannerCopy(INITIAL_HEALTH), null); });
test("stale note carries the last-known timestamp", () => {
  const at = new Date(2026, 5, 1, 12, 0);
  assert.match(staleNote(new Date(2026, 5, 1, 9, 30).getTime(), at), /last saw at 09:30|last saw at 9:30/);
  assert.match(staleNote(null, at), /nothing to show yet/);
});

// --- 401 vs 403 vs 5xx ------------------------------------------------------------------------------------------
test("401 resets identity; 403 never does; 5xx is degraded; other 4xx are coherent answers", () => {
  assert.equal(classifyHttpFailure(401), "identity_reset");
  assert.equal(classifyHttpFailure(403), "forbidden");
  assert.equal(classifyHttpFailure(500), "service_degraded"); assert.equal(classifyHttpFailure(503), "service_degraded");
  assert.equal(classifyHttpFailure(404), "client_error"); assert.equal(classifyHttpFailure(422), "client_error");
});

// --- Malformed payloads -----------------------------------------------------------------------------------------
test("well-formed intel passes through", () => { assert.equal(parseIntelResult(good)!.verdict, "clean"); });
test("malformed intel is rejected, never coerced into a verdict", () => {
  assert.equal(parseIntelResult(null), null); assert.equal(parseIntelResult("<html>502</html>"), null); assert.equal(parseIntelResult([]), null); assert.equal(parseIntelResult({}), null);
  assert.equal(parseIntelResult({ ...good, verdict: "safe" }), null);            // unknown enum
  assert.equal(parseIntelResult({ ...good, coverage: "lots" }), null);
  assert.equal(parseIntelResult({ ...good, threat_types: "MALWARE" }), null);
  assert.equal(parseIntelResult({ ...good, sources: [{ name: "x", status: "ok" }] }), null);
  assert.equal(parseIntelResult({ ...good, verdict: "malicious" }), null);       // malicious with no matching source
  assert.equal(parseIntelResult({ ...good, sources: [{ name: "gsb", status: "unavailable", detail: "", threat_types: [] }] }), null); // "clean/full" with an unavailable source
});
test("partial answer keeps its honesty", () => { const r = parseIntelResult({ ...good, verdict: "unknown", coverage: "partial", sources: [{ name: "gsb", status: "unavailable", detail: "", threat_types: [] }] }); assert.equal(r!.coverage, "partial"); });

// --- Offline decisions ------------------------------------------------------------------------------------------
test("offline known-bad: strong local signals still bark and offer a block", () => {
  const d = decide(analyseUrlLocally("http://192.168.1.10/paypal-login-verify"), null, false);
  assert.equal(d.state, "barking"); assert.equal(d.block_offered, true);
  assert.ok(d.why.some((w) => /intelligence was unavailable/.test(w)));
});
test("offline unknown: fails open as low-confidence, says verification was unavailable, never 'no listing found'", () => {
  const d = decide(analyseUrlLocally("https://www.abc.net.au"), null, false);
  assert.equal(d.state, "resting"); assert.equal(d.confidence, "low");
  assert.match(d.what_to_do, /could not confirm reputation/);
  assert.ok(!d.why.some((w) => /No listing found/.test(w)));
  assert.ok(d.why.some((w) => /unavailable/.test(w)));
});
test("timeout/unavailable coverage=none behaves exactly like no intel", () => {
  const none = { ...good, verdict: "unknown", coverage: "none", sources: [{ name: "gsb", status: "unavailable", detail: "", threat_types: [] }] };
  const a = decide(analyseUrlLocally("https://www.abc.net.au"), parseIntelResult(none), false);
  const b = decide(analyseUrlLocally("https://www.abc.net.au"), null, false);
  assert.equal(a.confidence, b.confidence); assert.equal(a.state, "resting"); assert.match(a.what_to_do, /could not confirm/);
});
test("stale/unknown intel never upgrades to medium confidence", () => {
  const d = decide(analyseUrlLocally("https://www.abc.net.au"), parseIntelResult({ ...good, verdict: "unknown", coverage: "partial", sources: [{ name: "b", status: "clear", detail: "", threat_types: [] }, { name: "gsb", status: "unavailable", detail: "", threat_types: [] }] }), false);
  assert.equal(d.confidence, "low"); assert.ok(d.why.some((w) => /Only part/.test(w)));
});

// --- Mixed states -----------------------------------------------------------------------------------------------
// These assertions used to run against src/domain/protectionTruth.ts (masterCopy), a module that was
// deleted — so they had been silently dead. They now run against buildGatesOverview, which is what the
// Protection, Home and Support surfaces actually render.
const unsupportedMessaging = { smsFiltering: "unsupported", linkInterception: "unsupported", senderReputation: "unsupported", shareExtension: "unsupported", notificationIntegration: "unsupported" } as const;
const unsupportedCalls = { callerIdentification: "unsupported", callScreening: "unsupported", numberReputation: "unsupported" } as const;
const gatesFor = (protection: ProtectionStatus | null, patch: Record<string, unknown> = {}) =>
  buildGatesOverview({ platform: "android", checking: false, protection, permissions: [], capabilities: [],
    messaging: unsupportedMessaging, calls: unsupportedCalls, ...patch } as Parameters<typeof buildGatesOverview>[0]).gates;

test("offline separates enforced protection from the online checks that need the service", () => {
  const enforced = st({ requested: true, operational: true, running: true, enforcementMethod: "dns_filter", lastVerified: new Date().toISOString() });
  const capability = [{ id: "site_guard", title: "Website protection", status: "active", detail: "On" }];
  const offline = gatesFor(enforced, { desiredSiteOn: true, capabilities: capability, online: false });
  const online = gatesFor(enforced, { desiredSiteOn: true, capabilities: capability, online: true });
  // Local enforcement stays confirmed when the service is unreachable...
  assert.equal(offline.find((g) => g.id === "site")!.resolved.coverageState, "active_verified");
  // ...while the part that needs the service says so, instead of looking like normal operation.
  const offlineLink = offline.find((g) => g.id === "link")!;
  assert.equal(offlineLink.capability.automatic?.state, "temporarily_unavailable");
  assert.match(offlineLink.capability.automatic?.limitation ?? "", /unavailable/i);
  assert.match(offlineLink.currentHelp, /online checks are unavailable/i);
  assert.equal(online.find((g) => g.id === "link")!.capability.automatic?.state, "running");
});

test("a preview/simulated adapter can never read as enforced protection", () => {
  const gate = gatesFor(st({ requested: true, operational: false, enforcementMethod: "simulated" }), { desiredSiteOn: true })
    .find((g) => g.id === "site")!;
  assert.notEqual(gate.statusLabel, "Watching");
  assert.notEqual(gate.resolved.coverageState, "active_verified");
});

test("off by choice remains a protection gap regardless of connectivity", () => {
  for (const online of [true, false]) {
    const gate = gatesFor(st({ operational: true, running: true, enforcementMethod: "dns_filter" }), { desiredSiteOn: false, online })
      .find((g) => g.id === "site")!;
    assert.equal(gate.capability.automatic?.state, "off_by_choice");
    assert.notEqual(gate.resolved.coverageState, "active_verified");
  }
});
