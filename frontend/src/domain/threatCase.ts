/**
 * Threat Case presentation model — shared adapter that combines PatrolEvent +
 * optional Magnum DI CaseState into a single Threat Case view model.
 *
 * Rules:
 * - PatrolEvent is the primary source of truth for detection/enforcement data.
 * - CaseState is optional — its presence adds investigation information.
 * - The UI must only show states/actions supported by real data.
 * - No fabricated investigation stages, block claims, evidence, or timeline events.
 */

import type { CaseSource } from "./caseSources.ts";
import { subjectDescriptor, threatSubject } from "./threatSubject.ts";
import type {
  ApolloState,
  HigginsBriefing,
  PatrolEnforcementEvidence,
  PatrolEvent,
  PatrolRecord,
  SourceMetadata,
} from "./types";

// ── Threat Case ID ──────────────────────────────────────────────────────────

export function threatCaseId(event: PatrolEvent): string {
  const record = event.patrol_record;
  const raw = record?.recordId ?? event.event_id;
  const suffix = raw.replace(/[^a-zA-Z0-9]/g, "").slice(-5).toUpperCase();
  const year = new Date(event.occurred_at).getFullYear();
  return `TC-${year}-${suffix}`;
}

// ── Case grouping ───────────────────────────────────────────────────────────

/** The key that decides what counts as ONE case in the Threats list. Repeat checks of the same
 *  subject (today: device checks) carry a stable case_key, so they collapse into a single case
 *  showing the latest result while every individual check stays visible in patrol history.
 *  Two records that name the SAME Magnum DI investigation are the same case — this phone's own
 *  record and anything Apollo's servers filed for that investigation collapse into one row. */
export function caseGroupKey(event: PatrolEvent): string {
  const investigation = event.investigation_case_id ?? event.patrol_record?.investigationCaseId;
  return event.case_key ?? event.patrol_record?.logicalIssueKey ?? (investigation ? `inv:${investigation}` : event.event_id);
}

// ── Status ──────────────────────────────────────────────────────────────────

export type ThreatCaseStatus =
  | "investigating"
  | "blocked"
  | "attention"
  | "resolved"
  | "no_threat"
  | "monitoring";

export function threatCaseStatus(event: PatrolEvent): ThreatCaseStatus {
  if (event.resolved_at) {
    if (event.state === "resting") return "no_threat";
    return "resolved";
  }
  // Only claim "blocked" when genuine enforcement evidence confirms it
  if (event.verified_block && event.enforcement_evidence) return "blocked";
  // An investigation is only "investigating" while it is actually running. Once Magnum DI has
  // answered (its result is committed to this device) the case is reported by what it found.
  const hasInvestigation = !!(event.investigation_case_id ?? event.patrol_record?.investigationCaseId);
  if (hasInvestigation && !event.investigation_completed_at) return "investigating";
  // Needs user attention
  if (event.state === "barking" || event.state === "biting") return "attention";
  if (event.state === "growling" || event.state === "ears_up") return "monitoring";
  return "monitoring";
}

export const STATUS_LABELS: Record<ThreatCaseStatus, string> = {
  investigating: "Investigating",
  blocked: "Blocked",
  attention: "Needs you",
  resolved: "Handled",
  no_threat: "No threat",
  monitoring: "Keeping watch",
};

export const STATUS_COLORS: Record<ThreatCaseStatus, { bg: string; text: string }> = {
  investigating: { bg: "#DC2626", text: "#FFFFFF" },
  blocked: { bg: "#059669", text: "#FFFFFF" },
  attention: { bg: "#DC2626", text: "#FFFFFF" },
  resolved: { bg: "#059669", text: "#FFFFFF" },
  no_threat: { bg: "#6B7280", text: "#FFFFFF" },
  monitoring: { bg: "#D97706", text: "#FFFFFF" },
};

// ── Source identity ─────────────────────────────────────────────────────────

export interface SourceIdentity {
  type: string;
  typeLabel: string;
  title: string;
  subtitle: string;
  timestamp: string;
  Icon: React.ComponentType<{ size: number; color: string }>;
  iconBg: string;
  iconFg: string;
}

// ── Risk level ──────────────────────────────────────────────────────────────

export function riskLevel(state: ApolloState): { label: string; color: string } {
  switch (state) {
    case "biting": return { label: "Critical", color: "#DC2626" };
    case "barking": return { label: "High", color: "#DC2626" };
    case "growling": return { label: "Medium", color: "#D97706" };
    case "ears_up": return { label: "Low", color: "#D97706" };
    case "resting": return { label: "None", color: "#059669" };
    default: return { label: "Unknown", color: "#6B7280" };
  }
}

