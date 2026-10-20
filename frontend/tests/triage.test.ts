// Apollo Triage — on-device engine acceptance tests. Run: node --test tests/triage.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { evaluateTriage, runWithRetries } from "../src/domain/triage/engine.ts";
import { legacyOutcome, recheckCanHelp, gapPlainEnglish, RULES } from "../src/domain/triage/contract.ts";
import CATALOGUE from "../src/domain/triage/catalogue.ts";
import { linkTriageEvidence, messageTriageEvidence, callTriageEvidence, numberRiskTriageEvidence } from "../src/domain/triage/evidence.ts";
import { analyseUrlLocally } from "../src/domain/risk.ts";
import { analyseMessage } from "../src/domain/messageAnalysis.ts";
import { analyseCall } from "../src/domain/callAnalysis.ts";

test("the device catalogue is identical to the backend source of truth", () => {
  const backend = readFileSync(new URL("../../backend/content/triage_catalogue.json", import.meta.url), "utf8");
  assert.equal(JSON.stringify(CATALOGUE), JSON.stringify(JSON.parse(backend)),
    "src/domain/triage/catalogue.ts must match backend/content/triage_catalogue.json");
});

test("every catalogue rule has a unique id, category and title", () => {
  const ids = RULES.map((r) => r.id);
  assert.equal(ids.length, new Set(ids).size);
  for (const rule of RULES) assert.ok(rule.title && rule.category, rule.id);
});

test("legacy verdicts map without silently becoming no threat", () => {
  assert.equal(legacyOutcome("SAFE"), "NO_THREAT_IDENTIFIED");
  assert.equal(legacyOutcome("SUSPICIOUS"), "POSSIBLE_THREAT_IDENTIFIED");
  assert.equal(legacyOutcome("UNCERTAIN"), "LIMITED_UNABLE_TO_DETERMINE");
  assert.equal(legacyOutcome(""), "LIMITED_UNABLE_TO_DETERMINE");
});

test("a clean link with every check completed is NO THREAT and spends nothing", () => {
  const local = analyseUrlLocally("https://www.commbank.com.au/");
  const record = evaluateTriage(linkTriageEvidence({
    local, intel: { verdict: "clean", domain_info: { newly_registered: false } },
  }));
  assert.equal(record.outcome, "NO_THREAT_IDENTIFIED");
  assert.equal(record.geminiCalls, 0);
  assert.ok(record.rulesChecked.length > 0, "No Threat must still record which rules ran");
  assert.equal(recheckCanHelp(record), false);
});

test("a confirmed malicious destination is a POSSIBLE THREAT", () => {
  const local = analyseUrlLocally("https://secure-login.example.co/verify");
  const record = evaluateTriage(linkTriageEvidence({ local, intel: { verdict: "malicious", threat_types: ["phishing"] } }));
  assert.equal(record.outcome, "POSSIBLE_THREAT_IDENTIFIED");
  assert.ok(record.rulesMet.includes("LINK-01"));
  assert.equal(record.geminiCalls, 0);
});

test("reputation unavailable is LIMITED with a recoverable coverage gap, never no threat", () => {
  const local = analyseUrlLocally("https://some-shop.xyz/offer");
  const record = evaluateTriage(linkTriageEvidence({ local, intel: null, intelError: "Reputation check unavailable" }));
  assert.equal(record.outcome, "LIMITED_UNABLE_TO_DETERMINE");
  assert.deepEqual(record.coverageGaps.map((g) => g.code), ["INTELLIGENCE_PROVIDER_UNAVAILABLE"]);
  assert.equal(recheckCanHelp(record), true);
  assert.ok(gapPlainEnglish("INTELLIGENCE_PROVIDER_UNAVAILABLE").length > 0);
});

test("a coverage gap alone can never create a possible threat", () => {
  const local = analyseUrlLocally("https://www.example.com/");
  const record = evaluateTriage(linkTriageEvidence({ local, intel: null, intelError: "offline" }));
  assert.notEqual(record.outcome, "POSSIBLE_THREAT_IDENTIFIED");
  assert.deepEqual(record.rulesMet, []);
});

test("positive threat evidence is not downgraded by an unavailable check", () => {
  const local = analyseUrlLocally("https://commbank-secure-verify.xyz/login");
  const record = evaluateTriage(linkTriageEvidence({ local, intel: null, intelError: "offline" }));
  assert.equal(record.outcome, "POSSIBLE_THREAT_IDENTIFIED");
  assert.ok(record.coverageGaps.some((g) => g.code === "INTELLIGENCE_PROVIDER_UNAVAILABLE"));
  assert.ok(record.rulesMet.length > 0);
});

test("browser-only rules record a non-recoverable gap instead of pretending to check", () => {
  const local = analyseUrlLocally("https://login-microsoft-verify.xyz/signin");
  const record = evaluateTriage(linkTriageEvidence({ local, intel: { verdict: "clean" }, credentialInteraction: true }));
  const bitm = record.rules.filter((r) => r.ruleId.startsWith("BITM-") && r.ruleId !== "BITM-05");
  assert.ok(bitm.length === 4 && bitm.every((r) => r.result === "coverage_gap"));
  const gap = record.coverageGaps.find((g) => g.code === "BROWSER_VISIBILITY_UNAVAILABLE");
  assert.ok(gap && gap.recoverable === false);
});

