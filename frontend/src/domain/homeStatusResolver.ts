// Home Status Resolver — the central, deterministic Home-status resolution engine.
// Separates three independent conditions: threat status, protection coverage, and user actions.
// Consumes existing authoritative sources (state machine, gates, capabilities, events) without
// creating a competing protection-state engine.
//
// Pure, unit-testable: no React, no navigation, no side effects.

import type { AttentionItem } from "./homeAttention";
import type { GatePresentation } from "./gates";
import type { StateResolution } from "./stateMachine";
import type { ApolloState, Capability, PatrolEvent } from "./types";

// ─── Pillar 1: Threat Status ─────────────────────────────────────────────────

export type ThreatLevel = "none" | "suspicious" | "confirmed" | "blocked" | "unknown";

export interface ThreatStatus {
  level: ThreatLevel;
  /** Short description of the threat, if any. */
  summary?: string;
  /** The event driving the threat assessment, if any. */
  drivingEvent?: PatrolEvent;
}

// ─── Pillar 2: Protection Coverage ───────────────────────────────────────────

// CoverageItemState comes from the shared Protection State Resolver.
import type { CoverageItemState } from "./protectionStateResolver";
export type { CoverageItemState };

export interface CoverageItem {
  id: string;
  name: string;
  state: CoverageItemState;
  isAutomatic: boolean;
  detail?: string;
}

export interface ProtectionCoverage {
  /** High-level assessment. */
  overall: "full" | "partial" | "degraded" | "minimal" | "unknown";
  items: CoverageItem[];
  /** Count of actively verified automatic protections. */
  activeVerifiedCount: number;
  /** Count of protections that could be set up but aren't yet. */
  setupAvailableCount: number;
  /** Count of protections unsupported on this platform. */
  unsupportedCount: number;
  /** Count of protections that were running but have genuinely failed/degraded. */
  failedCount: number;
  /** True when the platform fundamentally cannot run enforcement (web preview, unsupported OS). */
  platformLimited: boolean;
}

// ─── Pillar 3: User Action Required ─────────────────────────────────────────

export type ActionLevel =
  | "none"
  | "optional_setup"
  | "recommended_setup"
  | "critical_repair"
  | "threat_response";

export interface UserActionItem {
  title: string;
  description: string;
  route: string;
  priority: "optional" | "recommended" | "critical";
}

export interface UserActions {
  level: ActionLevel;
  primaryAction?: UserActionItem;
  items: UserActionItem[];
}

// ─── Final Home Status ──────────────────────────────────────────────────────

export interface HomeStatus {
  /** Apollo's visual behavior — drives animation and character. */
  behavior: ApolloState;
  /** One-line headline: "Apollo is Patrolling" / "Apollo is growling". */
  headline: string;
  /** 2-3 sentence plain English explanation of WHAT IS HAPPENING, WHAT IT MEANS, and WHAT TO DO. */
  explanation: string;
  /** One primary action, when useful. */
  primaryAction?: { label: string; route: string };
  /** Secondary coverage note for the resting state (doesn't imply universal safety). */
  coverageNote?: string;
  /** Protection status indicator — independent of threat state. */
  protectionStatus?: "watching" | "reduced" | "action_needed";
  /** Higgins' guidance about protection issues — separate from threat assessment. */
  protectionGuidance?: string;
  /** The three independent pillars. */
  threat: ThreatStatus;
  coverage: ProtectionCoverage;
  actions: UserActions;
}

// ─── Resolver Input ─────────────────────────────────────────────────────────

export interface HomeResolverInput {
  resolution: StateResolution;
  attention: AttentionItem[];
  gates: GatePresentation[];
  capabilities: Capability[];
  findingCount?: number;
  /** Whether the platform can run native enforcement (VPN/DNS filtering). */
  platformCanEnforce: boolean;
}

// ─── Capability name lookup ─────────────────────────────────────────────────

const CAPABILITY_LABEL: Record<string, string> = {
  link_guard: "Link checking",
  site_guard: "Website protection",
  connection_guard: "Internet monitoring",
  known_threats: "Known Threat Lookup",
  share_intake: "Share to Apollo",
  message_guard: "Message screening",
  app_guard: "App checking",
};

import { gateName } from "./gateRegistry";

/** Automatic capability IDs (continuous background monitoring or enforcement). */
const AUTOMATIC_IDS = new Set(["site_guard", "connection_guard", "message_guard"]);

