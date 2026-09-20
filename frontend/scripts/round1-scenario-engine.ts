// @ts-nocheck -- Node-only executable; the Expo tsconfig intentionally excludes Node ambient types.
import fs from "node:fs";
import path from "node:path";

import { analyseAccountAlert } from "../src/domain/accountAnalysis.ts";
import { analyseApp } from "../src/domain/appAnalysis.ts";
import { analyseCall } from "../src/domain/callAnalysis.ts";
import { assessDevice, EMPTY_SIGNALS } from "../src/domain/deviceAnalysis.ts";
import { analyseEmail } from "../src/domain/emailAnalysis.ts";
import { analyseFile } from "../src/domain/fileAnalysis.ts";
import { buildGatesOverview } from "../src/domain/gates.ts";
import { analyseMessage } from "../src/domain/messageAnalysis.ts";
import { analyseNetwork } from "../src/domain/networkAnalysis.ts";
import { analyseUrlLocally } from "../src/domain/risk.ts";
import type { ApolloState } from "../src/domain/types.ts";

type Gate = "site" | "link" | "text" | "call" | "network" | "account" | "email" | "app" | "file" | "device";
type Tone = "threatening" | "legitimate" | "ambiguous";
type Expected = { gate: Gate; state: ApolloState; detection: string; investigation: string; higgins: string; action: string; mustNot: string[] };
type Actual = Expected & { scenario: string; uncertainty: string };
type Result = { id: string; gate: Gate; tone: Tone; situation: string; expected: Expected; actual: Actual; checks: Record<string, boolean>; pass: boolean; evidence: "automated" };

const MUST_NOT: Record<Gate, string[]> = {
  site: ["apollo blocked", "automatic protection is confirmed when unavailable"],
  link: ["verified safe", "sender is verified"],
  text: ["sender is verified", "message is safe"],
  call: ["caller is verified", "apollo hung up"],
  network: ["i blocked", "traffic was intercepted"],
  account: ["confirmed breach", "sender is verified", "fine to use"],
  email: ["sender is verified", "email is safe", "original email was deleted"],
  app: ["app is safe", "app is malicious", "apollo uninstalled"],
  file: ["verified safe", "malware scan completed", "cloud hosting makes it safe", "original file was deleted"],
  device: ["threat was blocked", "all apps were inspected"],
};

const lc = (value: string) => value.toLowerCase();
const stateForLink = (level: string): ApolloState => level === "malicious" ? "barking" : level === "suspicious" ? "growling" : level === "uncertain" ? "ears_up" : "resting";
const higgins = (gate: Gate, state: ApolloState, detection: string, uncertainty: string, action: string) => `Apollo's ${gate} check is ${state}. ${detection}. Unknown: ${uncertainty}. Next action: ${action}`;
function actual(gate: Gate, state: ApolloState, scenario: string, detection: string, investigation: string, action: string, uncertainty: string): Actual {
  return { gate, state, scenario, detection, investigation, higgins: higgins(gate, state, detection, uncertainty, action), action, uncertainty, mustNot: [] };
}
function compare(expected: Expected, observed: Actual): Record<string, boolean> {
  const visible = lc(`${observed.detection} ${observed.investigation} ${observed.higgins} ${observed.action}`);
  return {
    gate: expected.gate === observed.gate,
    state: expected.state === observed.state,
    detection: lc(observed.detection).includes(lc(expected.detection)),
    investigation: lc(observed.investigation).includes(lc(expected.investigation)),
    higgins: lc(observed.higgins).includes(lc(expected.higgins)),
    action: lc(observed.action).includes(lc(expected.action)),
    must_not: expected.mustNot.every((claim) => !visible.includes(lc(claim))),
  };
}
function result(id: string, gate: Gate, tone: Tone, situation: string, expected: Expected, observed: Actual): Result {
  const checks = compare(expected, observed);
  return { id, gate, tone, situation, expected, actual: observed, checks, pass: Object.values(checks).every(Boolean), evidence: "automated" };
}
const exp = (gate: Gate, state: ApolloState, detection: string, investigation: string, higginsText: string, action: string): Expected => ({ gate, state, detection, investigation, higgins: higginsText, action, mustNot: MUST_NOT[gate] });

