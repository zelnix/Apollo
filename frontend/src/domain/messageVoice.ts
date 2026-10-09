// Apollo's single message voice (standing requirement). ONE place that turns internal codes into
// plain, evidence-based English so no screen, notification or history ever shows a developer identifier
// (known_threat, ears_up, server_projection_of_recorded_outcome, user_started …) or a vague
// "Something changed". Every helper answers part of: What happened · Where · Why it matters ·
// What Apollo is doing · What to do · Where to go. Pure and unit-tested.
import type { ApolloState, EventCategory, PatrolDisplayState } from "./types";

// --- Where did it happen? (the security area, in plain words) ----------------------------------------
const AREA: Record<EventCategory, string> = {
  link: "a link you checked",
  website: "a website safety check",
  known_threat: "a website safety check",
  protection: "Apollo's protection",
  connection: "your network connection",
  system: "this device",
  device: "this device",
  message: "a text message",
  call: "a phone call",
  app: "an app",
  account: "an online account",
  email: "an email",
  file: "a file",
  family: "a family alert",
};
export function areaLabel(category: EventCategory | string): string {
  return AREA[category as EventCategory] ?? "a security check";
}

// --- What is Apollo doing? (never overstate — "blocked" only with verified enforcement) --------------
export function apolloStatusLabel(state: ApolloState, opts: { verifiedBlock?: boolean; resolved?: boolean; active?: boolean } = {}): string {
  if (state === "biting") return opts.verifiedBlock ? (opts.resolved ? "Threat stopped and contained" : "Threat stopped") : "Flagged for your attention";
  if (opts.resolved) return "Resolved";
  switch (state) {
    case "resting": return "No concern found";
    case "ears_up": return "Worth a look";
    case "growling": return "Being checked";
    case "barking": return "Needs your attention";
    default: return "Checked";
  }
}

// --- Short result chip (replaces "Something changed") ------------------------------------------------
export function resultChip(state: ApolloState, resolved = false): string {
  if (resolved) return "Resolved";
  switch (state) {
    case "resting": return "No concern found";
    case "ears_up": return "Worth a look";
    case "growling": return "Worth checking";
    case "barking": return "Needs your attention";
    case "biting": return "Threat stopped";
    default: return "Checked";
  }
}

// --- Who/what started it (replaces "user started", "higgins", raw source codes) ----------------------
export function sourceLabel(source: string): string {
  switch (source) {
    case "user_started": return "Started by you";
    case "background": return "Checked automatically in the background";
    case "higgins": return "From a Higgins investigation";
    case "family": return "From a family alert";
    default: return "Apollo";
  }
}

// --- Synced cross-device state (replaces raw effectiveState codes in timelines) ----------------------
const DISPLAY_STATE: Record<PatrolDisplayState, string> = {
  safe: "no concern found", monitoring: "being watched", warning: "worth checking",
  danger: "needs attention", blocked: "threat stopped", resolved: "resolved", unknown: "checked",
};
export function displayStateLabel(state: PatrolDisplayState | string): string {
  return DISPLAY_STATE[state as PatrolDisplayState] ?? "checked";
}

/** A code-looking reason (snake_case, no spaces — e.g. "server_projection_of_recorded_outcome") must
 *  never reach the user. Replace it with an honest, state-based sentence; keep genuine prose as-is. */
export function humanizeReason(reason: string | null | undefined, state: ApolloState): string {
  const text = (reason ?? "").trim();
  const looksLikeCode = !!text && !/\s/.test(text) && /^[a-z0-9]+(?:_[a-z0-9]+)+$/i.test(text);
  if (!text || looksLikeCode) {
    switch (state) {
      case "biting": return "A verified enforcement record confirms Apollo blocked supported traffic.";
      case "barking": return "Apollo recorded something that needs your attention.";
      case "growling":
      case "ears_up": return "Apollo recorded something worth a closer look.";
      case "resting": return "This check finished with no known concern in its scope.";
      default: return "Apollo recorded the outcome of this check.";
    }
  }
  return text;
}

// --- The projected (synced) event text, in plain English, with no detail leaked (privacy preserved) --
// Used both on the wire (privacy.ts) and when a synced-back event is displayed. It tells the user what
// the check was, what Apollo found at a high level, and to open it on the originating phone for detail.
export interface ProjectedVoice { headline: string; whatHappened: string; why: string; whatToDo: string }
export function projectedEventVoice(category: EventCategory | string, state: ApolloState, verifiedBlock: boolean): ProjectedVoice {
  if (verifiedBlock) return {
    headline: "Apollo blocked a connection it had flagged",
    whatHappened: "Apollo blocked a connection on your device that it had flagged as a threat.",
    why: "Packet-backed enforcement evidence is attached.",
    whatToDo: "No action needed — the block is confirmed. Open it on that phone to see the full record.",
  };
  const area = areaLabel(category);
  const headline = `Apollo ran ${area}`;
  if (state === "barking") return {
    headline,
    whatHappened: `Apollo checked ${area} and found something that needs your attention. The full assessment is available on the device where it happened.`,
    why: "Apollo's on-device check identified a concern. For your privacy, the detailed findings stay on this device.",
    whatToDo: "Open this on the device where it happened and follow Apollo's recommended action.",
  };
  if (state === "growling" || state === "ears_up") return {
    headline,
    whatHappened: `Apollo checked ${area} and found something worth a closer look. The full details are available on the device where it happened.`,
    why: "Apollo's on-device check flagged this for review. For your privacy, the detailed findings stay on this device.",
    whatToDo: "Open this on the device where it happened to review the full details.",
  };
  return {
    headline,
    whatHappened: `Apollo checked ${area} and found no concern. The full details are available on the device where it happened.`,
    why: "For your privacy, the detailed security assessment stays on this device.",
    whatToDo: "No action needed. Open it on the device where it happened to see the full details.",
  };
}

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** True when a string still carries an internal identifier the user should never see. */
export function looksLikeInternalCode(text: string): boolean {
  return /\b(known_threat|ears_up|user_started|server_projection|recorded_outcome|[a-z]+_[a-z]+(?:_[a-z]+)+)\b/.test(text);
}

