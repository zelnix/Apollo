// Text / Message Gate adapter — turns a `MessageAnalysis` (from domain/messageAnalysis) into the
// universal `CheckResultModel`. ONE Higgins paragraph from the real evidence. Pure, no React.

import type { MessageAnalysis } from "./messageAnalysis";
import type { CheckItem, CheckResultModel, EvidenceRow } from "./checkResult";
import type { ActionLink } from "./checkResult";
import type { PatrolEvent } from "./types";
import { toneForState } from "./checkResultFramework";
import { ACTION_LINKS } from "./actionRegistry";
import { GATE_REGISTRY } from "./gateRegistry";


function confidenceForState(state: string): CheckResultModel["confidence"] {
  if (state === "barking" || state === "biting") return "High";
  if (state === "growling") return "Medium";
  return "Low";
}

export function buildMessageCheckResult(args: {
  analysis: MessageAnalysis;
  event: PatrolEvent | null;
  sender: string;
  /** The explanation that came back from the Higgins backend, if any. */
  explanation: { summary?: string; why?: string[]; recommendation?: string } | null;
  /** Per-URL reputation results from the link check pass. */
  urlResults: { url: string; verdict: string }[];
  /** Reputation results for the telephone/mobile numbers found in the message itself. */
  phones?: { raw: string; decision: string; fraud_score: number | null }[];
}): CheckResultModel {
  const { analysis: a, event, sender, explanation, urlResults } = args;
  const phones = args.phones ?? [];
  const subject = sender.trim() || a.signals.claimedBrand || "Unknown sender";

  const items: CheckItem[] = [];

  // Claimed identity
  if (a.signals.claimedBrand) {
    items.push({
      id: "msg:brand",
      name: "Claimed identity",
      status: a.state === "barking" || a.state === "growling" ? "concern" : "incomplete",
      finding: `Message claims to be from ${a.signals.claimedBrand}. Message identity is not authenticated.`,
    });
  }

  // What the message asks
  if (a.signals.requestedAction) {
    items.push({
      id: "msg:ask",
      name: "What it asks",
      status: "concern",
      finding: `Asks you to: ${a.signals.requestedAction}.`,
    });
  }

  // Links found
  if (a.signals.urls.length) {
    const dangerous = urlResults.filter((r) => r.verdict === "malicious").length;
    items.push({
      id: "msg:links",
      name: `Links (${a.signals.urls.length})`,
      status: dangerous > 0 ? "concern" : "incomplete",
      finding: dangerous > 0
        ? `${dangerous} link${dangerous > 1 ? "s" : ""} confirmed dangerous.`
        : `${a.signals.urls.length} link${a.signals.urls.length > 1 ? "s" : ""} found. Check each with Apollo.`,
      raw: { urls: a.signals.urls },
    });
  }

  // Phone numbers inside the message, each checked against the caller-reputation service.
  if (phones.length) {
    const flagged = phones.filter((p) => p.decision === "avoid" || p.decision === "review");
    const unchecked = phones.filter((p) => p.decision === "unknown");
    items.push({
      id: "msg:phones",
      name: `Phone numbers (${phones.length})`,
      status: flagged.length ? "concern" : unchecked.length === phones.length ? "incomplete" : "clear",
      finding: flagged.length
        ? `${flagged.map((p) => `${p.raw} — ${p.decision === "avoid" ? "strong fraud or spam signals" : "some risk signals"}${p.fraud_score === null ? "" : ` (fraud score ${p.fraud_score}/100)`}`).join("; ")}.`
        : unchecked.length === phones.length
          ? `${phones.map((p) => p.raw).join(", ")} — reputation data was unavailable, so ${phones.length === 1 ? "it was" : "they were"} not checked.`
          : `${phones.map((p) => p.raw).join(", ")} — no fraud or abuse signals reported.`,
      raw: { phones },
    });
  }

  // Pressure signals
  const pressureSignals: string[] = [];
  if (a.signals.urgency) pressureSignals.push("Urgency");
  if (a.signals.threat) pressureSignals.push("Threat/penalty");
  if (a.signals.deadlineThreat) pressureSignals.push("Deadline");
  if (pressureSignals.length) {
    items.push({
      id: "msg:pressure",
      name: "Pressure tactics",
      status: "concern",
      finding: `Detected: ${pressureSignals.join(", ")}.`,
    });
  }

  // Sender reputation
  items.push({
    id: "msg:sender",
    name: "Sender",
    status: a.signals.unknownSender ? "incomplete" : "clear",
    finding: a.signals.unknownSender
      ? "Sender is unknown or unrecognised."
      : `Sender: ${sender.trim() || "not supplied"}.`,
  });

  // Higgins paragraph — prefer the backend explanation when available.
  const higginsSays = explanation?.summary ?? a.verdict;
  const whatToDo = explanation?.recommendation ?? a.recommendation;

  // Actionable links — help the person report scam messages.
  const whatToDoLinks: ActionLink[] = [];
  if (a.state === "barking" || a.state === "growling") {
    whatToDoLinks.push(ACTION_LINKS.fcc_stop_texts);
    whatToDoLinks.push(ACTION_LINKS.ftc_report_fraud);
  }

  // Evidence rows.
  const evidence: EvidenceRow[] = [];
  evidence.push({ label: "Scenario", value: `${a.scenario} — ${a.scenarioTitle}` });
  if (a.signals.claimedBrand) evidence.push({ label: "Claimed brand", value: a.signals.claimedBrand });
  if (a.signalLabels.length) evidence.push({ label: "Signals", value: a.signalLabels.join("; ") });
  const whyLines = explanation?.why?.length ? explanation.why : a.why;
  whyLines.forEach((w, i) => evidence.push({ label: `Basis ${i + 1}`, value: w }));
  if (event) evidence.push({ label: "Event id", value: `${event.event_id.slice(0, 8)}…` });

  return {
    id: event?.event_id ?? `msg-${Date.now().toString(36)}`,
    gate: "Message screening",
    checkType: GATE_REGISTRY.text.defaultCheckType,
    subject,
    headline: explanation?.summary ?? a.scenarioTitle,
    higginsSays,
    tone: toneForState(a.state),
    items,
    confidence: confidenceForState(a.state),
    whatToDo: whatToDo !== "Nothing to do." ? whatToDo : undefined,
    whatToDoLinks: whatToDoLinks.length ? whatToDoLinks : undefined,
    evidence,
    completedAt: new Date().toISOString(),
    investigationId: event?.event_id ?? null,
  };
}