// ── Category label ──────────────────────────────────────────────────────────

export function categoryLabel(cat: string, recordClass?: string | null): string {
  if (recordClass) {
    const MAP: Record<string, string> = {
      phishing: "Phishing (Scam)",
      malware: "Malware",
      impersonation: "Impersonation",
      social_engineering: "Social engineering",
      credential_theft: "Credential theft",
      financial_fraud: "Financial fraud",
      tech_support_scam: "Tech support scam",
      investment_scam: "Investment scam",
      romance_scam: "Romance scam",
      security_threat: "Security threat",
      protection_issue: "Protection issue",
    };
    if (MAP[recordClass]) return MAP[recordClass];
  }
  switch (cat) {
    case "website": return "Website";
    case "call": return "Call";
    case "message": return "Message";
    case "email": return "Email";
    case "device": return "Device";
    case "file": return "File";
    case "app": return "App";
    case "link": return "Link";
    case "account": return "Account";
    default: return "Security";
  }
}

// ── Source label (detection mechanism) ───────────────────────────────────────

export function sourceLabel(event: PatrolEvent): string {
  switch (event.evidence_provenance) {
    case "local_device": return "On-device detection";
    case "dns_observation": return "DNS monitoring";
    case "server_projected": return "Server analysis";
    case "native_protection": return `${event.source_metadata?.provider ?? "Your device"}'s own protection`;
    default:
      switch (event.category) {
        case "email": return "Email app";
        case "message": return "Message app";
        case "call": return "Phone app";
        case "website": case "link": return "Browser / DNS";
        default: return "Apollo detection";
      }
  }
}

// ── Timeline events ─────────────────────────────────────────────────────────

export interface TimelineEntry {
  id: string;
  timestamp: string | null;
  title: string;
  description: string;
  dotColor: string;
  iconId: "detection" | "analysis" | "protection" | "investigation" | "content" | "gathering" | "findings" | "resolution" | "recovery";
  inProgress?: boolean;
}

/**
 * Build a truthful chronological timeline from PatrolEvent data.
 * Only includes events that actually occurred — no fabricated stages.
 */
