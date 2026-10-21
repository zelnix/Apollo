// The case must say what the investigation actually found.
//
// The server keeps nothing: a completed investigation is committed to this device and the server copy
// is purged immediately, so the server's patrol projection can only ever carry the "Apollo is
// investigating this" placeholder. Without this, every investigated case stays on that placeholder
// while the real answer sits in device storage — general statements instead of the findings.
//
// This turns the stored result into the case's own content: the overview, the findings, the
// recommended action and the severity the investigation actually reached. Pure and unit-tested.
import type { DeviceInvestigation } from "../investigation/deviceStore";
import type { ApolloState, PatrolEvent } from "./types";

/** The severity the investigation reached — never higher than what it concluded. */
export function investigationState(assessment: string, attention: string): ApolloState {
  if (assessment === "concern_found") return attention === "urgent" || attention === "action_needed" ? "barking" : "growling";
  if (assessment === "uncertain") return attention === "urgent" || attention === "action_needed" ? "barking" : "ears_up";
  return "resting";
}

/** First sentence of the overview — the specific statement, not a category name. */
export function headlineFrom(overview: string): string {
  const clean = overview.replace(/\s+/g, " ").trim();
  const sentence = clean.split(/(?<=[.!?])\s/)[0] ?? clean;
  return (sentence.length > 160 ? `${sentence.slice(0, 157)}…` : sentence) || clean.slice(0, 160);
}

/** The overview with its headline sentence removed — the card already shows that sentence as the
 *  title, so repeating it in the body says the same thing twice. Falls back to the full overview
 *  when the conclusion is a single sentence and there is nothing else to show. */
export function bodyFrom(overview: string): string {
  const clean = overview.replace(/\s+/g, " ").trim();
  const [first, ...rest] = clean.split(/(?<=[.!?])\s/);
  const body = rest.join(" ").trim();
  return body && first.length <= 160 ? body : clean;
}

function actionFrom(inv: DeviceInvestigation): string {
  const response = inv.response;
  const actions = response.actions ?? [];
  const recommended = response.recommendedActionId
    ? actions.find((a) => a.id === response.recommendedActionId)
    : undefined;
  const chosen = recommended ?? actions[0];
  if (chosen?.instruction?.trim()) return chosen.instruction.trim();
  if (response.assessment === "no_concern_found_within_scope") return "Nothing to do — nothing in what you submitted needs action.";
  return "Review the findings above and verify anything you are unsure of directly with the organisation.";
}

/** The patch that makes an event carry its investigation's actual result, or null when there is
 *  nothing to change (no stored response, or the event already carries this revision). */
export function investigationPatch(event: PatrolEvent, inv: DeviceInvestigation | null): PatrolEvent | null {
  const response = inv?.response;
  if (!inv || !response || !response.overview?.trim()) return null;
  if (event.resolved_at && event.status === "trusted") return null;

  const findings = (response.findings ?? []).map((f) => f.text.trim()).filter(Boolean).slice(0, 6);
  const overview = response.overview.replace(/\s+/g, " ").trim();
  const state = investigationState(response.assessment, response.attention);
  const whatToDo = actionFrom(inv);
  const headline = headlineFrom(overview);
  const whatHappened = bodyFrom(overview);

  // Already applied — same findings and same conclusion, so nothing to write.
  const unchanged = event.headline === headline
    && event.what_happened === whatHappened
    && JSON.stringify(event.why ?? []) === JSON.stringify(findings)
    && event.what_to_do === whatToDo
    && event.state === state
    && event.investigation_completed_at === inv.committedAt;
  if (unchanged) return null;

  return {
    ...event,
    state,
    // A finished investigation leaves the case open unless it found nothing at all.
    status: event.status === "blocked" || event.status === "trusted" ? event.status : state === "resting" ? "resolved" : "active",
    resolved_at: state === "resting" ? event.resolved_at ?? inv.committedAt : event.resolved_at,
    headline,
    what_happened: whatHappened,
    why: findings.length ? findings : event.why,
    what_to_do: whatToDo,
    // The result is held on this device; it is this device's own record.
    evidence_provenance: "local_device",
    investigation_case_id: event.investigation_case_id ?? inv.caseId,
    // Magnum DI has answered — the case is no longer "investigating".
    investigation_completed_at: inv.committedAt,
  };
}
