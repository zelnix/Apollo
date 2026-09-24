import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { reportHtml, validReport } from "../src/investigation/reportHtml.ts";

const fixture = { reportId: "health", caseId: "health-health", gates: ["device"], savedAt: "2026-09-24T12:00:00Z",
  overview: "A fictional reminder & <sample>", explanationMarkdown: "No real device was observed.",
  assessment: "uncertain", attention: "none", scope: "Synthetic health only.", responseRevision: 1,
  findings: [], uncertainties: ["No real observation."],
  actions: [{ id: "one", kind: "instruction", label: "Read instructions", instruction: "Check the printed manual." }],
  sources: [], historical: false, retentionNotice: "This temporary report is deleted." };

test("synthetic fixture uses the strict shared Higgins report renderer", () => {
  assert.equal(validReport(fixture), true);
  assert.equal(validReport({ ...fixture, sources: [{ url: "x", title: "y" }] }), false);
  assert.equal(validReport({ ...fixture, historical: "false" }), false);
  const html = reportHtml(fixture);
  assert.match(html, /Higgins system health check/);
  assert.match(html, /&amp; &lt;sample&gt;/);
  assert.doesNotMatch(html, /<sample>/);
});

test("normal saved-report export and health check share one temporary-file preparation", () => {
  const normal = readFileSync("app/saved-report/[id].tsx", "utf8");
  const health = readFileSync("src/health/systemHealthCoordinator.ts", "utf8");
  const shared = readFileSync("src/investigation/reportFile.ts", "utf8");
  assert.match(normal, /prepareReportPdf\(report\)/);
  assert.match(health, /prepareReportPdf\(check\.report\.fixture\)/);
  assert.match(health, /finally\s*\{[\s\S]*prepared\?\.dispose\(\)/);
  assert.match(shared, /printToFileAsync/);
  assert.match(shared, /file\.bytes\(\)/);
  assert.match(shared, /file\.delete\(\)/);
});