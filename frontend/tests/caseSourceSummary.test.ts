// The case's top card: an email shows only who sent it, its subject and when it arrived; its text waits behind the
// expand button, without its links. Other material shows its own text.
import assert from "node:assert/strict";
import { test } from "node:test";

import { previewFromEvent, previewFromOriginal, withoutLinks } from "../src/domain/caseSourceSummary.ts";
import type { OriginalSource } from "../src/store/originalSource";
import type { PatrolEvent } from "../src/domain/types";

const EMAIL: OriginalSource = {
  kind: "email", capturedAt: "2026-10-28T09:00:00.000Z", origin: "this_device",
  fields: [
    { label: "From", value: "security@commbank-alerts.co" },
    { label: "Subject", value: "URGENT: unusual sign-in detected" },
    { label: "Received", value: "2026-10-28T08:55:00.000Z" },
  ],
  text: "Dear Customer,\n\nVerify now: http://commbank-secure-verify.co/netbank/login\n\nOr visit www.example-login.co today.\n\nCommBank Security Team",
};

test("an email's summary is From and Subject, with the date it was received", () => {
  const p = previewFromOriginal(EMAIL);
  assert.equal(p.icon, "email");
  assert.deepEqual(p.lines, ["From security@commbank-alerts.co", "Subject: URGENT: unusual sign-in detected"]);
  assert.equal(p.received, "2026-10-28T08:55:00.000Z");
});

test("an email's full text keeps its words and line breaks but none of its links", () => {
  const body = previewFromOriginal(EMAIL).body ?? "";
  assert.ok(body.startsWith("Dear Customer,\n\nVerify now: [link]"));
  assert.ok(body.includes("Or visit [link] today."));
  assert.ok(!/https?:\/\/|www\./.test(body));
  assert.ok(body.endsWith("CommBank Security Team"));
});

test("an email with no recorded arrival time says so by having none", () => {
  const p = previewFromOriginal({ ...EMAIL, fields: EMAIL.fields!.slice(0, 2) });
  assert.equal(p.received, null);
});

test("an email recorded at intake (no original kept) is summarised the same way", () => {
  const event = {
    event_id: "e1", category: "email", state: "growling",
    source_metadata: { type: "email", sender: "a@b.co", subject: "Hello", url: "https://b.co/x", received_at: "2026-10-28T08:00:00Z", preview: "Click https://b.co/x now" },
  } as unknown as PatrolEvent;
  const p = previewFromEvent(event)!;
  assert.deepEqual(p.lines, ["From a@b.co", "Subject: Hello"]);
  assert.equal(p.received, "2026-10-28T08:00:00Z");
  assert.equal(p.body, "Click [link] now");
});

test("a text message shows its own words, links and all", () => {
  const p = previewFromOriginal({ kind: "text", capturedAt: "2026-10-28T09:00:00.000Z", origin: "this_device", fields: [], text: "Your parcel is waiting: https://auspost-track.co/x" });
  assert.deepEqual(p.lines, []);
  assert.equal(p.body, "Your parcel is waiting: https://auspost-track.co/x");
  assert.equal(p.received, null);
});

test("withoutLinks replaces web addresses only", () => {
  assert.equal(withoutLinks("Call 13 22 21 or see https://x.co/a?b=1."), "Call 13 22 21 or see [link].");
  assert.equal(withoutLinks("Email me at jo@example.com"), "Email me at jo@example.com");
});
