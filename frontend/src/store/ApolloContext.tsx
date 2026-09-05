// ApolloProvider — app-wide store: device identity (via SecureCore), adapter
// status/capabilities, Patrol events (local-first, minimal sync), trust list,
// verification timestamps and the resolved Apollo state.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";

import { apiDelete, apiGet, apiPost } from "@/src/api/client";
import { visibilityFrom } from "@/src/domain/capability";
import { decide } from "@/src/domain/decision";
import { minimalIndicator } from "@/src/domain/privacy";
import { analyseUrlLocally } from "@/src/domain/risk";
import { canTransition, resolveApolloState, type StateResolution } from "@/src/domain/stateMachine";
import type { ApolloState, Capability, Decision, IntelResult, LocalAnalysis, PatrolEvent } from "@/src/domain/types";
import { IS_MOCK_SECURITY, SECURITY_MODE, securityAdapter } from "@/src/security/securityAdapter";
import type { BlockResult, NetworkStatus, ProtectionPermission, ProtectionStatus } from "@/src/security/SecurityPlatformAdapter";
import { SecureCore } from "@/src/security/securecore/SecureCore";
import { storage } from "@/src/utils/storage";

const K = { setup: "apollo.setup.done", events: "apollo.patrol.events", trust: "apollo.trust.entries", verified: "apollo.lastVerifiedAt", protection: "apollo.protection.on" };

export interface TrustEntry { trust_id: string; device_id: string; indicator_type: "url" | "domain"; indicator_digest: string; indicator_host: string; event_id: string | null; created_at: string; local_indicator?: string }

export interface CheckOutcome { local: LocalAnalysis; intel: IntelResult | null; intelError: string | null; decision: Decision; event: PatrolEvent | null }

interface ApolloContextValue {
  ready: boolean;
  setupDone: boolean;
  deviceId: string | null;
  completeSetup(): Promise<void>;
  capabilities: Capability[];
  protection: ProtectionStatus | null;
  permissions: ProtectionPermission[];
  network: NetworkStatus | null;
  adapterLabel: string;
  isMock: boolean;
  refreshing: boolean;
  refresh(): Promise<void>;
  verifyNow(): Promise<void>;
  lastVerifiedAt: string | null;
  toggleProtection(on: boolean): Promise<void>;
  requestPermission(id: ProtectionPermission["id"]): Promise<ProtectionPermission>;
  events: PatrolEvent[];
  trust: TrustEntry[];
  resolution: StateResolution;
  checkLink(input: string): Promise<CheckOutcome>;
  blockEvent(event: PatrolEvent): Promise<BlockResult>;
  trustEvent(event: PatrolEvent): Promise<boolean>;
  resolveEvent(event: PatrolEvent): Promise<void>;
  revokeTrust(entry: TrustEntry): Promise<void>;
  clearPatrol(): Promise<void>;
  toast: { message: string; tone: ApolloState | "neutral" } | null;
  showToast(message: string, tone?: ApolloState | "neutral"): void;
}

const Ctx = createContext<ApolloContextValue | null>(null);

