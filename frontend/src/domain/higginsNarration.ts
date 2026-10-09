// Higgins' narration — turns a Patrol event or an incident timeline into short spoken chunks, in order, so a person
// who prefers listening hears the whole story: what happened, why Apollo reacted, what to do, step by step.
// ARCHITECTURAL RULE: Higgins ONLY narrates real evidence. When the event carries privacy-projected
// server text (not originating-device detail), Higgins says so honestly instead of inventing a narrative.
import { CATEGORY_LABEL, type IncidentPlan } from "./incidentPlan.ts";
import { type PatrolEvent, STATE_LABEL, STATE_MEANING } from "./types.ts";

const ORDINAL = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];
const ord = (i: number) => ORDINAL[i] ?? `number ${i + 1}`;
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const strip = (h: string) => h.replace(/^(Email|App|Device|Account|Network|Message|Call|File|Link|Website): /, "");

export interface NarrationChunk { id: string; label: string; text: string }

// ── Evidence completeness — structural check, not text matching ──
// An event has usable evidence when it was created on the local device with real findings.
// Server-projected or incomplete events must be narrated honestly — never as real evidence.
// This uses the explicit `evidence_provenance` field, NOT sentence pattern matching.
export function hasLocalEvidence(e: PatrolEvent): boolean {
  return e.evidence_provenance === "local_device";
}

/** One event, read in order: state → what happened → why → what to do (→ contained).
 *  When content is incomplete (not from this device), Higgins says so honestly. */
export function narrateEvent(e: PatrolEvent): NarrationChunk[] {
  const incomplete = !hasLocalEvidence(e);
  const chunks: NarrationChunk[] = [
    { id: "state", label: "Apollo's behaviour", text: `Higgins here. ${STATE_LABEL[e.state]}. ${STATE_MEANING[e.state]}` },
  ];
  if (incomplete) {
    chunks.push({ id: "what", label: "What happened", text: "The full evidence for this check is only available on the device where it happened. I can't narrate what I don't have." });
    chunks.push({ id: "why", label: "Why Apollo reacted", text: "The reason Apollo reacted is recorded on the originating device." });
    chunks.push({ id: "todo", label: "What to do", text: "Open this on the device where the check happened for the recommended action." });
  } else {
    chunks.push({ id: "what", label: "What happened", text: `What happened: ${strip(e.headline)}. ${e.what_happened}` });
    if (e.why.length) {
      const reasons = e.why.map((w, i) => `${ord(i)}, ${w.replace(/\.$/, "")}`).join(". ");
      chunks.push({ id: "why", label: "Why Apollo reacted", text: `Why Apollo reacted: ${reasons}.` });
    } else {
      chunks.push({ id: "why", label: "Why Apollo reacted", text: "Apollo found no specific warning signs." });
    }
    chunks.push({ id: "todo", label: "What to do", text: `What to do: ${e.what_to_do}` });
  }
  if (e.status !== "active") chunks.push({ id: "done", label: "Handled", text: e.state === "biting" && e.verified_block ? "This threat was blocked and is contained. Nothing further is needed." : "You've marked this one handled. Well done." });
  return chunks;
}

/** A whole incident: summary → each event in order → the Stay With Me plan, step by step, noting ticks.
 *  Events with projected/incomplete content are narrated honestly. */
export function narrateIncident(plan: IncidentPlan, ticked: Record<string, boolean> = {}): NarrationChunk[] {
  const n = plan.timeline.length;
  const chunks: NarrationChunk[] = [{
    id: "summary", label: "The incident",
    text: `Higgins here. ${plan.headline}. ${STATE_LABEL[plan.state]}. Apollo connected ${n} event${n > 1 ? "s" : ""} because they happened close together and point at the same target.${plan.exposure.length ? ` You reported: ${plan.exposure.join("; ")}.` : ""}`,
  }];
  plan.timeline.forEach((e, i) => {
    const lead = i === 0 ? "It began" : i === n - 1 ? "Finally" : "Then";
    const incomplete = !hasLocalEvidence(e);
    if (incomplete) {
      chunks.push({ id: `event-${i}`, label: `${ord(i)} event`, text: `${lead}, at ${clock(e.occurred_at)}, ${CATEGORY_LABEL[e.category].toLowerCase()}: The detailed evidence for this event is only on the device where it happened.${e.status !== "active" ? " That one is handled." : ""}` });
    } else {
      chunks.push({ id: `event-${i}`, label: `${ord(i)} event`, text: `${lead}, at ${clock(e.occurred_at)}, ${CATEGORY_LABEL[e.category].toLowerCase()}: ${strip(e.headline)}. ${e.what_happened}${e.status !== "active" ? " That one is handled." : ""}` });
    }
  });
  if (plan.steps.length) {
    chunks.push({ id: "plan", label: "Stay with me", text: `Now, the plan. ${plan.steps.length} step${plan.steps.length > 1 ? "s" : ""}, starting with the most urgent. Say stop at any time.` });
    plan.steps.forEach((st, i) => chunks.push({ id: `step-${i}`, label: `Step ${i + 1}`, text: `Step ${i + 1}${ticked[st.id] ? ", already done" : ""}: ${st.text}` }));
    chunks.push({ id: "end", label: "That's all", text: plan.allResolved ? "You've marked this incident handled. Apollo keeps the record." : "That's everything. Tick the steps as you go, and do ask me if anything is unclear." });
  }
  return chunks;
}
