// The verdict pill set the Findings Brief shows (Ask Higgins and a Threat Case), read only from the case result
// (caseBriefing.caseResult) — never worked out on the screen. Pure: no React Native, unit-tested in node.
import { caseResult, type CaseResult } from "./caseBriefing.ts";
import { isGeneralAnswer } from "./luddish/lockSources.ts";
import { assessmentLabel } from "./messageVoice.ts";
import { riskLevel } from "./threatCase.ts";
import type { ApolloState } from "./types";
import type { HigginsResponse } from "../investigation/types";

export type BriefTone = "barking" | "ears_up" | "sniffing" | "resting";
export interface BriefVerdict {
  /** Apollo's verdict ("Likely a scam"). None for an answer to a general question. */
  label: string | null;
  tone: BriefTone;
  /** How serious Apollo recorded it as ("High risk"), when that says something. */
  risk?: { label: string; color: string } | null;
  /** A caution the verdict must carry: a Limited result is never shown as safe. */
  caution?: string | null;
  /** The case's status on a threat ("Needs you", "Keeping watch"). */
  status?: { label: string; bg: string; fg: string } | null;
}

/** "High risk" for the state Apollo recorded; nothing when there is no risk to state. */
export function riskPill(state: ApolloState | null | undefined): { label: string; color: string } | null {
  if (!state || state === "resting") return null;
  const risk = riskLevel(state);
  return risk.label === "Unknown" || risk.label === "None" ? null : { label: `${risk.label} risk`, color: risk.color };
}

/** The verdict and how serious it is, exactly as the case result records them. */
export function resultVerdict(result: CaseResult): BriefVerdict {
  return { label: result.verdict, tone: result.verdict ? result.tone : "sniffing", risk: riskPill(result.severity) };
}

/** An investigation's verdict — the one place Ask Higgins and a threat read it from. An answer to a general question
 *  has no verdict. */
export function investigationVerdict(response: HigginsResponse): BriefVerdict {
  const shown = resultVerdict(caseResult(response));
  return shown.label ? shown : { ...shown, label: isGeneralAnswer(response) ? null : assessmentLabel(response.assessment) };
}
