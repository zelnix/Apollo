// Higgins Luddish L1 — the question buttons on each result. Five questions, from the plainest answer to the deepest:
//   What does this mean? → Why does it matter? → How sure is Higgins? → What should I do? → Show the technical detail.
// Every answer comes only from the composed explanation (compose.ts): its checked plain wording, the recorded state's
// approved wording (rules.ts), the dictionary's meanings and the Knowledge Library, which is always labelled as general
// knowledge and never shown as a finding. A question is offered only when its answer adds something the screen doesn't
// already say. "Show the technical detail" is Apollo's locked wording exactly as recorded, with who established each
// piece; Luddish only puts its plain wording beside a piece it reworded, never in place of it.
// Pure: no React, no native imports.
import { alreadySaid, type LuddishExplanation, type LuddishPart } from "./compose.ts";
import type { KnowledgeEntry } from "./knowledge.ts";
import { STATE_RULES } from "./rules.ts";

export type QuestionId = "meaning" | "matters" | "sure" | "todo" | "technical";
export const QUESTIONS: readonly { id: QuestionId; label: string }[] = [
  { id: "meaning", label: "What does this mean?" },
  { id: "matters", label: "Why does it matter?" },
  { id: "sure", label: "How sure is Higgins?" },
  { id: "todo", label: "What should I do?" },
  { id: "technical", label: "Show the technical detail" },
];

export interface AnswerItem {
  text: string;
  /** What the piece is ("Finding", "Result"). */
  label?: string | null;
  /** Who established it and how firmly, or how many findings share it. */
  detail?: string | null;
  /** Technical detail only: Luddish's plain wording of this piece, when it reworded it. */
  plain?: string | null;
  /** Technical detail only: the plain note beside this piece. */
  note?: string | null;
}
export interface AnswerSection {
  /** plain: Higgins' plain words; words: the dictionary's meanings; knowledge: general knowledge (with its source);
   *  technical: Apollo's own wording, untouched. */
  kind: "plain" | "words" | "knowledge" | "technical";
  heading: string | null;
  items: AnswerItem[];
  /** Where general knowledge comes from (knowledge sections only). */
  source?: string | null;
}
export interface ResultQuestion { id: QuestionId; label: string; sections: AnswerSection[] }

/** At most this many words explained, and knowledge entries given, in one answer. */
const MAX_TERMS = 4;
const MAX_KNOWLEDGE = 2;

export const TECHNICAL_HEADING = "Apollo's own wording, exactly as recorded";

export function resultQuestions(ex: LuddishExplanation, shown: readonly (string | null | undefined)[] = []): ResultQuestion[] {
  const screen = shown.filter((s): s is string => !!s && !!s.trim());
  /** The texts not already on the screen, each once. */
  const fresh = (texts: (string | null | undefined)[]): string[] => {
    const out: string[] = [];
    for (const t of texts) if (t && !alreadySaid(t, [...screen, ...out])) out.push(t);
    return out;
  };
  const plain = (heading: string | null, texts: string[]): AnswerSection[] => texts.length ? [{ kind: "plain", heading, items: texts.map((text) => ({ text })) }] : [];
  const knowledge = (pick: (k: KnowledgeEntry) => string | undefined): AnswerSection[] => ex.knowledge
    .map((k) => ({ k, text: pick(k) })).filter((x): x is { k: KnowledgeEntry; text: string } => !!x.text && fresh([x.text]).length > 0)
    .slice(0, MAX_KNOWLEDGE).map(({ k, text }) => ({ kind: "knowledge", heading: k.title, items: [{ text }], source: k.source.publisher }));
  const rule = STATE_RULES[ex.state];

  // What does this mean? The recorded state's meaning, the words used, and the background to them.
  const terms = ex.terms.filter((t) => !screen.some((s) => s.includes(t.meaning))).slice(0, MAX_TERMS);
  const meaning: AnswerSection[] = [
    ...plain(null, fresh(ex.meaning.map((p) => p.text))),
    ...(terms.length ? [{ kind: "words" as const, heading: "The words used", items: terms.map((t) => ({ text: t.meaning })) }] : []),
    ...knowledge((k) => k.explain),
  ];

  // Why does it matter? Why Apollo said it matters, then the state's approved reason, then the background.
  const matters: AnswerSection[] = [...plain(null, fresh([ex.importance?.text, rule.matters])), ...knowledge((k) => k.whyItMatters)];

  // How sure is Higgins? Higgins is only as sure as what was recorded: the result, how each finding was established,
  // and what isn't certain.
  const groups = new Map<string, number>();
  for (const f of ex.findings) if (f.detail) groups.set(f.detail, (groups.get(f.detail) ?? 0) + 1);
  const basis = [...groups].map(([text, n]) => ({ text, detail: `${n} finding${n === 1 ? "" : "s"}` }));
  const limits = fresh(ex.limitation.map((p) => p.text));
  const sure: AnswerSection[] = basis.length || limits.length || ex.confidence ? [
    { kind: "plain", heading: null, items: [{ label: "Result", text: ex.label, detail: `Recorded by ${ex.by}` }, ...(ex.confidence ? [{ label: "Confidence", text: ex.confidence }] : [])] },
    ...(basis.length ? [{ kind: "plain" as const, heading: "How each finding was established", items: basis }] : []),
    ...plain("What isn't certain", limits),
  ] : [];

  // What should I do? Apollo's steps not already shown, then the state's approved step; "nothing to do" only when
  // there's nothing to do.
  const recorded = ex.action.some((p) => p.source === "evidence");
  const steps = fresh([...ex.action.map((p) => p.text), recorded ? rule.action : null]);
  const todo = plain(null, steps.length ? steps : fresh([ex.noAction]));

  // Show the technical detail: the locked wording itself, never reworded.
  const parts = new Map([ex.brief, ex.explanation, ...ex.findings, ex.importance, ...ex.limitation, ...ex.action, ex.how]
    .filter((p): p is LuddishPart => !!p && p.source === "evidence").map((p) => [p.ref, p]));
  const technical: AnswerSection[] = ex.technical.length ? [{
    kind: "technical", heading: TECHNICAL_HEADING,
    items: ex.technical.map((t) => {
      const part = parts.get(t.ref);
      return { label: t.label, text: t.text, detail: t.detail ?? `Recorded by ${ex.by}`, plain: part && part.text !== t.text ? part.text : null, note: part?.note ?? null };
    }),
  }] : [];

  const answers: Record<QuestionId, AnswerSection[]> = { meaning, matters, sure, todo, technical };
  return QUESTIONS.filter((q) => answers[q.id].length).map((q) => ({ ...q, sections: answers[q.id] }));
}
