// Reputation lookups: controlled retry, in-flight deduplication, strict failure handling, and the
// "Limited by cause" telemetry. Run: node --test tests/reputationLookup.test.ts
import assert from "node:assert/strict";
import test from "node:test";

import { classifyLookupError, lookupWithRetry } from "../src/domain/reputationLookup.ts";
import { enforceEgress } from "../src/domain/privacy.ts";
import { analyseUrlLocally } from "../src/domain/risk.ts";
import { evaluateTriage } from "../src/domain/triage/engine.ts";
import { linkTriageEvidence, numberRiskTriageEvidence } from "../src/domain/triage/evidence.ts";
import { limitedCauses, numberLookupFailure, triageTelemetry } from "../src/domain/triage/limitedCause.ts";

const noWait = { sleep: async () => undefined };
const fail = (status: number, kind?: string) => Object.assign(new Error(`HTTP ${status}`), { status, kind });

test("a transient failure is retried and recovers", async () => {
  let calls = 0;
  const out = await lookupWithRetry("reputation_lookup", "a", async () => {
    calls += 1;
    if (calls === 1) throw fail(0, "timeout");
    return { verdict: "clean" };
  }, noWait);
  assert.equal(calls, 2);
  assert.deepEqual(out.value, { verdict: "clean" });
  assert.equal(out.failure, null);
  assert.deepEqual(out.retry, { check: "reputation_lookup", attempts: 2, outcome: "recovered" });
});

test("when every attempt fails the dependency is unavailable — never a pass", async () => {
  let calls = 0;
  const out = await lookupWithRetry("reputation_lookup", "b", async () => { calls += 1; throw fail(503); }, noWait);
  assert.equal(calls, 3, "the catalogue retry policy: 3 attempts");
  assert.equal(out.value, null);
  assert.equal(out.failure, "server_error");
  assert.equal(out.retry.outcome, "failed");
});

test("authorisation failures and rejected input are never retried", async () => {
  for (const [status, failure] of [[401, "auth_failure"], [403, "forbidden"], [422, "rejected"]] as const) {
    let calls = 0;
    const out = await lookupWithRetry("reputation_lookup", `c${status}`, async () => { calls += 1; throw fail(status); }, noWait);
    assert.equal(calls, 1);
    assert.equal(out.failure, failure);
    assert.deepEqual(out.retry, { check: "reputation_lookup", attempts: 1, outcome: "not_retried_permanent" });
  }
  assert.equal(classifyLookupError(fail(429)), "rate_limited");
  assert.equal(classifyLookupError(fail(0, "offline")), "offline");
});

test("an answer that checked nothing is retried, and stays unavailable if it never improves", async () => {
  let calls = 0;
  const out = await lookupWithRetry("reputation_lookup", "d", async () => { calls += 1; return { coverage: "none" }; },
    { ...noWait, unavailable: (v) => (v.coverage === "none" ? "provider_unavailable" : null) });
  assert.equal(calls, 3);
  assert.equal(out.failure, "provider_unavailable");
  assert.deepEqual(out.value, { coverage: "none" }, "the answer is kept for display, not treated as clean");
});

test("identical lookups in flight share one request", async () => {
  let calls = 0;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const run = async () => { calls += 1; await gate; return { verdict: "clean" }; };
  const first = lookupWithRetry("reputation_lookup", "same", run, noWait);
  const second = lookupWithRetry("reputation_lookup", "same", run, noWait);
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(a, b);
  await lookupWithRetry("reputation_lookup", "same", run, noWait);
  assert.equal(calls, 2, "only in-flight requests are shared; a later check asks again");
});

test("no new attempt starts after the time budget", async () => {
  let calls = 0;
  let clock = 0;
  const out = await lookupWithRetry("reputation_lookup", "e", async () => { calls += 1; clock += 50000; throw fail(0, "timeout"); },
    { ...noWait, now: () => clock, budgetMs: 45000 });
  assert.equal(calls, 1);
  assert.equal(out.failure, "timeout");
});

