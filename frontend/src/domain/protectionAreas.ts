// Protection Areas — maps the 10 internal Gates into 5 user-facing protection areas.
// The areas are PRESENTATION GROUPS, not new protection engines. Each area shows its
// constituent gates' individual capability coverage. An area is never summarised as
// "Watching" just because one underlying gate is active.
//
// Pure, unit-testable: no React, no navigation, no side effects.

import type { GatePresentation, GateId, GateStatusLabel, GateTone } from "./gates";

/** The five user-facing protection areas, in display order. */
export type ProtectionAreaId = "websites_links" | "messages_calls" | "email_accounts" | "apps_files" | "device_internet";

export interface ProtectionAreaCapability {
  gateId: GateId;
  /** User-facing name for this capability (e.g. "Website filtering", "Link checking"). */
  label: string;
  /** The Gate's actual internal name (e.g. "Site Gate", "Link Gate"). Shown secondarily
   *  inside the expandable "How Apollo protects you" details. */
  gateName: string;
  /** Whether this is automatic background protection or a manual check. */
  mode: "automatic" | "manual";
  /** Current status label from the gate's own reporting. */
  statusLabel: GateStatusLabel;
  /** Visual tone. */
  tone: GateTone;
  /** One-line explanation of what this capability is doing now. */
  currentHelp: string;
  /** Gate's own limitation text, if any. */
  limitation?: string;
  /** The gate's primary action, if any. */
  primaryAction?: { label: string; id: string };
}

export interface ProtectionArea {
  id: ProtectionAreaId;
  /** Display title shown to the user. */
  title: string;
  /** Short explanation of what this area covers. */
  description: string;
  /** Individual capability lines — one per gate in this area. */
  capabilities: ProtectionAreaCapability[];
  /** Area-level summary: the most important status among its gates. Never "Watching"
   *  unless EVERY automatic capability in the area is Watching. */
  summaryStatus: string;
  /** Area-level tone — derived from the worst individual capability tone. */
  summaryTone: GateTone;
  /** How many automatic capabilities are actively Watching. */
  watchingCount: number;
  /** Total automatic capabilities in this area. */
  automaticCount: number;
  /** How many capabilities need attention (tone "action"). */
  attentionCount: number;
}

/** Gate IDs that belong to each area, in display order. */
const AREA_GATES: Record<ProtectionAreaId, GateId[]> = {
  websites_links: ["site", "link"],
  messages_calls: ["text", "call"],
  email_accounts: ["email", "account"],
  apps_files: ["app", "file"],
  device_internet: ["device", "network"],
};

/** Friendly capability labels per gate, used inside the area detail. */
const CAPABILITY_LABELS: Record<GateId, string> = {
  site: "Website filtering",
  link: "Link checking",
  text: "Message screening",
  call: "Call screening",
  email: "Email monitoring",
  account: "Account alerts",
  file: "File checking",
  app: "App checking",
  device: "Device monitoring",
  network: "Internet monitoring",
};

const AREA_META: Record<ProtectionAreaId, { title: string; description: string }> = {
  websites_links: {
    title: "Websites & Links",
    description: "Protection against dangerous websites, phishing links and harmful downloads.",
  },
  messages_calls: {
    title: "Messages & Calls",
    description: "Screening for scam messages, fake alerts and suspicious callers.",
  },
  email_accounts: {
    title: "Email & Accounts",
    description: "Monitoring for phishing emails, impersonation and account exposure.",
  },
  apps_files: {
    title: "Apps & Files",
    description: "Checking apps and files for suspicious content and unsafe behaviour.",
  },
  device_internet: {
    title: "Device & Internet",
    description: "Monitoring device health, permissions and internet connection safety.",
  },
};

/** Tone severity rank (worst = highest). */
const TONE_RANK: Record<GateTone, number> = {
  action: 6,
  unverified: 5,
  limited: 4,
  off: 3,
  unavailable: 2,
  neutral: 1,
  good: 0,
};

function gateMode(gate: GatePresentation): "automatic" | "manual" {
  const auto = gate.capability.automatic;
  if (!auto) return "manual";
  if (auto.manualOnly) return "manual";
  return "automatic";
}

function buildCapability(gate: GatePresentation): ProtectionAreaCapability {
  return {
    gateId: gate.id,
    label: CAPABILITY_LABELS[gate.id],
    gateName: gate.title,
    mode: gateMode(gate),
    statusLabel: gate.statusLabel,
    tone: gate.tone,
    currentHelp: gate.currentHelp,
    limitation: gate.capability.automatic?.limitation,
    primaryAction: gate.primaryAction ? { label: gate.primaryAction.label, id: gate.primaryAction.id } : undefined,
  };
}

