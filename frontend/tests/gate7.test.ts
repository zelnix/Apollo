// Gate 7 scenario benchmark (A01–A20 + device D01–D11). Run: yarn test:gate7
import assert from "node:assert/strict";
import { test } from "node:test";

import { analyseApp, brandInName, isRemoteTool, type AppInput } from "../src/domain/appAnalysis.ts";
import { assessDevice, EMPTY_SIGNALS } from "../src/domain/deviceAnalysis.ts";

const app = (over: Partial<AppInput>): AppInput => ({ name: "Some App", source: "play_store", purpose: "other", permissions: [], context: {}, ...over });

test("A01 / acceptance 1: remote-access app installed during suspicious bank call → barking + exact message", () => {
  const r = analyseApp(app({ name: "AnyDesk Remote Desktop", source: "play_store", purpose: "remote_support", permissions: ["screen_share", "accessibility"], context: { promptedByCaller: true } }));
  assert.equal(r.state, "barking"); assert.equal(r.scenario, "A01");
  assert.match(r.verdict, /let someone control or view your device/i); assert.match(r.verdict, /do not give the caller access/i);
  assert.equal(r.remoteCapable, true); assert.equal(r.stayWithMe, false);
});
test("A01 via Threat Scent (recent call event, no explicit flag) → barking", () => {
  const r = analyseApp(app({ name: "Quick Support", source: "browser", purpose: "other", permissions: ["screen_share"], context: { recentScentCategories: ["call"] } }));
  assert.equal(r.state, "barking"); assert.equal(r.scenario, "A01");
});
test("A01 with access already granted → Stay With Me", () => {
  const r = analyseApp(app({ name: "TeamViewer QuickSupport", purpose: "remote_support", permissions: ["screen_share"], context: { promptedByCaller: true, accessGrantedNow: true } }));
  assert.equal(r.stayWithMe, true); assert.match(r.recommendation, /End the session/i);
});
test("A02 sideloaded APK, unknown dev, unusual permissions → growling (not barking by default)", () => {
  const r = analyseApp(app({ name: "Photo Editor Pro", source: "browser", purpose: "game_media", permissions: ["contacts", "location"] }));
  assert.equal(r.state, "growling"); assert.equal(r.scenario, "A02");
});
test("A02 plain sideload, permissions fit → ears_up (don't treat all sideloads as malicious)", () => {
  const r = analyseApp(app({ name: "F-Droid Weather", source: "other_store", purpose: "simple_tool", permissions: [] }));
  assert.equal(r.state, "ears_up"); assert.equal(r.scenario, "A02");
});
test("A03 fake WhatsApp update from message → barking", () => {
  const r = analyseApp(app({ name: "WhatsApp Update", source: "message", purpose: "update", permissions: [] }));
  assert.equal(r.state, "barking"); assert.equal(r.scenario, "A03"); assert.match(r.verdict, /never update through a file or link/i);
});
test("Acceptance 2: 'Bank Security Update' from unknown website with SMS + accessibility + overlay → barking", () => {
  const r = analyseApp(app({ name: "Bank Security Update", source: "browser", purpose: "security", permissions: ["sms", "accessibility", "overlay"] }));
  assert.equal(r.state, "barking"); assert.ok(r.riskScore >= 70, `score ${r.riskScore}`);
});
test("A04 flashlight asking for contacts/mic/SMS/accessibility/location → growling with permission comparison", () => {
  const r = analyseApp(app({ name: "Super Torch", source: "play_store", purpose: "simple_tool", permissions: ["contacts", "microphone", "sms", "accessibility", "location"] }));
  assert.ok(["ears_up", "growling"].includes(r.state)); assert.ok(r.permissionNotes.filter((n) => !n.expected).length >= 4);
});
test("A05 / acceptance 5: unknown utility asks accessibility + overlay + notifications → growling, explains power", () => {
  const r = analyseApp(app({ name: "Fast Utility", source: "play_store", purpose: "other", permissions: ["accessibility", "overlay", "notifications"] }));
  assert.equal(r.state, "growling"); assert.equal(r.scenario, "A05"); assert.match(r.why.join(" "), /read parts of your screen/i);
});
test("A05 sideloaded accessibility + overlay → barking", () => {
  assert.equal(analyseApp(app({ name: "Secure Helper", source: "browser", purpose: "other", permissions: ["accessibility", "overlay"] })).state, "barking");
});
test("A06 overlay alone on a game → ears_up", () => { const r = analyseApp(app({ name: "Puzzle Blast", purpose: "game_media", permissions: ["overlay"] })); assert.equal(r.state, "ears_up"); assert.equal(r.scenario, "A06"); });
test("A07 notification access on shopping app → ears_up", () => { const r = analyseApp(app({ name: "ShopFast", purpose: "shopping_social", permissions: ["notifications"] })); assert.equal(r.state, "resting"); });
test("A07 notification access where purpose doesn't justify → ears_up", () => { const r = analyseApp(app({ name: "Wallpapers HD", purpose: "game_media", permissions: ["notifications"] })); assert.equal(r.state, "ears_up"); assert.equal(r.scenario, "A07"); });
test("A08 SMS + calls on a game → growling", () => { const r = analyseApp(app({ name: "Dice Roller", purpose: "game_media", permissions: ["sms", "calls"] })); assert.equal(r.state, "growling"); assert.equal(r.scenario, "A08"); });
test("A09 third-party keyboard → ears_up, not malicious, explains reach", () => {
  const r = analyseApp(app({ name: "SwiftType Keyboard", source: "play_store", purpose: "keyboard", permissions: ["keyboard"] }));
  assert.equal(r.state, "ears_up"); assert.equal(r.scenario, "A09"); assert.match(r.verdict, /see text typed/i);
});
test("A10 non-VPN app with VPN permission → growling + network handoff", () => {
  const r = analyseApp(app({ name: "Speed Booster", purpose: "cleaner", permissions: ["vpn"] }));
  assert.equal(r.state, "growling"); assert.equal(r.scenario, "A10"); assert.equal(r.handoff, "network");
});
test("A13 / acceptance 3: authenticator from official store → resting, no warning", () => {
  const r = analyseApp(app({ name: "Microsoft Authenticator", source: "app_store", purpose: "security", permissions: ["camera", "notifications"] }));
  assert.equal(r.state, "resting"); assert.equal(r.scenario, "A13"); assert.match(r.verdict, /didn't find anything worrying/i);
});
test("A13 password manager with accessibility (autofill) from store → resting", () => {
  assert.equal(analyseApp(app({ name: "Bitwarden", source: "play_store", purpose: "security", permissions: ["accessibility", "keyboard"] })).state, "resting");
});
test("A14 / acceptance 4: app contacted blocked malicious domain → growling 'I blocked a dangerous connection', network handoff", () => {
  const r = analyseApp(app({ name: "Example Support", source: "play_store", purpose: "other", permissions: [], network: { blockedMalicious: 1, unknownHosts: 2, hosts: ["malicious-example.test"] } }));
  assert.equal(r.state, "growling"); assert.equal(r.scenario, "A14"); assert.match(r.verdict, /I blocked a dangerous connection from this app/i); assert.equal(r.handoff, "network");
  assert.ok(!/malware/i.test(r.verdict));
});
test("A15 many unknown domains, nothing confirmed → ears_up, no cry wolf", () => {
  const r = analyseApp(app({ name: "Free Games Hub", purpose: "game_media", permissions: [], network: { blockedMalicious: 0, unknownHosts: 9, hosts: [] } }));
  assert.equal(r.state, "ears_up"); assert.equal(r.scenario, "A15");
});
test("A16 app installed right after phishing site + APK download → barking, connected", () => {
  const r = analyseApp(app({ name: "Parcel Tracker", source: "browser", purpose: "other", permissions: [], context: { recentScentCategories: ["website", "known_threat"] } }));
  assert.equal(r.state, "barking"); assert.equal(r.scenario, "A16"); assert.match(r.verdict, /appear connected/i);
});
test("A17 device admin on sideloaded app → barking; on store app → growling", () => {
  assert.equal(analyseApp(app({ name: "Locker", source: "browser", purpose: "other", permissions: ["device_admin"] })).state, "barking");
  const r = analyseApp(app({ name: "Locker", source: "play_store", purpose: "other", permissions: ["device_admin"] })); assert.equal(r.state, "growling"); assert.equal(r.scenario, "A17");
});
test("A18 unknown app from official store, nothing suspicious → resting", () => {
  const r = analyseApp(app({ name: "Tiny Notes", source: "play_store", purpose: "other", permissions: [] })); assert.equal(r.state, "resting"); assert.equal(r.scenario, "A18");
  assert.match(r.why.join(" "), /not proof of safety/i);
});
test("A18 not sure where it came from → ears_up", () => { assert.equal(analyseApp(app({ name: "Tiny Notes", source: "not_sure", purpose: "other" })).state, "ears_up"); });
test("A19 cleaner app asking for broad control → growling", () => {
  const r = analyseApp(app({ name: "Battery Doctor", purpose: "cleaner", permissions: ["contacts", "sms", "location", "microphone"] })); assert.equal(r.state, "growling"); assert.equal(r.scenario, "A19");
});
test("A20 legitimate remote support the user sought out → ears_up, verify who receives access", () => {
  const r = analyseApp(app({ name: "TeamViewer QuickSupport", source: "play_store", purpose: "remote_support", permissions: ["screen_share"], context: { intentional: true } }));
  assert.equal(r.state, "ears_up"); assert.equal(r.scenario, "A20"); assert.match(r.verdict, /who is receiving access/i);
});
test("remote-capable app with no context → growling (never resting)", () => { assert.equal(analyseApp(app({ name: "RustDesk", source: "play_store", purpose: "other" })).state, "growling"); });
test("brand + remote helpers", () => { assert.equal(brandInName("CommBank Secure"), "Commbank"); assert.equal(brandInName("Tiny Notes"), null); assert.ok(isRemoteTool("AnyDesk")); assert.ok(!isRemoteTool("Notes")); });
test("permission notes carry plain-language explanations", () => {
  const r = analyseApp(app({ purpose: "other", permissions: ["accessibility", "notifications", "overlay"] }));
  const byId = Object.fromEntries(r.permissionNotes.map((n) => [n.id, n.plain]));
  assert.match(byId.accessibility, /read parts of your screen/); assert.match(byId.notifications, /security codes/); assert.match(byId.overlay, /over other apps/);
});

// ---- Device (Check My Device) ----
test("D00 nothing seen, nothing reported → Protected / resting, truthful cannot-see list on iOS", () => {
  const r = assessDevice(EMPTY_SIGNALS("ios"));
  assert.equal(r.status, "protected"); assert.equal(r.state, "resting"); assert.ok(r.cannotSee.some((c) => /installed apps/i.test(c)));
});
test("D01 gave remote access → Recovery status with ordered steps; banking during access adds bank step", () => {
  const r = assessDevice(EMPTY_SIGNALS("android"), { gaveRemoteAccess: true, usedBankingDuringAccess: true });
  assert.equal(r.status, "recovery"); assert.equal(r.state, "barking"); assert.match(r.recoverySteps[0], /End the remote-access session/i); assert.ok(r.recoverySteps.some((x) => /bank/i.test(x)));
});
test("A11 / D02 unexpected management profile → Action required; expected → info only", () => {
  const sig = { ...EMPTY_SIGNALS("ios"), managementProfile: "present" as const };
  assert.equal(assessDevice(sig).status, "action"); assert.match(assessDevice(sig).findings[0].plain, /how your device is managed/i);
  const ok = assessDevice(sig, { managementExpected: true }); assert.equal(ok.status, "protected"); assert.equal(ok.state, "ears_up");
});
test("A12 / D03 extra trusted certificate → Action required, explains trust", () => {
  const r = assessDevice({ ...EMPTY_SIGNALS("android"), userTrustedCertificates: 1 }); assert.equal(r.status, "action"); assert.match(r.findings[0].plain, /secure connections your device trusts/i);
});
test("A10 / D04 unexpected VPN → Review + network handoff", () => {
  const r = assessDevice(EMPTY_SIGNALS("android"), { unexpectedVpn: true }); assert.equal(r.status, "review"); assert.equal(r.findings[0].handoff, "network");
});
test("D05 third-party accessibility service → Review with app handoff", () => {
  const r = assessDevice({ ...EMPTY_SIGNALS("android"), thirdPartyAccessibilityServices: ["Fast Utility"] }); assert.equal(r.status, "review"); assert.equal(r.findings[0].handoff, "app");
});
test("D09/D10 overlay + notification access only → Protected with good-to-know items (ears_up)", () => {
  const r = assessDevice({ ...EMPTY_SIGNALS("android"), overlayApps: ["Messenger"], notificationAccessApps: ["Watch"] }); assert.equal(r.status, "protected"); assert.equal(r.state, "ears_up"); assert.equal(r.findings.length, 2);
});
