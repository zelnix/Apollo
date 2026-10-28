// The Home hero's two-line Higgins briefing, one per thing Apollo wants the person to see:
//   Line 1: {Type}: {subject/identifier} from {source}, detected as {finding}.
//   Line 2: {date/time}. {Higgins' recommended action}.
// Read only from the case's authoritative record: its Higgins Case Briefing (Higgins Triage → TC FlyBy → Magnum DI
// when warranted → Evidence Lock → Higgins Luddish) when it has one, else what Higgins Triage recorded. Nothing is
// added: a part Apollo didn't record is left out, and long identifiers are shortened to keep the two lines. The full
// explanation, steps and evidence stay in the Threat Case the card opens. Pure: no React, unit-tested.
import type { AttentionItem } from "./homeAttention";
import type { HomeVoice } from "./higginsHomeVoice";
import { sentences } from "./luddish/patterns.ts";
import { looksLikeInternalCode } from "./messageVoice.ts";
import { shortDomain } from "./threatSubject.ts";
import type { ApolloState, PatrolEvent } from "./types";
import type { OriginalSource } from "../store/originalSource";

export interface HeroBrief {
  id: string;
  line1: string;
  line2: string;
  /** The Threat Case (or protection) the card opens. */
  route?: string;
}

/** The identifiers an original kept on this phone records: its From and Subject fields and its text. */
export interface KeptIdentifiers { sender: string | null; subject: string | null; text: string | null }
export function keptIdentifiers(src: Pick<OriginalSource, "fields" | "text"> | null | undefined): KeptIdentifiers | null {
  if (!src) return null;
  const field = (re: RegExp) => clean(src.fields?.find((f) => re.test(f.label.trim()))?.value) || null;
  return { sender: field(/^(from|sender)$/i), subject: field(/^subject$/i), text: clean(src.text) || null };
}

const TYPE: Record<string, string> = {
  email: "Email", message: "Text message", call: "Call", link: "Link", website: "Website", known_threat: "Website",
  protection: "Website", file: "File", app: "App", account: "Account", connection: "Connection", system: "Device",
  device: "Device", family: "Family alert",
};

const clean = (v: string | null | undefined) => (v ?? "").replace(/\s+/g, " ").trim();
/** Shortened to `max` characters, cut at a word where one is close, with "…". */
export function clip(value: string | null | undefined, max: number): string | null {
  const v = clean(value);
  if (!v) return null;
  if (v.length <= max) return v;
  const cut = v.slice(0, max - 1);
  // Cut at a word: drop a half-cut last word, unless the cut already falls between words.
  const word = /\s/.test(v.charAt(max - 1)) ? cut : cut.replace(/\s+\S*$/, "");
  return `${(word.length >= max * 0.6 ? word : cut).replace(/[\s,.;:–—-]+$/, "")}…`;
}
const quoted = (v: string | null | undefined, max: number) => { const c = clip(v, max); return c ? `\u201C${c}\u201D` : null; };
const noStop = (v: string) => v.replace(/[.!?…]+$/, "").trim();

/** A text or a call always says which number it came from; when Apollo wasn't given one, it says so. */
const UNKNOWN_NUMBER = "an unknown number";

/** What the case is about and where it came from, from the identifiers Apollo recorded — on the case, else in the
 *  original kept on this phone (an email or text you submitted keeps its sender only there). */
function identify(e: PatrolEvent, kept: KeptIdentifiers | null): { what: string | null; from: string | null } {
  const m = e.source_metadata;
  const sender = clip(m?.sender ?? kept?.sender, 28);
  const subject = clip(e.case_briefing?.subject, 30);
  const host = shortDomain(m?.url ?? e.local_indicator ?? e.indicator_host);
  switch (e.category) {
    case "email": return { what: quoted(m?.subject ?? kept?.subject, 32) ?? subject, from: sender };
    case "message": return { what: quoted(m?.preview ?? kept?.text, 26) ?? subject, from: sender ?? UNKNOWN_NUMBER };
    case "call": return { what: null, from: clip(e.local_indicator, 24) ?? sender ?? UNKNOWN_NUMBER };
    case "file": return { what: clip(m?.attachment_names?.find((n) => clean(n)), 30) ?? subject, from: sender };
    case "app": return { what: clip(e.claimed_brand, 30) ?? subject, from: null };
    case "link": case "website": case "known_threat": case "protection": return { what: host ?? subject, from: null };
    default: {
      const headline = clean(e.headline);
      return { what: host ?? subject ?? (headline && !looksLikeInternalCode(headline) ? clip(headline, 40) : null), from: null };
    }
  }
}

