import { apiPost } from "@/src/api/client";
import type { GatePresentation } from "@/src/domain/gates";
import type { Capability } from "@/src/domain/types";
import type { ProtectionStatus } from "@/src/security/SecurityPlatformAdapter";

type RegistryState = "running" | "ready" | "permission_required" | "degraded" | "unavailable" | "offline" | "not_applicable";

function gateState(gate: GatePresentation, online: boolean | null): { state: RegistryState; reason: string | null } {
  if (online === false && ["email", "link", "file", "app", "account"].includes(gate.id)) return { state: "offline", reason: "network_unavailable" };
  const automatic = gate.capability.automatic?.state;
  if (automatic === "running") return { state: "running", reason: null };
  if (automatic === "permission_needed" || automatic === "setup_needed") return { state: "permission_required", reason: gate.currentHelp };
  if (automatic === "temporarily_unavailable") return { state: "degraded", reason: gate.currentHelp };
  if (automatic === "unsupported") return { state: "unavailable", reason: gate.currentHelp };
  return gate.capability.onDemand?.state === "ready" ? { state: "ready", reason: null } : { state: "unavailable", reason: gate.currentHelp };
}

export function publishCapabilitySnapshot(input: { platform: string; adapter: string; online: boolean | null; gates: GatePresentation[]; capabilities: Capability[]; protection: ProtectionStatus | null }) {
  return apiPost<{ accepted: true }>("/product/capabilities/snapshot", "capability_snapshot", {
    platform: input.platform === "preview_harness" ? "mock" : input.platform, adapter: input.adapter, online: input.online,
    gates: input.gates.map((gate) => ({ id: gate.id, ...gateState(gate, input.online) })),
    capabilities: input.capabilities.map((capability) => ({ id: capability.id, state: capability.status === "active" ? "running" : capability.status === "permission_required" ? "permission_required" : capability.status === "available" ? "ready" : capability.status === "inactive" ? "ready" : "unavailable", reason: capability.detail ?? null })),
    protection: input.protection ? { requested: input.protection.requested, operational: input.protection.operational, enforcementMethod: input.protection.enforcementMethod, degradedReason: input.protection.degradedReason } : null,
  });
}