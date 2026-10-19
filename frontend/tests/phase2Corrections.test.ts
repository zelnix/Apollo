/**
 * Targeted regression tests for Phase 2 corrections:
 *
 * 1. Protection Details rejects optional-setup / never-activated / platform-limited capabilities
 *    as security incidents — only genuine automatic-protection regressions appear.
 *
 * 2. Higgins' visibility-lost fallback routes to the Protection tab when no automatic capabilities
 *    are genuinely affected (not to an empty Protection Details screen).
 *
 * 3. The data retention test assertion matches the actual disclosure wording.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildProtectionFindings } from "../src/domain/protectionDetails.ts";
import { buildHomeVoice, affectedCapabilities } from "../src/domain/higginsHomeVoice.ts";
import { AI_PROCESSING_DISCLOSURE } from "../src/domain/privacyInventory.ts";
import type { Capability } from "../src/domain/types.ts";

// ── Helpers ──

/** Build a minimal GatePresentation for testing. */
function fakeGate(id: string, opts: {
  title?: string;
  tone?: string;
  statusLabel?: string;
  currentHelp?: string;
  autoState?: string;
  manualOnly?: boolean;
}) {
  return {
    id,
    title: opts.title ?? `${id} Gate`,
    tone: opts.tone ?? "neutral",
    statusLabel: opts.statusLabel ?? "Setup required",
    currentHelp: opts.currentHelp ?? "test help",
    capability: {
      automatic: opts.autoState !== undefined ? {
        state: opts.autoState,
        kind: "monitoring" as const,
        manualOnly: opts.manualOnly ?? false,
      } : undefined,
      onDemand: { available: true },
    },
    primaryAction: undefined,
  };
}

function fakeCap(id: string, status: string, detail = "test"): Capability {
  return { id, title: id, status, detail } as Capability;
}

// ── 1. Protection Details: optional / never-activated / platform-limited must NOT appear ──

describe("Protection Details — no false security incidents", () => {
  it("skips automatic capabilities in never-activated gate state", () => {
    const findings = buildProtectionFindings({
      capabilities: [
        fakeCap("site_guard", "permission_required", "VPN not granted"),
      ],
      gates: [
        fakeGate("site", { title: "Site Gate", tone: "neutral", autoState: "permission_needed" }) as any,
      ],
      attention: [],
      events: [],
    });
    // permission_needed gate → never activated → not a security incident
    assert.equal(findings.length, 0, "Never-activated gate must not appear as a finding");
  });

  it("skips automatic capabilities in user-choice-off gate state", () => {
    const findings = buildProtectionFindings({
      capabilities: [
        fakeCap("site_guard", "inactive", "User turned off"),
      ],
      gates: [
        fakeGate("site", { title: "Site Gate", tone: "off", autoState: "off_by_choice" }) as any,
      ],
      attention: [],
      events: [],
    });
    assert.equal(findings.length, 0, "User-choice-off gate must not appear as a finding");
  });

  it("skips automatic capabilities in not_activated gate state", () => {
    const findings = buildProtectionFindings({
      capabilities: [
        fakeCap("connection_guard", "inactive", "Not activated"),
      ],
      gates: [
        fakeGate("network", { title: "Internet Gate", tone: "neutral", autoState: "not_activated" }) as any,
      ],
      attention: [],
      events: [],
    });
    assert.equal(findings.length, 0, "not_activated gate must not appear as a finding");
  });

  it("INCLUDES genuinely interrupted automatic capabilities", () => {
    const findings = buildProtectionFindings({
      capabilities: [
        fakeCap("site_guard", "permission_required", "Permission revoked"),
      ],
      gates: [
        fakeGate("site", { title: "Site Gate", tone: "action", autoState: "interrupted" }) as any,
      ],
      attention: [],
      events: [],
    });
    // interrupted = was running, now stopped → genuine infrastructure finding
    assert.equal(findings.length, 1, "Interrupted gate MUST appear as a finding");
    assert.equal(findings[0].gate, "Site Gate");
    assert.equal(findings[0].findingType, "infrastructure");
  });

  it("skips all manual capabilities regardless of state", () => {
    const findings = buildProtectionFindings({
      capabilities: [
        fakeCap("link_guard", "permission_required", "Needs permission"),
        fakeCap("app_guard", "inactive", "Not running"),
        fakeCap("known_threats", "available", "Ready"),
      ],
      gates: [],
      attention: [],
      events: [],
    });
    assert.equal(findings.length, 0, "Manual capabilities must never create findings");
  });

  it("section 4: skips gates with never-activated auto state even if tone is unverified", () => {
    const findings = buildProtectionFindings({
      capabilities: [],
      gates: [
        fakeGate("network", {
          title: "Internet Gate", tone: "unverified", autoState: "permission_needed",
          currentHelp: "Needs VPN",
        }) as any,
      ],
      attention: [],
      events: [],
    });
    assert.equal(findings.length, 0, "Never-activated unverified gate must not appear");
  });

  it("section 4: INCLUDES running-but-limited gates", () => {
    const findings = buildProtectionFindings({
      capabilities: [],
      gates: [
        fakeGate("network", {
          title: "Internet Gate", tone: "limited", autoState: "running",
          currentHelp: "Running with limited coverage",
        }) as any,
      ],
      attention: [],
      events: [],
    });
    assert.equal(findings.length, 1, "Running-but-limited gate MUST appear");
    assert.equal(findings[0].statusLabel, "Limited coverage");
  });
});

