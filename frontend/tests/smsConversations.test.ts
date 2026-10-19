// Text Gate — SMS conversation grouping. Run: node --test tests/smsConversations.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { filterConversations, groupSms, timeLabel } from "../src/domain/smsConversations.ts";

const base = Date.parse("2026-06-15T12:00:00Z");
const msgs = [
  { address: "+15551234567", body: "Your code is 123456", date: base - 60000 },
  { address: "+15551234567", body: "Did you get it?", date: base - 30000 },
  { address: "PayPal", body: "Confirm your payment at paypa1.com", date: base - 5000 },
  { address: "Mum", body: "Call me", date: base - 10 * 60000 },
];

test("groups by sender, newest conversation first, chat order within thread", () => {
  const convos = groupSms(msgs);
  assert.equal(convos.length, 3);
  assert.equal(convos[0].address, "PayPal"); // most recent
  const phone = convos.find((c) => c.address === "+15551234567")!;
  assert.equal(phone.count, 2);
  assert.equal(phone.messages[0].body, "Your code is 123456"); // oldest first in thread
  assert.equal(phone.preview, "Did you get it?"); // preview = newest
});

test("avatar initials: letters → initials, numbers → last two digits", () => {
  const convos = groupSms(msgs);
  assert.equal(convos.find((c) => c.address === "Mum")!.initials, "M");
  assert.equal(convos.find((c) => c.address === "+15551234567")!.initials, "67");
});

test("search matches sender and body", () => {
  const convos = groupSms(msgs);
  assert.equal(filterConversations(convos, "paypal").length, 1);
  assert.equal(filterConversations(convos, "call me").length, 1);
  assert.equal(filterConversations(convos, "").length, 3);
});

test("timeLabel shows time today and Yesterday", () => {
  assert.match(timeLabel(base - 60000, base), /\d/);
  assert.equal(timeLabel(base - 20 * 3600000, base), "Yesterday");
  assert.equal(timeLabel(0, base), "");
});
