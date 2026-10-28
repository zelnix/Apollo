// Call Gate adapter — turns a `CallAnalysis` (from domain/callAnalysis) into the universal
// `CheckResultModel`. ONE Higgins paragraph, assembled from the real evidence.
// Technical detail stays in `evidence`. Pure, no React.

import type { CallAnalysis, CallAsk, CallClaim } from "./callAnalysis";
import type { CheckItem, CheckResultModel, EvidenceRow } from "./checkResult";
import type { ActionLink } from "./checkResult";
import type { PatrolEvent } from "./types";
import type { OfficialVerdict } from "./officialContacts";
import { toneForState, buildEvidenceRows, appendEventContext, buildCheckResult } from "./checkResultFramework";
import { ACTION_LINKS } from "./actionRegistry";
import { GATE_REGISTRY } from "./gateRegistry";

const CLAIM_LABEL: Record<CallClaim, string> = {
  bank: "your bank", government: "a government agency", techsupport: "tech support",
  family: "a family member", telco: "your telco", business: "a business", delivery: "a delivery company",
  investment: "an investment firm", relationship: "someone you met online", unknown: "an unnamed caller",
};

const ASK_LABEL: Record<CallAsk, string> = {
  transfer: "Transfer money", code: "Give a verification code", password: "Give a password / PIN",
  install: "Install an app", remote: "Allow remote access", giftcards: "Buy gift cards",
  crypto: "Send cryptocurrency", screen: "Share my screen", bankdetails: "Give bank / card details",
  dont_hangup: "Stay on the line / tell no one", refund: "Accept a refund", subscription: "Cancel a renewal",
  callback: "Call a number back", nothing: "Nothing unusual", other: "Something else",
};


/** Derive confidence from the evidence quality of the call analysis, not just the final state.
 *  High: strong direct indicators (known scam asks like remote access + transfer, multiple
 *  high-risk requested actions). Medium: credible circumstantial signals (single suspicious ask,
 *  claimed identity with urgency). Low: limited evidence or ordinary call. */
function confidenceFromEvidence(a: CallAnalysis): CheckResultModel["confidence"] {
  const HIGH_RISK_ASKS: CallAsk[] = ["transfer", "remote", "giftcards", "crypto", "screen", "bankdetails"];
  const dangerousAsks = a.requestedActions.filter((ask) => HIGH_RISK_ASKS.includes(ask));
  if (dangerousAsks.length >= 2) return "High";
  if (dangerousAsks.length === 1 && a.claimedBrand) return "High";
  if (dangerousAsks.length === 1 || a.requestedActions.includes("code") || a.requestedActions.includes("password")) return "Medium";
  return "Low";
}

/** Build the universal Check Result model for a Call Gate manual check. */
export function buildCallCheckResult(args: {
  analysis: CallAnalysis;
  event: PatrolEvent | null;
  number: string;
  transcript: string;
  /** The Official Organisation Directory's verdict on the number, against the organisation the caller claimed. */
  official?: OfficialVerdict[] | null;
}): CheckResultModel {
  const { analysis: a, event, number, transcript } = args;
  const subject = number.trim() || CLAIM_LABEL[a.claimedBrand as CallClaim] || "Unknown caller";

  const items: CheckItem[] = [];

  // What the caller asked for
  items.push({
    id: "call:asks",
    name: "What they asked",
    status: a.requestedActions.some((ask) => ask !== "nothing" && ask !== "other") ? "concern" : "clear",
    finding: a.requestedActions.map((ask) => ASK_LABEL[ask] ?? ask).join(", ") || "Nothing unusual reported.",
    raw: { requestedActions: a.requestedActions },
  });

  // Who they claim to be
  items.push({
    id: "call:claim",
    name: "Claimed identity",
    status: a.claimedBrand || a.requestedActions.some((x) => x !== "nothing") ? "incomplete" : "clear",
    finding: a.claimedBrand
      ? `Caller claims to be ${a.claimedBrand}. Caller ID is not proof of identity.`
      : "Caller did not claim to represent a specific organisation.",
  });

  // Caller number reputation
  items.push({
    id: "call:number",
    name: "Caller number",
    status: number.trim() ? "incomplete" : "not_performed",
    finding: number.trim()
      ? `Number: ${number}. Live reputation lookup is not available in this build.`
      : "No caller number was supplied.",
  });

  // What the caller said
  if (transcript.trim()) {
    items.push({
      id: "call:transcript",
      name: "What the caller said",
      status: a.state === "barking" || a.state === "growling" ? "concern" : "clear",
      finding: "What the caller said was analysed for scam patterns.",
      raw: { excerpt: transcript.slice(0, 500) },
    });
  }

  // Threat Scent correlation
  if (a.basis.some((b) => b.includes("Threat Scent"))) {
    items.push({
      id: "call:scent",
      name: "Threat Scent correlation",
      status: "incomplete",
      finding: "Apollo checked recent events from other gates for connected threats.",
    });
  }

  // Higgins paragraph — evidence-grounded, 2–4 sentences.
  let higginsSays: string;
  let whatToDo: string | undefined;
  if (a.state === "barking" || a.state === "biting") {
    higginsSays = `${a.verdict} ${a.why[0] ?? ""}`;
    whatToDo = a.recommendation;
  } else if (a.state === "growling" || a.state === "ears_up") {
    higginsSays = `${a.verdict} ${a.why.length > 1 ? a.why[1] : a.why[0] ?? ""}`.trim();
    whatToDo = a.recommendation;
  } else {
    higginsSays = `${a.verdict} Apollo didn't detect a known scam pattern from what you described, but caller ID alone is never proof of identity.`;
    whatToDo = undefined;
  }

  // Actionable links — help the person report scam calls or take protective action.
  const whatToDoLinks: ActionLink[] = [];
  if (a.state === "barking" || a.state === "growling") {
    whatToDoLinks.push(ACTION_LINKS.ftc_report_fraud);
    whatToDoLinks.push(ACTION_LINKS.fcc_complaint);
  }

  // Evidence rows — shared utility handles filtering and event context.
  const evidence = buildEvidenceRows([
    { label: "Caller", value: number.trim() || "Not supplied" },
    { label: "Claims to be", value: a.claimedBrand ?? CLAIM_LABEL["unknown"] },
    { label: "Scenario", value: `${a.scenario} — ${a.title}` },
    { label: "Basis", value: a.basis.join("; ") },
    { label: "Description supplied", value: transcript.trim() ? "Yes" : null },
    { label: "Verify independently", value: a.verifyCaller },
  ]);
  appendEventContext(evidence, { eventId: event?.event_id });

  return { ...buildCheckResult({
    gate: GATE_REGISTRY.call.checkResultGate,
    checkType: GATE_REGISTRY.call.defaultCheckType,
    subject,
    headline: a.verdict,
    higginsSays,
    state: a.state,
    items,
    confidence: confidenceFromEvidence(a),
    whatToDo,
    whatToDoLinks,
    evidence,
    event,
  }), official: args.official };
}
