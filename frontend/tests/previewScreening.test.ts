// The preview's simulated text recognition must feed Apollo's REAL screening, and must never let a
// simulated read look like a real one.
// Run: cd /app/frontend && node --test tests/previewScreening.test.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { classifyRegions } from "../src/domain/imagePrivacyCore.ts";
import { SIMULATED_SCREENSHOT_TEXT } from "../src/preview/simulatedScreenshotText.ts";

const ROOT = new URL("..", import.meta.url).pathname;

/** The simulator hands a null frame to the real classifier as a zero-size box: read, not locatable. */
function regionsFor(sampleId: string) {
  const blocks = SIMULATED_SCREENSHOT_TEXT[sampleId];
  assert.ok(blocks?.length, `no declared text for ${sampleId}`);
  return classifyRegions(
    blocks.map((b) => ({ text: b.text, frame: b.frame ?? { x: 0, y: 0, width: 0, height: 0 } })),
    { purpose: "investigation_evidence" },
  );
}

const credentials = (sampleId: string) =>
  regionsFor(sampleId).filter((r) => r.sensitiveType === "credential");

test("a sign-in code in a sample image is found with a box Apollo can black out", () => {
  const found = credentials("sim-shot-sms-code");
  assert.equal(found.length, 1);
  assert.match(found[0].text, /verification code is 884213/);
  assert.ok(found[0].frame.width > 0 && found[0].frame.height > 0);
});

test("a password the recogniser can't place has no box, so it can't be blacked out", () => {
  const found = credentials("sim-shot-email-password");
  assert.equal(found.length, 1);
  assert.match(found[0].text, /Temporary password:/);
  assert.equal(found[0].frame.width, 0);
  assert.equal(found[0].frame.height, 0);
});

test("samples without a credential stay whole, so they can be sent as evidence", () => {
  for (const id of ["sim-shot-sms-bank", "sim-shot-email-invoice", "sim-shot-delivery"]) {
    assert.deepEqual(credentials(id), [], `${id} should carry no credential`);
  }
});

test("an unplaceable credential is refused before the image is sent", () => {
  const prep = readFileSync(join(ROOT, "src/components/ImageUploadPrep.tsx"), "utf8");
  assert.match(prep, /credentials\.some\(\(r\) => !r\.frame \|\| r\.frame\.width <= 0 \|\| r\.frame\.height <= 0\)/);
});

test("the simulated read is gated to the preview bundle and never invents text", () => {
  const sim = readFileSync(join(ROOT, "src/preview/simulatedScreening.ts"), "utf8");
  assert.match(sim, /if \(!PREVIEW_SAMPLES_ENABLED\) return null;/);
  // An image that is not a known sample reports NO text — never borrowed text from another sample.
  assert.match(sim, /if \(!blocks\) return \{ blocks: \[\], fromSample: false, notice: UNREAD_NOTICE \};/);
});
