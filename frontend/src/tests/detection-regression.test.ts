/**
 * Apollo Scam Guard — Detection Regression Tests
 *
 * Tests the pure domain functions directly. No network calls, no Expo runtime.
 * Run: cd /app/frontend && npx tsc --noEmit --skipLibCheck && node -e "require('./src/tests/detection-regression.test.ts')"
 * Or use ts-node.
 */

import { analyseUrlLocally } from "../domain/risk";
import { analyseMessage, extractSignals } from "../domain/messageAnalysis";
import { analysePage } from "../domain/pageAnalysis";
import { assessBrand } from "../domain/brand";

// — Helpers —

let failures = 0;
function assert(condition: boolean, label: string) {
  if (!condition) {
    console.error(`  FAIL: ${label}`);
    failures++;
  } else {
    console.log(`  PASS: ${label}`);
  }
}

function section(name: string) { console.log(`\n== ${name} ==`); }

// ——————————————————————————————————————————————————————————————
// 1. Score-Based Barking Gate (MF-1) + credential_lure isIp (MF-2)
// ——————————————————————————————————————————————————————————————

section("MF-1 + MF-2: Score-based barking gate and IP credential_lure");

// SG-01: Router admin page — structural signals only, must NOT bark.
(() => {
  const result = analyseUrlLocally("http://192.168.1.1:8080/login");
  assert(!result.signals.some(s => s.code === "credential_lure"), "SG-01a: credential_lure does NOT fire on bare IP");
  assert(result.signals.some(s => s.code === "credential_word"), "SG-01b: credential_word fires instead");
  assert(result.level !== "malicious", "SG-01c: level is NOT malicious (structural only)");
  assert(result.level === "suspicious", "SG-01d: level is suspicious (growling)");
  console.log(`  SG-01 score: ${result.score}, level: ${result.level}, signals: ${result.signals.map(s => s.code).join(", ")}`);
})();

// SG-02: Phishing page with brand — deception signal present, MUST reach malicious.
(() => {
  const result = analyseUrlLocally("https://commbank-login.example.xyz/account/update");
  assert(result.signals.some(s => s.code === "brand_lookalike"), "SG-02a: brand_lookalike fires");
  assert(result.signals.some(s => s.code === "credential_lure"), "SG-02b: credential_lure fires (via lookalike)");
  assert(result.level === "malicious", "SG-02c: level is malicious (deception signal present)");
  console.log(`  SG-02 score: ${result.score}, level: ${result.level}, signals: ${result.signals.map(s => s.code).join(", ")}`);
})();

// SG-03: Deep hostname structural noise — NO deception, must NOT reach malicious.
(() => {
  const result = analyseUrlLocally("http://test.staging.dev.corp.xyz:9090/dashboard");
  const deception = ["brand_lookalike", "brand_in_path", "credentials_in_url", "credential_lure", "known_test_threat"];
  assert(!result.signals.some(s => deception.includes(s.code)), "SG-03a: no deception signals");
  assert(result.level !== "malicious", "SG-03b: level is NOT malicious");
  // Corrected: insecure(12) + port(15) + risky_tld(15) + deep_subdomains(15) = 57
  assert(result.score === 57, `SG-03c: score is 57 (got ${result.score})`);
  console.log(`  SG-03 score: ${result.score}, level: ${result.level}, signals: ${result.signals.map(s => s.code).join(", ")}`);
})();

// SG-04: Emerging phishing scam — brand impersonation on risky TLD. Must be malicious.
(() => {
  const result = analyseUrlLocally("https://paypal-verify.tk/login");
  assert(result.signals.some(s => s.code === "brand_lookalike"), "SG-04a: brand_lookalike fires");
  assert(result.level === "malicious", "SG-04b: level is malicious");
  console.log(`  SG-04 score: ${result.score}, level: ${result.level}, signals: ${result.signals.map(s => s.code).join(", ")}`);
})();

// SG-05 (corrected): credentials_in_url on evil.com — scores 45, suspicious/growling.
(() => {
  const result = analyseUrlLocally("https://user:pass@evil.com/@commbank.com.au");
  assert(result.signals.some(s => s.code === "credentials_in_url"), "SG-05a: credentials_in_url fires");
  assert(result.level === "suspicious", "SG-05b: level is suspicious (45 points)");
  assert(result.score === 45, `SG-05c: score is 45 (got ${result.score})`);
  console.log(`  SG-05 score: ${result.score}, level: ${result.level}, signals: ${result.signals.map(s => s.code).join(", ")}`);
})();

// CL-01: IP with credential word — post-MF2, lower score.
(() => {
  const result = analyseUrlLocally("http://192.168.1.1/login");
  assert(!result.signals.some(s => s.code === "credential_lure"), "CL-01a: no credential_lure");
  // ip_host(35) + insecure(12) + credential_word(6) = 53
  assert(result.score === 53, `CL-01b: score is 53 (got ${result.score})`);
  console.log(`  CL-01 score: ${result.score}, level: ${result.level}`);
})();

// CL-02: IP with brand in path — credential_lure STILL fires (via brandInPath condition).
(() => {
  const result = analyseUrlLocally("http://192.168.1.1/paypal-login");
  assert(result.signals.some(s => s.code === "brand_in_path"), "CL-02a: brand_in_path fires");
  assert(result.signals.some(s => s.code === "credential_lure"), "CL-02b: credential_lure fires (via brandInPath)");
  assert(result.level === "malicious", "CL-02c: level is malicious (deception signal present)");
  console.log(`  CL-02 score: ${result.score}, level: ${result.level}`);
})();

