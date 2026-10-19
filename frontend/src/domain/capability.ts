import type { Capability, CapabilityStatus, Visibility } from "./types";

export const CAPABILITY_STATUS_LABEL: Record<CapabilityStatus, string> = {
  active: "Active",
  available: "Available",
  permission_required: "Permission required",
  unsupported: "Unsupported here",
  coming_later: "Coming later",
  inactive: "Inactive",
};

/** Derive visibility from capabilities. Never returns "full" unless something is actively protecting. */
export function visibilityFrom(capabilities: Capability[], protectionRunning: boolean): Visibility {
  const active = capabilities.filter((c) => c.status === "active");
  if (!protectionRunning || active.length === 0) return "none";
  const gaps = capabilities.filter((c) => c.status === "permission_required" || c.status === "inactive");
  return gaps.length > 0 ? "limited" : "full";
}

export function isProtecting(status: CapabilityStatus): boolean {
  return status === "active";
}
