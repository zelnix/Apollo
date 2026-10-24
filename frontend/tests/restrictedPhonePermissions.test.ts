// Google Play restricted SMS / Call Log permissions must be OFF by default, only enabled by an explicit,
// approved configuration change, and their absence must never weaken live call/text protection.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { restrictedPickerDeclared } from "../src/domain/restrictedPickers.ts";
import { buildDeviceCapabilities } from "../src/domain/deviceCapabilities.ts";

const require = createRequire(import.meta.url);
const { resolveRestrictedPhonePermissions } = require("../plugins/withRestrictedPhonePermissions.js");
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("no Apollo source manifest declares READ_CALL_LOG or READ_SMS", () => {
  for (const path of [
    "modules/apollo-security/android/src/main/AndroidManifest.xml",
    "modules/apollo-family-assist/android/src/main/AndroidManifest.xml",
    "packages/guarddog-android-sdk/guarddog-vpn/src/main/AndroidManifest.xml",
  ]) {
    assert.doesNotMatch(read(path), /<uses-permission[^>]+(READ_CALL_LOG|READ_SMS)/, path);
  }
  assert.doesNotMatch(read("app.config.js"), /"android\.permission\.(READ_CALL_LOG|READ_SMS)"/);
});

test("switch is off by default and for the literal 'off'", () => {
  assert.deepEqual(resolveRestrictedPhonePermissions({}), { callLog: false, sms: false, approval: null });
  assert.deepEqual(resolveRestrictedPhonePermissions({ APOLLO_ANDROID_RESTRICTED_PERMISSIONS: "off" }), { callLog: false, sms: false, approval: null });
});

test("enabling without an approval reference fails the config load", () => {
  assert.throws(() => resolveRestrictedPhonePermissions({ APOLLO_ANDROID_RESTRICTED_PERMISSIONS: "READ_SMS" }), /APPROVAL/);
  assert.throws(() => resolveRestrictedPhonePermissions({ APOLLO_ANDROID_RESTRICTED_PERMISSIONS: "READ_CALL_LOG", APOLLO_ANDROID_RESTRICTED_PERMISSIONS_APPROVAL: "  " }), /APPROVAL/);
});

test("unknown or sloppy values fail instead of silently enabling", () => {
  for (const value of ["on", "true", "1", "read_sms", "READ_SMS,SEND_SMS", ","]) {
    assert.throws(() => resolveRestrictedPhonePermissions({ APOLLO_ANDROID_RESTRICTED_PERMISSIONS: value, APOLLO_ANDROID_RESTRICTED_PERMISSIONS_APPROVAL: "ref" }), /not valid/, value);
  }
});

test("an explicit, approved switch enables only what it names", () => {
  assert.deepEqual(resolveRestrictedPhonePermissions({ APOLLO_ANDROID_RESTRICTED_PERMISSIONS: "READ_CALL_LOG", APOLLO_ANDROID_RESTRICTED_PERMISSIONS_APPROVAL: "PLAY-123" }), { callLog: true, sms: false, approval: "PLAY-123" });
  assert.deepEqual(resolveRestrictedPhonePermissions({ APOLLO_ANDROID_RESTRICTED_PERMISSIONS: "READ_CALL_LOG, READ_SMS", APOLLO_ANDROID_RESTRICTED_PERMISSIONS_APPROVAL: "PLAY-9" }), { callLog: true, sms: true, approval: "PLAY-9" });
});

test("the production (Play) EAS profile pins the switch off", () => {
  const eas = JSON.parse(read("eas.json"));
  assert.equal(eas.build.production.env.APOLLO_ANDROID_RESTRICTED_PERMISSIONS, "off");
});

test("app.config wires the plugin and exposes both flags false by default", () => {
  const saved = { a: process.env.APOLLO_ANDROID_RESTRICTED_PERMISSIONS, b: process.env.APOLLO_ANDROID_RESTRICTED_PERMISSIONS_APPROVAL };
  delete process.env.APOLLO_ANDROID_RESTRICTED_PERMISSIONS; delete process.env.APOLLO_ANDROID_RESTRICTED_PERMISSIONS_APPROVAL;
  try {
    const config = require("../app.config.js");
    assert.ok(config.expo.plugins.includes("./plugins/withRestrictedPhonePermissions"));
    assert.deepEqual(config.expo.extra.restrictedPhonePermissions, { callLog: false, sms: false });
  } finally {
    if (saved.a !== undefined) process.env.APOLLO_ANDROID_RESTRICTED_PERMISSIONS = saved.a;
    if (saved.b !== undefined) process.env.APOLLO_ANDROID_RESTRICTED_PERMISSIONS_APPROVAL = saved.b;
  }
});

