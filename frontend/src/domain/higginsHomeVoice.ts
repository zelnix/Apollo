// Higgins-led Home voice. Produces ONE short paragraph that interprets Apollo's current behaviour
// using REAL data — three independent conditions (threat status, protection coverage, user actions)
// are assessed separately and never conflated.
//
// OPERATING STANDARD: Higgins is an authoritative cybersecurity expert.
// INVESTIGATE → ASSESS → DIRECT → GUIDE → VERIFY.
// Every actionable finding produces a specific instruction, not a vague suggestion.
//
// Pure, unit-testable: no React, no navigation.

import type { AttentionItem } from "./homeAttention";
import type { GatePresentation } from "./gates";
import { hasLocalEvidence } from "./higginsNarration.ts";
import { resolveHomeStatus, type HomeResolverInput } from "./homeStatusResolver";
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
  link_guard: "Link checking",
  site_guard: "Website protection",
  connection_guard: "Internet monitoring",
  known_threats: "Known Threat Lookup",
  share_intake: "Share to Apollo",
  message_guard: "Message screening",
  app_guard: "App checking",
};

/** Join a list of names in plain English: ["A", "B", "C"] → "A, B and C". */
export function joinNames(names: string[]): string {
  const unique = Array.from(new Set(names.filter(Boolean)));
  if (unique.length === 0) return "";
  if (unique.length === 1) return unique[0];
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`;
  return `${unique.slice(0, -1).join(", ")} and ${unique[unique.length - 1]}`;
}

/** Capability IDs that represent genuinely automatic protection (continuous background monitoring
 *  or enforcement). Manual-only checks (link, known_threats, share_intake, app) don't "run" in the
 *  background, so they should never appear as "Apollo can't confirm X is running." */
const AUTOMATIC_CAPABILITY_IDS = new Set<string>([
  "site_guard", "connection_guard", "message_guard",
]);

/** Capabilities where automatic protection has GENUINELY degraded — not merely optional setup,
 *  normal manual-check readiness, or unsupported platform features.
 *  - "available" = the check is ready when you need it (not a failure)
 *  - Manual-only capabilities never "run" continuously, so can't "fail to run"
 *  - "unsupported" = platform limitation (not a failure of something that was working) */
export function affectedCapabilities(capabilities: Capability[]): Capability[] {
  return capabilities.filter(
    (c) => c.status !== "active" && c.status !== "coming_later" && c.status !== "unsupported"
      && c.status !== "available"
      && AUTOMATIC_CAPABILITY_IDS.has(c.id),
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
 *  Uses the central Home Status Resolver to separate threat status, protection coverage,
 *  and user actions — then produces Higgins' interpretation as one natural paragraph.
 *
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

  // Derive platformCanEnforce from capabilities (same logic as ApolloContext).
  const platformCanEnforce = capabilities.some((c) => c.id === "site_guard" && c.status !== "unsupported");

  // Run the three-pillar resolver to get the evidence-based status.
  const homeStatus = resolveHomeStatus({
    resolution,
    attention,
    gates,
    capabilities,
    findingCount,
    platformCanEnforce,
  });

  // ── Resting: the resolver produces scenario-specific messaging ──
  if (state === "resting" || (resolution.platformLimited && homeStatus.behavior === "resting")) {
    return {
      text: homeStatus.explanation,
      ctaLabel: homeStatus.primaryAction?.label ?? "View protection coverage",
      ctaRoute: homeStatus.primaryAction?.route ?? "/(tabs)/protection",
      spoken: homeStatus.explanation,
    };
  }

  if (state === "sniffing" || state === "ears_up") {
    // Sniffing / Ears Up: Higgins explains what Apollo is INVESTIGATING right now. If there's a
    // specific driving event (an active investigation), name it; otherwise describe the general sweep.
    const drivingEvent = resolution.drivingEvent;
    const verb = state === "ears_up" ? "has his ears up" : "is sniffing";
    if (drivingEvent) {
      const gateName = GATE_FOR_CATEGORY[drivingEvent.category] ?? "a security check";
      const rawSubject = (drivingEvent.headline || drivingEvent.what_happened || "").trim();
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
        ? "Apollo is sniffing something — something in a recent check caught his attention. Open Protection Details and I'll show you what he's found."
        : "Apollo is sniffing — running his checks across your protections. Open Protection Details and I'll show you the current status.",
      ctaLabel: "View what Apollo is checking",
      ctaRoute: "/protection-details",
      spoken: state === "ears_up"
        ? "Apollo is sniffing something — something caught his attention. I'll tell you what to do."
        : "Apollo is sniffing — running his checks across your protections.",
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

  // 2) Multiple active concerns — classify and explain, not just count.
  //    Higgins names the most important concern, distinguishes threats from protection issues,
  //    and never describes setup tasks as security threats.
  const effectiveCount = findingCount ?? attention.length;
  if (effectiveCount > 1 && attention.length > 0) {
    const threatEvents = attention.filter((a) => a.kind === "event");
    const gateIssues = attention.filter((a) => a.kind === "gate");
    const primary = attention[0]; // Already priority-sorted by buildHomeAttention

    let text: string;
    let ctaLabel: string;
    let ctaRoute: string;

    if (threatEvents.length > 0 && gateIssues.length === 0) {
      // All findings are active security events (suspicious/blocked activity).
      // Group by gate category to give a sense of what they concern.
      const gateNames = Array.from(new Set(threatEvents.map((e) => e.gate).filter(Boolean)));
      const areasPhrase = gateNames.length > 0 ? ` across ${joinNames(gateNames)}` : "";
      const primaryProblem = (primary.problem || "").trim();

      if (primaryProblem) {
        const rest = effectiveCount - 1;
        text = `Apollo has spotted ${primaryProblem}${rest > 0 ? `, along with ${rest} other ${rest === 1 ? "finding" : "findings"}${areasPhrase}` : ""}. I'll walk you through each one, starting with the most urgent.`;
      } else {
        text = `Apollo has spotted suspicious activity${areasPhrase} — ${effectiveCount} findings need checking. I'll show you what he noticed and what to do next.`;
      }
      ctaLabel = "View what Apollo found";
      ctaRoute = primary.route || "/protection-details";

    } else if (gateIssues.length > 0 && threatEvents.length === 0) {
      // All findings are protection/gate issues (protection stopped, needs setup).
      const gateNames = Array.from(new Set(gateIssues.map((g) => g.gate).filter(Boolean)));
      const names = joinNames(gateNames);
      text = `Apollo needs a little attention. ${names} ${gateIssues.length === 1 ? "needs" : "need"} to be checked. I'll show you what needs fixing, one step at a time.`;
      ctaLabel = "View Protection Details";
      ctaRoute = "/protection-details";

    } else {
      // Mix of threats and protection issues — name the most important concern first.
      const primaryProblem = (primary.problem || "").trim();
      if (primary.kind === "event" && primaryProblem) {
        text = `Apollo spotted ${primaryProblem}. There ${gateIssues.length === 1 ? "is" : "are"} also ${gateIssues.length} protection ${gateIssues.length === 1 ? "area" : "areas"} that ${gateIssues.length === 1 ? "needs" : "need"} attention. Let's start with what Apollo found.`;
        ctaLabel = "View what Apollo found";
        ctaRoute = primary.route;
      } else {
        const gateNames = Array.from(new Set(gateIssues.map((g) => g.gate).filter(Boolean)));
        const names = joinNames(gateNames);
        text = `${names} ${gateIssues.length === 1 ? "needs" : "need"} attention, and Apollo has also flagged ${threatEvents.length} suspicious ${threatEvents.length === 1 ? "finding" : "findings"}. I'll walk you through everything, starting with the most important.`;
        ctaLabel = "View Protection Details";
        ctaRoute = "/protection-details";
      }
    }

    return { text, ctaLabel, ctaRoute, spoken: text };
  }

  // 3) Exactly one specific active concern.
  const primary = attention[0] ?? null;
  if (primary) {
    const gate = primary.gate;
    const problem = (primary.problem || "").trim();
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

  // 3b) DNS threat observation.
  if (drivingEvent?.evidence_provenance === "dns_observation" && drivingEvent.indicator_host) {
    const domain = drivingEvent.indicator_host;
    const text = `Apollo detected a known threat — a DNS query for "${domain}" was intercepted and redirected before the browser could connect. This is a detection, not a confirmed block. Do not visit this website. If you received it in a message, treat that source as suspicious.`;
    return {
      text,
      ctaLabel: "View what Apollo detected",
      ctaRoute: `/patrol/${encodeURIComponent(drivingEvent.event_id)}`,
      spoken: `Apollo detected a known threat. A DNS query for ${domain} was intercepted.`,
    };
  }

  // 3c) A driving event exists but didn't surface as a dedicated attention item.
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

  // 4) Visibility lost — use resolver's evidence-based messaging instead of generic fallback.
  //    Only name GENUINELY affected automatic capabilities — not optional setup or unsupported features.
  if (resolution.visibilityLost) {
    // Delegate to the resolver which produces Scenario D/F messaging.
    return {
      text: homeStatus.explanation,
      ctaLabel: homeStatus.primaryAction?.label ?? "Check protection",
      ctaRoute: homeStatus.primaryAction?.route ?? "/protection-details",
      spoken: homeStatus.explanation,
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

  // 6) Fallback — use resolver's evidence-based messaging.
  return {
    text: homeStatus.explanation,
    ctaLabel: homeStatus.primaryAction?.label ?? "View Protection Details",
    ctaRoute: homeStatus.primaryAction?.route ?? "/protection-details",
    spoken: homeStatus.explanation,
  };
}

/** Mapping from a PatrolEvent category to a human gate name. Mirrors homeAttention. */
const GATE_FOR_CATEGORY: Record<string, string> = {
  link: "Link checking", website: "Website protection", known_threat: "Website protection", protection: "Website protection",
  connection: "Internet monitoring", system: "Device monitoring", device: "Device monitoring", message: "Message screening",
  call: "Call screening", app: "App checking", account: "Account alerts", email: "Email monitoring", file: "File checking",
  family: "Family alert",
};
