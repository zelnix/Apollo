// Higgins Luddish L1 — the Evidence Fidelity Check. Before Higgins says anything in Luddish, it is compared with the
// Evidence Lock. PASS only when the language changed and the evidence didn't:
//   - the lock is exactly as it was made, and the state is the one Apollo recorded;
//   - every finding, uncertainty and step is there, in order, saying the same thing: the same meaning-bearing words,
//     the same yes-or-no, the same numbers, every "because"/"so" kept;
//   - every link, address, number, date, amount and quote is kept word for word, and none is added;
//   - nothing sounds more certain, safer, milder or more alarming than the locked wording;
//   - who established each finding, and how firmly, is unchanged;
//   - words Luddish adds are only its approved state wording, dictionary meanings and knowledge, and knowledge never
//     appears as a finding;
//   - the technical detail is the locked wording itself, untouched.
// Failures name only the kind of problem and where, never content. Pure: no React, no native imports.
import { DICTIONARY } from "./dictionary.ts";
import { KNOWLEDGE_TEXTS } from "./knowledge.ts";
import { lockIntact, lockedTexts, type EvidenceLock } from "./lock.ts";
import { swap } from "./grammar.ts";
import { identifiers, sentences, words } from "./patterns.ts";
import { STATE_RULES } from "./rules.ts";

export const CODES = {
  LOCK_BROKEN: "The Evidence Lock changed after it was made, so nothing was explained.",
  STATE_CHANGED: "The state isn't the one Apollo recorded.",
  STATE_WORDING: "A sentence Luddish added isn't its approved wording for the recorded state.",
  FINDING_DROPPED: "A finding is missing.",
  FINDING_ORDER: "The findings are in a different order from Apollo's.",
  BASIS_CHANGED: "Who established a finding, or how firmly, changed.",
  STATEMENT_DROPPED: "Something Apollo recorded is missing.",
  UNCERTAINTY_DROPPED: "Something Apollo couldn't establish is missing.",
  ACTION_DROPPED: "A step of what to do is missing.",
  MEANING_CHANGED: "The plain wording doesn't say what Apollo's wording says.",
  NEGATION_CHANGED: "A \"not\" or \"no\" was added or lost.",
  NUMBER_CHANGED: "A number changed.",
  CAUSAL_DROPPED: "A \"because\" or \"so\" link between two facts was lost.",
  IDENTIFIER_DROPPED: "A link, address, number, date or amount is missing.",
  IDENTIFIER_ADDED: "A link, address, number, date or amount appears that Apollo didn't record.",
  QUOTE_ALTERED: "Quoted words weren't kept word for word.",
  CERTAINTY_ADDED: "The plain wording sounds more certain than Apollo's.",
  SAFETY_CLAIM_ADDED: "The plain wording sounds safer than Apollo's.",
  SEVERITY_SOFTENED: "The plain wording plays the risk down.",
  SEVERITY_ESCALATED: "The plain wording plays the risk up.",
  KNOWLEDGE_AS_EVIDENCE: "General knowledge appears as a finding.",
  NOTE_NOT_APPROVED: "An explanation isn't one of the dictionary's approved meanings.",
  TECHNICAL_ALTERED: "The technical detail isn't Apollo's own wording.",
} as const;
export type FidelityCode = keyof typeof CODES;
export interface FidelityFailure { code: FidelityCode; ref: string }
export interface FidelityResult { status: "PASS" | "FAIL"; failures: FidelityFailure[] }

