import type { Capability } from "./types";
import type { UserAction } from "./userActions";
import type { CallProtectionCapabilities } from "@/src/security/callSdk";
import type { MessagingCapabilities } from "@/src/security/messagingSdk";
import type { NetworkStatus, ProtectionPermission, ProtectionStatus } from "@/src/security/SecurityPlatformAdapter";
import { VERIFICATION_FRESHNESS_MS } from "./stateMachine.ts";

export type GateId = "site" | "link" | "text" | "call" | "network" | "account" | "email" | "file" | "app" | "device";
export type GateAutomationKind = "enforcement" | "monitoring" | "event_driven";
export type AutomaticCapabilityState = "running" | "checking" | "permission_needed" | "setup_needed" | "off_by_choice" | "interrupted" | "temporarily_unavailable" | "unsupported" | "not_activated";
export type OnDemandCapabilityState = "ready" | "temporarily_unavailable" | "unsupported";
// Standardised user-facing statuses. "Watching" is the ONLY success label and means verified, active,
// automatic protection within its supported scope — never merely "enabled" or "permission granted".
export type GateStatusLabel = "Watching" | "Manual check" | "Check in progress" | "Setup required" | "Off" | "Limited" | "Action needed" | "Unavailable" | "Unable to verify";
export type GateTone = "good" | "limited" | "action" | "neutral" | "off" | "unavailable" | "unverified";

export interface GatePresentation {
  id: GateId; title: string; purpose: string; currentHelp: string; statusLabel: GateStatusLabel; tone: GateTone;
  capability: { automatic?: { kind: GateAutomationKind; state: AutomaticCapabilityState; lastObservedAt?: string; limitation?: string; manualOnly?: boolean; coverageLimited?: boolean }; onDemand?: { state: OnDemandCapabilityState; action: UserAction } };
  primaryAction?: UserAction;
}
export type GateItem = GatePresentation;
export interface GatesOverview { summary: string; higgins: string; primary: GatePresentation | null; gates: GatePresentation[] }
export interface EmailMonitorCapability { checking: boolean; configured: boolean; connected: boolean; monitoringRequested: boolean; lastCheckedAt: string | null; lastSuccessAt?: string | null; lastAssessmentAt?: string | null; lastErrorAt: string | null }
export interface GatesInput { platform: string; checking: boolean; protection: ProtectionStatus | null; permissions: ProtectionPermission[]; capabilities: Capability[]; messaging: MessagingCapabilities | null; calls: CallProtectionCapabilities | null; network?: NetworkStatus | null; email?: EmailMonitorCapability; online?: boolean; accountBreachConfigured?: boolean; callAutoCheckEnabled?: boolean; desiredSiteOn?: boolean; now?: number }

const PURPOSE: Record<GateId, string> = {
  site: "Helps stop known dangerous websites before they load.",
  link: "Checks where a link really leads and looks for scams, fake websites and harmful downloads.",
  text: "Looks for scam messages, fake alerts, urgent payment requests and dangerous links.",
  call: "Checks suspicious callers and numbers and helps you decide whether it is safe to respond.",
  network: "Reports the internet connection you are using (Wi-Fi or mobile data) and whether Apollo's protection for it is operating, warning you about unsafe connections and network changes.",
  account: "Investigates warnings about your accounts and helps you take the right recovery steps.",
  email: "Looks for phishing, impersonation, dangerous links and risky attachments in emails you share or connect.",
  file: "Checks files and attachments for suspicious content, hidden links and signs they may be unsafe. A cloud download is not automatically trusted.",
  app: "Checks whether an app's source, permissions and behaviour give you a reason to be cautious—even if it has not been used recently.",
  device: "Checks whether important protections and permissions are working and looks for changes that may need your attention.",
};
const TITLE: Record<GateId, string> = { site: "Website protection", link: "Link checking", text: "Message screening", call: "Call screening", network: "Internet monitoring", account: "Account alerts", email: "Email monitoring", file: "File checking", app: "App checking", device: "Device monitoring" };
const cap = (items: Capability[], id: string) => items.find((item) => item.id === id);
const action = (id: UserAction["id"], label: string): UserAction => ({ id, label });
const onDemand = (id: UserAction["id"], label: string, state: OnDemandCapabilityState = "ready") => ({ state, action: action(id, label) });

