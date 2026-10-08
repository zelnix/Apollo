import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("../app/(tabs)/ask.tsx", import.meta.url), "utf8");

test("Higgins opens straight into a conversation (no hub/dashboard front doors)", () => {
  // The old hub heading, cards and buttons are gone.
  assert.doesNotMatch(source, /How Higgins can help/);
  assert.doesNotMatch(source, /higgins-hub/);
  assert.doesNotMatch(source, /Chat with Higgins/);
  // A composer and message list are always present (no button to "enter" chat first).
  assert.match(source, /testID="ask-input"/);
  assert.match(source, /testID="ask-send-button"/);
  assert.match(source, /testID="ask-messages"/);
  assert.match(source, /Message Higgins/);
});

test("Empty state shows one Higgins welcome and tappable starters", () => {
  assert.match(source, /testID="higgins-welcome"/);
  assert.match(source, /Hello! I'm Higgins/);
  assert.match(source, /ask-suggestion-\$\{index\}/);
  assert.match(source, /STARTERS = \[/);
  // Starters submit as ordinary user messages.
  assert.match(source, /onPress=\{\(\) => submit\(question\)\}/);
});

test("Clearing history lives in the header menu and requires confirmation", () => {
  assert.match(source, /testID="higgins-menu"/);
  assert.match(source, /testID="higgins-menu-clear"/);
  assert.match(source, /testID="higgins-clear-confirm"/);
  assert.match(source, /testID="higgins-clear-cancel"/);
});

test("About Higgins states real capabilities and limits (Apollo acts, Higgins interprets)", () => {
  assert.match(source, /testID="higgins-menu-about"/);
  assert.match(source, /Apollo acts; Higgins interprets/);
  assert.match(source, /can't inspect links, files or your device/);
});

test("The investigation hand-off flow is preserved", () => {
  assert.match(source, /testID="ask-investigation"/);
  assert.match(source, /startInvestigation/);
  assert.match(source, /takeHandoff/);
  assert.match(source, /ask-start-investigation/);
});
