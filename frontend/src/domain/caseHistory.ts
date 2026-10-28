// Related cases and previous reports for a case: context, never evidence. Every related case is one of THIS
// device's own (devices are mutually exclusive: another device's case is never shown, named or counted here). The
// investigation's history notes (backend services/higgins/history.py) are the authority; the connected events this
// device holds are added beside them. Nothing here changes a verdict or a finding: the confidence history added is
// shown exactly as the result recorded it. Pure: no React Native, unit-tested in node.
import type { HigginsResponse, HistoryNote } from "../investigation/types";
import { outcomeLabel } from "./messageVoice.ts";
import type { PatrolEvent } from "./types";

export const RELATED_REASON: Record<HistoryNote["match"], string> = {
  website: "Same link", number: "Same number", email: "Same email address", message: "Same message", file: "Same file",
  organisation: "Same organisation named", connected: "Connected events",
};

export interface RelatedRow {
  key: string;
  /** This device's event for it, when this device still holds it (it then opens). */
  event: PatrolEvent | null;
  /** "Same link", "Connected events"… */
  reason: string;
  at: string | null;
  /** Its result, as that case recorded it ("Likely scam"). */
  result: string | null;
  /** The note's own words, for a case this device no longer holds. */
  text: string;
  /** It agreed with this case's concern and raised the confidence of at least one finding. */
  addsWeight: boolean;
}

export interface CaseHistory {
  related: RelatedRow[];
  /** ApolloSG's previous reports, in the server's approved words: "This link, x, has been previously reported as
   *  malicious — High confidence." or "… has mixed previous reports." Never who, how many or when. */
  encountered: { key: string; text: string; addsWeight: boolean }[];
  /** How many of this case's findings history made Higgins more confident in. */
  weighted: number;
}

const notesOf = (response: HigginsResponse | null | undefined): HistoryNote[] => response?.history ?? [];

export function caseHistory(event: PatrolEvent | null | undefined, events: PatrolEvent[], response: HigginsResponse | null | undefined): CaseHistory {
  const notes = notesOf(response);
  // Only this device's own events: one that names another device is never shown here.
  const own = events.filter((e) => !event?.device_id || !e.device_id || e.device_id === event.device_id);
  const byId = new Map(own.map((e) => [e.event_id, e]));
  const seen = new Set<string>(event ? [event.event_id] : []);
  const related: RelatedRow[] = [];
  notes.forEach((n, i) => {
    if (n.kind !== "related_case" || (n.eventId && seen.has(n.eventId))) return;
    if (n.eventId) seen.add(n.eventId);
    const local = n.eventId ? byId.get(n.eventId) ?? null : null;
    related.push({ key: n.eventId ?? `note-${i}`, event: local, reason: RELATED_REASON[n.match], at: n.at ?? local?.occurred_at ?? null,
      result: outcomeLabel(n.outcome), text: n.text, addsWeight: n.findingIds.length > 0 });
  });
  if (event?.scent_id) {
    for (const e of own) {
      if (e.scent_id !== event.scent_id || seen.has(e.event_id)) continue;
      seen.add(e.event_id);
      related.push({ key: e.event_id, event: e, reason: RELATED_REASON.connected, at: e.occurred_at, result: null,
        text: "An earlier event on this device is connected to this one.", addsWeight: false });
    }
  }
  const encountered = notes.flatMap((n, i) => (n.kind === "previously_encountered" ? [{ key: `enc-${i}`, text: n.text, addsWeight: n.findingIds.length > 0 }] : []));
  return { related, encountered, weighted: new Set(notes.flatMap((n) => n.findingIds)).size };
}

/** Where extra confidence came from: this device's own earlier cases, or ApolloSG's previous reports (other devices,
 *  through ApolloSG only). Never the case's own evidence. */
export type RaisedFrom = "this_device" | "previous_reports";
export const RAISED_LABEL: Record<RaisedFrom, string> = {
  this_device: "Confidence raised by an earlier case on this device (not evidence)",
  previous_reports: "Confidence raised by ApolloSG's previous reports (not evidence)",
};

/** The history notes that raised this finding's confidence, in their own words, with where each came from. */
export function raisedBy(response: HigginsResponse | null | undefined, findingId: string): { from: RaisedFrom; text: string }[] {
  return notesOf(response).filter((n) => n.findingIds.includes(findingId))
    .map((n) => ({ from: n.kind === "related_case" ? "this_device" as const : "previous_reports" as const, text: n.text }));
}

const COUNT = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight"];

/** What the extra weight did, said once: never that history is evidence. */
export function weightLine(weighted: number): string | null {
  if (!weighted) return null;
  const n = COUNT[weighted] ?? String(weighted);
  return `These match what this case found, so Higgins is more confident in ${weighted === 1 ? "one of its findings" : `${n} of its findings`}. They aren't evidence on their own.`;
}
