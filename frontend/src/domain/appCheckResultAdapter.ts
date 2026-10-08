// App Gate adapter — turns an `AppAnalysis` (from domain/appAnalysis) into the universal
// `CheckResultModel`. ONE Higgins paragraph from the real evidence. Pure, no React.

import type { AppAnalysis, PERMISSION_INFO } from "./appAnalysis";
import type { CheckItem, CheckResultModel, EvidenceRow } from "./checkResult";
import type { PatrolEvent } from "./types";

function toneForState(state: string): CheckResultModel["tone"] {
  if (state === "biting") return "biting";
  if (state === "barking") return "barking";
  if (state === "growling") return "growling";
  if (state === "ears_up") return "ears_up";
  if (state === "resting") return "resting";
  return "neutral";
}

function confidenceForState(state: string): CheckResultModel["confidence"] {
  if (state === "barking" || state === "biting") return "High";
  if (state === "growling") return "Medium";
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
      finding: `App name contains \"${a.claimedBrand}\". A brand in the name is not proof of authenticity.`,
    });
  }

  // Risk score
  items.push({
    id: "app:risk",
    name: "Risk assessment",
    status: a.riskScore >= 70 ? "concern" : a.riskScore >= 40 ? "incomplete" : "clear",
    finding: `Apollo's risk score: ${a.riskScore}/100. Based on source, permissions, timing and context.`,
  });

  // Higgins paragraph.
  const higginsSays = `${a.verdict} ${a.why[0] ?? ""}`.trim();
  const whatToDo = a.recommendation;

  // Evidence rows.
  const evidence: EvidenceRow[] = a.technical.map((t) => {
    const colonIndex = t.indexOf(":");
    if (colonIndex > 0 && colonIndex < 30) {
      return { label: t.slice(0, colonIndex).trim(), value: t.slice(colonIndex + 1).trim() };
    }
    return { label: "Detail", value: t };
  });
  evidence.push({ label: "Scenario", value: `${a.scenario} — ${a.title}` });
  if (event) evidence.push({ label: "Event id", value: `${event.event_id.slice(0, 8)}…` });

  return {
    id: submissionId,
    gate: "App Gate",
    checkType: "App check",
    subject,
    headline: a.title,
    higginsSays,
    tone: toneForState(a.state),
    items,
    confidence: confidenceForState(a.state),
    whatToDo,
    evidence,
    completedAt: new Date().toISOString(),
    investigationId: event?.event_id ?? null,
  };
}
