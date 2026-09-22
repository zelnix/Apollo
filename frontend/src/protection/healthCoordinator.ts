import * as Crypto from "expo-crypto";

import { securityAdapter } from "@/src/security/securityAdapter";
import { MessagingSdk } from "@/src/security/messagingSdk";
import { CallSdk } from "@/src/security/callSdk";
import { pendingAttempt, recordAttempt, clearAttempt, type ActionAttempt } from "@/src/settings/recheck";
import { storage } from "@/src/utils/storage";
import { protectionHealthSnapshot, publishProtectionHealth } from "./healthStore";
import { decideSiteRecovery } from "./recoveryPolicy";
import type { GateHealthRecord, HealthTrigger, ProtectionHealthSnapshot } from "./healthTypes";

const DESIRED_KEY = "apollo.protection.on";
const TITLES: Record<GateHealthRecord["id"], string> = { site: "Site protection", text: "Text protection", call: "Call protection", email: "Email checks", link: "Link checks", file: "File checks", app: "App checks", device: "Device checks", account: "Account checks", network: "Network checks" };
let inFlight: Promise<ProtectionHealthSnapshot> | null = null;
let promptInFlight: Promise<ActionAttempt> | null = null;

function manual(id: GateHealthRecord["id"], route: string, scope: string): GateHealthRecord {
  return { id, title: TITLES[id], state: "manual_only", checkedAt: new Date().toISOString(), source: "manual", scope, userAction: { kind: "open_gate", label: `Open ${TITLES[id]}`, route } };
}

function buildGates(snapshot: Omit<ProtectionHealthSnapshot, "gates">, messaging: Awaited<ReturnType<typeof MessagingSdk.getMessagingCapabilities>>, calls: Awaited<ReturnType<typeof CallSdk.getCallProtectionCapabilities>>, desiredOn: boolean): GateHealthRecord[] {
  const checkedAt = snapshot.checkedAt;
  const decision = snapshot.protection ? decideSiteRecovery(desiredOn, snapshot.protection, snapshot.permissions) : "degraded";
  const siteState: GateHealthRecord["state"] = decision === "healthy" ? "running" : decision === "off_by_choice" ? "stopped" : decision === "start_now" || decision === "degraded" ? "degraded" : "needs_user";
  const site: GateHealthRecord = { id: "site", title: TITLES.site, state: siteState, checkedAt, source: "os",
    scope: siteState === "running" ? (snapshot.protection?.coverage ?? "Site protection is active.") : siteState === "stopped" ? "Site protection is off by choice." : "Site protection needs your approval before it can run.",
    userAction: siteState === "needs_user" || siteState === "degraded" ? { kind: "restore_site", label: "Restore site protection" } : null };
  const textState: GateHealthRecord["state"] = messaging.smsFiltering === "supported" ? "running" : messaging.smsFiltering === "permission_required" ? "needs_user" : "manual_only";
  const callState: GateHealthRecord["state"] = calls.callScreening === "supported" ? "running" : calls.callScreening === "permission_required" ? "needs_user" : "manual_only";
  return [site,
    { id: "text", title: TITLES.text, state: textState, checkedAt, source: "native", scope: textState === "running" ? "Suspicious message notifications can be assessed on this device." : "Paste or share a message for a one-off check.", userAction: { kind: "open_gate", label: textState === "needs_user" ? "Set up text protection" : "Check a message", route: "/message" } },
    { id: "call", title: TITLES.call, state: callState, checkedAt, source: "native", scope: callState === "running" ? "The device call-screening role is active." : "Check a call using the number and what was said.", userAction: { kind: "open_gate", label: callState === "needs_user" ? "Set up call protection" : "Check a call", route: "/call" } },
    manual("email", "/email", "Paste an email or connect the optional read-only monitor."), manual("link", "/check", "Paste or share a link before opening it."),
    manual("file", "/file", "Choose a file for a one-off local inspection."), manual("app", "/app-check", "Describe an app or check the signals this device exposes."),
    manual("device", "/device", "Review current device signals in a one-off check."), manual("account", "/account", "Review an account alert without sharing a password."),
    manual("network", "/network", "Review the network facts this device exposes."),
  ];
}

