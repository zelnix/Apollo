import assert from "node:assert/strict";
import test from "node:test";

import { enforceEgress, EgressViolation } from "../src/domain/privacy.ts";
import { patrolRecordToEvent } from "../src/domain/patrolRecords.ts";
import type { PatrolRecord } from "../src/domain/types.ts";

test("C22 canonical unavailableReason passes before provider dispatch", () => {
  const value = enforceEgress("investigation", { requestId: "request-1", caseRevision: 2, capabilityId: "device_profile", status: "unavailable", observedAt: "2026-09-23T00:00:00Z", values: {}, simulation: false, unavailableReason: "privacy_prohibited" });
  assert.equal(value.unavailableReason, "privacy_prohibited");
});

test("C22 unknown fields fail with a stable internal code and generic message", () => {
  assert.throws(() => enforceEgress("investigation", { requestId: "request-1", schemaLeak: "secret" }), (error: unknown) => {
    assert.equal((error as EgressViolation).code, "EGRESS_SCHEMA_REJECTED");
    assert.doesNotMatch((error as Error).message, /schemaLeak|field/i);
    return true;
  });
});

test("C21 capability snapshots admit only the bounded registry shape", () => {
  const result = enforceEgress("capability_snapshot", { platform: "android", adapter: "Apollo", online: true,
    gates: [{ id: "site", state: "running", reason: null }], capabilities: [{ id: "site_guard", state: "running", reason: null }],
    protection: { requested: true, operational: true, enforcementMethod: "packet_filter", degradedReason: null } });
  assert.equal((result.gates as unknown[]).length, 1);
});

test("C24 consumer event state comes from the server Patrol record", () => {
  const record = { recordId: "record-1", logicalIssueKey: "issue-1", revision: 2, supersedes: "record-0", sourceEventId: "event-1", sourceType: "device_enforcement",
    category: "website", headline: "Blocked", summary: "A destination was blocked.", rawState: "biting", effectiveState: "blocked", effectiveReason: "fresh_packet_drop_evidence",
    observedBlockReference: "evidence-1", assessmentReference: "event-1", investigationCaseId: null, scenarioContext: null,
    freshness: { observedAt: "2026-09-23T00:00:00Z", projectedAt: "2026-09-23T00:00:01Z", status: "current" }, outageContext: null,
    resolution: { status: "active", resolvedAt: null }, duplicateOf: null, duplicateReason: null, occurredAt: "2026-09-23T00:00:00Z", updatedAt: "2026-09-23T00:00:01Z",
    event: { event_id: "event-1", device_id: "device-123", category: "website", state: "barking", status: "active", headline: "Old", what_happened: "Old", why: [], what_to_do: "Review", indicator_host: null, indicator_digest: null, verified_block: false, adapter_label: "Apollo", occurred_at: "2026-09-23T00:00:00Z", resolved_at: null } } satisfies PatrolRecord;
  const event = patrolRecordToEvent(record);
  assert.equal(event.state, "biting"); assert.equal(event.verified_block, true); assert.equal(event.patrol_record?.logicalIssueKey, "issue-1");
});