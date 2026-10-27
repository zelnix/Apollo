// The DI tab's decision path: Deterministic triage → TC FlyBy → Magnum DI → Higgins.
// Pure: every step is built from what was recorded (the Triage record, the case's routing and the Magnum DI
// transactions). A stage with no record says so — nothing is inferred. Diagnostic view: internal codes are
// kept here on purpose. The provider and model never appear.

import type { DiTrace, DiTransaction } from "./diTransaction.ts";
import { outcomeLabel } from "./messageVoice.ts";
import { outcomeLabel as triageOutcomeLabel, type TriageInvestigationRecord } from "./triage/contract.ts";

export type TraceStatus = "ran" | "settled" | "escalated" | "not_engaged" | "failed" | "simulated" | "pending" | "not_recorded";

export interface TraceStep {
  id: "triage" | "flyby" | "magnum" | "higgins";
  name: string;
  status: TraceStatus;
  label: string;
  summary: string;
  details: string[];
}

export const TRACE_ORDER = "Deterministic triage → TC FlyBy → Magnum DI → Higgins";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const isFlyby = (answeredBy: string | null | undefined) => (answeredBy ?? "").startsWith("teddy");

/** Whether a Magnum DI transaction finished with an answer. */
export function diSucceeded(record: DiTransaction): boolean {
  return !record.failureCode && (record.status ?? "success") === "success";
}

function triageStep(triage: TriageInvestigationRecord | null, hasCase: boolean): TraceStep {
  const name = "Deterministic triage";
  if (!triage) return { id: "triage", name, status: "not_recorded", label: "No record", summary: "No deterministic Triage record is stored for this case.", details: [] };
  const gaps = triage.coverageGaps.map((g) => g.code);
  return {
    id: "triage", name, status: "ran", label: triageOutcomeLabel(triage),
    summary: `${triage.rulesChecked.length} of ${triage.rulesApplicable.length} applicable rules checked, ${triage.rulesMet.length} met`
      + `${gaps.length ? `, ${plural(gaps.length, "coverage gap")}` : ""}`
      + `${triage.incompleteChecks?.length ? `, ${plural(triage.incompleteChecks.length, "incomplete check")}` : ""}. `
      + (hasCase ? "An investigation was opened." : "Stopped here — Magnum DI was not engaged."),
    details: [
      `Outcome: ${triage.outcome}`,
      `Reason: ${triage.reason}`,
      ...(gaps.length ? [`Coverage gaps: ${gaps.join(", ")}`] : []),
      `Rule catalogue v${triage.catalogueVersion} · source ${triage.sourceType}`,
    ],
  };
}

function searchLine(flyby: NonNullable<DiTrace["flyby"]>): string {
  return `Web searches: ${flyby.searchCalls ?? 0} call(s) · ${flyby.searchQueries ?? 0} queries · ${flyby.cacheHits ?? 0} from saved results`;
}

function flybyStep(trace: DiTrace | null, hasCase: boolean): TraceStep {
  const name = "TC FlyBy";
  const flyby = trace?.flyby;
  if (!flyby) {
    return hasCase
      ? { id: "flyby", name, status: "not_recorded", label: "No record", summary: "No TC FlyBy record is stored for this case.", details: [] }
      : { id: "flyby", name, status: "not_engaged", label: "Not engaged", summary: "TC FlyBy was not engaged — Triage didn't open an investigation.", details: [] };
  }
  const reason = trace?.settledReason;
  const common = [
    `Message type: ${flyby.messageType ?? "not recorded"}`,
    `ApolloSG KB scam pattern: ${flyby.pattern ? `${flyby.pattern.key} · ${flyby.pattern.stage} match` : "no match"}`,
    `Checks planned: ${flyby.checks.length}`,
    searchLine(flyby),
  ];
  if (flyby.resolved) {
    return {
      id: "flyby", name, status: "settled", label: `Settled · ${outcomeLabel(flyby.outcome) ?? "result recorded"}`,
      summary: reason?.by === "TC FlyBy" ? reason.sentence : "TC FlyBy settled this case.",
      details: [`Outcome: ${flyby.outcome ?? "not recorded"} · basis ${flyby.basis ?? "not recorded"}`, ...(reason ? [`Rule: ${reason.ruleId}`] : []), ...common],
    };
  }
  return {
    id: "flyby", name, status: "escalated", label: "Escalated to Magnum DI",
    summary: reason?.by === "Magnum DI" ? reason.sentence : "TC FlyBy couldn't settle this case, so it passed it to Magnum DI.",
    details: [
      ...(reason ? [`Rule: ${reason.ruleId}`] : []),
      ...(flyby.issues ?? []).map((i) => `Needs ${i.capability}: ${i.text}`),
      ...common,
    ],
  };
}

