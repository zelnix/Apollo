import type { Capability } from "@/src/domain/types";
import type { NetworkStatus, ProtectionPermission, ProtectionStatus } from "@/src/security/SecurityPlatformAdapter";

export type GateHealthState = "running" | "stopped" | "needs_user" | "manual_only" | "unsupported" | "unavailable" | "checking" | "degraded";
export type HealthTrigger = "boot" | "foreground" | "periodic" | "support" | "user_action" | "protection_change";

export interface GateHealthAction {
  kind: "restore_site" | "open_gate" | "open_support";
  label: string;
  route?: string;
}

export interface GateHealthRecord {
  id: "site" | "text" | "call" | "email" | "link" | "file" | "app" | "device" | "account" | "network";
  title: string;
  state: GateHealthState;
  scope: string;
  checkedAt: string | null;
  source: "os" | "native" | "manual" | "backend";
  userAction: GateHealthAction | null;
}

export interface ProtectionHealthSnapshot {
  revision: number;
  checkedAt: string | null;
  trigger: HealthTrigger | null;
  checking: boolean;
  gates: GateHealthRecord[];
  capabilities: Capability[];
  protection: ProtectionStatus | null;
  permissions: ProtectionPermission[];
  network: NetworkStatus | null;
}