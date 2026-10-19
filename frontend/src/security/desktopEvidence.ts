import type { EnforcementEvidence } from "./PlatformCapabilityProfile";

const token = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(value);
const domain = (value: unknown): value is string => typeof value === "string" && value.length <= 253 && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/i.test(value);
const member = <T extends string>(value: unknown, values: readonly T[]): value is T => typeof value === "string" && values.includes(value as T);
const nullableText = (value: unknown, max: number): value is string | null => value === null || (typeof value === "string" && value.length <= max);

export function parseDesktopEnforcementEvidence(value: unknown): EnforcementEvidence[] {
  if (!Array.isArray(value)) return [];
  return value.filter((candidate): candidate is EnforcementEvidence => {
    if (!candidate || typeof candidate !== "object") return false;
    const row = candidate as Record<string, unknown>;
    const destination = row.destination as Record<string, unknown> | null;
    const attribution = row.attribution as Record<string, unknown> | null;
    return token(row.evidenceId) && member(row.platform, ["windows", "macos"] as const) &&
      typeof row.observedAt === "string" && Number.isFinite(Date.parse(row.observedAt)) &&
      member(row.mechanism, ["wfp_ale_authorization", "network_extension"] as const) &&
      member(row.direction, ["outbound", "inbound", "unknown"] as const) &&
      member(row.protocol, ["tcp", "udp", "unknown"] as const) && !!destination &&
      nullableText(destination.ip, 64) && (destination.domain === null || domain(destination.domain)) &&
      (destination.port === null || (Number.isInteger(destination.port) && Number(destination.port) >= 1 && Number(destination.port) <= 65535)) &&
      !!attribution && nullableText(attribution.appId, 128) && nullableText(attribution.processName, 128) &&
      member(attribution.confidence, ["high", "medium", "low", "unavailable"] as const) &&
      (row.eventId === null || token(row.eventId)) && (row.deviceId === null || token(row.deviceId)) &&
      nullableText(row.osVersion, 64) && nullableText(row.sdkVersion, 32) &&
      (row.matchedRuleId === null || (typeof row.matchedRuleId === "string" && /^[A-Za-z0-9_.:-]{1,253}$/.test(row.matchedRuleId))) &&
      (row.threatId === null || token(row.threatId)) && member(row.requestedAction, ["block", "allow", "monitor"] as const) &&
      member(row.enforcedAction, ["blocked", "allowed", "monitored", "none"] as const) &&
      member(row.result, ["verified", "unverified", "failed"] as const) &&
      member(row.ruleSource, ["local_blocklist", "cloud_intel", "heuristic", "user_override", "unknown"] as const) &&
      member(row.confidence, ["high", "medium", "low"] as const) && (row.correlationId === null || token(row.correlationId));
  });
}

export function isVerifiedDesktopFlowDrop(evidence: EnforcementEvidence): boolean {
  return evidence.result === "verified" && evidence.requestedAction === "block" && evidence.enforcedAction === "blocked" &&
    evidence.direction === "outbound" && domain(evidence.destination.domain) &&
    Number.isInteger(evidence.destination.port) && Number(evidence.destination.port) >= 1 &&
    ((evidence.platform === "windows" && evidence.mechanism === "wfp_ale_authorization") ||
      (evidence.platform === "macos" && evidence.mechanism === "network_extension"));
}