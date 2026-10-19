/**
 * Canonical Gate Metadata Registry.
 *
 * ONE source of truth for gate ID, user-facing name, purpose, and category.
 * Every surface (Home, Protection, Support, Higgins, Check Results) imports
 * from this file. No separate TITLE/GATE_LABEL/gate-name maps elsewhere.
 *
 * Architecture rule: a fact can appear in many places, but Apollo should
 * decide that fact in only one place.
 */

export type GateId = "site" | "link" | "text" | "call" | "network" | "account" | "email" | "file" | "app" | "device";

export interface GateMeta {
  id: GateId;
  /** User-facing name shown on Home, Protection, Check Result headers. */
  name: string;
  /** One-sentence purpose description. */
  purpose: string;
  /** Category for grouping. */
  category: "enforcement" | "monitoring" | "event_driven";
  /** The gate name as it appears in CheckResultModel.gate. */
  checkResultGate: string;
  /** Default check type label for Check Results. */
  defaultCheckType: string;
}

/** Canonical gate metadata — single source of truth. */
export const GATE_REGISTRY: Record<GateId, GateMeta> = {
  site: { id: "site", name: "Website protection", purpose: "Helps stop known dangerous websites before they load.", category: "enforcement", checkResultGate: "Website protection", defaultCheckType: "Website check" },
  link: { id: "link", name: "Link checking", purpose: "Checks where a link really leads and looks for scams, fake websites and harmful downloads.", category: "event_driven", checkResultGate: "Link checking", defaultCheckType: "Link check" },
  text: { id: "text", name: "Message screening", purpose: "Looks for scam messages, fake alerts, urgent payment requests and dangerous links.", category: "event_driven", checkResultGate: "Message screening", defaultCheckType: "Message check" },
  call: { id: "call", name: "Call screening", purpose: "Checks suspicious callers and numbers and helps you decide whether it is safe to respond.", category: "event_driven", checkResultGate: "Call screening", defaultCheckType: "Call check" },
  network: { id: "network", name: "Internet monitoring", purpose: "Reports the internet connection you are using and whether Apollo's protection for it is operating.", category: "monitoring", checkResultGate: "Internet monitoring", defaultCheckType: "Network check" },
  account: { id: "account", name: "Account alerts", purpose: "Investigates warnings about your accounts and helps you take the right recovery steps.", category: "event_driven", checkResultGate: "Account alerts", defaultCheckType: "Account check" },
  email: { id: "email", name: "Email monitoring", purpose: "Looks for phishing, impersonation, dangerous links and risky attachments in emails.", category: "monitoring", checkResultGate: "Email monitoring", defaultCheckType: "Email check" },
  file: { id: "file", name: "File checking", purpose: "Checks files and attachments for suspicious content, hidden links and signs they may be unsafe.", category: "event_driven", checkResultGate: "File checking", defaultCheckType: "File check" },
  app: { id: "app", name: "App checking", purpose: "Checks whether an app's source, permissions and behaviour give you a reason to be cautious.", category: "event_driven", checkResultGate: "App checking", defaultCheckType: "App check" },
  device: { id: "device", name: "Device monitoring", purpose: "Checks whether important protections and permissions are working.", category: "monitoring", checkResultGate: "Device monitoring", defaultCheckType: "Device check" },
};

/** Lookup gate user-facing name by ID. */
export function gateName(id: string): string {
  return (GATE_REGISTRY as Record<string, GateMeta>)[id]?.name ?? id;
}

/** Lookup gate purpose by ID. */
export function gatePurpose(id: string): string {
  return (GATE_REGISTRY as Record<string, GateMeta>)[id]?.purpose ?? "";
}

/** All gate IDs in display order. */
export const ALL_GATE_IDS: GateId[] = ["site", "link", "text", "call", "network", "account", "email", "file", "app", "device"];
