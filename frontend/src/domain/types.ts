// Shared Apollo domain types. Used by the state machine, risk engine, Patrol,
// capability model and privacy policy. Platform-agnostic: no React, no native.

export type ApolloState = "resting" | "growling" | "barking" | "biting";

/** Semantically exact wording for each state. Never paraphrase these in the UI. */
export const STATE_LABEL: Record<ApolloState, string> = {
  resting: "Apollo is resting",
  growling: "Apollo is growling",
  barking: "Apollo is barking",
  biting: "Apollo is biting",
};

export const STATE_MEANING: Record<ApolloState, string> = {
  resting: "Safe within the checks Apollo can currently see.",
  growling: "Something looks unusual or uncertain. Not confirmed.",
  barking: "You need to decide or act.",
  biting: "Apollo verified a threat and blocked it.",
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
  verdict: IntelVerdict;
  threat_types: string[];
  sources: IntelSource[];
  indicator_digest: string;
  checked_at: string;
  cached: boolean;
  coverage: IntelCoverage;
}

export type EventCategory = "link" | "website" | "connection" | "known_threat" | "protection" | "system";
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
  /** Whether "Trust This" may be offered. Only growling-level uncertain items. */
  trust_allowed?: boolean;
}

export type CapabilityStatus = "available" | "active" | "permission_required" | "unsupported" | "coming_later" | "inactive";

export interface Capability {
  id: "link_guard" | "site_guard" | "connection_guard" | "known_threats" | "share_intake";
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
}
