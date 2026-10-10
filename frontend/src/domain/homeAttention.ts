// Home "attention" model. Turns the REAL gate states and active Patrol events into a short list of
// specific, actionable issues — so Home can name exactly which gate is affected, what the problem is,
// what Higgins recommends, and the one action to take. No new text is invented: problem text comes
// from the gate's own currentHelp / the event's what_happened, and the recommendation from the gate
// limitation / the event's what_to_do. Pure and unit-tested.
import type { GatePresentation } from "./gates";
import type { EventCategory, PatrolEvent } from "./types";
import { isActive } from "./stateMachine.ts";

export interface AttentionItem {
  id: string;
  kind: "gate" | "event";
  /** Names the affected gate, e.g. "Internet Gate". */
  gate: string;
  /** Short heading, e.g. "Internet Gate needs attention". */
  title: string;
  /** The specific problem, from real gate/event data. */
  problem: string;
  /** Higgins' recommended next step, from real gate/event data. */
  higgins: string;
  actionLabel: string;
  route: string;
  /** Present for event items so the UI can offer Dismiss. */
  event?: PatrolEvent;
}

// Which gate a Patrol event belongs to (for naming the affected gate on Home).
const GATE_FOR_CATEGORY: Record<EventCategory, string> = {
  link: "Link Gate", website: "Site Gate", known_threat: "Site Gate", protection: "Site Gate",
  connection: "Internet Gate", system: "Device Gate", device: "Device Gate", message: "Text Gate",
  call: "Call Gate", app: "App Gate", account: "Account Gate", email: "Email Gate", file: "File Gate",
  family: "Family alert",
};
const gateForCategory = (c: EventCategory | string) => GATE_FOR_CATEGORY[c as EventCategory] ?? "a security check";

/** Short event description using real evidence — avoids generic "Email Gate". */
function describeEventBrief(e: PatrolEvent): string {
  const cat = e.category;
  const indicator = e.indicator_host || "";
  const brand = e.claimed_brand || "";
  const sender = brand || indicator;
  if (cat === "email" && sender) return `Email from ${sender}`;
  if (cat === "call" && indicator) return `Call from ${indicator}`;
  if (cat === "message" && sender) return `Text from ${sender}`;
  if ((cat === "link" || cat === "website" || cat === "known_threat") && indicator)
    return `Site: ${indicator.length > 40 ? indicator.slice(0, 39) + "…" : indicator}`;
  const hl = (e.headline || "").trim();
  if (hl && hl.length <= 50) return hl;
  return gateForCategory(cat);
}

// Where the action for a gate issue should take the person.
const GATE_ROUTE: Record<string, string> = {
  site: "/gates", text: "/text-guard", call: "/call-guard", network: "/network", email: "/email",
  link: "/check", account: "/account", file: "/file", app: "/app-check", device: "/device",
};

/** Build the ordered list of things that genuinely need the person's attention right now.
 *  Order: verified gate failures first (protection actually stopped), then active events that need a
 *  decision (barking), then active concerns Apollo is still assessing (growling and ears_up — e.g.
 *  a suspected scam text, an insecure connection, a device setting change). Optional setup is
 *  deliberately NOT included — it is not an alarm. */
export function buildHomeAttention(input: { gates: GatePresentation[]; events: PatrolEvent[] }): AttentionItem[] {
  const items: AttentionItem[] = [];

  // 1) Gates in a verified "Action needed" state (e.g. Site Gate protection was on but stopped).
  for (const g of input.gates) {
    if (g.tone !== "action") continue;
    const limitation = g.capability.automatic?.limitation;
    const higgins = limitation ?? (g.primaryAction ? `${g.primaryAction.label} to restore protection.` : "Open the gate to restore protection.");
    items.push({
      id: `gate:${g.id}`,
      kind: "gate",
      gate: g.title,
      title: `${g.title} needs attention`,
      problem: g.currentHelp,
      higgins,
      actionLabel: g.primaryAction?.label ?? "Open gate",
      route: GATE_ROUTE[g.id] ?? "/gates",
    });
  }

  // 2) Active events — any state that Apollo is reacting to and the person should see.
  //    barking = needs a decision (highest), growling / ears_up = Apollo is unsure and worth a look.
  const activeAttention = input.events
    .filter((e) => isActive(e) && (e.state === "barking" || e.state === "growling" || e.state === "ears_up"))
    .sort((a, b) => {
      const rank = (s: typeof a.state) => (s === "barking" ? 3 : s === "growling" ? 2 : s === "ears_up" ? 1 : 0);
      const r = rank(b.state) - rank(a.state);
      return r !== 0 ? r : Date.parse(b.occurred_at) - Date.parse(a.occurred_at);
    });
  for (const e of activeAttention) {
    const gate = gateForCategory(e.category);
    const problem = (e.what_happened || e.headline || "").trim();
    const higgins = (e.what_to_do || "").trim() || "Open it and I'll tell you exactly what to do.";
    // Build an evidence-specific title rather than generic "Email Gate looks suspicious".
    const specificLabel = describeEventBrief(e);
    const title = e.state === "barking"
      ? `${specificLabel} — needs your decision`
      : e.state === "growling"
        ? `${specificLabel} — flagged by Apollo`
        : `${specificLabel} — worth a look`;
    items.push({
      id: `event:${e.event_id}`,
      kind: "event",
      gate,
      title,
      problem: problem || "Apollo flagged something that needs your attention.",
      higgins,
      actionLabel: "Open investigation",
      route: `/patrol/${encodeURIComponent(e.event_id)}`,
      event: e,
    });
  }

  return items;
}
