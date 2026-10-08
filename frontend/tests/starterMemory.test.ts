import assert from "node:assert/strict";
import { test } from "node:test";

import { recordInto, topStarters } from "../src/higgins/starterMemoryCore.ts";

test("recording the same question increases its count and keeps it most frequent", () => {
  let e = recordInto([], "Is my device protected?", 1000);
  e = recordInto(e, "Why is Apollo barking?", 1001);
  e = recordInto(e, "is my device protected?", 1002); // case-insensitive match
  assert.equal(e.length, 2);
  const top = e.find((x) => x.q.toLowerCase() === "is my device protected?");
  assert.equal(top?.count, 2);
  assert.equal(e[0].q, "is my device protected?"); // sorted most-frequent first (latest casing kept)
});

test("topStarters returns only repeated questions, most frequent first", () => {
  let e: ReturnType<typeof recordInto> = [];
  e = recordInto(e, "What is smishing?", 1);
  e = recordInto(e, "What is smishing?", 2);
  e = recordInto(e, "How do I report a scam?", 3); // asked once only
  assert.deepEqual(topStarters(e), ["What is smishing?"]);
  assert.deepEqual(topStarters(e, 3, 1), ["What is smishing?", "How do I report a scam?"]);
});

test("trivially short or overly long messages are ignored", () => {
  assert.deepEqual(recordInto([], "hi"), []);
  assert.deepEqual(recordInto([], "x".repeat(200)), []);
});

test("whitespace is normalised so near-identical questions fold together", () => {
  let e = recordInto([], "  Is   my device   protected? ", 1);
  e = recordInto(e, "Is my device protected?", 2);
  assert.equal(e.length, 1);
  assert.equal(e[0].count, 2);
  assert.equal(e[0].q, "Is my device protected?");
});
