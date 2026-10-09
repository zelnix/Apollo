// Protection Details — detailed threat-first findings for the "View Protection Details" screen.
// Reuses existing capability + gate presentation + patrol-event data (no new infrastructure).
// THREAT-FIRST: Active threats (grouped by scent_id) appear before gate infrastructure issues.
// Manual capabilities (e.g. Link Gate) are never represented as automatic protection.
// Pure, unit-testable.

import type { AttentionItem } from "./homeAttention";
import type { GatePresentation } from "./gates";
import type { Capability, EventCategory, PatrolEvent } from "./types";
import { STATE_RANK } from "./stateMachine";

/** A finding to render on the Protection Details screen. */
export interface ProtectionFinding {
  id: string;
  /** Gate name, e.g. "Site Gate". */
  gate: string;
  /** For threat-first reporting: the threat headline (distinct from the gate). */
  threatTitle?: string;
  /** Short label for the "kind" of protection — Manual vs Automatic — so the person sees the distinction. */
  kind: "automatic" | "manual";
  kindLabel: "Automatic protection" | "Manual check";
  /** Severity tone used for the status badge. */
  tone: "good" | "limited" | "action" | "neutral" | "off" | "unavailable" | "unverified";
  /** Short status label ("Limited coverage", "Needs setup", "Action needed", "Running"). */
  statusLabel: string;
  /** What Apollo found — plain English from real data. */
  whatFound: string;
  /** What it means — one sentence interpretation of the status. */
  whatItMeans: string;
  /** What to do — the specific action for the person, when one is needed. */
  whatToDo: string;
  /** Action label + route (route optional — some findings are informational). */
  actionLabel?: string;
  route?: string;
  /** Threat-first: when the threat was first detected (local date/time). */
  firstDetected?: string;
  /** Threat-first: latest activity on this threat. */
  latestActivity?: string;
  /** Threat-first: how many events are grouped under this threat. */
  eventCount?: number;
  /** Whether this is a threat finding (event-based) vs infrastructure (gate/capability). */
  findingType: "threat" | "infrastructure";
}

/** Capability id → gate title / kind. Mirrors the ApolloHero's affected-capability list. */
const CAPABILITY_META: Record<Capability["id"], { gate: string; kind: ProtectionFinding["kind"]; route: string }> = {
  link_guard:       { gate: "Link Gate",           kind: "manual",    route: "/check" },
  site_guard:       { gate: "Site Gate",           kind: "automatic", route: "/(tabs)/guard?gate=site" },
  connection_guard: { gate: "Internet Gate",       kind: "automatic", route: "/network" },
  known_threats:    { gate: "Known Threat Lookup", kind: "manual",    route: "/check" },
  share_intake:     { gate: "Share to Apollo",     kind: "manual",    route: "/(tabs)/check-it" },
  message_guard:    { gate: "Text Gate",           kind: "automatic", route: "/text-guard" },
  app_guard:        { gate: "App Gate",            kind: "manual",    route: "/app-check" },
};

const GATE_ROUTE_BY_ID: Record<GatePresentation["id"], string> = {
  site: "/(tabs)/guard?gate=site", link: "/check", text: "/text-guard", call: "/call-guard",
  network: "/network", account: "/account", email: "/email", file: "/file", app: "/app-check", device: "/device",
};

/** Which gate a Patrol event belongs to (for naming the affected gate on the threat card). */
const GATE_FOR_CATEGORY: Record<string, string> = {
  link: "Link Gate", website: "Site Gate", known_threat: "Site Gate", protection: "Site Gate",
  connection: "Internet Gate", system: "Device Gate", device: "Device Gate", message: "Text Gate",
  call: "Call Gate", app: "App Gate", account: "Account Gate", email: "Email Gate", file: "File Gate",
  family: "Family alert",
};

/** A gate is "manual" when it has no automatic capability or that capability is manual-only. */
function gateKind(g: GatePresentation): ProtectionFinding["kind"] {
  const auto = g.capability.automatic;
  if (!auto) return "manual";
  if (auto.manualOnly) return "manual";
  return "automatic";
}

/** Plain-English interpretation of a capability status. */
function capabilityMeaning(c: Capability, kind: ProtectionFinding["kind"]): string {
  switch (c.status) {
    case "permission_required":
      return kind === "manual"
        ? "This manual check needs a permission before it can run."
        : "This automatic protection is enabled but is waiting for a permission before it can run.";
    case "inactive":
      return kind === "manual"
        ? "This manual check isn't currently available."
        : "This automatic protection isn't running right now, so it may have limited coverage.";
    case "available":
      return kind === "manual"
        ? "Ready for a manual check — not continuous background protection."
        : "Available but not currently active, so it isn't filtering yet.";
    case "unsupported":
      return "Not supported on this device or browser right now.";
    default:
      return "Status could not be confirmed.";
  }
}

