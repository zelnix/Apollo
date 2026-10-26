// Check completeness — Apollo never presents an incomplete examination as a complete one.
// Mirror of backend services/triage/completeness.py. Words: catalogue "completeness".
//
// An incomplete check is one Apollo needed but couldn't finish: a reputation source that didn't answer, a link whose
// final destination couldn't be verified, a number scored only from an earlier lookup. When no rule is met and some
// check is incomplete, the result is "No threat found by available checks" — not Limited, and never the unqualified
// "No threat identified". The wording follows the kind of check and how it failed, never the provider.

import catalogue from "./catalogue.ts";

export type IncompleteStatus = "unavailable" | "unresolved" | "stale";

export interface IncompleteCheck {
  /** "reputation" | "final_destination" | "number_reputation" */
  check: string;
  /** unavailable = no answer; unresolved = final destination not verified; stale = an earlier result was used. */
  status: IncompleteStatus;
  /** How it failed (timeout, quota_exhausted, nonexistent_domain, …), when known. */
  failure: string | null;
  detail: string;
  source: string | null;
  at: string | null;
}

const WORDS = (catalogue as unknown as {
  completeness: { availableChecksLabel: string; checks: Record<string, string>; failures: Record<string, string>; stale: string };
}).completeness;

export const AVAILABLE_CHECKS: string = WORDS.availableChecksLabel;

export function incompleteCheck(check: string, failure: string | null | undefined,
  opts: { status?: IncompleteStatus; detail?: string; source?: string | null; at?: string | null } = {}): IncompleteCheck {
  return { check, status: opts.status ?? "unavailable", failure: failure ?? null, detail: opts.detail ?? "", source: opts.source ?? null, at: opts.at ?? null };
}

/** "Apollo couldn't verify where this link finally leads (the website's address doesn't exist)." */
export function incompletePlain(c: Pick<IncompleteCheck, "check" | "status" | "failure">): string {
  const what = WORDS.checks[c.check] ?? "A check didn't complete";
  const why = WORDS.failures[c.failure ?? ""] ?? "";
  if (c.status === "stale") return `${what}: ${WORDS.stale.replace("{failure}", why || "no answer")}.`;
  return why ? `${what} (${why}).` : `${what}.`;
}

export interface SourceLike {
  name: string;
  status: string;
  detail?: string;
  check?: string | null;
  failure?: string | null;
}

/** Every source of a reputation answer that didn't complete (status unavailable / not_configured). */
export function fromSources(sources: SourceLike[] | null | undefined): IncompleteCheck[] {
  return (sources ?? [])
    .filter((s) => s.status === "unavailable" || s.status === "not_configured")
    .map((s) => incompleteCheck(s.check || "reputation", s.failure, {
      status: s.check === "final_destination" ? "unresolved" : "unavailable", detail: s.detail ?? "", source: s.name,
    }));
}

/** The link reputation checks a message needed that didn't complete: a lookup that failed outright, and any
 *  source or final destination that didn't answer inside one that worked. */
export function urlIncompleteChecks(urls: { coverage: string; failure?: string | null; incomplete?: IncompleteCheck[] }[]): IncompleteCheck[] {
  const checks: IncompleteCheck[] = [];
  for (const u of urls) {
    const found = u.coverage === "unavailable" || u.coverage === "none"
      ? [incompleteCheck("reputation", u.failure ?? null)]
      : u.incomplete ?? [];
    for (const c of found) {
      if (!checks.some((x) => x.check === c.check && x.status === c.status && x.failure === c.failure)) checks.push(c);
    }
  }
  return checks;
}
