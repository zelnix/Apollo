// Higgins Luddish L1 — Grammar & Punctuation, with the plain-word swaps. Every change keeps exactly what was said:
//   - formal words become everyday ones: the server's list (backend explain/words.py PLAIN_SWAPS) word for word, then a
//     few more that mean exactly the same;
//   - a dictionary term with an exact plain name takes it ("URL" → "web address"), with "a"/"an" put right;
//   - a long sentence is split only where a full stop changes nothing ("; ", ", but ", ", so ");
//   - spacing, doubled words and doubled punctuation are tidied, and each sentence starts with a capital.
// Identifiers and quotes are held aside first (patterns.hold) and put back word for word, so nothing here can touch
// them. Pure: no React, no native imports.
import { COMPILED } from "./dictionary.ts";
import { escapeRe, hold, restore } from "./patterns.ts";

/** Formal → plain. The first block is the server's list, word for word, so both sides say it the same way. */
export const PLAIN_SWAPS: readonly (readonly [string, string])[] = [
  ["in order to", "to"], ["prior to", "before"], ["approximately", "about"],
  ["utilised", "used"], ["utilized", "used"], ["utilising", "using"], ["utilizing", "using"],
  ["utilises", "uses"], ["utilizes", "uses"], ["utilise", "use"], ["utilize", "use"],
  ["commenced", "started"], ["commences", "starts"], ["commence", "start"],
  ["insufficient", "not enough"], ["sufficient", "enough"], ["additional", "more"],
  ["obtained", "got"], ["obtain", "get"], ["assistance", "help"], ["regarding", "about"], ["numerous", "many"],
  ["subsequently", "later"], ["furthermore", "also"], ["moreover", "also"], ["additionally", "also"],
  ["nevertheless", "still"], ["nonetheless", "still"],
  ["indicates", "shows"], ["indicated", "showed"], ["indicating", "showing"], ["indicate", "show"],
  ["demonstrates", "shows"], ["demonstrated", "showed"],
  ["attempts to", "tries to"], ["attempted to", "tried to"], ["attempt to", "try to"],
  ["is unable to", "can't"], ["are unable to", "can't"], ["was unable to", "couldn't"], ["were unable to", "couldn't"],
  ["cannot", "can't"], ["can not", "can't"],
  ["do not", "don't"], ["does not", "doesn't"], ["did not", "didn't"], ["is not", "isn't"], ["are not", "aren't"],
  ["was not", "wasn't"], ["were not", "weren't"], ["has not", "hasn't"], ["have not", "haven't"], ["had not", "hadn't"],
  ["could not", "couldn't"], ["would not", "wouldn't"], ["should not", "shouldn't"], ["will not", "won't"],
  // Luddish's own additions: each means exactly the same.
  ["due to the fact that", "because"], ["in the event that", "if"], ["at this time", "now"], ["with regard to", "about"],
  ["in relation to", "about"], ["whether or not", "whether"],
  ["attempting to", "trying to"],
  ["is able to", "can"], ["are able to", "can"], ["was able to", "could"], ["were able to", "could"],
  ["ensures", "makes sure"], ["ensured", "made sure"], ["ensuring", "making sure"], ["ensure", "make sure"],
  ["assists", "helps"], ["assisted", "helped"], ["assisting", "helping"], ["assist", "help"],
  ["occurred", "happened"], ["occurring", "happening"], ["occurs", "happens"], ["occur", "happen"],
  ["modifies", "changes"], ["modified", "changed"], ["modify", "change"],
  ["examines", "looks at"], ["examined", "looked at"], ["examining", "looking at"], ["examine", "look at"],
  ["via", "through"], ["elevated", "higher"], ["appears to", "seems to"], ["appear to", "seem to"],
];

// Longest first, so "is unable to" is swapped before anything shorter inside it.
const SWAPS = [...PLAIN_SWAPS].sort((a, b) => b[0].length - a[0].length)
  .map(([formal, plain]) => [new RegExp(`(?<![\\w'-])${escapeRe(formal)}(?![\\w'-])`, "gi"), plain] as const);
const PLAIN_TERMS = COMPILED.filter((t) => t.plain);

const SWAPPED = "\u0001"; // marks a swapped word until "a"/"an" in front of it is put right
const FIRST_WORD_CAPITALISED = (s: string) => /^[A-Z](?:[a-z]|$|[^A-Za-z])/.test(s);

/** Keep a capital first letter where the original had one ("Malicious" → "Harmful"), but not an acronym's ("URL"). */
function cased(original: string, plain: string): string {
  return FIRST_WORD_CAPITALISED(original) ? plain[0].toUpperCase() + plain.slice(1) : plain;
}