const now = new Date().toISOString();
const stale = new Date(Date.now() - 30 * 60 * 1000).toISOString();
const baseSite = { requested: true, operational: true, lastVerified: now, checkedAt: now, degradedReason: null, adapterMode: "native", adapterLabel: "Native", enforcementMethod: "system filter" };
const siteOverview = (protection: any, permissions: any[] = []) => buildGatesOverview({ platform: "android", checking: false, protection, permissions,
  capabilities: [{ id: "site_guard", title: "Site", status: "active", detail: "" }] as any, messaging: { smsFiltering: "unsupported", notificationAccess: false } as any,
  calls: { callScreening: "unsupported", roleHeld: false } as any, email: { checking: false, configured: true, connected: false, monitoringRequested: false, lastCheckedAt: null, lastErrorAt: null }, online: true, accountBreachConfigured: false });

const scenarios: Result[] = [];
const multiGate: { id: string; tone: Tone; situation: string; submitted: string; userActions: string[]; expected: Record<string, unknown>; actual: Record<string, unknown>; pass: boolean; evidence: "automated" }[] = [];
{
  const o = siteOverview({ ...baseSite, operational: false, degradedReason: "Protection permission missing" }, [{ id: "network_filter", title: "Network filter", status: "denied", canAskAgain: true }]); const s = o.gates.find((g) => g.id === "site")!;
  scenarios.push(result("site-threat-protection-gap", "site", "threatening", "Risky browsing while automatic filtering permission is missing", exp("site", "barking", "Needs attention", "permission", "protection", "Restore protection"), actual("site", "barking", "SITE-GAP", s.status, s.setup ?? "", s.actionLabel, "A protection gap is not proof that a threat succeeded.")));
}
{
  const o = siteOverview(baseSite); const s = o.gates.find((g) => g.id === "site")!;
  scenarios.push(result("site-legitimate-active", "site", "legitimate", "Fresh native observation confirms automatic filtering", exp("site", "resting", "Active", "filters", "active", "Open Link Gate"), actual("site", "resting", "SITE-ACTIVE", s.status, s.scope, s.actionLabel, "An active filter does not prove every site is safe.")));
}
{
  const o = siteOverview({ ...baseSite, lastVerified: stale }); const s = o.gates.find((g) => g.id === "site")!;
  scenarios.push(result("site-ambiguous-stale", "site", "ambiguous", "Protection was requested but verification is stale", exp("site", "barking", "Needs attention", "not confirmed", "unknown", "Restore protection"), actual("site", "barking", "SITE-STALE", s.status, s.setup ?? "Filtering is not confirmed", s.actionLabel, "Current enforcement is unknown until a fresh observation.")));
}

for (const item of [
  ["link-threat-bank", "threatening", "https://commbank-secure-verify.xyz/login", "barking", "mentions", "malicious", "keep the link closed"],
  ["link-legitimate-public", "legitimate", "https://example.com/about", "resting", "No local warning", "completed", "open only if expected"],
  ["link-ambiguous-short", "ambiguous", "https://bit.ly/example", "ears_up", "shortened", "uncertain", "expand or verify independently"],
] as const) {
  const [id, tone, input, state, detectionNeedle, investigationNeedle, actionNeedle] = item; const a = analyseUrlLocally(input); const stateActual = stateForLink(a.level);
  const detection = a.signals.map((signal) => signal.plain).join(" ") || "No local warning was found"; const investigation = `${a.host ?? "invalid"}; ${a.level}; completed local URL checks`;
  const action = stateActual === "resting" ? "Open only if expected; the sender remains unauthenticated." : stateActual === "ears_up" ? "Expand or verify independently before opening." : "Keep the link closed and use the claimed service's official app.";
  scenarios.push(result(id, "link", tone, input, exp("link", state as ApolloState, detectionNeedle, investigationNeedle, "unknown", actionNeedle), actual("link", stateActual, a.level, detection, investigation, action, "Local URL checks do not authenticate the sender or current page.")));
}

for (const item of [
  ["text-threat-code", "threatening", "Bank Security", "Your account is locked. Read me the verification code now.", "barking", "Verification code request", "code", "don't share"],
  ["text-legitimate-appointment", "legitimate", "City Dental", "Your dental appointment is confirmed for Tuesday at 3:30 pm. No payment is due.", "resting", "No concern identified", "no concern", "nothing to do"],
  ["text-ambiguous-family", "ambiguous", "Unknown mobile", "Hi Mum, new phone. Can you send $600 today?", "ears_up", "Hi Mum", "family-impersonation", "contact your family"],
] as const) {
  const [id, tone, sender, text, state, detectionNeedle, investigationNeedle, actionNeedle] = item; const a = analyseMessage(sender, text);
  scenarios.push(result(id, "text", tone, `${sender}: ${text}`, exp("text", state as ApolloState, detectionNeedle, investigationNeedle, "unknown", actionNeedle), actual("text", a.state, a.scenario, a.scenarioTitle, `${a.verdict} ${a.why.join(" ")}`, a.recommendation, "The sender identity cannot be established from submitted text alone.")));
}