function magnumStep(trace: DiTrace | null, records: DiTransaction[], hasCase: boolean): TraceStep {
  const name = "Magnum DI";
  const magnum = trace?.magnum;
  if (records.length) {
    const last = records[records.length - 1];
    const calls = records.reduce((n, r) => n + (r.processing.geminiCalls ?? 0), 0);
    const details = [
      `Status: ${last.status ?? "not recorded"}${last.failureCode ? ` (${last.failureCode})` : ""}`,
      `Magnum DI calls: ${calls} · records: ${records.length}`,
      ...(magnum ? [`Evidence items sent: ${magnum.itemsSent}`, `Web search: ${magnum.webSearch ? `on · ${magnum.searchQueries} queries` : "off"}`] : []),
    ];
    if (last.simulated) {
      return { id: "magnum", name, status: "simulated", label: "Simulated", details,
        summary: "Magnum DI ran exactly as in production; the preview stood in for the outside service Magnum DI calls." };
    }
    if (!diSucceeded(last)) {
      return { id: "magnum", name, status: "failed", label: "Didn't finish", details,
        summary: `Magnum DI was engaged but didn't finish (${last.failureCode ?? last.status ?? "reason not recorded"}).` };
    }
    return {
      id: "magnum", name, status: "ran", label: "Investigated", details,
      summary: magnum
        ? `Magnum DI investigated ${plural(magnum.itemsSent, "evidence item")} ${magnum.webSearch ? "with" : "without"} web search.`
        : "Magnum DI investigated the case.",
    };
  }
  if (trace?.flyby?.resolved) return { id: "magnum", name, status: "not_engaged", label: "Not engaged", summary: "Magnum DI was not engaged — TC FlyBy settled the case.", details: [] };
  if (!hasCase) return { id: "magnum", name, status: "not_engaged", label: "Not engaged", summary: "Magnum DI was not engaged.", details: [] };
  if (trace?.flyby) return { id: "magnum", name, status: "pending", label: "No record yet", summary: "Escalated to Magnum DI. No Magnum DI record is stored for this case yet.", details: [] };
  return { id: "magnum", name, status: "not_recorded", label: "No record", summary: "No Magnum DI record is stored for this case.", details: [] };
}

function higginsStep(trace: DiTrace | null, triage: TriageInvestigationRecord | null, hasCase: boolean): TraceStep {
  const name = "Higgins";
  const who = isFlyby(trace?.answeredBy) ? "TC FlyBy" : "Magnum DI";
  const higgins = trace?.higgins;
  if (higgins) {
    const details = [`Fidelity Check: ${higgins.status ?? "not recorded"} · mode ${higgins.mode ?? "not recorded"} · ${higgins.attempts ?? 0} attempt(s)`];
    if (higgins.status === "PASS") {
      return {
        id: "higgins", name, status: "ran", label: higgins.mode === "repaired" ? "Fidelity Check PASS (repaired)" : "Fidelity Check PASS", details,
        summary: higgins.mode === "repaired"
          ? `Higgins presented ${who}'s result in plain English; the parts that failed the first check are in Apollo's own wording.`
          : `Higgins presented ${who}'s result in plain English, and it passed the Fidelity Check.`,
      };
    }
    return { id: "higgins", name, status: "failed", label: "Fidelity Check FAIL", details,
      summary: `Higgins' plain English didn't pass the Fidelity Check, so ${who}'s own wording is shown.` };
  }
  if (trace?.answeredBy || trace?.outcome) {
    return { id: "higgins", name, status: "ran", label: "Presented", details: [],
      summary: `Higgins presented ${who}'s result in its own wording. No Fidelity Check is recorded.` };
  }
  if (!hasCase && triage) {
    return {
      id: "higgins", name, status: "ran", label: "Presented", details: [],
      summary: triage.outcome === "LIMITED_UNABLE_TO_DETERMINE"
        ? "Higgins explained the Triage result and advised treating it with caution — it is never shown as safe."
        : `Higgins explained the Triage result: ${triageOutcomeLabel(triage)}.`,
    };
  }
  return { id: "higgins", name, status: "pending", label: "Not yet", summary: "There's no result for Higgins to present yet.", details: [] };
}

export function buildDecisionTrace(input: { trace: DiTrace | null; records: DiTransaction[]; triage: TriageInvestigationRecord | null; hasCase: boolean }): TraceStep[] {
  const { trace, records, triage, hasCase } = input;
  return [triageStep(triage, hasCase), flybyStep(trace, hasCase), magnumStep(trace, records, hasCase), higginsStep(trace, triage, hasCase)];
}
