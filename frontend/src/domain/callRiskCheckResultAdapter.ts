// Call Guard (number reputation) adapter — turns a `CallRiskResult` into the universal
// `CheckResultModel`. ONE Higgins paragraph from the real evidence. Pure, no React.

import type { CheckItem, CheckResultModel, EvidenceRow } from "./checkResult";

interface CallRiskResult {
  number: string; valid: boolean | null; active: boolean | null; fraud_score: number | null;
  recent_abuse: boolean | null; risky: boolean | null; voip: boolean | null;
  line_type: string | null; carrier: string | null; country: string | null;
  decision: "allow" | "review" | "avoid"; cached: boolean; checked_at: string;
  source: "ipqualityscore" | "not_configured";
  higgins: { headline: string; found: string; why: string; could_not_establish: string; next_action: string; exact_response: string; warning_only: boolean };
}

export function buildCallRiskCheckResult(args: { result: CallRiskResult }): CheckResultModel {
  const r = args.result;

  const tone: CheckResultModel["tone"] = r.decision === "avoid" ? "barking" : r.decision === "review" ? "growling" : "resting";
  const confidence: CheckResultModel["confidence"] = r.decision === "avoid" ? "High" : r.decision === "review" ? "Medium" : "Low";

  const items: CheckItem[] = [];

  // Fraud score
  if (r.fraud_score !== null) {
    items.push({
      id: "risk:score",
      name: "Fraud score",
      status: r.fraud_score >= 75 ? "concern" : r.fraud_score >= 40 ? "incomplete" : "clear",
      finding: `Reputation score: ${r.fraud_score}/100.${r.fraud_score >= 75 ? " This is high — numbers above 75 are frequently associated with fraud." : r.fraud_score >= 40 ? " Moderate — exercise caution." : " Low risk from reputation data."}`,
    });
  }

  // Line type
  if (r.line_type) {
    items.push({
      id: "risk:line",
      name: "Line type",
      status: r.voip ? "incomplete" : "clear",
      finding: `${r.line_type}${r.voip ? " (VOIP — easy to spoof or dispose)" : ""}${r.carrier ? ` · ${r.carrier}` : ""}`,
    });
  }

  // Recent abuse
  if (r.recent_abuse !== null) {
    items.push({
      id: "risk:abuse",
      name: "Recent abuse reports",
      status: r.recent_abuse ? "concern" : "clear",
      finding: r.recent_abuse ? "This number has recent abuse reports from other services." : "No recent abuse reports found.",
    });
  }

  // Validity
  if (r.valid !== null) {
    items.push({
      id: "risk:valid",
      name: "Number validity",
      status: r.valid ? "clear" : "concern",
      finding: r.valid ? `Active: ${r.active === true ? "yes" : r.active === false ? "no" : "unknown"}${r.country ? ` · Country: ${r.country}` : ""}` : "This number may not be a valid phone number.",
    });
  }

  // Provider status
  if (r.source === "not_configured") {
    items.push({
      id: "risk:provider",
      name: "Reputation provider",
      status: "not_performed",
      finding: "No reputation provider is configured. This result is based on limited local signals only.",
    });
  }

  const higginsSays = r.higgins.headline + " " + r.higgins.found;
  const whatToDo = r.higgins.next_action;

  const evidence: EvidenceRow[] = [];
  evidence.push({ label: "Number", value: r.number });
  if (r.fraud_score !== null) evidence.push({ label: "Fraud score", value: `${r.fraud_score}/100` });
  if (r.line_type) evidence.push({ label: "Line type", value: r.line_type });
  if (r.carrier) evidence.push({ label: "Carrier", value: r.carrier });
  if (r.voip !== null) evidence.push({ label: "VOIP", value: r.voip ? "Yes" : "No" });
  if (r.country) evidence.push({ label: "Country", value: r.country });
  evidence.push({ label: "Source", value: r.source });
  evidence.push({ label: "Checked at", value: r.checked_at });
  if (r.higgins.why) evidence.push({ label: "Why", value: r.higgins.why });
  if (r.higgins.could_not_establish) evidence.push({ label: "Could not establish", value: r.higgins.could_not_establish });

  return {
    id: `callrisk-${Date.now().toString(36)}`,
    gate: "Call Gate",
    checkType: "Caller reputation check",
    subject: r.number,
    headline: r.higgins.headline,
    higginsSays,
    tone,
    items,
    confidence,
    whatToDo,
    evidence,
    completedAt: r.checked_at,
    investigationId: null,
  };
}
