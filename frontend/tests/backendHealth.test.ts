import assert from "node:assert/strict";
import { test } from "node:test";

import { healthyProbe } from "../src/health/systemHealthPolicy.ts";

const valid = { schemaVersion: 1, status: "ok", service: "apollo-v1", checkedAt: "2026-09-24T12:00:00Z" };

test("public backend probe never mistakes 4xx, 5xx, HTML or unsupported schemas for healthy", () => {
  assert.equal(healthyProbe(200, valid), true);
  for (const code of [400, 401, 403, 404, 429, 500, 502, 503]) assert.equal(healthyProbe(code, valid), false);
  for (const value of [null, "<html>nginx</html>", {}, { ...valid, status: "degraded" }, { ...valid, service: "wrong" }, { ...valid, schemaVersion: 2 }]) {
    assert.equal(healthyProbe(200, value), false);
  }
});