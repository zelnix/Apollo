// "Apollo must never say he is guarding when he isn't." Run: yarn test:truth
import assert from "node:assert/strict";
import { test } from "node:test";

import { masterCopy } from "../src/domain/protectionTruth.ts";
import type { ProtectionStatus } from "../src/security/SecurityPlatformAdapter.ts";

const st = (o: Partial<ProtectionStatus>): ProtectionStatus => ({ running: false, requested: false, operational: false, enforcementMethod: "none", coverage: "", coverageScope: [], lastVerified: null, degradedReason: null, visibility: "none", since: null, adapterLabel: "x", checkedAt: "", ...o });

test("off duty when not requested, even if something claims to run", () => { const c = masterCopy(st({ operational: true, running: true })); assert.equal(c.title, "Apollo is off duty"); });
test("guarding only when requested AND operational", () => {
  assert.equal(masterCopy(st({ requested: true, operational: true, running: true, enforcementMethod: "dns_filter" })).title, "Apollo is guarding");
  assert.match(masterCopy(st({ requested: true, operational: true, running: true, enforcementMethod: "dns_filter" })).line, /DNS protection active/);
  assert.match(masterCopy(st({ requested: true, operational: true, running: true, enforcementMethod: "content_blocker" })).line, /Safari content blocker active/);
});
test("requested but not operational → guarding what he can, link checks remain", () => {
  const c = masterCopy(st({ requested: true, operational: false }));
  assert.equal(c.title, "Apollo is guarding what he can"); assert.match(c.line, /unavailable · Link checks remain active/);
});
test("mock adapter can never read as guarding", () => {
  const c = masterCopy(st({ requested: true, operational: false, enforcementMethod: "simulated" }));
  assert.equal(c.title, "Apollo is guarding what he can"); assert.match(c.line, /simulated/);
});
test("null status is off duty", () => { assert.equal(masterCopy(null).title, "Apollo is off duty"); });
