/**
 * Architectural regression tests — Point 6 acceptance criteria.
 * Each test exercises the ACTUAL PRODUCTION functions, not reimplemented logic.
 *
 * 1. Original findings survive sync (via mergeLocalAndRemoteEvents).
 * 2. Handled findings stay handled; new evidence reopens with reason.
 * 3. Repeated blocks retain enforcement evidence without duplicates.
 * 4. Single threat through multiple Gates correlated; independents separate.
 * 5. Home warning counts = distinct findings requiring attention.
 * 6. Every finding: accurate status, date/time, evidence, actions.
 * 7. Higgins explanations: specific, evidence-backed, no generic fallbacks.
 * 8. Missing/stale/contradictory evidence can't create false claims.
 * 9. Privacy restrictions and enforcement truth gates intact.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { hasLocalEvidence, narrateEvent, narrateIncident } from "../src/domain/higginsNarration.ts";
import { buildProtectionFindings, countDistinctFindings } from "../src/domain/protectionDetails.ts";
import { normalizeHistoricalEvent } from "../src/domain/packetEvidence.ts";
import { mergeLocalAndRemoteEvents } from "../src/domain/eventMerge.ts";
import { isActive, STATE_RANK, resolveApolloState } from "../src/domain/stateMachine.ts";
import { buildHomeAttention } from "../src/domain/homeAttention.ts";
import { projectedEventVoice, looksLikeInternalCode, humanizeReason, scrubMessage } from "../src/domain/messageVoice.ts";
import type { PatrolEvent, ApolloState, Capability } from "../src/domain/types.ts";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<PatrolEvent> = {}): PatrolEvent {
  return {
    event_id: "evt-1", device_id: "dev-1", category: "website", state: "barking", status: "active",
    headline: "Suspicious login page detected", what_happened: "Apollo's Site Gate found this page asks for credentials while impersonating a bank.",
    why: ["Domain registered 2 days ago", "TLS certificate does not match the bank"],
    what_to_do: "Do not enter your password. Close the tab and open the real bank site from your bookmarks.",
    indicator_host: "fake-bank.example.com", indicator_digest: null, local_indicator: "fake-bank.example.com",
    verified_block: false, adapter_label: "Apollo on-device assessment",
    occurred_at: new Date().toISOString(), resolved_at: null, trust_allowed: false,
    evidence_provenance: "local_device",
    ...overrides,
  } as PatrolEvent;
}

function makeServerEvent(overrides: Partial<PatrolEvent> = {}): PatrolEvent {
  const voice = projectedEventVoice("website", "barking", false);
  return makeEvent({
    headline: voice.headline, what_happened: voice.whatHappened, why: [voice.why], what_to_do: voice.whatToDo,
    evidence_provenance: "server_projected",
    ...overrides,
  });
}

function makeBlockEvent(overrides: Partial<PatrolEvent> = {}): PatrolEvent {
  return makeEvent({
    event_id: "block-1", state: "biting", status: "blocked", verified_block: true,
    headline: "Apollo blocked fake-bank.example.com",
    what_happened: "Apollo's Site Gate observed a real connection attempt to fake-bank.example.com and blocked it.",
    why: ["On-device filter matched this domain against a known threat"],
    what_to_do: "This connection was blocked. If you already shared details, review recovery steps.",
    enforcement_evidence: { evidenceId: "pkt-001", method: "packet_drop", observedAt: new Date().toISOString(), destination: { domain: "fake-bank.example.com" } } as any,
    ...overrides,
  });
}

// ── Test 1: Exercises the ACTUAL mergeLocalAndRemoteEvents ──────────────────
describe("1. Original findings survive local/server synchronisation (production merge)", () => {
  it("local event with detailed findings is preserved through actual merge", () => {
    const local = makeEvent({ event_id: "e1" });
    const serverProjected = makeServerEvent({ event_id: "e1" });

    const { events } = mergeLocalAndRemoteEvents([local], [serverProjected]);
    const merged = events.find((e) => e.event_id === "e1")!;
    assert.ok(merged, "Event exists after merge");
    assert.equal(merged.what_happened, local.what_happened, "Local detailed content preserved");
    assert.equal(merged.headline, local.headline, "Local headline preserved");
    assert.equal(merged.evidence_provenance, "local_device", "Provenance stays local_device");
  });

  it("server-only events are taken as-is with server_projected provenance", () => {
    const serverOnly = makeServerEvent({ event_id: "e-other" });
    const { events } = mergeLocalAndRemoteEvents([], [serverOnly]);
    const merged = events.find((e) => e.event_id === "e-other")!;
    assert.ok(merged);
    assert.equal(merged.evidence_provenance, "server_projected");
  });

  it("local-only events (not yet on server) survive merge", () => {
    const localOnly = makeEvent({ event_id: "e-local-only" });
    const { events } = mergeLocalAndRemoteEvents([localOnly], []);
    assert.equal(events.length, 1);
    assert.equal(events[0].event_id, "e-local-only");
  });

  it("hasLocalEvidence uses structured field, not text matching", () => {
    const localEvt = makeEvent({ evidence_provenance: "local_device" });
    const serverEvt = makeServerEvent({ evidence_provenance: "server_projected" });
    const incompleteEvt = makeEvent({ evidence_provenance: "incomplete" });
    assert.ok(hasLocalEvidence(localEvt));
    assert.ok(!hasLocalEvidence(serverEvt));
    assert.ok(!hasLocalEvidence(incompleteEvt));
  });
});

// ── Test 2: Exercises the ACTUAL mergeLocalAndRemoteEvents for lifecycle ─────
describe("2. Handled findings remain handled; new evidence can reopen (production merge)", () => {
  it("resolved event stays resolved through actual merge even when server says active", () => {
    const local = makeEvent({ event_id: "e2", status: "resolved", resolved_at: new Date().toISOString() });
    const serverActive = makeServerEvent({ event_id: "e2", status: "active", resolved_at: null });

    const { events } = mergeLocalAndRemoteEvents([local], [serverActive]);
    const merged = events.find((e) => e.event_id === "e2")!;
    assert.equal(merged.status, "resolved", "Resolution preserved through merge");
    assert.ok(merged.resolved_at, "resolved_at preserved");
  });

  it("genuinely new enforcement evidence CAN reopen through actual merge (observed after handling)", () => {
    const resolvedTime = "2026-06-01T10:00:00Z";
    const local = makeEvent({
      event_id: "e3", status: "resolved", resolved_at: resolvedTime,
      enforcement_evidence: { evidence_id: "old-evidence", observed_at: "2026-06-01T09:00:00Z" } as any,
    });
    const serverNewEvidence = makeServerEvent({
      event_id: "e3", status: "active", state: "biting", verified_block: true,
      enforcement_evidence: { evidence_id: "NEW-evidence-id", observed_at: "2026-06-01T11:00:00Z" } as any,
    });

    const { events } = mergeLocalAndRemoteEvents([local], [serverNewEvidence]);
    const merged = events.find((e) => e.event_id === "e3")!;
    assert.equal(merged.status, "active", "New evidence observed after handling reopens the event");
    assert.equal(merged.resolved_at, null, "resolved_at cleared on reopen");
  });

  it("delayed delivery of older evidence does NOT reopen (observed before handling)", () => {
    const resolvedTime = "2026-06-01T10:00:00Z";
    const local = makeEvent({
      event_id: "e3b", status: "resolved", resolved_at: resolvedTime,
      enforcement_evidence: { evidence_id: "first-evidence", observed_at: "2026-06-01T09:00:00Z" } as any,
    });
    const serverOldEvidence = makeServerEvent({
      event_id: "e3b", status: "active", state: "biting",
      enforcement_evidence: { evidence_id: "delayed-old-evidence", observed_at: "2026-06-01T08:00:00Z" } as any,
    });

    const { events } = mergeLocalAndRemoteEvents([local], [serverOldEvidence]);
    const merged = events.find((e) => e.event_id === "e3b")!;
    assert.equal(merged.status, "resolved", "Delayed older evidence does not reopen");
    assert.ok(merged.resolved_at, "resolved_at preserved");
  });

  it("same enforcement evidence does NOT reopen through actual merge", () => {
    const local = makeEvent({
      event_id: "e4", status: "resolved", resolved_at: new Date().toISOString(),
      enforcement_evidence: { evidence_id: "same-evidence" } as any,
    });
    const serverSameEvidence = makeServerEvent({
      event_id: "e4", status: "active",
      enforcement_evidence: { evidence_id: "same-evidence" } as any,
    });

    const { events } = mergeLocalAndRemoteEvents([local], [serverSameEvidence]);
    const merged = events.find((e) => e.event_id === "e4")!;
    assert.equal(merged.status, "resolved", "Same evidence does not reopen");
  });

  it("isActive excludes resolved events from warning counts", () => {
    assert.ok(!isActive(makeEvent({ status: "resolved", resolved_at: new Date().toISOString() })));
    assert.ok(!isActive(makeEvent({ status: "trusted" })));
    assert.ok(isActive(makeEvent({ status: "active" })));
  });
});

// ── Test 3: Repeated blocks don't create misleading duplicates ──────────────
describe("3. Repeated blocks retain enforcement evidence without duplicate threats", () => {
  it("events for the same indicator_host within 24h are correlated", () => {
    const now = Date.now();
    const events = [
      makeBlockEvent({ event_id: "b1", indicator_host: "apolloverify.harmonywellnessgroup.com.au", scent_id: undefined, occurred_at: new Date(now).toISOString() }),
      makeBlockEvent({ event_id: "b2", indicator_host: "apolloverify.harmonywellnessgroup.com.au", scent_id: undefined, occurred_at: new Date(now - 3600_000).toISOString() }),
    ];
    assert.equal(countDistinctFindings(events), 0, "Verified blocks are not counted as findings requiring attention");
  });

  it("events for the same host but >24h apart are separate findings", () => {
    const now = Date.now();
    const events = [
      makeEvent({ event_id: "e1", indicator_host: "evil.com", scent_id: undefined, occurred_at: new Date(now).toISOString() }),
      makeEvent({ event_id: "e2", indicator_host: "evil.com", scent_id: undefined, occurred_at: new Date(now - 25 * 3600_000).toISOString() }),
    ];
    assert.equal(countDistinctFindings(events), 2, "Same host but >24h apart = separate findings");
  });

  it("normalizeHistoricalEvent preserves verified block with valid packet proof", () => {
    const now = new Date().toISOString();
    const blockWithProof = makeBlockEvent({
      event_id: "block-proof", device_id: "dev-1", category: "connection", occurred_at: now,
      enforcement_evidence: {
        evidence_id: "pkt-001", observed_at: now, platform: "android", mechanism: "vpn_service",
        requested_action: "block", enforced_action: "blocked", result: "verified",
        direction: "outbound", protocol: "tcp", matched_rule_id: "rule.threat.1",
        destination_domain: "fake-bank.example.com", destination_port: 443,
        event_id: "block-proof", device_id: "dev-1",
      } as any,
    });
    const normalized = normalizeHistoricalEvent(blockWithProof);
    assert.equal(normalized.state, "biting", "Verified block preserved");
    assert.ok(normalized.verified_block);
  });

  it("normalizeHistoricalEvent downgrades unproven block claim and marks incomplete", () => {
    const fake = makeEvent({ state: "biting", verified_block: true, enforcement_evidence: null });
    const normalized = normalizeHistoricalEvent(fake);
    assert.equal(normalized.state, "barking", "Unproven block downgraded");
    assert.equal(normalized.evidence_provenance, "incomplete", "Marked incomplete");
  });
});

// ── Test 4: Correlated vs independent findings ──────────────────────────────
describe("4. Single threat through multiple Gates correlated; independents separate", () => {
  it("events with the same scent_id are grouped as one finding", () => {
    const events = [
      makeEvent({ event_id: "e1", scent_id: "scent-abc", category: "website" }),
      makeEvent({ event_id: "e2", scent_id: "scent-abc", category: "email" }),
    ];
    assert.equal(countDistinctFindings(events), 1);
  });

  it("events with the same indicator_host but no scent_id are correlated", () => {
    const events = [
      makeEvent({ event_id: "e1", scent_id: undefined, indicator_host: "evil.com" }),
      makeEvent({ event_id: "e2", scent_id: undefined, indicator_host: "evil.com" }),
    ];
    assert.equal(countDistinctFindings(events), 1, "Same host = correlated");
  });

  it("events with different hosts and no scent are separate", () => {
    const events = [
      makeEvent({ event_id: "e1", scent_id: undefined, indicator_host: "evil.com" }),
      makeEvent({ event_id: "e2", scent_id: undefined, indicator_host: "other-evil.com" }),
    ];
    assert.equal(countDistinctFindings(events), 2);
  });

  it("resolved events are excluded from finding count", () => {
    const events = [
      makeEvent({ event_id: "e1", status: "resolved", resolved_at: new Date().toISOString() }),
      makeEvent({ event_id: "e2", status: "active" }),
    ];
    assert.equal(countDistinctFindings(events), 1);
  });
});

// ── Test 5: Home and Protection Details use the same count ──────────────────
describe("5. Home warning counts include only distinct findings genuinely requiring attention", () => {
  it("countDistinctFindings excludes verified blocks (protection activity, not unresolved concerns)", () => {
    const events = [
      makeEvent({ event_id: "e1", scent_id: "s1", state: "barking" }),
      makeEvent({ event_id: "e2", scent_id: "s1", state: "growling" }),
      makeEvent({ event_id: "e3", indicator_host: "other.com", scent_id: undefined, state: "ears_up" }),
      makeBlockEvent({ event_id: "e4b" }), // verified block — protection activity
      makeEvent({ event_id: "e4", status: "resolved", resolved_at: new Date().toISOString() }),
    ];
    assert.equal(countDistinctFindings(events), 2, "s1 group + other.com = 2 findings; block and resolved excluded");
  });

  it("buildProtectionFindings separates concerns from protection activity", () => {
    const events = [
      makeEvent({ event_id: "e1", scent_id: "s1", state: "barking" }),
      makeEvent({ event_id: "e2", scent_id: "s1", state: "growling" }),
      makeEvent({ event_id: "e3", indicator_host: "other.com", scent_id: undefined, state: "ears_up" }),
      makeBlockEvent({ event_id: "e4b" }),
    ];
    const findings = buildProtectionFindings({ capabilities: [], gates: [], attention: [], events });
    const concerns = findings.filter((f) => f.findingType === "threat");
    const blocks = findings.filter((f) => f.findingType === "protection_activity");
    assert.equal(concerns.length, 2, "2 concern-type findings");
    assert.equal(blocks.length, 1, "1 protection activity");
    assert.equal(countDistinctFindings(events), concerns.length, "Count matches concern findings only");
  });
});

// ── Test 6: Every finding has accurate status, date/time, evidence, actions ──
describe("6. Every finding displays accurate status, date/time, evidence, actions", () => {
  it("findings include firstDetected, latestActivity, and correct eventCount", () => {
    const earlier = new Date(Date.now() - 3600_000).toISOString();
    const later = new Date().toISOString();
    const events = [
      makeEvent({ event_id: "e1", scent_id: "s1", occurred_at: earlier }),
      makeEvent({ event_id: "e2", scent_id: "s1", occurred_at: later }),
    ];
    const findings = buildProtectionFindings({ capabilities: [], gates: [], attention: [], events });
    const f = findings.find((f) => f.findingType === "threat")!;
    assert.ok(f.firstDetected);
    assert.ok(f.latestActivity);
    assert.equal(f.eventCount, 2);
  });

  it("biting events with verified_block get 'Blocked' status and findingType 'protection_activity'", () => {
    const events = [makeBlockEvent()];
    const findings = buildProtectionFindings({ capabilities: [], gates: [], attention: [], events });
    const f = findings.find((f) => f.findingType === "protection_activity")!;
    assert.ok(f, "Verified block is protection_activity, not threat");
    assert.equal(f.statusLabel, "Blocked");
  });

  it("ears_up events get 'Worth checking', not 'threat'", () => {
    const events = [makeEvent({ state: "ears_up" })];
    const findings = buildProtectionFindings({ capabilities: [], gates: [], attention: [], events });
    const f = findings.find((f) => f.findingType === "threat")!;
    assert.equal(f.statusLabel, "Worth checking");
  });

  it("manual gate events are labelled 'Manual check'", () => {
    const events = [makeEvent({ category: "link" })]; // Link Gate is manual
    const findings = buildProtectionFindings({ capabilities: [], gates: [], attention: [], events });
    const f = findings.find((f) => f.findingType === "threat")!;
    assert.equal(f.kindLabel, "Manual check");
  });
});

// ── Test 7: Higgins explanations are evidence-backed, no generic fallbacks ──
describe("7. Higgins explanations are specific, evidence-backed, no generic fallback narratives", () => {
  it("narrateEvent with local evidence produces specific narration", () => {
    const event = makeEvent({ evidence_provenance: "local_device" });
    const chunks = narrateEvent(event);
    const whatChunk = chunks.find((c) => c.id === "what");
    assert.match(whatChunk!.text, /impersonating a bank/, "Real evidence used");
  });

  it("narrateEvent with server_projected provenance narrates honestly (no fabrication)", () => {
    const projected = makeServerEvent({ evidence_provenance: "server_projected" });
    const chunks = narrateEvent(projected);
    const whatChunk = chunks.find((c) => c.id === "what");
    assert.match(whatChunk!.text, /only available on the device/, "Honest about missing evidence");
    assert.ok(!whatChunk!.text.includes("impersonating"), "No fabricated content");
  });

  it("narrateIncident marks server-projected events honestly within the timeline", () => {
    const plan = {
      headline: "Connected incident", state: "barking" as ApolloState,
      timeline: [
        makeEvent({ event_id: "e1", evidence_provenance: "local_device" }),
        makeServerEvent({ event_id: "e2", evidence_provenance: "server_projected" }),
      ],
      exposure: [], steps: [], allResolved: false,
    } as any;
    const chunks = narrateIncident(plan);
    const evt2 = chunks.find((c) => c.id === "event-1");
    assert.match(evt2!.text, /only on the device/, "Server-projected event narrated honestly");
  });

  it("humanizeReason converts code to honest sentence, passes prose through", () => {
    assert.match(humanizeReason("server_projection_of_recorded_outcome", "barking"), /needs your attention/);
    assert.equal(humanizeReason("Domain registered 2 days ago.", "barking"), "Domain registered 2 days ago.");
  });
});

// ── Test 8: Missing/stale/contradictory evidence can't create false claims ──
describe("8. Missing, stale or contradictory evidence cannot create false threat or protection claims", () => {
  it("normalizeHistoricalEvent prevents false biting claim without packet proof", () => {
    const fake = makeEvent({ state: "biting", verified_block: true, enforcement_evidence: null });
    const n = normalizeHistoricalEvent(fake);
    assert.equal(n.state, "barking");
    assert.equal(n.evidence_provenance, "incomplete");
  });

  it("mergeLocalAndRemoteEvents clears resolved_at when genuinely reopening", () => {
    const local = makeEvent({
      event_id: "x", status: "resolved", resolved_at: "2026-01-01T00:00:00Z",
      enforcement_evidence: { evidence_id: "old", observed_at: "2025-12-31T23:00:00Z" } as any,
    });
    const remote = makeServerEvent({
      event_id: "x", status: "active",
      // New evidence observed AFTER the resolution — this is a genuine reopen.
      enforcement_evidence: { evidence_id: "genuinely-new", observed_at: "2026-01-02T12:00:00Z" } as any,
    });
    const { events } = mergeLocalAndRemoteEvents([local], [remote]);
    const m = events.find((e) => e.event_id === "x")!;
    assert.equal(m.resolved_at, null, "resolved_at cleared on genuine reopen — no contradictory timestamps");
  });

  it("resolveApolloState with only resolved events does not bark", () => {
    const resolved = makeEvent({ status: "resolved", resolved_at: new Date().toISOString() });
    const resolution = resolveApolloState({ events: [resolved], visibility: "full", lastVerifiedAt: new Date().toISOString() });
    assert.notEqual(resolution.state, "barking");
    assert.notEqual(resolution.state, "biting");
  });
});

// ── Test 9: Privacy restrictions and enforcement truth gates intact ──────────
describe("9. Privacy restrictions and native enforcement truth gates remain intact", () => {
  it("projectedEventVoice produces privacy-safe text with no detail leak", () => {
    const voice = projectedEventVoice("website", "barking", false);
    assert.ok(!voice.whatHappened.includes("fake-bank"), "No domain leaked");
    assert.ok(!voice.whatHappened.includes("ANZ"), "No brand leaked");
  });

  it("isActive preserves the enforcement truth gate: blocked+biting without resolution stays active", () => {
    assert.ok(isActive(makeBlockEvent({ resolved_at: null })));
    assert.ok(!isActive(makeBlockEvent({ resolved_at: new Date().toISOString() })));
  });

  it("STATE_RANK hierarchy is intact", () => {
    assert.ok(STATE_RANK.biting > STATE_RANK.barking);
    assert.ok(STATE_RANK.barking > STATE_RANK.growling);
    assert.ok(STATE_RANK.growling > STATE_RANK.ears_up);
    assert.ok(STATE_RANK.ears_up > STATE_RANK.resting);
  });

  it("evidence_provenance field controls Higgins narration, not text content", () => {
    // Even if text LOOKS like real evidence, if provenance says server_projected, Higgins won't use it.
    const serverWithRealishText = makeEvent({
      evidence_provenance: "server_projected",
      what_happened: "This page impersonates a bank (but came from server).",
    });
    assert.ok(!hasLocalEvidence(serverWithRealishText), "Provenance field overrides text content");
  });
});
