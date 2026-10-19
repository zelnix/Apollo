// Anti-drift Tests — Consolidation Compliance
//
// Tests against ACTUAL resolver behaviour (not assert(true) stubs) and
// source/architecture checks that detect:
// - Duplicate privacy patterns
// - Hardcoded registry URLs in adapters
// - Local toneForState definitions
// - Local GateId definitions

import { resolveProtectionState } from "../src/domain/protectionStateResolver.ts";
import { GATE_REGISTRY, gateName, ALL_GATE_IDS } from "../src/domain/gateRegistry.ts";
import { toneForState, buildEvidenceRows, buildEvidenceRowsFromTechnical, appendEventContext, buildCheckResult } from "../src/domain/checkResultFramework.ts";
import { CREDENTIAL_PATTERNS, FINANCIAL_MEDICAL_PATTERNS, PHONE_PATTERN, EMAIL_PATTERN, SENDER_CONTEXT_PATTERNS } from "../src/domain/privacyPolicy.ts";
import { detectSensitiveContent } from "../src/domain/imagePrivacyCore.ts";
import { ACTION_LINKS } from "../src/domain/actionRegistry.ts";
import * as fs from "node:fs";
import * as path from "node:path";

let passed = 0;
let failed = 0;

function assert(ok, name, detail = "") {
  if (ok) { console.log("  PASS: " + name); passed++; }
  else    { console.log("  FAIL: " + name + " — " + detail); failed++; }
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Protection State Resolver — actual behaviour
// ═══════════════════════════════════════════════════════════════════════════
console.log("\n[1] Protection State Resolver — real behaviour tests");
{
  // running + NOT manualOnly → Watching / active_verified
  let r = resolveProtectionState({ automaticState: "running", manualOnly: false });
  assert(r.statusLabel === "Watching", "running → Watching", "got: " + r.statusLabel);
  assert(r.coverageState === "active_verified", "running → active_verified", "got: " + r.coverageState);

  // running + manualOnly → Manual check / setup_available (THE BUG FIX)
  r = resolveProtectionState({ automaticState: "running", manualOnly: true });
  assert(r.statusLabel === "Manual check", "manualOnly running → Manual check", "got: " + r.statusLabel);
  assert(r.coverageState === "setup_available", "manualOnly running → setup_available", "got: " + r.coverageState);
  assert(r.coverageState !== "active_verified", "manualOnly NEVER produces active_verified");

  // running + coverageLimited → Limited
  r = resolveProtectionState({ automaticState: "running", coverageLimited: true });
  assert(r.statusLabel === "Limited", "coverageLimited → Limited", "got: " + r.statusLabel);

  // permission_needed → Setup required
  r = resolveProtectionState({ automaticState: "permission_needed" });
  assert(r.statusLabel === "Setup required", "permission_needed → Setup required");
  assert(r.coverageState === "setup_available", "permission_needed → setup_available");

  // interrupted → Action needed
  r = resolveProtectionState({ automaticState: "interrupted" });
  assert(r.statusLabel === "Action needed", "interrupted → Action needed");
  assert(r.coverageState === "temporarily_unavailable", "interrupted → temporarily_unavailable");

  // off_by_choice → Off / disabled_by_user
  r = resolveProtectionState({ automaticState: "off_by_choice" });
  assert(r.statusLabel === "Off", "off_by_choice → Off");
  assert(r.coverageState === "disabled_by_user", "off_by_choice → disabled_by_user");

  // temporarily_unavailable → Unable to verify / active_unverified
  r = resolveProtectionState({ automaticState: "temporarily_unavailable" });
  assert(r.statusLabel === "Unable to verify", "temporarily_unavailable → Unable to verify");
  assert(r.coverageState === "active_unverified", "temporarily_unavailable → active_unverified");

  // no auto, on-demand ready → Manual check
  r = resolveProtectionState({ onDemandState: "ready" });
  assert(r.statusLabel === "Manual check", "on-demand ready → Manual check");
  assert(r.coverageState === "setup_available", "on-demand ready → setup_available");

  // unsupported → Unavailable
  r = resolveProtectionState({ automaticState: "unsupported" });
  assert(r.statusLabel === "Unavailable", "unsupported → Unavailable");
  assert(r.coverageState === "unsupported", "unsupported → unsupported");
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. Gate Registry — canonical source
// ═══════════════════════════════════════════════════════════════════════════
console.log("\n[2] Gate Registry — completeness");
{
  for (const id of ALL_GATE_IDS) {
    const meta = GATE_REGISTRY[id];
    assert(!!meta, "Gate " + id + " exists");
    assert(meta.name.length > 0, "Gate " + id + " has name");
    assert(meta.checkResultGate.length > 0, "Gate " + id + " has checkResultGate");
    assert(gateName(id) === meta.name, "gateName(" + id + ") consistent");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. Tone mapping — ONE function, consistent
// ═══════════════════════════════════════════════════════════════════════════
console.log("\n[3] Tone mapping — consistent for all states");
{
  const cases = [
    ["biting", "biting"], ["barking", "barking"], ["growling", "growling"],
    ["ears_up", "ears_up"], ["resting", "resting"],
    ["sniffing", "neutral"], [undefined, "neutral"], ["unknown", "neutral"],
  ];
  for (const [input, expected] of cases) {
    assert(toneForState(input) === expected, "toneForState(" + input + ") = " + expected);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. Check result framework — buildCheckResult produces correct structure
// ═══════════════════════════════════════════════════════════════════════════
console.log("\n[4] buildCheckResult — correct structure");
{
  const result = buildCheckResult({
    gate: "Test gate", checkType: "Test check", subject: "Test",
    headline: "Test headline", higginsSays: "Test says", state: "barking",
    items: [{ id: "t1", name: "Test item", status: "concern", finding: "Found" }],
    confidence: "High", evidence: [{ label: "Key", value: "Val" }],
    event: { event_id: "evt-12345678", type: "test", state: "barking", timestamp: "", gate: "test" },
  });
  assert(result.tone === "barking", "buildCheckResult tone from state");
  assert(result.id === "evt-12345678", "buildCheckResult id from event");
  assert(result.completedAt.length > 0, "buildCheckResult has completedAt");
  assert(result.investigationId === "evt-12345678", "buildCheckResult investigationId from event");

  // Evidence helpers
  const rows = buildEvidenceRows([
    { label: "A", value: "1" }, { label: "B", value: null }, { label: "C", value: "" }, { label: "D", value: "4" },
  ]);
  assert(rows.length === 2, "buildEvidenceRows filters null/empty", "got " + rows.length);

  const techRows = buildEvidenceRowsFromTechnical(["Source: Google Play", "Bad format"]);
  assert(techRows[0].label === "Source" && techRows[0].value === "Google Play", "buildEvidenceRowsFromTechnical splits");
  assert(techRows[1].label === "Detail", "buildEvidenceRowsFromTechnical fallback label");

  const ev = [];
  appendEventContext(ev, { scenario: "A01", eventId: "abcdef12345678" });
  assert(ev.length === 2, "appendEventContext adds 2 rows");
  assert(ev[1].value.includes("abcdef12"), "appendEventContext truncates event ID");
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. Privacy policy — canonical source
// ═══════════════════════════════════════════════════════════════════════════
console.log("\n[5] Privacy policy — patterns from privacyPolicy.ts");
{
  assert(CREDENTIAL_PATTERNS.length >= 10, "Credential patterns exist (" + CREDENTIAL_PATTERNS.length + ")");
  assert(FINANCIAL_MEDICAL_PATTERNS.length >= 3, "Financial/medical patterns exist");
  assert(PHONE_PATTERN instanceof RegExp, "Phone pattern is RegExp");
  assert(EMAIL_PATTERN instanceof RegExp, "Email pattern is RegExp");
  assert(SENDER_CONTEXT_PATTERNS.length >= 4, "Sender context patterns exist");
  assert(detectSensitiveContent("password: secret123").some(d => d.type === "credential"), "Detection uses policy credentials");
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. Action registry — all links present
// ═══════════════════════════════════════════════════════════════════════════
console.log("\n[6] Action registry — URLs from one source");
{
  const keys = Object.keys(ACTION_LINKS);
  assert(keys.length >= 10, "At least 10 action links defined (" + keys.length + ")");
  for (const [key, link] of Object.entries(ACTION_LINKS)) {
    assert(link.label.length > 0, "Action " + key + " has label");
    assert(link.url.startsWith("https://") || link.url.startsWith("mailto:"), "Action " + key + " URL valid");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 7. Sanitisation upload — fail closed for image decisions
// ═══════════════════════════════════════════════════════════════════════════
console.log("\n[7] Image uploads carry no approval ceremony");
{
  const src = fs.readFileSync(new URL("../app/message.tsx", import.meta.url), "utf8");
  assert(!src.includes("sanitization_digest") && !src.includes("buildApprovedUploadFields"), "message upload sends no digest/approval fields");
}

// ═══════════════════════════════════════════════════════════════════════════
// 8. SOURCE SCAN: No duplicate toneForState in adapters
// ═══════════════════════════════════════════════════════════════════════════
console.log("\n[8] Source scan — no duplicate toneForState in adapters");
{
  const domainDir = path.resolve(import.meta.dirname, "../src/domain");
  const adapterFiles = fs.readdirSync(domainDir).filter(f => f.endsWith("Adapter.ts") || f.endsWith("adapter.ts"));
  let duplicateFound = false;
  for (const file of adapterFiles) {
    const content = fs.readFileSync(path.join(domainDir, file), "utf-8");
    if (/^function toneForState/m.test(content)) {
      console.log("    DUPLICATE toneForState in " + file);
      duplicateFound = true;
    }
  }
  assert(!duplicateFound, "No adapter defines its own toneForState");
}

// ═══════════════════════════════════════════════════════════════════════════
// 9. SOURCE SCAN: No hardcoded reporting URLs in adapters
// ═══════════════════════════════════════════════════════════════════════════
console.log("\n[9] Source scan — no hardcoded reporting URLs in adapters");
{
  const domainDir = path.resolve(import.meta.dirname, "../src/domain");
  const adapterFiles = fs.readdirSync(domainDir).filter(f => (f.endsWith("Adapter.ts") || f.endsWith("adapter.ts")) && f !== "actionRegistry.ts");
  const urlPatterns = [
    /reportfraud\.ftc\.gov/,
    /fcc\.gov.*complaint/,
    /safebrowsing\.google\.com.*report/,
    /reportaproblem\.apple\.com/,
    /haveibeenpwned\.com/,
    /consumer\.ftc\.gov.*public-wi-fi/,
    /identitytheft\.gov/,
    /ic3\.gov/,
    /myaccount\.google\.com/,
    /appleid\.apple\.com/,
    /account\.live\.com/,
  ];
  let hardcodedFound = false;
  for (const file of adapterFiles) {
    const content = fs.readFileSync(path.join(domainDir, file), "utf-8");
    // Only flag actual string literals (in quotes), not import references
    for (const pattern of urlPatterns) {
      // Match URLs in string literals (single or double quotes)
      const stringLiteralRegex = new RegExp(`["']` + pattern.source + `[^"']*["']`);
      if (stringLiteralRegex.test(content)) {
        console.log("    HARDCODED URL in " + file + ": " + pattern);
        hardcodedFound = true;
      }
    }
  }
  assert(!hardcodedFound, "No adapter has hardcoded reporting URLs");
}

// ═══════════════════════════════════════════════════════════════════════════
// 10. SOURCE SCAN: No local GateId type in gates.ts
// ═══════════════════════════════════════════════════════════════════════════
console.log("\n[10] Source scan — GateId imported, not redefined");
{
  const gatesContent = fs.readFileSync(path.resolve(import.meta.dirname, "../src/domain/gates.ts"), "utf-8");
  const definesGateId = /^export type GateId\s*=/m.test(gatesContent);
  assert(!definesGateId, "gates.ts does not define GateId (imports from gateRegistry)");
  const importsGateId = gatesContent.includes('GateId') && gatesContent.includes('gateRegistry');
  assert(importsGateId, "gates.ts imports GateId from gateRegistry");
}

// ═══════════════════════════════════════════════════════════════════════════
// 11. SOURCE SCAN: No duplicate credential patterns in privacy.ts
// ═══════════════════════════════════════════════════════════════════════════
console.log("\n[11] Source scan — privacy.ts has no local credential patterns");
{
  const privacyContent = fs.readFileSync(path.resolve(import.meta.dirname, "../src/domain/privacy.ts"), "utf-8");
  // Should NOT have inline credential regex (password|passcode etc.) — only imports from privacyPolicy
  const hasInlineCredentialRegex = /\/(?:password|passcode|p\\.?\s*i\\.?\s*n).*\\s\*.*\\S\+\//m.test(privacyContent);
  assert(!hasInlineCredentialRegex, "privacy.ts has no inline credential regex");
  const importsCreds = privacyContent.includes("CREDENTIAL_PATTERNS") && privacyContent.includes("privacyPolicy");
  assert(importsCreds, "privacy.ts imports CREDENTIAL_PATTERNS from privacyPolicy");
}

// ═══════════════════════════════════════════════════════════════════════════
// 12. SOURCE SCAN: No GATE_LABEL in homeStatusResolver.ts
// ═══════════════════════════════════════════════════════════════════════════
console.log("\n[12] Source scan — no GATE_LABEL in homeStatusResolver");
{
  const content = fs.readFileSync(path.resolve(import.meta.dirname, "../src/domain/homeStatusResolver.ts"), "utf-8");
  assert(!content.includes("GATE_LABEL"), "homeStatusResolver has no GATE_LABEL map");
  assert(content.includes("gateName"), "homeStatusResolver uses gateName() from registry");
}

// Summary
console.log("\n" + "=".repeat(60));
console.log("ANTI-DRIFT TESTS: " + passed + "/" + (passed + failed) + " passed");
console.log("=".repeat(60));
if (failed > 0) process.exit(1);
