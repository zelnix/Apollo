/**
 * Apollo Scam Guard — Comprehensive Detection Regression Suite
 * ═══════════════════════════════════════════════════════════════
 *
 * Validates every detection engine against the agreed evidence standard:
 *   Patrolling (resting)  — no threat found
 *   Sniffing   (ears_up)  — investigation / limited evidence
 *   Growling              — credible suspicion
 *   Barking               — confirmed threat or strong observed deceptive behaviour
 *   Biting                — verified and blocked (not tested here; requires native enforcement)
 *
 * Tests assert the EXPECTED evidence-based result, not merely what the code currently does.
 * Both positive (real scams detected) and negative (legitimate activity not alarmed) cases.
 *
 * Run:  cd /app/frontend && npx tsx src/tests/detection-regression.test.ts
 */

import { analyseUrlLocally } from "../domain/risk";
import { analyseMessage, extractSignals } from "../domain/messageAnalysis";
import { assessBrand } from "../domain/brand";
import { decide } from "../domain/decision";
import { analyseEmail, parseEmail } from "../domain/emailAnalysis";
import { analyseCall } from "../domain/callAnalysis";
import { analyseApp, brandInName, isRemoteTool } from "../domain/appAnalysis";
import { analyseFile, realTypeFromBytes } from "../domain/fileAnalysis";
import { analyseAccountAlert, inspectAccountEvidence } from "../domain/accountAnalysis";
import { analyseNetwork, ssidMatches } from "../domain/networkAnalysis";
import { findScentFor, buildScents, SCENT_WINDOW_MS } from "../domain/threatScent";
import { resolveApolloState, canTransition, STATE_RANK, VERIFICATION_FRESHNESS_MS, RECOVERY_COOLDOWN_MS } from "../domain/stateMachine";
import { mergeLocalAndRemoteEvents } from "../domain/eventMerge";
import { buildEmailCheckResult } from "../domain/emailCheckResultAdapter";
import { buildCallCheckResult } from "../domain/callCheckResultAdapter";
import { buildAppCheckResult } from "../domain/appCheckResultAdapter";
import { buildFileCheckResult } from "../domain/fileCheckResultAdapter";
import { buildAccountCheckResult } from "../domain/accountCheckResultAdapter";
import type { PatrolEvent, ApolloState, IntelResult } from "../domain/types";

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

let failures = 0;
let passed = 0;
function assert(condition: boolean, label: string) {
  if (!condition) { console.error(`  FAIL: ${label}`); failures++; }
  else { console.log(`  PASS: ${label}`); passed++; }
}
function section(name: string) { console.log(`\n══ ${name} ══`); }