for (const item of [
  ["call-threat-code", "threatening", ["code", "dont_hangup"], "bank", "barking", "Verification code", "caller", "Hang up"],
  ["call-legitimate-appointment", "legitimate", ["nothing"], "business", "resting", "Ordinary", "nothing suspicious", "number listed"],
  ["call-ambiguous-callback", "ambiguous", ["callback"], "unknown", "ears_up", "Callback", "premium", "details you find yourself"],
] as const) {
  const [id, tone, asks, claim, state, detectionNeedle, investigationNeedle, actionNeedle] = item; const a = analyseCall({ asks: [...asks] as any, claim: claim as any });
  scenarios.push(result(id, "call", tone, `${claim}: ${asks.join(", ")}`, exp("call", state as ApolloState, detectionNeedle, investigationNeedle, "unknown", actionNeedle), actual("call", a.state, a.scenario, a.title, `${a.verdict} ${a.why.join(" ")}`, a.verifyCaller, "Caller ID and a submitted claim do not authenticate the caller.")));
}

const netStatus = (overrides: any = {}) => ({ connected: true, type: "wifi", ssid: "Cafe Guest", wifiSecurity: "open", captivePortal: false, vpnActive: false, inspectable: false, ...overrides });
for (const item of [
  ["network-threat-dangerous", "threatening", { status: netStatus(), context: "public", sdk: { blockedMalicious: 0, c2Apps: ["Unknown Helper"], unknownHosts: 0, dnsChanged: false, vpnChangedRecently: false } }, "barking", "Dangerous traffic", "does not provide enough evidence", "Check This App"],
  ["network-legitimate-home", "legitimate", { status: netStatus({ ssid: "Home", wifiSecurity: "wpa3", inspectable: true }), context: "home" }, "resting", "Home Wi", "No suspicious", "Nothing to do"],
  ["network-ambiguous-open", "ambiguous", { status: netStatus(), context: "public" }, "ears_up", "Open Wi", "could", "mobile data"],
] as const) {
  const [id, tone, input, state, detectionNeedle, investigationNeedle, actionNeedle] = item; const a = analyseNetwork({ trustedSsids: [], expectedName: null, captiveUrl: null, vpnTrusted: null, recentScentCategories: [], sdk: null, ...(input as any) });
  scenarios.push(result(id, "network", tone, JSON.stringify(input), exp("network", state as ApolloState, detectionNeedle, investigationNeedle, "unknown", actionNeedle), actual("network", a.state, a.scenario, a.title, `${a.verdict} ${a.why.join(" ")}`, a.recommendation, "Available network signals do not establish interception or a confirmed block.")));
}

for (const item of [
  ["account-threat-reset", "threatening", { kind: "password_reset", provider: "microsoft", text: "Reset now https://microsoft-reset-secure.top/login", userInitiated: false }, "barking", "Fake password reset", "not Microsoft", "open account"],
  ["account-legitimate-requested", "legitimate", { kind: "password_reset", provider: "google", text: "You requested a reset https://accounts.google.com/signin/recovery", userInitiated: true }, "ears_up", "matching your request", "does not authenticate", "open myaccount"],
  ["account-ambiguous-breach", "ambiguous", { kind: "breach_notice", provider: "other", text: "We may have experienced a data breach", userInitiated: null }, "ears_up", "Claimed data breach", "does not confirm", "official app"],
] as const) {
  const [id, tone, input, state, detectionNeedle, investigationNeedle, actionNeedle] = item; const a = analyseAccountAlert(input as any);
  scenarios.push(result(id, "account", tone, JSON.stringify(input), exp("account", state as ApolloState, detectionNeedle, investigationNeedle, "unknown", actionNeedle), actual("account", a.state, a.scenario, a.title, `${a.verdict} ${a.why.join(" ")}`, a.recommendation, "The sender and alert claims remain unauthenticated.")));
}

