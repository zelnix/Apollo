import assert from "node:assert/strict";
import test from "node:test";

import { analyseMessage } from "../src/domain/messageAnalysis.ts";

test("genuine-looking delivery notification avoids a parcel-scam false alarm", () => {
  const result = analyseMessage("Australia Post", "Your parcel is arriving tomorrow. Track in the AusPost app or at https://auspost.com.au/mypost/track/ABC123");
  assert.equal(result.scenario, "M15");
  assert.equal(result.state, "ears_up");
  assert.match(result.verdict, /not authenticated/i);
  assert.doesNotMatch(result.scenarioTitle, /scam/i);
  assert.match(result.recommendation, /official app/i);
});