/** Derive the area-level summary status. Rules:
 *  - If ANY capability needs attention → "Attention required"
 *  - If any automatic capability is limited/unverified → "Some limits"
 *  - If ALL automatic capabilities are Watching → "Watching"
 *  - If SOME automatic capabilities are Watching → "{N} of {M} watching"
 *  - If no automatic capabilities (all manual) → "Available to check"
 *  - If everything is off/unavailable → "Setup required" or "Limited"
 */
function deriveSummary(capabilities: ProtectionAreaCapability[]): { status: string; tone: GateTone } {
  const attention = capabilities.filter((c) => c.tone === "action");
  if (attention.length > 0) {
    return { status: "Attention required", tone: "action" };
  }

  const automatics = capabilities.filter((c) => c.mode === "automatic");
  const watching = automatics.filter((c) => c.statusLabel === "Watching");
  const limited = capabilities.filter((c) => c.tone === "limited" || c.tone === "unverified");
  const off = capabilities.filter((c) => c.tone === "off");
  const unavailable = capabilities.filter((c) => c.tone === "unavailable");

  if (automatics.length === 0) {
    // All-manual area (e.g. Apps & Files)
    const allUnavailable = capabilities.every((c) => c.tone === "unavailable");
    if (allUnavailable) return { status: "Not available", tone: "unavailable" };
    return { status: "Available to check", tone: "neutral" };
  }

  if (watching.length === automatics.length && limited.length === 0) {
    return { status: "Watching", tone: "good" };
  }

  if (watching.length > 0 && watching.length < automatics.length) {
    if (limited.length > 0) {
      return { status: `${watching.length} of ${automatics.length} watching, some limits`, tone: "limited" };
    }
    return { status: `${watching.length} of ${automatics.length} watching`, tone: "neutral" };
  }

  if (limited.length > 0) {
    return { status: "Limited", tone: "limited" };
  }

  if (off.length > 0 && off.length === capabilities.length) {
    return { status: "Off", tone: "off" };
  }

  if (capabilities.some((c) => c.statusLabel === "Setup required")) {
    return { status: "Setup available", tone: "neutral" };
  }

  if (capabilities.some((c) => c.statusLabel === "Check in progress")) {
    return { status: "Checking", tone: "neutral" };
  }

  if (unavailable.length === capabilities.length) {
    return { status: "Not available", tone: "unavailable" };
  }

  // Catch-all
  const worstTone = capabilities.reduce<GateTone>(
    (worst, c) => (TONE_RANK[c.tone] > TONE_RANK[worst] ? c.tone : worst),
    "good",
  );
  return { status: "Limited", tone: worstTone };
}

/** Build the 5 protection areas from the current gate health state. */
export function buildProtectionAreas(gates: GatePresentation[]): ProtectionArea[] {
  const gateMap = new Map(gates.map((g) => [g.id, g]));
  const areaIds: ProtectionAreaId[] = ["websites_links", "messages_calls", "email_accounts", "apps_files", "device_internet"];

  return areaIds.map((areaId) => {
    const gateIds = AREA_GATES[areaId];
    const areaGates = gateIds.map((id) => gateMap.get(id)).filter(Boolean) as GatePresentation[];
    const capabilities = areaGates.map(buildCapability);
    const { status, tone } = deriveSummary(capabilities);
    const automatics = capabilities.filter((c) => c.mode === "automatic");
    const watching = automatics.filter((c) => c.statusLabel === "Watching");
    const attention = capabilities.filter((c) => c.tone === "action");
    const meta = AREA_META[areaId];

    return {
      id: areaId,
      title: meta.title,
      description: meta.description,
      capabilities,
      summaryStatus: status,
      summaryTone: tone,
      watchingCount: watching.length,
      automaticCount: automatics.length,
      attentionCount: attention.length,
    };
  });
}

/** Area display order is fixed — this is the canonical list. */
export const AREA_ORDER: ProtectionAreaId[] = ["websites_links", "messages_calls", "email_accounts", "apps_files", "device_internet"];

/** Map a gate ID back to its containing area. */
export function areaForGate(gateId: GateId): ProtectionAreaId {
  for (const [areaId, gateIds] of Object.entries(AREA_GATES)) {
    if ((gateIds as GateId[]).includes(gateId)) return areaId as ProtectionAreaId;
  }
  return "device_internet"; // fallback
}
