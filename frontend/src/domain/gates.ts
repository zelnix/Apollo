import type { Capability } from "./types";
import type { ProtectionPermission, ProtectionStatus } from "@/src/security/SecurityPlatformAdapter";
import type { MessagingCapabilities } from "@/src/security/messagingSdk";
import type { CallProtectionCapabilities } from "@/src/security/callSdk";
import { VERIFICATION_FRESHNESS_MS } from "./stateMachine.ts";

export type GateId = "site" | "link" | "text" | "call" | "network" | "account" | "email" | "app";
export type GateStatus = "Active" | "Ready to check" | "Needs attention" | "Off" | "Unavailable on this device" | "Checking status";
export type GateMode = "Automatic" | "Manual submission" | "Automatic + manual";
export type GateAction = "restore_site" | "restore_text" | "restore_call" | "open";
export interface GateItem { id: GateId; title: string; status: GateStatus; mode: GateMode; scope: string; setup: string | null; actionLabel: string; action: GateAction; route?: string }
export interface GatesOverview { summary: string; higgins: string; primary: GateItem | null; gates: GateItem[] }
export interface GatesInput {
  platform: string; checking: boolean; protection: ProtectionStatus | null; permissions: ProtectionPermission[]; capabilities: Capability[];
  messaging: MessagingCapabilities | null; calls: CallProtectionCapabilities | null;
  email?: { checking: boolean; configured: boolean; connected: boolean; monitoringRequested: boolean; lastCheckedAt: string | null; lastErrorAt: string | null };
  online?: boolean;
  accountBreachConfigured?: boolean;
}

const manual = (id: GateId, title: string, scope: string, route: string): GateItem => ({
  id, title, status: "Ready to check", mode: "Manual submission", scope, setup: null, actionLabel: `Open ${title}`, action: "open", route,
});
const cap = (caps: Capability[], id: string) => caps.find((item) => item.id === id);

