// Call Guard (number reputation) adapter — turns a `CallRiskResult` into the universal
// `CheckResultModel`. ONE Higgins paragraph from the real evidence. Pure, no React.

import type { ActionLink, CheckItem, CheckResultModel, EvidenceRow } from "./checkResult";

interface CallRiskResult {
  number: string; valid: boolean | null; active: boolean | null; fraud_score: number | null;
  recent_abuse: boolean | null; risky: boolean | null; voip: boolean | null;
  line_type: string | null; carrier: string | null; country: string | null;
  decision: "allow" | "review" | "avoid"; cached: boolean; checked_at: string;
  source: "ipqualityscore" | "not_configured";
  higgins: { headline: string; found: string; why: string; could_not_establish: string; next_action: string; exact_response: string; warning_only: boolean };
}

/** Format a raw phone number (e.g. "+15550101234") into a readable display string
 *  (e.g. "+1 (555) 010-1234"). Handles common international formats. */
function formatPhoneDisplay(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, "");
  // US/CA: +1XXXXXXXXXX → +1 (XXX) XXX-XXXX
  const usMatch = digits.match(/^\+?1(\d{3})(\d{3})(\d{4})$/);
  if (usMatch) return `+1 (${usMatch[1]}) ${usMatch[2]}-${usMatch[3]}`;
  // AU: +61XXXXXXXXX → +61 XXX XXX XXX
  const auMatch = digits.match(/^\+?(61)(\d{3})(\d{3})(\d{3})$/);
  if (auMatch) return `+${auMatch[1]} ${auMatch[2]} ${auMatch[3]} ${auMatch[4]}`;
  // UK: +44XXXXXXXXXX → +44 XXXX XXXXXX
  const ukMatch = digits.match(/^\+?(44)(\d{4})(\d{6})$/);
  if (ukMatch) return `+${ukMatch[1]} ${ukMatch[2]} ${ukMatch[3]}`;
  // Generic international: group digits in threes after country code
  if (digits.startsWith("+") && digits.length > 5) {
    const cc = digits.slice(0, digits.length > 12 ? 3 : digits.length > 11 ? 2 : 2);
    const rest = digits.slice(cc.length);
    return `${cc} ${rest.replace(/(\d{3,4})(?=\d)/g, "$1 ").trim()}`;
  }
  return raw; // return as-is if we can't parse
}

/** Format an ISO timestamp into a human-readable date + time string. */
function formatCheckedAt(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      weekday: "short", day: "numeric", month: "short", year: "numeric",
      hour: "numeric", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function buildCallRiskCheckResult(args: { result: CallRiskResult }): CheckResultModel {
  const r = args.result;
  const displayNumber = formatPhoneDisplay(r.number);
  const displayTime = formatCheckedAt(r.checked_at);

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

  // Actionable links — give the person a direct way to report or act.
  const whatToDoLinks: ActionLink[] = [];
  // Voicemail — always useful after checking a missed call number.
  whatToDoLinks.push({ label: "Listen to your voicemail", url: "tel:*86" });
  if (r.decision === "avoid" || r.decision === "review") {
    whatToDoLinks.push({ label: "Report fraud to the FTC", url: "https://reportfraud.ftc.gov" });
    whatToDoLinks.push({ label: "File a complaint with the FCC", url: "https://consumercomplaints.fcc.gov/hc/en-us" });
  }
  if (r.country === "US" || !r.country) {
    whatToDoLinks.push({ label: "Look up this number on the National Do Not Call Registry", url: "https://www.donotcall.gov" });
  }

  const evidence: EvidenceRow[] = [];
  evidence.push({ label: "Number", value: displayNumber });
  evidence.push({ label: "Checked", value: displayTime });
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
    subject: displayNumber,
    headline: r.higgins.headline,
    higginsSays,
    tone,
    items,
    confidence,
    whatToDo,
    whatToDoLinks: whatToDoLinks.length ? whatToDoLinks : undefined,
    evidence,
    completedAt: r.checked_at,
    investigationId: null,
  };
}
