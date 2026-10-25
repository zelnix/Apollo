// The note on each saved result: when the pictures and files sent for the check left Apollo's server, or the
// latest time they will. The promise is in the rule book (Your data), word for word. Pure: no React, no native imports.

/** What this phone knows about the server's copy of a check. `removedAt`: the server confirmed it deleted it.
 *  `leavesBy`: the latest time it will be gone (the case's own expiry, or 24 hours after it finished). */
export interface ServerCopy { removedAt: string | null; leavesBy: string | null }

/** The server deletes everything sent for a check within this many hours of the investigation finishing. */
export const SERVER_COPY_HOURS = 24;

const WHAT = "The pictures and files you sent for this check";

const valid = (iso: string | null | undefined): iso is string => !!iso && Number.isFinite(Date.parse(iso));

/** The earliest of a live case's own expiry and its 24-hour deletion time. */
export function serverLeavesBy(c: { expiresAt?: string | null; contentDeleteBy?: string | null }): string | null {
  const times = [c.expiresAt, c.contentDeleteBy].filter(valid);
  return times.length ? times.reduce((a, b) => (Date.parse(a) <= Date.parse(b) ? a : b)) : null;
}

/** "25 Oct 2026 at 4:19 pm", in the phone's own language and time zone. */
export function whenLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })} at ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

/** One sentence, or null when the record doesn't say (never guessed). A result saved before the note existed
 *  only says they have left, once the 24 hours since it finished have passed. */
export function serverCopyNote(copy: ServerCopy | null | undefined, finishedAt: string | null | undefined, now: number = Date.now()): string | null {
  if (valid(copy?.removedAt)) return `${WHAT} were removed from Apollo's server on ${whenLabel(copy.removedAt)}.`;
  if (valid(copy?.leavesBy)) {
    return Date.parse(copy.leavesBy) > now
      ? `${WHAT} leave Apollo's server by ${whenLabel(copy.leavesBy)}.`
      : `${WHAT} were removed from Apollo's server by ${whenLabel(copy.leavesBy)}.`;
  }
  if (valid(finishedAt) && now - Date.parse(finishedAt) >= SERVER_COPY_HOURS * 3600_000) return `${WHAT} have left Apollo's server.`;
  return null;
}
