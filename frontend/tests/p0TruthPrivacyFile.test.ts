import assert from "node:assert/strict";
import { test } from "node:test";

import { toPatrolEnforcementEvidence } from "../src/domain/enforcementEvidenceSync.ts";
import { inspectWithHandle, FILE_SAMPLE_BYTES, FILE_SIZE_LIMIT } from "../src/domain/fileInspection.ts";
import { analyseFile } from "../src/domain/fileAnalysis.ts";
import { eventHasPacketProof, isPacketEvidence } from "../src/domain/packetEvidence.ts";
import { patrolPayload } from "../src/domain/patrolPayload.ts";
import { EgressViolation, enforceEgress } from "../src/domain/privacy.ts";
import {
  freshObservation,
  OBSERVATION_MAX_AGE_MS,
} from "../src/domain/protectionObservation.ts";
import {
  RECOVERY_COOLDOWN_MS,
  resolveApolloState,
  VERIFICATION_FRESHNESS_MS,
} from "../src/domain/stateMachine.ts";
import type { PatrolEvent } from "../src/domain/types.ts";
import type { EnforcementEvidence } from "../src/security/PlatformCapabilityProfile.ts";

const now = Date.parse("2026-01-10T10:00:00Z");

function sampleEvidence(overrides: Partial<EnforcementEvidence> = {}): EnforcementEvidence {
  return {
    evidenceId: "ev-123",
    eventId: "evt-123",
    deviceId: "dev-123",
    platform: "android",
    osVersion: null,
    sdkVersion: null,
    observedAt: new Date(now - 10_000).toISOString(),
    mechanism: "dns_filter",
    direction: "outbound",
    protocol: "dns",
    destination: { ip: null, domain: "evil.example", port: 53 },
    attribution: { appId: null, processName: null, confidence: "unavailable" },
    matchedRuleId: "evil.example",
    threatId: null,
    requestedAction: "block",
    enforcedAction: "blocked",
    result: "verified",
    ruleSource: "local_blocklist",
    confidence: "high",
    sourceMetadata: {},
    correlationId: null,
    ...overrides,
  };
}

function event(overrides: Partial<PatrolEvent> = {}): PatrolEvent {
  return {
    event_id: "evt-123",
    device_id: "dev-123",
    category: "connection",
    state: "biting",
    status: "blocked",
    headline: "private marker +61400000000 user@example.com password=abc",
    what_happened: "https://evil.example/reset?token=secret",
    why: ["private marker"],
    what_to_do: "call +61400000000",
    indicator_host: "evil.example",
    indicator_digest: "a".repeat(64),
    verified_block: true,
    adapter_label: "native",
    occurred_at: new Date(now - 10_000).toISOString(),
    resolved_at: null,
    trust_allowed: false,
    enforcement_evidence: toPatrolEnforcementEvidence(sampleEvidence()),
    ...overrides,
  };
}

test("state machine: pre-resolution stays growling, post-resolution fresh check can rest", () => {
  const active = resolveApolloState({
    events: [event({ state: "growling", status: "active", enforcement_evidence: null, verified_block: false })],
    visibility: "full",
    lastVerifiedAt: new Date(now).toISOString(),
    now,
  });
  assert.equal(active.state, "growling");

  const resolvedAt = new Date(now - RECOVERY_COOLDOWN_MS - 1_000).toISOString();
  const rested = resolveApolloState({
    events: [event({ state: "barking", status: "resolved", resolved_at: resolvedAt, enforcement_evidence: null, verified_block: false })],
    visibility: "full",
    lastVerifiedAt: new Date(now - 500).toISOString(),
    now,
  });
  assert.equal(rested.state, "resting");
});

test("freshness checks: stale/missing/future or visibility none never healthy", () => {
  assert.equal(freshObservation(null, now), false);
  assert.equal(
    freshObservation(
      {
        requested: true,
        running: true,
        operational: true,
        enforcementMethod: "dns_filter",
        coverage: "",
        coverageScope: [],
        lastVerified: new Date(now - OBSERVATION_MAX_AGE_MS - 1).toISOString(),
        degradedReason: null,
        visibility: "full",
        since: null,
        adapterLabel: "x",
        checkedAt: "",
      },
      now,
    ),
    false,
  );
  assert.equal(
    freshObservation(
      {
        requested: true,
        running: true,
        operational: true,
        enforcementMethod: "dns_filter",
        coverage: "",
        coverageScope: [],
        lastVerified: new Date(now + 60_000).toISOString(),
        degradedReason: null,
        visibility: "full",
        since: null,
        adapterLabel: "x",
        checkedAt: "",
      },
      now,
    ),
    false,
  );

  const hidden = resolveApolloState({
    events: [],
    visibility: "none",
    lastVerifiedAt: new Date(now).toISOString(),
    now,
  });
  assert.notEqual(hidden.state, "resting");
});

test("recent valid packet evidence allows biting; call/manual variants do not", () => {
  const good = event();
  assert.equal(eventHasPacketProof(good), true);
  const r = resolveApolloState({
    events: [good],
    visibility: "full",
    lastVerifiedAt: new Date(now).toISOString(),
    now,
  });
  assert.equal(r.state, "biting");

  const callEvent = event({ category: "call" });
  assert.equal(eventHasPacketProof(callEvent), false);

  const manual = sampleEvidence({ enforcedAction: "none", result: "unverified", ruleSource: "user_override" });
  assert.equal(isPacketEvidence(manual), false);
});

