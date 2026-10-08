// Universal Check Result — shared model for every Apollo manual check (Link / Site / Text / Call /
// Internet / App / Device / Email / File / Higgins First Check / Re-check). Apollo investigates,
// Higgins explains. ONE result, ONE explanation. Pure, serialisable, no React.
//
// Design principle (from product brief):
//   - "Apollo investigates and protects. Higgins explains the result, communicates uncertainty,
//     and guides the user when action is required."
//   - One understandable answer. No duplicated verdict cards.
//   - Technical detail is preserved but lives behind progressive disclosure.

export type CheckStatus =
  | "clear"           // the item was checked and nothing of concern was found
  | "concern"         // the item was checked and something warrants attention
  | "incomplete"      // the item was partially completed (e.g. HTTP 403 blocked content inspection)
  | "unavailable"     // the item couldn't be checked right now (e.g. provider offline)
  | "not_configured"  // the item isn't set up on this build (e.g. HIBP without a key)
  | "error"           // the item failed with an error
  | "not_performed";  // the item wasn't attempted (platform limit / user opted out)

export type Confidence = "High" | "Medium" | "Low";

/** One line in the "What Apollo checked" list. */
export interface CheckItem {
  id: string;
  /** Plain-English name of the check (never a code), e.g. "Apollo threat list". */
  name: string;
  status: CheckStatus;
  /** One-line plain-English finding (what the check reported). */
  finding: string;
  /** Optional raw technical details for the per-item expand. */
  raw?: Record<string, unknown>;
}

/** One row in the expandable "Full investigation" section. */
export interface EvidenceRow {
  label: string;
  value: string;
}

/** The canonical structured result for ANY manual Apollo check. */
export interface CheckResultModel {
  /** Internal id — stable across navigation / history. */
  id: string;
  /** Which Apollo Gate performed the check. */
  gate:
    | "Link Gate" | "Site Gate" | "Text Gate" | "Call Gate" | "Internet Gate"
    | "App Gate" | "Device Gate" | "Email Gate" | "File Gate" | "Account Gate"
    | "Device Re-check";
  /** Short label for the KIND of check, e.g. "Link check", "Message check". */
  checkType: string;
  /** What was checked, in a short human string (e.g. "www.godaddy.com"). */
  subject: string;
  /** One-sentence outcome, written for the person. */
  headline: string;
  /** Higgins' voice — 2–4 sentences. Covers what, what-it-means, uncertainty, what-to-do. */
  higginsSays: string;
  /** Tone for the headline badge — matches Apollo's standard tone palette. */
  tone: "resting" | "ears_up" | "growling" | "barking" | "biting" | "neutral";
  items: CheckItem[];
  confidence: Confidence;
  /** Only shown when action is genuinely needed. Omit for clean / informational results. */
  whatToDo?: string;
  evidence: EvidenceRow[];
  /** ISO completion timestamp — displayed in the full-details section. */
  completedAt: string;
  /** Optional investigation id — links to Patrol / Higgins / saved reports. */
  investigationId?: string | null;
}

/** Short status label for a check item (plain English, same text spoken by Higgins). */
export const STATUS_LABEL: Record<CheckStatus, string> = {
  clear: "Clear",
  concern: "Concern",
  incomplete: "Incomplete",
  unavailable: "Unavailable",
  not_configured: "Not configured",
  error: "Error",
  not_performed: "Not performed",
};

/** Pill tone for a status — mapping to the shared Pill tones. */
export const STATUS_TONE: Record<CheckStatus, "resting" | "growling" | "barking" | "ears_up" | "neutral" | "unknown"> = {
  clear: "resting",
  concern: "barking",
  incomplete: "ears_up",
  unavailable: "unknown",
  not_configured: "neutral",
  error: "growling",
  not_performed: "neutral",
};