test("JS treats only a literal true as declared", () => {
  assert.equal(restrictedPickerDeclared("call_log", undefined), false);
  assert.equal(restrictedPickerDeclared("sms", {}), false);
  assert.equal(restrictedPickerDeclared("sms", { restrictedPhonePermissions: { sms: "true" } }), false);
  assert.equal(restrictedPickerDeclared("call_log", { restrictedPhonePermissions: { callLog: true } }), true);
  assert.equal(restrictedPickerDeclared("sms", { restrictedPhonePermissions: { callLog: true } }), false);
});

test("native module refuses undeclared restricted permissions before any prompt or read", () => {
  const kt = read("modules/apollo-security/android/src/main/java/com/hucentai/apollosecurity/ApolloSecurityModule.kt");
  assert.match(kt, /else if \(!isDeclared\(perm\)\) JSONObject\(\)\.put\("requested", false\)\.put\("reason", "not_declared"\)/);
  assert.match(kt, /AsyncFunction\("listRecentCalls"\) \{ if \(isDeclared\(android\.Manifest\.permission\.READ_CALL_LOG\)\)/);
  assert.match(kt, /AsyncFunction\("listRecentSms"\) \{ if \(isDeclared\(android\.Manifest\.permission\.READ_SMS\)\)/);
});

test("screens gate the restricted pickers on the build declaration — never a dead option", () => {
  assert.match(read("app/message.tsx"), /PhonePickers\.isSupported\("sms"\)/);
  assert.match(read("app/message.tsx"), /\{canPickSms \|\| simulation\.included \? \(\s*<SourceHero/);
  assert.match(read("app/message.tsx"), /\{canPickSms \? \(\s*<View style=\{s\.recentSection\}/);
  assert.match(read("app/message-picker.tsx"), /PhonePickers\.isSupported\("sms"\)/);
  assert.match(read("app/call-guard.tsx"), /PhonePickers\.isSupported\("call_log"\)/);
  assert.match(read("app/call.tsx"), /PhonePickers\.isSupported\("call_log"\)/);
  assert.doesNotMatch(read("app/call-guard.tsx"), /listRecentCalls|Select from recent calls|Choose a recent caller/);
});

test("Share is never described as available from every app", () => {
  for (const path of ["app/share.tsx", "app/settings/index.tsx", "app/message.tsx", "app/message-picker.tsx", "app/text-guard.tsx"]) {
    assert.doesNotMatch(read(path), /from any app|Share in Messages, Mail or your browser|from your Messages app/i, path);
  }
});

test("live protection is untouched: screening service and notification listener remain declared", () => {
  const manifest = read("modules/apollo-security/android/src/main/AndroidManifest.xml");
  assert.match(manifest, /ApolloCallScreeningService[\s\S]*BIND_SCREENING_SERVICE/);
  assert.match(manifest, /ApolloSmsListenerService[\s\S]*BIND_NOTIFICATION_LISTENER_SERVICE/);
});

test("Device Capabilities says Apollo doesn't read the call log / inbox when undeclared", () => {
  const v = buildDeviceCapabilities({ platform: "android", caps: {} as never, native: null });
  const rows = [...v.apolloCanUse, ...v.needsPermission, ...v.notAccessible, ...v.unavailable, ...v.unknown];
  assert.match(rows.find((r) => r.id === "call_history")!.detail, /doesn’t read your call log.*Calls Apollo screened/);
  assert.match(rows.find((r) => r.id === "message_inbox")!.detail, /doesn’t read your text messages.*Text Guard/);
  const declared = buildDeviceCapabilities({ platform: "android", caps: {} as never, native: null, restrictedPickers: { callLog: true, sms: true } });
  assert.equal(declared.needsPermission.some((r) => r.id === "call_history"), true);
});
