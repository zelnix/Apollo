import assert from "node:assert/strict";
import test from "node:test";

import type { DiTrace, DiTransaction } from "../src/domain/diTransaction.ts";
import { buildDecisionTrace } from "../src/domain/diTrace.ts";
import { diRequestText, diResponseText } from "../src/domain/diTransactionText.ts";
import { LIMITED_CAUTION, plainTriageText, type TriageInvestigationRecord } from "../src/domain/triage/contract.ts";
import { evaluateTriage } from "../src/domain/triage/engine.ts";

const limited: TriageInvestigationRecord = {
  investigationId: "tri-1", catalogueVersion: 1, sourceType: "message", outcome: "LIMITED_UNABLE_TO_DETERMINE",
  reason: "ApolloSG couldn't obtain enough evidence to decide.", rulesApplicable: ["M01", "M02"], rulesChecked: ["M01"], rulesMet: [],
  rules: [], coverageGaps: [{ code: "EMAIL_HEADERS_UNAVAILABLE", detail: "", recoverable: false, ruleIds: ["M02"] }],
  retries: [], correlation: {}, recheckUseful: false, geminiCalls: 0, evaluatedAt: "2026-06-10T09:01:00.000Z",
};

function record(partial: Partial<DiTransaction> = {}): DiTransaction {
  return {
    investigationId: "case-1", engine: "Magnum DI", environment: "Production", mode: "Live", simulated: false, status: "success",
    failureCode: null, occurredAt: "2026-06-10T09:02:00.000Z",
    request: { investigationPrompt: "Investigate.", tools: ["web_search"], attachmentCount: 0, requestBytes: 120 },
    response: { text: "{}", finishReason: "STOP" }, processing: { geminiCalls: 1, retries: 0 }, notice: null, ...partial,
  };
}

const flybyTrace = (resolved: boolean): DiTrace => ({
  triage: null, answeredBy: resolved ? "teddy_official" : "magnum_di", outcome: resolved ? "concerning" : "likely_scam", completion: "complete",
  flyby: {
    ranAt: null, resolved, answeredBy: resolved ? "teddy_official" : "magnum_di", outcome: resolved ? "concerning" : null, basis: resolved ? "impersonation" : null,
    messageType: "sms", pattern: null, checks: [{ kind: "link", status: "checked", route: "official_source" }], searchCalls: 0, searchQueries: 0,
    cacheHits: 0, magnumNeeded: !resolved, magnumSearch: false, gaps: [], issues: resolved ? [] : [{ capability: "reasoning", text: "Weigh the money request." }], simulated: false,
  },
  magnum: resolved ? null : { webSearch: false, searchQueries: 0, itemsSent: 3, simulated: false, at: null },
  settledReason: resolved
    ? { ruleId: "FLYBY-IMPERSONATION", rule: "Corroborated impersonation", by: "TC FlyBy", sentence: "Settled by TC FlyBy — corroborated impersonation: x." }
    : { ruleId: "MAGNUM-REASONING", rule: "Reasoning", by: "Magnum DI", sentence: "Settled by Magnum DI — reasoning: y." },
  higgins: { status: "PASS", mode: "plain", attempts: 1 },
});

test("a Triage-only Limited case: stops at Triage, Magnum DI not engaged, never shown as safe", () => {
  const steps = buildDecisionTrace({ trace: null, records: [], triage: limited, hasCase: false });
  assert.deepEqual(steps.map((s) => s.id), ["triage", "flyby", "magnum", "higgins"]);
  assert.equal(steps[0].status, "ran");
  assert.match(steps[0].summary, /Stopped here — Magnum DI was not engaged\./);
  assert.ok(steps[0].details.includes("Outcome: LIMITED_UNABLE_TO_DETERMINE"), "the DI keeps the code");
  assert.ok(steps[0].details.some((d) => d.includes("EMAIL_HEADERS_UNAVAILABLE")));
  assert.equal(steps[1].status, "not_engaged");
  assert.equal(steps[2].summary, "Magnum DI was not engaged.");
  assert.match(steps[3].summary, /caution/);
  assert.ok(steps.every((s) => !/nothing to worry|\bAI\b/i.test(s.summary)));
});

