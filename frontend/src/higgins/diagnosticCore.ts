/**
 * Higgins Diagnostic Core — structured, deterministic local diagnostics.
 *
 * Hard architectural guard:
 *   getProtectionStatus()  → this module only
 *   getGateStatus()        → this module only
 *   getCurrentIssues()     → this module only
 *   investigateThreat(ev)  → Magnum DI only (NOT this module)
 *
 * Returns structured facts, not AI-generated conclusions.
 * Higgins then turns these facts into the short conversational answer.
 *
 * Works in airplane mode using the latest locally observable state.
 */

import type { ProtectionHealthSnapshot, GateHealthRecord } from "@/src/protection/healthTypes";
import type { ProtectionPermission, NetworkStatus } from "@/src/security/SecurityPlatformAdapter";
import type { PatrolEvent } from "@/src/domain/types";

// ── Structured fact types ────────────────────────────────────────────────────

export interface ProtectionFacts {
  serviceRunning: boolean;
  /** Apollo's secure connection (the protection permission the device grants Apollo). */
  secureConnectionActive: boolean;
  gates: GateFact[];
  /** true = Threat Domain List current (any entry count, including 0), false = out of date, null = Apollo could not read or observe it. */
  rulesCurrent: boolean | null;
  /** Plain-English statement of what was observed about the Threat Domain List. */
  rulesDetail: string;
  /** Technical detail: Threat Domain Entries on the phone. 0 is a valid list; null = not reported. */
  threatDomainEntries: number | null;
  currentIssues: string[];
  checkedAt: string | null;
  network: NetworkFact | null;
}

export interface GateFact {
  id: string;
  title: string;
  statusLabel: string;
  tone: string;
  automaticState: string | null;
  limitation: string | null;
  needsAttention: boolean;
}

export interface NetworkFact {
  connected: boolean;
  transport: string | null;
}

export interface PermissionFact {
  id: string;
  label: string;
  granted: boolean;
  required: boolean;
}

export interface DiagnosticResult {
  intent: string;
  facts: Record<string, unknown>;
  /** Plain-English summary Higgins can use directly. */
  summary: string;
  /** Whether something needs the user's attention. */
  attentionNeeded: boolean;
  /** Timestamp of the observation. */
  observedAt: string | null;
  /** Any caveats about the data freshness or completeness. */
  caveats: string[];
}

// ── Diagnostic functions ─────────────────────────────────────────────────────

/** Extract structured protection facts from the health snapshot.
 *  Reads the CANONICAL resolved state from each gate — does not independently infer
 *  protection status from raw permissions or run its own protection-status interpretation. */
export function getProtectionStatus(health: ProtectionHealthSnapshot): DiagnosticResult {
  const gates = health.gates.map(gateToFact);
  const activeGates = gates.filter((g) => g.automaticState === "running");
  const issueGates = gates.filter((g) => g.needsAttention);
  // Derive VPN active from the site gate's canonical resolved state — if site gate
  // is "Watching" (active_verified) with enforcement, the VPN is running.
  const siteGate = health.gates.find((g) => g.id === "site");
  const vpnActive = siteGate?.resolved.coverageState === "active_verified" && siteGate?.resolved.isAutomatic;
  const serviceRunning = !!health.protection && health.protection.running;

  const issues: string[] = issueGates.map((g) => `${g.title}: ${g.limitation || g.statusLabel}`);
  // Only an out-of-date list is an issue. A current list passes whatever its entry count — zero
  // Threat Domain Entries is a valid list.
  if (health.ruleBundle?.current === false) issues.push(`Threat Domain List: ${health.ruleBundle.detail}`);

  const rules = health.ruleBundle;
  const facts: ProtectionFacts = {
    serviceRunning,
    secureConnectionActive: !!vpnActive,
    gates,
    rulesCurrent: rules ? rules.current : null,
    rulesDetail: rules
      ? rules.detail
      : "This device can't report the state of Apollo's Threat Domain List, so that check isn't available here.",
    threatDomainEntries: rules?.entryCount ?? null,
    currentIssues: issues,
    checkedAt: health.checkedAt,
    network: health.network ? {
      connected: health.network.connected,
      transport: health.network.type ?? null,
    } : null,
  };

  const summary = buildProtectionSummary(facts, activeGates.length, gates.length);

  return {
    intent: "protection_status",
    facts: facts as unknown as Record<string, unknown>,
    summary,
    attentionNeeded: issues.length > 0 || !serviceRunning,
    observedAt: health.checkedAt,
    caveats: health.checking
      ? ["Apollo is refreshing this now — it may change in a moment."]
      : [],
  };
}

