// Apollo four-state machine.
// Escalation is immediate on evidence. Recovery to Resting is slow and strict:
// it requires (a) no active events, (b) a fresh verification after the most
// recent escalation was resolved, and (c) visibility not lost.

import type { ApolloState, PatrolEvent, Visibility } from "./types";

export const STATE_RANK: Record<ApolloState, number> = { resting: 0, growling: 1, barking: 2, biting: 3 };

/** How recent a verification must be to permit returning to Resting. */
export const VERIFICATION_FRESHNESS_MS = 10 * 60 * 1000;
/** After an event resolves, Apollo stays alert until a fresh verification lands. */
export const RECOVERY_COOLDOWN_MS = 2 * 60 * 1000;

export interface StateInput {
  events: PatrolEvent[];
  visibility: Visibility;
  lastVerifiedAt: string | null;
  now?: number;
}

export interface StateResolution {
  state: ApolloState;
  /** Why Apollo is in this state, in plain language. */
  reason: string;
  /** True when Apollo has no active event but is waiting on fresh verification. */
  recovering: boolean;
  /** True when Resting cannot be shown truthfully because visibility is lost. */
  visibilityLost: boolean;
  drivingEvent: PatrolEvent | null;
}

export function isActive(e: PatrolEvent): boolean {
  return e.status === "active" || (e.status === "blocked" && e.state === "biting" && !e.resolved_at);
}

export function resolveApolloState(input: StateInput): StateResolution {
  const now = input.now ?? Date.now();
  const active = input.events.filter(isActive);

  // Biting only if a verified block exists. Never inferred.
  const biting = active.find((e) => e.state === "biting" && e.verified_block);
  if (biting) {
    return { state: "biting", reason: "Apollo verified and blocked a threat.", recovering: false, visibilityLost: false, drivingEvent: biting };
  }
  const barking = active.filter((e) => e.state === "barking").sort(byNewest)[0];
  if (barking) {
    return { state: "barking", reason: "Something needs your decision.", recovering: false, visibilityLost: false, drivingEvent: barking };
  }
  const growling = active.filter((e) => e.state === "growling").sort(byNewest)[0];
  if (growling) {
    return { state: "growling", reason: "Something looks unusual and is not yet confirmed.", recovering: false, visibilityLost: false, drivingEvent: growling };
  }

  // No active events. Recovery rules apply.
  const recentlyResolved = input.events
    .filter((e) => e.resolved_at && e.state !== "resting")
    .sort((a, b) => Date.parse(b.resolved_at!) - Date.parse(a.resolved_at!))[0];
  const verifiedAt = input.lastVerifiedAt ? Date.parse(input.lastVerifiedAt) : 0;
  const verificationFresh = verifiedAt > 0 && now - verifiedAt <= VERIFICATION_FRESHNESS_MS;

  if (recentlyResolved) {
    const resolvedAt = Date.parse(recentlyResolved.resolved_at!);
    const withinCooldown = now - resolvedAt < RECOVERY_COOLDOWN_MS;
    const verifiedAfterResolve = verifiedAt > resolvedAt;
    if (withinCooldown && !verifiedAfterResolve) {
      // Hold at growling (lowest alert) rather than snapping back to resting.
      return {
        state: "growling",
        reason: "A recent event was resolved. Apollo is waiting for a fresh check before resting.",
        recovering: true,
        visibilityLost: false,
        drivingEvent: recentlyResolved,
      };
    }
  }

  if (input.visibility === "none") {
    return { state: "growling", reason: "Apollo cannot see anything right now. Protection is not active.", recovering: false, visibilityLost: true, drivingEvent: null };
  }
  if (!verificationFresh) {
    return { state: "growling", reason: "Apollo has not verified protection recently. Run a check.", recovering: true, visibilityLost: false, drivingEvent: null };
  }
  return {
    state: "resting",
    reason: input.visibility === "limited" ? "Safe within the checks Apollo can see. Some protections are not active." : "Safe within the checks Apollo can see.",
    recovering: false,
    visibilityLost: false,
    drivingEvent: null,
  };
}

function byNewest(a: PatrolEvent, b: PatrolEvent) {
  return Date.parse(b.occurred_at) - Date.parse(a.occurred_at);
}

/** Guard for transitions requested by user or adapter. Returns the allowed next state or null. */
export function canTransition(event: PatrolEvent, next: ApolloState, opts: { verifiedBlock?: boolean } = {}): boolean {
  if (next === "biting") return opts.verifiedBlock === true; // never infer biting
  if (STATE_RANK[next] > STATE_RANK[event.state]) return true; // escalation is always allowed
  if (event.state === "biting" && next !== "resting") return false; // biting only resolves fully
  return true;
}
