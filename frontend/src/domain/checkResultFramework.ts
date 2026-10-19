/**
 * Shared Check Result Framework.
 *
 * Common plumbing for all Check Result adapters: tone mapping, evidence row
 * building, result construction, timestamps, IDs, confidence contracts.
 *
 * Each gate's analyser stays specialised but uses this framework for the
 * mechanical parts. No adapter should duplicate toneForState, evidence row
 * formatting, or result field assembly.
 *
 * Architecture rule: a fact can appear in many places, but Apollo should
 * decide that fact in only one place.
 */

import type { CheckResultModel, EvidenceRow, ActionLink, CheckItem, Confidence } from "./checkResult";
import type { PatrolEvent, ApolloState } from "./types";

// ── Tone mapping (ONE implementation) ────────────────────────────────────────

/** Map an ApolloState to the check-result tone.
 *  This is the ONLY toneForState function in the codebase. */
export function toneForState(state: ApolloState | string | undefined): CheckResultModel["tone"] {
  if (state === "biting") return "biting";
  if (state === "barking") return "barking";
  if (state === "growling") return "growling";
  if (state === "ears_up") return "ears_up";
  if (state === "resting") return "resting";
  return "neutral";
}

// ── Evidence row building (ONE implementation) ───────────────────────────────

/** Build evidence rows from label/value pairs, filtering out empty values. */
export function buildEvidenceRows(pairs: Array<{ label: string; value: string | null | undefined }>): EvidenceRow[] {
  return pairs
    .filter((p): p is { label: string; value: string } => p.value != null && p.value.trim() !== "")
    .map((p) => ({ label: p.label, value: p.value }));
}

/** Build evidence rows from a technical-string array ("Label: value" format). */
export function buildEvidenceRowsFromTechnical(technical: string[]): EvidenceRow[] {
  return technical.map((t) => {
    const colonIdx = t.indexOf(":");
    if (colonIdx > 0 && colonIdx < t.length - 1) {
      return { label: t.slice(0, colonIdx).trim(), value: t.slice(colonIdx + 1).trim() };
    }
    return { label: "Detail", value: t };
  });
}

/** Append scenario and event ID rows to an evidence array (if present). */
export function appendEventContext(
  evidence: EvidenceRow[],
  opts: { scenario?: string | null; eventId?: string | null },
): void {
  if (opts.scenario) evidence.push({ label: "Scenario", value: opts.scenario });
  if (opts.eventId) evidence.push({ label: "Event id", value: `${opts.eventId.slice(0, 8)}\u2026` });
}

// ── Result construction (shared plumbing) ────────────────────────────────────

export interface CheckResultInput {
  gate: CheckResultModel["gate"];
  checkType: string;
  subject: string;
  headline: string;
  higginsSays: string;
  state: ApolloState | string;
  items: CheckItem[];
  confidence: Confidence;
  whatToDo?: string;
  whatToDoLinks?: ActionLink[];
  evidence: EvidenceRow[];
  event?: PatrolEvent | null;
  investigationId?: string | null;
}

/** Build a complete CheckResultModel from the shared input contract. */
export function buildCheckResult(input: CheckResultInput): CheckResultModel {
  return {
    id: input.event?.event_id ?? input.investigationId ?? `check-${Date.now().toString(36)}`,
    gate: input.gate,
    checkType: input.checkType,
    subject: input.subject,
    headline: input.headline,
    higginsSays: input.higginsSays,
    tone: toneForState(input.state),
    items: input.items,
    confidence: input.confidence,
    whatToDo: input.whatToDo,
    whatToDoLinks: input.whatToDoLinks?.length ? input.whatToDoLinks : undefined,
    evidence: input.evidence,
    completedAt: new Date().toISOString(),
    investigationId: input.event?.event_id ?? input.investigationId ?? null,
  };
}
