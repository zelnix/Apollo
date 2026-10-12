// Mock patrol event for web preview — lets the 4-tab investigation UI be exercised
// without a real on-device check. Only injected when running on web and
// the persisted events list is empty.

import type { PatrolEvent } from "@/src/domain/types";

const now = new Date().toISOString();
const occurredAt = new Date(Date.now() - 5 * 24 * 60 * 60_000).toISOString();   // 5 days ago
const investigatedAt = new Date(Date.now() - 5 * 24 * 60 * 60_000 + 35 * 60_000).toISOString(); // 35 min later
const completedAt = new Date(Date.now() - 5 * 24 * 60 * 60_000 + 75 * 60_000).toISOString(); // 75 min later
const resolvedAt = new Date(Date.now() - 2 * 24 * 60 * 60_000).toISOString();    // 2 days ago

export const MOCK_THREAT_EVENT: PatrolEvent = {
  event_id: "preview-mock-threat-001",
  device_id: "preview-device",
  category: "device",
  state: "barking",
  status: "resolved",
  headline: "Device management profile is active",
  what_happened:
    "Apollo found that a device management profile is active on this device. This can allow an organisation or application to control certain settings on your device.\n\nThis does not automatically mean your device is compromised, but it can reduce your control and may prevent Apollo from providing some of his automatic protection.",
  why: [
    "Active device management profile detected",
    "May reduce your control over the device and prevent some of Apollo's automatic protection",
    "Management profiles are sometimes used legitimately by organisations",
  ],
  what_to_do:
    "No immediate action is required. If you are unsure about the device management profile, you can review it on this device.",
  indicator_host: undefined,
  indicator_digest: undefined,
  local_indicator: undefined,
  verified_block: false,
  evidence_provenance: "local_device",
  adapter_label: "preview",
  occurred_at: occurredAt,
  resolved_at: resolvedAt,
  supporting_references: [],
  patrol_record: {
    recordId: "PD-2026-10745",
    logicalIssueKey: "device:management-profile:barking",
    revision: 1,
    supersedes: null,
    sourceEventId: "preview-mock-threat-001",
    sourceType: "on_device",
    category: "device",
    headline: "Device management profile is active",
    summary:
      "The presence of a device management profile is a security risk that warrants your attention, but it does not by itself confirm that your device has been compromised. The profile may be legitimate.",
    rawState: "barking",
    effectiveState: "danger",
    effectiveReason:
      "A management profile is active on this device. This can allow an organisation or application to control certain device settings.",
    observedBlockReference: null,
    assessmentReference: null,
    investigationCaseId: null,
    scenarioContext: {
      scenario: "Device management profile",
      claimedBrand: undefined,
      indicatorHost: undefined,
    },
    freshness: {
      observedAt: occurredAt,
      projectedAt: now,
      status: "fresh",
    },
    outageContext: { message: "The original record also reported that Apollo was not performing his automatic protective duties." } as Record<string, unknown>,
    resolution: null,
    duplicateOf: null,
    duplicateReason: null,
    occurredAt: occurredAt,
    updatedAt: completedAt,
    recordClass: "security_threat",
    higginsBriefing: {
      investigated:
        "A device management profile is active",
      established:
        "Apollo found that a device management profile is active on this device. This can allow an organisation or application to control certain settings on your device.\n\nThis does not automatically mean your device is compromised, but it can reduce your control and may prevent Apollo from providing some of his automatic protection.",
      evidence_points: [
        "Active device management profile detected",
        "May reduce device owner control",
        "Could prevent some of Apollo's automatic protection",
        "Management profiles are sometimes used legitimately by organisations",
      ],
      meaning:
        "The presence of a device management profile is a security risk that warrants your attention, but it does not by itself confirm that your device has been compromised.",
      action:
        "Review device management settings to verify the profile is expected.",
      record_class: "security_threat",
      generated_at: completedAt,
      version: "1.0",
    },
    reassessment: null,
    event: null as unknown as PatrolEvent,
  },
};
