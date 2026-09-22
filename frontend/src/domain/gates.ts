import type { Capability } from "./types";
import type { ProtectionPermission, ProtectionStatus } from "@/src/security/SecurityPlatformAdapter";
import type { MessagingCapabilities } from "@/src/security/messagingSdk";
import type { CallProtectionCapabilities } from "@/src/security/callSdk";
import { VERIFICATION_FRESHNESS_MS } from "./stateMachine.ts";

export type GateId = "site" | "link" | "text" | "call" | "network" | "account" | "email" | "file" | "app" | "device";
export type AutomaticProtectionStatus = "On" | "Needs setup" | "Needs attention" | "Not supported" | "Checking";
export type OnDemandCheckStatus = "Available" | "Unavailable";
export type GateAction = "restore_site" | "open_gate" | "open_support";

export interface GateCapabilityAction { kind: GateAction; label: string; route?: string }
export interface GateItem {
  id: GateId; title: string; automaticStatus: AutomaticProtectionStatus; onDemandStatus: OnDemandCheckStatus;
  automaticDetail: string; onDemandDetail: string; checkedAt: string | null; source: "os" | "native" | "manual" | "backend";
  automaticAction: GateCapabilityAction | null; onDemandAction: GateCapabilityAction | null;
}
export interface GatesOverview { summary: string; higgins: string; primary: GateItem | null; gates: GateItem[] }
export interface EmailMonitorCapability {
  checking: boolean; configured: boolean; connected: boolean; monitoringRequested: boolean;
  lastCheckedAt: string | null; lastSuccessAt?: string | null; lastErrorAt: string | null;
}
export interface GatesInput {
  platform: string; checking: boolean; protection: ProtectionStatus | null; permissions: ProtectionPermission[]; capabilities: Capability[];
  messaging: MessagingCapabilities | null; calls: CallProtectionCapabilities | null; email?: EmailMonitorCapability; online?: boolean; accountBreachConfigured?: boolean; now?: number;
}

const cap = (caps: Capability[], id: string) => caps.find((item) => item.id === id);
const manual = (id: GateId, title: string, route: string, detail: string): GateItem => ({
  id, title, automaticStatus: "Not supported", onDemandStatus: "Available", automaticDetail: `${title} does not claim to run automatically on this device.`, onDemandDetail: detail,
  checkedAt: new Date().toISOString(), source: "manual", automaticAction: null, onDemandAction: { kind: "open_gate", label: `Open ${title}`, route },
});
const nativeAutomatic = (status: "supported" | "permission_required" | "unsupported" | undefined): AutomaticProtectionStatus => status === undefined ? "Checking" : status === "supported" ? "On" : status === "permission_required" ? "Needs setup" : "Not supported";

