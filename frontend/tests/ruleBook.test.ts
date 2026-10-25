// The rule book is one shared file (backend/content/rulebook.md). The app renders it word for word, so every
// construct the book uses must come out as clean text — no stray markdown — and the settling rules must be there.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parseInline, parseRuleBook, plainText, reviewedLabel, type Block } from "../src/domain/ruleBook.ts";
import { detectCheckIntent } from "../src/higgins/checkIntent.ts";
import { classifyIntent } from "../src/higgins/intentRouter.ts";
import { QUICK_QUESTIONS } from "../src/higgins/quickQuestions.ts";

const BOOK = readFileSync(fileURLToPath(new URL("../../backend/content/rulebook.md", import.meta.url)), "utf8");
const ASK_HIGGINS = BOOK.split("{#ask-higgins}", 2)[1]?.split("\n## ", 1)[0] ?? "";

function texts(blocks: Block[]): string[] {
  return blocks.flatMap((b) => b.kind === "heading" ? [b.text]
    : b.kind === "paragraph" ? [plainText(b.spans)]
    : b.kind === "list" ? b.items.map((i) => plainText(i.spans))
    : b.kind === "table" ? [...b.headers, ...b.rows.flat().map(plainText)] : []);
}

test("inline emphasis: bold, italics and code become styled spans; snake_case stays text", () => {
  assert.deepEqual(parseInline("A **full** match, *partial* and `code`."), [
    { text: "A " }, { text: "full", bold: true }, { text: " match, " }, { text: "partial", italic: true }, { text: " and " }, { text: "code", code: true }, { text: "." }]);
  assert.deepEqual(parseInline("_Last reviewed: 2026-06-01._"), [{ text: "Last reviewed: 2026-06-01.", italic: true }]);
  assert.deepEqual(parseInline("teddy_official and magnum_di"), [{ text: "teddy_official and magnum_di" }]);
});

test("headings carry their {#id}, tables keep headers and rows, nested lists keep their depth", () => {
  const blocks = parseRuleBook("# Title\n\n## Rules {#settling-rules}\n\n| A | B |\n|---|---|\n| **x** | y |\n\n1. One\n   - nested\n2. Two\n\n---\n\nText\nwraps.");
  assert.deepEqual(blocks[1], { kind: "heading", level: 2, text: "Rules", id: "settling-rules" });
  assert.equal(blocks[2].kind, "table");
  if (blocks[2].kind === "table") { assert.deepEqual(blocks[2].headers, ["A", "B"]); assert.equal(blocks[2].rows.length, 1); assert.equal(blocks[2].rows[0][0][0].bold, true); }
  assert.equal(blocks[3].kind, "list");
  if (blocks[3].kind === "list") assert.deepEqual(blocks[3].items.map((i) => [i.depth, i.marker]), [[0, "1."], [1, "•"], [0, "2."]]);
  assert.equal(blocks[4].kind, "rule");
  assert.deepEqual(blocks[5], { kind: "paragraph", spans: [{ text: "Text wraps." }], indent: false });
});

test("the real rule book renders as clean text with every section and the settling rules", () => {
  const blocks = parseRuleBook(BOOK);
  const all = texts(blocks);
  for (const line of all) {
    assert.ok(!/\*\*|\{#|^\||^#+\s|`/.test(line), `unrendered markdown in: ${line}`);
  }
  const headings = blocks.filter((b): b is Extract<Block, { kind: "heading" }> => b.kind === "heading").map((b) => b.text);
  for (const part of ["Apollo detection", "Higgins Triage", "TC FlyBy", "Magnum DI", "Higgins (explanation)", "Ask Higgins", "Settling rules"]) {
    assert.ok(headings.some((h) => h.includes(part)), `missing section: ${part}`);
  }
  assert.ok(blocks.some((b) => b.kind === "heading" && b.id === "settling-rules"));
  const settling = blocks.find((b) => b.kind === "table" && b.headers[0] === "Rule ID");
  assert.ok(settling && settling.kind === "table" && settling.rows.length >= 13);
  assert.ok(blocks.filter((b) => b.kind === "table").length >= 5);
});

test("the review date reads as a plain date, and nothing is invented without one", () => {
  assert.equal(reviewedLabel("2026-06-01"), "1 June 2026");
  assert.equal(reviewedLabel(null), null);
  assert.equal(reviewedLabel("soon"), null);
});

test("the Ask Higgins rules in the book match what the phone does", () => {
  assert.ok(ASK_HIGGINS, "the book has an Ask Higgins section {#ask-higgins}");
  assert.ok(ASK_HIGGINS.includes(`There are ${QUICK_QUESTIONS.length} quick questions`), "number of quick questions");
  const unclear = classifyIntent("hmm");
  assert.equal(unclear.route, "clarify");
  assert.ok(ASK_HIGGINS.includes(`"${unclear.clarificationQuestion}"`), "the clarifying question, word for word");
  // A check word and a subject word open the matching form; the first subject mentioned wins.
  assert.equal(detectCheckIntent("Can you check this email?")?.category, "email_accounts");
  assert.equal(detectCheckIntent("check the link in this email")?.category, "websites_links");
  assert.equal(detectCheckIntent("Can you check this for me?"), null);
  // Wayfinding goes to Higgins; the phone's own state is answered on the phone.
  assert.equal(classifyIntent("Where is call screening?").route, "ask_higgins");
  assert.equal(classifyIntent("Is my phone protected?").route, "local_diagnostic");
  for (const form of ["Screenshot or photo", "Websites & Links", "Messages & Calls", "Email & Accounts", "Apps & Files", "Device & Internet"]) {
    assert.ok(ASK_HIGGINS.includes(`| ${form} |`), `form: ${form}`);
  }
});
