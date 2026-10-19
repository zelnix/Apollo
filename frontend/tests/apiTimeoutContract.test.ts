import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/api/client.ts", import.meta.url), "utf8");

test("API budget uses an explicit race so ignored aborts cannot leave a Gate spinning", () => {
  assert.match(source, /Promise\.race\(\[fetch\(/);
  assert.match(source, /timedOut \|\| ctl\.signal\.aborted/);
  assert.match(source, /rejectTimeout\?\.\(new Error\("request timeout"\)\)/);
});