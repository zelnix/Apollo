import assert from "node:assert/strict";
import test from "node:test";
import { chooseWebHostKind } from "../src/security/desktopHost.ts";

test("a desktop host is chosen explicitly; everything else is the real browser adapter", () => {
  assert.equal(chooseWebHostKind("windows"), "desktop");
  assert.equal(chooseWebHostKind("macos"), "desktop");
  // There is no simulated host to fall back to: an unrecognised host answers as the browser, which
  // reports native capabilities as unavailable rather than substituting fixtures for them.
  assert.equal(chooseWebHostKind(null), "web");
});