test("mapper -> patrolPayload -> enforceEgress accepts valid packet evidence", () => {
  const mapped = toPatrolEnforcementEvidence(sampleEvidence());
  const payload = patrolPayload(event({ enforcement_evidence: mapped }), "dev-123");
  const out = enforceEgress("patrol_sync", payload);
  assert.equal((out as any).enforcement_evidence.evidence_id, "ev-123");
  assert.equal((out as any).headline, "Apollo observed a blocked connection");
  assert.ok(!JSON.stringify(out).includes("private marker"));
});

test("enforceEgress rejects unknown/sensitive nested evidence keys", () => {
  const payload = patrolPayload(event(), "dev-123") as any;
  payload.enforcement_evidence.extra = "nope";
  assert.throws(() => enforceEgress("patrol_sync", payload), EgressViolation);

  const payload2 = patrolPayload(event(), "dev-123") as any;
  payload2.enforcement_evidence.os_version = "Android 15";
  assert.throws(() => enforceEgress("patrol_sync", payload2), EgressViolation);
});

test("explicit message payload preserves assessment context but redacts secret URL values", () => {
  const msg = enforceEgress("message_check", {
    device_id: "dev-123",
    sender: "Bank Alerts",
    text: "Please review the claimed payment.",
    urls: ["https://example.com/reset?token=secret&email=user@example.com"],
    local_state: "growling",
    scenario: "M1",
    signals: [],
    claimed_brand: null,
    second_opinion: false,
  } as any);
  assert.equal((msg as any).sender, "Bank Alerts");
  assert.equal((msg as any).text, "Please review the claimed payment.");
  assert.match((msg as any).urls[0], /^https:\/\/example\.com\/reset\?/);
  assert.match((msg as any).urls[0], /token=%5Bredacted%5D/);
  assert.doesNotMatch((msg as any).urls[0], /token=secret/);

  const ask = enforceEgress("ask_apollo", {
    device_id: "dev-123",
    message: "private marker",
    context: "phone +61400000000 password abc",
  });
  assert.match((ask as any).context, /Do not request passwords/i);
  assert.doesNotMatch((ask as any).context, /\+6140|password abc/i);

  const family = enforceEgress("family", {
    device_id: "dev-123",
    events: [{ event_id: "x", category: "message", state: "barking", headline: "phone +614", occurred_at: new Date(now).toISOString(), status: "active" }],
    steps: [{ id: "s1", text: "send code" }],
    headline: "private marker",
  } as any);
  assert.equal((family as any).headline, "Shared Apollo security incident");
  assert.doesNotMatch(JSON.stringify(family), /\+614|password|private marker/i);
});

test("inspection bounds: oversized/empty never open; reads <=200000; close on read error", () => {
  let opened = 0;
  const empty = inspectWithHandle({
    size: 0,
    open: () => {
      opened += 1;
      return { readBytes: () => new Uint8Array(), close: () => undefined };
    },
  });
  assert.ok(empty.inspectionError);
  assert.equal(opened, 0);

  const huge = inspectWithHandle({
    size: FILE_SIZE_LIMIT + 1,
    open: () => ({ readBytes: () => new Uint8Array(), close: () => undefined }),
  });
  assert.ok(huge.inspectionError);

  let requested = 0;
  let closed = false;
  const bounded = inspectWithHandle({
    size: FILE_SAMPLE_BYTES + 50_000,
    open: () => ({
      readBytes: (n: number) => {
        requested = n;
        return new Uint8Array(FILE_SAMPLE_BYTES + 1);
      },
      close: () => {
        closed = true;
      },
    }),
  });
  assert.ok(bounded.headBytes);
  assert.ok(requested <= FILE_SAMPLE_BYTES);
  assert.equal(closed, true);

  let closedOnError = false;
  assert.throws(() =>
    inspectWithHandle({
      size: 64,
      open: () => ({
        readBytes: () => {
          throw new Error("boom");
        },
        close: () => {
          closedOnError = true;
        },
      }),
    }),
  );
  assert.equal(closedOnError, true);
});

test("file analysis never reassures safe opening from name/type alone", () => {
  const unknown = analyseFile({ name: "invoice.docx", source: "message" });
  assert.equal(unknown.state, "ears_up");
  assert.match(unknown.verdict, /couldn't inspect this file/i);

  const limited = analyseFile({
    name: "statement.pdf",
    source: "known",
    headBytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    textSample: "safe-looking text",
  });
  assert.match(limited.verdict, /safety is not established/i);
  assert.match(limited.recommendation, /Do not treat this result as permission/i);
});

test("tick/time dependency remains explicit (no physical device claim)", () => {
  const resolvedEvent = event({
    state: "barking",
    status: "resolved",
    resolved_at: new Date(now - RECOVERY_COOLDOWN_MS - 1_000).toISOString(),
    enforcement_evidence: null,
    verified_block: false,
  });
  const near = resolveApolloState({
    events: [resolvedEvent],
    visibility: "full",
    lastVerifiedAt: new Date(now - 1_000).toISOString(),
    now,
  });
  const far = resolveApolloState({
    events: [resolvedEvent],
    visibility: "full",
    lastVerifiedAt: new Date(now - VERIFICATION_FRESHNESS_MS - 1_000).toISOString(),
    now,
  });
  assert.equal(near.state, "resting");
  assert.notEqual(far.state, "resting");
});
