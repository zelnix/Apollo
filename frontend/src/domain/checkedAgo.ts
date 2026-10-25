// When Apollo last checked a result it reused instead of asking again: "2 hours ago", or a date for older ones.
import { formatDateTime } from "./threatCase.ts";

export function checkedAgo(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (isNaN(then)) return "";
  const minutes = Math.max(0, Math.round((now - then) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return `on ${formatDateTime(iso)}`;
}

/** The line shown beside a reused result. */
export function reusedLine(iso: string | null | undefined, now: number = Date.now()): string {
  const when = checkedAgo(iso, now);
  return when ? `From Apollo's check ${when}, still current, so it wasn't looked up again` : "";
}
