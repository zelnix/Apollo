// Apollo six-state machine (sniffing is transient and never persisted as an event state).
// Escalation is immediate on evidence. Recovery to Resting is slow and strict:
// it requires (a) no active events, (b) a fresh verification after the most
// recent escalation was resolved, and (c) visibility not lost.

import type { ApolloState, PatrolEvent, Visibility } from "./types";
import { eventHasPacketProof } from './packetEvidence.ts';

export const STATE_RANK: Record<ApolloState, number> = { sniffing: 0, resting: 0, ears_up: 1, growling: 2, barking: 3, biting: 4 };

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
  const verifiedAt = input.lastVerifiedAt ? Date.parse(input.lastVerifiedAt) : 0;
  const verificationFresh = verifiedAt > 0 && verifiedAt <= now && now - verifiedAt <= VERIFICATION_FRESHNESS_MS;
  const visibilityLost = input.visibility === 'none' || !verificationFresh;

  // Present health always remains visible, even alongside historical incidents.
  if (visibilityLost) return {
    state: active.some(e => e.state === 'barking') ? 'barking' : 'growling',
    reason: input.visibility === 'none' ? 'Current protection is unavailable or unverified. Previous blocks remain in Patrol.' : 'Protection observation has expired. Open Gates to check again.',
    recovering: false, visibilityLost: true, drivingEvent: active.sort(byNewest)[0] ?? null,
  };

  // Biting only if a verified block exists. Never inferred.
  const biting = active.find((e) => e.state === "biting" && e.verified_block && eventHasPacketProof(e) &&
    Date.parse(e.occurred_at) <= now && now - Date.parse(e.occurred_at) < RECOVERY_COOLDOWN_MS);
  if (biting) {
    return { state: "biting", reason: "Apollo verified and blocked a threat.", recovering: false, visibilityLost: false, drivingEvent: biting };
  }
  const barking = active.filter((e) => e.state === "barking").sort(byNewest)[0];
  if (barking) {
    return { state: "barking", reason: "Something needs your decision.", recovering: false, visibilityLost: false, drivingEvent: barking };
  }
  const growling = active.filter((e) => e.state === "growling").sort(byNewest)[0];
  if (growling) {
    return { state: "growling", reason: "Something looks suspicious and is not yet confirmed.", recovering: false, visibilityLost: false, drivingEvent: growling };
  }
  const earsUp = active.filter((e) => e.state === "ears_up").sort(byNewest)[0];
  if (earsUp) {
    return { state: "ears_up", reason: "Something matches a known pattern. Take a careful look.", recovering: false, visibilityLost: false, drivingEvent: earsUp };
  }

  // No active events. Recovery rules apply.
  const recentlyResolved = input.events
    .filter((e) => e.resolved_at && e.state !== "resting")
    .sort((a, b) => Date.parse(b.resolved_at!) - Date.parse(a.resolved_at!))[0];

  if (recentlyResolved) {
    const resolvedAt = Date.parse(recentlyResolved.resolved_at!);
    const withinCooldown = now - resolvedAt < RECOVERY_COOLDOWN_MS;
    const verifiedAfterResolve = verifiedAt > resolvedAt;
    if (withinCooldown || !verifiedAfterResolve) {
      // Hold at growling (lowest alert) rather than snapping back to resting.
      return {
        state: "growling",
        reason: "A recent event was resolved. Apollo is waiting for a fresh check before returning to patrol — tap Hear Higgins and I'll tell you which.",
        recovering: true,
        visibilityLost: false,
        drivingEvent: recentlyResolved,
      };
    }
  }

  if (!verificationFresh) {
    return { state: "growling", reason: "Apollo has not verified protection recently — tap Hear Higgins and I'll list the checks to run.", recovering: true, visibilityLost: false, drivingEvent: null };
  }
  return {
    state: "resting",
    reason: input.visibility === "limited" ? "Protection observed within its limited coverage. Earlier incidents remain in Patrol." : "Protection was freshly observed. Earlier incidents remain in Patrol.",
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
