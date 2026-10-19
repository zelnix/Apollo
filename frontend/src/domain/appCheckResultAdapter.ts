// App Gate adapter — turns an `AppAnalysis` (from domain/appAnalysis) into the universal
// `CheckResultModel`. ONE Higgins paragraph from the real evidence. Pure, no React.
//
// Feature-specific analysis logic stays here. Shared mechanics come from checkResultFramework.

import type { AppAnalysis, PERMISSION_INFO } from "./appAnalysis";
import type { CheckItem, CheckResultModel, EvidenceRow } from "./checkResult";
import type { ActionLink } from "./checkResult";
import type { PatrolEvent } from "./types";
import { toneForState, buildEvidenceRowsFromTechnical, appendEventContext, buildCheckResult } from "./checkResultFramework";
import { ACTION_LINKS } from "./actionRegistry";
import { GATE_REGISTRY } from "./gateRegistry";

/** Derive confidence from evidence quality, not just the final state.
 *  High: strong direct evidence — scenario A01 (remote during call), A16 (remote during bank call),
 *  brand impersonation on sideloaded app (A03), or confirmed malicious connections (A14).
 *  Medium: credible circumstantial signals — remote capability, sideloaded with unexpected permissions.
 *  Low: limited evidence, official-store app with no strong concerns. */
function confidenceFromEvidence(a: AppAnalysis): CheckResultModel["confidence"] {
  const highScenarios = ["A01", "A16", "A03", "A03b", "A14", "A01b"];
  if (highScenarios.includes(a.scenario) || (a.remoteCapable && a.state === "barking")) return "High";
  const medScenarios = ["A02", "A04", "A05", "A06", "A07", "A08", "A09", "A10", "A15", "A19"];
  if (medScenarios.includes(a.scenario) || a.remoteCapable || a.riskScore >= 50) return "Medium";
  return "Low";
}

export function buildAppCheckResult(args: {
  analysis: AppAnalysis;
  event: PatrolEvent | null;
  appName: string;
  submissionId: string;
}): CheckResultModel {
  const { analysis: a, event, appName, submissionId } = args;
  const subject = appName || "Unknown app";

  // ── Feature-specific analysis (stays in this adapter) ──

  const items: CheckItem[] = [];

  // Unexpected permissions
  const unexpected = a.permissionNotes.filter((p) => !p.expected);
  if (unexpected.length) {
    items.push({
      id: "app:permissions",
      name: `Unexpected permissions (${unexpected.length})`,
      status: unexpected.length >= 3 || a.state === "barking" ? "concern" : "incomplete",
      finding: unexpected.map((p) => p.label).join(", ") + " — more than this type of app typically needs.",
      raw: { permissions: unexpected.map((p) => ({ id: p.id, label: p.label, plain: p.plain })) },
    });
  }
  if (a.permissionNotes.filter((p) => p.expected).length) {
    items.push({
      id: "app:expected-perms",
      name: "Expected permissions",
      status: "clear",
      finding: a.permissionNotes.filter((p) => p.expected).map((p) => p.label).join(", ") + " — normal for this type of app.",
    });
  }

  // Source
  const sourceTech = a.technical.find((t) => t.startsWith("Source:"));
  if (sourceTech) {
    const isOfficial = sourceTech.includes("Apple App Store") || sourceTech.includes("Google Play");
    items.push({
      id: "app:source",
      name: "Install source",
      status: isOfficial ? "clear" : "concern",
      finding: sourceTech.replace("Source: ", ""),
    });
  }

  // Remote access
  if (a.remoteCapable) {
    items.push({
      id: "app:remote",
      name: "Remote access capable",
      status: "concern",
      finding: "This app can let someone else see or control your screen.",
    });
  }

  // Brand impersonation
  if (a.claimedBrand) {
    items.push({
      id: "app:brand",
      name: "Brand in name",
      status: a.state === "barking" ? "concern" : "incomplete",
      finding: `App name contains "${a.claimedBrand}". A brand in the name is not proof of authenticity.`,
    });
  }

  // Risk score
  items.push({
    id: "app:risk",
    name: "Risk assessment",
    status: a.riskScore >= 70 ? "concern" : a.riskScore >= 40 ? "incomplete" : "clear",
    finding: `Apollo's risk score: ${a.riskScore}/100. Based on source, permissions, timing and context.`,
  });

  // Higgins paragraph
  const higginsSays = `${a.verdict} ${a.why[0] ?? ""}`.trim();

  // Actionable links from the canonical registry
  const whatToDoLinks: ActionLink[] = [];
  if (a.state === "barking" || a.state === "growling") {
    whatToDoLinks.push(ACTION_LINKS.google_play_report);
    whatToDoLinks.push(ACTION_LINKS.apple_app_store_report);
  }

  // ── Shared mechanics (from checkResultFramework) ──

  const evidence = buildEvidenceRowsFromTechnical(a.technical);
  appendEventContext(evidence, { scenario: `${a.scenario} — ${a.title}`, eventId: event?.event_id });

  return buildCheckResult({
    gate: GATE_REGISTRY.app.checkResultGate,
    checkType: GATE_REGISTRY.app.defaultCheckType,
    subject,
    headline: a.title,
    higginsSays,
    state: a.state,
    items,
    confidence: confidenceFromEvidence(a),
    whatToDo: a.recommendation,
    whatToDoLinks,
    evidence,
    event,
    investigationId: submissionId,
  });
}
