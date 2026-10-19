// Saved Checks snapshot builder. Run: node --test tests/savedCheck.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { buildSavedCheck, GATE_LABEL, type SavedCheckInput } from "../src/domain/savedCheck.ts";

const input: SavedCheckInput = {
  id: "a1", gate: "link", title: "Known dangerous site", subject: "bad.example", state: "biting", stateName: "Apollo is biting",
  summary: "A dangerous site was blocked.", recommendation: "Leave the site.",
  sections: [{ title: "Why", lines: ["On a blocklist"] }, { title: "Empty", lines: [] }],
};

test("builder stamps savedAt and drops empty sections", () => {
  const now = Date.parse("2026-06-15T09:00:00Z");
  const snap = buildSavedCheck(input, now);
  assert.equal(snap.savedAt, new Date(now).toISOString());
  assert.equal(snap.sections.length, 1);
  assert.equal(snap.sections[0].title, "Why");
  assert.equal(snap.gate, "link");
});

test("gate labels are human", () => {
  assert.equal(GATE_LABEL.link, "Link check");
  assert.equal(GATE_LABEL.message, "Message check");
  assert.equal(GATE_LABEL.network, "Internet check");
});