// The server's tone lists (backend explain/words.py), word for word.
export const CERTAINTY = ["definitely", "certainly", "guaranteed", "proven", "proves", "100%", "without doubt", "no doubt", "for sure", "confirmed", "always"];
export const SAFETY = ["safe", "safely", "genuine", "legitimate", "legit", "trustworthy", "harmless", "nothing to worry", "no need to worry", "don't worry", "fine"];
export const SOFTENERS = ["probably", "just", "only", "minor", "slightly", "a little", "low risk", "unlikely", "maybe"];
export const ESCALATORS = ["urgent", "urgently", "immediately", "dangerous", "emergency", "right now", "critical", "serious", "seriously"];
const TONE: readonly [FidelityCode, readonly string[]][] = [["CERTAINTY_ADDED", CERTAINTY], ["SAFETY_CLAIM_ADDED", SAFETY], ["SEVERITY_SOFTENED", SOFTENERS], ["SEVERITY_ESCALATED", ESCALATORS]];

const STOP = new Set(("a an the this that these those it its is are was were be been being so to of on in at or and but with for by as from your you " +
  "there here what which who how would will can could has have had do does did if then than also just into about").split(" "));
const NEGATIONS = new Set(["not", "no", "never", "nothing", "none", "nobody", "nowhere", "neither", "nor", "without"]);
const CAUSAL = /\b(because|so|therefore|as a result|which means|that's why|that is why|hence|thus|since)\b/i;
const QUOTE = /“[^”\n]{1,500}”|"[^"\n]{1,500}"/g;
const stem = (w: string) => w.replace(/(?<=[a-z]{3})(?:ing|ed|es|s)$/, "");

/** The meaning-bearing words, with formal and plain forms (and contractions) made the same. */
export function canon(text: string): string[] {
  const out: string[] = [];
  for (const raw of words(swap(text))) {
    if (raw === "can't" || raw === "cannot") out.push("can", "not");
    else if (raw === "won't") out.push("will", "not");
    else if (raw.endsWith("n't")) out.push(raw.slice(0, -3), "not");
    else {
      const w = raw.replace(/'(s|re|ve|ll|d|m)$/, "").replace(/'/g, "");
      if (w && !STOP.has(w)) out.push(NEGATIONS.has(w) ? w : stem(w));
    }
  }
  return out.filter((w) => w && !STOP.has(w));
}

const count = (text: string, phrase: string) => (text.toLowerCase().replace(/[’‘]/g, "'").match(new RegExp(`(?<![\\w'])${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w'])`, "g")) ?? []).length;
const digits = (ws: string[]) => ws.filter((w) => /\d/.test(w)).sort().join(" ");

