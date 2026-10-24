// Apollo Protections — Apollo's own Gates, grouped exception-first for Home and the Apollo Protections screen.
//
// Each Gate lands in exactly one group, read straight from its resolved status. Nothing is upgraded:
// "Unable to verify" is never shown as protected, and a manual check is never shown as watching.
// Pure: no React, no navigation.
import type { GatePresentation } from "./gates";

export type ApolloProtectionGroup = "needsAttention" | "needsChecking" | "protected" | "notAvailable";

export function apolloProtectionGroup(gate: Pick<GatePresentation, "tone" | "statusLabel">): ApolloProtectionGroup {
  switch (gate.tone) {
    case "action": return "needsAttention";
    case "good": return "protected";
    case "unavailable": return "notAvailable";
    case "neutral":
      if (gate.statusLabel === "Setup required") return "needsAttention";
      if (gate.statusLabel === "Manual check") return "protected";
      return "needsChecking";
    default: return "needsChecking"; // limited, unverified, off
  }
}

export interface ApolloProtectionGroups {
  /** Stopped or not set up — the person can fix these. Verified failures first. */
  needsAttention: GatePresentation[];
  /** Limited, switched off, or Apollo couldn't confirm them. */
  needsChecking: GatePresentation[];
  /** Watching, or ready whenever the person wants a check — collapsed by default. */
  protectedGates: GatePresentation[];
  notAvailable: GatePresentation[];
}

export function groupApolloProtections(gates: GatePresentation[]): ApolloProtectionGroups {
  const of = (group: ApolloProtectionGroup) => gates.filter((g) => apolloProtectionGroup(g) === group);
  const attention = of("needsAttention");
  return {
    needsAttention: [...attention.filter((g) => g.tone === "action"), ...attention.filter((g) => g.tone !== "action")],
    needsChecking: of("needsChecking"),
    protectedGates: of("protected"),
    notAvailable: of("notAvailable"),
  };
}

export interface ApolloProtectionsSummary { overall: "action" | "review" | "check" | "protected" | "checking"; headline: string; detail: string }

/** The one-line status for Home's Apollo Protections card. */
export function summariseApolloProtections(groups: ApolloProtectionGroups, checking: boolean): ApolloProtectionsSummary {
  if (checking) return { overall: "checking", headline: "Checking…", detail: "Apollo is reading the state of its protections." };
  const attention = groups.needsAttention.length;
  const toCheck = groups.needsChecking.length;
  const ok = groups.protectedGates.length;
  const names = (gates: GatePresentation[]) => gates.slice(0, 2).map((g) => g.title).join(", ") + (gates.length > 2 ? ` and ${gates.length - 2} more` : "");
  const okLine = ok ? `${ok} protected.` : "";
  if (attention) {
    // A protection that stopped is more serious than one that was never set up.
    const overall = groups.needsAttention.some((g) => g.tone === "action") ? "action" : "review";
    return { overall, headline: `${attention} need${attention === 1 ? "s" : ""} attention`, detail: [`${names(groups.needsAttention)}.`, okLine].filter(Boolean).join(" ") };
  }
  if (toCheck) return { overall: "check", headline: `${toCheck} to check`, detail: [`${names(groups.needsChecking)}.`, okLine].filter(Boolean).join(" ") };
  return { overall: "protected", headline: "All protected", detail: okLine || "Nothing needs you right now." };
}