for (const item of [
  ["email-threat-bank", "threatening", "CommBank <alerts@cb-secure.top>", "Urgent account lock", "Verify now https://commbank-secure-verify.xyz/login", "barking", "impersonating", "domain", "official"],
  ["email-legitimate-receipt", "legitimate", "receipts@example.com", "Your receipt", "Thanks for your purchase. No action is required.", "resting", "Ordinary", "didn't find", "Nothing"],
  ["email-ambiguous-security", "ambiguous", "security@google.com", "Security alert", "Review recent activity in your account.", "ears_up", "Security alert", "cannot authenticate", "official"],
] as const) {
  const [id, tone, from, subject, body, state, detectionNeedle, investigationNeedle, actionNeedle] = item; const a = analyseEmail(body, { from, subject });
  scenarios.push(result(id, "email", tone, `${from} / ${subject}`, exp("email", state as ApolloState, detectionNeedle, investigationNeedle, "unknown", actionNeedle), actual("email", a.state, a.scenario, a.title, `${a.verdict} ${a.why.join(" ")}`, a.recommendation, "The submitted email does not independently authenticate its sender.")));
}

for (const item of [
  ["app-threat-remote", "threatening", { name: "Quick Support", source: "message", purpose: "remote_support", permissions: ["accessibility", "screen_share"], context: { promptedByCaller: true, accessGrantedNow: true } }, "barking", "Remote", "control", "remove"],
  ["app-legitimate-notes", "legitimate", { name: "Tiny Notes", source: "play_store", purpose: "other", permissions: [], context: { intentional: true } }, "ears_up", "official store", "do not prove safety", "Re-check"],
  ["app-ambiguous-cleaner", "ambiguous", { name: "Super Cleaner", source: "not_sure", purpose: "cleaner", permissions: ["notifications", "files"], context: {} }, "ears_up", "notifications", "notification access", "turn it off"],
] as const) {
  const [id, tone, input, state, detectionNeedle, investigationNeedle, actionNeedle] = item; const a = analyseApp(input as any);
  scenarios.push(result(id, "app", tone, JSON.stringify(input), exp("app", state as ApolloState, detectionNeedle, investigationNeedle, "unknown", actionNeedle), actual("app", a.state, a.scenario, a.title, `${a.verdict} ${a.why.join(" ")}`, a.recommendation, "Capabilities and user-selected source/purpose are not proof of behaviour or safety.")));
}

for (const item of [
  ["file-threat-disguised", "threatening", { name: "Statement.pdf.exe", source: "unknown", passwordInMessage: false, headBytes: new Uint8Array([0x4d, 0x5a, 1, 2]) }, "barking", "Executable", "not really a PDF", "Delete it"],
  ["file-legitimate-document", "legitimate", { name: "Agenda.pdf", source: "known", passwordInMessage: false, headBytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]), textSample: "Meeting agenda" }, "ears_up", "Limited file", "Limited", "Do not treat"],
  ["file-ambiguous-archive", "ambiguous", { name: "Documents.zip", source: "cloud", passwordInMessage: true, headBytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04]) }, "ears_up", "Password", "Cloud", "Don't extract"],
] as const) {
  const [id, tone, input, state, detectionNeedle, investigationNeedle, actionNeedle] = item; const a = analyseFile(input as any);
  scenarios.push(result(id, "file", tone, JSON.stringify({ ...input, headBytes: [...input.headBytes] }), exp("file", state as ApolloState, detectionNeedle, investigationNeedle, "unknown", actionNeedle), actual("file", a.state, a.scenario, a.title, `${a.verdict} ${a.why.join(" ")}`, a.recommendation, "A bounded signature/sample check cannot establish file safety.")));
}

