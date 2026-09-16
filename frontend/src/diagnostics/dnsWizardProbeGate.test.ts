// Targeted, dependency-free unit tests for dnsWizardProbeGate.ts (the DNS/DoH wizard's 2026-06
// physical-device fix round). Run directly with: node --test frontend/src/diagnostics/dnsWizardProbeGate.test.ts
// (Node >=22 strips TypeScript types natively; no ts-node/jest/build step needed). Deliberately NOT
// wired into any CI job here -- this repo's `executable-suites` CI job only runs backend pytest +
// guarddog-contracts' own `node --test`; this file documents the exact command for the user/agent
// to re-run locally per the credit-efficient testing policy (unit tests instead of a full
// `testing_agent`/native pass for this native-adjacent logic-only change).
import assert from "node:assert/strict";
import test from "node:test";

import {
  anyAttemptEverSucceeded,
  appendPreflightAttempt,
  checkDnsCacheFreshness,
  classifyWithHardGate,
  decideRecoveryOutcome,
  describeAutomaticModeContradiction,
  describeOffModeContradiction,
  evaluateHardClassificationGate,
  latestAttempt,
  needsRecovery,
  recordHostProbedInMap,
  resolveDohAttemptPreflightCarry,
  SAFE_NULL_PREFLIGHT_CARRY,
  upsertRecordByStepId,
  type GateTruthInputs,
  type PreflightCarryLike,
} from "./dnsWizardProbeGate.ts";

const FULLY_READY: GateTruthInputs = {
  nativeAvailable: true,
  protectionState: "ACTIVE",
  tunOpen: true,
  dnsGatewayActive: true,
  m1BundleAccepted: true,
  probeRuleConfirmedInBundle: true,
  internetContinuityOk: true,
  configurationEstablished: true,
  configurationNote: null,
  truthViolation: { violated: false, reasons: [] },
};

test("hard gate: fully-ready snapshot has zero gate reasons", () => {
  assert.deepEqual(evaluateHardClassificationGate(FULLY_READY), []);
});

test("hard gate: native unavailable short-circuits with exactly one reason", () => {
  const reasons = evaluateHardClassificationGate({ ...FULLY_READY, nativeAvailable: false });
  assert.equal(reasons.length, 1);
  assert.match(reasons[0], /Native module unavailable/);
});

test("hard gate: each required condition independently forces a gate reason", () => {
  assert.match(evaluateHardClassificationGate({ ...FULLY_READY, m1BundleAccepted: false }).join(" "), /M1 signed rule bundle/);
  assert.match(evaluateHardClassificationGate({ ...FULLY_READY, probeRuleConfirmedInBundle: false }).join(" "), /dedicated probe rule/);
  assert.match(evaluateHardClassificationGate({ ...FULLY_READY, protectionState: "STOPPED" }).join(" "), /not ACTIVE/);
  assert.match(evaluateHardClassificationGate({ ...FULLY_READY, tunOpen: false }).join(" "), /TUN was not confirmed open/);
  assert.match(evaluateHardClassificationGate({ ...FULLY_READY, dnsGatewayActive: false }).join(" "), /DNS gateway was not confirmed active/);
  assert.match(evaluateHardClassificationGate({ ...FULLY_READY, internetContinuityOk: false }).join(" "), /Internet Continuity was not confirmed PASS/);
  assert.match(evaluateHardClassificationGate({ ...FULLY_READY, truthViolation: { violated: true, reasons: ["x"] } }).join(" "), /Truth-of-state violation/);
});

test("hard gate: configurationEstablished is a REQUIRED explicit field (condition 8) -- false alone forces a gate reason using configurationNote", () => {
  const reasons = evaluateHardClassificationGate({ ...FULLY_READY, configurationEstablished: false, configurationNote: "observed STRICT but tester claimed Off" });
  assert.equal(reasons.length, 1);
  assert.equal(reasons[0], "observed STRICT but tester claimed Off");
});

test("hard gate: configurationEstablished=false with no configurationNote still forces a generic gate reason (never silently passes)", () => {
  const reasons = evaluateHardClassificationGate({ ...FULLY_READY, configurationEstablished: false, configurationNote: null });
  assert.equal(reasons.length, 1);
  assert.match(reasons[0], /not established\/tester-confirmed/);
});