test("structural-only URL indicators stay LIMITED, never a manufactured threat", () => {
  const record = evaluateTriage({
    source_type: "link", local_level: "suspicious", local_signals: ["risky_tld", "deep_subdomains", "long_host"],
    indicator_match: false, credentials_in_url: false, credential_interaction: false,
    reputation: { status: "ok", verdict: "clean" }, domain_age: { status: "ok", newly_registered: false },
    unresolved_concern: true, visibility: { browser: false, websocket: false },
  });
  assert.equal(record.outcome, "LIMITED_UNABLE_TO_DETERMINE");
  assert.deepEqual(record.rulesMet, []);
});

test("message asking for a verification code is a possible threat", () => {
  const analysis = analyseMessage("+61400000000", "CommBank: reply with the 6 digit verification code to unlock your account");
  const record = evaluateTriage(messageTriageEvidence({ analysis, linkOutcome: null }));
  assert.equal(record.outcome, "POSSIBLE_THREAT_IDENTIFIED");
  assert.ok(record.rulesMet.includes("MSG-01"));
  assert.equal(record.geminiCalls, 0);
});

test("an ordinary message is no threat", () => {
  const analysis = analyseMessage("Mum", "Dinner at 6 tonight, see you then");
  const record = evaluateTriage(messageTriageEvidence({ analysis, linkOutcome: null }));
  assert.equal(record.outcome, "NO_THREAT_IDENTIFIED");
});

test("unknown sender, urgency or a PayID mention alone never creates a threat", () => {
  for (const text of ["Hi, are you free now? It's urgent", "You can pay me by PayID when you get a chance"]) {
    const analysis = analyseMessage("", text);
    const record = evaluateTriage(messageTriageEvidence({ analysis, linkOutcome: null }));
    assert.notEqual(record.outcome, "POSSIBLE_THREAT_IDENTIFIED", text);
  }
});

test("call asking for remote access is a possible threat; an ordinary call is not", () => {
  const remote = analyseCall({ asks: ["remote"], claim: "techsupport" });
  const risky = evaluateTriage(callTriageEvidence({ input: { asks: ["remote"], claim: "techsupport" }, analysis: remote }));
  assert.equal(risky.outcome, "POSSIBLE_THREAT_IDENTIFIED");
  assert.ok(risky.rulesMet.includes("CALL-07"));

  const ordinary = analyseCall({ asks: ["nothing"], claim: "unknown" });
  const calm = evaluateTriage(callTriageEvidence({ input: { asks: ["nothing"], claim: "unknown" }, analysis: ordinary }));
  assert.equal(calm.outcome, "NO_THREAT_IDENTIFIED");
});

test("caller reputation without scam behaviour does not escalate", () => {
  const review = evaluateTriage(numberRiskTriageEvidence({ decision: "review", fraudScore: 62 }));
  assert.equal(review.outcome, "LIMITED_UNABLE_TO_DETERMINE");
  const unknown = evaluateTriage(numberRiskTriageEvidence({ decision: "unknown" }));
  assert.equal(unknown.outcome, "LIMITED_UNABLE_TO_DETERMINE");
  const avoid = evaluateTriage(numberRiskTriageEvidence({ decision: "avoid", fraudScore: 96 }));
  assert.equal(avoid.outcome, "POSSIBLE_THREAT_IDENTIFIED");
});

test("correlation needs a compatible mechanic and supporting evidence, never time alone", () => {
  const base = {
    source_type: "device", device_changes: [], vpn_change: true, vpn_trusted: false,
    visibility: { dns: false, tls: false, push: false, browser: false },
  };
  const timeOnly = evaluateTriage({ ...base, correlation: { related: [{ category: "app", event_id: "a1" }], supporting_evidence: false, mechanics: [] } });
  assert.notEqual(timeOnly.outcome, "POSSIBLE_THREAT_IDENTIFIED");
  const supported = evaluateTriage({ ...base, correlation: { related: [{ category: "app", event_id: "a1" }], supporting_evidence: true, mechanics: ["permission_change"] } });
  assert.equal(supported.outcome, "POSSIBLE_THREAT_IDENTIFIED");
});

test("bounded deterministic retries: initial + 2, permanent limits are never retried", async () => {
  let attempts = 0;
  const recovered = await runWithRetries("safe_browsing", async () => {
    attempts += 1;
    if (attempts < 3) throw new Error("timeout");
    return "ok";
  });
  assert.equal(recovered.value, "ok");
  assert.equal(recovered.record.attempts, 3);
  assert.equal(recovered.record.outcome, "recovered");

  const failed = await runWithRetries("safe_browsing", async () => { throw new Error("down"); });
  assert.equal(failed.record.attempts, 3);
  assert.equal(failed.record.outcome, "failed");

  const permanent = await runWithRetries("private_dns", async () => { throw new Error("unsupported"); }, { permanent: true });
  assert.equal(permanent.record.attempts, 0);
  assert.equal(permanent.record.outcome, "not_retried_permanent");
});

test("every record carries the full audit shape for Patrol History", () => {
  const record = evaluateTriage(messageTriageEvidence({ analysis: analyseMessage("", "buy gift cards now"), linkOutcome: null }));
  for (const key of ["investigationId", "catalogueVersion", "sourceType", "outcome", "reason", "rulesApplicable",
    "rulesChecked", "rulesMet", "rules", "coverageGaps", "retries", "correlation", "recheckUseful", "geminiCalls", "evaluatedAt"]) {
    assert.ok(key in record, `missing ${key}`);
  }
  assert.equal(record.geminiCalls, 0);
});
