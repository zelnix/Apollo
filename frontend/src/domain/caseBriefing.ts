// The Higgins Case Briefing, projected for each surface: Home, Threats, the Overview and notifications all read the
// SAME briefing (backend services/higgins/explain/briefing.py), so they can't say different things about one case.
// DI stays the technical trace and Evidence the original material. Pure: no React Native, unit-tested in node.
import type { CaseBriefing, HigginsResponse } from "../investigation/types";
import type { PatrolEvent } from "./types";

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
  return BARKING(event) && event.evidence_provenance !== "server_projected" && event.evidence_provenance !== "incomplete"
    && !!clean(event.why?.[0]) && !!clean(event.what_to_do);
}

/** Title and summary for a case card (Home and Threats): the briefing's when there is one, else what Apollo recorded. */
export function caseCardText(event: PatrolEvent, fallbackTitle: string): { title: string; summary: string | null } {
  const b = event.case_briefing;
  if (b?.headline && b.summary) return { title: b.headline, summary: b.summary };
  return { title: fallbackTitle, summary: null };
}
