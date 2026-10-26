import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { enforceEgress } from "../src/domain/privacy.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("protection explanations are reviewed text only: no AI route, nothing about the phone is sent", () => {
  const client = read("../src/higgins/protectionExplanation.ts");
  assert.doesNotMatch(client, /apiPost|\/protections\/device\/explanation|osVersion|manufacturer/);
  assert.match(client, /apiGet<ExplanationResult>\(`\/protections\/device\/\$\{encodeURIComponent\(row\.id\)\}`\)/);
  assert.match(client, /found\?\.source === "apollo_reviewed"/);
  const screen = read("../app/capability/[id].tsx");
  assert.match(screen, /testID="capability-explanation-none"/);
  assert.doesNotMatch(screen, /Explained by Higgins for|preview_simulator/);
});

test("the removed page readers and protection explanations have no egress route", () => {
  for (const gone of ["page_extract", "page_crawl", "protection_explanation"]) {
    assert.throws(() => enforceEgress(gone as never, { device_id: "dev-123" }), gone);
  }
  const privacy = read("../src/domain/privacy.ts");
  assert.doesNotMatch(privacy, /"page_extract"|"page_crawl"|"protection_explanation"/);
});