// ─── Pillar Derivation ──────────────────────────────────────────────────────

function deriveThreatStatus(resolution: StateResolution): ThreatStatus {
  const ev = resolution.drivingEvent;

  if (resolution.state === "biting" && ev?.verified_block) {
    return { level: "blocked", summary: ev.what_happened || ev.headline || "A threat was blocked.", drivingEvent: ev };
  }
  if (resolution.state === "barking" && ev) {
    return { level: "confirmed", summary: ev.what_happened || ev.headline || "A significant concern requires attention.", drivingEvent: ev };
  }
  if ((resolution.state === "growling" || resolution.state === "ears_up") && ev) {
    return { level: "suspicious", summary: ev.what_happened || ev.headline || "Suspicious activity detected.", drivingEvent: ev };
  }
  if (resolution.state === "resting" || resolution.state === "sniffing") {
    return { level: "none" };
  }
  // Growling without a driving event could mean coverage concern, not threat.
  if (resolution.state === "growling" && !ev) {
    return { level: "none" };
  }
  return { level: "unknown" };
}

function deriveCoverage(gates: GatePresentation[], capabilities: Capability[], platformCanEnforce: boolean): ProtectionCoverage {
  const items: CoverageItem[] = [];

  for (const gate of gates) {
    // Read from the canonical resolved state — computed ONCE in gates.ts by
    // resolveProtectionState(). No re-resolution here.
    const state = gate.resolved.coverageState;
    const isAutomatic = gate.resolved.isAutomatic;

    items.push({
      id: gate.id,
      name: gateName(gate.id),
      state,
      isAutomatic,
      detail: gate.capability.automatic?.limitation || gate.currentHelp,
    });
  }

  const automaticItems = items.filter((i) => i.isAutomatic);
  const activeVerified = automaticItems.filter((i) => i.state === "active_verified").length;
  const setupAvailable = items.filter((i) => i.state === "setup_available").length;
  const unsupported = items.filter((i) => i.state === "unsupported").length;
  const failed = items.filter((i) => i.state === "temporarily_unavailable").length;
  const totalAutomatic = automaticItems.length;

  let overall: ProtectionCoverage["overall"];
  if (failed > 0) {
    overall = "degraded";
  } else if (activeVerified === totalAutomatic && totalAutomatic > 0) {
    overall = "full";
  } else if (activeVerified > 0) {
    overall = "partial";
  } else if (totalAutomatic === 0 && items.length > 0) {
    overall = "minimal"; // no automatic protections but manual checks exist
  } else {
    overall = "unknown";
  }

  return {
    overall,
    items,
    activeVerifiedCount: activeVerified,
    setupAvailableCount: setupAvailable,
    unsupportedCount: unsupported,
    failedCount: failed,
    platformLimited: !platformCanEnforce,
  };
}

function deriveUserActions(attention: AttentionItem[], coverage: ProtectionCoverage, threat: ThreatStatus): UserActions {
  const items: UserActionItem[] = [];

  // Threat response actions take highest priority.
  if (threat.level === "confirmed" || threat.level === "blocked") {
    const ev = threat.drivingEvent;
    if (ev) {
      items.push({
        title: threat.level === "blocked" ? "See what Apollo stopped" : "Review threat",
        description: threat.summary ?? "A security concern requires your attention.",
        route: `/patrol/${encodeURIComponent(ev.event_id)}`,
        priority: "critical",
      });
    }
  }

  // Critical repair actions from gate failures.
  for (const item of attention) {
    if (item.kind === "gate") {
      items.push({
        title: item.title,
        description: item.problem,
        route: item.route,
        priority: "critical",
      });
    }
  }

  // Event-based attention items.
  for (const item of attention) {
    if (item.kind === "event") {
      const alreadyAdded = items.some((i) => i.route === item.route);
      if (!alreadyAdded) {
        items.push({
          title: item.title,
          description: item.problem,
          route: item.route,
          priority: item.event?.state === "barking" ? "critical" : "recommended",
        });
      }
    }
  }

  // Optional setup — only when there's nothing more urgent.
  if (items.length === 0 && coverage.setupAvailableCount > 0 && coverage.failedCount === 0) {
    const setupGate = coverage.items.find((i) => i.state === "setup_available");
    if (setupGate) {
      items.push({
        title: `Set up ${setupGate.name}`,
        description: `${setupGate.name} can be enabled for additional protection.`,
        route: "/(tabs)/protection",
        priority: "optional",
      });
    }
  }

  // Determine overall level.
  let level: ActionLevel = "none";
  if (items.some((i) => i.priority === "critical") && threat.level !== "none") {
    level = "threat_response";
  } else if (items.some((i) => i.priority === "critical")) {
    level = "critical_repair";
  } else if (items.some((i) => i.priority === "recommended")) {
    level = "recommended_setup";
  } else if (items.some((i) => i.priority === "optional")) {
    level = "optional_setup";
  }

  return {
    level,
    primaryAction: items[0],
    items,
  };
}

