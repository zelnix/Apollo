/**
 * Canonical Protection State Resolver.
 *
 * ONE function resolves (automaticState, manualOnly, coverageLimited, onDemandState)
 * into a user-facing status label and tone. Both gates.ts and homeStatusResolver.ts
 * consume this resolver — neither interprets capability state independently.
 *
 * Architecture rule: a fact can appear in many places, but Apollo should
 * decide that fact in only one place.
 */

import type { GateId } from "./gateRegistry";

// ── Input/output types ──────────────────────────────────────────────────────

export type AutomaticCapabilityState =
  | "running" | "checking" | "permission_needed" | "setup_needed"
  | "off_by_choice" | "interrupted" | "temporarily_unavailable"
  | "unsupported" | "not_activated" | "unverified";

export type OnDemandCapabilityState = "ready" | "temporarily_unavailable" | "unsupported";

/** Standardised user-facing status. "Watching" is the ONLY success label and means
 *  verified, active, automatic protection — never merely "enabled" or "permission granted". */
export type GateStatusLabel =
  | "Watching" | "Manual check" | "Check in progress" | "Setup required"
  | "Off" | "Limited" | "Action needed" | "Unavailable" | "Unable to verify";

export type GateTone = "good" | "limited" | "action" | "neutral" | "off" | "unavailable" | "unverified";

/** Coverage item state used by Home / Protection screens. */
export type CoverageItemState =
  | "active_verified" | "active_unverified" | "setup_available"
  | "disabled_by_user" | "temporarily_unavailable" | "unsupported" | "unknown";

export interface ProtectionStateInput {
  automaticState?: AutomaticCapabilityState;
  manualOnly?: boolean;
  coverageLimited?: boolean;
  onDemandState?: OnDemandCapabilityState;
}

export interface ResolvedProtectionState {
  statusLabel: GateStatusLabel;
  tone: GateTone;
  coverageState: CoverageItemState;
  isAutomatic: boolean;
}

// ── The ONE resolver ────────────────────────────────────────────────────────

/**
 * Resolve protection state from capability signals.
 *
 * This is called by gates.ts (for gate presentation) and homeStatusResolver.ts
 * (for coverage items). Both surfaces show the same result — neither reinterprets
 * the signals.
 *
 * KEY RULE: A manual-only capability must NEVER become active_verified / Watching.
 * manual-only + running = "Manual check" / setup_available.
 */
export function resolveProtectionState(input: ProtectionStateInput): ResolvedProtectionState {
  const { automaticState: auto, manualOnly, coverageLimited, onDemandState: od } = input;

  // No automatic capability → on-demand only
  if (!auto) {
    if (od === "ready") return { statusLabel: "Manual check", tone: "neutral", coverageState: "setup_available", isAutomatic: false };
    if (od === "temporarily_unavailable") return { statusLabel: "Unable to verify", tone: "unverified", coverageState: "unknown", isAutomatic: false };
    return { statusLabel: "Unavailable", tone: "unavailable", coverageState: "unsupported", isAutomatic: false };
  }

  // Automatic capability present
  switch (auto) {
    case "running":
      // CRITICAL: manual-only must NOT become Watching / active_verified.
      if (manualOnly) return { statusLabel: "Manual check", tone: "neutral", coverageState: "setup_available", isAutomatic: false };
      if (coverageLimited) return { statusLabel: "Limited", tone: "limited", coverageState: "active_verified", isAutomatic: true };
      return { statusLabel: "Watching", tone: "good", coverageState: "active_verified", isAutomatic: true };

    case "checking":
      return { statusLabel: "Check in progress", tone: "neutral", coverageState: "unknown", isAutomatic: true };

    case "interrupted":
      return { statusLabel: "Action needed", tone: "action", coverageState: "temporarily_unavailable", isAutomatic: true };

    case "permission_needed":
    case "setup_needed":
    case "not_activated":
      return { statusLabel: "Setup required", tone: "neutral", coverageState: "setup_available", isAutomatic: true };

    case "off_by_choice":
      return { statusLabel: "Off", tone: "off", coverageState: "disabled_by_user", isAutomatic: true };

    case "temporarily_unavailable":
      return { statusLabel: "Unable to verify", tone: "unverified", coverageState: "active_unverified", isAutomatic: true };

    case "unverified":
      // "failure to observe ≠ observed failure" — Apollo couldn't verify the state.
      return { statusLabel: "Unable to verify", tone: "unverified", coverageState: "unknown", isAutomatic: true };

    case "unsupported":
      return { statusLabel: "Unavailable", tone: "unavailable", coverageState: "unsupported", isAutomatic: true };

    default:
      return { statusLabel: "Unavailable", tone: "unavailable", coverageState: "unknown", isAutomatic: true };
  }
}
