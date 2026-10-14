// Dashboard protection categories — maps the 10 internal Gates into
// 8 user-facing categories for the 2-column Protection Dashboard grid.
// These are PRESENTATION GROUPS matching the approved mockup layout.
// Each category references the same underlying Gate architecture.

import type { GatePresentation, GateId, GateTone } from "./gates";
import type { ProtectionAreaCapability } from "./protectionAreas";

export type DashboardCategoryId =
  | "internet"
  | "messages"
  | "calls"
  | "email"
  | "identity"
  | "apps"
  | "device"
  | "network";

export interface DashboardCategory {
  id: DashboardCategoryId;
  title: string;
  icon: string;
  gateIds: GateId[];
  capabilities: ProtectionAreaCapability[];
  summaryStatus: string;
  summaryTone: GateTone;
  gateCount: number;
  /** Parent area id for content lookup */
  parentAreaId: string;
}

const CATEGORY_DEFINITIONS: {
  id: DashboardCategoryId;
  title: string;
  icon: string;
  gateIds: GateId[];
  parentAreaId: string;
}[] = [
  { id: "internet", title: "Internet", icon: "globe", gateIds: ["site", "link"], parentAreaId: "websites_links" },
  { id: "messages", title: "Messages", icon: "message-square", gateIds: ["text"], parentAreaId: "messages_calls" },
  { id: "email", title: "Email", icon: "mail", gateIds: ["email"], parentAreaId: "email_accounts" },
  { id: "apps", title: "Apps", icon: "grid-2x2", gateIds: ["app", "file"], parentAreaId: "apps_files" },
  { id: "device", title: "Device", icon: "smartphone", gateIds: ["device"], parentAreaId: "device_internet" },
  { id: "network", title: "Network", icon: "wifi", gateIds: ["network"], parentAreaId: "device_internet" },
  { id: "identity", title: "Identity", icon: "user", gateIds: ["account"], parentAreaId: "email_accounts" },
  { id: "calls", title: "Calls", icon: "phone", gateIds: ["call"], parentAreaId: "messages_calls" },
];

/** Tone severity rank. */
const TONE_RANK: Record<GateTone, number> = {
  action: 6, unverified: 5, limited: 4, off: 3, unavailable: 2, neutral: 1, good: 0,
};

function gateMode(gate: GatePresentation): "automatic" | "manual" {
  const auto = gate.capability.automatic;
  if (!auto) return "manual";
  if (auto.manualOnly) return "manual";
  return "automatic";
}

function buildCapability(gate: GatePresentation): ProtectionAreaCapability {
  const LABELS: Record<GateId, string> = {
    site: "Website filtering", link: "Link checking", text: "Message screening",
    call: "Call screening", email: "Email monitoring", account: "Account alerts",
    file: "File checking", app: "App checking", device: "Device monitoring", network: "Internet monitoring",
  };
  const TECH: Record<GateId, string> = {
    site: "Site Gate", link: "Link Gate", text: "Text Gate", call: "Call Gate",
    network: "Internet Gate", account: "Account Gate", email: "Email Gate",
    file: "File Gate", app: "App Gate", device: "Device Gate",
  };
  return {
    gateId: gate.id,
    label: LABELS[gate.id],
    gateName: TECH[gate.id],
    mode: gateMode(gate),
    statusLabel: gate.statusLabel,
    tone: gate.tone,
    currentHelp: gate.currentHelp,
    limitation: gate.capability.automatic?.limitation,
    primaryAction: gate.primaryAction ? { label: gate.primaryAction.label, id: gate.primaryAction.id } : undefined,
  };
}

function deriveSummary(capabilities: ProtectionAreaCapability[]): { status: string; tone: GateTone } {
  const attention = capabilities.filter((c) => c.tone === "action");
  if (attention.length > 0) return { status: "Needs attention", tone: "action" };

  const automatics = capabilities.filter((c) => c.mode === "automatic");
  const watching = automatics.filter((c) => c.statusLabel === "Watching");
  const limited = capabilities.filter((c) => c.tone === "limited" || c.tone === "unverified");

  if (automatics.length === 0) {
    const allUnavailable = capabilities.every((c) => c.tone === "unavailable");
    if (allUnavailable) return { status: "Unavailable", tone: "unavailable" };
    return { status: "Ready to check", tone: "neutral" };
  }
  if (watching.length === automatics.length && limited.length === 0) return { status: "All good", tone: "good" };
  if (limited.length > 0) return { status: "Limited", tone: "limited" };
  if (watching.length > 0) return { status: "All good", tone: "good" };
  if (capabilities.some((c) => c.statusLabel === "Check in progress")) return { status: "Checking", tone: "neutral" };
  return { status: "Ready to check", tone: "neutral" };
}

/** Build the 8 dashboard categories from current gate health. */
export function buildDashboardCategories(gates: GatePresentation[]): DashboardCategory[] {
  const gateMap = new Map(gates.map((g) => [g.id, g]));

  return CATEGORY_DEFINITIONS.map((def) => {
    const catGates = def.gateIds.map((id) => gateMap.get(id)).filter(Boolean) as GatePresentation[];
    const capabilities = catGates.map(buildCapability);
    const { status, tone } = deriveSummary(capabilities);

    return {
      id: def.id,
      title: def.title,
      icon: def.icon,
      gateIds: def.gateIds,
      capabilities,
      summaryStatus: status,
      summaryTone: tone,
      gateCount: catGates.length,
      parentAreaId: def.parentAreaId,
    };
  });
}

export const DASHBOARD_CATEGORY_ORDER: DashboardCategoryId[] = [
  "internet", "messages", "email", "apps", "device", "network", "identity", "calls",
];