export function buildTimeline(
  event: PatrolEvent,
  sources: CaseSource[] = [],
  /** What the stored investigation recorded, when there is one. */
  investigation: { completedAt?: string | null; conclusion?: string | null; findingCount?: number } = {},
): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  const record = event.patrol_record;
  const subject = threatSubject(event);
  const headline = (event.headline || "").trim();
  let idx = 0;

  // 1. Detection — name the actual thing Apollo detected, never just the category.
  entries.push({
    id: `tl-${idx++}`,
    timestamp: event.occurred_at,
    title: "Detected by Apollo",
    description: subject
      ? `${categoryLabel(event.category, record?.recordClass)} detected: ${subjectDescriptor(subject)}.`
      : headline
        ? headline.replace(/\.$/, "") + "."
        : `${categoryLabel(event.category, record?.recordClass)} detected and flagged.`,
    dotColor: "#DC2626",
    iconId: "detection",
  });

  // 2. Automatic analysis — recorded as an event with its time only. The analysis itself belongs on
  //    Overview; History is a record of what happened and when.
  if (record?.higginsBriefing) {
    const analysisTime = record.freshness?.observedAt ?? record.higginsBriefing.generated_at;
    entries.push({
      id: `tl-${idx++}`,
      timestamp: analysisTime ?? event.occurred_at,
      title: "Automatic checks completed",
      description: "Apollo finished his automatic checks on this item.",
      dotColor: "#2563EB",
      iconId: "analysis",
    });
  }

  // 3. Protection applied (only if genuine enforcement evidence)
  if (event.verified_block && event.enforcement_evidence) {
    const destination = event.enforcement_evidence.destination_domain;
    entries.push({
      id: `tl-${idx++}`,
      timestamp: event.enforcement_evidence.observed_at,
      title: "Protection applied",
      description: humanMechanism(event.enforcement_evidence.mechanism) +
        (destination ? ` for ${destination}` : "") +
        (event.enforcement_evidence.enforced_action ? `. ${humanAction(event.enforcement_evidence.enforced_action)}` : ""),
      dotColor: "#059669",
      iconId: "protection",
    });
  }

  // 3b. Sources — one step per source Apollo consulted, with what it returned (one line).
  for (const source of sources) {
    entries.push({
      id: `tl-${idx++}`,
      timestamp: source.at ?? event.occurred_at,
      title: source.answered ? `Checked ${source.name}` : `Couldn't check ${source.name}`,
      description: source.returned,
      dotColor: source.answered ? "#2563EB" : "#D97706",
      iconId: "gathering",
    });
  }

  // 4. Magnum DI investigation (only if one actually exists)
  // Factual timeline: Investigation requested → Personal-data protection applied → Sent to Magnum DI
  // → Response received. The first three happened when the case was opened; the response carries the
  // time it was committed to this device and what it actually concluded.
  const investigationId = event.investigation_case_id ?? record?.investigationCaseId;
  if (investigationId) {
    entries.push({
      id: `tl-${idx++}`,
      timestamp: event.occurred_at,
      title: "Investigation requested",
      description: subject
        ? `You requested a Magnum DI investigation for ${subjectDescriptor(subject)}.`
        : "You requested a Magnum DI investigation for this item.",
      dotColor: "#2563EB",
      iconId: "investigation",
    });
    entries.push({
      id: `tl-${idx++}`,
      timestamp: event.occurred_at,
      title: "Personal-data protection applied",
      description: "Credentials removed; your personal information protected before evidence left this device.",
      dotColor: "#059669",
      iconId: "protection",
    });
    entries.push({
      id: `tl-${idx++}`,
      timestamp: event.occurred_at,
      title: "Sent to Magnum DI",
      description: "Protected evidence submitted for investigation.",
      dotColor: "#2563EB",
      iconId: "gathering",
    });
    const conclusion = (investigation.conclusion ?? "").replace(/\s+/g, " ").trim();
    const findingCount = investigation.findingCount ?? (event.why ?? []).length;
    entries.push({
      id: `tl-${idx++}`,
      timestamp: investigation.completedAt ?? null,
      title: investigation.completedAt || conclusion ? "Magnum DI answered" : "Waiting for Magnum DI",
      description: conclusion
        ? `${conclusion}${findingCount ? ` ${findingCount} finding${findingCount === 1 ? "" : "s"} recorded on this device.` : ""}`
        : "Magnum DI has not answered yet.",
      dotColor: "#059669",
      iconId: "findings",
    });
  }

  // 5. Recovery actions (only if actual recovery occurred)
  if (event.recovery_kinds && event.recovery_kinds.length > 0) {
    entries.push({
      id: `tl-${idx++}`,
      timestamp: null,
      title: "Recovery actions taken",
      description: event.recovery_kinds.map(humanRecovery).join(", "),
      dotColor: "#059669",
      iconId: "recovery",
    });
  }

  // 6. Resolution (only if it actually happened — including one a reopen later cleared)
  const resolvedAt = event.resolved_at ?? event.previously_resolved_at ?? null;
  if (resolvedAt) {
    const resolution = record?.resolution;
    entries.push({
      id: `tl-${idx++}`,
      timestamp: resolvedAt,
      title: "Resolved",
      description: resolution?.status
        ? `Status: ${resolution.status.replace(/_/g, " ")}`
        : "This threat case was closed.",
      dotColor: "#059669",
      iconId: "resolution",
    });
  }

  // 7. Reopened by the person — recorded, with its own time.
  if (event.reopened_at) {
    entries.push({
      id: `tl-${idx++}`,
      timestamp: event.reopened_at,
      title: "Reopened by you",
      description: "You reopened this case, so Apollo is tracking it again.",
      dotColor: "#D97706",
      iconId: "recovery",
    });
  }

  return entries;
}

// ── Human-readable helpers ──────────────────────────────────────────────────

function humanMechanism(m: string): string {
  const MAP: Record<string, string> = {
    dns_sinkhole: "DNS-level block applied",
    content_policy: "Content policy filter applied",
    firewall_rule: "Firewall rule enforced",
    browser_interstitial: "Browser warning shown",
    app_block: "App-level block applied",
    packet_drop: "Network packets dropped",
  };
  return MAP[m] ?? m.replace(/_/g, " ");
}

function humanAction(a: string): string {
  const MAP: Record<string, string> = {
    blocked: "Connection blocked",
    warned: "Warning displayed",
    quarantined: "Quarantined for review",
    redirected: "Redirected to safe destination",
    logged: "Logged for review",
  };
  return MAP[a] ?? a.replace(/_/g, " ");
}

function humanRecovery(r: string): string {
  const MAP: Record<string, string> = {
    password_changed: "Password changed",
    account_locked: "Account locked",
    card_frozen: "Card frozen",
    reported_to_bank: "Reported to bank",
    blocked_sender: "Sender blocked",
    reported_to_authority: "Reported to authority",
  };
  return MAP[r] ?? r.replace(/_/g, " ");
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString([], {
    day: "numeric", month: "short", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}
