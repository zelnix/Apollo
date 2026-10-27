// Higgins' narration — turns a Patrol event or an incident timeline into short spoken chunks, in order, so a person
// who prefers listening hears the whole story: what happened, why Apollo reacted, what to do, step by step.
// ARCHITECTURAL RULE: Higgins ONLY narrates real evidence. When the record holds only the privacy-protected summary
// ApolloSG's servers keep, Higgins says what Apollo has and what it couldn't verify — never where another copy might be.
// OPERATING STANDARD: Higgins is an authoritative cybersecurity expert. He investigates, assesses, directs
// and guides. Narration uses decisive, protective language — never passive advice or vague suggestions.
import { hasRecordedFindings, triageShortfalls } from "./caseFacts.ts";
import { CATEGORY_LABEL, type IncidentPlan } from "./incidentPlan.ts";
import { LIMITED_TODO } from "./triage/contract.ts";
import { type PatrolEvent, STATE_LABEL, STATE_MEANING } from "./types.ts";

const ORDINAL = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
const ord = (i: number) => ORDINAL[i] ?? `number ${i + 1}`;
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const strip = (h: string) => h.replace(/^(Email|App|Device|Account|Network|Message|Call|File|Link|Website): /, "");

export interface NarrationChunk { id: string; label: string; text: string }

const SUMMARY_ONLY = "ApolloSG holds only a privacy-protected summary of this check: the kind of check and its result, not the content that was checked.";
const CONCERN = new Set(["barking", "biting", "growling", "ears_up"]);

/** What to do when only the summary is recorded: caution for a concern, never an invented instruction. */
const summaryTodo = (e: PatrolEvent) => CONCERN.has(e.state) && !e.verified_block
  ? LIMITED_TODO : "Nothing in this summary needs action. A past check doesn't confirm current safety.";

/** One event, read in order: state → what happened → why → what to do (→ what couldn't be verified → contained).
 *  When the record holds only the privacy summary, Higgins says exactly that and adds nothing.
 *  When evidence exists, Higgins directs: tells the user exactly what to do. */
export function narrateEvent(e: PatrolEvent): NarrationChunk[] {
  const chunks: NarrationChunk[] = [
    { id: "state", label: "Apollo's finding", text: `Higgins here. Apollo found something. ${STATE_LABEL[e.state]}. ${STATE_MEANING[e.state]}` },
  ];
  if (!hasRecordedFindings(e)) {
    chunks.push({ id: "what", label: "What happened", text: `${SUMMARY_ONLY} I can't give you a specific instruction from a summary.` });
    chunks.push({ id: "why", label: "Why this matters", text: "The summary doesn't record Apollo's reasons, so I won't guess at them." });
    chunks.push({ id: "todo", label: "What to do", text: summaryTodo(e) });
  } else {
    chunks.push({ id: "what", label: "What happened", text: `Here's what Apollo found: ${strip(e.headline)}. ${e.what_happened}` });
    if (e.why.length) {
      const reasons = e.why.map((w, i) => `${ord(i)}, ${w.replace(/\.$/, "")}`).join(". ");
      chunks.push({ id: "why", label: "Why this matters", text: `This matters because: ${reasons}.` });
    } else {
      chunks.push({ id: "why", label: "Assessment", text: "Apollo found no specific warning signs. No action needed on this one." });
    }
    chunks.push({ id: "todo", label: "What to do", text: `Here's what to do: ${e.what_to_do}` });
    // What Apollo couldn't verify, with the recorded reason. It narrows the result; it isn't a concern itself.
    const unverified = triageShortfalls(e.triage_investigation);
    if (unverified.length) chunks.push({ id: "unverified", label: "What couldn't be verified", text: `Apollo couldn't verify everything: ${unverified.map((r) => `${r.name}, ${r.status}. ${r.reason}`).join(" ")}` });
  }
  if (e.status !== "active") chunks.push({ id: "done", label: "Handled", text: e.state === "biting" && e.verified_block ? "This threat is blocked and contained. Apollo stopped it. Nothing further is needed." : "This one is handled. Well done." });
  return chunks;
}

/** A whole incident: summary → each event in order → the Stay With Me plan, step by step, noting ticks.
 *  Events with projected/incomplete content are narrated honestly.
 *  The narration follows directive guidance: tells the user exactly what to do at each step. */
export function narrateIncident(plan: IncidentPlan, ticked: Record<string, boolean> = {}): NarrationChunk[] {
  const n = plan.timeline.length;
  const chunks: NarrationChunk[] = [{
    id: "summary", label: "The incident",
    text: `Higgins here. Apollo found something that needs your attention. ${plan.headline}. ${STATE_LABEL[plan.state]}. Apollo connected ${n} event${n > 1 ? "s" : ""} because they happened close together and point at the same target.${plan.exposure.length ? ` You reported: ${plan.exposure.join("; ")}.` : ""} Follow my lead.`,
  }];
  plan.timeline.forEach((e, i) => {
    const lead = i === 0 ? "It started" : i === n - 1 ? "The latest" : "Then";
    if (!hasRecordedFindings(e)) {
      chunks.push({ id: `event-${i}`, label: `${ord(i)} event`, text: `${lead}, at ${clock(e.occurred_at)}, ${CATEGORY_LABEL[e.category].toLowerCase()}: ApolloSG holds only a privacy-protected summary of this one — ${STATE_LABEL[e.state].toLowerCase()}.${e.status !== "active" ? " That one is already handled." : ""}` });
    } else {
      chunks.push({ id: `event-${i}`, label: `${ord(i)} event`, text: `${lead}, at ${clock(e.occurred_at)}, ${CATEGORY_LABEL[e.category].toLowerCase()}: ${strip(e.headline)}. ${e.what_happened}${e.status !== "active" ? " That one is already handled." : ""}` });
    }
  });
  if (plan.steps.length) {
    chunks.push({ id: "plan", label: "Follow my lead", text: `Here's what we're going to do. ${plan.steps.length} step${plan.steps.length > 1 ? "s" : ""}, starting with the most important. I'll walk you through each one.` });
    plan.steps.forEach((st, i) => chunks.push({ id: `step-${i}`, label: `Step ${i + 1}`, text: `Step ${i + 1}${ticked[st.id] ? ", already done" : ""}: ${st.text}` }));
    chunks.push({ id: "end", label: "That's all", text: plan.allResolved ? "Everything is handled. ApolloSG keeps the record for reference." : "That covers everything. Work through each step and tick them off as you go. Ask me if anything is unclear." });
  }
  return chunks;
}