/** True when text contains legacy jargon patterns from old event creation (e.g. "reported barking",
 *  "on-device assessment reported", "minimal security summary"). These are grammatically English
 *  but still developer-speak that shouldn't reach the user. */
export function hasLegacyJargon(text: string): boolean {
  if (!text) return false;
  return /reported (barking|growling|ears_up|biting|sniffing|resting)/i.test(text)
    || /on-device (assessment|check) reported/i.test(text)
    || /minimal security summary/i.test(text)
    || /details stay on the device/i.test(text)
    || /Apollo recorded a \w+ check$/i.test(text);
}

// --- Live scrubber for Higgins' free-text replies (Scan Gate Chat) -----------------------------------
// Higgins' overview/explanation/findings come from the model and could echo an internal token. This is
// the last line of defence: it rewrites any code token to plain English before it reaches the user, and
// in dev it warns so the leak gets fixed at the source too.
const CODE_REPLACEMENTS: Record<string, string> = {
  known_threat: "website safety", ears_up: "worth a look", user_started: "started by you",
  server_projection_of_recorded_outcome: "synced from another device", recorded_outcome: "recorded outcome",
  action_needed: "action needed", no_concern_found_within_scope: "no concern found in the checks performed",
  concern_found: "concern found", off_by_choice: "turned off", not_activated: "not set up yet",
  permission_needed: "permission needed", setup_needed: "setup needed", temporarily_unavailable: "temporarily unavailable",
};
export function scrubMessage(text: string | null | undefined): string {
  if (!text) return text ?? "";
  let flagged = false;
  const out = text.replace(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g, (m) => { flagged = true; return CODE_REPLACEMENTS[m] ?? m.replace(/_/g, " "); });
  if (flagged && typeof (globalThis as { __DEV__?: boolean }).__DEV__ !== "undefined" && (globalThis as { __DEV__?: boolean }).__DEV__) {
    console.warn(`[Apollo message guardrail] scrubbed an internal code from a Higgins reply: "${text}"`);
  }
  return out;
}

// --- Investigation status history (History Everywhere) -----------------------------------------------
/** Plain-English "what Higgins has done so far", derived from the turns and current phase. */
export function investigationHistory(args: {
  turns: { question: string; overview: string }[]; phase: string; completion?: string | null;
}): HistoryEntry[] {
  const entries: { text: string }[] = [{ text: "Higgins opened this investigation." }];
  args.turns.forEach((t, i) => { if (i > 0 || args.turns.length > 1) entries.push({ text: `You asked a follow-up — Higgins answered: ${scrubMessage(t.overview).slice(0, 120)}` }); });
  const current = args.phase === "working" || args.phase === "creating" || args.phase === "reconnecting" ? "Higgins is still investigating."
    : args.phase === "waiting_user" ? "Higgins is waiting on your answer to continue."
    : args.phase === "waiting_device" ? "Higgins is checking this device for a fresh observation."
    : args.phase === "failed" || args.phase === "expired" ? "This investigation stopped before finishing."
    : args.completion === "complete" ? "Higgins completed the investigation within scope."
    : args.completion === "partial" ? "Higgins answered, with more still to examine."
    : "Higgins has a question before it can finish.";
  entries.push({ text: current });
  return entries.map((e) => ({ at: "", text: e.text }));
}

// --- Higgins investigation verdicts (plain English, never raw enum values) ---------------------------
export function assessmentLabel(assessment: string): string {
  switch (assessment) {
    case "concern_found": return "Concern found";
    case "no_concern_found_within_scope": return "No concern found in the checks performed";
    case "uncertain": return "Not fully certain yet";
    default: return "Checked";
  }
}
export function attentionLabel(attention: string): string {
  switch (attention) {
    case "none": return "No action needed";
    case "review": return "Worth a review";
    case "action_needed": return "Action needed";
    case "urgent": return "Needs attention now";
    default: return "Review";
  }
}

// --- Plain-English status history for an event detail screen (Status Timeline) -----------------------
export interface HistoryEntry { at: string; text: string }
/** Builds a human-readable history from the event's own facts plus any synced revisions. Never shows a
 *  code; a revision summary that still looks like a code is replaced by a state-based sentence. */
export function eventHistory(
  e: { category: EventCategory | string; state: ApolloState; occurred_at: string; resolved_at?: string | null; verified_block?: boolean | null },
  revisions: { occurredAt: string; effectiveState: PatrolDisplayState | string; summary: string; revision: number }[] = [],
): HistoryEntry[] {
  const area = areaLabel(e.category);
  const entries: HistoryEntry[] = [{ at: e.occurred_at, text: `Apollo ran ${area} and ${e.verified_block ? "blocked a connection it had flagged" : apolloStatusLabel(e.state, {}).toLowerCase()}.` }];
  for (const r of revisions) {
    const summary = r.summary && !looksLikeInternalCode(r.summary) ? r.summary : `now ${displayStateLabel(r.effectiveState)}`;
    entries.push({ at: r.occurredAt, text: `Update: ${summary}.` });
  }
  if (e.resolved_at) entries.push({ at: e.resolved_at, text: "Apollo marked this resolved." });
  return entries.sort((a, b) => a.at.localeCompare(b.at));
}
