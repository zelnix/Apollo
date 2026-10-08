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
    whatHappened: `${capitalize(area)} flagged something that needs your attention. The full details stayed private on the phone where it happened.`,
    why: "Only a short, private security summary is synced between your devices.",
    whatToDo: "Open this on the phone where it happened and follow Apollo's recommended step.",
  };
  if (state === "growling" || state === "ears_up") return {
    headline,
    whatHappened: `${capitalize(area)} found something worth a look. The full details stayed private on the phone where it happened.`,
    why: "Only a short, private security summary is synced between your devices.",
    whatToDo: "Open this on the phone where it happened to see the full details. A past check doesn't confirm current safety.",
  };
  return {
    headline,
    whatHappened: `${capitalize(area)} finished with no concern found. The full details stayed private on the phone where it happened.`,
    why: "Only a short, private security summary is synced between your devices.",
    whatToDo: "No action needed. Open it on that phone to see the full details.",
  };
}

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** True when a string still carries an internal identifier the user should never see. */
export function looksLikeInternalCode(text: string): boolean {
  return /\b(known_threat|ears_up|user_started|server_projection|recorded_outcome|[a-z]+_[a-z]+(?:_[a-z]+)+)\b/.test(text);
}
