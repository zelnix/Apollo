import assert from "node:assert/strict";
import test from "node:test";

import { analyseEmail } from "../src/domain/emailAnalysis.ts";

test("a genuine-looking security email remains unverified", () => {
  const result = analyseEmail("Review recent activity in your account.", { from: "security@google.com", subject: "Security alert" });
  assert.equal(result.scenario, "E14");
  assert.equal(result.state, "ears_up");
  assert.match(result.verdict, /cannot authenticate/i);
  assert.match(result.recommendation, /official app|type their address/i);
});