// ─── Message Generation (PRD Scenarios A–F) ─────────────────────────────────

function joinNames(names: string[]): string {
  const unique = Array.from(new Set(names.filter(Boolean)));
  if (unique.length === 0) return "";
  if (unique.length === 1) return unique[0];
  if (unique.length === 2) return `${unique[0]} and ${unique[1]}`;
  return `${unique.slice(0, -1).join(", ")} and ${unique[unique.length - 1]}`;
}

/** Approved threat-clear message — always used when Apollo has no active security threat.
 *  RELIABILITY FIX: The message now qualifies coverage when call screening is not active. */
function noThreatMessage(coverage: ProtectionCoverage): string {
  const callItem = coverage.items.find((i) => i.id === "call");
  const callNotActive = callItem && callItem.state !== "active_verified" && callItem.state !== "unsupported";
  if (callNotActive) {
    return "No security threats currently detected within Apollo's active protections. Automatic call screening is not currently active — incoming calls may not be monitored.";
  }
  return "No security threats currently detected within Apollo's current protection capability.";
}

function buildRestingMessage(coverage: ProtectionCoverage, actions: UserActions): { explanation: string; primaryAction?: HomeStatus["primaryAction"]; coverageNote?: string } {
  const base = noThreatMessage(coverage);

  // Check if call screening needs attention — provide specific Higgins action.
  const callItem = coverage.items.find((i) => i.id === "call");
  const callNeedsSetup = callItem && (callItem.state === "setup_available" || callItem.state === "temporarily_unavailable" || callItem.state === "unknown");

  // Scenario A: No known threat, optional setup available.
  if (!coverage.platformLimited && actions.level === "optional_setup" && coverage.failedCount === 0) {
    return {
      explanation: `${base} There are a few more protections you can set up if you'd like.`,
      primaryAction: callNeedsSetup
        ? { label: "Set up call screening", route: "/call-guard" }
        : actions.primaryAction ? { label: "Complete protection setup", route: actions.primaryAction.route } : undefined,
    };
  }

  // Scenario B: No known threat, platform limitations.
  if (coverage.platformLimited) {
    return {
      explanation: `${base} Some protections are not available on this device.`,
      primaryAction: { label: "View protection coverage", route: "/(tabs)/protection" },
      coverageNote: "Platform-limited: not all protections are available on this device.",
    };
  }

  // Full coverage, no issues — all automatic protections verified.
  if (coverage.overall === "full" && actions.level === "none") {
    return {
      explanation: `${base} Your available protections are running and Apollo will let you know if anything needs attention.`,
    };
  }

  // Partial coverage — some protections running, no failures.
  if (coverage.activeVerifiedCount > 0 && coverage.failedCount === 0) {
    const runningNames = coverage.items
      .filter((i) => i.state === "active_verified" && i.isAutomatic)
      .map((i) => i.name);
    const note = runningNames.length > 0
      ? `${joinNames(runningNames)} ${runningNames.length === 1 ? "is" : "are"} running.`
      : "Your available protections are running.";
    return {
      explanation: `${base} ${note}`,
      primaryAction: callNeedsSetup ? { label: "Set up call screening", route: "/call-guard" } : undefined,
    };
  }

  // No automatic protections running at all (but manual checks work).
  return {
    explanation: `${base} Manual security checks are ready when you need them.`,
    primaryAction: { label: "View protection", route: "/(tabs)/protection" },
  };
}

