// Bridges the adapter/SDK-layer EnforcementEvidence (camelCase, nested — see
// src/security/PlatformCapabilityProfile.ts) into the backend/domain-facing
// PatrolEnforcementEvidence (snake_case, flat — see src/domain/types.ts), matching every other
// PatrolEvent field's existing convention. This is the ONLY place that conversion happens, so the
// mapping is auditable in one place instead of re-implemented at every call site.
import type { EnforcementEvidence } from "@/src/security/PlatformCapabilityProfile";
import type { PatrolEnforcementEvidence } from "./types";

export function toPatrolEnforcementEvidence(evidence: EnforcementEvidence): PatrolEnforcementEvidence {
  return {
    evidence_id: evidence.evidenceId,
    event_id: evidence.eventId,
    device_id: evidence.deviceId,
    platform: evidence.platform,
    os_version: null,
    sdk_version: null,
    observed_at: evidence.observedAt,
    mechanism: evidence.mechanism,
    direction: evidence.direction,
    protocol: evidence.protocol,
    destination_ip: null,
    destination_domain: evidence.destination.domain,
    destination_port: evidence.destination.port,
    app_id: null,
    process_name: null,
    attribution_confidence: "unavailable",
    matched_rule_id: evidence.matchedRuleId,
    threat_id: null,
    requested_action: evidence.requestedAction,
    enforced_action: evidence.enforcedAction,
    result: evidence.result,
    rule_source: evidence.ruleSource,
    confidence: evidence.confidence,
    correlation_id: null,
  };
}