/** Build the ordered list of findings for the Protection Details screen. THREAT-FIRST ordering:
 *  1. Active threats (grouped by scent_id / individual events) — the things the person cares about.
 *  2. Gate infrastructure failures (protection stopped, permissions needed).
 *  3. Capabilities that aren't active (limited coverage).
 *  4. Gates with 'limited' or 'unverified' tone.
 *  Threats are grouped by scent_id when available, otherwise each event is its own finding.
 *  Resolved/trusted events are EXCLUDED from active threat findings. */
export function buildProtectionFindings(input: {
  capabilities: Capability[];
  gates: GatePresentation[];
  attention: AttentionItem[];
  events: PatrolEvent[];
}): ProtectionFinding[] {
  const findings: ProtectionFinding[] = [];
  const seenGates = new Set<string>();
  const seenEventIds = new Set<string>();

  // ── 1) Active findings from events — grouped by scent_id or indicator_host for connected incidents ──
  const activeEvents = input.events.filter(
    (e) => (e.status === "active" || (e.status === "blocked" && !e.resolved_at))
      && (e.state === "barking" || e.state === "growling" || e.state === "ears_up" || e.state === "biting"),
  );
  // Group by scent_id first; when absent, correlate by indicator_host (same destination = same incident).
  // Events with neither are standalone.
  const findingGroups = new Map<string, PatrolEvent[]>();
  for (const e of activeEvents) {
    const key = e.scent_id ?? (e.indicator_host ? `host:${e.indicator_host}` : e.event_id);
    const group = findingGroups.get(key) ?? [];
    group.push(e);
    findingGroups.set(key, group);
  }

  for (const [groupKey, groupEvents] of findingGroups) {
    // Sort by severity (highest first), then newest first.
    const sorted = groupEvents.sort((a, b) => {
      const rankDiff = STATE_RANK[b.state] - STATE_RANK[a.state];
      return rankDiff !== 0 ? rankDiff : Date.parse(b.occurred_at) - Date.parse(a.occurred_at);
    });
    const lead = sorted[0];
    const gate = GATE_FOR_CATEGORY[lead.category] ?? "Apollo";
    const firstDetected = sorted.reduce((earliest, e) => {
      const t = Date.parse(e.occurred_at);
      return t < earliest ? t : earliest;
    }, Date.parse(sorted[0].occurred_at));
    const latestActivity = sorted.reduce((latest, e) => {
      const t = Date.parse(e.occurred_at);
      return t > latest ? t : latest;
    }, Date.parse(sorted[0].occurred_at));

    const headline = lead.headline && !/^[a-z_]+$/.test(lead.headline) ? lead.headline : gate;
    const problem = (lead.what_happened || lead.headline || "").trim();
    sorted.forEach((e) => seenEventIds.add(e.event_id));

    // Determine whether this is from a manual gate check.
    const isManualGate = ["link", "message", "call", "file", "app"].includes(lead.category);

    // Severity-accurate classification — not everything is a "threat".
    const classification: "blocked_threat" | "confirmed_concern" | "possible_concern" | "observation" =
      lead.state === "biting" ? "blocked_threat"
      : lead.state === "barking" ? "confirmed_concern"
      : lead.state === "growling" ? "possible_concern"
      : "observation";

    const statusLabels: Record<typeof classification, string> = {
      blocked_threat: "Blocked",
      confirmed_concern: "Needs your decision",
      possible_concern: "Possible concern",
      observation: "Worth checking",
    };
    const whatItMeansLabels: Record<typeof classification, string> = {
      blocked_threat: "Apollo observed and blocked a connection. Review the enforcement evidence to decide your next steps.",
      confirmed_concern: "Apollo identified a specific concern and wants your decision before anything happens next.",
      possible_concern: "Apollo flagged a possible concern. A closer look will confirm whether action is needed.",
      observation: "Apollo noticed a pattern that is worth checking. No action has been taken yet.",
    };

    findings.push({
      id: `finding:${groupKey}`,
      gate,
      threatTitle: headline,
      kind: isManualGate ? "manual" : "automatic",
      kindLabel: isManualGate ? "Manual check" : "Automatic protection",
      tone: classification === "blocked_threat" || classification === "confirmed_concern" ? "action" : "limited",
      statusLabel: statusLabels[classification],
      whatFound: problem || `Apollo ${classification === "observation" ? "noticed something" : "identified a concern"} via ${gate}.`,
      whatItMeans: whatItMeansLabels[classification],
      whatToDo: (lead.what_to_do || "").trim() || "Open the investigation to see exactly what to do next.",
      actionLabel: "Open investigation",
      route: `/patrol/${encodeURIComponent(lead.event_id)}`,
      firstDetected: new Date(firstDetected).toLocaleString(),
      latestActivity: new Date(latestActivity).toLocaleString(),
      eventCount: sorted.length,
      findingType: "threat",
    });
  }

  // ── 2) Gate infrastructure failures (protection stopped / needs setup) ──
  for (const item of input.attention) {
    if (item.kind === "gate") {
      if (seenGates.has(item.gate)) continue;
      seenGates.add(item.gate);
      const gate = input.gates.find((g) => g.title === item.gate);
      const kind = gate ? gateKind(gate) : "automatic";
      findings.push({
        id: item.id,
        gate: item.gate,
        kind,
        kindLabel: kind === "manual" ? "Manual check" : "Automatic protection",
        tone: "action",
        statusLabel: "Action needed",
        whatFound: item.problem,
        whatItMeans: kind === "manual"
          ? "A manual check Apollo relies on isn't currently working."
          : "Automatic protection was running but has stopped, so it may have reduced coverage.",
        whatToDo: item.higgins,
        actionLabel: item.actionLabel,
        route: item.route,
        findingType: "infrastructure",
      });
    }
    // Skip event-type attention items — they're already grouped above as threats.
  }

  // ── 3) Capabilities that aren't currently 'active' ──
  for (const c of input.capabilities) {
    if (c.status === "active" || c.status === "coming_later") continue;
    if (c.status === "unsupported") continue;
    const meta = CAPABILITY_META[c.id];
    if (!meta) continue;
    if (seenGates.has(meta.gate)) continue;
    const whatToDo = c.status === "permission_required"
      ? `Open ${meta.gate} to grant the permission so Apollo can resume this protection.`
      : c.status === "available"
        ? `Open ${meta.gate} when you want to use this check.`
        : `Open ${meta.gate} to see what's needed next.`;
    findings.push({
      id: `cap:${c.id}`,
      gate: meta.gate,
      kind: meta.kind,
      kindLabel: meta.kind === "manual" ? "Manual check" : "Automatic protection",
      tone: c.status === "permission_required" ? "limited" : c.status === "available" ? "neutral" : "unverified",
      statusLabel: c.status === "permission_required" ? "Permission needed"
        : c.status === "available" ? "Ready when you need it"
        : c.status === "inactive" ? "Limited coverage"
        : "Status unknown",
      whatFound: c.detail,
      whatItMeans: capabilityMeaning(c, meta.kind),
      whatToDo,
      actionLabel: `Open ${meta.gate}`,
      route: meta.route,
      findingType: "infrastructure",
    });
    seenGates.add(meta.gate);
  }

  // ── 4) Gates with limited / unable-to-verify tone ──
  for (const g of input.gates) {
    if (seenGates.has(g.title)) continue;
    if (g.tone !== "limited" && g.tone !== "unverified") continue;
    const kind = gateKind(g);
    findings.push({
      id: `gate:${g.id}`,
      gate: g.title,
      kind,
      kindLabel: kind === "manual" ? "Manual check" : "Automatic protection",
      tone: g.tone,
      statusLabel: g.tone === "limited" ? "Limited coverage" : "Unable to verify",
      whatFound: g.currentHelp,
      whatItMeans: g.tone === "limited"
        ? "This protection is active but is running with less than full coverage right now."
        : "Apollo couldn't confirm this protection from recent evidence — it may still be running.",
      whatToDo: g.capability.automatic?.limitation
        ?? (g.primaryAction?.label ? `${g.primaryAction.label} to see more.` : `Open ${g.title} for details.`),
      actionLabel: g.primaryAction?.label ?? `Open ${g.title}`,
      route: GATE_ROUTE_BY_ID[g.id],
      findingType: "infrastructure",
    });
    seenGates.add(g.title);
  }

  return findings;
}

/** Count distinct unresolved findings for the home summary. Grouped by scent_id or indicator_host. */
export function countDistinctFindings(events: PatrolEvent[]): number {
  const seen = new Set<string>();
  for (const e of events) {
    if (e.status !== "active" && !(e.status === "blocked" && !e.resolved_at)) continue;
    if (e.state !== "barking" && e.state !== "growling" && e.state !== "ears_up" && e.state !== "biting") continue;
    seen.add(e.scent_id ?? (e.indicator_host ? `host:${e.indicator_host}` : e.event_id));
  }
  return seen.size;
}