async function collect(trigger: HealthTrigger): Promise<ProtectionHealthSnapshot> {
  const current = protectionHealthSnapshot();
  publishProtectionHealth({ ...current, checking: true, trigger, revision: current.revision + 1 });
  let [capabilities, protection, permissions, network, messaging, calls, desiredSetting] = await Promise.all([
    securityAdapter.getCapabilities(), securityAdapter.getProtectionStatus(), securityAdapter.getProtectionPermissions(), securityAdapter.getNetworkStatus(),
    MessagingSdk.getMessagingCapabilities(), CallSdk.getCallProtectionCapabilities(), storage.getItem<boolean>(DESIRED_KEY, false),
  ]);
  const desiredOn = desiredSetting === true;
  let decision = decideSiteRecovery(desiredOn, protection, permissions);
  if (decision === "start_now") {
    await securityAdapter.startProtection();
    [capabilities, protection, permissions, network] = await Promise.all([securityAdapter.getCapabilities(), securityAdapter.getProtectionStatus(), securityAdapter.getProtectionPermissions(), securityAdapter.getNetworkStatus()]);
    decision = decideSiteRecovery(desiredOn, protection, permissions);
  }
  const attempt = await pendingAttempt();
  if (attempt?.kind === "restore_site" && Date.parse(attempt.expiresAt ?? "") <= Date.now()) await clearAttempt();
  else if (attempt?.kind === "restore_site" && (trigger === "foreground" || trigger === "boot")) {
    if (decision === "healthy") await clearAttempt();
    else if (trigger === "foreground") await clearAttempt(); // returned without a grant: allow a fresh deliberate retry
  }
  const base = { revision: current.revision + 1, checkedAt: new Date().toISOString(), trigger, checking: false, capabilities, protection, permissions, network };
  const next: ProtectionHealthSnapshot = { ...base, gates: buildGates(base, messaging, calls, desiredOn) };
  publishProtectionHealth(next);
  return next;
}

export function runProtectionHealthCheck(trigger: HealthTrigger): Promise<ProtectionHealthSnapshot> {
  if (inFlight) return inFlight;
  inFlight = collect(trigger).finally(() => { inFlight = null; });
  return inFlight;
}

export async function requestSiteProtectionRecovery(): Promise<ActionAttempt> {
  if (promptInFlight) return promptInFlight;
  const request = (async (): Promise<ActionAttempt> => {
    const existing = await pendingAttempt();
    if (existing?.kind === "restore_site" && Date.parse(existing.expiresAt ?? "") > Date.now()) return existing;
    const startedAt = new Date().toISOString();
    const attempt: ActionAttempt = { id: Crypto.randomUUID(), kind: "restore_site", caseId: null, planId: null, descriptorId: "permission.vpn_config", startedAt, expiresAt: new Date(Date.now() + 2 * 60 * 1000).toISOString(), returnedAt: null, status: "requested" };
    await recordAttempt(attempt);
    await storage.setItem(DESIRED_KEY, "true");
    const result = await securityAdapter.requestProtectionPermission("vpn_config");
    if (result.status === "granted" || result.requestState === "already_granted") {
      await storage.setItem(DESIRED_KEY, "true");
      await clearAttempt();
      await runProtectionHealthCheck("protection_change");
      return { ...attempt, status: "returned" as const, returnedAt: new Date().toISOString() };
    }
    if (result.requestState === "launch_failed" || result.requestState === "unsupported" || !result.canAskAgain) {
      await clearAttempt();
      await runProtectionHealthCheck("user_action");
      return { ...attempt, status: "failed" as const };
    }
    const opened = { ...attempt, status: "opened" as const };
    await recordAttempt(opened);
    return opened;
  })().finally(() => { promptInFlight = null; });
  promptInFlight = request;
  return request;
}

export async function completeSiteProtectionAttempt(attempt: ActionAttempt): Promise<boolean> {
  if (attempt.kind !== "restore_site" || Date.parse(attempt.expiresAt ?? "") <= Date.now()) { await clearAttempt(); return false; }
  const next = await runProtectionHealthCheck("foreground");
  return next.protection?.operational === true;
}