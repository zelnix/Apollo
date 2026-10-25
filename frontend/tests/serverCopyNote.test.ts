// The note on each saved result says when its pictures and files left Apollo's server, from what the server
// confirmed, the latest time it promised, or (for older results) only that they have left after 24 hours.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { SERVER_COPY_HOURS, serverCopyNote, serverLeavesBy, whenLabel } from "../src/domain/serverCopyNote.ts";

const BOOK = readFileSync(fileURLToPath(new URL("../../backend/content/rulebook.md", import.meta.url)), "utf8");
const YOUR_DATA = BOOK.split("{#your-data}", 2)[1]?.split("\n## ", 1)[0] ?? "";
const NOW = Date.parse("2026-10-25T10:00:00Z");
const HOUR = 3600_000;

test("a confirmed removal names the time it happened", () => {
  const removedAt = "2026-10-25T09:30:00Z";
  assert.equal(serverCopyNote({ removedAt, leavesBy: "2026-10-25T09:45:00Z" }, null, NOW),
    `The pictures and files you sent for this check were removed from ApolloSG's server on ${whenLabel(removedAt)}.`);
});

test("before removal is confirmed, the note gives the latest time; once it passes, they were removed by then", () => {
  const leavesBy = new Date(NOW + HOUR).toISOString();
  assert.match(serverCopyNote({ removedAt: null, leavesBy }, null, NOW) ?? "", /leave ApolloSG's server by /);
  assert.match(serverCopyNote({ removedAt: null, leavesBy }, null, NOW + 2 * HOUR) ?? "", /were removed from ApolloSG's server by /);
});

test("an older result says nothing until 24 hours have passed, then only that they have left", () => {
  const finished = new Date(NOW - (SERVER_COPY_HOURS - 1) * HOUR).toISOString();
  assert.equal(serverCopyNote(undefined, finished, NOW), null);
  assert.equal(serverCopyNote(undefined, finished, NOW + 2 * HOUR), "The pictures and files you sent for this check have left ApolloSG's server.");
  assert.equal(serverCopyNote(undefined, null, NOW), null, "never guessed without a record");
});

test("a live case leaves by the earlier of its own expiry and its 24-hour deadline", () => {
  assert.equal(serverLeavesBy({ expiresAt: "2026-10-25T10:15:00Z", contentDeleteBy: "2026-10-26T10:00:00Z" }), "2026-10-25T10:15:00Z");
  assert.equal(serverLeavesBy({ expiresAt: "2026-10-25T10:15:00Z", contentDeleteBy: null }), "2026-10-25T10:15:00Z");
  assert.equal(serverLeavesBy({}), null);
});

test("the rule book states the same promise and the note", () => {
  assert.ok(YOUR_DATA.includes(`within ${SERVER_COPY_HOURS} hours of the investigation finishing`));
  assert.ok(YOUR_DATA.includes("Every saved result says when its pictures and files were removed from ApolloSG's server"));
});