/** Get the status of a specific gate by ID. */
export function getGateStatus(health: ProtectionHealthSnapshot, gateId: string): DiagnosticResult {
  const gate = health.gates.find((g) => g.id === gateId);
  if (!gate) {
    return {
      intent: `${gateId}_status`,
      facts: {},
      summary: `I don't have information about a gate called "${gateId}". The gates I can see are: ${health.gates.map((g) => g.title).join(", ") || "none"}.`,
      attentionNeeded: false,
      observedAt: health.checkedAt,
      caveats: [],
    };
  }

  const fact = gateToFact(gate);
  return {
    intent: `${gateId}_status`,
    facts: fact as unknown as Record<string, unknown>,
    summary: buildGateSummary(fact),
    attentionNeeded: fact.needsAttention,
    observedAt: health.checkedAt,
    caveats: [],
  };
}

/** Get all current issues that need the user's attention.
 *  Includes gate issues, network issues, AND active patrol events (barking/growling) that drive the Home state. */
export function getCurrentIssues(health: ProtectionHealthSnapshot, extra?: { events?: PatrolEvent[]; resolution?: { state: string; reason: string; drivingEvent: PatrolEvent | null } }): DiagnosticResult {
  const issues: string[] = [];

  // ── Active threats from patrol events (what makes Apollo bark/growl on Home) ──
  if (extra?.resolution?.drivingEvent && (extra.resolution.state === "barking" || extra.resolution.state === "growling")) {
    issues.push(extra.resolution.reason);
  } else if (extra?.events) {
    const active = extra.events.filter((e) => !e.resolved_at && (e.state === "barking" || e.state === "growling"));
    for (const e of active.slice(0, 3)) {
      const cat = e.category ? e.category.charAt(0).toUpperCase() + e.category.slice(1) : "Threat";
      const briefing = e.patrol_record?.higginsBriefing?.established;
      const what = briefing && briefing.length > 10 ? briefing : e.what_happened && e.what_happened.length > 10 ? e.what_happened : null;
      issues.push(what ? `${cat}: ${what.length > 100 ? what.slice(0, 100) + "…" : what}` : `${cat} ${e.state === "barking" ? "flagged as high risk" : "looks suspicious"} — review recommended.`);
    }
  }

  // ── Protection service not running ──
  if (health.protection && !health.protection.running) {
    issues.push("Apollo's protection service is not running.");
  }

  // ── Gate issues ──
  for (const gate of health.gates) {
    if (gate.tone === "action") {
      issues.push(`${gate.title}: ${gate.currentHelp || gate.statusLabel}`);
    }
  }

  // ── Network issues ──
  if (health.network && !health.network.connected) {
    issues.push("No internet connection. Some protections are limited until the connection is back.");
  }

  return {
    intent: "current_issues",
    facts: { issues, gateCount: health.gates.length },
    summary: issues.length === 0
      ? "Nothing needs your attention right now. All the protections Apollo can see are running normally."
      : buildCurrentIssuesSummary(issues, health),
    attentionNeeded: issues.length > 0,
    observedAt: health.checkedAt,
    caveats: health.checking ? ["Apollo is refreshing this now — it may change in a moment."] : [],
  };
}