/** What changed between Apollo's wording and the plain wording: nothing (an empty list) when it's the same point. */
export function differences(original: string, rendered: string): FidelityCode[] {
  if (original === rendered) return [];
  const out: FidelityCode[] = [];
  const before = identifiers(original), after = identifiers(rendered);
  for (const id of before) if (!after.has(id)) out.push(/^["“]/.test(id) ? "QUOTE_ALTERED" : "IDENTIFIER_DROPPED");
  for (const id of after) if (!before.has(id)) out.push("IDENTIFIER_ADDED");
  for (const q of original.match(QUOTE) ?? []) if (!rendered.includes(q)) out.push("QUOTE_ALTERED");
  const a = canon(original), b = canon(rendered);
  const sa = new Set(a), sb = new Set(b);
  const kept = [...sa].filter((w) => sb.has(w)).length;
  if (sa.size && (kept / sa.size < 0.85 || (sb.size && [...sb].filter((w) => !sa.has(w)).length / sb.size > 0.25))) out.push("MEANING_CHANGED");
  if (a.filter((w) => NEGATIONS.has(w) || w === "not").length !== b.filter((w) => NEGATIONS.has(w) || w === "not").length) out.push("NEGATION_CHANGED");
  if (digits(words(original)) !== digits(words(rendered))) out.push("NUMBER_CHANGED");
  if (CAUSAL.test(original) && !CAUSAL.test(rendered)) out.push("CAUSAL_DROPPED");
  for (const [code, phrases] of TONE) if (phrases.some((p) => count(rendered, p) > count(original, p))) out.push(code);
  return [...new Set(out)];
}

// ── The whole explanation against its lock ──
export interface CheckedPart { ref: string; text: string; source: "evidence" | "rule"; note: string | null; detail?: string | null }
export interface CheckedExplanation {
  state: string;
  brief: CheckedPart;
  explanation: CheckedPart | null;
  findings: CheckedPart[];
  meaning: CheckedPart[];
  importance: CheckedPart | null;
  limitation: CheckedPart[];
  action: CheckedPart[];
  noAction: string | null;
  how: CheckedPart | null;
  terms: { meaning: string }[];
  knowledge: { brief: string; explain: string }[];
  technical: { ref: string; text: string }[];
}

const MEANINGS = new Set(DICTIONARY.map((t) => t.meaning));
const norm = (s: string) => s.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
const KNOWN_SENTENCES = new Set([...KNOWLEDGE_TEXTS, ...MEANINGS].flatMap((t) => sentences(t)).map(norm));

/** Every sentence a state's rule may say (blocked: with who did it, or the fixed line when nobody was recorded). */
export function ruleWording(state: keyof typeof STATE_RULES, blockedBy: string | null): Set<string> {
  const r = STATE_RULES[state];
  const finding = r.finding.map((f) => f.includes("{actor}") ? (blockedBy ? f.replace("{actor}", blockedBy) : "It was blocked.") : f);
  return new Set([...finding, ...r.means, r.matters, r.limitation, r.action, r.noAction].filter((s): s is string => !!s).map((s) => s[0].toUpperCase() + s.slice(1)));
}

/** "In short: …" — the recorded state's approved meaning, given beside a sentence too hard to simplify safely. */
export const inShort = (means: string) => `In short: ${means[0].toLowerCase()}${means.slice(1)}`;

/** A note is only dictionary meanings and the state's "In short" lines, one after another, word for word. */
export function approvedNote(note: string, state: keyof typeof STATE_RULES): boolean {
  const pieces = [...MEANINGS, ...STATE_RULES[state].means.map(inShort)];
  let rest = note.trim();
  while (rest) {
    const hit = pieces.find((p) => rest.startsWith(p));
    if (!hit) return false;
    rest = rest.slice(hit.length).trim();
  }
  return true;
}

export function checkExplanation(lock: EvidenceLock, ex: CheckedExplanation): FidelityResult {
  const failures: FidelityFailure[] = [];
  const fail = (code: FidelityCode, ref: string) => { if (!failures.some((f) => f.code === code && f.ref === ref)) failures.push({ code, ref }); };
  if (!lockIntact(lock)) fail("LOCK_BROKEN", "lock");
  if (ex.state !== lock.state) fail("STATE_CHANGED", "state");

  const evidence = (part: CheckedPart | null | undefined, original: string, ref: string, missing: FidelityCode) => {
    if (!part) return fail(missing, ref);
    for (const code of differences(original, part.text)) fail(code, ref);
  };
  const byRef = (parts: CheckedPart[], ref: string) => parts.find((p) => p.ref === ref);

  // Apollo's answer, explanation, reason and method.
  if (lock.headline) evidence(ex.brief.ref === "headline" ? ex.brief : null, lock.headline, "headline", "STATEMENT_DROPPED");
  if (lock.explanation) evidence(ex.explanation, lock.explanation, "explanation", "STATEMENT_DROPPED");
  if (lock.reason) evidence(ex.importance?.ref === "reason" ? ex.importance : null, lock.reason, "reason", "STATEMENT_DROPPED");
  if (lock.how) evidence(ex.how, lock.how, "how", "STATEMENT_DROPPED");

  // Every finding, in order, with who established it and how firmly.
  const refs = ex.findings.map((f) => f.ref);
  lock.findings.forEach((f, i) => {
    const part = byRef(ex.findings, `finding:${i}`);
    evidence(part, f.text, `finding:${i}`, "FINDING_DROPPED");
    if (part && part.detail !== findingDetail(f)) fail("BASIS_CHANGED", `finding:${i}`);
  });
  if (refs.join() !== lock.findings.map((_, i) => `finding:${i}`).join()) fail(ex.findings.length === lock.findings.length ? "FINDING_ORDER" : "FINDING_DROPPED", "finding");
  lock.uncertainties.forEach((u, i) => evidence(byRef(ex.limitation, `uncertain:${i}`), u, `uncertain:${i}`, "UNCERTAINTY_DROPPED"));
  lock.actions.forEach((a, i) => evidence(byRef(ex.action, `action:${i}`), a, `action:${i}`, "ACTION_DROPPED"));

  // What Luddish added: only the state's approved wording, never stronger or weaker, never an identifier.
  const allowed = ruleWording(lock.state, lock.blockedBy);
  const rules = [ex.brief, ...ex.meaning, ex.importance, ...ex.limitation, ...ex.action].filter((p): p is CheckedPart => !!p && p.source === "rule");
  for (const part of rules) {
    if (!allowed.has(part.text) || STATE_RULES[lock.state].never.some((w) => count(part.text, w))) fail("STATE_WORDING", part.ref);
    if (identifiers(part.text).size) fail("IDENTIFIER_ADDED", part.ref);
  }
  if (ex.noAction && !allowed.has(ex.noAction)) fail("STATE_WORDING", "noAction");
  if (ex.noAction && lock.actions.length) fail("STATE_WORDING", "noAction");

  // Knowledge explains evidence; it never becomes evidence.
  const locked = new Set(lockedTexts(lock).flatMap((t) => sentences(t)).map(norm));
  const evidenceParts = [ex.brief, ex.explanation, ...ex.findings, ex.importance, ...ex.limitation, ...ex.action, ex.how]
    .filter((p): p is CheckedPart => !!p && p.source === "evidence");
  for (const part of evidenceParts) {
    if (sentences(part.text).some((s) => KNOWN_SENTENCES.has(norm(s)) && !locked.has(norm(s)))) fail("KNOWLEDGE_AS_EVIDENCE", part.ref);
  }
  for (const part of [...evidenceParts, ...rules]) if (part.note && !approvedNote(part.note, lock.state)) fail("NOTE_NOT_APPROVED", part.ref);
  for (const t of ex.terms) if (!MEANINGS.has(t.meaning)) fail("NOTE_NOT_APPROVED", "terms");
  for (const k of ex.knowledge) if (!KNOWLEDGE_TEXTS.includes(k.brief) || !KNOWLEDGE_TEXTS.includes(k.explain)) fail("NOTE_NOT_APPROVED", "knowledge");

  // The technical detail is the locked wording itself.
  if (ex.technical.map((t) => t.text).join("\u0000") !== lockedTexts(lock).join("\u0000")) fail("TECHNICAL_ALTERED", "technical");
  return { status: failures.length ? "FAIL" : "PASS", failures };
}

// Who established a finding, and how firmly — fixed words, never reworded.
const BASIS_TEXT: Record<string, string> = { observed: "Seen directly by {by}", inferred: "{by}'s reading of the evidence, not seen directly", reported: "From what you told Apollo", recorded: "Recorded by {by}" };
const CONFIDENCE_TEXT: Record<string, string> = { high: "High confidence", medium: "Medium confidence", low: "Low confidence" };
const RAISED_TEXT: Record<string, string> = { this_device: "this device's earlier cases", previous_reports: "ApolloSG's previous reports" };

export function findingDetail(f: EvidenceLock["findings"][number]): string {
  const raised = (f.raisedBy ?? []).map((r) => RAISED_TEXT[r]);
  return [BASIS_TEXT[f.basis].replace("{by}", f.by ?? "Apollo"), f.confidence ? CONFIDENCE_TEXT[f.confidence] : null,
    raised.length ? `Confidence raised by ${raised.join(" and ")} (not evidence)` : null].filter(Boolean).join(" · ");
}