export function buildGatesOverview(input: GatesInput): GatesOverview {
  const now = input.now ?? Date.now();
  const siteCap = cap(input.capabilities, "site_guard");
  const verifiedAt = input.protection?.lastVerified ? Date.parse(input.protection.lastVerified) : 0;
  const siteFresh = verifiedAt > 0 && verifiedAt <= now && now - verifiedAt <= VERIFICATION_FRESHNESS_MS;
  const siteUnsupported = siteCap?.status === "unsupported" || (input.platform === "web" && input.protection?.enforcementMethod === "simulated");
  const siteOn = !!input.protection?.operational && siteFresh && siteCap?.status === "active";
  const sitePermissionGap = input.permissions.some((permission) => (permission.id === "network_filter" || permission.id === "vpn_config") && !["granted", "not_applicable"].includes(permission.status));
  const siteAutomatic: AutomaticProtectionStatus = input.checking || !input.protection ? "Checking" : siteUnsupported ? "Not supported" : siteOn ? "On" : !input.protection.requested ? "Needs setup" : "Needs attention";
  const site: GateItem = {
    id: "site", title: "Site Gate", automaticStatus: siteAutomatic, onDemandStatus: "Unavailable", checkedAt: input.protection?.checkedAt ?? null, source: "os",
    automaticDetail: siteAutomatic === "On" ? input.protection?.coverage ?? "Supported website traffic is filtered." : siteAutomatic === "Needs setup" ? "Turn on website protection and approve the device request." : siteAutomatic === "Needs attention" ? (sitePermissionGap ? "Device approval is missing or no longer active." : input.protection?.degradedReason ?? "Apollo cannot confirm that website protection is running.") : siteAutomatic === "Not supported" ? "This device or build cannot run automatic website protection." : "Apollo is checking the current device state.",
    onDemandDetail: "Use Link Gate when you want to check one link yourself.",
    automaticAction: siteAutomatic === "Needs setup" || siteAutomatic === "Needs attention" ? { kind: "restore_site", label: "Restore Site Gate" } : null,
    onDemandAction: null,
  };

  const textAutomatic = nativeAutomatic(input.messaging?.smsFiltering);
  const text: GateItem = { id: "text", title: "Text Gate", automaticStatus: textAutomatic, onDemandStatus: "Available", checkedAt: input.checking ? null : new Date(now).toISOString(), source: "native",
    automaticDetail: textAutomatic === "On" ? "Supported new-message notifications can be assessed on this device." : textAutomatic === "Needs setup" ? "Approve notification access so supported messages can be assessed." : textAutomatic === "Not supported" ? "This device cannot give Apollo supported automatic message access." : "Apollo is checking message access.",
    onDemandDetail: "Paste, share or add a screenshot of a message.", automaticAction: textAutomatic === "Needs setup" ? { kind: "open_gate", label: "Set up Text Gate", route: "/text-guard" } : null, onDemandAction: { kind: "open_gate", label: "Check a message", route: "/message" } };

  const callAutomatic = nativeAutomatic(input.calls?.callScreening);
  const call: GateItem = { id: "call", title: "Call Gate", automaticStatus: callAutomatic, onDemandStatus: "Available", checkedAt: input.checking ? null : new Date(now).toISOString(), source: "native",
    automaticDetail: callAutomatic === "On" ? "The device call-screening role is active for supported calls." : callAutomatic === "Needs setup" ? "Choose Apollo for the device call-screening role." : callAutomatic === "Not supported" ? "This device cannot give Apollo supported automatic call screening." : "Apollo is checking call-screening access.",
    onDemandDetail: "Check a number or describe what was said during a call.", automaticAction: callAutomatic === "Needs setup" ? { kind: "open_gate", label: "Set up Call Gate", route: "/call-guard" } : null, onDemandAction: { kind: "open_gate", label: "Check a call or number", route: "/call" } };

  const networkCap = cap(input.capabilities, "connection_guard");
  const networkAutomatic: AutomaticProtectionStatus = input.checking ? "Checking" : networkCap?.status === "active" && siteOn ? "On" : networkCap?.status === "permission_required" ? "Needs setup" : "Not supported";
  const network: GateItem = { ...manual("network", "Network Gate", "/network", "Review the connection facts this device can see and add your context."), source: "native", automaticStatus: networkAutomatic,
    automaticDetail: networkAutomatic === "On" ? "Apollo can warn about supported open or sign-in Wi‑Fi conditions while protection is active." : networkAutomatic === "Needs setup" ? "A device permission is needed before supported network warnings can run." : networkAutomatic === "Checking" ? "Apollo is checking network access." : "This device does not provide supported automatic network warnings.",
    automaticAction: networkAutomatic === "Needs setup" ? { kind: "open_gate", label: "Set up Network Gate", route: "/network" } : null };

  const email = input.email;
  const emailSuccess = email?.lastSuccessAt ? Date.parse(email.lastSuccessAt) : email?.lastCheckedAt ? Date.parse(email.lastCheckedAt) : 0;
  const emailError = email?.lastErrorAt ? Date.parse(email.lastErrorAt) : 0;
  const emailFresh = emailSuccess > 0 && emailSuccess <= now && now - emailSuccess <= 20 * 60 * 1000 && emailSuccess >= emailError;
  const emailAutomatic: AutomaticProtectionStatus = email?.checking ? "Checking" : email && !email.configured ? "Not supported" : !email?.connected || !email.monitoringRequested ? "Needs setup" : emailFresh ? "On" : "Needs attention";
  const emailGate: GateItem = { ...manual("email", "Email Gate", "/email", "Paste or share an email and start a check yourself."), source: "backend", automaticStatus: emailAutomatic,
    automaticDetail: emailAutomatic === "On" ? "The connected read-only mailbox has a fresh successful monitor check." : emailAutomatic === "Needs attention" ? "Monitoring is requested, but Apollo has no fresh successful check." : emailAutomatic === "Needs setup" ? "Connect a read-only Gmail inbox and choose ongoing monitoring." : emailAutomatic === "Not supported" ? "This service is not configured for ongoing mailbox monitoring." : "Apollo is checking the mailbox monitor.",
    automaticAction: emailAutomatic === "Needs setup" || emailAutomatic === "Needs attention" ? { kind: "open_gate", label: emailAutomatic === "Needs attention" ? "Restore Email Gate" : "Set up Email Gate", route: "/email" } : null };

  const link = manual("link", "Link Gate", "/check", "Paste or share a link before opening it.");
  if (input.online === false) link.onDemandDetail = "On-device checks remain available. Online reputation and research may be unavailable.";
  const account = manual("account", "Account Gate", "/account", "Review an account alert without sharing a password or verification code.");
  if (input.accountBreachConfigured === false) account.onDemandDetail = "Account-alert checks remain available. Live breach lookup is unavailable.";
  const file = manual("file", "File Gate", "/file", "Choose or share a file for a supported local inspection.");
  const app = manual("app", "App Gate", "/app-check", "Review an installed app or one you are considering.");
  const device = manual("device", "Device Gate", "/device", "Run a check of visible device, permission and protection changes.");
  const gates = [site, link, text, call, network, account, emailGate, file, app, device];
  const primary = gates.find((gate) => gate.automaticStatus === "Needs attention") ?? gates.find((gate) => gate.automaticStatus === "Needs setup") ?? null;
  const on = gates.filter((gate) => gate.automaticStatus === "On").length;
  const attention = gates.filter((gate) => gate.automaticStatus === "Needs attention").length;
  const setup = gates.filter((gate) => gate.automaticStatus === "Needs setup").length;
  const summary = input.checking ? "Checking automatic protection" : attention ? `${attention} automatic ${attention === 1 ? "protection needs" : "protections need"} attention` : setup ? `${setup} automatic ${setup === 1 ? "protection needs" : "protections need"} setup` : `${on} automatic ${on === 1 ? "protection is" : "protections are"} on`;
  const higgins = primary ? `${primary.title} ${primary.automaticStatus === "Needs attention" ? "needs attention" : "needs setup"}. ${primary.automaticDetail}` : "Automatic protection and checks you start yourself are shown separately below.";
  return { summary, higgins, primary, gates };
}

export const automaticStatusTone = (status: AutomaticProtectionStatus) => status === "On" ? "resting" : status === "Needs attention" ? "barking" : status === "Needs setup" ? "growling" : "unknown";
export const onDemandStatusTone = (status: OnDemandCheckStatus) => status === "Available" ? "neutral" : "unknown";