/** Get permission statuses. */
export function getPermissionStatus(permissions: ProtectionPermission[]): DiagnosticResult {
  const facts: PermissionFact[] = permissions.map((p) => ({
    id: p.id,
    label: p.title ?? p.id,
    granted: p.status === "granted",
    required: p.status !== "not_applicable" && p.status !== "unavailable",
  }));

  const missing = facts.filter((p) => p.required && !p.granted);
  const granted = facts.filter((p) => p.granted);

  return {
    intent: "permission_status",
    facts: { permissions: facts } as unknown as Record<string, unknown>,
    summary: missing.length === 0
      ? `All ${granted.length} required permissions are granted.`
      : `${missing.length} required ${missing.length === 1 ? "permission is" : "permissions are"} missing: ${missing.map((p) => p.label).join(", ")}. Grant ${missing.length === 1 ? "it" : "them"} in Settings to restore full protection.`,
    attentionNeeded: missing.length > 0,
    observedAt: new Date().toISOString(),
    caveats: [],
  };
}

/** Get VPN-specific status.
 *  Reads the site gate's canonical resolved state to determine VPN activity.
 *  Uses the gate's limitation text directly instead of independently generating reasons. */
export function getVpnStatus(health: ProtectionHealthSnapshot): DiagnosticResult {
  const siteGate = health.gates.find((g) => g.id === "site");
  // Use canonical resolved state — if site gate is active_verified and automatic, VPN is running.
  const vpnActive = siteGate?.resolved.coverageState === "active_verified" && siteGate?.resolved.isAutomatic;
  const siteRunning = siteGate?.capability?.automatic?.state === "running";

  const parts: string[] = [];
  if (vpnActive) {
    parts.push("ApolloSG's secure connection is on.");
    if (siteRunning) parts.push("Website protection is using it to check the addresses your device looks up and block dangerous websites.");
    else parts.push("However, website protection is not currently running.");
  } else {
    parts.push("ApolloSG's secure connection is off, so website protection can't run.");
    // Use the gate's own limitation/status text rather than generating independently.
    if (siteGate) {
      const reason = siteGate.capability.automatic?.limitation || siteGate.currentHelp;
      parts.push(`Website protection: ${siteGate.statusLabel}. ${reason}`);
    }
  }

  // Read Private DNS from the site gate's limitation (it's already been evaluated there).
  const siteLimitation = siteGate?.capability.automatic?.limitation;
  if (siteLimitation && /dns/i.test(siteLimitation)) {
    parts.push(`Note: ${siteLimitation}`);
  }

  return {
    intent: "vpn_status",
    facts: { vpnActive: !!vpnActive, siteGateRunning: !!siteRunning },
    summary: parts.join(" "),
    attentionNeeded: !vpnActive,
    observedAt: health.checkedAt,
    caveats: [],
  };
}

