// Threat Case search: the person's OPEN cases whose sender, website or message words match what they typed.
// Only what this phone already holds is searched — the case and the original kept on it. Nothing is sent anywhere.
// Pure: unit-tested in node (tests/caseSearch.test.ts).
import { threatCases } from "./threatCase.ts";
import type { PatrolEvent } from "./types";
import type { OriginalSource } from "../store/originalSource";

export type CaseMatch = "sender" | "website" | "message";
export interface CaseSearchResult {
  event: PatrolEvent;
  match: CaseMatch;
  /** What matched, as the person would recognise it: the sender, the website, or the words around the match. */
  excerpt: string;
}

export const MATCH_LABEL: Record<CaseMatch, string> = { sender: "Sender", website: "Website", message: "Message" };
/** Shorter queries would match almost everything. */
export const MIN_QUERY = 2;

/** The cases still open — not closed by the person or by Apollo — one row per case, latest first. */
export function openCases(events: PatrolEvent[]): PatrolEvent[] {
  return threatCases(events).filter((e) => !e.resolved_at);
}

const tidy = (s: string) => s.normalize("NFKC").replace(/\s+/g, " ").trim();
const fold = (s: string) => tidy(s).toLowerCase();
const digits = (s: string) => s.replace(/\D/g, "");
/** +61 4xx… and 04xx… are the same Australian number. */
const national = (d: string) => (d.startsWith("61") && d.length >= 11 ? `0${d.slice(2)}` : d);
const hostOf = (s: string) => fold(s).replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/^www\./, "").split(/[/?#\s]/)[0];
const looksLikeAddress = (s: string) => /[a-z0-9-]+\.[a-z]{2,}/i.test(s) && !/@/.test(s);
const URLS = /\b(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?/gi;
const SENDER_FIELD = /^(from|sender|number|caller|phone|reply-?to)$/i;
const SUBJECT_FIELD = /^subject$/i;

function searchable(e: PatrolEvent, original: OriginalSource | null) {
  const meta = e.source_metadata;
  const fields = original?.fields ?? [];
  const indicator = e.local_indicator ?? null;
  const senders = [
    meta?.sender, meta?.reply_to,
    ...fields.filter((f) => SENDER_FIELD.test(f.label.trim())).map((f) => f.value),
    indicator && !looksLikeAddress(indicator) ? indicator : null,
  ].filter((s): s is string => !!s && !!tidy(s));
  const text = tidy(original?.text ?? meta?.preview ?? "");
  const subject = tidy(fields.find((f) => SUBJECT_FIELD.test(f.label.trim()))?.value ?? meta?.subject ?? "");
  const websites = [
    e.indicator_host, indicator && looksLikeAddress(indicator) ? indicator : null, meta?.url, original?.url,
    ...(text.match(URLS) ?? []),
  ].filter((s): s is string => !!s && !!hostOf(s));
  return { senders, websites, words: [subject, text].filter(Boolean).join(" — ") };
}

/** The words around the first match, so the person can see why the case came up. */
function excerptAround(text: string, term: string, room = 90): string {
  const at = Math.max(0, text.toLowerCase().indexOf(term));
  const start = Math.max(0, at - 30);
  const piece = text.slice(start, start + room).trim();
  return `${start > 0 ? "…" : ""}${piece}${start + room < text.length ? "…" : ""}`;
}

/** How one case matches the query — sender first, then website, then the words of the message — or null. */
export function matchCase(e: PatrolEvent, original: OriginalSource | null, query: string): Omit<CaseSearchResult, "event"> | null {
  const q = fold(query);
  if (q.length < MIN_QUERY) return null;
  const { senders, websites, words } = searchable(e, original);
  const qDigits = digits(q);
  const numberQuery = qDigits.length >= 3 && /^[\d\s()+-]+$/.test(q);
  const qHost = hostOf(q);
  const bySender = () => senders.find((s) => fold(s).includes(q) || (numberQuery && national(digits(s)).includes(national(qDigits))));
  const byWebsite = () => !q.includes(" ") && websites.find((w) => hostOf(w).includes(qHost) || fold(w).includes(q));
  // A query written like a web address is looked for as a website first (an email sender often shares the domain).
  const addressQuery = /^[a-z][a-z0-9+.-]*:\/\//.test(q) || looksLikeAddress(q);
  const sender = addressQuery ? null : bySender();
  if (sender) return { match: "sender", excerpt: tidy(sender) };
  const website = byWebsite();
  if (website) return { match: "website", excerpt: hostOf(website) };
  const lateSender = addressQuery ? bySender() : null;
  if (lateSender) return { match: "sender", excerpt: tidy(lateSender) };
  const terms = q.split(" ").filter(Boolean);
  const body = words.toLowerCase();
  if (words && terms.every((t) => body.includes(t))) return { match: "message", excerpt: excerptAround(words, terms[0]) };
  return null;
}

/** The open cases matching the query, latest first. `originals` holds each case's kept original by event id. */
export function searchCases(cases: PatrolEvent[], query: string, originals: Record<string, OriginalSource | null>): CaseSearchResult[] {
  return cases.flatMap((event) => {
    const found = matchCase(event, originals[event.event_id] ?? null, query);
    return found ? [{ event, ...found }] : [];
  });
}