test("TC FlyBy settled: Magnum DI was not engaged", () => {
  const steps = buildDecisionTrace({ trace: flybyTrace(true), records: [], triage: null, hasCase: true });
  assert.equal(steps[0].status, "not_recorded");
  assert.equal(steps[1].status, "settled");
  assert.equal(steps[1].label, "Settled · Concerning");
  assert.match(steps[1].summary, /^Settled by TC FlyBy/);
  assert.equal(steps[2].summary, "Magnum DI was not engaged — TC FlyBy settled the case.");
  assert.match(steps[3].summary, /TC FlyBy's result in plain English/);
});

test("escalated to Magnum DI: the reason, the investigation and Higgins' Fidelity Check", () => {
  const steps = buildDecisionTrace({ trace: flybyTrace(false), records: [record()], triage: null, hasCase: true });
  assert.equal(steps[1].status, "escalated");
  assert.equal(steps[1].label, "Escalated to Magnum DI");
  assert.ok(steps[1].details.includes("Needs reasoning: Weigh the money request."));
  assert.equal(steps[2].status, "ran");
  assert.equal(steps[2].summary, "Magnum DI investigated 3 evidence items without web search.");
  assert.equal(steps[3].label, "Fidelity Check PASS");
});

test("escalated but no Magnum DI record yet, a failed call and a simulated answer are each said plainly", () => {
  assert.equal(buildDecisionTrace({ trace: flybyTrace(false), records: [], triage: null, hasCase: true })[2].status, "pending");
  const failed = buildDecisionTrace({ trace: flybyTrace(false), records: [record({ status: "failed", failureCode: "provider_timeout" })], triage: null, hasCase: true })[2];
  assert.equal(failed.status, "failed");
  assert.match(failed.summary, /provider_timeout/);
  const simulated = buildDecisionTrace({ trace: flybyTrace(false), records: [record({ simulated: true, mode: "Simulated" })], triage: null, hasCase: true })[2];
  assert.equal(simulated.status, "simulated");
  assert.match(simulated.summary, /in place of Magnum DI/);
});

test("the copied request and response name Magnum DI only — no provider, model or 'AI'", () => {
  for (const text of [diRequestText(record()), diResponseText(record()), diResponseText(record({ simulated: true, mode: "Simulated" }))]) {
    assert.doesNotMatch(text, /gemini|google|\bAI\b/i);
    assert.match(text, /Magnum DI/);
  }
  assert.match(diRequestText(record()), /Tools: web search/);
});

test("Coverage Gap codes become plain English for the person", () => {
  assert.equal(plainTriageText("Coverage gap: EMAIL_HEADERS_UNAVAILABLE, BROWSER_VISIBILITY_UNAVAILABLE"),
    "Couldn't check: The technical sender information wasn't available. Apollo can't see inside the browser session on this device.");
  assert.equal(plainTriageText("ApolloSG couldn't obtain enough evidence to decide: INSUFFICIENT_EVIDENCE"),
    "ApolloSG couldn't obtain enough evidence to decide: There wasn't enough evidence to decide either way.");
  assert.equal(plainTriageText("No codes here."), "No codes here.");
  assert.match(LIMITED_CAUTION, /^Treat this with caution\. .*can't say it's safe\./);
  assert.doesNotMatch(LIMITED_CAUTION, /nothing to worry/i);
});

test("a Limited Triage reason is written in plain English; the codes stay on the coverage gaps", () => {
  const record = evaluateTriage({ source_type: "link", unresolved_concern: true });
  assert.equal(record.outcome, "LIMITED_UNABLE_TO_DETERMINE");
  assert.doesNotMatch(record.reason, /[A-Z]+_[A-Z]+/);
});
