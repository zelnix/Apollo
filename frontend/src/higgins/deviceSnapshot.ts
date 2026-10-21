// The live reading of this phone's own Apollo state that goes with every Higgins
// question.
//
// Higgins is the savant of Apollo, which means he answers about THIS phone from
// what the phone actually reports — not from inference. This builds that reading.
//
// PRIVACY: state only. Protection statuses, permission states, settings values,
// counts, and headlines Apollo itself wrote. Never a message body, a screenshot,
// a file, a link the person checked, a personal detail or a secret. The egress
// allow-list in `domain/privacy.ts` carries it under `deviceSnapshot`.

import { Platform } from "react-native";

import type { GateItem } from "@/src/domain/gates";
import type { PatrolEvent } from "@/src/domain/types";
import type { ProtectionHealthSnapshot } from "@/src/protection/healthTypes";
import type { NetworkStatus } from "@/src/security/SecurityPlatformAdapter";
import { listEmailAccounts } from "@/src/store/emailAccountStore";
import { loadPersonalData } from "@/src/store/personalDataStore";
import { listSavedChecks } from "@/src/store/savedCheckStore";

export interface SnapshotGate {
  id: string;
  title: string;
  status: string;
  tone: string;
  automatic: boolean;
  coverage: string;
}

export interface DeviceSnapshot {
  platform?: string;
  checkedAt?: string;
  protectionOn?: boolean;
  adapter?: string;
  gates: SnapshotGate[];
  permissions: string[];
  network?: string;
  threatCounts: string[];
  openThreats: string[];
  alerts?: string;
  quietHours?: string;
  batterySaver?: boolean;
  trustedLinks?: number;
  savedChecks?: number;
  personalData?: string;
  callScreener?: string;
  emailAccounts?: string;
  notes: string[];
}

export interface SnapshotExtras {
  savedChecks?: number;
  personalData?: number;
  emailAccounts?: { total: number; connected: number };
}

export interface SnapshotInput {
  health: ProtectionHealthSnapshot;
  events: PatrolEvent[];
  trustCount: number;
  notificationStatus: string;
  quietHours: { enabled: boolean; start_minutes: number; end_minutes: number };
  quietNow: boolean;
  lowPower: boolean;
  adapterLabel: string;
  network: NetworkStatus | null;
  callScreener?: string | null;
  isMock?: boolean;
  extras?: SnapshotExtras;
}

const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

// The backend caps every field. Clamping here means an unusually long reading is
// shortened rather than failing the whole question.
const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

const gateLine = (gate: GateItem): SnapshotGate => ({
  id: clip(gate.id, 40),
  title: clip(gate.title, 60),
  status: clip(gate.statusLabel, 80),
  tone: clip(gate.tone, 20),
  automatic: gate.resolved.isAutomatic,
  coverage: clip(gate.resolved.coverageState, 40),
});

function networkLine(network: NetworkStatus | null): string | undefined {
  if (!network) return undefined;
  const parts = [network.connected ? `connected via ${network.type}` : "not connected"];
  if (network.ssid) parts.push(`network "${network.ssid}"`);
  if (network.wifiSecurity && network.wifiSecurity !== "n/a") parts.push(`Wi-Fi security ${network.wifiSecurity}`);
  if (network.vpnActive) parts.push("VPN active");
  if (network.captivePortal) parts.push("captive portal detected");
  if (!network.inspectable) parts.push("this platform cannot inspect connection safety");
  return clip(parts.join(", "), 240);
}

function threatLines(events: PatrolEvent[]): { counts: string[]; open: string[] } {
  const byState = new Map<string, number>();
  for (const event of events) byState.set(event.state, (byState.get(event.state) ?? 0) + 1);
  const counts = [`${events.length} in total`, ...[...byState.entries()].map(([state, n]) => `${n} ${state}`)];
  const open = events
    .filter((event) => event.status !== "resolved" && event.state !== "resting")
    .slice(0, 8)
    .map((event) => `${event.state} · ${event.category} · ${event.headline}`);
  return { counts, open };
}

/** Read the on-device stores Higgins should also be able to see. */
export async function loadSnapshotExtras(): Promise<SnapshotExtras> {
  const [saved, personal, email] = await Promise.all([
    listSavedChecks().catch(() => []),
    loadPersonalData().catch(() => []),
    listEmailAccounts().catch(() => []),
  ]);
  return {
    savedChecks: saved.length,
    personalData: personal.length,
    emailAccounts: { total: email.length, connected: email.filter((account) => account.connected).length },
  };
}

export function buildDeviceSnapshot(input: SnapshotInput): DeviceSnapshot {
  const { health, events, extras } = input;
  const { counts, open } = threatLines(events);
  const notes: string[] = [];
  if (input.isMock) notes.push("This phone is running Apollo's preview adapter, so protection readings are simulated, not real.");
  if (health.checking) notes.push("A protection status read is in progress right now.");
  if (health.lastCheckFailure) notes.push(`The most recent protection read FAILED (${health.lastCheckFailure.reason}); the statuses above are the previous successful reading.`);
  if (health.ruleBundle) notes.push(`Security rules: ${health.ruleBundle.detail}`);

  return {
    platform: Platform.OS,
    checkedAt: health.checkedAt ?? undefined,
    protectionOn: health.protection ? health.protection.operational : undefined,
    adapter: input.adapterLabel ? clip(input.adapterLabel, 80) : undefined,
    gates: health.gates.map(gateLine).slice(0, 14),
    permissions: health.permissions.slice(0, 13).map((permission) => clip(`${permission.id}: ${permission.status}`, 80))
      .concat([`notifications: ${input.notificationStatus}`]),
    network: networkLine(input.network),
    threatCounts: counts.slice(0, 8).map((line) => clip(line, 80)),
    openThreats: open.map((line) => clip(line, 160)),
    alerts: `permission ${input.notificationStatus}`,
    quietHours: input.quietHours.enabled
      ? `on, ${clock(input.quietHours.start_minutes)}–${clock(input.quietHours.end_minutes)}${input.quietNow ? " (active now)" : ""}`
      : "off",
    batterySaver: input.lowPower,
    trustedLinks: input.trustCount,
    savedChecks: extras?.savedChecks,
    personalData: extras?.personalData === undefined ? undefined : `${extras.personalData} entries saved for Apollo to protect`,
    callScreener: input.callScreener ? clip(input.callScreener, 240) : undefined,
    emailAccounts: extras?.emailAccounts
      ? `${extras.emailAccounts.total} added, ${extras.emailAccounts.connected} connected`
      : undefined,
    notes: notes.map((note) => clip(note, 200)),
  };
}
