// Protection Details — detailed, per-gate findings for the "View Protection Details" screen.
// Reuses existing capability + gate presentation + patrol-event data (no new infrastructure).
// Each finding is one of three outcomes: an active-protection problem, a manual-check limitation,
// or an active-event concern. Manual capabilities (e.g. Link Gate) are never represented as
// automatic protection. Pure, unit-testable.

import type { AttentionItem } from "./homeAttention";
import type { GatePresentation } from "./gates";
import type { Capability, PatrolEvent } from "./types";

/** A finding to render on the Protection Details screen. */
export interface ProtectionFinding {
  id: string;
  /** Gate name, e.g. "Site Gate". */
  gate: string;
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

/** Build the ordered list of findings for the Protection Details screen. Order:
 *  1. Verified gate failures ('action').
 *  2. Active patrol events (barking / growling / ears_up).
 *  3. Capabilities that aren't active (limited coverage).
 *  4. Gates with 'limited' or 'unverified' tone (reduced-coverage automatic protection).
 *  De-duplicated by gate name so a gate problem + a matching capability gap aren't shown twice. */
export function buildProtectionFindings(input: {
  capabilities: Capability[];
  gates: GatePresentation[];
  attention: AttentionItem[];
  events: PatrolEvent[];
}): ProtectionFinding[] {
  const findings: ProtectionFinding[] = [];
  const seenGates = new Set<string>();

  const push = (f: ProtectionFinding) => {
    if (seenGates.has(f.gate)) return;
    seenGates.add(f.gate);
    findings.push(f);
  };

  // 1 + 2) Everything already surfaced on Home ("needs attention") — gate failures and active events.
  for (const item of input.attention) {
    if (item.kind === "gate") {
      const gate = input.gates.find((g) => g.title === item.gate);
      const kind = gate ? gateKind(gate) : "automatic";
      push({
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
      });
    } else if (item.event) {
      const e = item.event;
      push({
        id: item.id,
        gate: item.gate,
        kind: "automatic",
        kindLabel: "Automatic protection",
        tone: e.state === "barking" ? "action" : "limited",
        statusLabel: e.state === "barking" ? "Needs your decision" : "Worth a look",
        whatFound: item.problem,
        whatItMeans: e.state === "barking"
          ? "Apollo flagged this and wants your decision before anything happens next."
          : "Apollo isn't certain yet — a closer look will confirm whether it's a real concern.",
        whatToDo: item.higgins,
        actionLabel: "Open investigation",
        route: item.route,
      });
    }
  }

  // 3) Capabilities that aren't currently 'active' (and aren't marked unsupported / coming_later).
  for (const c of input.capabilities) {
    if (c.status === "active" || c.status === "coming_later") continue;
    if (c.status === "unsupported") continue; // intentionally hidden — "not applicable" isn't a concern.
    const meta = CAPABILITY_META[c.id];
    if (!meta) continue;
    if (seenGates.has(meta.gate)) continue;
    const whatToDo = c.status === "permission_required"
      ? `Open ${meta.gate} to grant the permission so Apollo can resume this protection.`
      : c.status === "available"
        ? `Open ${meta.gate} when you want to use this check.`
        : `Open ${meta.gate} to see what's needed next.`;
    push({
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
    });
  }

  // 4) Gates with limited / unable-to-verify tone — reduced-coverage automatic protection.
  for (const g of input.gates) {
    if (seenGates.has(g.title)) continue;
    if (g.tone !== "limited" && g.tone !== "unverified") continue;
    const kind = gateKind(g);
    push({
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
    });
  }

  return findings;
}
