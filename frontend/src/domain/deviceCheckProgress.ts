// What changed between two device checks on the same case.
//
// Pure comparison of the review results each check actually recorded. It never infers a fix: a
// setting is only "fixed" when the later check OBSERVED it as correct. A problem that the later
// check could not read is reported as not confirmed — never as resolved.

/** The subset of a recorded review result this comparison needs. */
export interface ComparableCheck {
  id: string;
  title: string;
  outcome: string;
}

export type ChangeKind = "fixed" | "new_problem" | "still_open" | "not_confirmed";

export interface CheckChange {
  id: string;
  title: string;
  kind: ChangeKind;
  detail: string;
}

export interface DeviceCheckProgress {
  changes: CheckChange[];
  summary: string;
}

const PROBLEM = new Set(["action", "review"]);
const UNKNOWN = new Set(["manual", "unavailable"]);

const LABEL: Record<string, string> = {
  checked: "correct",
  review: "worth reviewing",
  action: "needing attention",
  manual: "needing a manual check",
  unavailable: "not readable on this device",
  not_applicable: "not applicable",
};
const label = (outcome: string) => LABEL[outcome] ?? outcome;

/** Reads the review results stored with a device-check event. Returns null when that check didn't
 *  record comparable results (e.g. a platform with no automated review, or a check that failed). */
export function comparableChecks(data: unknown): ComparableCheck[] | null {
  const results = (data as { results?: unknown } | null | undefined)?.results;
  if (!Array.isArray(results)) return null;
  const checks: ComparableCheck[] = [];
  for (const row of results) {
    const r = row as { id?: unknown; title?: unknown; outcome?: unknown };
    if (typeof r?.id === "string" && typeof r?.title === "string" && typeof r?.outcome === "string") {
      checks.push({ id: r.id, title: r.title, outcome: r.outcome });
    }
  }
  return checks.length ? checks : null;
}

export function compareDeviceChecks(previous: ComparableCheck[], current: ComparableCheck[]): DeviceCheckProgress {
  const before = new Map(previous.map((c) => [c.id, c]));
  const changes: CheckChange[] = [];

  for (const now of current) {
    const was = before.get(now.id);
    if (!was) {
      if (PROBLEM.has(now.outcome)) {
        changes.push({ id: now.id, title: now.title, kind: "new_problem", detail: `Checked for the first time and found ${label(now.outcome)}.` });
      }
      continue;
    }
    if (PROBLEM.has(was.outcome) && now.outcome === "checked") {
      changes.push({ id: now.id, title: now.title, kind: "fixed", detail: `Was ${label(was.outcome)}. This check read it as correct.` });
    } else if (PROBLEM.has(was.outcome) && UNKNOWN.has(now.outcome)) {
      changes.push({ id: now.id, title: now.title, kind: "not_confirmed", detail: `Was ${label(was.outcome)}. This check couldn't read it, so it is not confirmed fixed.` });
    } else if (PROBLEM.has(was.outcome) && PROBLEM.has(now.outcome)) {
      changes.push({ id: now.id, title: now.title, kind: "still_open", detail: was.outcome === now.outcome ? `Still ${label(now.outcome)}.` : `Was ${label(was.outcome)}, now ${label(now.outcome)}.` });
    } else if (!PROBLEM.has(was.outcome) && PROBLEM.has(now.outcome)) {
      changes.push({ id: now.id, title: now.title, kind: "new_problem", detail: `Was ${label(was.outcome)}, now ${label(now.outcome)}.` });
    }
  }

  const count = (kind: ChangeKind) => changes.filter((c) => c.kind === kind).length;
  const parts: string[] = [];
  const fixed = count("fixed");
  const appeared = count("new_problem");
  const open = count("still_open");
  const unconfirmed = count("not_confirmed");
  if (fixed) parts.push(`${fixed} fixed`);
  if (appeared) parts.push(`${appeared} new`);
  if (open) parts.push(`${open} still needing attention`);
  if (unconfirmed) parts.push(`${unconfirmed} not confirmed`);
  const summary = parts.length ? parts.join(" · ") : "Nothing changed since the last check.";

  return { changes, summary };
}
