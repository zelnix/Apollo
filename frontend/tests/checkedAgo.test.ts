// A result Apollo reused instead of asking again says when it was last checked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { checkedAgo, reusedLine } from "../src/domain/checkedAgo.ts";

const NOW = Date.parse("2026-10-25T09:00:00Z");

test("recent checks read as minutes or hours ago", () => {
  assert.equal(checkedAgo("2026-10-25T08:59:40Z", NOW), "just now");
  assert.equal(checkedAgo("2026-10-25T08:59:00Z", NOW), "1 minute ago");
  assert.equal(checkedAgo("2026-10-25T08:35:00Z", NOW), "25 minutes ago");
  assert.equal(checkedAgo("2026-10-25T07:00:00Z", NOW), "2 hours ago");
});

test("older checks give the date, and nothing is invented without a time", () => {
  assert.match(checkedAgo("2026-10-20T07:00:00Z", NOW), /^on .*2026/);
  assert.equal(checkedAgo(null, NOW), "");
  assert.equal(checkedAgo("not a date", NOW), "");
  assert.equal(reusedLine(undefined, NOW), "");
});

test("the reused line names Apollo's earlier check", () => {
  assert.equal(reusedLine("2026-10-25T07:00:00Z", NOW), "From Apollo's check 2 hours ago, still current, so it wasn't looked up again");
});

test("the report shows the line for a reused result; Ask Higgins has no saved AI answers to show", () => {
  const ask = readFileSync(new URL("../app/(tabs)/ask.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(ask, /reusedLine|Saved answer|ask-reused-|ask-simulated-/);
  const body = readFileSync(new URL("../src/components/report/ReportBody.tsx", import.meta.url), "utf8");
  assert.match(body, /source\.reused \? <Text style=\{s\.muted\} testID=\{`\$\{testID\}-reused`\}>\{reusedLine\(source\.retrievedAt\)\}/);
});
