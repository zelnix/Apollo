// Higgins-led Home voice. Produces ONE short paragraph that interprets Apollo's current behaviour
// (sniffing / patrolling / growling / barking / biting) using REAL data — affected gate names come
// from live capability + gate state + active patrol events, specific concerns come from the active
// driving event (scam text, malicious email, insecure connection, device setting change, verified
// block, etc.). Never claims Apollo blocked a threat without `verified_block` + supporting evidence.
//
// Pure, unit-testable: no React, no navigation.

import type { AttentionItem } from "./homeAttention";
import type { GatePresentation } from "./gates";
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
}): HomeVoice {
  const { resolution, attention, gates, capabilities } = input;
  const state = resolution.state;

  if (state === "resting") {
    return {
      text: "Apollo is patrolling and all is well. The protections he can confirm are running, and no concern turned up in the checks that completed.",
      ctaLabel: "View Protection Details",
      ctaRoute: "/protection-details",
      spoken: "Apollo is patrolling and all is well. The protections he can confirm are running, and no concern turned up.",
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
      const subject = (drivingEvent.headline || drivingEvent.what_happened || "").trim();
      const text = state === "ears_up"
        ? `Apollo ${verb} — something in ${gateName}${subject ? ` caught his attention: ${subject}` : " caught his attention"}. He's looking at it more closely. I'll let you know what he finds.`
        : `Apollo ${verb} — he's investigating ${gateName}${subject ? `: ${subject}` : ""}. I'll let you know what he finds, and you can watch along if you'd like.`;
      return {
        text,
        ctaLabel: "View what Apollo is checking",
        ctaRoute: `/patrol/${encodeURIComponent(drivingEvent.event_id)}`,
        spoken: text,
      };
    }
    return {
      text: state === "ears_up"
        ? "Apollo has his ears up — something in a recent check caught his attention and he's taking a closer look. Open Protection Details and I'll show you what he's looking at."
        : "Apollo is sniffing — he's running his current checks across the Gates to see if anything needs your attention. Open Protection Details and I'll show you what he's looking at.",
      ctaLabel: "View what Apollo is checking",
      ctaRoute: "/protection-details",
      spoken: state === "ears_up"
        ? "Apollo has his ears up — something caught his attention and he's taking a closer look."
        : "Apollo is sniffing — he's running his current checks across the Gates.",
    };
  }

  const drivingEvent = resolution.drivingEvent;

  // 1) Biting — Apollo blocked something. Only when the driving event carries a verified_block flag
  //    with supporting evidence (per standing rule — never claim a block without evidence).
  if (state === "biting" && drivingEvent?.verified_block) {
    const what = (drivingEvent.what_happened || drivingEvent.headline || "a threat").trim();
    const gateName = GATE_FOR_CATEGORY[drivingEvent.category] ?? "a protection check";
    const text = `Apollo is biting — ${gateName} blocked ${what} The device's own evidence is on the investigation page. Let me show you exactly what Apollo stopped and why.`;
    return {
      text,
      ctaLabel: "View what Apollo blocked",
      ctaRoute: `/patrol/${encodeURIComponent(drivingEvent.event_id)}`,
      spoken: `Apollo blocked ${what}`,
    };
  }

  // 2) Multiple active concerns — describe them specifically instead of just naming gates.
  if (attention.length > 1) {
    const descriptions = attention.map((a) => (a.problem || a.gate).trim()).filter(Boolean);
    const verb = verbForState(state);
    const text = `Apollo is ${state === "barking" ? "barking" : "growling"} because he ${verb} ${descriptions.length} things that need attention. Let me show you what Apollo found and what we can do about each one.`;
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
    // Build a concise, non-repetitive opener from the state + real evidence.
    let opener: string;
    if (state === "barking") {
      opener = problem
        ? `Apollo is barking — ${problem} and needs your decision`
        : `Apollo is barking — something in ${gate} needs your decision`;
    } else if (state === "biting") {
      opener = problem
        ? `Apollo blocked a threat — ${problem}`
        : `Apollo blocked a threat in ${gate}`;
    } else {
      // Growling / ears_up — describe what Apollo found without repeating "suspicious".
      opener = problem
        ? `Apollo is growling — he flagged ${problem}`
        : `Apollo is growling about something in ${gate}`;
    }
    const text = `${opener}. Let me show you what Apollo found and what we can do about it.`;
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
    const problem = (drivingEvent.what_happened || drivingEvent.headline || "").trim();
    const verb = state === "barking" ? "barking" : "growling";
    const text = problem
      ? `Apollo is ${verb} — he flagged ${problem}. Let me show you what Apollo found and what we can do about it.`
      : `Apollo is ${verb} about a security concern. Let me show you what Apollo found and what we can do about it.`;
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
      ? `Apollo is growling because he can't confirm that all his protections are running right now. ${names} may have limited coverage. That doesn't mean Apollo has found a threat. Let me show you what Apollo found and what we can do about it.`
      : "Apollo is growling because he can't confirm that his protections are running right now. That doesn't mean he has found a threat. Let me show you what Apollo found and what we can do about it.";
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
      text: "Apollo is staying cautious after a recent alert. He won't settle back to patrol until a fresh check confirms things are clear. Let me show you the checks to run.",
      ctaLabel: "View Protection Details",
      ctaRoute: "/protection-details",
      spoken: "Apollo is staying cautious after a recent alert and is waiting for a fresh check.",
    };
  }

  // 6) Fallback — generic warning without a specific driver. Use the honest resolution reason.
  const reason = (resolution.reason || "").trim();
  return {
    text: `Apollo is ${state === "barking" ? "barking" : "growling"} and I want to walk you through what's going on. ${reason} Let me show you what Apollo found and what we can do about it.`,
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