function buildCoverageUnverifiedMessage(coverage: ProtectionCoverage): { explanation: string; primaryAction?: HomeStatus["primaryAction"] } {
  // Scenario F: Coverage cannot be verified.
  const failedItems = coverage.items.filter((i) => i.state === "temporarily_unavailable" || i.state === "active_unverified");
  const failedNames = failedItems.map((i) => i.name);

  if (failedNames.length > 0) {
    const names = joinNames(failedNames);
    return {
      explanation: `Apollo can't currently confirm whether ${names} ${failedNames.length === 1 ? "is" : "are"} working. This doesn't mean there's a threat, but let's check ${failedNames.length === 1 ? "its" : "their"} status.`,
      primaryAction: { label: "Check protection", route: "/protection-details" },
    };
  }

  return {
    explanation: "Apollo can't currently confirm whether protection is working. Let's check its status.",
    primaryAction: { label: "Check protection", route: "/protection-details" },
  };
}

// ─── Protection Presentation (independent of threat state) ──────────────────

function deriveProtectionPresentation(
  resolution: StateResolution,
  coverage: ProtectionCoverage,
  attention: AttentionItem[],
): { protectionStatus?: HomeStatus["protectionStatus"]; protectionGuidance?: string; coverageNote?: string } {

  const gateIssues = attention.filter((a) => a.kind === "gate");

  // Critical repair: a gate that should be running has stopped.
  if (coverage.failedCount > 0) {
    const failedItem = coverage.items.find((i) => i.state === "temporarily_unavailable");
    const failedName = failedItem?.name ?? "Protection";
    const detail = failedItem?.detail;
    const guidance = detail
      ? `${failedName} isn't working as expected. ${detail}`
      : `${failedName} isn't working as expected. I'm checking why and whether there's anything you need to do.`;
    return { protectionStatus: "action_needed", protectionGuidance: guidance };
  }

  // Visibility lost (protection can't be verified) — not a threat.
  if (resolution.visibilityLost && !coverage.platformLimited) {
    const failedItems = coverage.items.filter((i) => i.state === "temporarily_unavailable" || i.state === "active_unverified");
    const failedNames = failedItems.map((i) => i.name);
    if (failedNames.length > 0) {
      const names = joinNames(failedNames);
      return {
        protectionStatus: "reduced",
        protectionGuidance: `Apollo can't currently confirm whether ${names} ${failedNames.length === 1 ? "is" : "are"} working. This doesn't mean there's a threat, but let's check ${failedNames.length === 1 ? "its" : "their"} status.`,
      };
    }
    return {
      protectionStatus: "reduced",
      protectionGuidance: "Apollo can't currently confirm whether protection is working. This doesn't mean there's a threat.",
    };
  }

  // Recovery period — Apollo is waiting for a fresh check after a recent event.
  if (resolution.recovering) {
    return {
      protectionStatus: "reduced",
      protectionGuidance: "Apollo resolved a recent alert and is waiting for a fresh check to confirm things are clear.",
    };
  }

  // Gate issues without failures (e.g. permission needed).
  if (gateIssues.length > 0) {
    const gateNames = Array.from(new Set(gateIssues.map((g) => g.gate).filter(Boolean)));
    const names = joinNames(gateNames);
    return {
      protectionStatus: "action_needed",
      protectionGuidance: `${names} ${gateIssues.length === 1 ? "needs" : "need"} attention. I'll show you what needs fixing.`,
    };
  }

  // All protections running normally.
  if (coverage.overall === "full") {
    return { protectionStatus: "watching" };
  }

  // Platform limited — no action needed for unsupported features.
  if (coverage.platformLimited) {
    return { protectionStatus: "watching", coverageNote: "Some protections are not available on this device." };
  }

  // Partial or unknown — not a problem unless something failed.
  return {};
}

// ─── Main Resolver ──────────────────────────────────────────────────────────

