// Higgins Luddish L1 — the Plain-English Readability Check. Higgins aims at an Australian Year 7–8 reading level
// (ages 12–14), measured on the Flesch–Kincaid grade scale: grade 8 or under for a whole explanation, and no sentence
// over 25 words. Identifiers and the names people already know (ApolloSG, Apollo, Higgins, the ATO …) count as one
// short word: the reader isn't being asked to decode them. A sentence that's still hard after the plain swaps and safe
// splits is never simplified further, because that would change what it says: it's kept and given a plain note
// (composer). Evidence fidelity outranks readability. Pure: no React, no native imports.
import { COMPILED } from "./dictionary.ts";
import { hold } from "./patterns.ts";

export const TARGET_GRADE = 8;
export const MAX_WORDS = 25;
/** A sentence of 12+ words scoring above this is hard even when it isn't long. */
export const HARD_GRADE = 12;

export function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length <= 3) return 1;
  const trimmed = w.replace(/(?:[^laeiouy]es|[^laeiouy]ed|[^laeiouy]e)$/, (m) => m[0]).replace(/^y/, "");
  return Math.max(1, (trimmed.match(/[aeiouy]{1,2}/g) ?? []).length);
}

const KNOWN = COMPILED.filter((t) => t.familiar || t.category === "apollosg");

/** Text with identifiers and known names each replaced by one short word, and contractions read as the two words
 *  they are ("don't" is read as "do not", so a contraction never looks harder or easier than the words it stands for). */
function simplified(text: string): string {
  let out = hold(text).text.replace(/\u0000\d+\u0000/g, " x ");
  for (const t of KNOWN) out = out.replace(new RegExp(t.re.source, t.re.flags), " x ");
  return out.replace(/[’‘]/g, "'").replace(/\bcan't\b/gi, "can not").replace(/\bwon't\b/gi, "will not").replace(/n't\b/gi, " not")
    .replace(/'re\b/gi, " are").replace(/'ll\b/gi, " will").replace(/'ve\b/gi, " have").replace(/\b(I)'m\b/g, "$1 am");
}

/** Fewer words than this is a label or title, not prose: it has no reading grade. */
export const LABEL_WORDS = 6;

const sentencesOf = (text: string) => text.split(/(?<=[.!?:])\s+|\n+/).map((s) => s.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim()).filter((s) => /[a-z0-9]/i.test(s));
const wordsOf = (sentence: string) => sentence.split(/\s+/).map((w) => w.replace(/^[^\w]+|[^\w]+$/g, "")).filter((w) => /[a-z0-9]/i.test(w));

function score(sentences: string[]): { grade: number; words: number } {
  const all = sentences.map(wordsOf);
  const words = all.reduce((n, w) => n + w.length, 0);
  if (words < LABEL_WORDS) return { grade: 0, words };
  const syl = all.flat().reduce((n, w) => n + w.split("-").reduce((m, part) => m + syllables(part), 0), 0);
  const grade = 0.39 * (words / sentences.length) + 11.8 * (syl / words) - 15.59;
  return { grade: Math.max(0, Math.round(grade * 10) / 10), words };
}

/** Flesch–Kincaid grade of `text`. */
export function grade(text: string): number {
  return score(sentencesOf(simplified(text))).grade;
}

export interface Readability {
  grade: number;
  words: number;
  sentences: number;
  /** A label or title (under LABEL_WORDS words): no reading grade. */
  label: boolean;
  /** The sentences (in their own words) that are still hard to read. */
  hard: string[];
  met: boolean;
}

/** Whether one sentence is hard: too long, or a long-ish sentence with a high grade. */
export function isHard(sentence: string): boolean {
  const s = sentencesOf(simplified(sentence));
  const { grade: g, words } = score(s.length ? s : [sentence]);
  return words > MAX_WORDS || (words >= 12 && g > HARD_GRADE);
}

export function readability(text: string): Readability {
  const own = text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim()).filter((s) => /[a-z0-9]/i.test(s));
  const s = sentencesOf(simplified(text));
  const { grade: g, words } = score(s);
  const hard = own.filter(isHard);
  return { grade: g, words, sentences: s.length, label: words < LABEL_WORDS, hard, met: g <= TARGET_GRADE && hard.length === 0 };
}