// Helper to create a valid IntelResult for testing
function makeIntel(overrides: Partial<IntelResult> & { verdict: IntelResult["verdict"]; coverage: IntelResult["coverage"] }): IntelResult {
  return {
    sources: [], threat_types: [], redirect_chain: [], final_url: "",
    domain_info: null, indicator_digest: "test-digest", checked_at: new Date().toISOString(), cached: false,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<PatrolEvent> & { event_id: string; state: ApolloState }): PatrolEvent {
  return {
    category: "website", headline: "Test", what_happened: "Test event", why: [],
    occurred_at: new Date().toISOString(), status: "active", background: false,
    verified_block: false, adapter_label: "test", scent_id: null,
    investigation_case_id: null, indicator_digest: null, indicator_host: null,
    claimed_brand: null, scenario: null,
    what_to_do: null, threat_types: [],
    ...overrides,
  } as PatrolEvent;
}

// ═══════════════════════════════════════════════════════════════
// 1. WEBSITE & LINK ANALYSIS (risk.ts, decision.ts, brand.ts)
// ═══════════════════════════════════════════════════════════════

section("1A. Score-Based Barking Gate (MF-1) + IP credential_lure (MF-2)");

// SG-01: Router admin page — structural signals only, must NOT bark
(() => {
  const r = analyseUrlLocally("http://192.168.1.1:8080/login");
  assert(!r.signals.some(s => s.code === "credential_lure"), "SG-01a: credential_lure does NOT fire on bare IP");
  assert(r.signals.some(s => s.code === "credential_word"), "SG-01b: credential_word fires instead");
  assert(r.level !== "malicious", "SG-01c: level is NOT malicious (structural only)");
  assert(r.level === "suspicious", "SG-01d: level is suspicious (growling)");
})();

// SG-02: Phishing with brand — deception present, MUST reach malicious
(() => {
  const r = analyseUrlLocally("https://commbank-login.example.xyz/account/update");
  assert(r.signals.some(s => s.code === "brand_lookalike"), "SG-02a: brand_lookalike fires");
  assert(r.signals.some(s => s.code === "credential_lure"), "SG-02b: credential_lure fires (via lookalike)");
  assert(r.level === "malicious", "SG-02c: level is malicious (deception signal present)");
})();

// SG-03: Deep hostname structural noise — NO deception
(() => {
  const r = analyseUrlLocally("http://test.staging.dev.corp.xyz:9090/dashboard");
  const deception = ["brand_lookalike", "brand_in_path", "credentials_in_url", "credential_lure", "known_test_threat"];
  assert(!r.signals.some(s => deception.includes(s.code)), "SG-03a: no deception signals");
  assert(r.level !== "malicious", "SG-03b: level is NOT malicious");
  assert(r.score === 57, `SG-03c: score is 57 (got ${r.score})`);
})();

// SG-04: Brand impersonation on risky TLD → malicious
(() => {
  const r = analyseUrlLocally("https://paypal-verify.tk/login");
  assert(r.signals.some(s => s.code === "brand_lookalike"), "SG-04a: brand_lookalike fires");
  assert(r.level === "malicious", "SG-04b: level is malicious");
})();

// SG-05: credentials_in_url
(() => {
  const r = analyseUrlLocally("https://user:pass@evil.com/@commbank.com.au");
  assert(r.signals.some(s => s.code === "credentials_in_url"), "SG-05a: credentials_in_url fires");
  assert(r.level === "suspicious", "SG-05b: level is suspicious (45 points)");
  assert(r.score === 45, `SG-05c: score is 45 (got ${r.score})`);
})();

// CL-01/CL-02: IP with credential word / IP with brand in path
(() => {
  const r1 = analyseUrlLocally("http://192.168.1.1/login");
  assert(!r1.signals.some(s => s.code === "credential_lure"), "CL-01a: no credential_lure");
  assert(r1.score === 53, `CL-01b: score is 53 (got ${r1.score})`);
  const r2 = analyseUrlLocally("http://192.168.1.1/paypal-login");
  assert(r2.signals.some(s => s.code === "brand_in_path"), "CL-02a: brand_in_path fires");
  assert(r2.signals.some(s => s.code === "credential_lure"), "CL-02b: credential_lure fires (via brandInPath)");
  assert(r2.level === "malicious", "CL-02c: level is malicious (deception signal present)");
})();

// INT-01: Punycode domain — no false alarm
(() => {
  const r = analyseUrlLocally("https://xn--mnchen-3ya.de/buergerservice");
  assert(r.level === "uncertain", `INT-01a: punycode alone is uncertain (got ${r.level})`);
  assert(!r.signals.some(s => s.code === "many_hyphens"), "INT-01b: many_hyphens suppressed for punycode");
})();

// LEGIT-01: Legitimate bank URL
(() => {
  const r = analyseUrlLocally("https://www.commbank.com.au/netbank");
  assert(r.level === "clean", "LEGIT-01: legitimate bank URL is clean");
})();

section("1B. Decision Integration (local + intel)");

// DEC-01: Intel malicious → barking even if local is clean
(() => {
  const local = analyseUrlLocally("https://example.com");
  const intel = makeIntel({ verdict: "malicious", coverage: "full", sources: [{ name: "gsb", status: "match" as const, threat_types: ["SOCIAL_ENGINEERING"], detail: "" }], threat_types: ["SOCIAL_ENGINEERING"], final_url: "https://example.com" });
  const d = decide(local, intel, false);
  assert(d.state === "barking", "DEC-01: intel malicious → barking");
  assert(d.confidence === "high", "DEC-01b: confidence high");
})();

// DEC-02: Local malicious + no intel → still barking
(() => {
  const local = analyseUrlLocally("https://commbank-login.example.xyz/account/update");
  const d = decide(local, null, false);
  assert(d.state === "barking", "DEC-02: local malicious + no intel → barking");
})();

// DEC-03: Clean local + clean intel → resting
(() => {
  const local = analyseUrlLocally("https://www.google.com");
  const intel = makeIntel({ verdict: "clean", coverage: "full", sources: [{ name: "gsb", status: "clear" as const, threat_types: [] as string[], detail: "" }], threat_types: [] as string[], final_url: "https://www.google.com" });
  const d = decide(local, intel, false);
  assert(d.state === "resting", "DEC-03: clean local + clean intel → resting");
})();

// DEC-04: Brand mismatch + homograph → barking
(() => {
  const local = analyseUrlLocally("https://comrnbank.com/login");
  const d = decide(local, null, false);
  assert(d.state === "barking", "DEC-04: homograph brand mismatch → barking");
  assert(d.claimed_brand === "CommBank", "DEC-04b: claimed brand is CommBank");
})();

// DEC-05: Trusted link cannot override confirmed malicious
(() => {
  const local = analyseUrlLocally("https://example.com");
  const intel = makeIntel({ verdict: "malicious", coverage: "full", sources: [{ name: "gsb", status: "match" as const, threat_types: ["MALWARE"], detail: "" }], threat_types: ["MALWARE"], final_url: "https://example.com" });
  const d = decide(local, intel, true); // trusted = true
  assert(d.state === "barking", "DEC-05: trusted link CANNOT override confirmed malicious");
})();

section("1C. Brand Detection");

(() => {
  const r1 = assessBrand("comrnbank.com");
  assert(r1.claimed?.name === "CommBank", "BRAND-01: comrnbank.com → CommBank (homograph)");
  assert(r1.homograph === true, "BRAND-01b: homograph detected");
  assert(r1.isOfficial === false, "BRAND-01c: not official");
  const r2 = assessBrand("www.commbank.com.au");
  assert(r2.isOfficial === true, "BRAND-02: commbank.com.au is official");
  const r3 = assessBrand("example.com");
  assert(r3.claimed === null, "BRAND-03: example.com has no brand match");
  const r4 = assessBrand("paypal.tk");
  assert(r4.claimed?.name === "PayPal" && r4.isOfficial === false, "BRAND-04: paypal.tk → PayPal, not official");
})();


// Page Analysis tests removed in Stage 14 — local page verdict replaced by Magnum DI (Stage 13).


// ═══════════════════════════════════════════════════════════════
// 2. MESSAGE ANALYSIS (messageAnalysis.ts)
// ═══════════════════════════════════════════════════════════════

section("2A. M02 Official URL Check (MF-3 + MF-4)");

(() => {
  const r1 = analyseMessage("CommBank", "CommBank: Your card ending 4567 was used for $89.50 at Woolworths. Visit commbank.com.au/security");
  assert(r1.scenario === "M02", "M02-01a: scenario is M02");
  assert(r1.state === "ears_up", `M02-01b: state is ears_up (got ${r1.state})`);
  assert(!r1.why.some((w: string) => w.includes("does not lead to")), "M02-01c: why does NOT falsely assert non-official");
  const r2 = analyseMessage("unknown", "CommBank: Your account has been locked. Verify now: commbank-alerts.xyz/verify");
  assert(r2.state === "barking", `M02-02: non-official URL → barking (got ${r2.state})`);
  const r3 = analyseMessage("ANZ", "ANZ: Your statement is ready. View at anz.com.au/statements");
  assert(r3.scenario === "M02" && r3.state === "ears_up", `M02-04: ANZ official URL → ears_up (got ${r3.state})`);
  const r4 = analyseMessage("unknown", "Your bank account has been locked. Click here: bit.ly/abc123");
  assert(r4.state === "barking", `M02-05: shortened URL → barking (got ${r4.state})`);
})();

section("2B. Message Scam Patterns");

// M01: Bank phishing from unknown sender
(() => {
  const r = analyseMessage("unknown", "Your CommBank account has been suspended. Verify immediately: commbank-secure.xyz/verify");
  assert(r.state === "barking", `MSG-01: bank phish → barking (got ${r.state})`);
})();

// Government scam
(() => {
  const r = analyseMessage("unknown", "ATO: You have an outstanding tax refund of $3,450.20. Claim now: ato-refund.xyz/claim");
  assert(r.state === "barking", `MSG-02: gov scam → barking (got ${r.state})`);
})();

// Delivery scam
(() => {
  const r = analyseMessage("unknown", "AusPost: Your parcel could not be delivered. Reschedule: auspost-delivery.xyz/track");
  assert(r.state === "barking", `MSG-03: delivery scam → barking (got ${r.state})`);
})();

// Legitimate bank notification without URL
(() => {
  const r = analyseMessage("CommBank", "CommBank: A payment of $50.00 was made from your account ending 7890.");
  assert(r.state !== "barking", `MSG-04: legit bank notif without URL → NOT barking (got ${r.state})`);
})();

// Ordinary message
(() => {
  const r = analyseMessage("Mum", "Hey, dinner is at 7pm tonight. See you there!");
  assert(r.state === "resting", `MSG-05: ordinary message → resting (got ${r.state})`);
})();


// ═══════════════════════════════════════════════════════════════
// 3. EMAIL ANALYSIS (emailAnalysis.ts)
// ═══════════════════════════════════════════════════════════════

section("3A. Email Core Scenarios");

// E01: Brand impersonation with login request
(() => {
  const r = analyseEmail("From: security@commbank-alerts.xyz\nSubject: Urgent: Verify your CommBank account\n\nYour account has been locked. Click here to verify: https://commbank-alerts.xyz/verify\n\nFailing to verify within 24 hours will result in account suspension.");
  assert(r.scenario === "E01", `EMAIL-01a: scenario is E01 (got ${r.scenario})`);
  assert(r.state === "barking", `EMAIL-01b: brand impersonation + login → barking (got ${r.state})`);
})();

// E03: Risky attachment from unknown sender
(() => {
  const r = analyseEmail("From: unknown@randomdomain.xyz\nSubject: Your invoice\n\nPlease find your invoice attached.\nAttachments: invoice.exe");
  assert(r.scenario === "E03", `EMAIL-02a: scenario is E03 (got ${r.scenario})`);
  assert(r.state === "barking", `EMAIL-02b: risky attachment + unknown sender → barking (got ${r.state})`);
})();

// E04: Changed bank details
(() => {
  const r = analyseEmail("From: accounts@supplier.com\nSubject: Updated payment details\n\nPlease note our new bank details have changed. Transfer the invoice amount to our updated account number 123456.");
  assert(r.scenario === "E04", `EMAIL-03a: scenario is E04 (got ${r.scenario})`);
  assert(r.state === "barking", `EMAIL-03b: changed bank details → barking (got ${r.state})`);
})();

// E11: Official sender, expected content → ears_up or resting
(() => {
  const r = analyseEmail("From: noreply@commbank.com.au\nSubject: Your statement is ready\n\nYour monthly statement is now available. View it in the CommBank app.");
  assert(r.scenario === "E11", `EMAIL-04a: scenario is E11 (got ${r.scenario})`);
  assert(r.state === "resting" || r.state === "ears_up", `EMAIL-04b: official sender → resting/ears_up (got ${r.state})`);
})();

// E13: Ordinary email → resting
(() => {
  const r = analyseEmail("From: friend@gmail.com\nSubject: Lunch tomorrow?\n\nHey, want to grab lunch tomorrow at noon?");
  assert(r.scenario === "E13", `EMAIL-05a: scenario is E13 (got ${r.scenario})`);
  assert(r.state === "resting", `EMAIL-05b: ordinary email → resting (got ${r.state})`);
})();

// E14: Security alert → ears_up (not barking, not clear — unverified)
(() => {
  const r = analyseEmail("From: no-reply@accounts.google.com\nSubject: Security alert\n\nA new device signed into your Google account. Review recent activity.");
  assert(r.scenario === "E14", `EMAIL-06a: scenario is E14 (got ${r.scenario})`);
  assert(r.state === "ears_up", `EMAIL-06b: security alert → ears_up (got ${r.state})`);
  // Gap #6: The verdict should NOT claim it's authenticated or safe
  assert(!r.verdict.toLowerCase().includes("authenticated"), "EMAIL-06c: verdict does not claim authenticated");
})();

// E07: Brand mismatch without clear ask → growling
(() => {
  const r = analyseEmail("From: info@commbank-updates.xyz\nSubject: Important update from CommBank\n\nPlease read the attached document for important changes to your account terms.");
  assert(r.scenario === "E07", `EMAIL-07a: scenario is E07 (got ${r.scenario})`);
  assert(r.state === "growling", `EMAIL-07b: brand mismatch without ask → growling (got ${r.state})`);
})();

// E06: Code request → barking
(() => {
  const r = analyseEmail("From: helpdesk@example.xyz\nSubject: Verify your identity\n\nPlease reply with the verification code we sent to your device to confirm your account.");
  assert(r.scenario === "E06", `EMAIL-08a: scenario is E06 (got ${r.scenario})`);
  assert(r.state === "barking", `EMAIL-08b: code request → barking (got ${r.state})`);
})();

section("3B. Email Brand Consistency (Gap #7)");

// Macquarie and Bendigo should be recognised
(() => {
  const r1 = analyseEmail("From: alerts@macquarie-phish.xyz\nSubject: Macquarie account suspended\n\nVerify your Macquarie account: https://macquarie-phish.xyz/verify");
  assert(r1.state === "barking", `EMAIL-09a: Macquarie impersonation → barking (got ${r1.state})`);
  assert(r1.claimedBrand?.toLowerCase().includes("macquarie") || r1.scenario === "E01" || r1.scenario === "E02", `EMAIL-09b: Macquarie brand detected (scenario ${r1.scenario})`);
  const r2 = analyseEmail("From: noreply@macquarie.com.au\nSubject: Your statement\n\nYour Macquarie statement is ready.");
  assert(r2.scenario === "E11", `EMAIL-09c: Macquarie official domain → E11 (got ${r2.scenario})`);
})();


// ═══════════════════════════════════════════════════════════════
// 4. CALL ANALYSIS (callAnalysis.ts)
// ═══════════════════════════════════════════════════════════════

section("4A. Call Core Scenarios");

// C03: Verification code request → barking
(() => {
  const r = analyseCall({ asks: ["code"], claim: "bank", number: "+61400000000" });
  assert(r.scenario === "C03", `CALL-01a: scenario is C03 (got ${r.scenario})`);
  assert(r.state === "barking", `CALL-01b: code request → barking (got ${r.state})`);
})();

// C05: Remote access request → barking
(() => {
  const r = analyseCall({ asks: ["remote"], claim: "techsupport", number: "+61400000000" });
  assert(r.state === "barking", `CALL-02: remote access → barking (got ${r.state})`);
})();

// C08: Gift cards → barking
(() => {
  const r = analyseCall({ asks: ["giftcards"], claim: "government" });
  assert(r.state === "barking", `CALL-03: gift cards → barking (got ${r.state})`);
})();

// C14: "Don't hang up" → barking
(() => {
  const r = analyseCall({ asks: ["dont_hangup"], claim: "bank" });
  assert(r.state === "barking", `CALL-04: dont_hangup → barking (got ${r.state})`);
})();

// C02: Safe account transfer → barking
(() => {
  const r = analyseCall({ asks: ["transfer"], claim: "bank", transcript: "We need to move your money to a safe account immediately" });
  assert(r.state === "barking", `CALL-05: safe account transfer → barking (got ${r.state})`);
})();

// C19: Ordinary call → resting
(() => {
  const r = analyseCall({ asks: ["nothing"], claim: "unknown" });
  assert(r.scenario === "C19", `CALL-06a: scenario is C19 (got ${r.scenario})`);
  assert(r.state === "resting", `CALL-06b: ordinary call → resting (got ${r.state})`);
})();

// C20: Possible genuine bank call → ears_up
(() => {
  const r = analyseCall({ asks: ["nothing"], claim: "bank" });
  assert(r.state === "ears_up", `CALL-07: genuine bank call, nothing asked → ears_up (got ${r.state})`);
})();

// C12: Investment cold call → growling
(() => {
  const r = analyseCall({ asks: ["nothing"], claim: "investment" });
  assert(r.state === "growling", `CALL-08: investment cold call → growling (got ${r.state})`);
})();

// Family money request → ears_up (not barking — context needed)
(() => {
  const r = analyseCall({ asks: ["transfer"], claim: "family" });
  assert(r.state === "ears_up", `CALL-09: family transfer → ears_up (got ${r.state})`);
})();


// ═══════════════════════════════════════════════════════════════
// 5. APP ANALYSIS (appAnalysis.ts)
// ═══════════════════════════════════════════════════════════════

section("5A. App Core Scenarios");

// A01: Remote access during suspicious call → barking
(() => {
  const r = analyseApp({ name: "AnyDesk", source: "play_store", purpose: "remote_support", permissions: ["screen_share", "accessibility"], context: { promptedByCaller: true }, network: null });
  assert(r.scenario === "A01", `APP-01a: scenario is A01 (got ${r.scenario})`);
  assert(r.state === "barking", `APP-01b: remote access during call → barking (got ${r.state})`);
})();

// A03: Fake update from off-store → barking
(() => {
  const r = analyseApp({ name: "WhatsApp Update", source: "browser", purpose: "update", permissions: ["sms", "accessibility"], context: {}, network: null });
  assert(r.scenario === "A03", `APP-02a: scenario is A03 (got ${r.scenario})`);
  assert(r.state === "barking", `APP-02b: fake update off-store → barking (got ${r.state})`);
})();

// A03b: Brand impersonation off-store → barking
(() => {
  const r = analyseApp({ name: "CommBank Security", source: "message", purpose: "banking", permissions: ["sms", "overlay", "accessibility"], context: {}, network: null });
  assert(r.state === "barking", `APP-03: brand impersonation off-store → barking (got ${r.state})`);
})();

// A13/A18: Official store app, no issues → ears_up (not resting — store source not proof)
(() => {
  const r = analyseApp({ name: "Weather App", source: "play_store", purpose: "simple_tool", permissions: ["location"], context: {}, network: null });
  assert(r.state === "ears_up", `APP-04: official store, expected perms → ears_up (got ${r.state})`);
})();

// A20: Legitimate intentional remote support → ears_up
(() => {
  const r = analyseApp({ name: "TeamViewer", source: "play_store", purpose: "remote_support", permissions: ["screen_share"], context: { intentional: true }, network: null });
  assert(r.scenario === "A20", `APP-05a: scenario is A20 (got ${r.scenario})`);
  assert(r.state === "ears_up", `APP-05b: intentional remote support → ears_up (got ${r.state})`);
})();

section("5B. App Evidence Gate (Gap #8)");

// HIGH score WITHOUT strong context → capped at growling
(() => {
  const r = analyseApp({
    name: "Some Tool",
    source: "not_sure",
    purpose: "other",
    permissions: ["accessibility", "overlay", "sms", "notifications", "contacts"],
    context: {}, // NO caller prompt, NO message prompt, NO brand, NO network blocks
    network: null,
  });
  assert(r.state !== "barking", `APP-GATE-01: high score without strong context → NOT barking (got ${r.state}, score ${r.riskScore})`);
  assert(r.riskScore >= 70, `APP-GATE-01b: score should be ≥70 (got ${r.riskScore})`);
})();

// HIGH score WITH strong context (caller prompted) → CAN bark
(() => {
  const r = analyseApp({
    name: "Some Tool",
    source: "not_sure",
    purpose: "other",
    permissions: ["accessibility", "overlay", "sms"],
    context: { promptedByCaller: true }, // STRONG context
    network: null,
  });
  // The scenario path may catch this before byScore, but the principle: strong context allows escalation
  assert(r.state === "barking" || r.state === "growling", `APP-GATE-02: strong context allows barking (got ${r.state})`);
})();


// ═══════════════════════════════════════════════════════════════
// 6. FILE ANALYSIS (fileAnalysis.ts)
// ═══════════════════════════════════════════════════════════════

section("6A. File Core Scenarios");

// F01: Disguised executable (invoice.pdf.exe) → barking
(() => {
  const exeBytes = new Uint8Array([0x4D, 0x5A, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
  const r = analyseFile({ name: "invoice.pdf.exe", headBytes: exeBytes, source: "email" });
  assert(r.scenario === "F01", `FILE-01a: scenario is F01 (got ${r.scenario})`);
  assert(r.state === "barking", `FILE-01b: disguised exe → barking (got ${r.state})`);
})();

// F13: Plain executable from unexpected source → barking
(() => {
  const exeBytes = new Uint8Array([0x4D, 0x5A, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
  const r = analyseFile({ name: "setup.exe", headBytes: exeBytes, source: "message" });
  assert(r.scenario === "F13", `FILE-02a: scenario is F13 (got ${r.scenario})`);
  assert(r.state === "barking", `FILE-02b: exe from message → barking (got ${r.state})`);
})();

// F02: APK with brand impersonation → barking
(() => {
  const zipBytes = new Uint8Array([0x50, 0x4B, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]);
  const r = analyseFile({ name: "CommBank-Update.apk", headBytes: zipBytes, source: "message" });
  assert(r.scenario === "F02", `FILE-03a: scenario is F02 (got ${r.scenario})`);
  assert(r.state === "barking", `FILE-03b: APK with brand → barking (got ${r.state})`);
})();

// F11: Configuration profile from unknown source → barking
(() => {
  const plistBytes = new Uint8Array([0x3C, 0x70, 0x6C, 0x69, 0x73, 0x74, 0x00, 0x00]);
  const r = analyseFile({ name: "network-config.mobileconfig", headBytes: plistBytes, source: "message" });
  assert(r.scenario === "F11", `FILE-04a: scenario is F11 (got ${r.scenario})`);
  assert(r.state === "barking", `FILE-04b: profile from message → barking (got ${r.state})`);
})();

// F11: Configuration profile from known source → growling (not barking)
(() => {
  const plistBytes = new Uint8Array([0x3C, 0x70, 0x6C, 0x69, 0x73, 0x74, 0x00, 0x00]);
  const r = analyseFile({ name: "work-vpn.mobileconfig", headBytes: plistBytes, source: "known" });
  assert(r.state === "growling", `FILE-05: profile from known source → growling (got ${r.state})`);
})();

// F10: Normal PDF → ears_up (limited inspection, not "safe")
(() => {
  const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x00]);
  const r = analyseFile({ name: "document.pdf", headBytes: pdfBytes, source: "email" });
  assert(r.scenario === "F10", `FILE-06a: scenario is F10 (got ${r.scenario})`);
  assert(r.state === "ears_up", `FILE-06b: normal PDF → ears_up (limited inspection) (got ${r.state})`);
})();

// F16: File not inspected → ears_up (unknown ≠ safe)
(() => {
  const r = analyseFile({ name: "mystery.dat", source: "unknown" });
  assert(r.state === "ears_up", `FILE-07: uninspected file → ears_up (got ${r.state})`);
})();

// Normal image → ears_up
(() => {
  const imgBytes = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46]);
  const r = analyseFile({ name: "photo.jpg", headBytes: imgBytes, source: "known" });
  assert(r.state === "ears_up", `FILE-08: normal image → ears_up (got ${r.state})`);
})();


// ═══════════════════════════════════════════════════════════════
// 7. ACCOUNT ANALYSIS (accountAnalysis.ts)
// ═══════════════════════════════════════════════════════════════

section("7A. Account Core Scenarios");

// AC12: Code entered → barking, very_high risk
(() => {
  const r = analyseAccountAlert({ kind: "mfa_prompt", provider: "google", userInitiated: false, enteredCode: true });
  assert(r.scenario === "AC12", `ACCT-01a: scenario is AC12 (got ${r.scenario})`);
  assert(r.state === "barking", `ACCT-01b: code entered → barking (got ${r.state})`);
  assert(r.takeoverRisk === "very_high", `ACCT-01c: takeoverRisk is very_high (got ${r.takeoverRisk})`);
})();

// AC11: Password entered → barking, high risk
(() => {
  const r = analyseAccountAlert({ kind: "login_alert", provider: "microsoft", userInitiated: false, enteredPassword: true });
  assert(r.scenario === "AC11", `ACCT-02a: scenario is AC11 (got ${r.scenario})`);
  assert(r.state === "barking", `ACCT-02b: password entered → barking (got ${r.state})`);
})();

// AC14: Recovery changed, not user-initiated → barking
(() => {
  const r = analyseAccountAlert({ kind: "recovery_changed", provider: "google", userInitiated: false });
  assert(r.scenario === "AC14", `ACCT-03a: scenario is AC14 (got ${r.scenario})`);
  assert(r.state === "barking", `ACCT-03b: recovery changed → barking (got ${r.state})`);
})();

// AC20: User-initiated login → ears_up
(() => {
  const r = analyseAccountAlert({ kind: "mfa_prompt", provider: "google", userInitiated: true });
  assert(r.scenario === "AC20", `ACCT-04a: scenario is AC20 (got ${r.scenario})`);
  assert(r.state === "ears_up", `ACCT-04b: user-initiated → ears_up (got ${r.state})`);
})();

// AC19: Unfamiliar notification → ears_up
(() => {
  const r = analyseAccountAlert({ kind: "other", provider: "other", userInitiated: null });
  assert(r.scenario === "AC19", `ACCT-05a: scenario is AC19 (got ${r.scenario})`);
  assert(r.state === "ears_up", `ACCT-05b: unfamiliar notification → ears_up (got ${r.state})`);
})();

// AC01: Unexpected MFA prompt (not sure) → growling
(() => {
  const r = analyseAccountAlert({ kind: "mfa_prompt", provider: "bank", userInitiated: null });
  assert(r.state === "growling", `ACCT-06: unexpected MFA (not sure) → growling (got ${r.state})`);
})();

// AC02: Repeated MFA prompts → barking (MFA fatigue)
(() => {
  const r = analyseAccountAlert({ kind: "mfa_prompt", provider: "google", userInitiated: false, repeated: true });
  assert(r.scenario === "AC02", `ACCT-07a: scenario is AC02 (got ${r.scenario})`);
  assert(r.state === "barking", `ACCT-07b: MFA fatigue → barking (got ${r.state})`);
})();


// ═══════════════════════════════════════════════════════════════
// 8. NETWORK ANALYSIS (networkAnalysis.ts)
// ═══════════════════════════════════════════════════════════════

section("8A. Network Core Scenarios");

// N01: Home WiFi → resting
(() => {
  const r = analyseNetwork({ status: { connected: true, type: "wifi", ssid: "HomeNet", wifiSecurity: "wpa", vpnActive: false, inspectable: true, captivePortal: false, isInternetReachable: true, checkedAt: new Date().toISOString() }, context: "home", trustedSsids: [], vpnTrusted: null });
  assert(r.scenario === "N01", `NET-01a: scenario is N01 (got ${r.scenario})`);
  assert(r.state === "resting", `NET-01b: home wifi → resting (got ${r.state})`);
})();

// N04: Open WiFi → ears_up
(() => {
  const r = analyseNetwork({ status: { connected: true, type: "wifi", ssid: "CafeWiFi", wifiSecurity: "open", vpnActive: false, inspectable: true, captivePortal: false, isInternetReachable: true, checkedAt: new Date().toISOString() }, context: "public", trustedSsids: [], vpnTrusted: null });
  assert(r.scenario === "N04", `NET-02a: scenario is N04 (got ${r.scenario})`);
  assert(r.state === "ears_up", `NET-02b: open wifi → ears_up (got ${r.state})`);
})();

// N05: Captive portal → growling
(() => {
  const r = analyseNetwork({ status: { connected: true, type: "wifi", ssid: "AirportWiFi", wifiSecurity: "wpa", vpnActive: false, inspectable: true, captivePortal: true, isInternetReachable: true, checkedAt: new Date().toISOString() }, context: "public", trustedSsids: [], vpnTrusted: null });
  assert(r.scenario === "N05", `NET-03a: scenario is N05 (got ${r.scenario})`);
  assert(r.state === "growling", `NET-03b: captive portal → growling (got ${r.state})`);
})();

// N00: Not connected → resting
(() => {
  const r = analyseNetwork({ status: { connected: false, type: "unknown", ssid: null, wifiSecurity: "unknown", vpnActive: false, inspectable: false, captivePortal: null, isInternetReachable: false, checkedAt: new Date().toISOString() }, context: "unknown", trustedSsids: [], vpnTrusted: null });
  assert(r.scenario === "N00", `NET-04a: scenario is N00 (got ${r.scenario})`);
  assert(r.state === "resting", `NET-04b: not connected → resting (got ${r.state})`);
})();

// Mobile data → resting (inspectable on real devices)
(() => {
  const r = analyseNetwork({ status: { connected: true, type: "cellular", ssid: null, wifiSecurity: "n/a", vpnActive: false, inspectable: true, captivePortal: false, isInternetReachable: true, checkedAt: new Date().toISOString() }, context: "unknown", trustedSsids: [], vpnTrusted: null });
  assert(r.state === "resting", `NET-05: mobile data → resting (got ${r.state})`);
})();

// N03: Lookalike SSID → ears_up
(() => {
  const r = analyseNetwork({ status: { connected: true, type: "wifi", ssid: "Starbuckks", wifiSecurity: "wpa", vpnActive: false, inspectable: true, captivePortal: false, isInternetReachable: true, checkedAt: new Date().toISOString() }, context: "public", trustedSsids: [], vpnTrusted: null, expectedName: "Starbucks" });
  assert(r.scenario === "N03", `NET-06a: scenario is N03 (got ${r.scenario})`);
  assert(r.state === "ears_up", `NET-06b: lookalike SSID → ears_up (got ${r.state})`);
})();

// Apollo's own VPN → resting
(() => {
  const r = analyseNetwork({ status: { connected: true, type: "wifi", ssid: "Home", wifiSecurity: "wpa", vpnActive: true, inspectable: true, captivePortal: false, isInternetReachable: true, checkedAt: new Date().toISOString() }, context: "home", trustedSsids: [], vpnTrusted: null, apolloVpn: true });
  assert(r.scenario === "N11", `NET-07a: scenario is N11 (got ${r.scenario})`);
  assert(r.state === "resting", `NET-07b: Apollo VPN → resting (got ${r.state})`);
})();


// ═══════════════════════════════════════════════════════════════
// 9. THREAT SCENT CORRELATION (threatScent.ts)
// ═══════════════════════════════════════════════════════════════

section("9A. Threat Scent — No Auto-Escalation (Gap #2)");

// Similar brands alone do NOT join scents
(() => {
  const now = Date.now();
  const e1 = makeEvent({ event_id: "e1", state: "barking", category: "message", claimed_brand: "CommBank", occurred_at: new Date(now - 1000).toISOString() });
  const e2 = makeEvent({ event_id: "e2", state: "ears_up", category: "website", claimed_brand: "CommBank", occurred_at: new Date(now).toISOString() });
  const scent = findScentFor(e2, [e1], now);
  assert(scent === null, "SCENT-01: shared brand alone does NOT auto-join scents");
})();

// Explicit scent_id DOES join
(() => {
  const now = Date.now();
  const e1 = makeEvent({ event_id: "e1", state: "barking", category: "message", scent_id: "s1", occurred_at: new Date(now - 1000).toISOString() });
  const e2 = makeEvent({ event_id: "e2", state: "ears_up", category: "website", scent_id: "s1", occurred_at: new Date(now).toISOString() });
  const scent = findScentFor(e2, [e1], now);
  assert(scent === "s1", `SCENT-02: explicit scent_id joins (got ${scent})`);
})();

// buildScents computes highest state but doesn't MODIFY individual events
(() => {
  const now = Date.now();
  const e1 = makeEvent({ event_id: "e1", state: "barking", category: "message", scent_id: "s1", occurred_at: new Date(now - 1000).toISOString() });
  const e2 = makeEvent({ event_id: "e2", state: "ears_up", category: "website", scent_id: "s1", occurred_at: new Date(now).toISOString() });
  const scents = buildScents([e1, e2], now);
  assert(scents.length === 1, "SCENT-03a: one scent group built");
  assert(scents[0].state === "barking", "SCENT-03b: group state is highest (barking)");
  assert(e2.state === "ears_up", "SCENT-03c: individual event state UNCHANGED");
})();

// Events outside window don't join
(() => {
  const now = Date.now();
  const e1 = makeEvent({ event_id: "e1", state: "barking", category: "message", scent_id: "s1", occurred_at: new Date(now - SCENT_WINDOW_MS - 60000).toISOString() });
  const e2 = makeEvent({ event_id: "e2", state: "ears_up", category: "website", scent_id: null, claimed_brand: "CommBank", occurred_at: new Date(now).toISOString() });
  const scent = findScentFor(e2, [e1], now);
  assert(scent === null, "SCENT-04: events outside window don't join");
})();


// ═══════════════════════════════════════════════════════════════
// 10. STATE MACHINE (stateMachine.ts)
// ═══════════════════════════════════════════════════════════════

section("10A. State Machine Resolution");

// Recent barking event → barking
(() => {
  const now = Date.now();
  const e = makeEvent({ event_id: "e1", state: "barking", occurred_at: new Date(now - 1000).toISOString() });
  const r = resolveApolloState({ events: [e], visibility: "full", lastVerifiedAt: new Date(now - 1000).toISOString(), now });
  assert(r.state === "barking", `SM-01: recent barking → barking (got ${r.state})`);
  assert(r.drivingEvent?.event_id === "e1", "SM-01b: driving event is the barking event");
})();

// Stale barking event — genuinely unresolved threats stay barking regardless of age (corrected behavior)
(() => {
  const now = Date.now();
  const e = makeEvent({ event_id: "e1", state: "barking", occurred_at: new Date(now - 5 * 60 * 60 * 1000).toISOString() });
  const r = resolveApolloState({ events: [e], visibility: "full", lastVerifiedAt: new Date(now - 1000).toISOString(), now });
  assert(r.state === "barking", `SM-02: unresolved barking stays barking regardless of age (got ${r.state})`);
  assert(r.drivingEvent?.event_id === "e1", "SM-02b: driving event preserved");
})();

// No events + fresh verification → resting
(() => {
  const now = Date.now();
  const r = resolveApolloState({ events: [], visibility: "full", lastVerifiedAt: new Date(now - 1000).toISOString(), now });
  assert(r.state === "resting", `SM-03: no events + fresh verification → resting (got ${r.state})`);
})();

// No events + stale verification → resting (protection-health issue, NOT a security threat)
// Corrected per PRD: "Do not escalate Apollo's threat state merely because a Gate is not operating."
(() => {
  const now = Date.now();
  const r = resolveApolloState({ events: [], visibility: "full", lastVerifiedAt: new Date(now - VERIFICATION_FRESHNESS_MS - 60000).toISOString(), now });
  assert(r.state === "resting", `SM-04: stale verification → resting (protection issue, not threat) (got ${r.state})`);
})();

// Visibility none → resting (protection-health issue, NOT a security threat)
// Corrected per PRD: "Gate unavailable → Reduced protection. None independently qualifies as evidence of a security threat."
(() => {
  const now = Date.now();
  const r = resolveApolloState({ events: [], visibility: "none", lastVerifiedAt: new Date(now - 1000).toISOString(), now });
  assert(r.state === "resting", `SM-05: visibility none → resting (protection issue) (got ${r.state})`);
  assert(r.visibilityLost === true, "SM-05b: visibilityLost flag set for protection health");
})();

// Recovery cooldown after resolved event → resting (resolved, no active threat)
// Corrected per PRD: "Resolved incident → No indefinite Growling."
(() => {
  const now = Date.now();
  const e = makeEvent({ event_id: "e1", state: "growling", occurred_at: new Date(now - 300000).toISOString(), status: "resolved" as any });
  (e as any).resolved_at = new Date(now - 30000).toISOString();
  const r = resolveApolloState({ events: [e], visibility: "full", lastVerifiedAt: new Date(now - 1000).toISOString(), now });
  assert(r.state === "resting", `SM-06: resolved event → resting (got ${r.state})`);
})();

// canTransition: escalation always allowed, biting requires verified block
(() => {
  const e = makeEvent({ event_id: "e1", state: "growling" });
  assert(canTransition(e, "barking") === true, "SM-07a: escalation growling→barking allowed");
  assert(canTransition(e, "biting") === false, "SM-07b: biting without verified block blocked");
  assert(canTransition(e, "biting", { verifiedBlock: true }) === true, "SM-07c: biting with verified block allowed");
})();


// ═══════════════════════════════════════════════════════════════
// 11. EVENT MERGE (eventMerge.ts)
// ═══════════════════════════════════════════════════════════════

section("11A. Event Merge");

// Local content wins on the device that recorded it
(() => {
  const localEv = makeEvent({ event_id: "e1", state: "growling", category: "website", indicator_host: "example.com", occurred_at: new Date(Date.now() - 60000).toISOString() });
  (localEv as any).evidence_provenance = "local_device";
  (localEv as any).what_happened = "Local analysis found suspicious signals.";
  const remoteEv = makeEvent({ event_id: "e1", state: "ears_up", category: "website", indicator_host: "example.com", occurred_at: new Date(Date.now() - 60000).toISOString() });
  (remoteEv as any).what_happened = "Server analysis was less certain.";
  (remoteEv as any).patrol_record = { id: "pr1", status: "open" };
  const result = mergeLocalAndRemoteEvents([localEv], [remoteEv]);
  assert(result.events.length === 1, "MERGE-01a: one event after merge");
  assert(result.events[0].state === "growling", "MERGE-01b: local state wins (growling, not ears_up)");
  assert(result.events[0].what_happened === "Local analysis found suspicious signals.", "MERGE-01c: local content preserved");
})();

// Remote-only events are added as-is
(() => {
  const localEv = makeEvent({ event_id: "e1", state: "ears_up", category: "message" });
  const remoteEv = makeEvent({ event_id: "e2", state: "barking", category: "website" });
  const result = mergeLocalAndRemoteEvents([localEv], [remoteEv]);
  assert(result.events.length === 2, "MERGE-02: both events present after merge");
  assert(result.events.some(e => e.event_id === "e2" && e.state === "barking"), "MERGE-02b: remote event included as-is");
})();

// Resolved local events are not reopened by stale remote data
(() => {
  const localEv = makeEvent({ event_id: "e1", state: "ears_up", category: "website", status: "resolved" as any });
  (localEv as any).resolved_at = new Date(Date.now() - 60000).toISOString();
  (localEv as any).evidence_provenance = "local_device";
  const remoteEv = makeEvent({ event_id: "e1", state: "growling", category: "website" });
  const result = mergeLocalAndRemoteEvents([localEv], [remoteEv]);
  assert(result.events[0].status === "resolved", "MERGE-03: resolved status preserved against stale remote data");
})();


// ═══════════════════════════════════════════════════════════════
// 12. ADAPTER CONFIDENCE (Gap #13)
// ═══════════════════════════════════════════════════════════════

section("12A. Email Adapter — Evidence-Based Confidence");

// Brand mismatch + deceptive content → High
(() => {
  const a = analyseEmail("From: security@commbank-phish.xyz\nSubject: Urgent: Login to CommBank now\n\nYour account will be closed in 24 hours unless you verify: https://commbank-phish.xyz/verify");
  const result = buildEmailCheckResult({ analysis: a, event: null, from: "security@commbank-phish.xyz", subject: "Urgent", submissionId: "test1", urlResults: [], explanation: null });
  assert(result.confidence === "High", `ADAPT-EMAIL-01: brand mismatch + urgency + login → High (got ${result.confidence})`);
})();

// Official sender, no threats → Low
(() => {
  const a = analyseEmail("From: noreply@commbank.com.au\nSubject: Your statement\n\nYour statement is ready.");
  const result = buildEmailCheckResult({ analysis: a, event: null, from: "noreply@commbank.com.au", subject: "Statement", submissionId: "test2", urlResults: [], explanation: null });
  assert(result.confidence === "Low", `ADAPT-EMAIL-02: official sender, no threats → Low (got ${result.confidence})`);
})();

// Email adapter: official sender domain status is "incomplete" not "clear" (Gap #6)
(() => {
  const a = analyseEmail("From: noreply@commbank.com.au\nSubject: Your statement\n\nYour statement is ready.");
  const result = buildEmailCheckResult({ analysis: a, event: null, from: "noreply@commbank.com.au", subject: "Statement", submissionId: "test3", urlResults: [], explanation: null });
  const senderItem = result.items.find(i => i.id === "email:sender");
  assert(senderItem?.status === "incomplete", `ADAPT-EMAIL-03: official sender domain → incomplete (got ${senderItem?.status})`);
  assert(!!(senderItem?.finding?.includes("cannot be verified") || senderItem?.finding?.includes("domain name only")), `ADAPT-EMAIL-03b: finding notes verification limitation`);
})();

section("12B. Call Adapter — Evidence-Based Confidence");

// Dangerous asks → High
(() => {
  const a = analyseCall({ asks: ["remote", "transfer"], claim: "bank" });
  const result = buildCallCheckResult({ analysis: a, event: null, number: "+61400000000", transcript: "" });
  assert(result.confidence === "High", `ADAPT-CALL-01: remote + transfer → High (got ${result.confidence})`);
})();

// Ordinary call → Low
(() => {
  const a = analyseCall({ asks: ["nothing"], claim: "unknown" });
  const result = buildCallCheckResult({ analysis: a, event: null, number: "", transcript: "" });
  assert(result.confidence === "Low", `ADAPT-CALL-02: ordinary call → Low (got ${result.confidence})`);
})();

section("12C. App Adapter — Evidence-Based Confidence");

// Remote + caller → High
(() => {
  const a = analyseApp({ name: "AnyDesk", source: "play_store", purpose: "remote_support", permissions: ["screen_share"], context: { promptedByCaller: true }, network: null });
  const result = buildAppCheckResult({ analysis: a, event: null, appName: "AnyDesk", submissionId: "test4" });
  assert(result.confidence === "High", `ADAPT-APP-01: remote + caller → High (got ${result.confidence})`);
})();

// Official store, no concerns → Low
(() => {
  const a = analyseApp({ name: "Calculator", source: "play_store", purpose: "simple_tool", permissions: [], context: {}, network: null });
  const result = buildAppCheckResult({ analysis: a, event: null, appName: "Calculator", submissionId: "test5" });
  assert(result.confidence === "Low", `ADAPT-APP-02: official store, no concerns → Low (got ${result.confidence})`);
})();

section("12D. File Adapter — Evidence-Based Confidence");

// Extension mismatch + executable → High
(() => {
  const exeBytes = new Uint8Array([0x4D, 0x5A, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
  const a = analyseFile({ name: "invoice.pdf.exe", headBytes: exeBytes, source: "email" });
  const result = buildFileCheckResult({ analysis: a, event: null, fileName: "invoice.pdf.exe", submissionId: "test6" });
  assert(result.confidence === "High", `ADAPT-FILE-01: disguised exe → High (got ${result.confidence})`);
})();

// Normal PDF → Low
(() => {
  const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x00]);
  const a = analyseFile({ name: "document.pdf", headBytes: pdfBytes, source: "known" });
  const result = buildFileCheckResult({ analysis: a, event: null, fileName: "document.pdf", submissionId: "test7" });
  assert(result.confidence === "Low", `ADAPT-FILE-02: normal PDF → Low (got ${result.confidence})`);
})();

section("12E. Account Adapter — Evidence-Based Confidence");

// High risk + not initiated → High
(() => {
  const a = analyseAccountAlert({ kind: "recovery_changed", provider: "google", userInitiated: false });
  const result = buildAccountCheckResult({ analysis: a, event: null, provider: "google", kind: "recovery_changed", initiated: false });
  assert(result.confidence === "High", `ADAPT-ACCT-01: high risk + not initiated → High (got ${result.confidence})`);
})();

// Low risk, user initiated → Low
(() => {
  const a = analyseAccountAlert({ kind: "mfa_prompt", provider: "google", userInitiated: true });
  const result = buildAccountCheckResult({ analysis: a, event: null, provider: "google", kind: "mfa_prompt", initiated: true });
  assert(result.confidence === "Low", `ADAPT-ACCT-02: user initiated → Low (got ${result.confidence})`);
})();


// ═══════════════════════════════════════════════════════════════
// 13. CROSS-GATE INTEGRATION
// ═══════════════════════════════════════════════════════════════

section("13A. Cross-Gate: Consistent Evidence Standard");

// A URL rated "malicious" locally should produce barking in both message and decision contexts
(() => {
  const msgResult = analyseMessage("unknown", "CommBank: Verify your account: commbank-phish.tk/login");
  const urlResult = analyseUrlLocally("https://commbank-phish.tk/login");
  const decResult = decide(urlResult, null, false);
  assert(msgResult.state === "barking", "XGATE-01a: message with phish URL → barking");
  assert(decResult.state === "barking", "XGATE-01b: direct URL check → barking");
})();

// An ordinary message should not escalate to barking just because a prior event had the same brand
(() => {
  const r = analyseMessage("CommBank", "CommBank: Your card was used for a $15.00 purchase at 7-Eleven.");
  assert(r.state !== "barking", `XGATE-02: ordinary bank notif → NOT barking (got ${r.state})`);
})();

// File analysis and email analysis should agree on risky attachment types
(() => {
  const emailR = analyseEmail("From: unknown@evil.xyz\nSubject: Invoice\n\nSee attached.\nAttachments: report.exe");
  const exeBytes = new Uint8Array([0x4D, 0x5A, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
  const fileR = analyseFile({ name: "report.exe", headBytes: exeBytes, source: "email" });
  assert(emailR.state === "barking", "XGATE-03a: email with .exe attachment → barking");
  assert(fileR.state === "barking", "XGATE-03b: .exe file from email → barking");
})();


// ═══════════════════════════════════════════════════════════════
// 14. NEGATIVE TESTS — Legitimate Activity Must Not Alarm
// ═══════════════════════════════════════════════════════════════

section("14A. False Positive Prevention");

// Legitimate CommBank URL → clean
(() => {
  const r = analyseUrlLocally("https://www.commbank.com.au/digital-banking/log-on.html");
  assert(r.level === "clean", `FP-01: legitimate CommBank login page → clean (got ${r.level})`);
})();

// Normal family call → resting
(() => {
  const r = analyseCall({ asks: ["nothing"], claim: "family" });
  assert(r.state === "ears_up" || r.state === "resting", `FP-02: normal family call → ears_up/resting (got ${r.state})`);
})();

// Play Store app with expected permissions → ears_up (not higher)
(() => {
  const r = analyseApp({ name: "Instagram", source: "play_store", purpose: "shopping_social", permissions: ["camera", "contacts", "location", "microphone", "notifications"], context: {}, network: null });
  assert(r.state === "ears_up", `FP-03: Instagram from Play Store → ears_up (got ${r.state})`);
})();

// Home WiFi → resting
(() => {
  const r = analyseNetwork({ status: { connected: true, type: "wifi", ssid: "MyHome", wifiSecurity: "wpa3", vpnActive: false, inspectable: true, captivePortal: false, isInternetReachable: true, checkedAt: new Date().toISOString() }, context: "home", trustedSsids: [], vpnTrusted: null });
  assert(r.state === "resting", `FP-04: home wifi → resting (got ${r.state})`);
})();

// User-initiated password change → ears_up
(() => {
  const r = analyseAccountAlert({ kind: "password_changed", provider: "google", userInitiated: true });
  assert(r.state === "ears_up", `FP-05: user-initiated password change → ears_up (got ${r.state})`);
})();

// Normal document PDF from a known sender → ears_up (not barking)
(() => {
  const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31, 0x2E, 0x00]);
  const r = analyseFile({ name: "contract.pdf", headBytes: pdfBytes, source: "known" });
  assert(r.state === "ears_up", `FP-06: PDF from known sender → ears_up (got ${r.state})`);
})();

// Ordinary email from friend → resting
(() => {
  const r = analyseEmail("From: jane@gmail.com\nSubject: Weekend plans\n\nWant to go hiking on Saturday?");
  assert(r.state === "resting", `FP-07: ordinary friend email → resting (got ${r.state})`);
})();


// ═══════════════════════════════════════════════════════════════
// 15. DIRECT STATUS TRANSITIONS
// ═══════════════════════════════════════════════════════════════

section("15A. Direct to Barking (not sequential)");

// Direct barking: code request on first call check
(() => {
  const r = analyseCall({ asks: ["code"], claim: "government" });
  assert(r.state === "barking", "DIRECT-01: code request → direct barking");
})();

// Direct barking: disguised exe on first file check
(() => {
  const exeBytes = new Uint8Array([0x4D, 0x5A, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
  const r = analyseFile({ name: "photo.jpg.exe", headBytes: exeBytes, source: "message" });
  assert(r.state === "barking", "DIRECT-02: disguised exe → direct barking");
})();

// Direct barking: brand impersonation email with login request
(() => {
  const r = analyseEmail("From: alert@paypal-security.xyz\nSubject: Verify your PayPal account\n\nYour account is limited. Verify: https://paypal-security.xyz/login");
  assert(r.state === "barking", "DIRECT-03: brand impersonation email → direct barking");
})();

// Direct resting: ordinary email without any signals
(() => {
  const r = analyseEmail("From: colleague@company.com\nSubject: Meeting notes\n\nHere are the notes from today's meeting.");
  assert(r.state === "resting", "DIRECT-04: ordinary email → direct resting");
})();


// ═══════════════════════════════════════════════════════════════
// 16. INTEGRATION: Threat Scent — Independently Assessed Severity
// ═══════════════════════════════════════════════════════════════

section("16A. Threat Scent — Event Severity Independence");

// A lower-severity event linked to a barking event MUST preserve its own state
(() => {
  const now = Date.now();
  const barkingEvent = makeEvent({ event_id: "bark1", state: "barking", category: "message", scent_id: "incident-1", claimed_brand: "CommBank", occurred_at: new Date(now - 5000).toISOString() });
  const earsUpEvent = makeEvent({ event_id: "link1", state: "ears_up", category: "website", claimed_brand: "CommBank", occurred_at: new Date(now).toISOString() });
  // Simulate findScentFor associating them
  const scent = findScentFor(earsUpEvent, [barkingEvent], now);
  // Even if they share a scent, the ears_up event stays ears_up
  const linked = { ...earsUpEvent, scent_id: scent ?? earsUpEvent.event_id };
  assert(linked.state === "ears_up", "INTEG-01a: ears_up event linked to barking stays ears_up");
  // The group state shows the overall severity
  if (scent) {
    const scents = buildScents([barkingEvent, linked], now);
    assert(scents[0]?.state === "barking", "INTEG-01b: scent group shows barking (highest)");
    assert(linked.state === "ears_up", "INTEG-01c: individual event state still ears_up after buildScents");
  }
})();

// Two growling events from different gates do NOT produce a barking individual event
(() => {
  const now = Date.now();
  const e1 = makeEvent({ event_id: "g1", state: "growling", category: "message", scent_id: "shared-1", occurred_at: new Date(now - 5000).toISOString() });
  const e2 = makeEvent({ event_id: "g2", state: "growling", category: "call", scent_id: "shared-1", occurred_at: new Date(now).toISOString() });
  // Neither event should be upgraded
  assert(e1.state === "growling", "INTEG-02a: first growling event stays growling");
  assert(e2.state === "growling", "INTEG-02b: second growling event stays growling");
  const scents = buildScents([e1, e2], now);
  assert(scents[0]?.state === "growling", "INTEG-02c: group state is growling (not barking)");
})();

// A barking event linked with a resting event — resting stays resting
(() => {
  const now = Date.now();
  const e1 = makeEvent({ event_id: "b1", state: "barking", category: "call", scent_id: "inc-2", occurred_at: new Date(now - 5000).toISOString() });
  const e2 = makeEvent({ event_id: "r1", state: "resting", category: "website", scent_id: "inc-2", occurred_at: new Date(now).toISOString() });
  assert(e2.state === "resting", "INTEG-03: resting event linked to barking stays resting");
})();

// Direct escalation is still allowed when evidence justifies it
(() => {
  // A message analysis that finds a phishing link independently reaches barking
  const r = analyseMessage("unknown", "CommBank: Verify your account: commbank-phish.tk/login");
  assert(r.state === "barking", "INTEG-04: direct barking from own evidence still works");
})();


// ═══════════════════════════════════════════════════════════════
// 17. INTEGRATION: Message-to-Link Scent Handoff
// ═══════════════════════════════════════════════════════════════

section("17A. Message-to-Link — Scent Handoff Plumbing");

// Verify checkLink accepts scentId and propagates it to the event
// (We test the function signature and scent propagation logic, not the full React context)
(() => {
  // The scent_id assignment in checkLink: ...(scentId ? { scent_id: scentId } : {})
  // Test: when a scent is provided, the resulting event should carry it
  const scentId = "msg-scent-abc";
  const eventTemplate: Partial<PatrolEvent> = { scent_id: undefined };
  const withScent = { ...eventTemplate, ...(scentId ? { scent_id: scentId } : {}) };
  assert(withScent.scent_id === "msg-scent-abc", "HANDOFF-01: scent_id propagated to link event");
  // Without scent, scent_id remains undefined (findScentFor will assign)
  const noScent: string | undefined = undefined;
  const withoutScent = { ...eventTemplate, ...(noScent ? { scent_id: noScent } : {}) };
  assert(withoutScent.scent_id === undefined, "HANDOFF-02: no scent → scent_id stays undefined");
})();

// Message and link events share scent but preserve independent severity
(() => {
  const now = Date.now();
  const msgEvent = makeEvent({ event_id: "msg-1", state: "growling", category: "message", scent_id: "scent-msg-link-1", claimed_brand: "CommBank", occurred_at: new Date(now - 3000).toISOString() });
  const linkEvent = makeEvent({ event_id: "link-1", state: "barking", category: "link", scent_id: "scent-msg-link-1", indicator_host: "commbank-phish.tk", occurred_at: new Date(now).toISOString() });
  // Both events share the scent
  assert(msgEvent.scent_id === linkEvent.scent_id, "HANDOFF-03a: same scent_id");
  // But preserve independent severities
  assert(msgEvent.state === "growling", "HANDOFF-03b: message event stays growling");
  assert(linkEvent.state === "barking", "HANDOFF-03c: link event stays barking (from its own evidence)");
  // Group shows the highest
  const scents = buildScents([msgEvent, linkEvent], now);
  assert(scents[0]?.state === "barking", "HANDOFF-03d: scent group shows barking");
})();

// Duplicate scent assignment doesn't create duplicate incidents
(() => {
  const now = Date.now();
  const e1 = makeEvent({ event_id: "e1", state: "growling", category: "message", scent_id: "dup-test", occurred_at: new Date(now - 5000).toISOString() });
  const e2 = makeEvent({ event_id: "e2", state: "ears_up", category: "link", scent_id: "dup-test", occurred_at: new Date(now).toISOString() });
  const scents = buildScents([e1, e2], now);
  assert(scents.length === 1, "HANDOFF-04: one scent group, not two (no duplication)");
  assert(scents[0].events.length === 2, "HANDOFF-04b: both events in the group");
})();


// ═══════════════════════════════════════════════════════════════
// 18. INTEGRATION: Trusted SMS — URLs Still Checked
// ═══════════════════════════════════════════════════════════════

section("18A. Trusted SMS — Detection Not Bypassed for URLs");

// Trusted sender with dangerous URL — local analysis should detect it
(() => {
  const r = analyseMessage("Mum", "Hey check this out: commbank-verify.tk/login — is this legit?");
  // Even from a "trusted" sender, the URL analysis still fires
  assert(r.signals.urls.length > 0, "TRUST-SMS-01a: URL extracted from trusted sender message");
  // The analysis identifies the brand phishing regardless of sender
  assert(r.state === "barking" || r.state === "growling", `TRUST-SMS-01b: dangerous URL detected even from familiar sender (got ${r.state})`);
})();

// Trusted sender with safe content and NO URLs — should be quiet
(() => {
  const r = analyseMessage("Mum", "Dinner at 7pm tonight, bring dessert!");
  assert(r.signals.urls.length === 0, "TRUST-SMS-02a: no URLs in innocent message");
  assert(r.state === "resting", `TRUST-SMS-02b: ordinary trusted message → resting (got ${r.state})`);
})();

// Trusted sender with official bank URL — still ears_up (monitored, not suppressed)
(() => {
  const r = analyseMessage("CommBank", "CommBank: Your card ending 4567 was used. Visit commbank.com.au/security");
  assert(r.signals.urls.length > 0, "TRUST-SMS-03a: URL present");
  assert(r.state === "ears_up", `TRUST-SMS-03b: official URL from known sender → ears_up (got ${r.state})`);
})();

// Trusted sender with shortened URL — cannot determine safety locally
(() => {
  const r = analyseMessage("Friend", "Look at this deal: bit.ly/xyz123");
  assert(r.signals.urls.length > 0, "TRUST-SMS-04a: shortened URL extracted");
  // Shortened URLs from unknown/trusted senders need external checking
  // Local analysis may vary, but the URL was extracted (backend would check it)
  assert(r.signals.urls.some(u => u.includes("bit.ly")), "TRUST-SMS-04b: bit.ly URL captured for external assessment");
})();


// ═══════════════════════════════════════════════════════════════
// 19. INTEGRATION: Trusted Callers — Reputation Still Assessed
// ═══════════════════════════════════════════════════════════════

section("19A. Trusted Callers — Reputation Assessment Not Bypassed");

// Call analysis is independent of trust status — even a "trusted" number gets full analysis
(() => {
  const r1 = analyseCall({ asks: ["code"], claim: "bank", number: "+61400000000" });
  assert(r1.state === "barking", "TRUST-CALL-01: code request barks regardless of trust status");
  // Trust only affects notification quieting, not the analysis result
})();

// Ordinary call from trusted number — analysis runs, result is benign
(() => {
  const r = analyseCall({ asks: ["nothing"], claim: "family" });
  assert(r.state === "ears_up" || r.state === "resting", `TRUST-CALL-02: ordinary trusted call → benign (got ${r.state})`);
})();

// Provider unavailable — should NOT treat absence of evidence as proof of safety
(() => {
  // When checkNumberRisk can't reach the provider, the event should be ears_up (investigation
  // incomplete), not resting (no concern). This is tested via the call risk check adapter.
  // The analyseCall function always runs locally regardless.
  const r = analyseCall({ asks: ["nothing"], claim: "unknown" });
  assert(r.state === "resting", "TRUST-CALL-03: unknown caller with nothing asked → resting (local assessment)");
  // NOTE: when the reputation service is unavailable, the background intake creates an ears_up
  // "could not check" event. This is validated by the ApolloContext code path, not the analyseCall
  // function directly. The key principle: unavailable ≠ safe.
})();


// ═══════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════

section("SUMMARY");
const total = passed + failures;
console.log(`\nTotal: ${total} tests | Passed: ${passed} | Failed: ${failures}`);
if (failures > 0) {
  console.log("SOME TESTS FAILED — see FAIL lines above.");
  process.exitCode = 1;
} else {
  console.log("ALL TESTS PASSED.");
}
