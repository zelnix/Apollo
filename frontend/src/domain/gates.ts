import type { Capability } from "./types";
import type { UserAction } from "./userActions";
import type { CallProtectionCapabilities } from "@/src/security/callSdk";
import type { MessagingCapabilities } from "@/src/security/messagingSdk";
import type { NetworkStatus, ProtectionPermission, ProtectionStatus } from "@/src/security/SecurityPlatformAdapter";
import { VERIFICATION_FRESHNESS_MS } from "./stateMachine.ts";

export type GateId = "site" | "link" | "text" | "call" | "network" | "account" | "email" | "file" | "app" | "device";
export type GateAutomationKind = "enforcement" | "monitoring" | "event_driven";
export type AutomaticCapabilityState = "running" | "checking" | "permission_needed" | "setup_needed" | "off_by_choice" | "temporarily_unavailable" | "unsupported";
export type OnDemandCapabilityState = "ready" | "temporarily_unavailable" | "unsupported";
export type GateStatusLabel = "Protection on" | "Watching" | "Ready when you need it" | "Ready now" | "Needs your attention" | "Off" | "Checking" | "Status unavailable" | "Not available on this device";
export type GateTone = "good" | "attention" | "neutral" | "unavailable";

export interface GatePresentation {
  id: GateId; title: string; purpose: string; currentHelp: string; statusLabel: GateStatusLabel; tone: GateTone;
  capability: { automatic?: { kind: GateAutomationKind; state: AutomaticCapabilityState; lastObservedAt?: string; limitation?: string }; onDemand?: { state: OnDemandCapabilityState; action: UserAction } };
  primaryAction?: UserAction;
}
export type GateItem = GatePresentation;
export interface GatesOverview { summary: string; higgins: string; primary: GatePresentation | null; gates: GatePresentation[] }
export interface EmailMonitorCapability { checking: boolean; configured: boolean; connected: boolean; monitoringRequested: boolean; lastCheckedAt: string | null; lastSuccessAt?: string | null; lastErrorAt: string | null }
export interface GatesInput { platform: string; checking: boolean; protection: ProtectionStatus | null; permissions: ProtectionPermission[]; capabilities: Capability[]; messaging: MessagingCapabilities | null; calls: CallProtectionCapabilities | null; network?: NetworkStatus | null; email?: EmailMonitorCapability; online?: boolean; accountBreachConfigured?: boolean; now?: number }

const PURPOSE: Record<GateId, string> = {
  site: "Helps stop known dangerous websites before they load.",
  link: "Checks where a link really leads and looks for scams, fake websites and harmful downloads.",
  text: "Looks for scam messages, fake alerts, urgent payment requests and dangerous links.",
  call: "Checks suspicious callers and numbers and helps you decide whether it is safe to respond.",
  network: "Warns when the connection you are using may be unsafe or when a network change affects Apollo's protection.",
  account: "Investigates warnings about your accounts and helps you take the right recovery steps.",
  email: "Looks for phishing, impersonation, dangerous links and risky attachments in emails you share or connect.",
  file: "Checks files and attachments for suspicious content, hidden links and signs they may be unsafe. A cloud download is not automatically trusted.",
  app: "Checks whether an app's source, permissions and behaviour give you a reason to be cautious—even if it has not been used recently.",
  device: "Checks whether important protections and permissions are working and looks for changes that may need your attention.",
};
const TITLE: Record<GateId, string> = { site: "Site Gate", link: "Link Gate", text: "Text Gate", call: "Call Gate", network: "Network Gate", account: "Account Gate", email: "Email Gate", file: "File Gate", app: "App Gate", device: "Device Gate" };
const cap = (items: Capability[], id: string) => items.find((item) => item.id === id);
const action = (id: UserAction["id"], label: string): UserAction => ({ id, label });
const onDemand = (id: UserAction["id"], label: string, state: OnDemandCapabilityState = "ready") => ({ state, action: action(id, label) });

function presentation(base: Omit<GatePresentation, "statusLabel" | "tone">): GatePresentation {
  const auto = base.capability.automatic; const request = auto && ["permission_needed", "setup_needed"].includes(auto.state);
  let statusLabel: GateStatusLabel; let tone: GateTone;
  if (auto?.state === "running") { statusLabel = auto.kind === "enforcement" ? "Protection on" : "Watching"; tone = "good"; }
  else if (auto?.state === "checking") { statusLabel = "Checking"; tone = "neutral"; }
  else if (request) { statusLabel = "Needs your attention"; tone = "attention"; }
  else if (auto?.state === "off_by_choice") { statusLabel = base.capability.onDemand?.state === "ready" ? "Ready now" : "Off"; tone = "neutral"; }
  else if (auto?.state === "temporarily_unavailable") { statusLabel = "Status unavailable"; tone = "unavailable"; }
  else if (base.capability.onDemand?.state === "ready") { statusLabel = "Ready when you need it"; tone = "neutral"; }
  else { statusLabel = "Not available on this device"; tone = "unavailable"; }
  const primaryAction = request && base.primaryAction ? base.primaryAction : base.capability.onDemand?.action ?? base.primaryAction;
  return { ...base, statusLabel, tone, primaryAction };
}

