// The Higgins Case Briefing, projected for each surface: Home, Threats, the Overview and notifications all read the
// SAME briefing (backend services/higgins/explain/briefing.py), so they can't say different things about one case.
// DI stays the technical trace and Evidence the original material. Pure: no React Native, unit-tested in node.
import type { CaseBriefing, HigginsResponse } from "../investigation/types";
import { evidenceModel } from "./evidenceModel.ts";
import { sentences } from "./luddish/patterns.ts";
import { outcomeLabel, outcomeTone } from "./messageVoice.ts";
import type { ApolloState, PatrolEvent } from "./types";

/** What a Patrol event carries of its case's briefing (device-local, never synced). */
export interface EventBriefing {
  /** "Stoko email checked". */
  headline: string;
  /** '"hello@stoko.com" is a published Stoko contact. No scam warning was found for "stoko.com".' */
  summary: string;
  subject: string | null;
  /** Every finding, its subject always named, in Apollo's order. */
  findings: string[];
  unresolved: string[];
  status: string;
  statusReason: string;
  /** "Needs you" only when this is true AND actionReason is a concrete reason. */
  userActionRequired: boolean;
  actionReason: string | null;
  recommendedAction: { label: string; instruction: string } | null;
  /** "briefing": the server's checked Case Briefing. "response": an older result that has none — only the
   *  authoritative fields are projected (attention, its reason, what isn't certain), nothing is reworded. */
  from: "briefing" | "response";
}

const clean = (text: string | null | undefined) => (text ?? "").replace(/\s+/g, " ").trim();

/** The briefing projection for a committed result. An older result without a briefing projects its authoritative
 *  fields only: a decision is owed only at an action-level attention with its recorded reason, or Magnum DI's
 *  pending question with its reason. */
export function eventBriefing(response: HigginsResponse): EventBriefing | null {
  const b: CaseBriefing | null | undefined = response.briefing;
  if (b && b.fidelity?.status === "PASS") {
    const reason = clean(b.actionReason);
    return {
      headline: clean(b.headline), summary: clean(b.summary), subject: b.subject?.value ?? null,
      findings: b.findings.map((f) => clean(f.finding)).filter(Boolean), unresolved: b.unresolved.map(clean).filter(Boolean),
      status: b.status, statusReason: clean(b.statusReason),
      userActionRequired: b.userActionRequired && !!reason, actionReason: reason || null,
      recommendedAction: b.recommendedAction, from: "briefing",
    };
  }
  const actionLevel = response.attention === "action_needed" || response.attention === "urgent";
  const reason = actionLevel ? clean(response.attentionReason)
    : response.completion === "waiting_user" ? clean(response.question?.reasonNeeded) : "";
  const recommended = response.actions.find((a) => a.id === response.recommendedActionId) ?? response.actions[0] ?? null;
  return {
    headline: "", summary: "", subject: null, findings: [], unresolved: response.uncertainties.map(clean).filter(Boolean),
    status: "", statusReason: clean(response.attentionReason),
    userActionRequired: !!reason, actionReason: reason || null,
    recommendedAction: recommended ? { label: recommended.label, instruction: recommended.instruction } : null, from: "response",
  };
}

const BARKING = (e: PatrolEvent) => e.state === "barking" || (e.state === "biting" && !e.verified_block);

/** "Needs you", strictly. With a case: only when its briefing says a decision is owed AND names the concrete
 *  reason. Without one (Apollo's own on-device decision, no investigation): only a Barking record this device made
 *  itself with its reason and next step recorded. A server placeholder, a review, or "keeping watch" never is. */
export function needsYou(event: PatrolEvent): boolean {
  if (event.resolved_at || event.status === "resolved" || event.status === "trusted") return false;
  if (event.verified_block && event.enforcement_evidence) return false; // Blocked: Apollo already acted
  const b = event.case_briefing;
  if (b) return b.userActionRequired && !!clean(b.actionReason);
  const investigation = event.investigation_case_id ?? event.patrol_record?.investigationCaseId;
  if (investigation) return false; // still investigating, or answered without a recorded decision
  const model = evidenceModel(event);
  const serverHeld = model.representation === "privacy_summary" || model.representation === "privacy_protected_copy";
  return BARKING(event) && !serverHeld && model.completeness !== "partial"
    && !!clean(event.why?.[0]) && !!clean(event.what_to_do);
}

/** The event's checked Case Briefing, when it has one to show (a headline and a summary); null otherwise. Every
 *  case-result surface reads the briefing through this. */
export function briefed(event: PatrolEvent | undefined): EventBriefing | null {
  const b = event?.case_briefing;
  return b && b.from === "briefing" && b.headline && b.summary ? b : null;
}

/** The briefing's first finding (its subject always named): the short form Home and notifications show. */
export function firstFinding(b: EventBriefing): string {
  return (sentences(b.summary)[0] ?? b.summary).trim();
}

/** Apollo's case outcome as the person sees it ("Likely scam") and its tone: the briefing's status, or for a result
 *  recorded before briefings, the label of its recorded outcome. Never worked out from anything else. */
export function caseOutcome(response: HigginsResponse | null | undefined): { label: string | null; tone: ReturnType<typeof outcomeTone> } {
  const b = response?.briefing?.fidelity?.status === "PASS" ? response.briefing : null;
  const code = b ? b.statusCode : response?.outcome;
  return { label: (b?.status || null) ?? outcomeLabel(code), tone: outcomeTone(code) };
}

/** How serious the result is: the attention its Case Briefing recorded, or for a result recorded before briefings,
 *  the attention the result recorded. Never worked out from anything else. */
export function caseSeverity(response: HigginsResponse | null | undefined): ApolloState | null {
  if (!response) return null;
  const b = response.briefing?.fidelity?.status === "PASS" ? response.briefing : null;
  const attention = b?.attention ?? response.attention;
  return attention === "urgent" || attention === "action_needed" ? "barking" : attention === "review" ? "growling" : "resting";
}

/** Title and summary for a case card (Home and Threats): the briefing's when there is one, else what Apollo recorded. */
export function caseCardText(event: PatrolEvent, fallbackTitle: string): { title: string; summary: string | null } {
  const b = briefed(event);
  return b ? { title: b.headline, summary: b.summary } : { title: fallbackTitle, summary: null };
}