function presentation(base: Omit<GatePresentation, "statusLabel" | "tone">): GatePresentation {
  const auto = base.capability.automatic; const od = base.capability.onDemand;
  // WATCHING is only for verified, active automatic protection (not manual-only, not restricted).
  let statusLabel: GateStatusLabel; let tone: GateTone;
  if (!auto) {
    if (od?.state === "ready") { statusLabel = "Manual check"; tone = "neutral"; }
    else if (od?.state === "temporarily_unavailable") { statusLabel = "Unable to verify"; tone = "unverified"; }
    else { statusLabel = "Unavailable"; tone = "unavailable"; }
  } else if (auto.state === "running") {
    if (auto.manualOnly) { statusLabel = "Manual check"; tone = "neutral"; }
    else if (auto.coverageLimited) { statusLabel = "Limited"; tone = "limited"; }
    else { statusLabel = "Watching"; tone = "good"; }
  } else if (auto.state === "checking") { statusLabel = "Check in progress"; tone = "neutral"; }
  else if (auto.state === "interrupted") { statusLabel = "Action needed"; tone = "action"; }
  else if (auto.state === "permission_needed" || auto.state === "setup_needed" || auto.state === "not_activated") { statusLabel = "Setup required"; tone = "neutral"; }
  else if (auto.state === "off_by_choice") { statusLabel = "Off"; tone = "off"; }
  else if (auto.state === "temporarily_unavailable") { statusLabel = "Unable to verify"; tone = "unverified"; }
  else { statusLabel = "Unavailable"; tone = "unavailable"; }
  const request = !!auto && ["permission_needed", "setup_needed", "interrupted"].includes(auto.state);
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
  const siteState: AutomaticCapabilityState = input.checking || !input.protection ? "checking" : siteUnsupported ? "unsupported" : input.protection.operational && siteFresh && siteCapability?.status === "active" ? "running" : !(input.protection.requested || input.desiredSiteOn) ? "off_by_choice" : sitePermission ? "permission_needed" : input.protection.operational && siteCapability?.status === "active" ? "temporarily_unavailable" : "interrupted";
  const site = presentation({ id: "site", title: TITLE.site, purpose: PURPOSE.site,
    currentHelp: siteState === "running" ? "Apollo is filtering supported website traffic." : siteState === "interrupted" ? "Website protection was on but has stopped — it is not filtering right now." : siteState === "permission_needed" ? "Website protection needs VPN permission to filter traffic. Your other protection is still active — grant it whenever you're ready." : siteState === "off_by_choice" ? "Website protection is off. You can still check suspicious links." : siteState === "checking" ? "Apollo is checking website protection." : "Apollo cannot confirm website protection right now.",
    capability: { automatic: { kind: "enforcement", state: siteState, lastObservedAt: input.protection?.checkedAt ?? undefined, limitation: siteState === "interrupted" ? "Website protection was on but is not operating. Open it to restart." : siteState === "permission_needed" ? "Grant the VPN permission to enable website protection. Your other protection stays active." : siteState === "temporarily_unavailable" ? "Apollo will keep checking in the background." : undefined }, onDemand: onDemand("check_link", "Check a suspicious link") },
    primaryAction: siteState === "running" ? action("check_link", "Check a suspicious link") : action("restore_site", siteState === "permission_needed" ? "Grant VPN permission" : "Turn on website protection") });

  // B4: Text Gate status — distinguish background processing from merely having notification access.
  // On Android, "smsFiltering: supported" means notification access is granted but NOT that background
  // assessment is completing. On iOS, "supported" now requires 72h recency, not 30 days.
  const textStateBase: AutomaticCapabilityState = input.checking || !input.messaging ? "checking" : input.messaging.smsFiltering === "supported" ? "running" : input.messaging.smsFiltering === "permission_required" ? "permission_needed" : "unsupported";
  const textHistorical = (input.messaging as unknown as Record<string, unknown> | undefined)?.messageFilterHistoricalOnly === true;
  // Historical-only means the filter ran before but has no recent observation — we cannot verify it is
  // actively filtering now, so this is "Unable to verify", never "Watching".
  const textState: AutomaticCapabilityState = textStateBase === "running" && textHistorical ? "temporarily_unavailable" : textStateBase;
  const textLimitation = textState === "permission_needed"
    ? "Allow message checking to watch supported new messages."
    : textState === "temporarily_unavailable"
      ? "Message filter was active previously but has no recent observation. Manual checks still work for any message."
      : textState === "running"
        ? "Background assessment runs for captured messages. Manual checks work for all messages."
        : undefined;
  const text = presentation({ id: "text", title: TITLE.text, purpose: PURPOSE.text,
    currentHelp: textState === "running" ? "Apollo captures and assesses supported new-message events in the background." : "You can still paste, share or add a screenshot of a message.",
    capability: { automatic: { kind: "event_driven", state: textState, lastObservedAt: observedNow, limitation: textLimitation }, onDemand: onDemand("check_text", "Check a message") },
    primaryAction: action("setup_text", "Allow message checking") });

  // Call Gate — "running" means call screening role is held, and pending numbers are now assessed
  // automatically (with consent). Without consent, the gate is "ready" but not automatically checking.
  const callState: AutomaticCapabilityState = input.checking || !input.calls ? "checking" : input.calls.callScreening === "supported" ? "running" : input.calls.callScreening === "permission_required" ? "permission_needed" : "unsupported";
  const callLimitation = callState === "permission_needed"
    ? "Choose Apollo for supported call screening."
    : callState === "running"
      ? "Incoming numbers are assessed automatically when you enable automatic call checking. Manual checks always work."
      : undefined;
  const call = presentation({ id: "call", title: TITLE.call, purpose: PURPOSE.call,
    currentHelp: callState === "running" ? (input.callAutoCheckEnabled ? "Apollo screens incoming calls and looks up unknown numbers automatically." : "Apollo screens incoming calls against your block and allow lists.") : "You can check a number, caller name or call story before responding.",
    capability: { automatic: { kind: "event_driven", state: callState, lastObservedAt: observedNow, limitation: callLimitation }, onDemand: onDemand("check_call", "Check a call or number") },
    primaryAction: action("setup_call", "Set up call checking") });

  // C3/C4: Network Gate watches the live OS connection snapshot — it re-checks on every app open,
  // network change and periodic sweep, so it is "Watching" whenever Apollo has a current, connected
  // reading (no VPN needed). Site Gate's DNS VPN additionally provides a continuous *background*
  // observer; when it is off Apollo still watches in the foreground — disclosed in the limitation.
  const networkObserved = input.network?.checkedAt;
  const vpnActive = (input.network as Record<string, unknown> | undefined)?.vpnActive === true;
  const networkState: AutomaticCapabilityState = input.checking ? "checking" : !input.network || !input.network.connected ? "temporarily_unavailable" : (vpnActive || input.network.inspectable) ? "running" : "permission_needed";
  const networkLimitation = networkState === "permission_needed"
    ? "Allow network information to receive automatic warnings."
    : networkState === "running" && !vpnActive
      ? "Apollo checks the connection on every app open and network change. Turn on website protection for continuous background watching."
      : networkState === "temporarily_unavailable"
        ? "Apollo cannot observe the current connection yet."
        : undefined;
  const network = presentation({ id: "network", title: TITLE.network, purpose: PURPOSE.network,
    currentHelp: networkState === "running" ? (vpnActive ? "Apollo is watching this connection, with continuous background filtering through website protection." : "Apollo is watching this connection and re-checks on every app open and network change.") : networkState === "permission_needed" ? "Allow network information so Apollo can watch this connection." : "You can run a current network check now.",
    capability: { automatic: { kind: "monitoring", state: networkState, lastObservedAt: networkObserved, limitation: networkLimitation, coverageLimited: networkState === "running" && !vpnActive }, onDemand: onDemand("check_network", "Check this network") },
    primaryAction: action("check_network", "Check this network") });

  const email = input.email; const successAt = email?.lastSuccessAt ? Date.parse(email.lastSuccessAt) : email?.lastCheckedAt ? Date.parse(email.lastCheckedAt) : 0; const errorAt = email?.lastErrorAt ? Date.parse(email.lastErrorAt) : 0;
  const assessmentAt = email?.lastAssessmentAt ? Date.parse(email.lastAssessmentAt) : 0;
  const retrievalFresh = successAt > 0 && successAt <= now && now - successAt <= 20 * 60 * 1000 && successAt >= errorAt;
  const assessmentFresh = assessmentAt > 0 && assessmentAt <= now && now - assessmentAt <= 60 * 60 * 1000;
  // "running" requires BOTH retrieval AND assessment to be recent. Retrieval-only is "checking" (pipeline not yet proven).
  // Email connection is OPTIONAL — a missing connection is informational ("Ready when you need it"),
  // never "Needs your attention"/barking (standing message requirement).
  const emailState: AutomaticCapabilityState = email?.checking ? "checking" : email && !email.configured ? "unsupported" : !email?.connected ? "not_activated" : !email.monitoringRequested ? "off_by_choice" : retrievalFresh && assessmentFresh ? "running" : retrievalFresh ? "checking" : "temporarily_unavailable";
  const emailLimitation = emailState === "not_activated" ? "Optional: connect a read-only mailbox for automatic checking. You can check any email manually right now." : emailState === "temporarily_unavailable" ? "Mailbox monitoring has no recent successful check." : emailState === "checking" ? "Messages are being retrieved but no assessment has completed yet." : undefined;
  const emailGate = presentation({ id: "email", title: TITLE.email, purpose: PURPOSE.email, currentHelp: emailState === "running" ? "Apollo is watching the connected mailbox and assessments are completing." : emailState === "checking" ? "Apollo is retrieving messages. Assessment results are pending." : emailState === "not_activated" ? "Email monitoring isn't connected. You can check any email now, or connect a mailbox for automatic help." : "You can paste, share or scan an email now.", capability: { automatic: { kind: "monitoring", state: emailState, lastObservedAt: email?.lastAssessmentAt ?? email?.lastSuccessAt ?? email?.lastCheckedAt ?? undefined, limitation: emailLimitation }, onDemand: onDemand("open_email", "Check an email") }, primaryAction: action("open_email", "Check an email") });

  // Event-driven gates that respond to user actions (link, account) are always "ready" when online
  // but are NOT continuously monitoring — they should not claim "Watching". Only gates with a real
  // background monitoring loop or enforcement mechanism should report "running".
  const linkAuto: GatePresentation["capability"]["automatic"] = { kind: "event_driven", state: input.online === false ? "temporarily_unavailable" : "running", manualOnly: true, lastObservedAt: observedNow, limitation: input.online === false ? "Online reputation and public research are unavailable." : "Link checking responds when triggered — no continuous background monitoring." };
  const link = simple("link", input.online === false ? "On-device link checks remain ready; online checks are unavailable." : "Apollo checks links when triggered by another protection or when you submit one.", "check_link", "Check a link", linkAuto);
  // Gate 8 — Account alerts. Event-driven (responds when triggered). The core check ("Check an
  // account alert" — analysing a login/MFA/reset/breach warning) always works and needs no backend
  // key, so the gate is never "unavailable". The optional live breach-list lookup (HIBP) is an extra:
  // when the backend confirms breach_lookup_configured it is reported as "Watching"; when it is not
  // configured the gate simply reads "Ready when you need it" with the lookup noted as off.
  const accountAuto: GatePresentation["capability"]["automatic"] | undefined = input.accountBreachConfigured === true
    ? { kind: "event_driven", state: "running", manualOnly: true, lastObservedAt: observedNow, limitation: "Account checking responds when triggered — no continuous background monitoring." }
    : undefined;
  const account = simple("account", input.accountBreachConfigured === true ? "Apollo is ready for account alerts from supported messages, email and checks you start." : "You can check a login, breach or recovery alert anytime. Live breach-list lookup isn’t set up, but alert analysis still works.", "check_account", "Check an account alert", accountAuto);
  const fileCap = cap(input.capabilities, "file_guard"); const fileAuto = fileCap ? { kind: "event_driven" as const, state: fileCap.status === "active" ? "running" as const : fileCap.status === "permission_required" ? "permission_needed" as const : "unsupported" as const, manualOnly: true, lastObservedAt: observedNow } : undefined;
  const appCap = cap(input.capabilities, "app_guard"); const appAuto = appCap ? { kind: "event_driven" as const, state: appCap.status === "active" ? "running" as const : appCap.status === "permission_required" ? "permission_needed" as const : "unsupported" as const, manualOnly: true, lastObservedAt: observedNow } : undefined;
  const deviceCap = cap(input.capabilities, "device_guard"); const deviceAuto = deviceCap ? { kind: "monitoring" as const, state: deviceCap.status === "active" ? "running" as const : deviceCap.status === "permission_required" ? "permission_needed" as const : "unsupported" as const, lastObservedAt: observedNow } : undefined;
  const file = simple("file", "Apollo is ready when a file or attachment is shared with it.", "check_file", "Check a file", fileAuto);
  const app = simple("app", "Apollo is ready to check an installed app or one you are considering.", "check_app", "Check an app", appAuto);
  const device = simple("device", "Apollo is checking visible protection health and is ready for a fuller device check.", "check_device", "Check my device", deviceAuto);

  const rank = (gate: GatePresentation) => gate.tone === "action" ? 0 : (gate.capability.automatic?.state === "running" && !gate.capability.automatic?.manualOnly) ? 1 : gate.capability.onDemand?.state === "ready" ? 2 : 3;
  const gates = [site, link, text, call, network, account, emailGate, file, app, device].sort((a, b) => rank(a) - rank(b));
  const primary = gates.find((gate) => gate.tone === "action") ?? null; const working = gates.filter((gate) => gate.capability.automatic?.state === "running" && !gate.capability.automatic?.manualOnly).length;
  const attentionGates = gates.filter((gate) => gate.tone === "action");
  const attentionNames = attentionGates.map((g) => g.title.replace(/ Gate$/, "")).join(" and ");
  // A gate awaiting optional setup/permission is NOT an alarm. Only a verified problem (tone "action")
  // counts as "needs your attention"; Apollo never barks about optional setup.
  const summary = input.checking ? "Checking your protection" : (attentionGates.length > 0 && working > 0) ? "Protection active — reduced coverage" : attentionGates.length ? `${attentionNames} ${attentionGates.length === 1 ? "needs" : "need"} your attention` : `${working} ${working === 1 ? "protection is" : "protections are"} helping automatically`;
  return { summary, higgins: primary ? `${primary.title} needs your attention. ${primary.currentHelp}` : "Apollo watches what this device allows. You can also ask it to check anything you are unsure about.", primary, gates };
}

export const gateTone = (tone: GateTone) => tone === "good" ? "resting" : tone === "action" ? "barking" : tone === "limited" || tone === "unverified" ? "ears_up" : tone === "off" || tone === "unavailable" ? "unknown" : "neutral";