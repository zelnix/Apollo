// Higgins Luddish L1 — what Higgins says, everywhere Higgins speaks: check results, reports and Ask Higgins.
//   Evidence Lock → Luddish Dictionary & Knowledge → Luddish Rules → Luddish Composer → Grammar & Punctuation
//   → Plain-English Readability Check → Evidence Fidelity Check → Higgins.
// Change the language, never the evidence. Every line here either passes the Evidence Fidelity Check in its plain
// wording or is shown in Apollo's own words. Words quoted from a source (a scam alert, the knowledge base) stay in the
// source's own words and never come here. No AI, no network. Pure: no React, no native imports.
import type { CheckResultModel } from "../checkResult.ts";
import type { Report } from "../reportSections.ts";
import { BY_ID, DICTIONARY } from "./dictionary.ts";
import { compose, jargonIn, type LuddishExplanation } from "./compose.ts";
import { differences, type FidelityCode } from "./fidelity.ts";
import { rewriteLine } from "./grammar.ts";
import { lockFromCheckResult } from "./lockSources.ts";
import { grade, readability } from "./readability.ts";

export { compose } from "./compose.ts";
export type { LuddishExplanation, LuddishPart } from "./compose.ts";
export { QUESTIONS, resultQuestions } from "./questions.ts";
export type { AnswerItem, AnswerSection, QuestionId, ResultQuestion } from "./questions.ts";
export { askedTerm, explainTerm } from "./terms.ts";
export { isGeneralAnswer, lockFromCheckResult, lockFromInvestigation, lockFromIssue } from "./lockSources.ts";

/** At most this many plain notes beside one result: more would bury the answer. */
export const MAX_NOTES = 2;

export interface LuddishText {
  text: string;
  original: string;
  /** Dictionary meanings to show beside the text (jargon on first use, and anything in a sentence still hard to read). */
  notes: string[];
  before: number;
  after: number;
  /** Lines that kept Apollo's own wording because the plain wording would have changed something. */
  keptLines: { line: number; codes: FidelityCode[] }[];
}

/** Jargon in `text` not yet explained (hard sentences first), as approved meanings; `explained` is updated. */
function notesFor(text: string, explained: Set<string>, room: number): string[] {
  if (room <= 0) return [];
  const hard = readability(text).hard.join(" ");
  const terms = [...jargonIn(hard), ...jargonIn(text)].filter((t, i, all) => !explained.has(t.id) && all.findIndex((x) => x.id === t.id) === i).slice(0, room);
  terms.forEach((t) => explained.add(t.id));
  return terms.map((t) => t.meaning);
}

/** Free text in Luddish, line by line: a line whose plain wording changes anything keeps Apollo's words. `strong`: a
 *  headline or a step of what to do, which keeps every "not" in full. */
export function luddish(text: string, explained: Set<string> = new Set(), room = MAX_NOTES, strong = false): LuddishText {
  const keptLines: LuddishText["keptLines"] = [];
  const lines = text.split("\n").map((line, i) => {
    const plain = rewriteLine(line, strong);
    const codes = differences(line, plain);
    if (codes.length) { keptLines.push({ line: i, codes }); return line; }
    return plain;
  });
  const out = lines.join("\n");
  return { text: out, original: text, notes: notesFor(out, explained, room), before: grade(text), after: grade(out), keptLines };
}

/** Explained already, from a meaning the server's renderer already gave (the dictionary holds its glossary word for word). */
function seedExplained(meanings: (string | null | undefined)[]): Set<string> {
  const ids = new Set<string>();
  for (const m of meanings) { const t = m ? DICTIONARY.find((x) => x.meaning === m) : null; if (t) ids.add(t.id); }
  return ids;
}

/** Just the Luddish wording of `text` (no notes). `strong`: a headline or a step of what to do. */
export const luddishText = (text: string, strong = false): string => luddish(text, new Set(), 0, strong).text;

// ── Check results ──
export interface PlainCheckResult {
  headline: string;
  higginsSays: string;
  whatToDo?: string;
  /** Each check item's finding, in plain words (by item id). */
  items: Record<string, string>;
  /** Plain notes beside Higgins' explanation. */
  notes: string[];
  explanation: LuddishExplanation;
}

export function luddishCheckResult(model: CheckResultModel): PlainCheckResult {
  const ex = compose(lockFromCheckResult(model));
  const explained = new Set<string>();
  const parts = [ex.brief, ex.explanation, ex.action.find((a) => a.ref === "action:0")];
  // Notes from sentences kept exactly come first, then the first jargon of what's shown.
  const notes = parts.map((p) => p?.note).filter((n): n is string => !!n);
  for (const n of notes) for (const t of DICTIONARY) if (n.includes(t.meaning)) explained.add(t.id);
  const shown = parts.map((p) => p?.text ?? "").join(" ");
  notes.push(...notesFor(shown, explained, MAX_NOTES - notes.length));
  const items: Record<string, string> = {};
  for (const item of model.items) items[item.id] = luddish(item.finding, explained, 0).text;
  return {
    headline: ex.brief.ref === "headline" ? ex.brief.text : model.headline,
    higginsSays: ex.explanation?.text ?? model.higginsSays,
    whatToDo: model.whatToDo ? ex.action.find((a) => a.ref === "action:0")?.text ?? model.whatToDo : undefined,
    items, notes: notes.slice(0, MAX_NOTES), explanation: ex,
  };
}

// ── Reports (Ask Higgins and a threat's Overview) ──
/** The report in Luddish. The one-line severity is a fixed line and stays as it is; sources keep their own titles.
 *  The first paragraph of the answer is Apollo's answer itself, so it keeps every "not" in full. */
export function luddishReport(report: Report): Report {
  const explained = seedExplained(report.found.map((f) => f.explain));
  const text = (s: string) => luddish(s, explained, 0).text;
  const found = report.found.map((f) => {
    const plain = text(f.text);
    if (f.explain) return { ...f, text: plain };
    const term = jargonIn(plain).find((t) => !explained.has(t.id));
    if (term) explained.add(term.id);
    return { ...f, text: plain, explain: term ? BY_ID[term.id].meaning : f.explain ?? null };
  });
  const answer = report.answer.map((s, i) => luddish(s, explained, 0, i === 0).text);
  const means = report.means.map(text);
  const notes = notesFor([...answer, ...means].join(" "), explained, MAX_NOTES);
  return {
    ...report, answer, found, means,
    more: report.more.map((s) => ({ ...s, paragraphs: s.paragraphs.map(text) })),
    uncertain: report.uncertain.map(text),
    how: report.how.map(text),
    ...(notes.length ? { notes } : {}),
  };
}

/** Everything a report shows (in Luddish), so the question buttons never say it again. */
export function reportShown(report: Report): string[] {
  const r = luddishReport(report);
  return [...r.answer, r.severity, ...r.found.flatMap((f) => [f.text, f.explain]), ...r.means, ...r.more.flatMap((m) => m.paragraphs),
    ...r.uncertain, ...r.how, ...(r.notes ?? [])].filter((t): t is string => !!t);
}

// ── Ask Higgins ──
export const PLAIN_WORDS = "In plain words:";

/** A Higgins chat answer in Luddish, with any plain notes as a last paragraph. */
export function luddishChat(content: string): string {
  const out = luddish(content);
  return out.notes.length ? `${out.text}\n\n${PLAIN_WORDS} ${out.notes.join(" ")}` : out.text;
}