export function resolveHomeStatus(input: HomeResolverInput): HomeStatus {
  const { resolution, attention, gates, capabilities, findingCount, platformCanEnforce } = input;

  // Derive three independent pillars.
  const threat = deriveThreatStatus(resolution);
  const coverage = deriveCoverage(gates, capabilities, platformCanEnforce);
  const actions = deriveUserActions(attention, coverage, threat);

  // Derive protection presentation — always independent of threat state.
  const protectionPresentation = deriveProtectionPresentation(resolution, coverage, attention);

  // ── Behavior is driven ONLY by threat state (PRD Section 3) ──
  // Protection problems never independently change Apollo's threat behavior.
  let behavior: ApolloState = resolution.state;
  let headline: string;
  let explanation: string;
  let primaryAction: HomeStatus["primaryAction"] | undefined;
  let coverageNote: string | undefined = protectionPresentation.coverageNote;

  // ── Event-driven threat states ──
  if (threat.level === "blocked" && resolution.state === "biting") {
    // Scenario E: Threat successfully blocked.
    const what = threat.summary || "a threat";
    headline = "Apollo is biting";
    explanation = `Apollo blocked ${what}. This connection was stopped.`;
    primaryAction = { label: "See what Apollo stopped", route: actions.primaryAction?.route ?? "/protection-details" };

  } else if (threat.level === "confirmed") {
    // Active threat requiring immediate action.
    headline = "Apollo is barking";
    explanation = threat.summary
      ? `Apollo found ${threat.summary}. This needs your attention now.`
      : "Apollo found something that needs your attention now.";
    primaryAction = actions.primaryAction ? { label: actions.primaryAction.title, route: actions.primaryAction.route } : undefined;

  } else if (threat.level === "suspicious") {
    // Suspicious unresolved activity.
    headline = resolution.state === "ears_up" ? "Apollo is sniffing something" : "Apollo is growling";
    explanation = threat.summary
      ? `Apollo spotted ${threat.summary}. I'm checking what it means and whether you need to do anything.`
      : "Apollo spotted something suspicious. I'm checking what it means and whether you need to do anything.";
    primaryAction = threat.drivingEvent
      ? { label: "View suspicious activity", route: `/patrol/${encodeURIComponent(threat.drivingEvent.event_id)}` }
      : { label: "View what Apollo found", route: "/protection-details" };

  // ── No active threat: Apollo rests ──
  // Protection issues are shown via protectionStatus and protectionGuidance,
  // never by changing Apollo's behavior to growling or barking.
  } else {
    behavior = "resting";
    headline = "Apollo is Patrolling";

    // Check if there are active security findings (event attention items, not gate issues).
    const threatAttention = attention.filter((a) => a.kind === "event");
    const securityFindingCount = threatAttention.length;

    if (securityFindingCount > 1) {
      // Multiple security findings still active but at low severity (ears_up or stale).
      const primary = threatAttention[0];
      const primaryProblem = (primary.problem || "").trim();
      const gateNames = Array.from(new Set(threatAttention.map((e) => e.gate).filter(Boolean)));
      const areasPhrase = gateNames.length > 0 ? ` across ${joinNames(gateNames)}` : "";
      const base = noThreatMessage(coverage);
      explanation = primaryProblem
        ? `${base} Apollo noted ${primaryProblem}, along with ${securityFindingCount - 1} other ${securityFindingCount === 2 ? "finding" : "findings"}${areasPhrase} worth reviewing.`
        : `${base} Apollo noted ${securityFindingCount} findings${areasPhrase} worth reviewing.`;
      primaryAction = { label: "View what Apollo noted", route: primary.route || "/protection-details" };
    } else if (securityFindingCount === 1) {
      const primary = threatAttention[0];
      const primaryProblem = (primary.problem || "").trim();
      const base = noThreatMessage(coverage);
      explanation = primaryProblem
        ? `${base} Apollo noted ${primaryProblem} — worth a look when you have a moment.`
        : `${base} Apollo noted something worth a look.`;
      primaryAction = { label: "View what Apollo noted", route: primary.route || "/protection-details" };
    } else {
      // No security findings — pure resting state with protection context.
      const msg = buildRestingMessage(coverage, actions);
      explanation = msg.explanation;
      primaryAction = msg.primaryAction;
      coverageNote = msg.coverageNote ?? coverageNote;
    }

    // If there's a protection issue that needs action, it takes priority for primaryAction
    // (but only when there are no active threat findings).
    if (securityFindingCount === 0 && protectionPresentation.protectionStatus === "action_needed" && actions.primaryAction) {
      primaryAction = { label: actions.primaryAction.title, route: actions.primaryAction.route };
    }
  }

  return {
    behavior,
    headline,
    explanation,
    primaryAction,
    coverageNote,
    protectionStatus: protectionPresentation.protectionStatus,
    protectionGuidance: protectionPresentation.protectionGuidance,
    threat,
    coverage,
    actions,
  };
}
