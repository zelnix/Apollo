// Higgins-led Home voice. Produces ONE short paragraph that interprets Apollo's current behaviour
// (sniffing / patrolling / growling / barking / biting) using REAL data — affected gate names come
// from live capability + gate state + active patrol events, specific concerns come from the active
// driving event (scam text, malicious email, insecure connection, device setting change, verified
// block, etc.). Never claims Apollo blocked a threat without `verified_block` + supporting evidence.
//
// OPERATING STANDARD: Higgins is an authoritative cybersecurity expert.
// INVESTIGATE → ASSESS → DIRECT → GUIDE → VERIFY.
// Every actionable finding produces a specific instruction, not a vague suggestion.
//
// Pure, unit-testable: no React, no navigation.

import type { AttentionItem } from "./homeAttention";
import type { GatePresentation } from "./gates";
import { hasLocalEvidence } from "./higginsNarration";
import type { StateResolution } from "./stateMachine";
import type { Capability } from "./types";

export interface HomeVoice {
  /** The short Higgins paragraph the Home card shows (and reads aloud). */
  text: string;
  /** The one primary action label — contextual (e.g. "View what Apollo found", "View Protection Details"). */
  ctaLabel: string;
  /** Route to open on tap. May be undefined for benign states (no CTA shown). */
  ctaRoute?: string;
  /** Spoken version — identical to text; kept separate so screens can extend if needed. */
  spoken: string;
}

/** Human label for every Capability id, used when assembling the dynamic affected-gate list. */
const CAPABILITY_LABEL: Record<Capability["id"], string> = {
  link_guard: "Link Gate",
  site_guard: "Site Gate",
  connection_guard: "Internet Gate",
  known_threats: "Known Threat Lookup",
  share_intake: "Share to Apollo",
  message_guard: "Text Gate",
  app_guard: "App Gate",
};

