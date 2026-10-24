// "Calls Apollo screened": history is built only from what CallScreeningService receives, written only
// after the screening response, and parsed strictly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { isRejectionRequest, parseScreenedCalls, SCREENED_OUTCOME_LABEL, screenedWhen } from "../src/domain/screenedCalls.ts";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("parses valid rows newest first and drops malformed ones", () => {
  const rows = parseScreenedCalls(JSON.stringify([
    { number: "+61400000001", at: 1000, outcome: "rang" },
    { number: "+61400000002", at: 3000, outcome: "rejection_requested_block" },
    { number: "", at: 4000, outcome: "rang" },
    { number: "+61400000003", at: "x", outcome: "rang" },
    { number: "+61400000004", at: 5000, outcome: "verified_block" },
    { number: " +61400000005 ", at: 2000, outcome: "allowed_by_you" },
  ]));
  assert.deepEqual(rows.map((r) => r.number), ["+61400000002", "+61400000005", "+61400000001"]);
});

test("garbage input yields an empty list, never a throw", () => {
  for (const bad of [null, undefined, "", "not json", "{}", "42"]) assert.deepEqual(parseScreenedCalls(bad), []);
});

test("rejections are described as requests, never as verified blocks", () => {
  assert.equal(isRejectionRequest("rejection_requested_block"), true);
  assert.equal(isRejectionRequest("rang"), false);
  for (const label of Object.values(SCREENED_OUTCOME_LABEL)) assert.doesNotMatch(label, /\bblocked\b|verified/i);
  assert.match(SCREENED_OUTCOME_LABEL.rejection_requested_risky, /asked Android to reject/);
});

test("day labels", () => {
  const now = new Date(2026, 9, 23, 12, 0, 0);
  assert.equal(screenedWhen(new Date(2026, 9, 23, 9, 5).getTime(), now).day, "Today");
  assert.equal(screenedWhen(new Date(2026, 9, 22, 9, 5).getTime(), now).day, "Yesterday");
});

test("screening service records history only after responding, in its own guard, and never from the call log", () => {
  const kt = read("modules/apollo-security/android/src/main/java/com/hucentai/apollosecurity/ApolloCallScreeningService.kt");
  const body = kt.slice(kt.indexOf("override fun onScreenCall"));
  assert.match(body, /\} finally \{[\s\S]*try \{ if \(isIncoming\(callDetails\)\) recordScreenedCall\(ctx, number, outcome\) \} catch/);
  // Every record decision follows the respond() call that answers Android.
  for (const outcome of ["allowed_by_you", "rang"]) {
    const at = body.indexOf(`"${outcome}"`);
    assert.ok(at > 0 && body.lastIndexOf("respond(callDetails", at) > 0, outcome);
  }
  assert.doesNotMatch(kt, /android\.provider\.CallLog|READ_CALL_LOG/);
  assert.match(kt, /MAX_SCREENED = 50/);
  assert.match(kt, /SCREENED_RETENTION_MS = 30L \* 24 \* 60 \* 60 \* 1000/);
  // The screening decisions themselves are unchanged.
  assert.match(body, /respond\(callDetails, disallow = true, reject = true, skipNotification = true\)/);
  assert.match(body, /catch \(_: Exception\) \{\s*\/\/ Never let a screening failure hang up a real call — always fall through to allow\.\s*respond\(callDetails, disallow = false, reject = false\)/);
});

test("Delete My Apollo Data also clears the screened-call history", () => {
  assert.match(read("src/store/ApolloContext.tsx"), /await wipeLocalApolloData\(\);[\s\S]{0,200}ScreenedCalls\.clear\(\)/);
});
