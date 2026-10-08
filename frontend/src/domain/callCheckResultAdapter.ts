// Call Gate adapter — turns a `CallAnalysis` (from domain/callAnalysis) into the universal
// `CheckResultModel`. ONE Higgins paragraph, assembled from the real evidence.
// Technical detail stays in `evidence`. Pure, no React.

import type { CallAnalysis, CallAsk, CallClaim } from "./callAnalysis";
import type { CheckItem, CheckResultModel, EvidenceRow } from "./checkResult";
import type { PatrolEvent } from "./types";

const CLAIM_LABEL: Record<CallClaim, string> = {
  bank: "your bank", government: "a government agency", techsupport: "tech support",
  family: "a family member", telco: "your telco", business: "a business",
  investment: "an investment firm", relationship: "someone you met online", unknown: "an unnamed caller",
};

const ASK_LABEL: Record<CallAsk, string> = {
  transfer: "Transfer money", code: "Give a verification code", password: "Give a password / PIN",
  install: "Install an app", remote: "Allow remote access", giftcards: "Buy gift cards",
  crypto: "Send cryptocurrency", screen: "Share my screen", bankdetails: "Give bank / card details",
  dont_hangup: "Stay on the line / tell no one", refund: "Accept a refund", subscription: "Cancel a renewal",
  callback: "Call a number back", nothing: "Nothing unusual", other: "Something else",
};

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

/** Build the universal Check Result model for a Call Gate manual check. */
export function buildCallCheckResult(args: {
  analysis: CallAnalysis;
  event: PatrolEvent | null;
  number: string;
  transcript: string;
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

  // Voicemail / transcript analysis
  if (transcript.trim()) {
    items.push({
      id: "call:transcript",
      name: "Voicemail / transcript",
      status: a.state === "barking" || a.state === "growling" ? "concern" : "clear",
      finding: "A transcript or voicemail was provided and analysed for scam patterns.",
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

  // Evidence rows for the expandable "Full investigation details".
  const evidence: EvidenceRow[] = [];
  evidence.push({ label: "Caller", value: number.trim() || "Not supplied" });
  evidence.push({ label: "Claims to be", value: a.claimedBrand ?? CLAIM_LABEL["unknown"] });
  evidence.push({ label: "Scenario", value: `${a.scenario} — ${a.title}` });
  evidence.push({ label: "Basis", value: a.basis.join("; ") });
  if (transcript.trim()) evidence.push({ label: "Transcript supplied", value: "Yes" });
  evidence.push({ label: "Verify independently", value: a.verifyCaller });
  if (event) {
    evidence.push({ label: "Event id", value: `${event.event_id.slice(0, 8)}…` });
  }

  return {
    id: event?.event_id ?? `call-${Date.now().toString(36)}`,
    gate: "Call Gate",
    checkType: "Call check",
    subject,
    headline: a.verdict,
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