test("hard gate: internet continuity failing alone means NO row may ever be classified CAPTURED/BYPASSED/UNOBSERVABLE", () => {
  const { classification } = classifyWithHardGate(true, null, { ...FULLY_READY, internetContinuityOk: false });
  assert.equal(classification, "NOT_TESTABLE");
});

test("classify: attributed event -> CAPTURED when fully ready", () => {
  const { classification, gateReasons } = classifyWithHardGate(true, null, FULLY_READY);
  assert.equal(classification, "CAPTURED");
  assert.deepEqual(gateReasons, []);
});

test("classify: independent success with no capture -> BYPASSED when fully ready", () => {
  const { classification } = classifyWithHardGate(false, true, FULLY_READY);
  assert.equal(classification, "BYPASSED");
});

test("classify: absence alone (no capture, no independent success) -> UNOBSERVABLE, never guessed as BYPASSED", () => {
  const { classification } = classifyWithHardGate(false, false, FULLY_READY);
  assert.equal(classification, "UNOBSERVABLE");
  const { classification: c2 } = classifyWithHardGate(false, null, FULLY_READY);
  assert.equal(c2, "UNOBSERVABLE");
});

test("classify: gate failure forces NOT_TESTABLE even with a captured event", () => {
  const { classification } = classifyWithHardGate(true, null, { ...FULLY_READY, protectionState: "STOPPED" });
  assert.equal(classification, "NOT_TESTABLE");
});

test("classify: extraReasons (e.g. a configuration contradiction) alone forces NOT_TESTABLE", () => {
  const { classification, gateReasons } = classifyWithHardGate(false, null, FULLY_READY, ["some contradiction"]);
  assert.equal(classification, "NOT_TESTABLE");
  assert.deepEqual(gateReasons, ["some contradiction"]);
});

// --- Recovery sequencing ---

test("needsRecovery: false only when already ACTIVE", () => {
  assert.equal(needsRecovery("ACTIVE"), false);
  assert.equal(needsRecovery("STOPPED"), true);
  assert.equal(needsRecovery(null), true);
  assert.equal(needsRecovery("STARTING"), true);
});

test("recovery: already ACTIVE -> ready, no recovery attempted", () => {
  const outcome = decideRecoveryOutcome("ACTIVE", null, false);
  assert.deepEqual(outcome, {
    recoveryAttempted: false,
    protectionStateBeforeProbe: "ACTIVE",
    protectionStateAfterRecovery: null,
    ready: true,
    failureReason: null,
  });
});

test("recovery: STOPPED -> ACTIVE after a real recovery attempt -> ready", () => {
  const outcome = decideRecoveryOutcome("STOPPED", "ACTIVE", true);
  assert.equal(outcome.ready, true);
  assert.equal(outcome.recoveryAttempted, true);
  assert.equal(outcome.protectionStateBeforeProbe, "STOPPED");
  assert.equal(outcome.protectionStateAfterRecovery, "ACTIVE");
  assert.equal(outcome.failureReason, null);
});

test("recovery: attempted but settles at non-ACTIVE -> NOT ready, no 'continue anyway'", () => {
  const outcome = decideRecoveryOutcome("STOPPED", "FAILED", true);
  assert.equal(outcome.ready, false);
  assert.match(outcome.failureReason ?? "", /settled at 'FAILED'/);
});

test("recovery: not ACTIVE and recovery was never attempted -> NOT ready", () => {
  const outcome = decideRecoveryOutcome("STOPPED", null, false);
  assert.equal(outcome.ready, false);
  assert.match(outcome.failureReason ?? "", /no recovery attempt was made/);
});

test("recovery + hard gate integration: a recovered row can still be classified using the post-recovery state", () => {
  const outcome = decideRecoveryOutcome("STOPPED", "ACTIVE", true);
  assert.equal(outcome.ready, true);
  // Once ready, the row's classification uses a FRESH snapshot (re-read after recovery) --
  // simulated here by a fully-ready snapshot, matching what dnsCapabilityDiagnostic.ts does.
  const { classification } = classifyWithHardGate(true, null, FULLY_READY);
  assert.equal(classification, "CAPTURED");
});

// --- Automatic / Off contradiction checks ---

