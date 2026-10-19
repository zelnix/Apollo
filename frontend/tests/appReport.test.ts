// Saved App Reports — snapshot builder. Run: node --test tests/appReport.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { buildAppReportSnapshot, type AppReportInput } from "../src/domain/appReport.ts";

const input: AppReportInput = {
  id: "abc", appLabel: "AnyDesk · from A website download", state: "barking", stateName: "Apollo is barking",
  title: "Remote access capable app", verdict: "This app can let someone control your device.", recommendation: "Remove it.",
  scenario: "A01", riskScore: 85, identity: ["Name: AnyDesk"], permissions: ["Screen sharing: Access enabled — Review recommended"],
  why: ["Remote-control apps are the #1 scam tool."], network: ["No connections seen yet."], reputation: "Known remote tool.",
  evidence: ["On-device assessment."], coverage: ["Not a guarantee of safety."],
};

test("snapshot preserves every field and stamps savedAt", () => {
  const now = Date.parse("2026-06-15T10:00:00Z");
  const snap = buildAppReportSnapshot(input, now);
  assert.equal(snap.savedAt, new Date(now).toISOString());
  assert.equal(snap.appLabel, input.appLabel);
  assert.equal(snap.scenario, "A01");
  assert.equal(snap.riskScore, 85);
  assert.deepEqual(snap.permissions, input.permissions);
  assert.deepEqual(snap.coverage, input.coverage);
  assert.equal(snap.reputation, "Known remote tool.");
});
