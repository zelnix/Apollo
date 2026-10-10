/**
 * Privacy Inventory + AI Processing Disclosure tests.
 *
 * Ensures:
 * 1. AI_PROCESSING_DISCLOSURE has required sections.
 * 2. Sections clearly identify the paid API tier (not user's account).
 * 3. Data retention statement is present and clear.
 * 4. Research query minimisation is documented.
 * 5. On-device screening is documented.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PRIVACY_FLOWS, AI_PROCESSING_DISCLOSURE, LOCAL_ONLY_CONTENT } from "../src/domain/privacyInventory.ts";

describe("AI processing disclosure", () => {
  it("has the required title", () => {
    assert.equal(AI_PROCESSING_DISCLOSURE.title, "How AI investigation works");
  });

  it("has at least 5 sections", () => {
    assert.ok(AI_PROCESSING_DISCLOSURE.sections.length >= 5);
  });

  it("clearly identifies paid API tier in data flow section", () => {
    const whereSection = AI_PROCESSING_DISCLOSURE.sections.find(
      (s) => s.heading === "Where your data goes"
    );
    assert.ok(whereSection, "Missing 'Where your data goes' section");
    assert.ok(whereSection.text.includes("paid API tier"), "Must mention paid API tier");
    assert.ok(
      whereSection.text.includes("not your personal Google account"),
      "Must clarify it is not the user's personal Google account"
    );
  });

  it("explains what Google receives", () => {
    const whatSection = AI_PROCESSING_DISCLOSURE.sections.find(
      (s) => s.heading === "What Google receives"
    );
    assert.ok(whatSection, "Missing 'What Google receives' section");
    assert.ok(
      whatSection.text.includes("explicitly approve"),
      "Must mention user approval"
    );
  });

  it("clarifies data retention", () => {
    const retentionSection = AI_PROCESSING_DISCLOSURE.sections.find(
      (s) => s.heading === "Data retention"
    );
    assert.ok(retentionSection, "Missing 'Data retention' section");
    // The disclosure accurately states Google's paid API data handling policy.
    assert.ok(
      retentionSection.text.includes("not used for model training"),
      "Must state data is not used for model training"
    );
    assert.ok(
      retentionSection.text.includes("15 minutes"),
      "Must state the 15-minute retention bound"
    );
  });

  it("documents research query minimisation", () => {
    const researchSection = AI_PROCESSING_DISCLOSURE.sections.find(
      (s) => s.heading === "Research queries"
    );
    assert.ok(researchSection, "Missing 'Research queries' section");
    assert.ok(
      researchSection.text.includes("category labels"),
      "Must mention replacement with category labels"
    );
    assert.ok(
      researchSection.text.includes("Domain names"),
      "Must mention domain name preservation"
    );
  });

  it("documents on-device screening", () => {
    const screeningSection = AI_PROCESSING_DISCLOSURE.sections.find(
      (s) => s.heading === "On-device screening"
    );
    assert.ok(screeningSection, "Missing 'On-device screening' section");
    assert.ok(
      screeningSection.text.includes("privacy gate"),
      "Must mention the privacy gate"
    );
  });
});

describe("Privacy flows inventory", () => {
  it("has at least 9 privacy flows", () => {
    assert.ok(PRIVACY_FLOWS.length >= 9);
  });

  it("each flow has what, when, and detail", () => {
    for (const flow of PRIVACY_FLOWS) {
      assert.ok(flow.what, `Flow missing 'what': ${JSON.stringify(flow)}`);
      assert.ok(flow.when, `Flow missing 'when': ${JSON.stringify(flow)}`);
      assert.ok(flow.detail, `Flow missing 'detail': ${JSON.stringify(flow)}`);
    }
  });
});

describe("Local-only content", () => {
  it("lists passwords and sensitive tokens", () => {
    assert.ok(
      LOCAL_ONLY_CONTENT.some((c) => c.includes("Passwords")),
      "Must list passwords as local-only"
    );
  });
});