/** The finding, said as the case recorded it: its Case Briefing's status, else what Apollo itself recorded. */
const STATUS_FINDING: Record<string, string> = {
  "likely scam": "detected as a likely scam",
  "confirmed scam or threat": "detected as a confirmed scam or threat",
  concerning: "detected as concerning",
  "unable to determine": "not confirmed safe",
  "no scam indicators found": "no scam signs found",
};
const blocked = (e: PatrolEvent) => !!(e.verified_block && e.enforcement_evidence);
const investigating = (e: PatrolEvent) => !!(e.investigation_case_id ?? e.patrol_record?.investigationCaseId) && !e.investigation_completed_at;

function finding(e: PatrolEvent): string {
  const status = clean(e.case_briefing?.status).toLowerCase();
  if (status) return STATUS_FINDING[status] ?? `detected as ${status}`;
  if (blocked(e)) return "blocked by Apollo";
  if (e.triage_investigation?.outcome === "LIMITED_UNABLE_TO_DETERMINE") return "not confirmed safe";
  if (e.state === "barking" || e.state === "growling" || e.state === "biting") return "detected as a possible threat";
  if (e.state === "ears_up") return "flagged for a closer look";
  return "flagged by Apollo";
}

/** Higgins' recommendation for the case: its Case Briefing's recommended action, else Apollo's own short step. */
function action(e: PatrolEvent): string {
  const recommended = clean(e.case_briefing?.recommendedAction?.label);
  if (recommended) return noStop(recommended);
  if (blocked(e)) return "No action needed";
  if (investigating(e)) return "Be careful until Higgins has finished";
  if (clean(e.case_briefing?.status).toLowerCase() === "no scam indicators found") return "No action needed";
  const step = sentences(clean(e.what_to_do))[0];
  return step && step.length <= 40 && !looksLikeInternalCode(step) ? noStop(step) : "Be careful";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "28 Oct, 4:42 pm" (the year only when it isn't this year), in the phone's local time. */
export function heroWhen(iso: string | null | undefined, now: Date = new Date()): string {
  const d = new Date(iso ?? "");
  if (isNaN(d.getTime())) return "";
  const h = d.getHours();
  const year = d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : "";
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${year}, ${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

/** One case as the hero's two lines. */
export function eventBrief(e: PatrolEvent, now: Date = new Date(), kept: KeptIdentifiers | null = null): HeroBrief {
  const { what, from } = identify(e, kept);
  const type = TYPE[e.category] ?? "Security check";
  const line1 = `${type}${what ? `: ${what}` : ""}${from ? ` from ${from}` : ""}${what || from ? "," : ""} ${finding(e)}.`;
  const when = heroWhen(e.occurred_at, now);
  return { id: `event:${e.event_id}`, line1, line2: `${when ? `${when}. ` : ""}${action(e)}.`, route: `/patrol/${encodeURIComponent(e.event_id)}` };
}

/** The cases the hero shows, in order: the one Apollo is reacting to first, then every other case needing the person. */
export function heroEvents(attention: AttentionItem[], drivingEvent: PatrolEvent | null, state: ApolloState): PatrolEvent[] {
  const events = attention.filter((a) => a.kind === "event" && a.event).map((a) => a.event!);
  return drivingEvent && !events.some((e) => e.event_id === drivingEvent.event_id) && state !== "resting" ? [drivingEvent, ...events] : events;
}

/** Everything the hero cycles through: the cases (see heroEvents), then protection problems (never called threats).
 *  With nothing to show, Apollo's own status in two lines. `kept` holds each case's kept-original identifiers. */
export function buildHeroBriefs(input: {
  voice: HomeVoice; attention: AttentionItem[]; drivingEvent: PatrolEvent | null; state: ApolloState;
  kept?: Record<string, KeptIdentifiers | null>; now?: Date;
}): HeroBrief[] {
  const { voice, attention, drivingEvent, state, kept = {}, now = new Date() } = input;
  const briefs = heroEvents(attention, drivingEvent, state).map((e) => eventBrief(e, now, kept[e.event_id] ?? null));
  for (const g of attention.filter((a) => a.kind === "gate")) {
    briefs.push({ id: g.id, line1: `${noStop(g.title)}.`, line2: `Not a security threat. ${noStop(g.actionLabel)}.`, route: g.route });
  }
  if (briefs.length) return briefs;
  if (state === "resting") {
    return [{ id: "status", line1: "No security threats detected.", line2: "Apollo is keeping watch. No action needed.", route: voice.ctaRoute }];
  }
  const said = sentences(clean(voice.text));
  return [{ id: "status", line1: said[0] ?? clean(voice.text), line2: said.slice(1).join(" ") || `${noStop(voice.ctaLabel)}.`, route: voice.ctaRoute }];
}
