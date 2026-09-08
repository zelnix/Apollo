// Shared Apollo domain types. Used by the state machine, risk engine, Patrol,
// capability model and privacy policy. Platform-agnostic: no React, no native.

// Six-state model. `sniffing` is transient (analysing), `ears_up` is a low-confidence pattern match,
// `biting` is the internal key for the verified-block state shown to users as "Guarding".
export type ApolloState = "sniffing" | "resting" | "ears_up" | "growling" | "barking" | "biting";

/** Semantically exact wording for each state. Never paraphrase these in the UI. */
/** User-facing state names. The internal key stays `resting`; on the lookout it reads as "Patrolling". */
/** Ordered low → high for comparisons in UI code (mirrors stateMachine STATE_RANK). */
export const STATE_RANK_ORDER: ApolloState[] = ["sniffing", "resting", "ears_up", "growling", "barking", "biting"];

export const STATE_NAME: Record<ApolloState, string> = { sniffing: "Sniffing", resting: "Patrolling", ears_up: "Ears up", growling: "Growling", barking: "Barking", biting: "Guarding" };

export const STATE_LABEL: Record<ApolloState, string> = {
  sniffing: "Apollo is sniffing",
  resting: "Apollo is patrolling",
  ears_up: "Apollo's ears are up",
  growling: "Apollo is growling",
  barking: "Apollo is barking",
  biting: "Apollo is guarding",
};

export const STATE_MEANING: Record<ApolloState, string> = {
  sniffing: "Apollo is having a closer look before he decides. Do allow him a moment.",
  resting: "On the lookout. All is well within the checks Apollo can currently see.",
  ears_up: "This matches a pattern Apollo knows. Not confirmed — a careful look is in order.",
  growling: "Something looks suspicious, though it is not yet confirmed.",
  barking: "This one needs your decision. I would suggest you act on it now.",
  biting: "Apollo verified a threat and blocked it. He is standing guard.",
};

export type Visibility = "full" | "limited" | "none";

export type RiskLevel = "clean" | "uncertain" | "suspicious" | "malicious";

export interface RiskSignal {
  code: string;
  weight: number;
  plain: string; // plain-language explanation shown to the user
}

export interface LocalAnalysis {
  input: string;
  normalizedUrl: string | null;
  host: string | null;
  valid: boolean;
  score: number; // 0–100
  level: RiskLevel;
  signals: RiskSignal[];
}

export type IntelVerdict = "clean" | "malicious" | "unknown";
export type IntelCoverage = "full" | "partial" | "none";

export interface IntelSource {
  name: string;
  status: "match" | "clear" | "unavailable" | "not_configured";
  detail: string;
  threat_types: string[];
}

export interface IntelResult {
  redirect_chain?: string[];
  final_url?: string | null;
  verdict: IntelVerdict;
  threat_types: string[];
  sources: IntelSource[];
  indicator_digest: string;
  checked_at: string;
  cached: boolean;
  coverage: IntelCoverage;
}

export type EventCategory = "link" | "website" | "connection" | "known_threat" | "protection" | "system" | "message" | "call" | "app" | "device" | "account" | "email";
export type EventStatus = "active" | "trusted" | "blocked" | "resolved";

export interface PatrolEvent {
  event_id: string;
  device_id: string;
  category: EventCategory;
  state: ApolloState;
  status: EventStatus;
  headline: string;
  what_happened: string;
  why: string[];
  what_to_do: string;
  indicator_host: string | null;
  indicator_digest: string | null;
  /** Full indicator (e.g. the link) — kept ON DEVICE ONLY, never synced. */
  local_indicator?: string | null;
  verified_block: boolean;
  adapter_label: string;
  occurred_at: string;
  resolved_at: string | null;
  /** Set by the native Site Guard when the block happened with the app closed → backend pushes an alert to this device. */
  background?: boolean;
  /** Gate 2 (messages): extracted security signals only — never the conversation. */
  claimed_brand?: string | null;
  scenario?: string | null;
  /** Threat Scent id linking related events (message → link → login → call). */
  scent_id?: string | null;
  /** Whether "Trust This" may be offered. Only growling-level uncertain items. */
  trust_allowed?: boolean;
  /** Cross-Platform Architecture Directive: raw enforcement evidence backing verified_block, if any.
   * The backend independently re-derives verified_block from this — it is never trusted as-is. */
  enforcement_evidence?: PatrolEnforcementEvidence | null;
}

/**
 * Backend-facing (snake_case, flat) mirror of src/security/PlatformCapabilityProfile.ts
 * EnforcementEvidence — see toPatrolEnforcementEvidence() in enforcementEvidenceSync.ts for the
 * camelCase→snake_case, nested→flat conversion at the SDK/domain boundary.
 */
export interface PatrolEnforcementEvidence {
  evidence_id: string;
  event_id: string | null;
  device_id: string | null;
  platform: string;
  os_version: string | null;
  sdk_version: string | null;
  observed_at: string;
  mechanism: string;
  direction: string;
  protocol: string;
  destination_ip: string | null;
  destination_domain: string | null;
  destination_port: number | null;
  app_id: string | null;
  process_name: string | null;
  attribution_confidence: string;
  matched_rule_id: string | null;
  threat_id: string | null;
  requested_action: string;
  enforced_action: string;
  result: string;
  rule_source: string;
  confidence: string;
  correlation_id: string | null;
}

export type CapabilityStatus = "available" | "active" | "permission_required" | "unsupported" | "coming_later" | "inactive";

export interface Capability {
  id: "link_guard" | "site_guard" | "connection_guard" | "known_threats" | "share_intake" | "message_guard" | "app_guard";
  title: string;
  status: CapabilityStatus;
  detail: string; // truthful, plain-language reason for the status
}

export interface Decision {
  state: ApolloState;
  headline: string;
  what_happened: string;
  why: string[];
  what_to_do: string;
  action_required: boolean;
  trust_allowed: boolean;
  block_offered: boolean;
  confidence: "low" | "medium" | "high";
  /** Gate 3: organisation the destination claims/looks like (Brand & Impersonation engine). */
  claimed_brand?: string | null;
}