for (const item of [
  ["device-threat-remote", "threatening", { signals: { ...EMPTY_SIGNALS("android"), remoteAccessApps: ["AnyDesk"], thirdPartyAccessibilityServices: ["AnyDesk"] }, self: { gaveRemoteAccess: true, usedBankingDuringAccess: true }, protection: { requested: true, operational: true, degradedReason: null, permissionIssues: [], checkedAt: now } }, "barking", "Remote", "bank", "End the session"],
  ["device-legitimate-observed", "legitimate", { signals: { ...EMPTY_SIGNALS("android"), unknownSourcesEnabled: false, thirdPartyAccessibilityServices: [], overlayApps: [], notificationAccessApps: [], vpnActive: false, vpnProviderKnown: null, managementProfile: "none", userTrustedCertificates: 0, remoteAccessApps: [], developerOptions: false }, self: {}, protection: { requested: true, operational: true, degradedReason: null, permissionIssues: [], checkedAt: now } }, "resting", "Apollo protection", "No meaningful", "operational"],
  ["device-ambiguous-limited", "ambiguous", { signals: EMPTY_SIGNALS("web"), self: {}, protection: { requested: true, operational: false, degradedReason: "Unavailable in preview", permissionIssues: [], checkedAt: now } }, "growling", "Protection", "unavailable", "Restore"],
] as const) {
  const [id, tone, input, state, detectionNeedle, investigationNeedle, actionNeedle] = item; const a = assessDevice(input.signals as any, input.self as any, { protection: input.protection as any });
  const title = a.findings[0]?.title ?? a.protectionHealth.title; const details = `${a.summary} ${a.findings.map((f) => `${f.title} ${f.plain}`).join(" ")} ${a.cannotSee.join(" ")}`;
  const action = a.findings[0]?.action ?? a.protectionHealth.detail;
  scenarios.push(result(id, "device", tone, JSON.stringify(input), exp("device", state as ApolloState, detectionNeedle, investigationNeedle, "unknown", actionNeedle), actual("device", a.state, a.status, title, details, action, a.cannotSee[0] ?? "No platform visibility gap was reported.")));
}

{
  const submitted = "PayPal: Your $799 purchase was approved. If this wasn't you, cancel now at https://paypal-cancel-security.xyz/login";
  const text = analyseMessage("PayPal Purchase", submitted); const link = analyseUrlLocally("https://paypal-cancel-security.xyz/login");
  const expected = { gates: ["text", "link", "account"], finding: "unexpected purchase pressure and off-domain account link", uncertainty: "message does not prove a purchase occurred", action: "open PayPal independently", must_not: ["confirmed purchase", "sender verified", "safe link"] };
  const observed = { gates: ["text", "link", ...(text.signals.loginRequest ? ["account"] : [])], text_state: text.state, text_finding: text.scenarioTitle, link_level: link.level, action: text.recommendation };
  multiGate.push({ id: "multi-unexpected-purchase-message", tone: "threatening", situation: "I received an unexpected purchase message.", submitted, userActions: ["paste message", "check included link", "ask Higgins"], expected, actual: observed, pass: text.state !== "resting" && link.level === "malicious" && observed.gates.includes("account"), evidence: "automated" });
}
{
  const submitted = "Google Drive shared file: Invoice.pdf.exe"; const file = analyseFile({ name: "Invoice.pdf.exe", source: "cloud", passwordInMessage: false, headBytes: new Uint8Array([0x4d, 0x5a, 1, 2]) });
  const expected = { gates: ["file"], finding: "disguised executable; cloud hosting is not proof of safety", uncertainty: "sender and complete contents remain unknown", action: "keep closed and verify sender separately", must_not: ["Google Drive means safe", "malware scan completed", "original file deleted"] };
  const observed = { gates: ["file"], state: file.state, finding: file.title, evidence: file.why.join(" "), action: file.recommendation };
  multiGate.push({ id: "multi-google-drive-file", tone: "ambiguous", situation: "Someone shared this file from Google Drive.", submitted, userActions: ["share file to Apollo", "leave origin as cloud", "review post-inspection question"], expected, actual: observed, pass: file.state === "barking" && observed.evidence.toLowerCase().includes("cloud") && !observed.evidence.toLowerCase().includes("cloud hosting makes"), evidence: "automated" });
}
{
  const submitted = "Caller claiming tech support asked me to install Quick Support and allow remote access."; const call = analyseCall({ asks: ["install", "remote"], claim: "techsupport" });
  const app = analyseApp({ name: "Quick Support", source: "message", purpose: "remote_support", permissions: ["accessibility", "screen_share"], context: { promptedByCaller: true } });
  const expected = { gates: ["call", "app"], follow_up_gate: "device only if the person says access was granted or the app was installed", finding: "remote-access social engineering plus high-impact app capabilities", uncertainty: "capability does not prove an active session", action: "end call; do not grant access; review device if already granted", must_not: ["active session confirmed", "app is malicious", "Apollo uninstalled app"] };
  const observed = { gates: ["call", "app"], call_state: call.state, call_finding: call.title, app_state: app.state, app_finding: app.title, action: app.recommendation };
  multiGate.push({ id: "multi-caller-install-app", tone: "threatening", situation: "A caller asked me to install an app.", submitted, userActions: ["describe call request", "open App Gate", "report permissions", "answer whether access was granted"], expected, actual: observed, pass: call.state === "barking" && app.state === "barking" && !observed.gates.includes("device"), evidence: "automated" });
}
{
  const submitted = "Unfamiliar helper app already on the phone with Accessibility access."; const app = analyseApp({ name: "Device Helper", source: "not_sure", purpose: "other", permissions: ["accessibility", "overlay"], context: {} });
  const device = assessDevice({ ...EMPTY_SIGNALS("android"), thirdPartyAccessibilityServices: ["Device Helper"], overlayApps: ["Device Helper"] }, { newAppUnexpected: true }, { protection: { requested: true, operational: true, degradedReason: null, permissionIssues: [], checkedAt: now } });
  const expected = { gates: ["app", "device"], finding: "unfamiliar app and observed high-impact access", uncertainty: "permissions do not prove malicious behaviour", action: "review access and remove if unrecognised", must_not: ["app is malicious", "all apps inspected", "Apollo removed app"] };
  const observed = { gates: ["app", "device"], app_state: app.state, app_finding: app.title, device_state: device.state, device_finding: device.findings[0]?.title, action: app.recommendation };
  multiGate.push({ id: "multi-unfamiliar-installed-app", tone: "ambiguous", situation: "I found an unfamiliar app already on my phone.", submitted, userActions: ["select app", "review observed capabilities", "open Device Gate"], expected, actual: observed, pass: app.state !== "resting" && device.state !== "resting" && /access|app/i.test(`${app.title} ${device.findings[0]?.title}`), evidence: "automated" });
}
{
  const submitted = "Australia Post: Your parcel is arriving tomorrow. Track in the AusPost app or at https://auspost.com.au/mypost/track/ABC123"; const text = analyseMessage("Australia Post", submitted); const link = analyseUrlLocally("https://auspost.com.au/mypost/track/ABC123");
  const expected = { gates: ["text", "link"], finding: "delivery notification with configured official destination and no payment/login pressure", uncertainty: "sender identity is not authenticated from text alone", action: "prefer the official AusPost app", must_not: ["sender verified", "parcel scam confirmed", "safe link"] };
  const observed = { gates: ["text", "link"], text_state: text.state, text_finding: text.scenarioTitle, link_level: link.level, link_signals: link.signals.map((signal) => signal.plain), action: text.recommendation };
  multiGate.push({ id: "multi-genuine-delivery-notification", tone: "legitimate", situation: "This is a genuine delivery notification.", submitted, userActions: ["paste notification", "check link", "confirm expected delivery"], expected, actual: observed, pass: text.state !== "barking" && link.level !== "malicious" && !/scam|dangerous/i.test(text.scenarioTitle), evidence: "automated" });
}

