import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_WEBSITE_GATE_OVERRIDES,
  pruneWebsiteGateOverrides,
  removeWebsiteGateOverride,
  upsertWebsiteGateOverride,
  validateWebsiteGateOverrideList,
  validateWebsiteGateOverrideRecord,
  type WebsiteGateOverrideRecord,
} from "../src/websiteGateOverrides.ts";

test("upsert adds a canonicalized ALLOW record", () => {
  const { records, ok } = upsertWebsiteGateOverride([], "EXAMPLE.com.", "2026-01-01T00:00:00.000Z");
  assert.ok(ok);
  assert.deepEqual(records, [{ host: "example.com", type: "allow", source: "user", decidedAt: "2026-01-01T00:00:00.000Z" }]);
});

test("upsert rejects a host that fails canonicalization, leaving records unchanged", () => {
  const existing: WebsiteGateOverrideRecord[] = [
    { host: "example.com", type: "allow", source: "user", decidedAt: "2026-01-01T00:00:00.000Z" },
  ];
  const { records, ok } = upsertWebsiteGateOverride(existing, "not a host!!", "2026-01-02T00:00:00.000Z");
  assert.equal(ok, false);
  assert.deepEqual(records, existing);
});

test("upsert twice for the same host does not duplicate, refreshes decidedAt", () => {
  const first = upsertWebsiteGateOverride([], "example.com", "2026-01-01T00:00:00.000Z").records;
  const second = upsertWebsiteGateOverride(first, "example.com", "2026-02-01T00:00:00.000Z").records;
  assert.equal(second.length, 1);
  assert.equal(second[0].decidedAt, "2026-02-01T00:00:00.000Z");
});

test("removing an override is fully reversible and a no-op for an unrelated host", () => {
  const withOne = upsertWebsiteGateOverride([], "example.com", "2026-01-01T00:00:00.000Z").records;
  assert.deepEqual(removeWebsiteGateOverride(withOne, "other.example"), withOne);
  assert.deepEqual(removeWebsiteGateOverride(withOne, "example.com"), []);
});

test("removing with an uncanonicalizable host is a safe no-op", () => {
  const withOne = upsertWebsiteGateOverride([], "example.com", "2026-01-01T00:00:00.000Z").records;
  assert.deepEqual(removeWebsiteGateOverride(withOne, "not a host!!"), withOne);
});

test("storage is bounded: pushing past MAX evicts the oldest first", () => {
  let records: WebsiteGateOverrideRecord[] = [];
  for (let i = 0; i < MAX_WEBSITE_GATE_OVERRIDES + 10; i++) {
    records = upsertWebsiteGateOverride(records, `host-${i}.example`, new Date(2026, 0, 1, 0, 0, i).toISOString()).records;
  }
  assert.equal(records.length, MAX_WEBSITE_GATE_OVERRIDES);
  assert.ok(!records.some((r) => r.host === "host-0.example")); // oldest evicted
  assert.ok(records.some((r) => r.host === `host-${MAX_WEBSITE_GATE_OVERRIDES + 9}.example`)); // newest kept
});

test("pruneWebsiteGateOverrides is a no-op under the bound", () => {
  const small: WebsiteGateOverrideRecord[] = [
    { host: "example.com", type: "allow", source: "user", decidedAt: "2026-01-01T00:00:00.000Z" },
  ];
  assert.deepEqual(pruneWebsiteGateOverrides(small), small);
});

test("validator structurally rejects anything but type:'allow' -- no override can encode a block", () => {
  const tamperedAsBlock = { host: "example.com", type: "block", source: "user", decidedAt: "2026-01-01T00:00:00.000Z" };
  assert.equal(validateWebsiteGateOverrideRecord(tamperedAsBlock), null);
  assert.equal(validateWebsiteGateOverrideRecord({ ...tamperedAsBlock, type: "deny" }), null);
});

test("validator rejects malformed source, host, or timestamp", () => {
  const base = { host: "example.com", type: "allow" as const, source: "user" as const, decidedAt: "2026-01-01T00:00:00.000Z" };
  assert.equal(validateWebsiteGateOverrideRecord({ ...base, source: "server" }), null);
  assert.equal(validateWebsiteGateOverrideRecord({ ...base, host: "not a host!!" }), null);
  assert.equal(validateWebsiteGateOverrideRecord({ ...base, decidedAt: "not-a-date" }), null);
  assert.deepEqual(validateWebsiteGateOverrideRecord(base), base);
});

test("validateWebsiteGateOverrideList drops corrupted entries instead of throwing, and still bounds", () => {
  const mixed: unknown[] = [
    { host: "good.example", type: "allow", source: "user", decidedAt: "2026-01-01T00:00:00.000Z" },
    { host: "bad.example", type: "block", source: "user", decidedAt: "2026-01-01T00:00:00.000Z" }, // structurally impossible, dropped
    "not-even-an-object",
    null,
    42,
  ];
  const result = validateWebsiteGateOverrideList(mixed);
  assert.deepEqual(result, [{ host: "good.example", type: "allow", source: "user", decidedAt: "2026-01-01T00:00:00.000Z" }]);
});

test("validateWebsiteGateOverrideList on non-array input fails safe to empty, never throws", () => {
  assert.deepEqual(validateWebsiteGateOverrideList(null), []);
  assert.deepEqual(validateWebsiteGateOverrideList("garbage"), []);
});
