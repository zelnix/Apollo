/**
 * Targeted regression tests for Phase 2 corrections:
 *
 * 1. Higgins' visibility-lost fallback routes to the Protection tab when no automatic capabilities
 *    are genuinely affected (not to an empty Protection Details screen).
 *
 * 2. The data retention test assertion matches the actual disclosure wording.
 *
 * The Protection Details section that used to open this file went with
 * src/domain/protectionDetails.ts when that screen was removed.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildHomeVoice, affectedCapabilities } from "../src/domain/higginsHomeVoice.ts";
import { AI_PROCESSING_DISCLOSURE } from "../src/domain/privacyInventory.ts";
import type { Capability } from "../src/domain/types.ts";

// ── Helpers ──

function fakeCap(id: string, status: string, detail = "test"): Capability {
  return { id, title: id, status, detail } as Capability;
}

// ── 1. Higgins navigation: limited-coverage fallback → Protection tab ──

describe("Higgins navigation — limited coverage routes to the Protection tab", () => {
  // One behaviour, whatever the capability mix: visibility loss is reported as reduced coverage on
  // this device and points at the Protection tab. It never claims protection is failing, and the
  // separate Protection Details screen it used to branch to no longer exists.
  const limitedVoice = (capabilities: Capability[]) => buildHomeVoice({
    resolution: { state: "growling", visibilityLost: true, recovering: false, reason: "Limited coverage" } as any,
    attention: [],
    gates: [],
    capabilities,
  });

  for (const [name, capabilities] of [
    ["nothing genuinely degraded", [fakeCap("site_guard", "unsupported"), fakeCap("connection_guard", "available"), fakeCap("message_guard", "unsupported")]],
    ["a genuinely affected automatic", [fakeCap("connection_guard", "inactive")]],
  ] as Array<[string, Capability[]]>) {
    it(`visibility-lost with ${name} → Protection tab`, () => {
      const voice = limitedVoice(capabilities);
      assert.equal(voice.ctaRoute, "/(tabs)/protection");
      assert.equal(voice.ctaLabel, "View protection coverage");
      assert.ok(voice.text.includes("aren't supported here"),
        "Text must explain coverage is reduced, not claim protection is failing");
      assert.doesNotMatch(voice.text, /failing|broken|compromised/i);
    });
  }
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