export function buildGatesOverview(input: GatesInput): GatesOverview {
  const siteCap = cap(input.capabilities, "site_guard");
  const siteUnavailable = siteCap?.status === "unsupported" || (input.platform === "web" && input.protection?.enforcementMethod === "simulated");
  const verifiedAt = input.protection?.lastVerified ? Date.parse(input.protection.lastVerified) : 0;
  const freshVerification = verifiedAt > 0 && verifiedAt <= Date.now() && Date.now() - verifiedAt <= VERIFICATION_FRESHNESS_MS;
  const siteActive = !!input.protection?.operational && freshVerification && siteCap?.status === "active";
  const siteNeedsPermission = input.permissions.some((p) => (p.id === "network_filter" || p.id === "vpn_config") && p.status !== "granted" && p.status !== "not_applicable");
  const siteStatus: GateStatus = input.checking || !input.protection ? "Checking status" : siteUnavailable ? "Unavailable on this device" : siteActive ? "Active"
    : !input.protection.requested ? "Off" : "Needs attention";
  const site: GateItem = { id: "site", title: "Site Gate", status: siteStatus, mode: "Automatic",
    scope: siteActive ? "Automatically filters supported website traffic. A block is reported only after the device confirms it." : "Automatic filtering for supported website traffic; this is separate from manual link checks.",
    setup: siteStatus === "Needs attention" ? (siteNeedsPermission ? "Protection permission must be restored and verified." : input.protection?.degradedReason ?? "Apollo has not confirmed that filtering is running.")
      : siteStatus === "Off" ? "Automatic website filtering is turned off." : siteStatus === "Unavailable on this device" ? "This device or build cannot run Apollo's automatic website filter." : null,
    actionLabel: siteStatus === "Active" || siteStatus === "Unavailable on this device" ? "Open Link Gate" : siteStatus === "Checking status" ? "Check status" : "Restore protection",
    action: siteStatus === "Active" || siteStatus === "Unavailable on this device" ? "open" : "restore_site", route: "/check" };

  const textCapability = input.messaging?.smsFiltering;
  const text: GateItem = { id: "text", title: "Text Gate", status: !input.messaging ? "Checking status" : textCapability === "supported" ? "Active"
    : textCapability === "permission_required" ? "Needs attention" : "Ready to check", mode: textCapability === "unsupported" ? "Manual submission" : "Automatic + manual",
    scope: textCapability === "supported" ? "Automatically checks supported new-message notifications; pasted text and screenshots can also be submitted."
      : "Checks text or a screenshot when you submit it. Automatic message access is not assumed.",
    setup: textCapability === "permission_required" ? "Notification access must be restored, then Apollo must confirm it is running." : null,
    actionLabel: textCapability === "permission_required" ? "Restore Text Gate" : "Open Text Gate", action: textCapability === "permission_required" ? "restore_text" : "open", route: "/text-guard" };

  const callCapability = input.calls?.callScreening;
  const call: GateItem = { id: "call", title: "Call Gate", status: !input.calls ? "Checking status" : callCapability === "supported" ? "Active"
    : callCapability === "permission_required" ? "Needs attention" : "Ready to check", mode: callCapability === "unsupported" ? "Manual submission" : "Automatic + manual",
    scope: callCapability === "supported" ? "Automatically screens calls using the local block list and supported high-risk signals; other calls still ring."
      : "Checks a number or call context when you submit it. Monitoring is not presented as blocking.",
    setup: callCapability === "permission_required" ? "Call-screening permission or role must be restored and verified." : null,
    actionLabel: callCapability === "permission_required" ? "Restore Call Gate" : "Open Call Gate", action: callCapability === "permission_required" ? "restore_call" : "open", route: "/call-guard" };

  const networkCap = cap(input.capabilities, "connection_guard");
  const networkActive = networkCap?.status === "active" && siteActive;
  const network: GateItem = { id: "network", title: "Network Gate", status: input.checking ? "Checking status" : networkActive ? "Active" : "Ready to check",
    mode: networkActive ? "Automatic + manual" : "Manual submission", scope: networkActive ? "Automatically warns about supported open or captive Wi‑Fi conditions; it does not claim to block the network."
      : "Checks the current network facts the device exposes, or details you submit.", setup: null, actionLabel: "Open Network Gate", action: "open", route: "/network" };

  const emailHeartbeat = input.email?.lastCheckedAt ? Date.parse(input.email.lastCheckedAt) : 0;
  const emailError = input.email?.lastErrorAt ? Date.parse(input.email.lastErrorAt) : 0;
  const emailFresh = emailHeartbeat > 0 && emailHeartbeat <= Date.now() && Date.now() - emailHeartbeat <= 20 * 60 * 1000 && emailHeartbeat >= emailError;
  const emailStatus: GateStatus = input.email?.checking ? "Checking status" : input.email?.connected && input.email.monitoringRequested && emailFresh ? "Active"
    : input.email?.connected && input.email.monitoringRequested ? "Needs attention" : input.email?.connected ? "Off" : "Ready to check";
  const email: GateItem = { id: "email", title: "Email Gate", status: emailStatus,
    mode: input.email?.connected ? "Automatic + manual" : "Manual submission",
    scope: emailStatus === "Active" ? "Automatically checks the connected read-only mailbox on the monitor schedule; pasted email can also be submitted."
      : "Checks pasted email or a connected read-only mailbox when you start a scan.",
    setup: emailStatus === "Needs attention" ? "Mailbox monitoring is requested but has no fresh successful heartbeat. Open Email Gate to restore it."
      : emailStatus === "Off" ? "Mailbox monitoring is off; manual email checks remain available."
      : input.email && !input.email.configured ? "Mailbox connections are unavailable; manual email checks remain available." : null,
    actionLabel: "Open Email Gate", action: "open", route: "/email" };
  const link = manual("link", "Link Gate", "Checks a link when you paste or share it; this is not automatic browsing protection.", "/check");
  if (input.online === false) link.setup = "Online reputation and page investigation are unavailable; on-device link checks remain available.";
  const account = manual("account", "Account Gate", "Checks an account alert or identifier when you submit it.", "/account");
  if (input.accountBreachConfigured === false) account.setup = "Live breach lookup is unavailable; submitted account-alert investigation remains available.";
  const gates: GateItem[] = [site, link, text, call, network,
    account,
    email,
    manual("app", "App Gate", "Checks an app or device concern from the details you provide.", "/app-check")];
  const gaps = gates.filter((gate) => gate.status === "Needs attention" || gate.status === "Off");
  const checking = gates.some((gate) => gate.status === "Checking status");
  const activeAutomatic = gates.filter((gate) => gate.status === "Active" && gate.mode !== "Manual submission");
  if (site.status === "Needs attention") return { summary: "Some protection needs attention",
    higgins: "Your link checks are available, but Site Gate is off. Restore Apollo’s protection permission to enable its automatic filtering.", primary: site, gates };
  if (gaps.length) return { summary: "Some protection needs attention", higgins: `${gaps[0].title} ${gaps[0].status === "Off" ? "is off" : "needs attention"}. ${gaps[0].setup ?? "Restore it, then wait for Apollo to confirm it is running."}`, primary: gaps[0], gates };
  if (checking) return { summary: "Checking protection status", higgins: "I’m checking which automatic protections are actually running. Manual Gates remain available when their cards say Ready to check.", primary: null, gates };
  if (activeAutomatic.length) return { summary: "All available protection is active", higgins: "Apollo’s supported automatic protection is confirmed running. Gates marked Ready to check still require you to submit a message, number, link or other item.", primary: null, gates };
  return { summary: "Manual checks are ready", higgins: "This device has no confirmed automatic protection. Gates marked Ready to check can assess only the items you submit.", primary: null, gates };
}

export const gateStatusTone = (status: GateStatus) => status === "Active" ? "resting" : status === "Needs attention" ? "barking"
  : status === "Off" ? "growling" : status === "Checking status" ? "neutral" : "unknown";