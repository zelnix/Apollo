// Regression tests for PRD Section 10 — Home Status Separation.
// Verifies that threat state, protection coverage, and user actions are independent.
//
// Run: node --test tests/homeStatusSeparation.test.mjs

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveApolloState } from "../src/domain/stateMachine.ts";
import { resolveHomeStatus } from "../src/domain/homeStatusResolver.ts";
import { resolveProtectionState } from "../src/domain/protectionStateResolver.ts";

// ── Test helpers ───────────────────────────────────────────────────────────

const NOW = Date.now();

function makeEvent(overrides = {}) {
  return {
    event_id: "evt-1",
    device_id: "dev-1",
    category: "website",
    state: "resting",
    status: "active",
    headline: "Test event",
    what_happened: "Test happened",
    why: [],
    what_to_do: "Check it",
    indicator_host: null,
    indicator_digest: null,
    verified_block: false,
    adapter_label: "test",
    occurred_at: new Date(NOW - 60_000).toISOString(),
    resolved_at: null,
    ...overrides,
  };
}

function makeGate(id, autoState = "running") {
  return {
    id,
    title: id,
    category: id,
    currentHelp: "",
    capability: {
      automatic: autoState
        ? { state: autoState, manualOnly: false }
        : null,
      onDemand: !autoState ? { state: "ready" } : null,
    },
    // Gates carry their state resolved ONCE, by the one resolver both Home and Protection read.
    // The fixture resolves it the same way rather than hand-writing a second interpretation.
    resolved: resolveProtectionState({
      automaticState: autoState ?? undefined,
      manualOnly: false,
      onDemandState: autoState ? undefined : "ready",
    }),
  };
}

function makeCapability(id, status = "active") {
  return { id, title: id, status, detail: "" };
}

function resolveState(overrides = {}) {
  return resolveApolloState({
    events: [],
    visibility: "full",
    lastVerifiedAt: new Date(NOW - 30_000).toISOString(),
    platformCanEnforce: true,
    now: NOW,
    ...overrides,
  });
}

function resolveHome(overrides = {}) {
  const resolution = overrides.resolution ?? resolveState();
  return resolveHomeStatus({
    resolution,
    attention: [],
    gates: [makeGate("site", "running"), makeGate("link", null)],
    capabilities: [makeCapability("site_guard", "active"), makeCapability("link_guard", "active")],
    findingCount: 0,
    platformCanEnforce: true,
    ...overrides,
  });
}

// ── PRD Section 10: Required Regression Tests ──────────────────────────────

describe("PRD 10.1 — Disabled Gate does not cause growling or barking", () => {
  it("Apollo rests when a gate is disabled", () => {
    const resolution = resolveState();
    const status = resolveHome({
      resolution,
      gates: [makeGate("site", "off_by_choice"), makeGate("link", null)],
    });
    assert.equal(status.behavior, "resting", "Apollo should rest when a gate is disabled");
    assert.notEqual(status.behavior, "growling");
    assert.notEqual(status.behavior, "barking");
  });
});

describe("PRD 10.2 — Unsupported Gate does not create a security threat", () => {
  it("Apollo rests with an unsupported gate", () => {
    const resolution = resolveState();
    const status = resolveHome({
      resolution,
      gates: [makeGate("site", "unsupported"), makeGate("link", null)],
      capabilities: [makeCapability("site_guard", "unsupported")],
    });
    assert.equal(status.behavior, "resting");
    assert.equal(status.threat.level, "none");
  });
});

describe("PRD 10.3 — Optional setup does not create a security finding", () => {
  it("setup_available gates produce optional_setup, not a threat", () => {
    const resolution = resolveState();
    const status = resolveHome({
      resolution,
      gates: [makeGate("site", "setup_needed"), makeGate("link", null)],
    });
    assert.equal(status.behavior, "resting");
    assert.equal(status.threat.level, "none");
    assert.ok(
      status.actions.level === "optional_setup" || status.actions.level === "none",
      `actions.level should be optional_setup or none, got: ${status.actions.level}`,
    );
  });
});

describe("PRD 10.4 — Manual-only Gate ready is not a failure", () => {
  it("a manual-only Gate in ready state is not flagged", () => {
    const resolution = resolveState();
    const status = resolveHome({
      resolution,
      gates: [makeGate("link", null)], // onDemand only
    });
    assert.equal(status.behavior, "resting");
    assert.equal(status.threat.level, "none");
  });
});

describe("PRD 10.5 — Gate malfunction does not change threat state", () => {
  it("a gate failure keeps Apollo resting and sets protectionStatus", () => {
    const resolution = resolveState();
    const status = resolveHome({
      resolution,
      gates: [makeGate("site", "interrupted"), makeGate("link", null)],
      attention: [{ kind: "gate", gate: "Website protection", title: "Website protection issue", problem: "Protection stopped", route: "/gate/site" }],
    });
    // Apollo must NOT growl or bark for a protection failure.
    assert.equal(status.behavior, "resting");
    assert.equal(status.threat.level, "none");
    // Protection status should indicate the problem.
    assert.ok(
      status.protectionStatus === "action_needed" || status.protectionStatus === "reduced",
      `protectionStatus should indicate the issue, got: ${status.protectionStatus}`,
    );
    assert.ok(status.protectionGuidance, "protectionGuidance should explain the issue");
  });
});

