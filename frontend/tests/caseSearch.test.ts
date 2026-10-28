// Threat Case search: open cases only, by sender, website or words in the message.
// Run: node --test tests/caseSearch.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { matchCase, openCases, searchCases } from "../src/domain/caseSearch.ts";
import type { PatrolEvent } from "../src/domain/types";
import type { OriginalSource } from "../src/store/originalSource";

const event = (id: string, over: Partial<PatrolEvent> = {}): PatrolEvent => ({
  event_id: id, device_id: "d1", category: "message", state: "barking", status: "open", headline: "Possible scam",
  what_happened: "", why: [], what_to_do: "", indicator_host: null, indicator_digest: null, verified_block: false,
  adapter_label: "", occurred_at: "2026-10-28T10:00:00.000Z", resolved_at: null, ...over,
}) as PatrolEvent;
const original = (over: Partial<OriginalSource>): OriginalSource => ({ kind: "message", capturedAt: "2026-10-28T10:00:00.000Z", origin: "this_device", ...over }) as OriginalSource;

const sms = event("sms", { source_metadata: { type: "text", preview: "Your parcel is waiting" } });
const smsOriginal = original({ fields: [{ label: "From", value: "+61 419 841 238" }], text: "UNIﬁed Energy: claim your rebate at unified-rebates.com before rebates drop next week. Reply YES." });
const email = event("email", { category: "email", indicator_host: "commbank-secure.xyz", source_metadata: { type: "email", sender: "alerts@commbank-secure.xyz", subject: "Your account is locked" } });
const closed = event("closed", { resolved_at: "2026-10-28T11:00:00.000Z", source_metadata: { type: "text", sender: "0400 000 000", preview: "Your parcel is waiting" } });
const originals = { sms: smsOriginal };

test("only open cases are searched, one row per case", () => {
  const repeat = event("sms-older", { case_key: "k", occurred_at: "2026-10-27T10:00:00.000Z" });
  const latest = event("sms-newer", { case_key: "k", occurred_at: "2026-10-28T12:00:00.000Z" });
  assert.deepEqual(openCases([sms, closed, repeat, latest]).map((e) => e.event_id), ["sms-newer", "sms"]);
  assert.deepEqual(searchCases(openCases([sms, email, closed]), "parcel", originals).map((r) => r.event.event_id), []);
  assert.deepEqual(searchCases(openCases([sms, email, closed]), "0400 000", originals), []);
});

test("a sender matches by name or address, and a number however it is written", () => {
  assert.deepEqual(matchCase(email, null, "alerts@commbank"), { match: "sender", excerpt: "alerts@commbank-secure.xyz" });
  for (const q of ["0419 841 238", "0419841238", "+61419841238", "841 238"]) {
    assert.equal(matchCase(sms, smsOriginal, q)?.match, "sender", q);
  }
});

test("a website matches by its address, with or without https:// and www.", () => {
  for (const q of ["commbank-secure.xyz", "https://www.commbank-secure.xyz/login", "COMMBANK-SECURE.XYZ"]) {
    assert.deepEqual(matchCase(email, null, q), { match: "website", excerpt: "commbank-secure.xyz" }, q);
  }
  // A plain name is looked for as a sender first; an email address with the query in it is a sender match.
  assert.equal(matchCase(email, null, "commbank-secure")?.match, "sender");
  assert.equal(matchCase(email, null, "alerts@commbank-secure.xyz")?.match, "sender");
  // A link inside the message counts as its website.
  assert.deepEqual(matchCase(sms, smsOriginal, "unified-rebates"), { match: "website", excerpt: "unified-rebates.com" });
});

test("words in the message match in any order, from the original kept on the phone", () => {
  const found = matchCase(sms, smsOriginal, "rebate claim")!;
  assert.equal(found.match, "message");
  assert.match(found.excerpt, /claim your rebate/);
  // The "ﬁ" ligature reads as "fi".
  assert.equal(matchCase(sms, smsOriginal, "unified energy")?.match, "message");
  // The subject counts as part of the message.
  assert.equal(matchCase(email, null, "account locked")?.match, "message");
  // Without a kept original, the recorded preview is searched.
  assert.equal(matchCase(sms, null, "parcel waiting")?.match, "message");
  assert.equal(matchCase(sms, smsOriginal, "rebate refund"), null);
});

test("a query too short to mean anything matches nothing", () => {
  assert.equal(matchCase(sms, smsOriginal, " a "), null);
  assert.deepEqual(searchCases([sms, email], "", originals), []);
});
