// Alert history says what happened, never more. "Accepted" is not "delivered"; only a tap is proof.
// Run: cd /app/frontend && node --test tests/alertHistory.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { alertHistory, deviceAlertStatus, serverAlertStatus } from "../src/domain/alertHistory.ts";

const server = (over = {}) => ({
  alertKey: "owner-evt-1", title: "Apollo is barking", state: "provider_accepted",
  failureCode: null, sentAt: "2026-06-01T10:00:00Z", updatedAt: "2026-06-01T10:00:02Z", openedAt: null,
  ...over,
});

const device = (over = {}) => ({
  id: "local-1", title: "Apollo is growling", body: "Worth a look.", at: "2026-06-01T09:00:00Z",
  state: "shown", ...over,
});

test("an accepted alert is never written as delivered or seen", () => {
  const status = serverAlertStatus(server());
  assert.equal(status, "Accepted by the delivery service");
  assert.ok(!/delivered|seen|read/i.test(status));
});

test("a refusal carries its real reason in plain words", () => {
  assert.equal(serverAlertStatus(server({ state: "failed", failureCode: "insufficient_credits" })),
    "Not delivered — the app owner's alert credit ran out");
  assert.equal(serverAlertStatus(server({ state: "failed", failureCode: "push_key_invalid" })),
    "Not delivered — ApolloSG's alert key was rejected");
  // An unmapped code is still shown rather than hidden behind a generic phrase.
  assert.equal(serverAlertStatus(server({ state: "failed", failureCode: "provider_http_418" })),
    "Not delivered — provider http 418");
});

test("a timeout is never reported as a definite non-delivery", () => {
  assert.equal(serverAlertStatus(server({ state: "outcome_unknown", failureCode: "provider_timeout" })),
    "Never confirmed either way");
});

test("a held alert says when it will be released", () => {
  const status = serverAlertStatus(server({ state: "held", heldUntil: "2026-06-02T05:00:00Z" }));
  assert.ok(status.startsWith("Held until "), status);
});

test("on-device alerts distinguish shown, held and refused", () => {
  assert.equal(deviceAlertStatus(device()), "Shown on this device");
  assert.equal(deviceAlertStatus(device({ state: "shown", releasedAt: "2026-06-01T05:00:00Z" })), "Shown after quiet hours ended");
  assert.equal(deviceAlertStatus(device({ state: "held" })), "Waiting for quiet hours to end");
  assert.equal(deviceAlertStatus(device({ state: "failed", detail: "Notification permission is not granted." })),
    "Not shown — Notification permission is not granted.");
});

test("both sources merge into one list, newest first", () => {
  const rows = alertHistory([server()], [device()]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].source, "server");   // 10:00 before 09:00
  assert.equal(rows[1].source, "device");
});

test("a tap is carried through as the only proof it arrived", () => {
  const [row] = alertHistory([server({ openedAt: "2026-06-01T10:05:00Z" })], []);
  assert.equal(row.opened, true);
  const [unopened] = alertHistory([server()], []);
  assert.equal(unopened.opened, false);
});

test("the list is capped so the screen stays readable", () => {
  const many = Array.from({ length: 40 }, (_, i) => server({ alertKey: `k${i}`, sentAt: `2026-06-01T10:${String(i).padStart(2, "0")}:00Z` }));
  assert.equal(alertHistory(many, [], 30).length, 30);
});