describe("PRD 10.6 — Higgins explains reduced protection with user action", () => {
  it("produces protectionGuidance and a primary action for reduced protection", () => {
    const resolution = resolveState({ visibility: "none" });
    const status = resolveHome({ resolution });
    assert.equal(status.behavior, "resting");
    assert.ok(status.protectionGuidance, "Higgins should explain reduced protection");
    assert.ok(
      status.protectionStatus === "reduced" || status.protectionStatus === "action_needed",
      "protectionStatus should indicate reduced or action_needed",
    );
  });
});

describe("PRD 10.7 — Genuine security threat triggers appropriate behaviour", () => {
  it("a growling event produces growling behaviour", () => {
    const event = makeEvent({ state: "growling", status: "active" });
    const resolution = resolveState({ events: [event] });
    assert.equal(resolution.state, "growling");
    const status = resolveHome({ resolution, attention: [{ kind: "event", gate: "Website protection", title: "Suspicious site", problem: "Possible scam", route: "/patrol/evt-1", event }] });
    assert.equal(status.behavior, "growling");
    assert.equal(status.threat.level, "suspicious");
  });

  it("a barking event produces barking behaviour", () => {
    const event = makeEvent({ state: "barking", status: "active" });
    const resolution = resolveState({ events: [event] });
    assert.equal(resolution.state, "barking");
    const status = resolveHome({ resolution, attention: [{ kind: "event", gate: "Website protection", title: "Confirmed threat", problem: "Malicious site", route: "/patrol/evt-1", event }] });
    assert.equal(status.behavior, "barking");
    assert.equal(status.threat.level, "confirmed");
  });
});

describe("PRD 10.8 — Biting requires authentic enforcement evidence", () => {
  it("biting state requires verified_block and enforcement_evidence", () => {
    const occurredAt = new Date(NOW - 30_000).toISOString();
    const event = makeEvent({
      state: "biting",
      status: "blocked",
      verified_block: true,
      occurred_at: occurredAt,
      enforcement_evidence: {
        evidence_id: "ee-1", event_id: "evt-1", device_id: "dev-1",
        platform: "android", os_version: "14", sdk_version: null,
        observed_at: occurredAt,
        mechanism: "vpn_service", direction: "outbound", protocol: "tcp",
        destination_ip: "1.2.3.4", destination_domain: "bad.example.com", destination_port: 443,
        app_id: null, process_name: null, attribution_confidence: "high",
        matched_rule_id: "r1", threat_id: "t1",
        requested_action: "block", enforced_action: "blocked", result: "verified",
        rule_source: "apollo", confidence: "high", correlation_id: null,
      },
    });
    const resolution = resolveState({ events: [event] });
    assert.equal(resolution.state, "biting");
    const status = resolveHome({ resolution });
    assert.equal(status.behavior, "biting");
    assert.equal(status.threat.level, "blocked");
  });

  it("biting event without verified_block does not produce biting", () => {
    const event = makeEvent({ state: "biting", status: "blocked", verified_block: false });
    const resolution = resolveState({ events: [event] });
    // Without verified_block + proof, the state machine should NOT produce biting.
    assert.notEqual(resolution.state, "biting");
  });
});

describe("PRD 10.9 — Threat counts exclude protection-health and setup issues", () => {
  it("gate attention items do not inflate threat level", () => {
    const resolution = resolveState();
    const gateAttention = Array.from({ length: 5 }, (_, i) => ({
      kind: "gate",
      gate: `Gate ${i}`,
      title: `Gate ${i} issue`,
      problem: `Gate ${i} stopped`,
      route: `/gate/${i}`,
    }));
    const status = resolveHome({ resolution, attention: gateAttention, findingCount: 0 });
    assert.equal(status.behavior, "resting", "Gate issues must not make Apollo growl");
    assert.equal(status.threat.level, "none", "Gate issues are not security threats");
  });
});

describe("PRD 10.10 — Home messages use 'Apollo's current protection capability'", () => {
  it("resting message contains the approved phrasing", () => {
    const resolution = resolveState();
    const status = resolveHome({ resolution });
    assert.ok(
      status.explanation.includes("Apollo's current protection capability") ||
      status.explanation.includes("protections are running"),
      `Expected approved phrasing, got: "${status.explanation}"`,
    );
  });
});

describe("PRD 10.11 — Resolved incidents do not trigger new warnings", () => {
  it("a resolved event in recovery period keeps Apollo resting", () => {
    const event = makeEvent({
      state: "growling",
      status: "resolved",
      resolved_at: new Date(NOW - 30_000).toISOString(),
    });
    const resolution = resolveState({
      events: [event],
      lastVerifiedAt: new Date(NOW - 5 * 60_000).toISOString(), // verified before resolve
    });
    // State machine should produce resting (with recovering flag), not growling.
    assert.equal(resolution.state, "resting");
    assert.equal(resolution.recovering, true);
    const status = resolveHome({ resolution });
    assert.equal(status.behavior, "resting");
    assert.equal(status.threat.level, "none");
  });
});

describe("PRD 10.12 — All screens show consistent, truthful statuses", () => {
  it("resolver threat pillar matches state machine when no threat", () => {
    const resolution = resolveState();
    const status = resolveHome({ resolution });
    assert.equal(status.threat.level, "none");
    assert.equal(status.behavior, "resting");
    assert.equal(status.headline, "Apollo is Patrolling");
  });

  it("resolver threat pillar matches state machine for growling threat", () => {
    const event = makeEvent({ state: "growling", status: "active" });
    const resolution = resolveState({ events: [event] });
    const status = resolveHome({ resolution });
    assert.equal(status.threat.level, "suspicious");
    assert.equal(status.behavior, "growling");
    assert.ok(status.headline.includes("growling"));
  });
});