test("Automatic + INACTIVE_OR_OFF is accepted as a valid tester-confirmed configuration (no contradiction)", () => {
  assert.equal(describeAutomaticModeContradiction("INACTIVE_OR_OFF"), null);
});

test("Automatic + ACTIVE_NO_HOSTNAME is accepted (opportunistic DoT succeeded, still consistent with Automatic)", () => {
  assert.equal(describeAutomaticModeContradiction("ACTIVE_NO_HOSTNAME"), null);
});

test("Automatic + STRICT is a genuine contradiction", () => {
  assert.match(describeAutomaticModeContradiction("STRICT") ?? "", /inconsistent with Automatic/);
});

test("Off + INACTIVE_OR_OFF has no contradiction", () => {
  assert.equal(describeOffModeContradiction("INACTIVE_OR_OFF"), null);
});

test("Off + STRICT or ACTIVE_NO_HOSTNAME is a genuine contradiction", () => {
  assert.match(describeOffModeContradiction("STRICT") ?? "", /inconsistent with Off/);
  assert.match(describeOffModeContradiction("ACTIVE_NO_HOSTNAME") ?? "", /inconsistent with Off/);
});

// --- Duplicate-row fix ---

test("upsertRecordByStepId: a retry for the SAME step replaces its row instead of appending a duplicate", () => {
  const first = [{ stepId: "dot-strict", v: 1 }];
  const retried = upsertRecordByStepId(first, { stepId: "dot-strict", v: 2 });
  assert.equal(retried.length, 1);
  assert.equal(retried[0].v, 2);
});

test("upsertRecordByStepId: a different step's row is prepended, not merged", () => {
  const existing = [{ stepId: "dot-off", v: 1 }];
  const next = upsertRecordByStepId(existing, { stepId: "dot-strict", v: 1 });
  assert.equal(next.length, 2);
  assert.equal(next[0].stepId, "dot-strict");
  assert.equal(next[1].stepId, "dot-off");
});

test("upsertRecordByStepId: multiple retries of the same step never grow beyond one row", () => {
  let records: { stepId: string; v: number }[] = [];
  for (let v = 1; v <= 5; v++) records = upsertRecordByStepId(records, { stepId: "dot-strict", v });
  assert.equal(records.length, 1);
  assert.equal(records[0].v, 5);
});

// --- Immutable preflight attempt provenance ---

test("appendPreflightAttempt: never overwrites a prior attempt, even a later failure", () => {
  let attempts: ({ ok: boolean; reason: string | null } & { attemptNumber: number })[] = [];
  attempts = appendPreflightAttempt(attempts, { ok: true, reason: null });
  attempts = appendPreflightAttempt(attempts, { ok: false, reason: "DNS_GATEWAY_NOT_ACTIVE" });
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].ok, true, "the first, successful attempt must still be present and untouched");
  assert.equal(attempts[0].attemptNumber, 1);
  assert.equal(attempts[1].ok, false);
  assert.equal(attempts[1].attemptNumber, 2);
});

test("latestAttempt: gating always uses the LATEST attempt, not 'was ever ok'", () => {
  let attempts: ({ ok: boolean } & { attemptNumber: number })[] = [];
  attempts = appendPreflightAttempt(attempts, { ok: true });
  attempts = appendPreflightAttempt(attempts, { ok: false });
  assert.equal(latestAttempt(attempts)?.ok, false);
  assert.equal(anyAttemptEverSucceeded(attempts), true, "audit/report narrative can still say a success happened this session");
});

test("latestAttempt: empty attempts -> null", () => {
  assert.equal(latestAttempt([]), null);
});

// --- DNS cache freshness (isolates separate whole-wizard runs from each other) ---

test("DNS cache freshness: never probed before (null) -> freshness guaranteed", () => {
  const check = checkDnsCacheFreshness(null, Date.now(), 120_000);
  assert.equal(check.freshnessGuaranteed, true);
  assert.equal(check.reason, null);
});

test("DNS cache freshness: probed well outside the cooldown window -> freshness guaranteed", () => {
  const now = Date.now();
  const lastProbedAt = new Date(now - 200_000).toISOString();
  const check = checkDnsCacheFreshness(lastProbedAt, now, 120_000);
  assert.equal(check.freshnessGuaranteed, true);
});

