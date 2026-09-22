import * as Crypto from "expo-crypto";

import { apiGet } from "@/src/api/client";
import { getDeviceIdentity } from "@/src/auth/deviceIdentity";
import { buildGatesOverview, type EmailMonitorCapability } from "@/src/domain/gates";
import { securityAdapter } from "@/src/security/securityAdapter";
import { MessagingSdk } from "@/src/security/messagingSdk";
import { CallSdk } from "@/src/security/callSdk";
import { pendingAttempt, recordAttempt, clearAttempt, type ActionAttempt } from "@/src/settings/recheck";
import { storage } from "@/src/utils/storage";
import { protectionHealthSnapshot, publishProtectionHealth } from "./healthStore";
import { decideSiteRecovery } from "./recoveryPolicy";
import type { HealthTrigger, ProtectionHealthSnapshot } from "./healthTypes";

const DESIRED_KEY = "apollo.protection.on";
let inFlight: Promise<ProtectionHealthSnapshot> | null = null;
let promptInFlight: Promise<ActionAttempt> | null = null;

interface GmailStatusResponse {
  connected: boolean; configured: boolean; monitoring_enabled: boolean; monitor_last_checked_at: string | null;
  monitor_last_success_at: string | null; monitor_last_error_at: string | null; monitor_state: string;
}

async function readEmailCapability(): Promise<EmailMonitorCapability> {
  const identity = await getDeviceIdentity();
  if (!identity) return { checking: false, configured: true, connected: false, monitoringRequested: false, lastCheckedAt: null, lastSuccessAt: null, lastErrorAt: null };
  try {
    const status = await apiGet<GmailStatusResponse>(`/gmail/status?device_id=${identity.deviceId}`);
    return { checking: status.monitor_state === "checking", configured: status.configured, connected: status.connected, monitoringRequested: status.monitoring_enabled, lastCheckedAt: status.monitor_last_checked_at, lastSuccessAt: status.monitor_last_success_at, lastErrorAt: status.monitor_last_error_at };
  } catch {
    return { checking: false, configured: true, connected: false, monitoringRequested: false, lastCheckedAt: null, lastSuccessAt: null, lastErrorAt: new Date().toISOString() };
  }
}

async function collect(trigger: HealthTrigger): Promise<ProtectionHealthSnapshot> {
  const current = protectionHealthSnapshot();
  publishProtectionHealth({ ...current, checking: true, trigger, revision: current.revision + 1 });
  let [capabilities, protection, permissions, network, messaging, calls, email, desiredSetting] = await Promise.all([
    securityAdapter.getCapabilities(), securityAdapter.getProtectionStatus(), securityAdapter.getProtectionPermissions(), securityAdapter.getNetworkStatus(),
    MessagingSdk.getMessagingCapabilities(), CallSdk.getCallProtectionCapabilities(), readEmailCapability(), storage.getItem<boolean>(DESIRED_KEY, false),
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
    if (decision === "healthy") await clearAttempt(); else if (trigger === "foreground") await clearAttempt();
  }
  const base = { revision: current.revision + 1, checkedAt: new Date().toISOString(), trigger, checking: false, capabilities, protection, permissions, network };
  const overview = buildGatesOverview({ platform: securityAdapter.kind, checking: false, protection, permissions, capabilities, messaging, calls, network, email, online: network.isInternetReachable !== false });
  const next: ProtectionHealthSnapshot = { ...base, gates: overview.gates };
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
    await recordAttempt(attempt); await storage.setItem(DESIRED_KEY, "true");
    const result = await securityAdapter.requestProtectionPermission("vpn_config");
    if (result.status === "granted" || result.requestState === "already_granted") { await storage.setItem(DESIRED_KEY, "true"); await clearAttempt(); await runProtectionHealthCheck("protection_change"); return { ...attempt, status: "returned", returnedAt: new Date().toISOString() }; }
    if (result.requestState === "launch_failed" || result.requestState === "unsupported" || !result.canAskAgain) { await clearAttempt(); await runProtectionHealthCheck("user_action"); return { ...attempt, status: "failed" }; }
    const opened: ActionAttempt = { ...attempt, status: "opened" }; await recordAttempt(opened); return opened;
  })().finally(() => { promptInFlight = null; });
  promptInFlight = request; return request;
}

export async function completeSiteProtectionAttempt(attempt: ActionAttempt): Promise<boolean> {
  if (attempt.kind !== "restore_site" || Date.parse(attempt.expiresAt ?? "") <= Date.now()) { await clearAttempt(); return false; }
  const next = await runProtectionHealthCheck("foreground"); return next.protection?.operational === true;
}