/** The plain swaps and the dictionary's exact plain names, on text whose identifiers are already held. */
export function swapHeld(text: string): string {
  let out = text;
  for (const [re, plain] of SWAPS) out = out.replace(re, (m) => SWAPPED + cased(m, plain));
  for (const t of PLAIN_TERMS) {
    out = out.replace(new RegExp(t.re.source, t.re.flags), (m) => {
      const many = /s$/i.test(m) && t.plain!.many ? t.plain!.many : t.plain!.one;
      return SWAPPED + cased(m, many);
    });
  }
  // "an SMS message" → "a text message"; "a URL" → "a web address".
  out = out.replace(new RegExp(`\\b(an?|An?) ${SWAPPED}([A-Za-z])`, "g"), (_, article: string, first: string) => {
    const vowel = /[aeiou]/i.test(first);
    const fixed = vowel ? "an" : "a";
    return `${article[0] === "A" ? fixed[0].toUpperCase() + fixed.slice(1) : fixed} ${first}`;
  });
  return out.replaceAll(SWAPPED, "");
}

/** The plain swaps on ordinary text (identifiers and quotes held aside). */
export function swap(text: string): string {
  const { text: held, held: kept } = hold(text);
  return restore(swapHeld(held), kept);
}

const SMALL_DOUBLES = /\b(the|a|an|to|of|and|is|in|it|on|for)\s+\1\b/gi;
/** An internal code left in the words ("very_high"): read as words. Identifiers are already held, so none is touched. */
const CODE_WORD = /\b[a-z]+(?:_[a-z]+)+\b/g;

/** Tidy one line of held text: spacing, doubled words and punctuation, a capital at the start of each sentence. */
function tidy(line: string): string {
  let out = line.replace(CODE_WORD, (m) => m.replace(/_/g, " "))
    .replace(/[ \t]{2,}/g, " ").replace(/\s+([,.;:!?])(?=\s|$|[A-Z])/g, "$1").replace(/([a-z])([.!?])(?=[A-Z][a-z])/g, "$1$2 ")
    .replace(/,{2,}/g, ",").replace(/(?<!\.)\.\.(?!\.)/g, ".").replace(/([!?]){2,}/g, "$1")
    .replace(SMALL_DOUBLES, "$1")
    .replace(/(^|[.!?]\s+)However,\s+/g, "$1But ");
  out = out.replace(/(^|[.!?]\s+)([a-z])/g, (_, before: string, first: string) => before + first.toUpperCase());
  return out.trim();
}

const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;
export const SPLIT_OVER = 20;          // a sentence longer than this many words is split where it safely can be
const MIN_PART = 5;                    // never leave a piece shorter than this
// "…, but not…", "…, so that…" would leave a fragment, so they're never split.
const NO_SPLIT_AFTER = /^(?:not|only|also|that|as|too|then|far|much|many|on)\b/i;
// A single dash is split only where what follows can stand as a sentence: an instruction, or a clause with its subject.
const DASH_STARTS = /^(?:it|it's|this|that's|they|they're|you|you're|we|apollo|apollosg|higgins|there|don't|do|go|call|contact|check|delete|never|hang|open|report)\b/i;

/** One held sentence, split at its safe joints while it's still long. Every word is kept. */
function split(sentence: string): string[] {
  if (wordCount(sentence) <= SPLIT_OVER) return [sentence];
  const joints = sentence.split(" — ").length === 2 ? ["; ", ", but ", ", so ", " — "] : ["; ", ", but ", ", so "];
  for (const joint of joints) {
    let from = 0;
    for (;;) {
      const at = sentence.indexOf(joint, from);
      if (at < 0) break;
      from = at + joint.length;
      const left = sentence.slice(0, at).trim();
      const rest = sentence.slice(at + joint.length);
      const word = joint.replace(/[;,—]/g, "").trim(); // "", "but", "so"
      const right = (word ? `${word} ${rest}` : rest).trim();
      if (wordCount(left) < MIN_PART || wordCount(right) < MIN_PART || NO_SPLIT_AFTER.test(rest)) continue;
      if (joint === " — " && !DASH_STARTS.test(rest)) continue;
      const end = /[.!?]$/.test(left) ? left : `${left}.`;
      return [...split(end), ...split(right[0].toUpperCase() + right.slice(1))];
    }
  }
  return [sentence];
}

/** Sentences of held text: a full stop, ? or ! followed by a space (held identifiers can't be split). */
function heldSentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
}

const PREFIX = /^(\s*(?:[-*•]|\d+[.)])\s+)?/;

/** Grammar & Punctuation for one line (a bullet keeps its bullet): plain swaps, tidy, safe splits. */
export function rewriteLine(line: string): string {
  if (!line.trim()) return line;
  const prefix = line.match(PREFIX)?.[0] ?? "";
  const { text: held, held: kept } = hold(line.slice(prefix.length));
  const parts = heldSentences(tidy(swapHeld(held)));
  const out = parts.flatMap(split);
  // A sentence that was split ends with a full stop like the sentence before it.
  if (out.length > parts.length && /[\w\u0000]$/.test(out[out.length - 1])) out[out.length - 1] += ".";
  return prefix + restore(out.join(" "), kept);
}

/** Grammar & Punctuation for any text, line by line. */
export function rewrite(text: string): string {
  return text.split("\n").map(rewriteLine).join("\n");
}
