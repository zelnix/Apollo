import assert from "node:assert/strict";
import test from "node:test";
import { chooseWebHostKind } from "../src/security/desktopHost.ts";

test("native desktop always wins before browser fixture eligibility", () => {
  assert.equal(chooseWebHostKind("windows", true), "desktop");
  assert.equal(chooseWebHostKind("macos", true), "desktop");
  assert.equal(chooseWebHostKind(null, true), "fixture");
  assert.equal(chooseWebHostKind(null, false), "web");
});