test("a clean link whose lookup failed is Limited, with the failure on the record and the retry kept", () => {
  const local = analyseUrlLocally("https://www.commbank.com.au/");
  const failed = evaluateTriage(linkTriageEvidence({ local, intel: null, intelError: "timeout", intelFailure: "timeout" }),
    { retries: [{ check: "reputation_lookup", attempts: 3, outcome: "failed" }] });
  assert.equal(failed.outcome, "LIMITED_UNABLE_TO_DETERMINE");
  assert.ok(failed.rules.find((r) => r.ruleId === "LINK-01")!.evidence[0].includes("(timeout)"));
  assert.deepEqual(failed.retries, [{ check: "reputation_lookup", attempts: 3, outcome: "failed" }]);
  assert.deepEqual(limitedCauses(failed, { reputationFailure: "timeout" }), ["reputation_timeout"]);
  const recovered = evaluateTriage(linkTriageEvidence({ local, intel: { verdict: "clean", coverage: "full", domain_info: { newly_registered: false } } }));
  assert.equal(recovered.outcome, "NO_THREAT_IDENTIFIED");
  assert.deepEqual(limitedCauses(recovered), []);
});

test("an intel answer where no source could check anything is never a pass", () => {
  const local = analyseUrlLocally("https://www.commbank.com.au/");
  const record = evaluateTriage(linkTriageEvidence({ local, intel: { verdict: "unknown", coverage: "none" } }));
  assert.equal(record.rules.find((r) => r.ruleId === "LINK-01")!.result, "coverage_gap");
  assert.notEqual(record.outcome, "NO_THREAT_IDENTIFIED");
});

test("Limited causes separate a moderate number result, missing number data and genuine insufficient evidence", () => {
  const review = evaluateTriage(numberRiskTriageEvidence({ decision: "review", fraudScore: 60 }));
  assert.deepEqual(limitedCauses(review, { numberDecision: "review" }), ["number_risk_moderate"]);
  const unknown = evaluateTriage(numberRiskTriageEvidence({ decision: "unknown", unavailable: true }));
  assert.deepEqual(limitedCauses(unknown, { reputationFailure: numberLookupFailure({ decision: "unknown", source: "not_configured" }) }),
    ["reputation_not_configured"]);
  assert.equal(numberLookupFailure({ decision: "unknown", source: "unavailable" }), "provider_unavailable");
  assert.equal(numberLookupFailure({ decision: "allow", source: "ipqualityscore" }), null);
  const structural = evaluateTriage({ source_type: "link", local_level: "suspicious", reputation: { status: "ok", verdict: "clean" },
    domain_age: { status: "ok", newly_registered: false }, unresolved_concern: true, visibility: { browser: false, websocket: false } });
  assert.deepEqual(limitedCauses(structural), ["insufficient_evidence"]);
});

test("the telemetry payload carries codes only and passes the egress allow-list", () => {
  const local = analyseUrlLocally("https://www.commbank.com.au/");
  const record = evaluateTriage(linkTriageEvidence({ local, intel: null, intelError: "x", intelFailure: "auth_failure" }));
  const payload = triageTelemetry(record, { reputationFailure: "auth_failure" }, { check: "reputation_lookup", attempts: 1, outcome: "not_retried_permanent" });
  assert.deepEqual(Object.keys(payload).sort(), ["catalogue_version", "causes", "gap_codes", "lookup_attempts", "lookup_check", "lookup_outcome", "outcome", "source_type"]);
  assert.deepEqual(payload.causes, ["reputation_auth_failure"]);
  assert.doesNotMatch(JSON.stringify(payload), /commbank/);
  assert.deepEqual(enforceEgress("triage_telemetry", { ...payload }), { ...payload });
  assert.throws(() => enforceEgress("triage_telemetry", { ...payload, url: "https://x.example" }));
});
