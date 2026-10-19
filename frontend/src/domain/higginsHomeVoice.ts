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
  /** Protection status indicator — independent of threat state (PRD Section 6). */
  protectionStatus?: "watching" | "reduced" | "action_needed";
  /** Higgins' explanation of protection issues — shown separately from the threat assessment. */
  protectionGuidance?: string;
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
 *   2. One specific high-priority concern → name the concern, link to the investigation.
 *   3. Two current concerns → name both specifically.
 *   4. Three+ current concerns → name the most important, summarise to Threats.
 *   5. Visibility lost (protection unverified) → explain, link to Protection.
 *   6. Patrolling / Sniffing → calm status line.
 *
 *  NEVER: count-driven messaging ("N findings"), generic directions, or
 *  conflation of gate-health with security threats.
 */
export function buildHomeVoice(input: {
  resolution: StateResolution;
  attention: AttentionItem[];
  gates: GatePresentation[];
  capabilities: Capability[];
}): HomeVoice {
  const { resolution, attention, gates, capabilities } = input;
  const state = resolution.state;

  // Derive platformCanEnforce from capabilities (same logic as ApolloContext).
  const platformCanEnforce = capabilities.some((c) => c.id === "site_guard" && c.status !== "unsupported");

  // Run the three-pillar resolver to get the evidence-based status.
  const homeStatus = resolveHomeStatus({
    resolution,
    attention,
    gates,
    capabilities,
    findingCount: 0, // Not used for count-driven messaging
    platformCanEnforce,
  });

  // Separate security findings from protection issues — never conflate.
  const securityFindings = attention.filter((a) => a.kind === "event");
  const protectionIssues = attention.filter((a) => a.kind === "gate");

  // ── Resting: the resolver produces scenario-specific messaging ──
  if (state === "resting" || (resolution.platformLimited && homeStatus.behavior === "resting")) {
    // Use approved wording when no security threat
    const restingText = homeStatus.explanation ||
      "No security threats currently detected within Apollo's current protection capability.";
    return {
      text: restingText,
      ctaLabel: homeStatus.primaryAction?.label ?? "View protection",
      ctaRoute: homeStatus.primaryAction?.route ?? "/(tabs)/protection",
      spoken: restingText,
      protectionStatus: homeStatus.protectionStatus,
      protectionGuidance: homeStatus.protectionGuidance,
    };
  }

  if (state === "sniffing" || state === "ears_up") {
    const drivingEvent = resolution.drivingEvent;
    const verb = state === "ears_up" ? "has his ears up" : "is sniffing";
    if (drivingEvent) {
      const gateName = GATE_FOR_CATEGORY[drivingEvent.category] ?? "a security check";
      const rawSubject = (drivingEvent.headline || drivingEvent.what_happened || "").trim();
      const subject = hasLocalEvidence(drivingEvent) ? rawSubject : "";
      const text = state === "ears_up"
        ? `Apollo ${verb} — something in ${gateName}${subject ? ` caught his attention: ${subject}` : " caught his attention"}. He's looking at it. I'll tell you exactly what to do once he's finished.`
        : `Apollo ${verb} — Magnum DI is investigating ${gateName}${subject ? `: ${subject}` : ""}. I'll tell you exactly what to do once he's finished.`;
      return {
        text,
        ctaLabel: "View what Apollo is checking",
        ctaRoute: `/patrol/${encodeURIComponent(drivingEvent.event_id)}`,
        spoken: text,
      };
    }
    return {
      text: state === "ears_up"
        ? "Apollo has noticed something — something in a recent check caught his attention. I'll show you what he's found."
        : "Apollo is sniffing — running his checks across your protections.",
      ctaLabel: "View what Apollo is checking",
      ctaRoute: "/(tabs)/patrol",
      spoken: state === "ears_up"
        ? "Apollo has noticed something — something caught his attention. I'll tell you what to do."
        : "Apollo is sniffing — running his checks across your protections.",
    };
  }

  const drivingEvent = resolution.drivingEvent;

  // 1) Biting — Apollo blocked something. Only when the driving event carries a verified_block flag.
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

  // 2) Security findings — prioritise by severity, explain specifically, never count-driven.
  if (securityFindings.length > 0) {
    const primary = securityFindings[0]; // Already priority-sorted by buildHomeAttention
    const primaryProblem = (primary.problem || "").trim();

    if (securityFindings.length === 1) {
      // One specific concern — name it, explain it, link directly to the investigation.
      const opener = state === "barking"
        ? (primaryProblem ? `Apollo found ${primaryProblem} — this needs your action now` : `Apollo found something in ${primary.gate} that needs your action now`)
        : (primaryProblem ? `Apollo flagged ${primaryProblem}` : `Apollo flagged something in ${primary.gate}`);
      const text = `${opener}. Open it and I'll tell you exactly what to do.`;
      return {
        text,
        ctaLabel: "View what Apollo found",
        ctaRoute: primary.route,
        spoken: text,
      };
    }

    if (securityFindings.length === 2) {
      // Two specific concerns — name both, link to the most urgent.
      const second = securityFindings[1];
      const secondBrief = (second.problem || second.title || "").trim();
      const text = primaryProblem
        ? `Apollo flagged ${primaryProblem}. There's also a concern about ${secondBrief || second.gate}. I'll walk you through both, starting with the most urgent.`
        : `Apollo has flagged concerns in ${primary.gate} and ${second.gate}. I'll walk you through both.`;
      return {
        text,
        ctaLabel: "View what Apollo found",
        ctaRoute: primary.route,
        spoken: text,
      };
    }

    // Three or more — name the most important, direct to Threats for the rest.
    const text = primaryProblem
      ? `Apollo flagged ${primaryProblem}, along with other concerns. Let's start with the most urgent — I'll walk you through everything in Threats.`
      : `Apollo has flagged several security concerns. Let's start with the most urgent.`;
    return {
      text,
      ctaLabel: "View in Threats",
      ctaRoute: primary.route,
      spoken: text,
    };
  }

  // 3) Only gate/protection issues, no security findings — these are protection health, not threats.
  if (protectionIssues.length > 0) {
    const gateNames = Array.from(new Set(protectionIssues.map((g) => g.gate).filter(Boolean)));
    const names = joinNames(gateNames);
    const text = `${names} ${protectionIssues.length === 1 ? "needs" : "need"} attention to keep your protection running properly. This isn't a security threat — it's about maintaining Apollo's coverage.`;
    return {
      text,
      ctaLabel: "View protection",
      ctaRoute: "/(tabs)/protection",
      spoken: text,
      protectionStatus: "action_needed",
      protectionGuidance: `${names} ${protectionIssues.length === 1 ? "requires" : "require"} attention.`,
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

  // 4) Visibility lost — use resolver's evidence-based messaging.
  if (resolution.visibilityLost) {
    return {
      text: homeStatus.explanation,
      ctaLabel: homeStatus.primaryAction?.label ?? "Check protection",
      ctaRoute: homeStatus.primaryAction?.route ?? "/(tabs)/protection",
      spoken: homeStatus.explanation,
    };
  }

  // 5) Recovering — no active event, waiting on a fresh verification check.
  if (resolution.recovering) {
    return {
      text: "Apollo is staying cautious after a recent alert. He needs a fresh check to confirm things are clear.",
      ctaLabel: "View protection",
      ctaRoute: "/(tabs)/protection",
      spoken: "Apollo is staying cautious after a recent alert.",
    };
  }

  // 6) Fallback — use resolver's evidence-based messaging.
  return {
    text: homeStatus.explanation,
    ctaLabel: homeStatus.primaryAction?.label ?? "View protection",
    ctaRoute: homeStatus.primaryAction?.route ?? "/(tabs)/protection",
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
