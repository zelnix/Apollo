import assert from "node:assert/strict";
import test from "node:test";

import { handoffFingerprint, reserveHandoff } from "../src/domain/handoffDedupe.ts";

test("identical wording on different issues creates independent reservations", () => {
  const cache = new Map<string, number>();
  const question = "What should I do?";
  const a = handoffFingerprint("file", "Disguised executable", [{ status: "warning" }], question);
  const b = handoffFingerprint("account", "Claimed breach notice", [{ status: "uncertain" }], question);
  assert.notEqual(a, b);
  assert.equal(reserveHandoff(cache, a, 1000), true);
  assert.equal(reserveHandoff(cache, b, 1000), true);
});

test("rapid repeat of the same issue is suppressed but later intentional reuse works", () => {
  const cache = new Map<string, number>();
  const key = handoffFingerprint("file", "Disguised executable", [], "Explain this issue");
  assert.equal(reserveHandoff(cache, key, 1000), true);
  assert.equal(reserveHandoff(cache, key, 1001), false);
  assert.equal(reserveHandoff(cache, key, 2000), true);
});