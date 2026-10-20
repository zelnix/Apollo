// Sample patrol event for the web preview — lets the 4-tab investigation UI be exercised without a
// real on-device check. Only injected when running on web with an empty persisted events list.
//
// It is labelled "Example" in every field a person can see, so preview data is never mistaken for a
// real finding. Each block says something DIFFERENT: what was found (naming the profile and where it
// lives), what it means, and what to do. No paragraph is repeated across blocks.

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
  headline: "Example: device management profile \"Acme IT Mobile Device Management\" is active",
  what_happened:
    "This is example data shown in the web preview so you can see how an investigation looks. In it, Apollo found one active management profile, \"Acme IT Mobile Device Management\" (com.acme.mdm.agent), installed 15 Oct 2026. On Android it is listed under Settings → Security → Device admin apps; on iPhone under Settings → General → VPN & Device Management.",
  why: [
    "Profile name: \"Acme IT Mobile Device Management\" (com.acme.mdm.agent)",
    "Granted rights: install apps, change network settings, read some device activity",
    "Apollo's own filter cannot inspect traffic the profile's VPN handles",
  ],
  what_to_do:
    "Open Settings → Security → Device admin apps (Android) or Settings → General → VPN & Device Management (iPhone), find \"Acme IT Mobile Device Management\", and confirm with your work or school that they installed it. Remove it if nobody can account for it.",
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
    headline: "Example: device management profile \"Acme IT Mobile Device Management\" is active",
    summary:
      "A named profile with administrative rights is installed. That warrants a check with whoever owns the device, but on its own it does not mean the device is compromised.",
    rawState: "barking",
    effectiveState: "danger",
    effectiveReason:
      "\"Acme IT Mobile Device Management\" holds device-admin rights that have not been confirmed by the device owner.",
    observedBlockReference: null,
    assessmentReference: null,
    investigationCaseId: null,
    scenarioContext: {
      scenario: "Example — device management profile",
      claimedBrand: undefined,
      indicatorHost: undefined,
    },
    freshness: {
      observedAt: occurredAt,
      projectedAt: now,
      status: "fresh",
    },
    outageContext: { message: "At the time of this example record, Apollo's automatic website protection was not running." } as Record<string, unknown>,
    resolution: null,
    duplicateOf: null,
    duplicateReason: null,
    occurredAt: occurredAt,
    updatedAt: completedAt,
    recordClass: "security_threat",
    higginsBriefing: {
      investigated:
        "Whether \"Acme IT Mobile Device Management\" (com.acme.mdm.agent) is a profile this device's owner put there",
      established:
        "The profile was installed on 15 Oct 2026 and holds device-admin rights. Apollo could not establish who installed it, because neither Android nor iOS records that for an app to read.",
      evidence_points: [
        "Profile name and package: \"Acme IT Mobile Device Management\" (com.acme.mdm.agent)",
        "Installed 15 Oct 2026, device-admin rights active",
        "Installer identity: not recorded by the platform — Apollo cannot tell who added it",
      ],
      meaning:
        "Management profiles are often legitimate, so this is a question to answer rather than a confirmed threat.",
      action:
        "Confirm with your work or school that they installed \"Acme IT Mobile Device Management\". Remove it if nobody can account for it.",
      record_class: "security_threat",
      generated_at: completedAt,
      version: "1.0",
    },
    reassessment: null,
    event: null as unknown as PatrolEvent,
  },
};