/** Get notification status — both OS permission and Apollo alerts channel. */
export function getNotificationDiagnostic(
  notifHealth: import("@/src/push/notifications").NotificationHealth,
): DiagnosticResult {
  if (notifHealth.fullyEnabled) {
    return {
      intent: "notification_status",
      facts: notifHealth as unknown as Record<string, unknown>,
      summary: "Notifications are enabled. Apollo can alert you when threats are detected.",
      attentionNeeded: false,
      observedAt: new Date().toISOString(),
      caveats: [],
    };
  }

  return {
    intent: "notification_status",
    facts: notifHealth as unknown as Record<string, unknown>,
    summary: notifHealth.disabledReason
      ?? "Notifications are not fully enabled. Apollo cannot alert you about threats until notifications are turned on.",
    attentionNeeded: true,
    observedAt: new Date().toISOString(),
    caveats: [],
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function gateToFact(gate: GateHealthRecord): GateFact {
  return {
    id: gate.id,
    title: gate.title,
    statusLabel: gate.statusLabel,
    tone: gate.tone,
    automaticState: gate.capability?.automatic?.state ?? null,
    limitation: gate.capability?.automatic?.limitation ?? null,
    needsAttention: gate.tone === "action",
  };
}

function buildProtectionSummary(facts: ProtectionFacts, activeCount: number, totalCount: number): string {
  // Answer → Meaning → Next action. One problem at a time, one action at a time.
  const attention = facts.gates.filter((g) => g.needsAttention);
  const parts: string[] = [];

  if (!facts.serviceRunning) {
    // Answer
    parts.push("No — Apollo's protection isn't running, so nothing is being checked automatically right now.");
    // Meaning + Next action
    parts.push("That means Apollo can't protect you until it's turned back on. Let's fix that first.");
  } else if (attention.length > 0) {
    const first = attention[0];
    // Answer
    parts.push(`Partly. ${activeCount} of ${totalCount} protections ${activeCount === 1 ? "is" : "are"} on, but ${attention.length === 1 ? "one needs" : `${attention.length} need`} sorting out.`);
    // Meaning + Next action
    parts.push(`The first to fix is ${first.title.toLowerCase()} — ${(first.limitation || first.statusLabel).toLowerCase()}. Once that's on, you'll be better protected.`);
  } else if (activeCount < totalCount) {
    parts.push(`Mostly. ${activeCount} of ${totalCount} protections ${activeCount === 1 ? "is" : "are"} running.`);
    parts.push(`The ${totalCount - activeCount === 1 ? "other one isn't" : `other ${totalCount - activeCount} aren't`} available on this device.`);
  } else {
    parts.push(`Yes — all ${totalCount} protections are on and running.`);
  }

  if (facts.rulesCurrent === false) {
    parts.push("Apollo's Threat Domain List is also out of date, so its checks might miss newer dangerous websites.");
  }

  return parts.join(" ");
}

function buildGateSummary(gate: GateFact): string {
  const parts: string[] = [];
  if (gate.automaticState === "running") {
    parts.push(`${gate.title} is on and protecting you.`);
  } else if (gate.automaticState === "off") {
    parts.push(`${gate.title} is off right now.`);
    if (gate.limitation) parts.push(`That's because ${gate.limitation.charAt(0).toLowerCase()}${gate.limitation.slice(1)}`);
    parts.push("That means Apollo can't check this automatically until it's turned back on.");
  } else {
    parts.push(`${gate.title}: ${gate.statusLabel}.`);
    if (gate.limitation) parts.push(gate.limitation);
  }
  if (gate.needsAttention && gate.automaticState !== "off") {
    parts.push("This needs sorting out to keep you protected.");
  }
  return parts.join(" ");
}

function buildCurrentIssuesSummary(issues: string[], health: ProtectionHealthSnapshot): string {
  const serviceDown = health.protection && !health.protection.running;
  const parts: string[] = [];

  // Answer — what's happening
  if (serviceDown && issues.length === 1) {
    parts.push("Apollo's automatic protection isn't running right now.");
    parts.push("That means nothing is being checked automatically until it's turned back on.");
    parts.push("Let's fix that first.");
  } else if (serviceDown) {
    parts.push("Apollo's automatic protection isn't running, and there are other things that need your attention too.");
    parts.push("Nothing is being checked automatically until protection is turned back on — that's the first thing to fix.");
  } else if (issues.length === 1) {
    parts.push(`There's one thing that needs your attention: ${issues[0].charAt(0).toLowerCase()}${issues[0].slice(1)}`);
    parts.push("Until it's sorted out, that part of your protection isn't working.");
  } else {
    parts.push(`There are ${issues.length} things that need your attention.`);
    // Meaning — why it matters
    const issueDescriptions = issues.map((i) => i.charAt(0).toLowerCase() + i.slice(1));
    parts.push(`The main ones: ${issueDescriptions.slice(0, 3).join(", and ")}.`);
    parts.push("Each one means a gap in your protection until it's addressed.");
  }

  return parts.join(" ");
}
