// Failure contract for the security service (Hardening Gate step 3).
// "Backend unreachable" NEVER means "Apollo is not protecting you": Site Guard and on-device checks continue.
// What degrades is ONLINE intelligence (reputation, AI second opinions, family sync, Higgins' voice).
// Pure so it is unit-tested; the UI reports these facts, it never infers them.

export type FailureKind = "offline" | "timeout" | "server_error" | "malformed";

export interface ServiceHealth {
  /** null = never observed yet; false = last observation failed; true = last observation succeeded. */
  reachable: boolean | null;
  lastOkAt: string | null;
  lastFailureAt: string | null;
  failure: FailureKind | null;
}

export const INITIAL_HEALTH: ServiceHealth = { reachable: null, lastOkAt: null, lastFailureAt: null, failure: null };

/** A fresh successful observation (any coherent HTTP answer, incl. 4xx). Only THIS clears a degraded state. */
export function observeOk(h: ServiceHealth, at: string): ServiceHealth {
  return { ...h, reachable: true, lastOkAt: at, failure: null };
}

export function observeFailure(h: ServiceHealth, kind: FailureKind, at: string): ServiceHealth {
  return { ...h, reachable: false, lastFailureAt: at, failure: kind };
}

export type HttpFailureClass = "identity_reset" | "forbidden" | "client_error" | "service_degraded";

/** 401 = credential dead → explicit re-register. 403 = authenticated but not allowed → NEVER re-register. */
export function classifyHttpFailure(status: number): HttpFailureClass {
  if (status === 401) return "identity_reset";
  if (status === 403) return "forbidden";
  if (status >= 500) return "service_degraded";
  return "client_error";
}

export const FAILURE_MESSAGE: Record<FailureKind, string> = {
  offline: "Apollo can't reach the security service.",
  timeout: "The security service took too long to answer.",
  server_error: "The security service is having trouble right now.",
  malformed: "The security service sent an answer Apollo couldn't read.",
};

export interface ServiceBannerCopy { title: string; line: string; lastSeen: string | null }

/** Banner shown while degraded. Describes exactly what failed — never a generic "Unprotected". */
export function serviceBannerCopy(h: ServiceHealth): ServiceBannerCopy | null {
  if (h.reachable !== false) return null;
  const title = h.failure === "server_error" ? "Apollo's security service is having trouble" : h.failure === "timeout" ? "Apollo's security service is slow to answer" : "Apollo can't reach the security service";
  return { title, line: "Local protection continues where available. New online checks may be unavailable.", lastSeen: h.lastOkAt };
}

/** Wording for data that was fetched earlier and could not be refreshed. */
export function staleNote(updatedAt: number | null, at = new Date()): string {
  if (!updatedAt) return "Apollo couldn't reach the security service, so there is nothing to show yet.";
  const when = new Date(updatedAt);
  const sameDay = when.toDateString() === at.toDateString();
  const stamp = sameDay ? when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : when.toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return `Showing what Apollo last saw at ${stamp} — it may be out of date. The security service isn't reachable right now.`;
}
