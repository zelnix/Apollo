// Evidence Pack — a plain-text copy of one Threat Case's recorded facts and the sources Apollo used,
// for handing to a bank, the police or a family member. Facts only: no analysis, no interpretation,
// and nothing that wasn't already recorded on the case.

import { caseOrigin, completenessLabel, evidenceSourceLabel, privacyNote, processingLabels } from "./caseFacts.ts";
import { sourceHeading, type CaseSource } from "./caseSources.ts";
import { categoryLabel, formatDateTime, STATUS_LABELS, threatCaseId, threatCaseStatus } from "./threatCase.ts";
import type { PatrolEvent } from "./types";

export function buildEvidencePack(input: { event: PatrolEvent; facts: string[]; sources: CaseSource[] }): string {
  const { event, facts, sources } = input;
  const lines: string[] = [];

  lines.push(`Apollo Threat Case ${threatCaseId(event)}`);
  lines.push(`Status: ${STATUS_LABELS[threatCaseStatus(event)]}`);
  lines.push(`Type: ${categoryLabel(event.category, event.patrol_record?.recordClass)}`);
  lines.push(`Detected: ${formatDateTime(event.occurred_at) || event.occurred_at}`);
  if (event.resolved_at) lines.push(`Closed: ${formatDateTime(event.resolved_at)}`);
  // Origin, evidence source, processing, completeness and privacy — five separate facts.
  lines.push(`Origin: ${caseOrigin(event).label}`);
  lines.push(`Evidence: ${evidenceSourceLabel(event)}`);
  const processing = processingLabels(event);
  if (processing.length) lines.push(`Checked by: ${processing.join(", ")}`);
  lines.push(`Record: ${completenessLabel(event)}`);
  const privacy = privacyNote(event);
  if (privacy) lines.push(`Privacy: ${privacy}`);

  lines.push("", "WHAT APOLLO FOUND");
  if (facts.length > 0) for (const fact of facts) lines.push(`- ${fact}`);
  else lines.push("- No detail was recorded for this finding.");

  lines.push("", "SOURCES APOLLO USED");
  if (sources.length > 0) {
    for (const source of sources) {
      const when = source.at ? ` (${formatDateTime(source.at)})` : "";
      lines.push(`- ${sourceHeading(source)}: ${source.returned}${when}`);
      if (source.url) lines.push(`  ${source.url}`);
    }
  } else {
    lines.push("- No sources were recorded for this case.");
  }

  lines.push("", "Recorded by Apollo Cyber Security. These are the facts Apollo recorded — no interpretation has been added.");
  return lines.join("\n");
}
