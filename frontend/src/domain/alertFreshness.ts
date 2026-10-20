// Honest freshness labelling for scam alerts: tells the person how recently Apollo actually
// pulled from the official sources. Never claims a refresh that didn't happen — an unknown or
// unparsable timestamp says so plainly, and anything older than a day is marked stale so the UI
// can say Apollo is still trying.
export interface Freshness {
  /** Short line for display, e.g. "Updated 2 hours ago". */
  label: string;
  /** True when the last successful source pull is older than a day (or unknown). */
  stale: boolean;
  /** Full timestamp for the detail line, empty when unknown. */
  exact: string;
}

const DAY_MS = 86_400_000;

/** "just now" / "2 hours ago" / "yesterday" / "3 days ago" / "3 Jun 2026" */
export function agoLabel(at: number, now: number): string {
  const diff = Math.max(0, now - at);
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} minute${min > 1 ? "s" : ""} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr > 1 ? "s" : ""} ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "yesterday";
  if (day < 7) return `${day} days ago`;
  return new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function alertFreshness(lastSourcedAt: string | null | undefined, now = Date.now()): Freshness {
  const at = lastSourcedAt ? Date.parse(lastSourcedAt) : NaN;
  if (!Number.isFinite(at)) return { label: "Checking official sources…", stale: true, exact: "" };
  const d = new Date(at);
  return {
    label: `Updated ${agoLabel(at, now)}`,
    stale: now - at > DAY_MS,
    exact: `${d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}, ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`,
  };
}
