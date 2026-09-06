// Shared SecurityEvent contract. Mirrors Kotlin `com.guarddog.core.events.SecurityEvent`
// and Swift `GuardDogCore.SecurityEvent`.
//
// Truthfulness rule: THREAT_BLOCKED requires confirmed packet observation and an
// intentional drop by the active enforcement layer. It therefore MUST carry an
// `enforcementEvidenceId` and originate from `android-vpn-enforcement`.

export type SecurityEventType =
  | "THREAT_BLOCKED"
  | "THREAT_DETECTED"
  | "PROTECTION_STATE_CHANGED"
  | "RULE_BUNDLE_ACCEPTED"
  | "RULE_BUNDLE_REJECTED";

export type SecurityEventSource =
  | "android-vpn-enforcement"
  | "local-analysis"
  | "rule-verifier"
  | "protection-lifecycle";

export type ProtectionState =
  | "INACTIVE"
  | "STARTING"
  | "ACTIVE"
  | "DEGRADED"
  | "STOPPED"
  | "REVOKED"
  | "FAILED";

export interface SecurityEvent {
  id: string;
  type: SecurityEventType;
  source: SecurityEventSource;
  /** ISO-8601 UTC */
  occurredAt: string;
  /** scheme + canonical host + path only (see normalization.ts) */
  sanitizedUrl?: string;
  host?: string;
  destinationIp?: string;
  ruleId?: string;
  rulesetId?: string;
  bundleVersion?: number;
  /** Internal audit reference: signed rule -> route -> packet observation -> drop -> evidence -> event */
  enforcementEvidenceId?: string;
  verdict?: "block" | "allow" | "unknown" | "unavailable";
  protectionState?: ProtectionState;
  reason?: string;
}

export const SECURITY_EVENT_TYPES: readonly SecurityEventType[] = [
  "THREAT_BLOCKED",
  "THREAT_DETECTED",
  "PROTECTION_STATE_CHANGED",
  "RULE_BUNDLE_ACCEPTED",
  "RULE_BUNDLE_REJECTED",
];
export const SECURITY_EVENT_SOURCES: readonly SecurityEventSource[] = [
  "android-vpn-enforcement",
  "local-analysis",
  "rule-verifier",
  "protection-lifecycle",
];
export const PROTECTION_STATES: readonly ProtectionState[] = [
  "INACTIVE",
  "STARTING",
  "ACTIVE",
  "DEGRADED",
  "STOPPED",
  "REVOKED",
  "FAILED",
];

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;
const IPV4_RE = /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

export type SecurityEventValidation = { ok: true; event: SecurityEvent } | { ok: false; reason: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Strict validation of a bridge payload before it is trusted by the app. */
export function validateSecurityEvent(input: unknown): SecurityEventValidation {
  if (!isRecord(input)) return { ok: false, reason: "not an object" };
  const e = input;
  if (typeof e.id !== "string" || e.id.length === 0) return { ok: false, reason: "id" };
  if (!SECURITY_EVENT_TYPES.includes(e.type as SecurityEventType)) return { ok: false, reason: "type" };
  if (!SECURITY_EVENT_SOURCES.includes(e.source as SecurityEventSource)) return { ok: false, reason: "source" };
  if (typeof e.occurredAt !== "string" || !ISO_RE.test(e.occurredAt)) return { ok: false, reason: "occurredAt" };
  if (e.sanitizedUrl !== undefined && !isSanitizedUrlShape(e.sanitizedUrl)) return { ok: false, reason: "sanitizedUrl" };
  if (e.protectionState !== undefined && !PROTECTION_STATES.includes(e.protectionState as ProtectionState))
    return { ok: false, reason: "protectionState" };
  if (e.bundleVersion !== undefined && !Number.isInteger(e.bundleVersion)) return { ok: false, reason: "bundleVersion" };
  if (e.type === "THREAT_BLOCKED") {
    if (e.source !== "android-vpn-enforcement") return { ok: false, reason: "THREAT_BLOCKED requires enforcement source" };
    if (typeof e.enforcementEvidenceId !== "string" || e.enforcementEvidenceId.length === 0)
      return { ok: false, reason: "THREAT_BLOCKED requires enforcementEvidenceId" };
    if (typeof e.destinationIp !== "string" || !IPV4_RE.test(e.destinationIp))
      return { ok: false, reason: "THREAT_BLOCKED requires observed destinationIp" };
    if (typeof e.ruleId !== "string" || typeof e.rulesetId !== "string")
      return { ok: false, reason: "THREAT_BLOCKED requires authorizing rule" };
  }
  return { ok: true, event: e as unknown as SecurityEvent };
}

/** sanitizedUrl must be scheme://host/path with no userinfo, query or fragment. */
export function isSanitizedUrlShape(v: unknown): boolean {
  return typeof v === "string" && /^https?:\/\/[^\s/?#@:]+(\/[^\s?#]*)?$/.test(v.replace(/^(https?:\/\/)\[[^\]]+\]/, "$1x"));
}

export function isGenuineBlockedEvent(event: SecurityEvent): boolean {
  return (
    event.type === "THREAT_BLOCKED" &&
    event.source === "android-vpn-enforcement" &&
    typeof event.enforcementEvidenceId === "string" &&
    event.enforcementEvidenceId.length > 0
  );
}
