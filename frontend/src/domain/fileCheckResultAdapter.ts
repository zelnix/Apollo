// File Gate adapter — turns a `FileAnalysis` (from domain/fileAnalysis) into the universal
// `CheckResultModel`. ONE Higgins paragraph, assembled from the real evidence. Technical
// detail stays in `evidence`. Pure, no React.

import type { FileAnalysis } from "./fileAnalysis";
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
  if (state === "barking") return "High";
  if (state === "growling") return "Medium";
  return "Low";
}

/** Build the universal Check Result model for a File Gate manual check. */
export function buildFileCheckResult(args: {
  analysis: FileAnalysis;
  event: PatrolEvent | null;
  fileName: string;
  submissionId: string;
}): CheckResultModel {
  const { analysis: a, event, fileName, submissionId } = args;
  const subject = fileName || "Unknown file";

  const items: CheckItem[] = [];

  // File signature / magic bytes
  items.push({
    id: "file:signature",
    name: "File signature (magic bytes)",
    status: a.realType === "unknown" ? "incomplete" : a.realType === "exe" || a.realType === "script" || a.realType === "apk" ? "concern" : "clear",
    finding: `Signature detection result: ${a.realType}. Claimed extension: ${a.claimedType}.`,
    raw: { realType: a.realType, claimedType: a.claimedType },
  });

  // File type vs extension mismatch
  const mismatch = a.realType !== "unknown" && a.claimedType.toLowerCase() !== a.realType;
  if (mismatch) {
    items.push({
      id: "file:mismatch",
      name: "Extension mismatch",
      status: "concern",
      finding: `File claims to be .${a.claimedType} but signature says ${a.realType}.`,
    });
  }

  // Embedded URLs
  if (a.urls.length) {
    items.push({
      id: "file:urls",
      name: "Embedded links",
      status: "incomplete",
      finding: `${a.urls.length} link${a.urls.length > 1 ? "s" : ""} found inside the file. Each can be checked with Apollo.`,
      raw: { urls: a.urls },
    });
  }

  // Content inspection
  items.push({
    id: "file:content",
    name: "Content sample",
    status: a.technical.some((t) => t.includes("not inspected") || t.includes("not readable")) ? "not_performed" : "clear",
    finding: a.technical.find((t) => t.startsWith("Inspected") || t.startsWith("File contents")) ?? "Content inspection result not available.",
  });

  // Higgins paragraph — evidence-grounded, 2–4 sentences.
  let higginsSays: string;
  let whatToDo: string | undefined;
  if (a.state === "barking") {
    higginsSays = `${a.verdict} ${a.why[0] ?? ""} I recommend not opening this file.`;
    whatToDo = a.recommendation;
  } else if (a.state === "growling") {
    higginsSays = `${a.verdict} ${a.why[0] ?? ""} Proceed only if you can verify the sender independently.`;
    whatToDo = a.recommendation;
  } else if (a.state === "ears_up") {
    higginsSays = `${a.verdict} Apollo performed a limited inspection — full safety is not established. ${a.why[0] ?? ""}`.trim();
    whatToDo = a.recommendation;
  } else {
    higginsSays = `Apollo found no immediate concern with the inspected portion of this file. Only the signature and a small sample were checked — this is not a full malware scan.`;
    whatToDo = undefined;
  }

  // Evidence rows for the expandable "Full investigation details".
  const evidence: EvidenceRow[] = a.technical.map((t) => {
    const colonIndex = t.indexOf(":");
    if (colonIndex > 0 && colonIndex < 30) {
      return { label: t.slice(0, colonIndex).trim(), value: t.slice(colonIndex + 1).trim() };
    }
    return { label: "Detail", value: t };
  });
  evidence.push({ label: "Scenario", value: `${a.scenario} — ${a.title}` });
  if (a.handoff !== "none") evidence.push({ label: "Recommended handoff", value: a.handoff === "app" ? "Check the app" : a.handoff === "network" ? "Check the device" : "Check the web link" });
  if (event) evidence.push({ label: "Event id", value: `${event.event_id.slice(0, 8)}…` });

  return {
    id: submissionId,
    gate: "File Gate",
    checkType: "File check",
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
