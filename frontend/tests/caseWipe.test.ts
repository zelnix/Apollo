// Removing every threat case: each device clears its own copies from before the reset, and keeps what came after.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// caseWipe.ts imports native storage; its two pure rules are restated from its source and checked against it.
const src = read("src/store/caseWipe.ts");
const prefixes = JSON.parse(src.slice(src.indexOf("const CASE_STORE_PREFIXES = [") + "const CASE_STORE_PREFIXES = ".length, src.indexOf("];", src.indexOf("CASE_STORE_PREFIXES")) + 1).replace(/\s+/g, " ").replace(/,\s*]/, "]")) as string[];
const isCaseStoreKey = (k: string) => prefixes.some((p) => k.startsWith(p));

test("case stores go; sign-in, settings, alerts and First Check stay", () => {
  for (const k of ["apollo.savedchecks.v1", "apollo.checkhistory.call.v1", "apollo.email_checks.v1", "apollo.appreports.v1",
    "apollo.report_progress.v1", "apollo.original.v1.case-1", "apollo.device.investigations.index", "apollo.device.investigation.abc",
    "apollo.device.investigations.confirm_queue", "apollo.investigation.case_for_event", "apollo.investigation.undeleted"]) {
    assert.equal(isCaseStoreKey(k), true, k);
  }
  for (const k of ["apollo.device.identity.v2", "apollo.setup.done", "apollo.alerts.log", "apollo.firstcheck.history.v1",
    "apollo.call.trusted.v1", "apollo.notification.prefs", "apollo.case_wipe.applied.v1"]) {
    assert.equal(isCaseStoreKey(k), false, k);
  }
});

test("only events from before the reset are removed", () => {
  assert.match(src, /return events\.filter\(\(e\) => Date\.parse\(e\.occurred_at\) > cut\)/);
});

test("the device applies each reset once, after its own events are loaded", () => {
  const ctx = read("src/store/ApolloContext.tsx");
  assert.match(ctx, /apiGet<CaseWipe>\(`\/patrol\/wipe`\)/);
  assert.match(ctx, /if \(!ready \|\| !wipeId \|\| !at\) return;[\s\S]{0,200}=== wipeId\) return;[\s\S]{0,120}eventsAfterWipe\(eventsRef\.current, at\)[\s\S]{0,80}clearLocalCaseStores\(\)[\s\S]{0,80}setItem\(CASE_WIPE_APPLIED_KEY, wipeId\)/);
});
