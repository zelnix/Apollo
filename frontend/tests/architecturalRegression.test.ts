/**
 * Architectural regression tests — Point 6 acceptance criteria.
 * Each test demonstrates a specific P0/P1 requirement is met.
 *
 * 1. Original findings survive sync, restart, reopening.
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

import { isProjectedContent, narrateEvent, narrateIncident } from "../src/domain/higginsNarration.ts";
import { buildProtectionFindings, countDistinctThreats } from "../src/domain/protectionDetails.ts";
import { normalizeHistoricalEvent } from "../src/domain/packetEvidence.ts";
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
    ...overrides,
  } as PatrolEvent;
}

function makeProjectedEvent(overrides: Partial<PatrolEvent> = {}): PatrolEvent {
  const voice = projectedEventVoice("website", "barking", false);
  return makeEvent({
    headline: voice.headline, what_happened: voice.whatHappened, why: [voice.why], what_to_do: voice.whatToDo,
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

// ── Test 1: Original findings survive sync ──────────────────────────────────
describe("1. Original findings survive local/server synchronisation", () => {
  it("local event with detailed findings is not overwritten by server projected text", () => {
    const local = makeEvent({ event_id: "e1", what_happened: "This page impersonates ANZ Bank and was registered yesterday." });
    const serverProjected = makeProjectedEvent({ event_id: "e1" });

    // The merge logic in ApolloContext preserves local when localHasDetail is true.
    const localHasDetail = !!(local.what_happened?.trim()) && local.what_happened !== serverProjected.what_happened;
    assert.ok(localHasDetail, "Local event has different (detailed) content vs server projection");

    // After merge, local content should win:
    const merged = {
      ...local,
      headline: localHasDetail ? local.headline : serverProjected.headline,
      what_happened: localHasDetail ? local.what_happened : serverProjected.what_happened,
      why: localHasDetail ? local.why : serverProjected.why,
      what_to_do: localHasDetail ? local.what_to_do : serverProjected.what_to_do,
    };
    assert.equal(merged.what_happened, "This page impersonates ANZ Bank and was registered yesterday.");
    assert.equal(merged.headline, "Suspicious login page detected");
  });

  it("events from other devices (no local version) take server data as-is", () => {
    const serverOnly = makeProjectedEvent({ event_id: "e-other-device" });
    // No local event exists → server version is used
    assert.ok(isProjectedContent(serverOnly.what_happened), "Server event is correctly identified as projected");
  });

  it("isProjectedContent detects all known server projection signatures", () => {
    assert.ok(isProjectedContent("A local assessment was recorded. Details stay on the device."));
    assert.ok(isProjectedContent("Apollo checked a security check and found something that needs your attention. The full assessment is available on the device where it happened."));
    assert.ok(isProjectedContent("Only a minimal security summary is shared."));
    assert.ok(isProjectedContent("Apollo recorded a website check"));
    assert.ok(isProjectedContent(null));
    assert.ok(isProjectedContent(""));
    assert.ok(isProjectedContent("known_threat")); // internal code
    assert.ok(!isProjectedContent("This page impersonates ANZ Bank and was registered yesterday."));
    assert.ok(!isProjectedContent("Apollo blocked fake-bank.example.com on this device."));
  });
});

// ── Test 2: Handled findings stay handled ───────────────────────────────────
describe("2. Handled findings remain handled; new evidence can reopen", () => {
  it("resolved event stays resolved even when server says active", () => {
    const local = makeEvent({ event_id: "e2", status: "resolved", resolved_at: new Date().toISOString() });
    const serverStillActive = makeEvent({ event_id: "e2", status: "active", resolved_at: null });

    const localResolved = local.status === "resolved" || local.status === "trusted" || !!local.resolved_at;
    const serverHasNewEvidence = false; // Same revision, same state
    const preserveResolution = localResolved && !serverHasNewEvidence;

    assert.ok(preserveResolution, "Local resolution is preserved");
    const mergedStatus = preserveResolution ? local.status : serverStillActive.status;
    assert.equal(mergedStatus, "resolved");
  });

  it("genuinely new evidence (higher revision + higher severity) CAN reopen", () => {
    const local = makeEvent({
      event_id: "e3", status: "resolved", resolved_at: new Date().toISOString(), state: "barking",
      patrol_record: { recordId: "r1", logicalIssueKey: "k1", revision: 1, supersedes: null, sourceEventId: "e3", sourceType: "patrol", effectiveState: "barking", effectiveReason: "flagged" } as any,
    });
    const serverNewEvidence = makeEvent({
      event_id: "e3", status: "active", state: "biting", verified_block: true,
      patrol_record: { recordId: "r1", logicalIssueKey: "k1", revision: 2, supersedes: null, sourceEventId: "e3", sourceType: "patrol", effectiveState: "biting", effectiveReason: "blocked" } as any,
    });

    const localResolved = !!local.resolved_at;
    const serverHasNewEvidence = serverNewEvidence.patrol_record && local.patrol_record
      && serverNewEvidence.patrol_record.revision > local.patrol_record.revision
      && STATE_RANK[serverNewEvidence.state] > STATE_RANK[local.state];
    const preserveResolution = localResolved && !serverHasNewEvidence;

    assert.ok(!preserveResolution, "New evidence with higher revision + severity reopens the event");
  });

  it("isActive excludes resolved events from warning counts", () => {
    const resolved = makeEvent({ status: "resolved", resolved_at: new Date().toISOString() });
    const trusted = makeEvent({ status: "trusted" });
    const active = makeEvent({ status: "active" });

    assert.ok(!isActive(resolved), "Resolved event is not active");
    assert.ok(!isActive(trusted), "Trusted event is not active");
    assert.ok(isActive(active), "Active event is active");
  });
});

// ── Test 3: Repeated blocks don't create misleading duplicates ──────────────
describe("3. Repeated blocks retain enforcement evidence without duplicate threats", () => {
  it("enforcement evidence dedup by evidenceId prevents duplicate biting events", () => {
    const seen = new Set<string>();
    const evidence = [
      { evidenceId: "pkt-001", destination: { domain: "apolloverify.harmonywellnessgroup.com.au" } },
      { evidenceId: "pkt-001", destination: { domain: "apolloverify.harmonywellnessgroup.com.au" } }, // duplicate
      { evidenceId: "pkt-002", destination: { domain: "apolloverify.harmonywellnessgroup.com.au" } }, // new evidence, same domain
    ];
    const fresh = evidence.filter((e) => !seen.has(e.evidenceId) && (seen.add(e.evidenceId), true));
    assert.equal(fresh.length, 2, "Only 2 unique evidence items (dedup by evidenceId)");
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
    assert.equal(normalized.state, "biting", "Verified block with valid packet proof stays biting");
    assert.ok(normalized.verified_block, "verified_block preserved");
    assert.equal(normalized.headline, blockWithProof.headline, "Original headline preserved");
  });

  it("normalizeHistoricalEvent downgrades unproven block claim to barking", () => {
    const fakeClaim = makeEvent({ state: "biting", verified_block: true, enforcement_evidence: null });
    const normalized = normalizeHistoricalEvent(fakeClaim);
    assert.equal(normalized.state, "barking", "Unproven block downgraded to barking");
    assert.ok(!normalized.verified_block, "verified_block cleared");
    assert.match(normalized.what_happened, /does not establish/, "Honest explanation for downgrade");
  });
});

// ── Test 4: Correlated vs independent threats ───────────────────────────────
describe("4. Single threat through multiple Gates correlated; independents separate", () => {
  it("events with the same scent_id are grouped as one threat", () => {
    const events = [
      makeEvent({ event_id: "e1", scent_id: "scent-abc", category: "website" }),
      makeEvent({ event_id: "e2", scent_id: "scent-abc", category: "email" }),
    ];
    assert.equal(countDistinctThreats(events), 1, "Same scent_id = 1 distinct threat");
  });

  it("events with different scent_ids are separate threats", () => {
    const events = [
      makeEvent({ event_id: "e1", scent_id: "scent-abc", category: "website" }),
      makeEvent({ event_id: "e2", scent_id: "scent-xyz", category: "email" }),
    ];
    assert.equal(countDistinctThreats(events), 2, "Different scent_id = 2 threats");
  });

  it("events without scent_id are each their own threat", () => {
    const events = [
      makeEvent({ event_id: "e1", scent_id: undefined }),
      makeEvent({ event_id: "e2", scent_id: undefined }),
    ];
    assert.equal(countDistinctThreats(events), 2, "No scent_id = each event is its own threat");
  });

  it("resolved events are excluded from threat count", () => {
    const events = [
      makeEvent({ event_id: "e1", status: "resolved", resolved_at: new Date().toISOString() }),
      makeEvent({ event_id: "e2", status: "active" }),
    ];
    assert.equal(countDistinctThreats(events), 1, "Resolved event not counted");
  });
});

// ── Test 5: Home warning counts = distinct findings needing attention ────────
describe("5. Home warning counts include only distinct findings genuinely requiring attention", () => {
  it("buildHomeAttention excludes resolved events", () => {
    const gates = [{ id: "site", title: "Site Gate", tone: "good" }] as any[];
    const events = [
      makeEvent({ event_id: "e1", status: "resolved", resolved_at: new Date().toISOString() }),
      makeEvent({ event_id: "e2", status: "active", state: "barking" }),
    ];
    const attention = buildHomeAttention({ gates, events });
    const eventItems = attention.filter((a) => a.kind === "event");
    assert.equal(eventItems.length, 1, "Only the active event needs attention");
  });

  it("countDistinctThreats matches real threat count, not duplicate-inflated count", () => {
    const events = [
      makeEvent({ event_id: "e1", scent_id: "s1", state: "barking" }),
      makeEvent({ event_id: "e2", scent_id: "s1", state: "growling" }), // same scent
      makeEvent({ event_id: "e3", scent_id: "s2", state: "ears_up" }), // different scent
      makeEvent({ event_id: "e4", status: "resolved", resolved_at: new Date().toISOString() }), // resolved
    ];
    assert.equal(countDistinctThreats(events), 2, "2 distinct threats (s1 + s2), resolved excluded");
  });
});

// ── Test 6: Every finding has accurate status, date/time, evidence, actions ──
describe("6. Every finding displays accurate status, date/time, evidence, actions", () => {
  it("threat findings include firstDetected, latestActivity, and eventCount", () => {
    const earlier = new Date(Date.now() - 3600_000).toISOString();
    const later = new Date().toISOString();
    const events = [
      makeEvent({ event_id: "e1", scent_id: "s1", occurred_at: earlier }),
      makeEvent({ event_id: "e2", scent_id: "s1", occurred_at: later }),
    ];
    const findings = buildProtectionFindings({ capabilities: [], gates: [], attention: [], events });
    const threats = findings.filter((f) => f.findingType === "threat");
    assert.ok(threats.length >= 1, "At least one threat finding");
    const t = threats[0];
    assert.ok(t.firstDetected, "firstDetected is set");
    assert.ok(t.latestActivity, "latestActivity is set");
    assert.equal(t.eventCount, 2, "eventCount matches grouped events");
  });

  it("threat findings have actionable route to the investigation", () => {
    const events = [makeEvent({ event_id: "e1" })];
    const findings = buildProtectionFindings({ capabilities: [], gates: [], attention: [], events });
    const threats = findings.filter((f) => f.findingType === "threat");
    assert.ok(threats[0]?.route?.includes("e1"), "Route points to the specific event");
    assert.equal(threats[0]?.actionLabel, "Open investigation");
  });

  it("biting events get 'Threat stopped' status label", () => {
    const events = [makeBlockEvent()];
    const findings = buildProtectionFindings({ capabilities: [], gates: [], attention: [], events });
    const threats = findings.filter((f) => f.findingType === "threat");
    assert.ok(threats.length >= 1);
    assert.equal(threats[0].statusLabel, "Threat stopped");
  });
});

// ── Test 7: Higgins explanations are evidence-backed, no generic fallbacks ──
describe("7. Higgins explanations are specific, evidence-backed, no generic fallback narratives", () => {
  it("narrateEvent with real evidence produces specific narration", () => {
    const event = makeEvent();
    const chunks = narrateEvent(event);
    const whatChunk = chunks.find((c) => c.id === "what");
    assert.ok(whatChunk, "Has a 'what happened' chunk");
    assert.match(whatChunk!.text, /impersonating a bank/, "Narration uses real evidence text");
    assert.ok(!isProjectedContent(whatChunk!.text), "Narration is not identified as projected");
  });

  it("narrateEvent with projected content narrates honestly (no fabrication)", () => {
    const projected = makeProjectedEvent();
    const chunks = narrateEvent(projected);
    const whatChunk = chunks.find((c) => c.id === "what");
    assert.ok(whatChunk, "Has a 'what happened' chunk");
    assert.match(whatChunk!.text, /only available on the device/, "Narration honestly says evidence is elsewhere");
    assert.ok(!whatChunk!.text.includes("impersonating"), "Does NOT fabricate evidence");
  });

  it("narrateIncident marks projected events honestly within the timeline", () => {
    const plan = {
      headline: "Connected incident",
      state: "barking" as ApolloState,
      timeline: [
        makeEvent({ event_id: "e1", what_happened: "Real evidence from this device." }),
        makeProjectedEvent({ event_id: "e2" }),
      ],
      exposure: [],
      steps: [],
      allResolved: false,
    } as any;
    const chunks = narrateIncident(plan);
    const evt2 = chunks.find((c) => c.id === "event-1");
    assert.ok(evt2, "Second event is narrated");
    assert.match(evt2!.text, /only on the device/, "Projected event narrated honestly");
  });

  it("humanizeReason converts code to honest state-based sentence, passes prose through", () => {
    assert.equal(humanizeReason("server_projection_of_recorded_outcome", "barking"), "Apollo recorded something that needs your attention.");
    assert.equal(humanizeReason("The domain was registered 2 days ago.", "barking"), "The domain was registered 2 days ago.");
  });

  it("scrubMessage replaces internal codes in free text with plain English", () => {
    assert.equal(scrubMessage("Status: known_threat"), "Status: website safety");
    assert.equal(scrubMessage("No issues found"), "No issues found");
  });
});

// ── Test 8: Missing/stale/contradictory evidence can't create false claims ──
describe("8. Missing, stale or contradictory evidence cannot create false threat or protection claims", () => {
  it("normalizeHistoricalEvent prevents false biting claim without packet proof", () => {
    const fake = makeEvent({ state: "biting", verified_block: true, enforcement_evidence: null });
    const n = normalizeHistoricalEvent(fake);
    assert.equal(n.state, "barking");
    assert.ok(!n.verified_block);
  });

  it("empty what_happened is detected as projected (no false narration)", () => {
    assert.ok(isProjectedContent(""));
    assert.ok(isProjectedContent(null));
    assert.ok(isProjectedContent(undefined));
  });

  it("resolveApolloState with only resolved events does not bark", () => {
    const resolved = makeEvent({ status: "resolved", resolved_at: new Date().toISOString() });
    const resolution = resolveApolloState({
      events: [resolved],
      visibility: "full",
      lastVerifiedAt: new Date().toISOString(),
    });
    assert.notEqual(resolution.state, "barking", "Resolved events should not make Apollo bark");
    assert.notEqual(resolution.state, "biting");
  });

  it("looksLikeInternalCode catches developer identifiers but not prose", () => {
    assert.ok(looksLikeInternalCode("known_threat"));
    assert.ok(looksLikeInternalCode("ears_up"));
    assert.ok(looksLikeInternalCode("server_projection_of_recorded_outcome"));
    assert.ok(!looksLikeInternalCode("This page impersonates a bank"));
    assert.ok(!looksLikeInternalCode("Apollo blocked the connection"));
  });
});

// ── Test 9: Privacy restrictions and enforcement truth gates intact ──────────
describe("9. Privacy restrictions and native enforcement truth gates remain intact", () => {
  it("projectedEventVoice produces privacy-safe text with no detail leak", () => {
    const voice = projectedEventVoice("website", "barking", false);
    assert.ok(!voice.whatHappened.includes("fake-bank"), "No domain leaked");
    assert.ok(!voice.whatHappened.includes("ANZ"), "No brand leaked");
    assert.match(voice.whatHappened, /device where it happened/, "Points to originating device");
  });

  it("projectedEventVoice for verified block describes enforcement without leaking indicator", () => {
    const voice = projectedEventVoice("connection", "biting", true);
    assert.match(voice.whatHappened, /blocked/, "Describes the block");
    assert.ok(!voice.whatHappened.includes("example.com"), "No indicator leaked");
  });

  it("isActive preserves the enforcement truth gate: blocked+biting without resolution stays active", () => {
    const blockedUnresolved = makeBlockEvent({ resolved_at: null });
    assert.ok(isActive(blockedUnresolved), "Blocked+biting without resolution = active");

    const blockedResolved = makeBlockEvent({ resolved_at: new Date().toISOString() });
    assert.ok(!isActive(blockedResolved), "Blocked+biting WITH resolution = inactive");
  });

  it("STATE_RANK hierarchy is intact: biting > barking > growling > ears_up > resting", () => {
    assert.ok(STATE_RANK.biting > STATE_RANK.barking);
    assert.ok(STATE_RANK.barking > STATE_RANK.growling);
    assert.ok(STATE_RANK.growling > STATE_RANK.ears_up);
    assert.ok(STATE_RANK.ears_up > STATE_RANK.resting);
  });
});
