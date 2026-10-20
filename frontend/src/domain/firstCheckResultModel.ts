// Device Check (Higgins First Check / Re-check) → the universal Check Result model, so the result is
// shown on the one dedicated Check Results screen every other Apollo check uses.
//
// Rules this mapper enforces:
//  • ONE overall result. The headline and Higgins' explanation come from the report's own overall
//    state — no second summary is generated.
//  • A check that could not run is never a pass: NOT_AVAILABLE → "not performed", ERROR → "error".
//  • ONE action. The single most severe check that actually has an action supplies it; the remaining
//    per-check actions stay with their item, under details.
//  • Platform limitations are reported as evidence rows, not hidden.

import type { CheckItem, CheckResultModel, CheckStatus } from "./checkResult.ts";
import {
  FIRST_CHECK_COPY,
  platformName,
  type FirstCheckCapabilityResult,
  type FirstCheckReport,
  type FirstCheckResultState,
} from "./firstCheck.ts";

const ITEM_STATUS: Record<FirstCheckResultState, CheckStatus> = {
  PASS: "clear",
  INFORMATION: "clear",
  CAUTION: "concern",
  SUSPICIOUS: "concern",
  CONFIRMED_THREAT: "concern",
  NOT_AVAILABLE: "not_performed",
  ERROR: "error",
};

/** Severity order used to pick the single action that matters most. */
const ACTION_RANK: Record<FirstCheckResultState, number> = {
  CONFIRMED_THREAT: 5, SUSPICIOUS: 4, CAUTION: 3, ERROR: 2, NOT_AVAILABLE: 1, INFORMATION: 0, PASS: 0,
};

/** Where Apollo can send the person for the one action, when a destination genuinely exists. */
export type DeviceCheckActionRoute = { label: string; route: string } | null;

const ROUTE_FOR_CHECK: Record<string, DeviceCheckActionRoute> = {
  apollo_integrity: { label: "Restore protection", route: "/(tabs)/protection" },
  security_rules: { label: "Restore protection", route: "/(tabs)/protection" },
  connection: { label: "Check my internet", route: "/network" },
  network_config: { label: "Review device settings", route: "/device" },
  application_risk: { label: "Review device settings", route: "/device" },
  install_sources: { label: "Review device settings", route: "/device" },
  os_security: { label: "Review device settings", route: "/device" },
  device_integrity: { label: "Review device settings", route: "/device" },
};

export interface DeviceCheckResult {
  model: CheckResultModel;
  /** The single in-app destination for the one action, or null when only Settings/the person can act. */
  actionRoute: DeviceCheckActionRoute;
}

function itemFinding(c: FirstCheckCapabilityResult): string {
  const parts = [c.explanation];
  if (c.evidence) parts.push(`Observed: ${c.evidence}`);
  if (c.platformLimitation) parts.push(`Couldn't check: ${c.platformLimitation}`);
  if (c.action) parts.push(`What to do: ${c.action}`);
  return parts.join(" ");
}

export function deviceCheckResult(
  report: FirstCheckReport,
  kind: "first_check" | "re_check",
  headlineOverride?: string,
): DeviceCheckResult {
  const copy = FIRST_CHECK_COPY[report.overall];
  const items: CheckItem[] = report.checks.map((c) => ({
    id: c.id,
    name: c.title,
    status: ITEM_STATUS[c.result],
    finding: itemFinding(c),
    raw: c.evidenceRef ? { evidence_reference: c.evidenceRef, result: c.result, confidence: c.confidence } : undefined,
  }));

  // The one action: most severe check that actually carries one.
  const actionable = report.checks
    .filter((c) => !!c.action)
    .sort((a, b) => ACTION_RANK[b.result] - ACTION_RANK[a.result])[0] ?? null;
  const actionRoute = actionable ? ROUTE_FOR_CHECK[actionable.id] ?? null : null;

  const executed = report.checks.filter((c) => c.executed).length;
  const notRun = report.checks.filter((c) => !c.executed);

  const evidence = [
    { label: "Device", value: platformName(report.platform) },
    { label: "Checks run", value: `${executed} of ${report.checks.length}` },
    ...(report.capabilityNote ? [{ label: "What this device allows", value: report.capabilityNote }] : []),
    ...notRun.map((c) => ({ label: `Not checked — ${c.title}`, value: c.platformLimitation ?? c.explanation })),
    ...report.checks
      .filter((c) => c.executed && c.evidence)
      .map((c) => ({ label: c.title, value: c.evidence as string })),
  ];

  const model: CheckResultModel = {
    id: `device-check:${report.checkedAt}`,
    gate: "Device Re-check",
    checkType: kind === "re_check" ? "Device re-check" : "First device check",
    subject: platformName(report.platform),
    headline: copy.title,
    higginsSays: headlineOverride ?? copy.headline,
    // "sniffing" is a working state, never a finished result — a finished check reports its outcome.
    tone: copy.dogState === "sniffing" ? "ears_up" : copy.dogState,
    items,
    confidence: report.overall === "LIMITED_CHECK" || report.overall === "ERROR" ? "Low" : "High",
    whatToDo: actionable?.action ?? undefined,
    evidence,
    completedAt: report.checkedAt,
  };

  return { model, actionRoute };
}
