import type { EnforcementEvidence } from "@/src/security/PlatformCapabilityProfile";

const protocols = new Set(["tcp", "udp", "dns", "http", "https", "unknown"]);
const ruleSources = new Set(["local_blocklist", "cloud_intel", "heuristic", "user_override", "unknown"]);
const requestedActions = new Set(["block", "allow", "monitor"]);
const enforcedActions = new Set(["blocked", "allowed", "monitored", "none"]);
const results = new Set(["verified", "unverified", "failed"]);
const confidences = new Set(["high", "medium", "low"]);
const attributionConfidences = new Set([...confidences, "unavailable"]);

export function parseGuardDogCandidateEvidence(raw: string): EnforcementEvidence[] {
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value)) throw new Error("GuardDog evidence inbox is not an array");
  return value.map((item, index) => validate(item, index));
}

function validate(value: unknown, index: number): EnforcementEvidence {
  if (!value || typeof value !== "object") throw new Error(`GuardDog evidence ${index} is not an object`);
  const row = value as Record<string, unknown>;
  const destination = row.destination as Record<string, unknown> | undefined;
  const attribution = row.attribution as Record<string, unknown> | undefined;
  if (typeof row.evidenceId !== "string" || !row.evidenceId || row.platform !== "android" || row.mechanism !== "packet_filter") {
    throw new Error(`GuardDog evidence ${index} has invalid identity/source`);
  }
  if (row.direction !== "outbound" || typeof row.protocol !== "string" || !protocols.has(row.protocol)) {
    throw new Error(`GuardDog evidence ${index} has unsupported direction/protocol`);
  }
  if (typeof row.ruleSource !== "string" || !ruleSources.has(row.ruleSource) || !destination || !attribution) {
    throw new Error(`GuardDog evidence ${index} has unsupported rule/destination/attribution`);
  }
  if (typeof destination.ip !== "string" || typeof destination.domain !== "string" ||
      !(destination.port === null || Number.isInteger(destination.port) && Number(destination.port) >= 1 && Number(destination.port) <= 65535)) {
    throw new Error(`GuardDog evidence ${index} has invalid destination`);
  }
  if (typeof row.observedAt !== "string" || !Number.isFinite(Date.parse(row.observedAt))) {
    throw new Error(`GuardDog evidence ${index} has invalid observation time`);
  }
  if (!requestedActions.has(String(row.requestedAction)) || !enforcedActions.has(String(row.enforcedAction)) ||
      !results.has(String(row.result)) || !confidences.has(String(row.confidence)) ||
      !attributionConfidences.has(String(attribution.confidence))) {
    throw new Error(`GuardDog evidence ${index} has invalid action/result/confidence`);
  }
  for (const field of ["eventId", "deviceId", "osVersion", "sdkVersion", "matchedRuleId", "threatId", "correlationId"] as const) {
    if (!(row[field] === null || typeof row[field] === "string")) throw new Error(`GuardDog evidence ${index} has invalid ${field}`);
  }
  if (!row.sourceMetadata || typeof row.sourceMetadata !== "object" || Array.isArray(row.sourceMetadata)) {
    throw new Error(`GuardDog evidence ${index} has invalid source metadata`);
  }
  if (row.result === "verified" && (row.enforcedAction !== "blocked" || row.protocol === "unknown" || destination.port === null)) {
    throw new Error(`GuardDog evidence ${index} overclaims verified enforcement`);
  }
  return row as unknown as EnforcementEvidence;
}