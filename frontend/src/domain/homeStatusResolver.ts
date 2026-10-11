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

export type CoverageItemState =
  | "active_verified"
  | "active_unverified"
  | "setup_available"
  | "disabled_by_user"
  | "temporarily_unavailable"
  | "unsupported"
  | "unknown";

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

const GATE_LABEL: Record<string, string> = {
  site: "Website protection",
  link: "Link checking",
  text: "Message screening",
  call: "Call screening",
  network: "Internet monitoring",
  account: "Account alerts",
  email: "Email monitoring",
  file: "File checking",
  app: "App checking",
  device: "Device monitoring",
};

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
    const auto = gate.capability.automatic;
    const isAutomatic = !!auto && !auto.manualOnly;
    let state: CoverageItemState;

    if (!auto) {
      state = gate.capability.onDemand?.state === "ready" ? "setup_available" : "unsupported";
    } else if (auto.state === "running" && !auto.manualOnly) {
      state = "active_verified";
    } else if (auto.state === "running" && auto.manualOnly) {
      state = "active_verified"; // manual-only "running" = ready
    } else if (auto.state === "checking") {
      state = "unknown";
    } else if (auto.state === "unsupported") {
      state = "unsupported";
    } else if (auto.state === "off_by_choice") {
      state = "disabled_by_user";
    } else if (auto.state === "permission_needed" || auto.state === "setup_needed" || auto.state === "not_activated") {
      state = "setup_available";
    } else if (auto.state === "interrupted") {
      state = "temporarily_unavailable";
    } else if (auto.state === "temporarily_unavailable") {
      state = "active_unverified";
    } else {
      state = "unknown";
    }

    items.push({
      id: gate.id,
      name: GATE_LABEL[gate.id] ?? gate.title,
      state,
      isAutomatic,
      detail: gate.currentHelp,
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

function buildRestingMessage(coverage: ProtectionCoverage, actions: UserActions): { explanation: string; primaryAction?: HomeStatus["primaryAction"]; coverageNote?: string } {
  // Scenario A: No known threat, optional setup available.
  if (!coverage.platformLimited && actions.level === "optional_setup" && coverage.failedCount === 0) {
    return {
      explanation: "No suspicious activity has been detected in the areas Apollo can currently monitor. There are a few more protections you can set up if you'd like.",
      primaryAction: actions.primaryAction ? { label: "Complete protection setup", route: actions.primaryAction.route } : undefined,
    };
  }

  // Scenario B: No known threat, platform limitations.
  if (coverage.platformLimited) {
    return {
      explanation: "Apollo is watching the areas this device allows it to protect. Some features aren't supported on this device, but there's nothing you need to set up for those features.",
      primaryAction: { label: "View protection coverage", route: "/(tabs)/protection" },
      coverageNote: "Platform-limited: not all protections are available on this device.",
    };
  }

  // Full coverage, no issues — all automatic protections verified.
  if (coverage.overall === "full" && actions.level === "none") {
    return {
      explanation: "No suspicious activity has been detected. Your available protections are running and Apollo will let you know if anything needs attention.",
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
      explanation: `No suspicious activity has been detected. ${note} Manual security checks are ready when you need them.`,
    };
  }

  // No automatic protections running at all (but manual checks work).
  return {
    explanation: "No suspicious activity has been detected. Manual security checks are ready when you need them. Open Protection to see what's available.",
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

// ─── Main Resolver ──────────────────────────────────────────────────────────

export function resolveHomeStatus(input: HomeResolverInput): HomeStatus {
  const { resolution, attention, gates, capabilities, findingCount, platformCanEnforce } = input;

  // Derive three independent pillars.
  const threat = deriveThreatStatus(resolution);
  const coverage = deriveCoverage(gates, capabilities, platformCanEnforce);
  const actions = deriveUserActions(attention, coverage, threat);

  // ── Resolution Priority (PRD Section 5) ──
  // 1. Active threat requiring immediate action
  // 2. Critical protection failures requiring repair
  // 3. Suspicious unresolved activity
  // 4. Recently verified block (protection event)
  // 5. Optional setup and platform limitations (separate from threat)
  // 6. Resting with limitations disclosed
  // 7. Unknown states never silently healthy

  let behavior: ApolloState = resolution.state;
  let headline: string;
  let explanation: string;
  let primaryAction: HomeStatus["primaryAction"] | undefined;
  let coverageNote: string | undefined;

  // ── Priority 1 & 4: Event-driven states (biting, barking, growling with events) ──
  // These are already correctly resolved by the state machine.
  if (threat.level === "blocked" && resolution.state === "biting") {
    // Scenario E: Threat successfully blocked.
    const what = threat.summary || "a threat";
    headline = "Apollo is biting";
    explanation = `Apollo blocked ${what}. This connection was stopped.`;
    primaryAction = { label: "See what Apollo stopped", route: actions.primaryAction?.route ?? "/protection-details" };
  } else if (threat.level === "confirmed") {
    // Priority 1: Active threat requiring immediate action.
    headline = "Apollo is barking";
    explanation = threat.summary
      ? `Apollo found ${threat.summary}. This needs your attention now.`
      : "Apollo found something that needs your attention now.";
    primaryAction = actions.primaryAction ? { label: actions.primaryAction.title, route: actions.primaryAction.route } : undefined;
  } else if (threat.level === "suspicious") {
    // Priority 3: Suspicious unresolved activity — Scenario C.
    headline = resolution.state === "ears_up" ? "Apollo is sniffing something" : "Apollo is growling";
    explanation = threat.summary
      ? `Apollo spotted ${threat.summary}. I'm checking what it means and whether you need to do anything.`
      : "Apollo spotted something suspicious. I'm checking what it means and whether you need to do anything.";
    primaryAction = threat.drivingEvent
      ? { label: "View suspicious activity", route: `/patrol/${encodeURIComponent(threat.drivingEvent.event_id)}` }
      : { label: "View what Apollo found", route: "/protection-details" };

  // ── Priority 2: Critical protection failures (no threat, but protection broken) ──
  } else if (actions.level === "critical_repair" && coverage.failedCount > 0) {
    // Scenario D: Critical protection failure.
    const failedItem = coverage.items.find((i) => i.state === "temporarily_unavailable");
    const failedName = failedItem?.name ?? "Protection";
    behavior = "barking";
    headline = "Apollo is barking";
    explanation = `${failedName} has stopped working. Some activity may no longer be checked. I'll help you turn it back on.`;
    primaryAction = actions.primaryAction ? { label: `Restore ${failedName.toLowerCase()}`, route: actions.primaryAction.route } : { label: "View protection", route: "/protection-details" };

  // ── visibilityLost without driving event — coverage concern, not a threat ──
  } else if (resolution.visibilityLost && !coverage.platformLimited) {
    // Scenario F: Coverage cannot be verified (genuine verification failure).
    behavior = "growling";
    headline = "Apollo is growling";
    const msg = buildCoverageUnverifiedMessage(coverage);
    explanation = msg.explanation;
    primaryAction = msg.primaryAction;

  // ── Recovery period (awaiting fresh check after resolved event) ──
  } else if (resolution.recovering) {
    behavior = "growling";
    headline = "Apollo is growling";
    explanation = "Apollo is staying cautious after a recent alert. He needs a fresh check to confirm things are clear.";
    primaryAction = { label: "View protection details", route: "/protection-details" };

  // ── Multiple attention items (findings > 1) — classify and explain ──
  } else if ((findingCount ?? 0) > 1 && attention.length > 0) {
    headline = `Apollo is ${resolution.state === "barking" ? "barking" : "growling"}`;

    const threatEvents = attention.filter((a) => a.kind === "event");
    const gateIssues = attention.filter((a) => a.kind === "gate");
    const primary = attention[0];

    if (threatEvents.length > 0 && gateIssues.length === 0) {
      const primaryProblem = (primary.problem || "").trim();
      const areasSet = new Set(threatEvents.map((e) => e.gate).filter(Boolean));
      const areas = Array.from(areasSet);
      const areasPhrase = areas.length > 0 ? ` across ${joinNames(areas)}` : "";
      explanation = primaryProblem
        ? `Apollo has spotted ${primaryProblem}${(findingCount ?? 0) > 1 ? `, along with ${(findingCount ?? 0) - 1} other findings${areasPhrase}` : ""}. I'll walk you through each one.`
        : `Apollo has spotted suspicious activity${areasPhrase}. I'll show you what he noticed and what to do next.`;
      primaryAction = { label: "View what Apollo found", route: primary.route || "/protection-details" };
    } else if (gateIssues.length > 0 && threatEvents.length === 0) {
      const gateNames = Array.from(new Set(gateIssues.map((g) => g.gate).filter(Boolean)));
      explanation = `Apollo needs a little attention. ${joinNames(gateNames)} ${gateIssues.length === 1 ? "needs" : "need"} to be checked. I'll show you what needs fixing.`;
      primaryAction = { label: "View Protection Details", route: "/protection-details" };
    } else {
      const primaryProblem = (primary.problem || "").trim();
      explanation = primaryProblem
        ? `Apollo spotted ${primaryProblem}. There are also ${gateIssues.length} protection ${gateIssues.length === 1 ? "area" : "areas"} that need attention.`
        : `Apollo has flagged ${findingCount} items that need attention — a mix of suspicious findings and protection settings.`;
      primaryAction = { label: "View what Apollo found", route: primary.route || "/protection-details" };
    }

  // ── Priority 5 & 6: Resting states ──
  } else {
    behavior = "resting";
    headline = "Apollo is Patrolling";
    const msg = buildRestingMessage(coverage, actions);
    explanation = msg.explanation;
    primaryAction = msg.primaryAction;
    coverageNote = msg.coverageNote;
  }

  return {
    behavior,
    headline,
    explanation,
    primaryAction,
    coverageNote,
    threat,
    coverage,
    actions,
  };
}
