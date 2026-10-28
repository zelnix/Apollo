// Higgins Luddish L1 — what must survive word for word. Links, addresses, domains, phone numbers, money, percentages,
// dates, times and quoted words are held aside before any language stage runs and put back exactly as they were.
// The Evidence Fidelity Check compares them before and after. Pure: no React, no native imports.

export const IDENTIFIER_PATTERNS: readonly RegExp[] = [
  /“[^”\n]{1,500}”|"[^"\n]{1,500}"/g,                                                    // quoted words
  /\bhttps?:\/\/[^\s<>"'”)\]]*[^\s<>"'”)\].,;:!?]/gi,                                    // links
  /\b[\w.%+-]+@[\w-]+(?:\.[\w-]+)+\b/g,                                                  // email addresses
  /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}\b(?:\/[^\s<>"'”)\]]*[^\s<>"'”)\].,;:!?])?/gi, // domains
  /(?<![\w.])\+?\d[\d ()-]{6,}\d(?![\w.])/g,                                             // phone numbers
  /[$€£]\s?\d[\d,]*(?:\.\d+)?/g,                                                         // money
  /\b\d+(?:\.\d+)?%/g,                                                                   // percentages
  /\b\d{4}-\d{2}-\d{2}(?:T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?\b/g,                          // dates
  /\b\d{1,2}:\d{2}(?:\s?[ap]m)?\b/gi,                                                    // times
];
// Abbreviations whose full stop doesn't end a sentence.
const ABBREVIATIONS = /\b(?:e\.g\.|i\.e\.|etc\.|vs\.|approx\.)(?=\s)/g;

const MARK = /\u0000(\d+)\u0000/g;

/** `text` with every identifier replaced by a placeholder no language stage can change. */
export function hold(text: string): { text: string; held: string[] } {
  const held: string[] = [];
  let out = text;
  for (const pattern of [...IDENTIFIER_PATTERNS, ABBREVIATIONS]) {
    out = out.replace(new RegExp(pattern.source, pattern.flags), (m) => { held.push(m); return `\u0000${held.length - 1}\u0000`; });
  }
  return { text: out, held };
}

export function restore(text: string, held: string[]): string {
  let out = text;
  for (let i = 0; i < 4 && /\u0000\d+\u0000/.test(out); i++) out = out.replace(MARK, (_, n: string) => held[Number(n)] ?? "");
  return out;
}

/** The identifiers in `text`, as a set (each must still be there after the language stages). */
export function identifiers(text: string): Set<string> {
  return new Set(hold(text).held.filter((h) => !/^(?:e\.g\.|i\.e\.|etc\.|vs\.|approx\.)$/.test(h)));
}

/** Sentences, split only where a full stop, ? or ! is followed by a space — "linkt.com.au" stays whole. */
export function sentences(text: string): string[] {
  const { text: held, held: kept } = hold(text);
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < held.length; i++) {
    const ch = held[i];
    if ((ch === "." || ch === "!" || ch === "?") && (i + 1 === held.length || /\s/.test(held[i + 1]))) {
      out.push(held.slice(start, i + 1).trim());
      start = i + 1;
    }
  }
  const rest = held.slice(start).trim();
  if (rest) out.push(rest);
  return out.filter(Boolean).map((s) => restore(s, kept));
}

export const words = (text: string): string[] =>
  text.toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9'§\s-]/g, " ").split(/\s+/).map((w) => w.replace(/^[-']+|[-']+$/g, "")).filter(Boolean);

/** A stable fingerprint (FNV-1a, hex) — enough to tell whether locked evidence changed. */
export function fingerprint(value: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) { h ^= value.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
