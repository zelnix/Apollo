// Google Play: the build never declares what Apollo doesn't use. See backend/content/play_console_declarations.md
// (shown in the admin portal under Play Store).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { expo } = require("../app.config.js");

test("precise location is not declared (Apollo never asks for it)", () => {
  assert.ok(!expo.android.permissions.includes("android.permission.ACCESS_FINE_LOCATION"));
  assert.ok(!expo.android.permissions.includes("android.permission.ACCESS_COARSE_LOCATION"));
});

test("'Display over other apps' is stripped from every build", () => {
  assert.ok(expo.android.blockedPermissions.includes("android.permission.SYSTEM_ALERT_WINDOW"));
});

test("the sound library adds no background music-player service", () => {
  const audio = expo.plugins.find((p: unknown) => Array.isArray(p) && p[0] === "expo-audio");
  assert.equal(audio[1].enableBackgroundPlayback, false);
  assert.equal(audio[1].microphonePermission, false);
});