export function ApolloProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const [ready, setReady] = useState(false);
  const [setupDone, setSetupDone] = useState(false);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [protection, setProtection] = useState<ProtectionStatus | null>(null);
  const [permissions, setPermissions] = useState<ProtectionPermission[]>([]);
  const [network, setNetwork] = useState<NetworkStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastVerifiedAt, setLastVerifiedAt] = useState<string | null>(null);
  const [events, setEvents] = useState<PatrolEvent[]>([]);
  const [trust, setTrust] = useState<TrustEntry[]>([]);
  const [toast, setToast] = useState<ApolloContextValue["toast"]>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [, setTick] = useState(0);

  const showToast = useCallback((message: string, tone: ApolloState | "neutral" = "neutral") => {
    setToast({ message, tone });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  const persistEvents = useCallback(async (next: PatrolEvent[]) => { setEvents(next); await storage.setItem(K.events, JSON.stringify(next)); }, []);
  const persistTrust = useCallback(async (next: TrustEntry[]) => { setTrust(next); await storage.setItem(K.trust, JSON.stringify(next)); }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [caps, status, perms, net] = await Promise.all([
        securityAdapter.getCapabilities(), securityAdapter.getProtectionStatus(), securityAdapter.getProtectionPermissions(), securityAdapter.getNetworkStatus(),
      ]);
      setCapabilities(caps); setProtection(status); setPermissions(perms); setNetwork(net);
    } finally { setRefreshing(false); }
  }, []);

  const verifyNow = useCallback(async () => {
    await refresh();
    const ts = new Date().toISOString();
    setLastVerifiedAt(ts);
    await storage.setItem(K.verified, ts);
  }, [refresh]);

  // Boot
  useEffect(() => {
    (async () => {
      try {
        await SecureCore.initialize();
        const [done, ev, tr, ver, protOn] = await Promise.all([
          storage.getItem<boolean>(K.setup, false), storage.getItem<string | null>(K.events, null), storage.getItem<string | null>(K.trust, null),
          storage.getItem<string | null>(K.verified, null), storage.getItem<boolean>(K.protection, false),
        ]);
        setSetupDone(!!done);
        if (ev) setEvents(JSON.parse(ev)); if (tr) setTrust(JSON.parse(tr)); setLastVerifiedAt(ver ?? null);
        if (done) {
          const status = await SecureCore.getSecurityStatus();
          if (status.deviceIdentityExists) setDeviceId((await SecureCore.createDeviceIdentity()).deviceId);
          if (protOn) await securityAdapter.startProtection();
        }
        await refresh();
      } finally { setReady(true); }
    })();
  }, [refresh]);

  // Re-resolve state over time so cooldown/freshness windows expire visibly.
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 30000); return () => clearInterval(t); }, []);

  const completeSetup = useCallback(async () => {
    const identity = await SecureCore.createDeviceIdentity();
    setDeviceId(identity.deviceId);
    try {
      await apiPost("/devices/register", "device_register", { device_id: identity.deviceId, platform: Platform.OS, adapter_mode: SECURITY_MODE, app_version: "1.0.0" });
    } catch { /* offline is fine; registration retries on next launch */ }
    await securityAdapter.startProtection();
    await storage.setItem(K.protection, true);
    await storage.setItem(K.setup, true);
    setSetupDone(true);
    await verifyNow();
  }, [verifyNow]);

  // Remote Patrol + trust merge (device may have reinstalled). Local wins.
  const remoteEvents = useQuery({ queryKey: ["patrol", deviceId], enabled: !!deviceId, queryFn: () => apiGet<PatrolEvent[]>(`/patrol/events?device_id=${deviceId}`) });
  const remoteTrust = useQuery({ queryKey: ["trust", deviceId], enabled: !!deviceId, queryFn: () => apiGet<TrustEntry[]>(`/trust?device_id=${deviceId}`) });
  useEffect(() => {
    if (!remoteEvents.data) return;
    const known = new Set(events.map((e) => e.event_id));
    const missing = remoteEvents.data.filter((e) => !known.has(e.event_id));
    if (missing.length) void persistEvents([...events, ...missing].sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at)));
  }, [remoteEvents.data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!remoteTrust.data) return;
    const known = new Set(trust.map((t) => t.trust_id));
    const missing = remoteTrust.data.filter((t) => !known.has(t.trust_id));
    if (missing.length) void persistTrust([...trust, ...missing]);
  }, [remoteTrust.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const syncEvent = useCallback(async (e: PatrolEvent) => {
    if (!deviceId) return;
    const { local_indicator: _omit, trust_allowed: _omit2, ...rest } = e; // never leaves device
    try { await apiPost("/patrol/events", "patrol_sync", { ...rest, device_id: deviceId }); qc.invalidateQueries({ queryKey: ["patrol", deviceId] }); } catch { /* offline: local copy is authoritative */ }
  }, [deviceId, qc]);

  const upsertEvent = useCallback(async (e: PatrolEvent) => {
    const next = [e, ...events.filter((x) => x.event_id !== e.event_id)];
    await persistEvents(next);
    void syncEvent(e);
  }, [events, persistEvents, syncEvent]);

  const toggleProtection = useCallback(async (on: boolean) => {
    const status = on ? await securityAdapter.startProtection() : await securityAdapter.stopProtection();
    await storage.setItem(K.protection, on);
    setProtection(status);
    await refresh();
    const ev: PatrolEvent = {
      event_id: Crypto.randomUUID(), device_id: deviceId ?? "local", category: "protection", state: "resting", status: "resolved",
      headline: on ? "Protection turned on" : "Protection turned off",
      what_happened: on ? "You turned Apollo's protection on." : "You turned Apollo's protection off. Apollo cannot see anything while it is off.",
      why: [], what_to_do: on ? "Nothing to do." : "Turn protection back on when you want Apollo watching.",
      indicator_host: null, indicator_digest: null, verified_block: false, adapter_label: securityAdapter.label,
      occurred_at: new Date().toISOString(), resolved_at: new Date().toISOString(),
    };
    await upsertEvent(ev);
    if (on) await verifyNow();
  }, [deviceId, refresh, upsertEvent, verifyNow]);

  const requestPermission = useCallback(async (id: ProtectionPermission["id"]) => {
    const p = await securityAdapter.requestProtectionPermission(id);
    await refresh();
    return p;
  }, [refresh]);

  const checkLink = useCallback(async (input: string): Promise<CheckOutcome> => {
    const local = analyseUrlLocally(input);
    if (!local.valid || !local.normalizedUrl || !local.host) {
      const decision: Decision = { state: "growling", headline: "That doesn't look like a web link", what_happened: "Apollo could not read this as a web address.", why: ["Only http and https links can be checked."], what_to_do: "Paste the full link, including the website name.", action_required: false, trust_allowed: false, block_offered: false, confidence: "low" };
      return { local, intel: null, intelError: null, decision, event: null };
    }
    const indicator = minimalIndicator(local.normalizedUrl);
    let intel: IntelResult | null = null; let intelError: string | null = null;
    try { intel = await apiPost<IntelResult>("/intel/check", "intel_check", { indicator_type: "url", value: indicator, device_id: deviceId ?? undefined }); }
    catch (e) { intelError = e instanceof Error ? e.message : "Reputation check unavailable"; }
    const digest = intel?.indicator_digest ?? (await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, indicator));
    const trusted = trust.some((t) => t.indicator_digest === digest || t.local_indicator === indicator);
    const decision = decide(local, intel, trusted);
    const isEvent = decision.state !== "resting" || trusted;
    const ev: PatrolEvent = {
      event_id: Crypto.randomUUID(), device_id: deviceId ?? "local", category: intel?.verdict === "malicious" ? "known_threat" : "link",
      state: decision.state, status: decision.state === "resting" ? "resolved" : "active",
      headline: decision.headline, what_happened: decision.what_happened, why: decision.why, what_to_do: decision.what_to_do,
      indicator_host: local.host, indicator_digest: digest, local_indicator: indicator, verified_block: false, adapter_label: securityAdapter.label,
      occurred_at: new Date().toISOString(), resolved_at: decision.state === "resting" ? new Date().toISOString() : null, trust_allowed: decision.trust_allowed,
    };
    if (isEvent || decision.state === "resting") await upsertEvent(ev); // resting checks are still traceable in Patrol
    return { local, intel, intelError, decision, event: ev };
  }, [deviceId, trust, upsertEvent]);

  const blockEvent = useCallback(async (event: PatrolEvent) => {
    const host = event.indicator_host ?? "";
    const result = await securityAdapter.blockDestination(host);
    if (result.verified && canTransition(event, "biting", { verifiedBlock: true })) {
      await upsertEvent({ ...event, state: "biting", status: "blocked", verified_block: true, adapter_label: result.adapterLabel,
        headline: `Apollo blocked ${host}`, what_to_do: "Nothing more to do. Apollo verified this destination is blocked. Tap “Mark as contained” once you've read this.", why: [...event.why, result.detail] });
      showToast(`Apollo blocked ${host}`, "biting");
    } else {
      await upsertEvent({ ...event, state: "barking", status: "active", verified_block: false, why: [...event.why, `Block not verified: ${result.detail}`],
        what_to_do: "Apollo could not verify a block on this device. Do not open the link. Avoid this destination." });
      showToast("Block could not be verified. Apollo is still barking.", "barking");
    }
    return result;
  }, [showToast, upsertEvent]);

  const trustEvent = useCallback(async (event: PatrolEvent) => {
    if (event.state !== "growling" || !event.trust_allowed || !event.indicator_digest) { showToast("Trust is only available for uncertain (growling) items.", "growling"); return false; } // never overrides confirmed threats
    if (!deviceId) { showToast("Apollo isn't set up on this device yet.", "growling"); return false; }
    const entry: TrustEntry = { trust_id: Crypto.randomUUID(), device_id: deviceId, indicator_type: "url", indicator_digest: event.indicator_digest, indicator_host: event.indicator_host ?? "", event_id: event.event_id, created_at: new Date().toISOString(), local_indicator: event.local_indicator ?? undefined };
    await persistTrust([entry, ...trust]);
    const { local_indicator: _omit, ...syncable } = entry;
    try { await apiPost("/trust", "trust_sync", { ...syncable }); qc.invalidateQueries({ queryKey: ["trust", deviceId] }); } catch { /* offline ok */ }
    await upsertEvent({ ...event, status: "trusted", resolved_at: new Date().toISOString(), what_to_do: "You trusted this exact link. Apollo will still warn you if it is ever confirmed as a threat." });
    showToast("Trusted this exact link only", "growling");
    return true;
  }, [deviceId, persistTrust, qc, showToast, trust, upsertEvent]);

  const resolveEvent = useCallback(async (event: PatrolEvent) => {
    await upsertEvent({ ...event, status: "resolved", resolved_at: new Date().toISOString() });
    showToast("Marked as handled. Apollo will rest after a fresh check.", "neutral");
  }, [showToast, upsertEvent]);

  const revokeTrust = useCallback(async (entry: TrustEntry) => {
    await persistTrust(trust.filter((t) => t.trust_id !== entry.trust_id));
    try { await apiDelete(`/trust/${entry.trust_id}?device_id=${deviceId}`); qc.invalidateQueries({ queryKey: ["trust", deviceId] }); } catch { /* ok */ }
    showToast("Trust revoked", "neutral");
  }, [deviceId, persistTrust, qc, showToast, trust]);

  const clearPatrol = useCallback(async () => {
    await persistEvents([]);
    if (deviceId) { try { await apiDelete(`/patrol/events?device_id=${deviceId}`); qc.invalidateQueries({ queryKey: ["patrol", deviceId] }); } catch { /* ok */ } }
    showToast("Patrol history cleared", "neutral");
  }, [deviceId, persistEvents, qc, showToast]);

  const visibility = useMemo(() => visibilityFrom(capabilities, !!protection?.running), [capabilities, protection]);
  const resolution = useMemo(() => resolveApolloState({ events, visibility, lastVerifiedAt }), [events, visibility, lastVerifiedAt]);

  const value: ApolloContextValue = {
    ready, setupDone, deviceId, completeSetup, capabilities, protection, permissions, network, adapterLabel: securityAdapter.label, isMock: IS_MOCK_SECURITY,
    refreshing, refresh, verifyNow, lastVerifiedAt, toggleProtection, requestPermission, events, trust, resolution, checkLink, blockEvent, trustEvent, resolveEvent, revokeTrust, clearPatrol, toast, showToast,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApollo() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApollo must be used inside ApolloProvider");
  return v;
}
