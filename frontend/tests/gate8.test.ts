// Gate 8 scenario benchmark (Network N01–N12, Account AC01–AC20). Run: yarn test:gate8
import assert from "node:assert/strict";
import { test } from "node:test";

import { analyseAccountAlert, isOfficialHost, type AccountInput } from "../src/domain/accountAnalysis.ts";
import { analyseNetwork, ssidMatches, type NetworkInput } from "../src/domain/networkAnalysis.ts";
import type { NetworkStatus } from "../src/security/SecurityPlatformAdapter";
import { summariseNetworkEvents } from "../src/domain/networkAnalysis.ts";

const wifi = (over: Partial<NetworkStatus> = {}): NetworkStatus => ({ connected: true, type: "wifi", isInternetReachable: true, inspectable: true, wifiSecurity: "wpa", captivePortal: false, vpnActive: false, ssid: "Home-5G", checkedAt: new Date().toISOString(), ...over });
const net = (over: Partial<NetworkInput> = {}): NetworkInput => ({ status: wifi(), context: "unknown", trustedSsids: [], vpnTrusted: null, ...over });

// ---- Network Guard ----
test("N01 home Wi‑Fi → resting, no warning", () => { const r = analyseNetwork(net({ context: "home" })); assert.equal(r.state, "resting"); assert.equal(r.scenario, "N01"); });
test("N01 trusted SSID → resting even with unknown context", () => { assert.equal(analyseNetwork(net({ trustedSsids: ["Home-5G"] })).state, "resting"); });
test("N02 / acceptance 2: airport Wi‑Fi → ears_up with the exact calm message", () => {
  const r = analyseNetwork(net({ status: wifi({ ssid: "SYD-Airport-Free", wifiSecurity: "unknown" }), context: "public" }));
  assert.equal(r.state, "ears_up"); assert.equal(r.scenario, "N02"); assert.match(r.verdict, /You're on public Wi‑Fi\. I'll keep a closer watch while you're connected\./);
});
test("N03 lookalike SSID → ears_up, can't confirm same network", () => {
  const r = analyseNetwork(net({ status: wifi({ ssid: "Hotel-Guest-Free" }), context: "public", expectedName: "Hotel_Guest" }));
  assert.equal(r.state, "ears_up"); assert.equal(r.scenario, "N03"); assert.match(r.verdict, /looks similar/i);
  assert.equal(ssidMatches("Hotel_Guest", "Hotel Guest"), "same"); assert.equal(ssidMatches("Hotel-Guest-Free", "Hotel_Guest"), "lookalike"); assert.equal(ssidMatches("CafeNet", "Hotel_Guest"), "different");
});
test("N04 open Wi‑Fi → ears_up, does not claim interception", () => {
  const r = analyseNetwork(net({ status: wifi({ wifiSecurity: "open" }), context: "public" })); assert.equal(r.state, "ears_up"); assert.equal(r.scenario, "N04"); assert.match(r.verdict, /doesn't mean anyone is listening/);
});
test("N05 captive portal with page address → growling + web handoff", () => {
  const r = analyseNetwork(net({ status: wifi({ captivePortal: true }), captiveUrl: "http://hotel-wifi-login.top/auth" })); assert.equal(r.state, "growling"); assert.equal(r.handoff, "web");
});
test("N06/N12 / acceptance 1: SDK blocked malicious destination → Guarding (biting), calm 'I blocked a dangerous connection', no bark", () => {
  const r = analyseNetwork(net({ context: "home", sdk: { blockedMalicious: 1, c2Apps: [], unknownHosts: 0, dnsChanged: false, vpnChangedRecently: false } }));
  assert.equal(r.state, "biting"); assert.match(r.verdict, /I blocked a dangerous connection\. No action needed\./);
});
test("N07 C2 traffic from an app → barking + app handoff", () => {
  const r = analyseNetwork(net({ sdk: { blockedMalicious: 3, c2Apps: ["Example Support"], unknownHosts: 0, dnsChanged: false, vpnChangedRecently: false } })); assert.equal(r.state, "barking"); assert.equal(r.handoff, "app"); assert.match(r.verdict, /Example Support/);
});
test("N08 DNS change alone → ears_up; after app event → growling", () => {
  const sdk = { blockedMalicious: 0, c2Apps: [], unknownHosts: 0, dnsChanged: true, vpnChangedRecently: false };
  assert.equal(analyseNetwork(net({ sdk })).state, "ears_up"); assert.equal(analyseNetwork(net({ sdk, recentScentCategories: ["app"] })).state, "growling");
});
test("N09 VPN on after suspicious app install → growling + app handoff", () => {
  const r = analyseNetwork(net({ status: wifi({ vpnActive: true }), recentScentCategories: ["app"] })); assert.equal(r.state, "growling"); assert.equal(r.scenario, "N09"); assert.equal(r.handoff, "app");
});
test("N10 / acceptance 5: trusted VPN the user turned on → resting", () => {
  const r = analyseNetwork(net({ status: wifi({ vpnActive: true }), vpnTrusted: true, context: "public" })); assert.equal(r.state, "resting"); assert.equal(r.scenario, "N10");
});
test("VPN on, not sure who started it → ears_up (not growl)", () => { assert.equal(analyseNetwork(net({ status: wifi({ vpnActive: true }) })).state, "ears_up"); });
test("N11 many unknown destinations → ears_up, no malware claim", () => {
  const r = analyseNetwork(net({ context: "home", sdk: { blockedMalicious: 0, c2Apps: [], unknownHosts: 7, dnsChanged: false, vpnChangedRecently: false } })); assert.equal(r.state, "ears_up"); assert.ok(!/malware/i.test(r.verdict));
});
test("mobile data → resting; offline → resting N00", () => {
  assert.equal(analyseNetwork(net({ status: wifi({ type: "cellular", ssid: null, wifiSecurity: "n/a" }) })).state, "resting");
  assert.equal(analyseNetwork(net({ status: wifi({ connected: false }) })).scenario, "N00");
});
test("summariseNetworkEvents folds SDK events", () => {
  const now = new Date().toISOString();
  const s = summariseNetworkEvents([{ eventType: "blocked_destination", domain: "bad.test", appName: null, verdict: "malicious", blocked: true, occurredAt: now, relatedThreatScent: null }, { eventType: "c2_traffic", domain: "c2.test", appName: "Evil", verdict: "malicious", blocked: true, occurredAt: now, relatedThreatScent: null }, { eventType: "dns_change", domain: null, appName: null, verdict: "unknown", blocked: false, occurredAt: now, relatedThreatScent: null }]);
  assert.equal(s.blockedMalicious, 1); assert.deepEqual(s.c2Apps, ["Evil"]); assert.equal(s.dnsChanged, true);
});

// ---- Account Guard ----
const acc = (over: Partial<AccountInput>): AccountInput => ({ kind: "other", provider: "other", userInitiated: null, ...over });
test("AC01 / acceptance 3: MFA prompt without logging in → barking 'Don't approve this login', stay with me", () => {
  const r = analyseAccountAlert(acc({ kind: "mfa_prompt", provider: "microsoft", userInitiated: false }));
  assert.equal(r.state, "barking"); assert.equal(r.scenario, "AC01"); assert.match(r.verdict, /Don't approve this login\. Someone may already know your password\./); assert.equal(r.stayWithMe, true); assert.equal(r.takeoverRisk, "very_high");
});
test("AC01 not sure → growling, deny anyway", () => { const r = analyseAccountAlert(acc({ kind: "mfa_prompt", provider: "google", userInitiated: null })); assert.equal(r.state, "growling"); assert.match(r.verdict, /don't approve/i); });
test("AC02 repeated prompts → barking MFA fatigue", () => { const r = analyseAccountAlert(acc({ kind: "mfa_prompt", provider: "microsoft", userInitiated: false, repeated: true })); assert.equal(r.scenario, "AC02"); assert.equal(r.state, "barking"); });
test("AC20 / acceptance 6: MFA prompt right after own Microsoft login → resting", () => {
  const r = analyseAccountAlert(acc({ kind: "mfa_prompt", provider: "microsoft", userInitiated: true })); assert.equal(r.state, "resting"); assert.equal(r.scenario, "AC20");
});
test("AC04 fake password reset with off-domain link → barking + web handoff", () => {
  const r = analyseAccountAlert(acc({ kind: "password_reset", provider: "microsoft", userInitiated: null, text: "Your Microsoft password must be reset within 24 hours: https://microsoft-reset-secure.top/x" }));
  assert.equal(r.state, "barking"); assert.equal(r.scenario, "AC04"); assert.equal(r.handoff, "web"); assert.deepEqual(r.suspiciousUrls, ["https://microsoft-reset-secure.top/x"]);
});
test("AC05 genuine reset the user requested, official domain → resting", () => {
  const r = analyseAccountAlert(acc({ kind: "password_reset", provider: "microsoft", userInitiated: true, text: "Reset your password: https://account.live.com/password/reset?code=abc" }));
  assert.equal(r.state, "resting"); assert.equal(r.scenario, "AC05"); assert.equal(r.suspiciousUrls.length, 0);
});
test("AC06 password reset not requested (official) → growling; password *changed* not by me → barking", () => {
  assert.equal(analyseAccountAlert(acc({ kind: "password_reset", provider: "google", userInitiated: false })).state, "growling");
  const r = analyseAccountAlert(acc({ kind: "password_changed", provider: "google", userInitiated: false })); assert.equal(r.state, "barking"); assert.match(r.verdict, /If you didn't make this change, secure the account through/);
});
test("AC07 new device login: expected → resting; unexpected → ears_up", () => {
  assert.equal(analyseAccountAlert(acc({ kind: "login_alert", provider: "apple", userInitiated: true })).state, "resting");
  const r = analyseAccountAlert(acc({ kind: "login_alert", provider: "apple", userInitiated: false })); assert.equal(r.state, "ears_up"); assert.equal(r.scenario, "AC07");
});
test("AC08 unusual location → ears_up (no overclaim); with prior phishing → growling", () => {
  assert.equal(analyseAccountAlert(acc({ kind: "login_alert", provider: "google", userInitiated: null, unusualLocation: true })).scenario, "AC08");
  assert.equal(analyseAccountAlert(acc({ kind: "login_alert", provider: "google", userInitiated: false, unusualLocation: true, recentScentCategories: ["message"] })).state, "growling");
});
test("AC09 breach notice → ears_up; mentions passwords → growling", () => {
  assert.equal(analyseAccountAlert(acc({ kind: "breach_notice", provider: "other", text: "Your email appeared in a data breach." })).state, "ears_up");
  assert.equal(analyseAccountAlert(acc({ kind: "breach_notice", provider: "other", text: "Breach included email addresses and passwords." })).state, "growling");
});
test("AC11 entered password on suspicious page → barking + Stay With Me (password recovery)", () => {
  const r = analyseAccountAlert(acc({ kind: "other", provider: "bank", enteredPassword: true, recentScentCategories: ["message", "website"] })); assert.equal(r.state, "barking"); assert.equal(r.stayWithMe, true); assert.ok(r.recoveryKinds.includes("password"));
});
test("AC12 code entered → barking very_high, takeover in progress", () => {
  const r = analyseAccountAlert(acc({ kind: "mfa_prompt", provider: "bank", enteredCode: true, userInitiated: false })); assert.equal(r.scenario, "AC12"); assert.equal(r.takeoverRisk, "very_high"); assert.match(r.verdict, /takeover in progress/i);
});
test("AC14 recovery email changed unexpectedly → barking", () => { const r = analyseAccountAlert(acc({ kind: "recovery_changed", provider: "google", userInitiated: false })); assert.equal(r.state, "barking"); assert.equal(r.scenario, "AC14"); });
test("AC15 fake Google security alert with off-domain link → barking", () => {
  const r = analyseAccountAlert(acc({ kind: "security_alert", provider: "google", text: "Google: suspicious sign-in blocked. Secure your account now https://google-security-check.com/verify" }));
  assert.equal(r.state, "barking"); assert.equal(r.scenario, "AC15");
});
test("AC16 genuine security alert on official domain → ears_up, not a scam", () => {
  const r = analyseAccountAlert(acc({ kind: "security_alert", provider: "google", text: "New sign-in on Windows. Review activity: https://myaccount.google.com/notifications" }));
  assert.equal(r.state, "ears_up"); assert.equal(r.scenario, "AC16"); assert.match(r.verdict, /isn't a scam/);
});
test("AC17 / acceptance 4: real bank MFA prompt after fake bank SMS + credentials → barking + Stay With Me", () => {
  const r = analyseAccountAlert(acc({ kind: "mfa_prompt", provider: "bank", userInitiated: false, recentScentCategories: ["message", "website"], recentScentBrand: "CommBank" }));
  assert.equal(r.state, "barking"); assert.equal(r.stayWithMe, true); assert.ok(r.why.some((w) => /Threat Scent/.test(w)));
});
test("AC18 locked out → barking + Stay With Me (locked_out recovery)", () => { const r = analyseAccountAlert(acc({ kind: "locked_out", provider: "microsoft" })); assert.equal(r.stayWithMe, true); assert.ok(r.recoveryKinds.includes("locked_out")); });
test("AC19 unknown notification, nothing suspicious → ears_up, verify officially", () => { const r = analyseAccountAlert(acc({ kind: "other", provider: "other", text: "Your account activity summary is ready." })); assert.equal(r.state, "ears_up"); assert.equal(r.scenario, "AC19"); });
test("official host matching", () => { assert.ok(isOfficialHost("account.live.com", ["live.com"])); assert.ok(!isOfficialHost("live.com.evil.top", ["live.com"])); assert.ok(!isOfficialHost("notlive.com", ["live.com"])); });