// Punycode international domain — must NOT bark from structure alone.
// After fix: many_hyphens suppressed for punycode hosts (hyphens are part of IDN encoding).
(() => {
  const result = analyseUrlLocally("https://xn--mnchen-3ya.de/buergerservice");
  assert(result.level === "uncertain", `INT-01: punycode alone is uncertain (got ${result.level})`);
  assert(!result.signals.some(s => s.code === "many_hyphens"), "INT-01b: many_hyphens suppressed for punycode");
  console.log(`  INT-01 score: ${result.score}, level: ${result.level}`);
})();

// Legitimate bank URL — must be clean.
(() => {
  const result = analyseUrlLocally("https://www.commbank.com.au/netbank");
  assert(result.level === "clean", "LEGIT-01: legitimate bank URL is clean");
  console.log(`  LEGIT-01 score: ${result.score}, level: ${result.level}`);
})();

// ——————————————————————————————————————————————————————————————
// 2. M02 Official URL Check (MF-3 + MF-4)
// ——————————————————————————————————————————————————————————————

section("MF-3 + MF-4: M02 bank URL check and factual why-text");

// M02-01: Bank message with official URL — should reduce to ears_up.
(() => {
  const result = analyseMessage("CommBank", "CommBank: Your card ending 4567 was used for $89.50 at Woolworths. Visit commbank.com.au/security");
  assert(result.scenario === "M02", "M02-01a: scenario is M02");
  assert(result.state === "ears_up", `M02-01b: state is ears_up (got ${result.state})`);
  assert(!result.why.some((w: string) => w.includes("does not lead to")), "M02-01c: why text does NOT falsely assert non-official destination");
  console.log(`  M02-01 state: ${result.state}, why: ${result.why.join(" | ")}`);
})();

// M02-02: Bank message with non-official URL — should still bark.
(() => {
  const result = analyseMessage("unknown", "CommBank: Your account has been locked. Verify now: commbank-alerts.xyz/verify");
  assert(result.state === "barking", `M02-02: state is barking (got ${result.state})`);
  console.log(`  M02-02 state: ${result.state}, scenario: ${result.scenario}`);
})();

// M02-04: ANZ statement with official URL — ears_up.
(() => {
  const result = analyseMessage("ANZ", "ANZ: Your statement is ready. View at anz.com.au/statements");
  assert(result.scenario === "M02", "M02-04a: scenario is M02");
  assert(result.state === "ears_up", `M02-04b: state is ears_up (got ${result.state})`);
  console.log(`  M02-04 state: ${result.state}`);
})();

// M02-05: Bank message with shortened URL — barks (not official).
(() => {
  const result = analyseMessage("unknown", "Your bank account has been locked. Click here: bit.ly/abc123");
  assert(result.state === "barking", `M02-05: barking (got ${result.state})`);
  console.log(`  M02-05 state: ${result.state}, scenario: ${result.scenario}`);
})();

// ——————————————————————————————————————————————————————————————
// 3. Brand Detection
// ——————————————————————————————————————————————————————————————

section("Brand detection");

// Homograph detection (rn→m).
(() => {
  const result = assessBrand("comrnbank.com");
  assert(result.claimed !== null, "BRAND-01a: comrnbank.com matches a brand");
  assert(result.claimed?.name === "CommBank", "BRAND-01b: claimed is CommBank");
  assert(result.homograph === true, "BRAND-01c: homograph detected");
  assert(result.isOfficial === false, "BRAND-01d: not an official domain");
  console.log(`  BRAND-01: claimed=${result.claimed?.name}, homograph=${result.homograph}, official=${result.isOfficial}`);
})();

// Official domain.
(() => {
  const result = assessBrand("www.commbank.com.au");
  assert(result.isOfficial === true, "BRAND-02: commbank.com.au is official");
  console.log(`  BRAND-02: official=${result.isOfficial}`);
})();

// No brand.
(() => {
  const result = assessBrand("example.com");
  assert(result.claimed === null, "BRAND-03: example.com has no brand match");
  console.log(`  BRAND-03: claimed=${result.claimed}`);
})();

// ——————————————————————————————————————————————————————————————
// 4. Page Analysis — Wallet FP Fix
// ——————————————————————————————————————————————————————————————

section("Page analysis: wallet page fix");

// Wallet connect REQUEST — still barks.
(() => {
  const result = analysePage({
    visible_url: "https://app.scamsite.xyz/connect",
    claimed_brand: null,
    page_type: "wallet",
    wallet_connect_request: true,
    asks_for: ["wallet_connect"],
    page_signals: [],
    payment_methods: [],
  } as any, "https://app.scamsite.xyz/connect");
  assert(result.state === "barking", `PAGE-01: wallet_connect_request → barking (got ${result.state})`);
  console.log(`  PAGE-01 state: ${result.state}, scenario: ${result.scenario}`);
})();

// Wallet page type without connect request — NOT barking.
(() => {
  const result = analysePage({
    visible_url: "https://app.uniswap.org/swap",
    claimed_brand: null,
    page_type: "wallet",
    wallet_connect_request: false,
    asks_for: [],
    page_signals: [],
    payment_methods: [],
  } as any, "https://app.uniswap.org/swap");
  assert(result.state !== "barking", `PAGE-02: wallet page WITHOUT connect request → NOT barking (got ${result.state})`);
  console.log(`  PAGE-02 state: ${result.state}, scenario: ${result.scenario}`);
})();

// ——————————————————————————————————————————————————————————————
// Summary
// ——————————————————————————————————————————————————————————————

section("Summary");
console.log(`\nTotal failures: ${failures}`);
if (failures > 0) {
  console.log("SOME TESTS FAILED — see FAIL lines above.");
  process.exitCode = 1;
} else {
  console.log("ALL TESTS PASSED.");
}