test("DNS cache freshness: probed inside the cooldown window -> NOT guaranteed, with a specific reason", () => {
  const now = Date.now();
  const lastProbedAt = new Date(now - 10_000).toISOString(); // 10s ago, cooldown is 120s
  const check = checkDnsCacheFreshness(lastProbedAt, now, 120_000);
  assert.equal(check.freshnessGuaranteed, false);
  assert.match(check.reason ?? "", /last queried 10s ago/);
  assert.match(check.reason ?? "", /cached DNS answer/);
});

test("DNS cache freshness: exactly at the cooldown boundary counts as guaranteed (>=, not >)", () => {
  const now = Date.now();
  const lastProbedAt = new Date(now - 120_000).toISOString();
  const check = checkDnsCacheFreshness(lastProbedAt, now, 120_000);
  assert.equal(check.freshnessGuaranteed, true);
});

test("DNS cache freshness: unparsable/clock-skew input never invents a false failure", () => {
  assert.equal(checkDnsCacheFreshness("not-a-date", Date.now(), 120_000).freshnessGuaranteed, true);
  const future = new Date(Date.now() + 60_000).toISOString();
  assert.equal(checkDnsCacheFreshness(future, Date.now(), 120_000).freshnessGuaranteed, true);
});

// --- Per-host probe-timestamp bookkeeping (Browser "Use secure DNS" cache isolation, 2026-06 fix) ---

test("recordHostProbedInMap: first probe for a host -> previous is null, map now carries its timestamp", () => {
  const { previous, next } = recordHostProbedInMap({}, "dnsprobe4.blocktest.btciq.app", "2026-06-01T00:00:00.000Z");
  assert.equal(previous, null);
  assert.equal(next["dnsprobe4.blocktest.btciq.app"], "2026-06-01T00:00:00.000Z");
});

test("recordHostProbedInMap: a repeat probe of the SAME host (inside cooldown) returns its own prior timestamp as `previous`", () => {
  const first = recordHostProbedInMap({}, "dnsprobe4.blocktest.btciq.app", "2026-06-01T00:00:00.000Z");
  const second = recordHostProbedInMap(first.next, "dnsprobe4.blocktest.btciq.app", "2026-06-01T00:01:00.000Z");
  assert.equal(second.previous, "2026-06-01T00:00:00.000Z");
  assert.equal(second.next["dnsprobe4.blocktest.btciq.app"], "2026-06-01T00:01:00.000Z");
});

test("recordHostProbedInMap: separate hosts (dnsprobe4 vs dnsprobe5) keep fully independent histories -- probing one never leaks into the other's `previous` or timestamp", () => {
  const afterDnsprobe4 = recordHostProbedInMap({}, "dnsprobe4.blocktest.btciq.app", "2026-06-01T00:00:00.000Z");
  const afterDnsprobe5 = recordHostProbedInMap(afterDnsprobe4.next, "dnsprobe5.blocktest.btciq.app", "2026-06-01T00:05:00.000Z");
  assert.equal(afterDnsprobe5.previous, null, "dnsprobe5 was never probed before -- must not inherit dnsprobe4's timestamp");
  assert.equal(afterDnsprobe5.next["dnsprobe4.blocktest.btciq.app"], "2026-06-01T00:00:00.000Z", "dnsprobe4's own history must remain untouched");
  assert.equal(afterDnsprobe5.next["dnsprobe5.blocktest.btciq.app"], "2026-06-01T00:05:00.000Z");
});

test("recordHostProbedInMap: never mutates the input map (immutable) -- no stale-ref leakage between calls/rows", () => {
  const original = { "dnsprobe4.blocktest.btciq.app": "2026-06-01T00:00:00.000Z" };
  const frozen = Object.freeze({ ...original });
  const { next } = recordHostProbedInMap(frozen, "dnsprobe5.blocktest.btciq.app", "2026-06-01T00:05:00.000Z");
  assert.deepEqual(frozen, original, "the input map object itself must never be mutated");
  assert.notEqual(next, frozen, "a new map object must always be returned, never the same reference");
});

