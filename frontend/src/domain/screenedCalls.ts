// "Calls Apollo screened" — the incoming numbers Android handed to Apollo's CallScreeningService.
// Pure parsing and wording only; the native read lives in src/security/screenedCalls.ts.
// This is NOT the device's call log: Android usually only passes Apollo calls from numbers that
// aren't in your contacts, and only while Apollo is the device's caller ID & spam app.

export type ScreenedOutcome = "rang" | "allowed_by_you" | "rejection_requested_block" | "rejection_requested_risky";
export interface ScreenedCall { number: string; at: number; outcome: ScreenedOutcome }

const OUTCOMES: ReadonlySet<string> = new Set(["rang", "allowed_by_you", "rejection_requested_block", "rejection_requested_risky"]);

/** What Apollo did when Android handed it the call. Rejections are requests — Android gives no receipt. */
export const SCREENED_OUTCOME_LABEL: Record<ScreenedOutcome, string> = {
  rang: "Rang through — no warning on this device",
  allowed_by_you: "On your allow list — rang through",
  rejection_requested_block: "On your block list — ApolloSG asked Android to reject it",
  rejection_requested_risky: "Found high-risk earlier — ApolloSG asked Android to reject it",
};

export function isRejectionRequest(outcome: ScreenedOutcome): boolean {
  return outcome === "rejection_requested_block" || outcome === "rejection_requested_risky";
}

/** Strict parse of the native JSON. Malformed rows are dropped; newest first. */
export function parseScreenedCalls(json: string | null | undefined): ScreenedCall[] {
  if (!json) return [];
  let raw: unknown;
  try { raw = JSON.parse(json); } catch { return []; }
  if (!Array.isArray(raw)) return [];
  const rows: ScreenedCall[] = [];
  for (const item of raw) {
    const row = item as { number?: unknown; at?: unknown; outcome?: unknown };
    if (typeof row?.number !== "string" || !row.number.trim()) continue;
    if (typeof row.at !== "number" || !Number.isFinite(row.at)) continue;
    if (typeof row.outcome !== "string" || !OUTCOMES.has(row.outcome)) continue;
    rows.push({ number: row.number.trim(), at: row.at, outcome: row.outcome as ScreenedOutcome });
  }
  return rows.sort((a, b) => b.at - a.at);
}

/** "Today" / "Yesterday" / "Tue 21 Oct" plus a time, for a screened-call row. */
export function screenedWhen(at: number, now: Date = new Date()): { day: string; time: string } {
  const d = new Date(at);
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  const day = d.toDateString() === now.toDateString() ? "Today"
    : d.toDateString() === yesterday.toDateString() ? "Yesterday"
    : d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  return { day, time: d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) };
}
