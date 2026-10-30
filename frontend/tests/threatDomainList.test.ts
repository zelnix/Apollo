// Threat Domain List: a valid list with zero Threat Domain Entries is current (PASS), never a fault, and being
// current never means "protected". Every new sentence reads as Higgins Luddish (plain words, Year 7–8).
// Run: node --test tests/threatDomainList.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { EMPTY_SIGNALS } from "../src/domain/deviceAnalysis.ts";
import { runFirstCheck, type FirstCheckInputs } from "../src/domain/firstCheck.ts";
import { readability } from "../src/domain/luddish/readability.ts";
import { entryCountLine, notAcceptedSentence, rejectionWords, threatDomainListStatus } from "../src/domain/threatDomainList.ts";
import { getProtectionStatus } from "../src/higgins/diagnosticCore.ts";

const NOW = Date.parse("2026-07-01T00:00:00Z");
const LIVE = "2028-06-01T05:00:00Z";
const fmt = (iso: string) => iso.slice(0, 10);
const REASONS = ["SIGNATURE_INVALID", "SIGNATURE_MISSING", "EXPIRED", "NOT_YET_VALID", "ROLLBACK", "VERSION_CONFLICT", "INVALID_RULE", "INVALID_JSON", "INVALID_SCHEMA"];

test("a current list with zero entries is current, with the count kept as technical detail", () => {
  const s = threatDomainListStatus({ ruleExpiresAt: LIVE, productionAuthority: true, threatDomainEntryCount: 0 }, null, NOW, fmt);
  assert.equal(s.current, true);
  assert.equal(s.entryCount, 0);
  assert.match(s.detail, /^Apollo's Threat Domain List is current and valid until 2028-06-01\.$/);
  assert.doesNotMatch(s.detail, /empty|no rules|0 entries/i);
  assert.equal(entryCountLine(0), "0 Threat Domain Entries");
  assert.equal(entryCountLine(1), "1 Threat Domain Entry");
  assert.equal(entryCountLine(null), null);
});

test("a populated list reads the same as a zero-entry one; out of date and unread are never current", () => {
  const populated = threatDomainListStatus({ ruleExpiresAt: LIVE, productionAuthority: true, threatDomainEntryCount: 12 }, null, NOW, fmt);
  assert.equal(populated.current, true);
  assert.equal(populated.entryCount, 12);
  const expired = threatDomainListStatus({ ruleExpiresAt: "2026-06-30T00:00:00Z", productionAuthority: true, threatDomainEntryCount: 0 }, null, NOW, fmt);
  assert.equal(expired.current, false);
  assert.match(expired.detail, /expired on 2026-06-30/);
  const unread = threatDomainListStatus({}, null, NOW, fmt);
  assert.equal(unread.current, null);
  const notOurs = threatDomainListStatus({ ruleExpiresAt: LIVE, productionAuthority: false }, null, NOW, fmt);
  assert.equal(notOurs.current, false);
});

test("a list the phone turned down is unknown, in plain words, never naming a code", () => {
  for (const reason of REASONS) {
    const s = threatDomainListStatus({ ruleExpiresAt: null }, reason, NOW, fmt);
    assert.equal(s.current, null, reason);
    assert.match(s.detail, /^This phone didn't accept ApolloSG's Threat Domain List because /, reason);
    assert.doesNotMatch(s.detail, /[A-Z]{3,}_[A-Z]+/, reason);
    assert.doesNotMatch(s.detail, /EMPTY|empty rules/i, reason);
  }
  assert.notEqual(rejectionWords("SIGNATURE_INVALID"), rejectionWords("ROLLBACK"));
  assert.match(rejectionWords("SOMETHING_NEW"), /couldn't confirm it was genuine/);
});

const inputs = (over: Partial<FirstCheckInputs> = {}): FirstCheckInputs => ({
  platform: "android", nativeHost: true, signals: { ...EMPTY_SIGNALS("android") },
  deviceFacts: { osVersion: "Android 15", manufacturer: "M", model: "X" },
  protection: { requested: false, operational: false, enforcementMethod: "packet_filter", adapterLabel: "GuardDog production Website Gate" },
  osReportedThreat: { status: "none_reported", source: "Google Play Protect", detail: "No harmful apps.", threats: [], protectionOff: false }, connection: null,
  ruleBundle: threatDomainListStatus({ ruleExpiresAt: LIVE, productionAuthority: true, threatDomainEntryCount: 0 }, null, NOW, fmt),
  ...over,
});

test("device check: a current zero-entry list is a PASS that shows its entry count", () => {
  const row = runFirstCheck(inputs()).checks.find((c) => c.id === "security_rules")!;
  assert.equal(row.result, "PASS");
  assert.equal(row.title, "Apollo's Threat Domain List");
  assert.match(String(row.evidence), /\(0 Threat Domain Entries\)$/);
});

const gate = { id: "site", title: "Website protection", statusLabel: "Off", tone: "action",
  capability: { automatic: { state: "off", limitation: "it's switched off" } }, resolved: { coverageState: "off", isAutomatic: false } };
const snapshot = (over: Record<string, unknown>) => ({
  revision: 1, checkedAt: "2026-07-01T00:00:00Z", trigger: "boot", checking: false, capabilities: [], permissions: [], network: null,
  lastCheckFailure: null, gates: [gate],
  ruleBundle: threatDomainListStatus({ ruleExpiresAt: LIVE, productionAuthority: true, threatDomainEntryCount: 0 }, null, NOW, fmt),
  ...over,
} as never);

test("diagnostics: a current zero-entry list is no issue, and it never makes protection look on", () => {
  const out = getProtectionStatus(snapshot({ protection: { running: false, requested: false, operational: false } }));
  const facts = out.facts as Record<string, unknown>;
  assert.equal(facts.rulesCurrent, true);
  assert.equal(facts.threatDomainEntries, 0);
  assert.ok(!(facts.currentIssues as string[]).some((i) => /Threat Domain List/.test(i)));
  // The list is current, but protection isn't running — and Higgins says so.
  assert.match(out.summary, /^No — Apollo's protection isn't running/);
  assert.equal(out.attentionNeeded, true);
});

test("diagnostics: an out-of-date list is the issue it is", () => {
  const expired = threatDomainListStatus({ ruleExpiresAt: "2026-06-30T00:00:00Z", productionAuthority: true, threatDomainEntryCount: 0 }, null, NOW, fmt);
  const out = getProtectionStatus(snapshot({ protection: { running: true, requested: true, operational: true }, gates: [], ruleBundle: expired }));
  assert.ok((out.facts as { currentIssues: string[] }).currentIssues.some((i) => i.startsWith("Threat Domain List: ")));
  assert.match(out.summary, /Threat Domain List is also out of date/);
});

test("every new sentence is plain English (Higgins Luddish: Year 7–8, no sentence over 25 words)", () => {
  const texts = [
    threatDomainListStatus({ ruleExpiresAt: LIVE, productionAuthority: true }, null, NOW, fmt).detail,
    threatDomainListStatus({ ruleExpiresAt: "2026-06-30T00:00:00Z", productionAuthority: true }, null, NOW, fmt).detail,
    threatDomainListStatus({}, null, NOW, fmt).detail,
    threatDomainListStatus({ ruleExpiresAt: LIVE, productionAuthority: false }, null, NOW, fmt).detail,
    ...REASONS.map((r) => notAcceptedSentence(r)),
  ];
  for (const text of texts) {
    const r = readability(text);
    assert.deepEqual(r.hard, [], text);
    assert.ok(r.label || r.grade <= 8, `${text} → grade ${r.grade}`);
  }
});
