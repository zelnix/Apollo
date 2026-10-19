// Family Weekly Check-In — turns count-only numbers about a watched person's week into one calm sentence.
// Deliberately reassuring when nothing happened; truthful when Apollo hasn't heard from their phone.

export interface FamilyWeekly {
  protected_device_id: string;
  owner_name: string;
  phone: string;
  week_start: string;
  total: number;
  by_state: Record<string, number>;
  alerts: number;
  open_alerts: number;
  handled_alerts: number;
  blocked: number;
  active_days: number;
  shared_incidents: number;
  shared_resolved: number;
  last_seen_at: string | null;
}

export type WeeklyTone = "resting" | "ears_up" | "growling" | "neutral";

export function weeklyHeadline(w: FamilyWeekly, now = Date.now()): { text: string; tone: WeeklyTone } {
  const who = w.owner_name || "your family member";
  const Who = who[0].toUpperCase() + who.slice(1);
  const lastSeen = w.last_seen_at ? Date.parse(w.last_seen_at) : NaN;
  const daysSilent = Number.isFinite(lastSeen) ? Math.floor((now - lastSeen) / 86_400_000) : Infinity;
  if (w.total === 0 && daysSilent >= 7) return { text: `Apollo hasn't heard from ${who}'s phone this week. A friendly check-in would not go amiss.`, tone: "neutral" };
  if (w.total === 0) return { text: `A quiet week for ${who}. Nothing came up that needed a look.`, tone: "resting" };
  if (w.open_alerts > 0) return { text: `${Who} has ${w.open_alerts} alert${w.open_alerts > 1 ? "s" : ""} still open this week. I would suggest a call to walk through it.`, tone: "growling" };
  if (w.alerts > 0) return { text: `${Who} had ${w.alerts} alert${w.alerts > 1 ? "s" : ""} this week and handled ${w.alerts > 1 ? "them all" : "it"}. Quite so.`, tone: "ears_up" };
  return { text: `A calm week for ${who}. Apollo looked at ${w.total} thing${w.total > 1 ? "s" : ""} and none needed attention.`, tone: "resting" };
}

export function weeklyDetails(w: FamilyWeekly): string[] {
  const out: string[] = [];
  if (w.total > 0) out.push(`${w.total} check${w.total > 1 ? "s" : ""} over ${w.active_days} day${w.active_days > 1 ? "s" : ""}`);
  if (w.blocked > 0) out.push(`${w.blocked} blocked by Apollo`);
  if (w.handled_alerts > 0) out.push(`${w.handled_alerts} alert${w.handled_alerts > 1 ? "s" : ""} handled`);
  if (w.shared_incidents > 0) out.push(`${w.shared_incidents} incident${w.shared_incidents > 1 ? "s" : ""} shared with you${w.shared_resolved === w.shared_incidents ? ", all handled" : ""}`);
  return out;
}

export function lastSeenLabel(w: FamilyWeekly, now = Date.now()): string {
  if (!w.last_seen_at) return "Apollo has not yet heard from their phone.";
  const mins = Math.max(0, Math.floor((now - Date.parse(w.last_seen_at)) / 60_000));
  if (mins < 60) return "Their Apollo was active in the last hour.";
  if (mins < 60 * 24) return `Their Apollo was active ${Math.floor(mins / 60)}h ago.`;
  const d = Math.floor(mins / (60 * 24));
  return `Their Apollo was last active ${d} day${d > 1 ? "s" : ""} ago.`;
}
