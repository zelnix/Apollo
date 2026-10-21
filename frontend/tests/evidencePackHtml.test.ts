// The shared evidence pack must read like the Evidence tab: same layout, same honesty.
// Run: cd /app/frontend && node --test tests/evidencePackHtml.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { buildOriginalSourceHtml } from "../src/domain/evidencePackHtml.ts";

const base = { capturedAt: "2026-06-02T09:28:00.000Z", origin: "this_device" as const };
const redact = (v: string) => v.replace(/code is \d{6}/i, "[credential redacted]");

test("an email is laid out as an email, with its headers listed", () => {
  const html = buildOriginalSourceHtml({
    ...base, kind: "email",
    text: "From: security@commbank-alerts.co\nSubject: Unusual sign-in detected\n\nVerify now: http://commbank-secure-verify.co/login",
  }, redact);
  assert.match(html, /<h2>Original email, as captured<\/h2>/);
  assert.match(html, /class="aname">security@commbank-alerts\.co/);
  assert.match(html, /class="asubject">Unusual sign-in detected/);
  assert.match(html, /<h2>Headers as captured<\/h2>/);
  assert.match(html, /<h2>Links in this material<\/h2>[\s\S]*commbank-secure-verify\.co/);
});

test("a message is laid out as a bubble under the sender", () => {
  const html = buildOriginalSourceHtml({ ...base, kind: "text", text: "From AusPost:\nYour parcel is held." }, redact);
  assert.match(html, /class="aname">AusPost</);
  assert.match(html, /class="bubble">Your parcel is held\./);
});

test("the sent copy is included only when something was actually removed", () => {
  const withCode = buildOriginalSourceHtml({ ...base, kind: "text", text: "Your code is 884213 — do not share." }, redact);
  assert.match(withCode, /<h2>Copy sent for investigation<\/h2>/);
  assert.match(withCode, /\[credential redacted\]/);
  const clean = buildOriginalSourceHtml({ ...base, kind: "text", text: "Your parcel is held." }, redact);
  assert.doesNotMatch(clean, /Copy sent for investigation/);
});

test("a screenshot points at the reproduced image instead of inventing a body", () => {
  const html = buildOriginalSourceHtml({ ...base, kind: "screenshot" }, redact);
  assert.match(html, /Image evidence/);
  assert.doesNotMatch(html, /class="bubble"/);
});

test("captured text is escaped, never injected into the pack's markup", () => {
  const html = buildOriginalSourceHtml({ ...base, kind: "text", text: "<script>alert('x')</script>" }, redact);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test("an empty capture says so rather than showing an empty frame", () => {
  const html = buildOriginalSourceHtml({ ...base, kind: "text" }, redact);
  assert.match(html, /No content was captured for this item\./);
});
