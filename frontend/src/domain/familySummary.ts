// What a threat's "Send to family" shares: the result, what happened, what to do and the website or number
// involved. Never the original message, its full links or its pictures. Pure: no React, no native imports.
import { sentences } from "./luddish/patterns.ts";

export interface Involved { label: "Website" | "Number"; value: string }

export interface FamilySummary {
  eventId: string;
  state: string;
  result: string;
  headline: string;
  whatHappened: string;
  whatToDo: string;
  involved: Involved | null;
  caseRef: string;
  occurredAt: string;
}

/** Whole sentences up to `max` characters, so a long answer is cut where a sentence ends. */
export function shortText(text: string, max: number): string {
  const clean = text.trim();
  if (!clean) return "";
  let out = "";
  for (const s of sentences(clean)) {
    if ((out ? out.length + 1 : 0) + s.length > max) break;
    out = out ? `${out} ${s}` : s;
  }
  return out || `${clean.slice(0, max - 1).trimEnd()}…`;
}

/** The website or number a threat involved: a call's number, else the website's address (never the full link). */
export function involvedIn(event: { category: string; local_indicator?: string | null; indicator_host?: string | null }): Involved | null {
  if (event.category === "call" && event.local_indicator) return { label: "Number", value: event.local_indicator };
  if (event.indicator_host) return { label: "Website", value: event.indicator_host };
  return null;
}

/** A website written so a messaging app can't turn it into a tappable link: example[.]com. */
export const untappable = (host: string) => host.replace(/\./g, "[.]");

/** The text the phone's share menu sends (a message, WhatsApp or an email). */
export function summaryText(s: FamilySummary, when: string): string {
  return [
    "ApolloSG: a threat on my phone",
    `Result: ${s.result}`,
    `What happened: ${s.whatHappened || s.headline}`,
    s.whatToDo ? `What to do: ${s.whatToDo}` : null,
    s.involved ? `${s.involved.label} involved: ${s.involved.label === "Website" ? `${untappable(s.involved.value)} (written so it can't be tapped)` : s.involved.value}` : null,
    `Case ${s.caseRef} · ${when}`,
    "Only this summary is shared. The original message, its links and pictures stay on my phone.",
  ].filter(Boolean).join("\n");
}

/** What Apollo sends to linked family in the app. */
export function summaryWire(s: FamilySummary) {
  return {
    event_id: s.eventId, state: s.state, result: s.result.slice(0, 60), headline: s.headline.slice(0, 200),
    what_happened: s.whatHappened.slice(0, 600), what_to_do: s.whatToDo.slice(0, 400),
    involved_label: s.involved?.label ?? null, involved: s.involved?.value.slice(0, 253) ?? null,
    case_ref: s.caseRef.slice(0, 40), occurred_at: s.occurredAt,
  };
}
