// Mock patrol event for web preview — lets the 4-tab investigation UI be exercised
// without a real on-device check. Only injected when IS_PREVIEW_HARNESS is true and
// the persisted events list is empty. Never shipped to production builds.

import type { PatrolEvent } from "@/src/domain/types";

const now = new Date().toISOString();
const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();

export const MOCK_THREAT_EVENT: PatrolEvent = {
  event_id: "preview-mock-threat-001",
  device_id: "preview-device",
  category: "website",
  state: "barking",
  status: "active",
  headline: "Suspicious phishing website detected",
  what_happened:
    "Apollo detected a website at commbank-secure-verify.xyz that impersonates a Commonwealth Bank login page. The domain was registered 3 days ago and the SSL certificate does not match the claimed organization.",
  why: [
    "Domain registered only 3 days ago",
    "Mimics Commonwealth Bank login page",
    "SSL certificate issued to an unknown entity",
  ],
  what_to_do:
    "Do not enter any credentials on this site. Close the browser tab. If you already entered information, change your password at commbank.com.au and contact CommBank on 13 2221.",
  indicator_host: "commbank-secure-verify.xyz",
  indicator_digest: "sha256:preview-mock-digest",
  local_indicator: "https://commbank-secure-verify.xyz/login",
  verified_block: false,
  evidence_provenance: "local_device",
  adapter_label: "preview",
  occurred_at: fiveMinAgo,
  resolved_at: null,
  supporting_references: [
    {
      label: "ACSC phishing advisory",
      url: "https://www.cyber.gov.au/protect-yourself/staying-safe-online/phishing",
    },
  ],
  patrol_record: {
    recordId: "preview-rec-001",
    logicalIssueKey: "website:commbank-secure-verify.xyz:barking",
    revision: 1,
    supersedes: null,
    sourceEventId: "preview-mock-threat-001",
    sourceType: "on_device",
    category: "website",
    headline: "Suspicious phishing website detected",
    summary:
      "This website impersonates Commonwealth Bank and was registered very recently. High confidence phishing attempt.",
    rawState: "barking",
    effectiveState: "danger",
    effectiveReason:
      "Apollo identified this as a phishing attempt targeting your bank credentials.",
    observedBlockReference: null,
    assessmentReference: null,
    investigationCaseId: null,
    scenarioContext: {
      scenario: "Bank credential phishing",
      claimedBrand: "Commonwealth Bank",
      indicatorHost: "commbank-secure-verify.xyz",
    },
    freshness: {
      observedAt: fiveMinAgo,
      projectedAt: now,
      status: "fresh",
    },
    outageContext: null,
    resolution: null,
    duplicateOf: null,
    duplicateReason: null,
    occurredAt: fiveMinAgo,
    updatedAt: now,
    recordClass: "security_threat",
    higginsBriefing: {
      investigated:
        "Higgins investigated a website at commbank-secure-verify.xyz that claimed to be a Commonwealth Bank login page.",
      established:
        "The domain was registered 3 days ago and does not belong to Commonwealth Bank. The SSL certificate is issued to a different organization. This is a phishing site designed to steal your banking credentials.",
      evidence_points: [
        "Domain commbank-secure-verify.xyz registered 3 days ago (newly registered)",
        "SSL certificate issued to unknown entity, not Commonwealth Bank",
        "Login form layout identical to the real CommBank page",
        "URL structure mimics real bank login patterns",
      ],
      meaning:
        "This is a confirmed phishing attempt. Any credentials entered here will be captured by attackers, not Commonwealth Bank.",
      action:
        "Do not enter any information. If you already entered your password, change it immediately at commbank.com.au and contact CommBank on 13 2221.",
      record_class: "security_threat",
      generated_at: now,
      version: "1.0",
    },
    reassessment: null,
    event: null as unknown as PatrolEvent,
  },
};
