// App Gate — evidence-backed permission findings. Run: node --test tests/appPermissionFindings.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { buildPermissionFindings, confirmedResolved, type PermissionNoteLike } from "../src/domain/appPermissionFindings.ts";

const note = (id: string, expected: boolean): PermissionNoteLike => ({ id: id as PermissionNoteLike["id"], label: id, plain: "", expected });
const sdk = (permissionStates: { permission: string; granted: boolean | null }[], specialAccessStates: { access: string; granted: boolean | null }[] = []) => ({
  packageId: "x", appName: "X", developer: null, installSource: "play_store" as const, installedAt: null, permissions: [], requestedPermissions: [], grantedPermissions: [],
  permissionStates: permissionStates.map((p) => ({ ...p, requested: true as const, basis: "package_manager" as const })),
  specialAccessStates: specialAccessStates.map((s) => ({ ...s, basis: "app_ops" as const })) as never, remoteAccessCapability: false, network: null,
});

test("granted unexpected permission → review recommended; denied → no action", () => {
  const f = buildPermissionFindings([note("camera", false), note("location", false)], sdk([{ permission: "Camera", granted: true }, { permission: "Location", granted: false }]));
  const cam = f.find((x) => x.id === "camera")!; const loc = f.find((x) => x.id === "location")!;
  assert.equal(cam.access, "enabled"); assert.match(cam.statusLabel, /Access enabled — Review recommended/); assert.equal(cam.actionable, true);
  assert.equal(loc.access, "not_allowed"); assert.match(loc.statusLabel, /No action needed/); assert.equal(loc.actionable, false);
});

test("granted but expected for purpose → fits, not an alarm", () => {
  const f = buildPermissionFindings([note("camera", true)], sdk([{ permission: "Camera", granted: true }]));
  assert.equal(f[0].access, "fits"); assert.equal(f[0].reviewRecommended, false); assert.equal(f[0].tone, "resting");
});

test("requested but unknown grant → access not verified", () => {
  const f = buildPermissionFindings([note("sms", false)], sdk([{ permission: "Read SMS", granted: null }]));
  assert.equal(f[0].access, "requested_unverified"); assert.match(f[0].statusLabel, /Access not verified/);
});

test("special access (overlay) enabled and unexpected → special review", () => {
  const f = buildPermissionFindings([note("overlay", false)], sdk([], [{ access: "display_over_other_apps", granted: true }]));
  assert.equal(f[0].access, "special_enabled"); assert.match(f[0].statusLabel, /Special access enabled — Review recommended/);
});

test("SDK present but no evidence for this permission → status unavailable (never guessed)", () => {
  const f = buildPermissionFindings([note("microphone", false)], sdk([{ permission: "Camera", granted: true }]));
  assert.equal(f[0].access, "unavailable"); assert.match(f[0].statusLabel, /Current status unavailable/);
});

test("no SDK at all (user-reported) → reported, unexpected flagged for review", () => {
  const f = buildPermissionFindings([note("camera", false), note("location", true)], null);
  assert.equal(f[0].access, "reported"); assert.match(f[0].statusLabel, /Review recommended/);
  assert.equal(f[1].access, "reported"); assert.match(f[1].statusLabel, /fits purpose/);
});

test("confirmedResolved detects an enabled permission that is now off", () => {
  const before = buildPermissionFindings([note("camera", false)], sdk([{ permission: "Camera", granted: true }]));
  const after = buildPermissionFindings([note("camera", false)], sdk([{ permission: "Camera", granted: false }]));
  const resolved = confirmedResolved(before, after);
  assert.equal(resolved.length, 1); assert.equal(resolved[0].id, "camera");
});