// ── 2. Higgins navigation: limited-coverage fallback → Protection tab ──

describe("Higgins navigation — limited coverage routes to Protection tab", () => {
  it("visibility-lost with no genuinely affected automatics → Protection tab (not Details)", () => {
    const voice = buildHomeVoice({
      resolution: {
        state: "growling",
        visibilityLost: true,
        recovering: false,
        reason: "Limited coverage",
      } as any,
      attention: [],
      gates: [],
      capabilities: [
        // All unsupported or available — nothing genuinely degraded
        fakeCap("site_guard", "unsupported"),
        fakeCap("connection_guard", "available"),
        fakeCap("message_guard", "unsupported"),
      ],
    });
    assert.equal(voice.ctaRoute, "/(tabs)/protection",
      "Fallback must route to Protection tab, not Protection Details");
    assert.equal(voice.ctaLabel, "View Protection",
      "CTA label must say 'View Protection', not 'View Protection Details'");
    assert.ok(voice.text.includes("limited on this device"),
      "Text must explain protections are limited, not claim they're failing");
  });

  it("visibility-lost with genuinely affected automatics → Protection Details", () => {
    const voice = buildHomeVoice({
      resolution: {
        state: "growling",
        visibilityLost: true,
        recovering: false,
        reason: "Limited coverage",
      } as any,
      attention: [],
      gates: [],
      capabilities: [
        fakeCap("connection_guard", "inactive"), // genuinely affected
      ],
    });
    assert.equal(voice.ctaRoute, "/protection-details",
      "Genuinely affected must route to Protection Details");
    assert.ok(voice.text.includes("Internet Gate"),
      "Must name the genuinely affected gate");
  });
});

// ── 3. affectedCapabilities filters ──

describe("affectedCapabilities — only genuine automatic degradation", () => {
  it("excludes manual-only capabilities", () => {
    const result = affectedCapabilities([
      fakeCap("link_guard", "inactive"),
      fakeCap("app_guard", "permission_required"),
      fakeCap("known_threats", "inactive"),
      fakeCap("share_intake", "inactive"),
    ]);
    assert.equal(result.length, 0, "Manual-only capabilities must be excluded");
  });

  it("excludes 'available' (readiness, not failure)", () => {
    const result = affectedCapabilities([
      fakeCap("site_guard", "available"),
      fakeCap("connection_guard", "available"),
    ]);
    assert.equal(result.length, 0, "'available' must be excluded");
  });

  it("excludes 'unsupported' (platform limitation)", () => {
    const result = affectedCapabilities([
      fakeCap("site_guard", "unsupported"),
      fakeCap("message_guard", "unsupported"),
    ]);
    assert.equal(result.length, 0, "'unsupported' must be excluded");
  });

  it("includes genuinely degraded automatic capabilities", () => {
    const result = affectedCapabilities([
      fakeCap("connection_guard", "inactive"),
      fakeCap("site_guard", "permission_required"),
    ]);
    assert.equal(result.length, 2, "Genuinely degraded automatics must be included");
  });
});

// ── 4. Data retention disclosure wording ──

describe("Data retention disclosure", () => {
  it("states data is not used for model training (exact wording)", () => {
    const section = AI_PROCESSING_DISCLOSURE.sections.find(
      (s) => s.heading === "Data retention"
    );
    assert.ok(section, "Missing Data retention section");
    assert.ok(section.text.includes("not used for model training"),
      "Must use 'not used for model training' wording");
    assert.ok(section.text.includes("15 minutes"),
      "Must state 15-minute retention bound");
  });
});