test("end-to-end cache isolation: repeating the SAME host inside the cooldown is NOT fresh; a DIFFERENT, never-probed host at the same moment IS fresh", () => {
  const t0 = Date.now();
  const afterFirst = recordHostProbedInMap({}, "dnsprobe4.blocktest.btciq.app", new Date(t0).toISOString());
  const sameHostCheck = checkDnsCacheFreshness(afterFirst.next["dnsprobe4.blocktest.btciq.app"], t0 + 10_000, 120_000);
  assert.equal(sameHostCheck.freshnessGuaranteed, false, "dnsprobe4 retried 10s later, inside the 120s cooldown");
  const otherHostCheck = checkDnsCacheFreshness(afterFirst.next["dnsprobe5.blocktest.btciq.app"] ?? null, t0 + 10_000, 120_000);
  assert.equal(otherHostCheck.freshnessGuaranteed, true, "dnsprobe5 has no history at all -- unaffected by dnsprobe4's own recent probe");
});

test("end-to-end cache isolation: repeating the SAME host AFTER the cooldown elapses is fresh again", () => {
  const t0 = Date.now();
  const afterFirst = recordHostProbedInMap({}, "dnsprobe4.blocktest.btciq.app", new Date(t0).toISOString());
  const check = checkDnsCacheFreshness(afterFirst.next["dnsprobe4.blocktest.btciq.app"], t0 + 130_000, 120_000);
  assert.equal(check.freshnessGuaranteed, true);
});

// --- Per-attempt PreflightCarry ref resolution (browser-return stale-closure fix, 2026-06 SIXTH round) ---

const GENUINELY_ACCEPTED_CARRY: PreflightCarryLike = {
  m1BundleAccepted: true,
  probeRuleConfirmedInBundle: true,
  internetContinuityOk: true,
  configuredUpstreamDnsResolverIpv4: "1.1.1.1",
};

test("resolveDohAttemptPreflightCarry: a genuinely captured, non-null carry is returned exactly -- never overridden by a stale/null fallback", () => {
  assert.deepEqual(resolveDohAttemptPreflightCarry(GENUINELY_ACCEPTED_CARRY), GENUINELY_ACCEPTED_CARRY);
});

test("resolveDohAttemptPreflightCarry: a missing ref (never populated for this attempt) returns the honest, fully-null default -- never silently substitutes a second, potentially-stale source of truth", () => {
  assert.deepEqual(resolveDohAttemptPreflightCarry(null), SAFE_NULL_PREFLIGHT_CARRY);
});

test("regression (the exact physical-report bug): a genuinely accepted carry (m1BundleAccepted: true) survives all the way to the hard gate with ZERO gate reasons -- a browser return can never turn it back into a forced M1-bundle NOT_TESTABLE via a stale carry", () => {
  const resolved = resolveDohAttemptPreflightCarry(GENUINELY_ACCEPTED_CARRY);
  const reasons = evaluateHardClassificationGate({
    nativeAvailable: true,
    protectionState: "ACTIVE",
    tunOpen: true,
    dnsGatewayActive: true,
    m1BundleAccepted: resolved.m1BundleAccepted,
    probeRuleConfirmedInBundle: resolved.probeRuleConfirmedInBundle,
    internetContinuityOk: resolved.internetContinuityOk,
    configurationEstablished: true,
    configurationNote: null,
    truthViolation: { violated: false, reasons: [] },
  });
  assert.deepEqual(reasons, []);
});

test("regression: the STALE all-null carry (the exact pre-fix bug shape -- pre-activation state leaking into the browser-return path) is exactly what forces the M1-bundle NOT_TESTABLE reason seen in the physical report", () => {
  const stale = resolveDohAttemptPreflightCarry(null); // simulates the ref never having been (re-)populated for this attempt -- same shape as the pre-fix stale closure
  const reasons = evaluateHardClassificationGate({
    nativeAvailable: true,
    protectionState: "ACTIVE",
    tunOpen: true,
    dnsGatewayActive: true,
    m1BundleAccepted: stale.m1BundleAccepted,
    probeRuleConfirmedInBundle: stale.probeRuleConfirmedInBundle,
    internetContinuityOk: stale.internetContinuityOk,
    configurationEstablished: true,
    configurationNote: null,
    truthViolation: { violated: false, reasons: [] },
  });
  assert.match(reasons.join(" "), /M1 signed rule bundle/);
});