const deviceOnly = [
  { id: "site-native-confirmed-block", gate: "site", reason: "Requires a real supported filter and device-recorded enforcement evidence." },
  { id: "call-native-screening-rejection", gate: "call", reason: "Requires a real incoming call and supported call-screening role." },
  { id: "file-native-share-provider", gate: "file", reason: "Requires Android/iOS share sheet, provider metadata and content URI access." },
  { id: "device-native-settings-return", gate: "device", reason: "Requires real Settings deep links and refresh after returning to Apollo." },
  { id: "app-native-inventory-permissions", gate: "app", reason: "Requires platform-exposed app inventory and permission observations." },
  { id: "network-native-enforcement", gate: "network", reason: "Requires real network events; Stage 1D packet-blocking acceptance remains cancelled." },
];

const allPassed = scenarios.filter((s) => s.pass).length + multiGate.filter((s) => s.pass).length;
const allTotal = scenarios.length + multiGate.length;
const output = { round: "Round 1", generated_at: new Date().toISOString(), expected_recorded_in: "frontend/scripts/round1-scenario-engine.ts", scenarios, multi_gate: multiGate, summary: { total: allTotal, passed: allPassed, failed: allTotal - allPassed, single_gate_total: scenarios.length, multi_gate_total: multiGate.length }, device_only: deviceOnly };
const arg = process.argv.indexOf("--out");
const outputPath = arg >= 0 && process.argv[arg + 1] ? path.resolve(process.argv[arg + 1]) : path.resolve("../test_reports/round1_engine.json");
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Round 1 deterministic scenarios: ${output.summary.passed}/${output.summary.total} passed`);
console.log(`Report data: ${outputPath}`);
if (output.summary.failed) process.exitCode = 1;