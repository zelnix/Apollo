// Reputation lookups (link and number reputation) with a controlled retry and in-flight deduplication.
//
// A transient failure (timeout, no connection, a 5xx, rate limiting, an unreadable answer, or a service that
// answered "nothing could be checked") is retried within the catalogue's retry policy and a time budget.
// Authorisation failures, rejected input and an unconfigured provider are never retried. If every attempt
// fails the dependency is reported as unavailable — with the failure kind — and NEVER as a pass.
// Pure apart from the injected `run`, so it is unit-tested in node.

import type { RetryRecord } from "./triage/contract.ts";
import { RETRY_ATTEMPTS } from "./triage/contract.ts";

export type LookupFailure =
  | "timeout" | "offline" | "server_error" | "rate_limited" | "malformed" | "provider_unavailable"
  | "auth_failure" | "forbidden" | "rejected" | "not_configured" | "no_data";

/** Worth asking again: the service may answer next time. */
export const TRANSIENT_LOOKUP_FAILURES: ReadonlySet<LookupFailure> = new Set<LookupFailure>(
  ["timeout", "offline", "server_error", "rate_limited", "malformed", "provider_unavailable"]);

/** Classify a thrown API failure ({status, kind} as raised by src/api/client). */
export function classifyLookupError(error: unknown): LookupFailure {
  const e = (error ?? {}) as { status?: unknown; kind?: unknown };
  if (e.kind === "timeout") return "timeout";
  if (e.kind === "malformed") return "malformed";
  if (e.kind === "server_error") return "server_error";
  const status = typeof e.status === "number" ? e.status : 0;
  if (status === 401) return "auth_failure";
  if (status === 403) return "forbidden";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  if (status >= 400) return "rejected";
  return "offline";
}

export interface LookupOutcome<T> {
  /** The last answer (an answer can itself say "unavailable"); null when no answer arrived. */
  value: T | null;
  /** Null only when the lookup succeeded. */
  failure: LookupFailure | null;
  error: unknown;
  retry: RetryRecord;
}

export interface LookupOptions<T> {
  /** Total attempts including the first. Default: the catalogue's retry policy. */
  attempts?: number;
  /** First wait between attempts; doubled each time. */
  backoffMs?: number;
  /** No new attempt starts once this much time has passed. */
  budgetMs?: number;
  /** An answer that is itself "nothing could be checked" → its failure kind (null = a real answer). */
  unavailable?: (value: T) => LookupFailure | null;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const inflight = new Map<string, Promise<LookupOutcome<unknown>>>();

async function attemptLookup<T>(check: string, run: () => Promise<T>, options: LookupOptions<T>): Promise<LookupOutcome<T>> {
  const attempts = Math.max(1, options.attempts ?? RETRY_ATTEMPTS);
  const backoff = options.backoffMs ?? 800;
  const budget = options.budgetMs ?? 45000;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const started = now();
  let value: T | null = null;
  let failure: LookupFailure = "offline";
  let error: unknown = null;
  let made = 0;
  for (let n = 1; n <= attempts; n += 1) {
    made = n;
    try {
      const answer = await run();
      const unavailable = options.unavailable?.(answer) ?? null;
      if (!unavailable) return { value: answer, failure: null, error: null, retry: { check, attempts: n, outcome: n > 1 ? "recovered" : "succeeded" } };
      value = answer; failure = unavailable; error = null;
    } catch (caught) {
      value = null; failure = classifyLookupError(caught); error = caught;
    }
    if (!TRANSIENT_LOOKUP_FAILURES.has(failure) || n === attempts || now() - started >= budget) break;
    await sleep(backoff * 2 ** (n - 1));
  }
  return { value, failure, error, retry: { check, attempts: made, outcome: TRANSIENT_LOOKUP_FAILURES.has(failure) ? "failed" : "not_retried_permanent" } };
}

/** One lookup per (check, key) at a time: a second identical request while one is running shares its result,
 *  so a retry never races a duplicate of itself. */
export function lookupWithRetry<T>(check: string, key: string, run: () => Promise<T>, options: LookupOptions<T> = {}): Promise<LookupOutcome<T>> {
  const id = `${check}:${key}`;
  const pending = inflight.get(id);
  if (pending) return pending as Promise<LookupOutcome<T>>;
  const promise = attemptLookup(check, run, options).finally(() => inflight.delete(id));
  inflight.set(id, promise as Promise<LookupOutcome<unknown>>);
  return promise;
}
