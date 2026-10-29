// Related history on the device (domain/caseHistory.ts): only this device's own cases, said as context, never as
// evidence; the confidence history added is shown exactly as the result recorded it.
import assert from "node:assert/strict";
import { test } from "node:test";

import { caseHistory, RAISED_LABEL, raisedBy, weightLine } from "../src/domain/caseHistory.ts";
import type { PatrolEvent } from "../src/domain/types";
import type { HigginsResponse, HistoryNote } from "../src/investigation/types";

const ev = (id: string, extra: Partial<PatrolEvent> = {}) =>
  ({ event_id: id, device_id: "device-a", category: "message", state: "growling", headline: `Case ${id}`, occurred_at: "2026-10-20T01:00:00Z", ...extra }) as PatrolEvent;

const note = (extra: Partial<HistoryNote>): HistoryNote => ({
  kind: "related_case", match: "website", text: "An earlier case on this device involved the same link, x.top.", source: "This device's own cases",
  agrees: true, subject: "x.top", eventId: null, at: null, outcome: null, findingIds: [], ...extra,
});
const response = (history: HistoryNote[]) => ({ history } as unknown as HigginsResponse);

test("related cases are the result's notes plus this device's connected events, each once, never the case itself", () => {
  const current = ev("now", { scent_id: "sc" });
  const events = [current, ev("a"), ev("b", { scent_id: "sc" }), ev("c", { scent_id: "sc" })];
  const h = caseHistory(current, events, response([note({ eventId: "a", outcome: "likely_scam", findingIds: ["f1"] }), note({ eventId: "b", match: "connected" }), note({ eventId: "now" })]));
  assert.deepEqual(h.related.map((r) => [r.key, r.reason]), [["a", "Same link"], ["b", "Connected events"], ["c", "Connected events"]]);
  assert.equal(h.related[0].result, "Likely scam");
  assert.equal(h.related[0].addsWeight, true);
  assert.equal(h.related[0].event?.event_id, "a");
});

test("an event that names another device is never shown as a related case", () => {
  const current = ev("now", { scent_id: "sc" });
  const other = ev("theirs", { scent_id: "sc", device_id: "device-b" });
  const h = caseHistory(current, [current, other], response([note({ eventId: "theirs" })]));
  assert.equal(h.related.length, 1);
  assert.equal(h.related[0].event, null);   // the note itself is the server's (this device's own); nothing of another device's opens
  assert.ok(!caseHistory(current, [current, other], response([])).related.length);
});

test("previous reports never say which device or how many, and the weight line never calls history evidence", () => {
  const high = "This link, x.top, has been previously reported as malicious — High confidence.";
  const mixed = "This number has mixed previous reports.";
  const h = caseHistory(ev("now"), [], response([
    note({ kind: "previously_encountered", text: high, findingIds: ["f1", "f2"] }),
    note({ kind: "previously_encountered", match: "number", text: mixed, agrees: false }),
  ]));
  assert.deepEqual(h.encountered.map((e) => e.text), [high, mixed]);
  assert.deepEqual(h.encountered.map((e) => e.addsWeight), [true, false]);   // mixed previous reports add nothing
  assert.equal(h.weighted, 2);
  assert.match(weightLine(2) ?? "", /more confident in two of its findings\. They aren't evidence on their own\./);
  assert.equal(weightLine(0), null);
  assert.ok(h.encountered.every((e) => !/device|case|\d|knowledge base|\bKB\b/i.test(e.text)));
});

test("a finding shows the notes that raised its confidence, each with where it came from", () => {
  const r = response([note({ findingIds: ["f1"] }), note({ kind: "previously_encountered", text: "Other", findingIds: ["f1", "f2"] })]);
  assert.deepEqual(raisedBy(r, "f1"), [
    { from: "this_device", text: "An earlier case on this device involved the same link, x.top." },
    { from: "previous_reports", text: "Other" },
  ]);
  assert.deepEqual(raisedBy(r, "f3"), []);
  assert.deepEqual(raisedBy(null, "f1"), []);
  assert.match(RAISED_LABEL.previous_reports, /previous reports \(not evidence\)$/);
  assert.match(RAISED_LABEL.this_device, /this device \(not evidence\)$/);
});