/** Join a list of names in plain English: ["A", "B", "C"] → "A, B and C". */
export function joinNames(names: string[]): string {
  const unique = Array.from(new Set(names.filter(Boolean)));
  if (unique.length === 0) return "";
  if (unique.length === 1) return unique[0];
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`;
  return `${unique.slice(0, -1).join(", ")} and ${unique[unique.length - 1]}`;
}

/** Capabilities that aren't actively running right now (excluding ones that explicitly aren't on this
 *  platform at all). These are the "may have limited coverage" set surfaced to the person. */
export function affectedCapabilities(capabilities: Capability[]): Capability[] {
  return capabilities.filter(
    (c) => c.status !== "active" && c.status !== "coming_later" && c.status !== "unsupported",
  );
}

/** Describe what Apollo noticed, in a verb that matches the state. Used when assembling multi-issue
 *  paragraphs so "Apollo is barking because he spotted…" / "Apollo is growling because he's unsure…" */
function verbForState(state: StateResolution["state"]): string {
  switch (state) {
    case "barking":  return "spotted";
    case "biting":   return "stopped";
    case "growling": return "noticed";
    case "ears_up":  return "is looking at";
    default:         return "is checking";
  }
}

/** Build the short paragraph + CTA for the Home card.
 *  Priority (highest first):
 *   1. Verified block (biting) → confirm what Apollo blocked, link to the investigation.
 *   2. Multiple active concerns (gates stopped + events across gates) → name every affected gate,
 *      send the person to Protection Details.
 *   3. One specific active concern (event or gate) → name the gate + link to the issue.
 *   4. Visibility lost (protection unverified) → name the affected gates + link to Protection Details.
 *   5. Recovering (awaiting a fresh check) → ask for a check + link to Protection Details.
 *   6. Patrolling / Sniffing → simple meaning line.
 */
export function buildHomeVoice(input: {
  resolution: StateResolution;
  attention: AttentionItem[];
  gates: GatePresentation[];
  capabilities: Capability[];
  /** Distinct finding count from countDistinctFindings — must match Protection Details. */
  findingCount?: number;
}): HomeVoice {
  const { resolution, attention, gates, capabilities, findingCount } = input;
  const state = resolution.state;

  if (state === "resting") {
    return {
      text: "Apollo is patrolling and all is clear. Every protection he can confirm is running, and nothing concerning turned up in the latest checks. No action needed right now.",
      ctaLabel: "View Protection Details",
      ctaRoute: "/protection-details",
      spoken: "Apollo is patrolling and all is clear. No action needed right now.",
    };
  }

  if (state === "sniffing" || state === "ears_up") {
    // Sniffing / Ears Up: Higgins explains what Apollo is INVESTIGATING right now. If there's a
    // specific driving event (an active investigation), name it; otherwise describe the general sweep.
    // Ears Up is the "something caught my eye" variant of sniffing — no decision needed yet.
    const drivingEvent = resolution.drivingEvent;
    const verb = state === "ears_up" ? "has his ears up" : "is sniffing";
    if (drivingEvent) {
      const gateName = GATE_FOR_CATEGORY[drivingEvent.category] ?? "a security check";
      const rawSubject = (drivingEvent.headline || drivingEvent.what_happened || "").trim();
      // Don't narrate server-projected text as if it's real evidence.
      const subject = hasLocalEvidence(drivingEvent) ? rawSubject : "";
      const text = state === "ears_up"
        ? `Apollo ${verb} — something in ${gateName}${subject ? ` caught his attention: ${subject}` : " caught his attention"}. He's looking at it. I'll tell you exactly what to do once he's finished.`
        : `Apollo ${verb} — he's investigating ${gateName}${subject ? `: ${subject}` : ""}. I'll tell you exactly what to do once he's finished.`;
      return {
        text,
        ctaLabel: "View what Apollo is checking",
        ctaRoute: `/patrol/${encodeURIComponent(drivingEvent.event_id)}`,
        spoken: text,
      };
    }
    return {
      text: state === "ears_up"
        ? "Apollo has his ears up — something in a recent check caught his attention. Open Protection Details and I'll show you what he's found."
        : "Apollo is sniffing — running his checks across the Gates. Open Protection Details and I'll show you the current status.",
      ctaLabel: "View what Apollo is checking",
      ctaRoute: "/protection-details",
      spoken: state === "ears_up"
        ? "Apollo has his ears up — something caught his attention. I'll tell you what to do."
        : "Apollo is sniffing — running his checks across the Gates.",
    };
  }

  const drivingEvent = resolution.drivingEvent;

  // 1) Biting — Apollo blocked something. Only when the driving event carries a verified_block flag
  //    with supporting evidence (per standing rule — never claim a block without evidence).
  if (state === "biting" && drivingEvent?.verified_block) {
    const rawWhat = (drivingEvent.what_happened || drivingEvent.headline || "").trim();
    const what = hasLocalEvidence(drivingEvent) ? rawWhat : "a threat";
    const gateName = GATE_FOR_CATEGORY[drivingEvent.category] ?? "a protection check";
    const text = `Apollo blocked ${what} through ${gateName}. The threat is contained. Open the investigation to see exactly what Apollo stopped and why.`;
    return {
      text,
      ctaLabel: "View what Apollo blocked",
      ctaRoute: `/patrol/${encodeURIComponent(drivingEvent.event_id)}`,
      spoken: `Apollo blocked ${what}. The threat is contained.`,
    };
  }

  // 2) Multiple active concerns — use the distinct finding count (aligned with Protection Details).
  const effectiveCount = findingCount ?? attention.length;
  if (effectiveCount > 1) {
    const descriptions = attention.map((a) => (a.problem || a.gate).trim()).filter(Boolean);
    const verb = verbForState(state);
    const text = `Apollo ${verb} ${effectiveCount} findings that need attention. Open Protection Details — I'll walk you through each one and tell you exactly what to do.`;
    return {
      text,
      ctaLabel: "View Protection Details",
      ctaRoute: "/protection-details",
      spoken: text,
    };
  }

  // 3) Exactly one specific active concern (an event like a scam text / malicious email / insecure
  //    network / device setting change, or a stopped gate). One short Higgins paragraph pointing to it.
  const primary = attention[0] ?? null;
  if (primary) {
    const gate = primary.gate;
    const problem = (primary.problem || "").trim();
    // Build a concise, directive opener from the state + real evidence.
    let opener: string;
    if (state === "barking") {
      opener = problem
        ? `Apollo found ${problem} — this needs your action now`
        : `Apollo found something in ${gate} that needs your action now`;
    } else if (state === "biting") {
      opener = problem
        ? `Apollo blocked a threat — ${problem}`
        : `Apollo blocked a threat in ${gate}`;
    } else {
      // Growling / ears_up — describe what Apollo found with clear direction.
      opener = problem
        ? `Apollo flagged ${problem}`
        : `Apollo flagged something in ${gate}`;
    }
    const text = `${opener}. Open it and I'll tell you exactly what to do.`;
    return {
      text,
      ctaLabel: primary.kind === "event" ? "View what Apollo found" : `View ${gate} issue`,
      ctaRoute: primary.route,
      spoken: text,
    };
  }

  // 3b) A driving event exists (e.g. growling scam text) but didn't surface as a dedicated attention
  //     item — build the paragraph from it directly rather than falling to a generic reason.
  if (drivingEvent) {
    const rawProblem = (drivingEvent.what_happened || drivingEvent.headline || "").trim();
    const problem = hasLocalEvidence(drivingEvent) ? rawProblem : "";
    const verb = state === "barking" ? "barking" : "growling";
    const text = problem
      ? `Apollo is ${verb} — he flagged ${problem}. Open it and I'll tell you exactly what to do.`
      : `Apollo is ${verb} about a security concern. Open it and I'll walk you through what's happening.`;
    return {
      text,
      ctaLabel: "View what Apollo found",
      ctaRoute: `/patrol/${encodeURIComponent(drivingEvent.event_id)}`,
      spoken: text,
    };
  }

  // 4) Visibility lost — Apollo can't confirm protection is running right now.
  if (resolution.visibilityLost) {
    const affected = affectedCapabilities(capabilities);
    const names = joinNames(affected.map((c) => CAPABILITY_LABEL[c.id] ?? c.title));
    const text = names
      ? `Apollo can't confirm that ${names} ${affected.length === 1 ? "is" : "are"} running right now. This doesn't mean there's a threat, but we should check. Open Protection Details and I'll guide you through restoring coverage.`
      : "Apollo can't confirm his protections are running right now. This doesn't mean there's a threat, but we should check. Open Protection Details and I'll guide you through it.";
    return {
      text,
      ctaLabel: "View Protection Details",
      ctaRoute: "/protection-details",
      spoken: text,
    };
  }

  // 5) Recovering — no active event, waiting on a fresh verification check.
  if (resolution.recovering) {
    return {
      text: "Apollo is staying cautious after a recent alert. He needs a fresh check to confirm things are clear. Open Protection Details — I'll show you which checks to run.",
      ctaLabel: "View Protection Details",
      ctaRoute: "/protection-details",
      spoken: "Apollo is staying cautious after a recent alert. Open Protection Details to run the needed checks.",
    };
  }

  // 6) Fallback — generic warning without a specific driver. Use the honest resolution reason.
  const reason = (resolution.reason || "").trim();
  return {
    text: `Apollo is ${state === "barking" ? "barking" : "growling"}. ${reason} Open Protection Details — I'll walk you through what's happening and what to do.`,
    ctaLabel: "View Protection Details",
    ctaRoute: resolution.reasonRoute || "/protection-details",
    spoken: `Apollo is ${state === "barking" ? "barking" : "growling"}. ${reason}`,
  };
}

/** Mapping from a PatrolEvent category to a human gate name. Mirrors homeAttention. */
const GATE_FOR_CATEGORY: Record<string, string> = {
  link: "Link Gate", website: "Site Gate", known_threat: "Site Gate", protection: "Site Gate",
  connection: "Internet Gate", system: "Device Gate", device: "Device Gate", message: "Text Gate",
  call: "Call Gate", app: "App Gate", account: "Account Gate", email: "Email Gate", file: "File Gate",
  family: "Family alert",
};
