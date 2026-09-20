// "Apollo must never say he is guarding when he isn't." Run: yarn test:truth
import assert from "node:assert/strict";
import { test } from "node:test";

import { masterCopy } from "../src/domain/protectionTruth.ts";
import type { ProtectionStatus } from "../src/security/SecurityPlatformAdapter.ts";

const st = (o: Partial<ProtectionStatus>): ProtectionStatus => ({ running: false, requested: false, operational: false, enforcementMethod: "none", coverage: "", coverageScope: [], lastVerified: null, degradedReason: null, visibility: "none", since: null, adapterLabel: "x", checkedAt: "", ...o });

test("off setting is a protection gap even if something claims to run", () => { const c = masterCopy(st({ operational: true, running: true })); assert.equal(c.title, "Some protection needs attention"); });
test("active only when requested AND operational", () => {
  assert.equal(masterCopy(st({ requested: true, operational: true, running: true, enforcementMethod: "dns_filter" })).title, "All available protection is active");
  assert.match(masterCopy(st({ requested: true, operational: true, running: true, enforcementMethod: "dns_filter" })).line, /Site Gate is confirmed active/);
});
test("requested but not operational → needs attention, link checks remain", () => {
  const c = masterCopy(st({ requested: true, operational: false }));
  assert.equal(c.title, "Some protection needs attention"); assert.match(c.line, /needs attention · Link checks remain active/);
});
test("preview adapter can never read as active", () => {
  const c = masterCopy(st({ requested: true, operational: false, enforcementMethod: "simulated" }));
  assert.equal(c.title, "Some protection needs attention"); assert.match(c.line, /unavailable on this device/);
});
test("null status is checking", () => { assert.equal(masterCopy(null).title, "Checking protection status"); });
