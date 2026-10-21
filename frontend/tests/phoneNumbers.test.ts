// Telephone/mobile numbers in a threat's original evidence — extraction and the evidence Triage reads.
import assert from "node:assert/strict";
import test from "node:test";

import { extractPhoneCandidates, phoneFindingLine, phoneTriageReputation, phoneWhyLines, type EvidencePhoneResult } from "../src/domain/phoneNumbers.ts";

const result = (over: Partial<EvidencePhoneResult>): EvidencePhoneResult => ({
  raw: "0412 345 678", number: "+61412345678", decision: "allow", fraud_score: 0, recent_abuse: false,
  voip: false, line_type: "Mobile", carrier: "Telstra", country: "AU", source: "ipqualityscore",
  checked_at: "2026-06-10T00:00:00.000Z", ...over,
});

test("finds the numbers a scam message supplies", () => {
  const found = extractPhoneCandidates("PayPal: a payment of $1,299.00 was made. Not you? Call 1800 123 456 now.");
  assert.deepEqual(found, ["1800 123 456"]);
});

test("reads international, local and service numbers", () => {
  assert.deepEqual(extractPhoneCandidates("Call +61 2 8123 4567 or 13 12 29"), ["+61 2 8123 4567", "13 12 29"]);
});

test("never reads a date, an amount or an id inside a link as a number", () => {
  assert.deepEqual(extractPhoneCandidates("Invoice dated 2026-06-10 for 1,250.00 — see https://acme.co/inv/987654321"), []);
  assert.deepEqual(extractPhoneCandidates("Reply by 10-06-2026"), []);
  assert.deepEqual(extractPhoneCandidates("Reference 00000000"), []);
});

test("does not read an email address as a number", () => {
  assert.deepEqual(extractPhoneCandidates("Write to billing12345678@acme.co"), []);
});

test("de-duplicates the same number and caps how many are checked", () => {
  const text = "Call 0412 345 678 or (04) 1234 5678 — alternates: 0298765432, 0387654321, 0276543210";
  const found = extractPhoneCandidates(text);
  assert.equal(found.length, 3);
  assert.equal(found[0], "0412 345 678");
});

test("the worst answered number speaks for the material", () => {
  assert.deepEqual(phoneTriageReputation([result({}), result({ decision: "avoid", fraud_score: 96 })]),
    { status: "ok", verdict: "malicious", fraud_score: 96 });
  assert.deepEqual(phoneTriageReputation([result({ decision: "review", fraud_score: 87 })]),
    { status: "ok", verdict: "high_risk", fraud_score: 87 });
  assert.deepEqual(phoneTriageReputation([result({})]), { status: "ok", verdict: "clean" });
});

test("nothing answered is reported as a gap, never as clean", () => {
  assert.deepEqual(phoneTriageReputation([result({ decision: "unknown", source: "unavailable", fraud_score: null })]),
    { status: "unavailable", verdict: "unknown" });
  assert.deepEqual(phoneTriageReputation([]), null);
});

test("an unchecked number never reads as a finding", () => {
  const line = phoneFindingLine(result({ decision: "unknown", fraud_score: null, carrier: null }));
  assert.match(line, /was not checked/);
  assert.deepEqual(phoneWhyLines([result({ decision: "unknown", fraud_score: null })]), []);
  assert.deepEqual(phoneWhyLines([result({ raw: "1800 123 456", decision: "avoid", fraud_score: 96 })]),
    ["The number 1800 123 456 in this material has strong signs of fraud or spam abuse (fraud score 96/100)."]);
});
