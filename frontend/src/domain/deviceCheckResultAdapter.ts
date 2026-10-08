// Device Gate adapter — turns a `DeviceReview` (from domain/deviceReview) into the universal
// `CheckResultModel`. The Device Gate is a dashboard-style review, so the mapping is broader:
// each check-category outcome becomes a CheckItem. Pure, no React.

import { type DeviceReview, type CheckResult as DeviceCheckResult, OUTCOME_LABEL, overallState, groupByCategory, CATEGORY_LABEL, type SecurityCategory } from "./deviceReview";
import type { CheckItem, CheckResultModel, EvidenceRow } from "./checkResult";

function statusForOutcome(outcome: string): CheckItem["status"] {
  if (outcome === "checked") return "clear";
  if (outcome === "review") return "incomplete";
  if (outcome === "action") return "concern";
  if (outcome === "manual") return "incomplete";
  if (outcome === "unavailable") return "not_performed";
  return "not_performed";
}

function toneForOverall(overall: string): CheckResultModel["tone"] {
  if (overall === "action") return "barking";
  if (overall === "review") return "growling";
  if (overall === "manual") return "ears_up";
  if (overall === "clear") return "resting";
  return "neutral";
}

function confidenceForOverall(overall: string): CheckResultModel["confidence"] {
  if (overall === "action") return "High";
  if (overall === "review") return "Medium";
  return "Low";
}

/** Build the universal Check Result model for a Device Gate security review. */
export function buildDeviceCheckResult(args: {
  review: DeviceReview;
  submissionId: string;
}): CheckResultModel {
  const { review: r, submissionId } = args;

  // Group checks by category, one CheckItem per individual check.
  const items: CheckItem[] = [];
  const groups = groupByCategory(r);
  for (const group of groups) {
    for (const check of group.results) {
      items.push({
        id: `device:${check.id}`,
        name: check.title,
        status: statusForOutcome(check.outcome),
        finding: check.risk
          ? `${check.risk}${check.remediation ? " " + check.remediation : ""}`
          : check.evidence,
        raw: check.settings ? { settings: check.settings, category: group.label } : { category: group.label },
      });
    }
  }

  // Higgins paragraph.
  const higginsSays = r.summary;
  const whatToDo = r.overall === "action" || r.overall === "review"
    ? r.results
        .filter((c) => c.outcome === "action" || c.outcome === "review")
        .map((c) => c.remediation)
        .filter(Boolean)
        .slice(0, 3)
        .join(" ")
    : r.overall === "manual"
      ? `${r.coverage.needsManual} setting${r.coverage.needsManual === 1 ? " needs" : "s need"} a manual review — tap each one and Higgins will guide you.`
      : undefined;

  // Evidence rows.
  const evidence: EvidenceRow[] = [];
  evidence.push({ label: "Platform", value: r.osLabel });
  evidence.push({ label: "Checked at", value: r.checkedAt });
  evidence.push({ label: "Overall", value: r.overallLabel });
  evidence.push({ label: "Coverage", value: `${r.coverage.automated} automated / ${r.coverage.total} applicable (${r.coverage.needsManual} manual)` });
  for (const check of r.results.filter((c) => c.outcome !== "not_applicable")) {
    evidence.push({ label: check.title, value: `${OUTCOME_LABEL[check.outcome]} — ${check.evidence}` });
  }

  return {
    id: submissionId,
    gate: "Device Gate",
    checkType: "Device security review",
    subject: r.osLabel,
    headline: r.overallLabel,
    higginsSays,
    tone: toneForOverall(r.overall),
    items,
    confidence: confidenceForOverall(r.overall),
    whatToDo,
    evidence,
    completedAt: r.checkedAt,
    investigationId: null,
  };
}
