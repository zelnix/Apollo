import type { Capability } from "@/src/domain/types";
import type { NetworkStatus, ProtectionPermission, ProtectionStatus } from "@/src/security/SecurityPlatformAdapter";
import type { GateItem } from "@/src/domain/gates";

export type HealthTrigger = "boot" | "foreground" | "periodic" | "support" | "user_action" | "protection_change";
export type GateHealthRecord = GateItem;

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
  /** Set when the most recent health check FAILED. The readings above are then the previous ones. */
  lastCheckFailure: { at: string; trigger: HealthTrigger | null; reason: string } | null;
}