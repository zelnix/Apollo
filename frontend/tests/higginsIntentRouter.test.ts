/**
 * Higgins Intent Router Tests
 *
 * Verifies the three-path classification:
 *   1. Local diagnostic — device/Apollo status (never reaches Magnum DI)
 *   2. Investigation — suspicious content (Magnum DI)
 *   3. Local knowledge — help/navigation/explanations (preferably no AI)
 *
 * Hard architectural guard: protection/gate/issue questions MUST route
 * to local_diagnostic, never investigation.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyIntent, type HigginsRoute } from "../src/higgins/intentRouter.ts";

// Helper: assert route
function assertRoute(message: string, expectedRoute: HigginsRoute, label?: string) {
  const result = classifyIntent(message);
  assert.equal(result.route, expectedRoute, `${label ?? message} → expected ${expectedRoute}, got ${result.route} (reason: ${result.reason})`);
}

// ── Local Diagnostic: protection status ────────────────────────────────────

describe("Local Diagnostic — Protection Status", () => {
  const messages = [
    "Am I protected?",
    "Is my device protected?",
    "Is my phone safe?",
    "Is Apollo running?",
    "Is protection on?",
    "What's my protection status?",
    "Is Apollo active?",
    "Is security enabled?",
    "Am I secure?",
  ];

  for (const msg of messages) {
    it(`"${msg}" → local_diagnostic`, () => {
      const result = classifyIntent(msg);
      assert.equal(result.route, "local_diagnostic", `Expected local_diagnostic for "${msg}", got ${result.route}`);
      assert.ok(result.confidence >= 0.7, `Confidence ${result.confidence} too low for "${msg}"`);
    });
  }
});

// ── Local Diagnostic: VPN status ────────────────────────────────────────

describe("Local Diagnostic — VPN Status", () => {
  const messages = [
    "Is the VPN on?",
    "VPN status",
    "Is my VPN active?",
    "Is the VPN running?",
    "Is the VPN working?",
    "What's the VPN status?",
  ];

  for (const msg of messages) {
    it(`"${msg}" → local_diagnostic (vpn)`, () => {
      const result = classifyIntent(msg);
      assert.equal(result.route, "local_diagnostic");
      assert.equal(result.diagnosticIntent, "vpn_status");
    });
  }
});

// ── Local Diagnostic: Gate status ────────────────────────────────────────

describe("Local Diagnostic — Gate Status", () => {
  it('"Site Gate status" → site_gate_status', () => {
    const result = classifyIntent("Site Gate status");
    assert.equal(result.route, "local_diagnostic");
    assert.equal(result.diagnosticIntent, "site_gate_status");
  });

  it('"Is web protection active?" → site_gate_status', () => {
    const result = classifyIntent("Is web protection active?");
    assert.equal(result.route, "local_diagnostic");
    assert.equal(result.diagnosticIntent, "site_gate_status");
  });

  it('"Call Gate protection" → call_gate_status', () => {
    const result = classifyIntent("Call Gate protection");
    assert.equal(result.route, "local_diagnostic");
    assert.equal(result.diagnosticIntent, "call_gate_status");
  });

  it('"Are my messages protected?" → text_gate_status', () => {
    const result = classifyIntent("Are my messages protected?");
    assert.equal(result.route, "local_diagnostic");
    assert.equal(result.diagnosticIntent, "text_gate_status");
  });
});

// ── Local Diagnostic: current issues ────────────────────────────────────

describe("Local Diagnostic — Current Issues", () => {
  it('"Any issues?" → current_issues', () => {
    assertRoute("Any issues?", "local_diagnostic");
  });

  it('"What\'s wrong?" → current_issues', () => {
    assertRoute("What's wrong?", "local_diagnostic");
  });

  it('"Why is Apollo barking?" → current_issues', () => {
    assertRoute("Why is Apollo barking?", "local_diagnostic");
  });

  it('"Needs attention" → current_issues', () => {
    assertRoute("What needs attention?", "local_diagnostic");
  });
});

// ── Investigation: suspicious content ────────────────────────────────────

describe("Investigation — Suspicious Content", () => {
  const messages = [
    "Is this a scam?",
    "Check this email for phishing",
    "I got a suspicious text message",
    "Investigate this link",
    "Is this URL safe?",
    "Someone called me claiming to be from the bank",
    "This looks suspicious",
    "Could this be fraud?",
    "I received a suspicious email from my bank",
    "Analyze this screenshot",
  ];

  for (const msg of messages) {
    it(`"${msg}" → investigation`, () => {
      assertRoute(msg, "investigation");
    });
  }
});

// ── Local Knowledge: help/navigation ────────────────────────────────────

describe("Local Knowledge — Help & Navigation", () => {
  const messages = [
    "How does Apollo work?",
    "What is Higgins?",
    "Tell me about Apollo",
    "Help me find settings",
    "What can you do?",
  ];

  for (const msg of messages) {
    it(`"${msg}" → local_knowledge`, () => {
      assertRoute(msg, "local_knowledge");
    });
  }
});

// ── Wayfinding: "where is it" / "how do I turn it on" ───────────────────
// These belong to Higgins himself: he holds Apollo's whole screen map and
// answers with a tap straight through. They must never be read as a status
// question ("where do I turn on call screening" ≠ "is call screening on").

describe("Wayfinding — Higgins answers and links", () => {
  const messages = [
    "How do I check a phone number?",
    "Where do I turn on call screening?",
    "Where is my threat history?",
    "How can I connect my email?",
    "Take me to my saved checks",
  ];

  for (const msg of messages) {
    it(`"${msg}" → ask_higgins`, () => {
      assertRoute(msg, "ask_higgins");
    });
  }
});

// ── Hard Architectural Guard ────────────────────────────────────────────

describe("Architectural Guard — Local questions NEVER reach investigation", () => {
  const localQuestions = [
    "Is my device protected?",
    "VPN status",
    "Is Apollo running?",
    "What's my protection status?",
    "Any issues?",
    "Is the VPN on?",
    "Site Gate status",
    "What needs attention?",
    "What permissions are needed?",
    "Is my phone safe?",
    "Is security enabled?",
  ];

  for (const msg of localQuestions) {
    it(`"${msg}" MUST NOT route to investigation`, () => {
      const result = classifyIntent(msg);
      assert.notEqual(result.route, "investigation", `GUARD VIOLATION: "${msg}" routed to investigation (reason: ${result.reason})`);
    });
  }
});

// ── Ambiguous messages ────────────────────────────────────────────────────

describe("Ambiguous Messages", () => {
  it('"Is it working?" with device context keywords → local_diagnostic', () => {
    const result = classifyIntent("Is it working?");
    assert.equal(result.route, "local_diagnostic");
  });

  it('Short ambiguous message without context keywords → clarify', () => {
    const result = classifyIntent("check this");
    // Should ask for clarification or default to knowledge, not blindly investigate
    assert.notEqual(result.route, "investigation");
  });

  // Context words count only as whole words: "on" inside "someone", "phone" or "money" is not "on".
  it('"How do I report someone?" is not read as a protection-status question', () => {
    const result = classifyIntent("How do I report someone?");
    assert.notEqual(result.route, "local_diagnostic");
    assert.equal(result.route, "ask_higgins");
  });

  it("words inside longer words never count; whole words still do", () => {
    assert.notEqual(classifyIntent("What about my money").route, "local_diagnostic");
    assert.notEqual(classifyIntent("Can I trust a phone contact").route, "local_diagnostic");
    assert.equal(classifyIntent("Is it on").route, "local_diagnostic");
    assert.equal(classifyIntent("Everything seems broken").route, "local_diagnostic");
  });

  it("threat words count in their usual forms", () => {
    assert.equal(classifyIntent("I got scammed").route, "investigation");
    assert.equal(classifyIntent("my email was hacked").route, "investigation");
    assert.equal(classifyIntent("Is my phone hacked?").route, "investigation");
  });
});
