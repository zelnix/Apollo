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
  /** true = rules current, false = out of date, null = Apollo could not read or observe them. */
  rulesCurrent: boolean | null;
  /** Plain-English statement of what was observed about the security rules. */
  rulesDetail: string;
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
  privateDnsActive: boolean | null;
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
  const serviceRunning = !!health.protection && health.protection.state !== "off";

  const issues: string[] = issueGates.map((g) => `${g.title}: ${g.limitation || g.statusLabel}`);
  if (health.ruleBundle?.current === false) issues.push(`Security rules: ${health.ruleBundle.detail}`);

  const rules = health.ruleBundle;
  const facts: ProtectionFacts = {
    serviceRunning,
    secureConnectionActive: !!vpnActive,
    gates,
    rulesCurrent: rules ? rules.current : null,
    rulesDetail: rules
      ? rules.detail
      : "This device can't report the state of Apollo's security rules, so that check isn't available here.",
    currentIssues: issues,
    checkedAt: health.checkedAt,
    network: health.network ? {
      connected: health.network.connected,
      transport: health.network.transport ?? null,
      privateDnsActive: health.network.privateDnsActive ?? null,
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
      ? ["Apollo is running a health check right now. This is the latest snapshot — results may update in a moment."]
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
  if (health.protection && health.protection.state === "off") {
    issues.push("Apollo's protection service is not running.");
  }

  // ── Gate issues ──
  for (const gate of health.gates) {
    if (gate.tone === "action" || gate.tone === "warning") {
      issues.push(`${gate.title}: ${gate.currentHelp || gate.statusLabel}`);
    }
  }

  // ── Network issues ──
  if (health.network && !health.network.connected) {
    issues.push("No internet connection. Some protections are limited until the connection is back.");
  }
  if (health.network?.privateDnsActive) {
    issues.push("Another service on this device is handling its internet lookups, which can bypass Apollo's website protection.");
  }

  return {
    intent: "current_issues",
    facts: { issues, gateCount: health.gates.length },
    summary: issues.length === 0
      ? "No issues need your attention right now. All observed protections are running normally."
      : `${issues.length} ${issues.length === 1 ? "issue needs" : "issues need"} your attention:\n${issues.map((i) => `• ${i}`).join("\n")}`,
    attentionNeeded: issues.length > 0,
    observedAt: health.checkedAt,
    caveats: health.checking ? ["A health check is currently running. These results may update shortly."] : [],
  };
}

/** Get permission statuses. */
export function getPermissionStatus(permissions: ProtectionPermission[]): DiagnosticResult {
  const facts: PermissionFact[] = permissions.map((p) => ({
    id: p.id,
    label: p.title ?? p.id,
    granted: p.granted,
    required: p.essential ?? false,
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
    parts.push("Apollo's secure connection is on.");
    if (siteRunning) parts.push("Website protection is using it to check the addresses your device looks up and block dangerous websites.");
    else parts.push("However, website protection is not currently running.");
  } else {
    parts.push("Apollo's secure connection is off, so website protection can't run.");
    // Use the gate's own limitation/status text rather than generating independently.
    if (siteGate) {
      const reason = siteGate.capability.automatic?.limitation || siteGate.currentHelp;
      parts.push(`Website protection: ${siteGate.statusLabel}. ${reason}`);
    }
  }

  // Read Private DNS from the site gate's limitation (it's already been evaluated there).
  if (health.network?.privateDnsActive) {
    parts.push("Note: another service on this device is handling its internet lookups, which can bypass Apollo's website protection. (Technical detail: Private DNS is active.)");
  }

  return {
    intent: "vpn_status",
    facts: { vpnActive: !!vpnActive, siteGateRunning: !!siteRunning, privateDns: health.network?.privateDnsActive ?? null },
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
    needsAttention: gate.tone === "action" || gate.tone === "warning",
  };
}

function buildProtectionSummary(facts: ProtectionFacts, activeCount: number, totalCount: number): string {
  const parts: string[] = [];

  if (facts.serviceRunning) {
    parts.push(`Apollo is running. ${activeCount} of ${totalCount} protections are active.`);
  } else {
    parts.push("Apollo's protection service is not running. This means your device is not actively protected.");
  }

  if (facts.secureConnectionActive) {
    parts.push("Apollo's secure connection is on.");
  }

  if (facts.rulesCurrent === true) parts.push("Its security rules are up to date.");
  else if (facts.rulesCurrent === false) parts.push("Its security rules are out of date.");
  else parts.push(facts.rulesDetail);

  if (facts.currentIssues.length > 0) {
    parts.push(`${facts.currentIssues.length} ${facts.currentIssues.length === 1 ? "issue needs" : "issues need"} attention: ${facts.currentIssues.join("; ")}.`);
  } else if (!facts.serviceRunning) {
    // Do NOT say "no issues" when the protection service itself is down — that IS the issue
    parts.push("Restoring the protection service is the most important step.");
  } else {
    parts.push("No issues need attention.");
  }

  if (facts.checkedAt) {
    try {
      const time = new Date(facts.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      parts.push(`Last checked at ${time}.`);
    } catch { /* ignore format errors */ }
  }

  return parts.join(" ");
}

function buildGateSummary(gate: GateFact): string {
  const parts = [`${gate.title}: ${gate.statusLabel}.`];
  if (gate.automaticState === "running") {
    parts.push("It's running and protecting you.");
  } else if (gate.automaticState === "off") {
    parts.push("It's currently off.");
  } else if (gate.automaticState) {
    parts.push(`Current state: ${gate.automaticState}.`);
  }
  if (gate.limitation) {
    parts.push(`Limitation: ${gate.limitation}`);
  }
  if (gate.needsAttention) {
    parts.push("This needs your attention.");
  }
  return parts.join(" ");
}
