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
  classifyWithHardGate,
  decideRecoveryOutcome,
  describeAutomaticModeContradiction,
  describeOffModeContradiction,
  evaluateHardClassificationGate,
  latestAttempt,
  needsRecovery,
  upsertRecordByStepId,
  type GateTruthInputs,
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
