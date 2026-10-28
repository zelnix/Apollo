// Higgins Luddish L1 — typed questions about a word ("What is phishing?", "What does DMARC mean?"). Answered on the
// phone from the Luddish Dictionary and Knowledge Library only, with the knowledge labelled as general knowledge and
// where it comes from. No AI, no network, no case evidence. ApolloSG's own names (Apollo, Higgins, Magnum DI …) are
// left to Higgins' own replies. Pure: no React, no native imports.
import { lookupTerm, type LuddishTerm } from "./dictionary.ts";
import { knowledgeFor } from "./knowledge.ts";

const TERM_QUESTION = /^(?:(?:so|ok|okay|and|hey|hi)\s*,?\s+)?(?:higgins\s*,?\s+)?(?:what(?:'s|’s| is| are| does| do)|whats|explain|define|meaning of|what do you mean by|tell me about)\s+(.+?)(?:\s+(?:mean|stand for))?\s*[?.!]*$/i;

/** The dictionary term a typed question asks about, when the whole question names one. */
export function askedTerm(question: string): LuddishTerm | null {
  const m = question.trim().match(TERM_QUESTION);
  if (!m) return null;
  const term = lookupTerm(m[1]);
  return term && term.category !== "apollosg" ? term : null;
}

export const GENERAL_KNOWLEDGE = (publisher: string) => `General knowledge from ${publisher}, not a finding about anything you've checked:`;
export const CHECK_PROMPT = "If you've received something like this, tap + and add it, and Apollo will check it.";

/** The approved meaning, what an acronym stands for, and the background from the Knowledge Library. */
export function explainTerm(term: LuddishTerm): string {
  const paragraphs = [term.meaning];
  if (term.acronym && term.stands) paragraphs.push(`${term.acronym} stands for ${term.stands}.`);
  const entry = knowledgeFor([term.id])[0];
  if (entry) {
    paragraphs.push([GENERAL_KNOWLEDGE(entry.source.publisher), entry.explain, entry.howItWorks ? `How it works: ${entry.howItWorks}` : null,
      entry.whyItMatters ? `Why it matters: ${entry.whyItMatters}` : null].filter(Boolean).join("\n"));
  }
  paragraphs.push(CHECK_PROMPT);
  return paragraphs.join("\n\n");
}