function simple(id: GateId, currentHelp: string, actionId: UserAction["id"], label: string, automatic?: GatePresentation["capability"]["automatic"], onDemandState: OnDemandCapabilityState = "ready"): GatePresentation {
  return presentation({ id, title: TITLE[id], purpose: PURPOSE[id], currentHelp, capability: { automatic, onDemand: onDemand(actionId, label, onDemandState) } });
}

export function buildGatesOverview(input: GatesInput): GatesOverview {
  const now = input.now ?? Date.now(); const observedNow = new Date(now).toISOString();
  const siteCapability = cap(input.capabilities, "site_guard"); const verifiedAt = input.protection?.lastVerified ? Date.parse(input.protection.lastVerified) : 0;
  const siteFresh = verifiedAt > 0 && verifiedAt <= now && now - verifiedAt <= VERIFICATION_FRESHNESS_MS;
  const sitePermission = input.permissions.some((permission) => (permission.id === "network_filter" || permission.id === "vpn_config") && !["granted", "not_applicable"].includes(permission.status));
  const siteUnsupported = siteCapability?.status === "unsupported" || (input.platform === "web" && input.protection?.enforcementMethod === "simulated");
  const siteState: AutomaticCapabilityState = input.checking || !input.protection ? "checking" : siteUnsupported ? "unsupported" : input.protection.operational && siteFresh && siteCapability?.status === "active" ? "running" : !input.protection.requested ? "off_by_choice" : sitePermission ? "permission_needed" : "temporarily_unavailable";
  const site = presentation({ id: "site", title: TITLE.site, purpose: PURPOSE.site,
    currentHelp: siteState === "running" ? "Apollo is filtering supported website traffic." : siteState === "off_by_choice" ? "Website protection is off. You can still check suspicious links." : siteState === "checking" ? "Apollo is checking website protection." : "Apollo cannot confirm website protection right now.",
    capability: { automatic: { kind: "enforcement", state: siteState, lastObservedAt: input.protection?.checkedAt ?? undefined, limitation: siteState === "permission_needed" ? "Allow the device protection request to turn Site Gate on." : siteState === "temporarily_unavailable" ? "Apollo will keep checking in the background." : undefined }, onDemand: onDemand("check_link", "Check a suspicious link") },
    primaryAction: siteState === "running" ? action("check_link", "Check a suspicious link") : action("restore_site", "Turn on Site Gate") });

  const textState: AutomaticCapabilityState = input.checking || !input.messaging ? "checking" : input.messaging.smsFiltering === "supported" ? "running" : input.messaging.smsFiltering === "permission_required" ? "permission_needed" : "unsupported";
  const text = presentation({ id: "text", title: TITLE.text, purpose: PURPOSE.text, currentHelp: textState === "running" ? "Apollo is watching supported new-message events." : "You can still paste, share or add a screenshot of a message.", capability: { automatic: { kind: "event_driven", state: textState, lastObservedAt: observedNow, limitation: textState === "permission_needed" ? "Allow message checking to watch supported new messages." : undefined }, onDemand: onDemand("check_text", "Check a message") }, primaryAction: action("setup_text", "Allow message checking") });
  const callState: AutomaticCapabilityState = input.checking || !input.calls ? "checking" : input.calls.callScreening === "supported" ? "running" : input.calls.callScreening === "permission_required" ? "permission_needed" : "unsupported";
  const call = presentation({ id: "call", title: TITLE.call, purpose: PURPOSE.call, currentHelp: callState === "running" ? "Apollo is watching supported call-screening events." : "You can check a number, caller name or call story before responding.", capability: { automatic: { kind: "event_driven", state: callState, lastObservedAt: observedNow, limitation: callState === "permission_needed" ? "Choose Apollo for supported call screening." : undefined }, onDemand: onDemand("check_call", "Check a call or number") }, primaryAction: action("setup_call", "Set up call checking") });

  const networkObserved = input.network?.checkedAt;
  const networkState: AutomaticCapabilityState = input.checking ? "checking" : !input.network ? "temporarily_unavailable" : input.network.inspectable ? "running" : input.network.connected ? "permission_needed" : "temporarily_unavailable";
  const network = presentation({ id: "network", title: TITLE.network, purpose: PURPOSE.network, currentHelp: networkState === "running" ? "Apollo is watching supported connection changes and risky Wi‑Fi conditions." : "You can run a current network check now.", capability: { automatic: { kind: "monitoring", state: networkState, lastObservedAt: networkObserved, limitation: networkState === "permission_needed" ? "Allow network information to receive automatic warnings." : networkState === "temporarily_unavailable" ? "Apollo cannot observe the current connection yet." : undefined }, onDemand: onDemand("check_network", "Check this network") }, primaryAction: action("check_network", "Check this network") });

  const email = input.email; const successAt = email?.lastSuccessAt ? Date.parse(email.lastSuccessAt) : email?.lastCheckedAt ? Date.parse(email.lastCheckedAt) : 0; const errorAt = email?.lastErrorAt ? Date.parse(email.lastErrorAt) : 0;
  const emailFresh = successAt > 0 && successAt <= now && now - successAt <= 20 * 60 * 1000 && successAt >= errorAt;
  const emailState: AutomaticCapabilityState = email?.checking ? "checking" : email && !email.configured ? "unsupported" : !email?.connected ? "setup_needed" : !email.monitoringRequested ? "off_by_choice" : emailFresh ? "running" : "temporarily_unavailable";
  const emailGate = presentation({ id: "email", title: TITLE.email, purpose: PURPOSE.email, currentHelp: emailState === "running" ? "Apollo is watching the connected read-only mailbox for new concerns." : "You can paste, share or scan an email now.", capability: { automatic: { kind: "monitoring", state: emailState, lastObservedAt: email?.lastSuccessAt ?? email?.lastCheckedAt ?? undefined, limitation: emailState === "setup_needed" ? "Connect a read-only mailbox to turn on automatic help." : emailState === "temporarily_unavailable" ? "Mailbox monitoring has no recent successful check." : undefined }, onDemand: onDemand("open_email", "Check an email") }, primaryAction: action("open_email", emailState === "setup_needed" ? "Set up Email Gate" : "Check an email") });

  const linkAuto: GatePresentation["capability"]["automatic"] = { kind: "event_driven", state: input.online === false ? "temporarily_unavailable" : "running", lastObservedAt: observedNow, limitation: input.online === false ? "Online reputation and public research are unavailable." : undefined };
  const link = simple("link", input.online === false ? "On-device link checks remain ready; online checks are unavailable." : "Apollo is checking links it receives from supported Gates and links you send.", "check_link", "Check a link", linkAuto);
  const accountAuto: GatePresentation["capability"]["automatic"] = { kind: "event_driven", state: input.accountBreachConfigured === false ? "temporarily_unavailable" : "running", lastObservedAt: observedNow, limitation: input.accountBreachConfigured === false ? "Live breach lookup is unavailable; alert checks still work." : undefined };
  const account = simple("account", "Apollo is ready for account alerts from supported messages, email and checks you start.", "check_account", "Check an account alert", accountAuto);
  const fileCap = cap(input.capabilities, "file_guard"); const fileAuto = fileCap ? { kind: "event_driven" as const, state: fileCap.status === "active" ? "running" as const : fileCap.status === "permission_required" ? "permission_needed" as const : "unsupported" as const, lastObservedAt: observedNow } : undefined;
  const appCap = cap(input.capabilities, "app_guard"); const appAuto = appCap ? { kind: "event_driven" as const, state: appCap.status === "active" ? "running" as const : appCap.status === "permission_required" ? "permission_needed" as const : "unsupported" as const, lastObservedAt: observedNow } : undefined;
  const deviceCap = cap(input.capabilities, "device_guard"); const deviceAuto = deviceCap ? { kind: "monitoring" as const, state: deviceCap.status === "active" ? "running" as const : deviceCap.status === "permission_required" ? "permission_needed" as const : "unsupported" as const, lastObservedAt: observedNow } : undefined;
  const file = simple("file", "Apollo is ready when a file or attachment is shared with it.", "check_file", "Check a file", fileAuto);
  const app = simple("app", "Apollo is ready to check an installed app or one you are considering.", "check_app", "Check an app", appAuto);
  const device = simple("device", "Apollo is checking visible protection health and is ready for a fuller device check.", "check_device", "Check my device", deviceAuto);

  const rank = (gate: GatePresentation) => gate.tone === "attention" ? 0 : gate.capability.automatic?.state === "running" ? 1 : gate.capability.onDemand?.state === "ready" ? 2 : 3;
  const gates = [site, link, text, call, network, account, emailGate, file, app, device].sort((a, b) => rank(a) - rank(b));
  const primary = gates.find((gate) => gate.tone === "attention") ?? null; const working = gates.filter((gate) => gate.capability.automatic?.state === "running").length;
  const summary = input.checking ? "Checking your protection" : primary ? `${gates.filter((gate) => gate.tone === "attention").length} ${gates.filter((gate) => gate.tone === "attention").length === 1 ? "thing needs" : "things need"} your attention` : `${working} ${working === 1 ? "Gate is" : "Gates are"} helping automatically`;
  return { summary, higgins: primary ? `${primary.title} needs your attention. ${primary.currentHelp}` : "Apollo watches what this device allows. You can also ask it to check anything you are unsure about.", primary, gates };
}

export const gateTone = (tone: GateTone) => tone === "good" ? "resting" : tone === "attention" ? "growling" : "neutral";