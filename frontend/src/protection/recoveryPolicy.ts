import type { ProtectionPermission, ProtectionStatus } from "@/src/security/SecurityPlatformAdapter";

export type SiteRecoveryDecision = "healthy" | "off_by_choice" | "start_now" | "ask_permission" | "degraded";

export function decideSiteRecovery(desiredOn: boolean, status: ProtectionStatus, permissions: ProtectionPermission[]): SiteRecoveryDecision {
  if (status.operational) return "healthy";
  if (!desiredOn) return "off_by_choice";
  const vpn = permissions.find((permission) => permission.id === "vpn_config");
  if (vpn?.status === "granted" || (vpn?.status === "not_applicable" && status.enforcementMethod !== "none")) return "start_now";
  if (vpn?.canAskAgain && vpn.status !== "blocked" && vpn.status !== "restricted") return "ask_permission";
  return status.degradedReason ? "degraded" : "ask_permission";
}