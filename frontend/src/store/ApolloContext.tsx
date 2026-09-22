// ApolloProvider — app-wide store: device identity (server-issued, src/auth/deviceIdentity), adapter
// status/capabilities, Patrol events (local-first, minimal sync), trust list,
// verification timestamps and the resolved Apollo state.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Platform } from "react-native";

import { API_BASE, apiDelete, apiGet, apiPost, apiPut } from "@/src/api/client";
import { getBackendHealth, onBackendHealth, probeBackend } from "@/src/api/backendHealth";
import { getDeviceIdentity, getIdentityResetReason, onIdentityReset, registerDeviceIdentity } from "@/src/auth/deviceIdentity";
import { visibilityFrom } from "@/src/domain/capability";
import { assessConnection } from "@/src/domain/connection";
import { decide } from "@/src/domain/decision";
import { parseIntelResult } from "@/src/domain/intelContract";
import { minimalIndicator } from "@/src/domain/privacy";
import { FAILURE_MESSAGE } from "@/src/domain/serviceHealth";
import { markCheckDone } from "@/src/store/checkCompletion";
import { analyseEmail } from "@/src/domain/emailAnalysis";
import { evaluateLinkGuardFindings, extractAnchorsFromPlainText, type LinkAnchor } from "@/src/domain/linkGuard";
import { analyseMessage, type MessageAnalysis } from "@/src/domain/messageAnalysis";
import type { PageAnalysis } from "@/src/domain/pageAnalysis";
import { analyseCall, type CallAnalysis, type CallInput } from "@/src/domain/callAnalysis";
import { analyseUrlLocally } from "@/src/domain/risk";
import { STATE_RANK } from "@/src/domain/stateMachine";
import { findScentFor } from "@/src/domain/threatScent";
import { canTransition, resolveApolloState, type StateResolution } from "@/src/domain/stateMachine";
import type { ApolloState, Capability, Decision, DomainInfo, IntelResult, LocalAnalysis, PatrolEvent } from "@/src/domain/types";
import { IS_PREVIEW_HARNESS, securityAdapter } from "@/src/security/securityAdapter";
import { primeDeviceFacts } from "@/src/investigation/deviceBroker";
import type { BlockResult, NetworkStatus, ProtectionPermission, ProtectionStatus } from "@/src/security/SecurityPlatformAdapter";
import { isPacketEvidence as isVerifiedEnforcement, normalizeHistoricalEvent } from '@/src/domain/packetEvidence';
import { freshObservation, unavailableObservation, boundedObservation } from '@/src/domain/protectionObservation';
import { patrolPayload } from '@/src/domain/patrolPayload';
import { patrolDelivery, deliveryFailure } from './patrolDelivery';
import { toPatrolEnforcementEvidence } from "@/src/domain/enforcementEvidenceSync";
import { getPushStatus, registerForPush, type PushState, type PushStatus } from "@/src/push/notifications";
import { MessagingSdk } from "@/src/security/messagingSdk";
import { CallSdk } from "@/src/security/callSdk";
import { storage } from "@/src/utils/storage";
import { shouldBypassSetup } from "@/src/testing/setupBypass";
import { isInvestigationResult, patrolSafeSummary, type InvestigationResult } from "@/src/domain/investigation";
import { RECOVERY_STEPS, type RecoveryKind } from "@/src/domain/recovery";
import { startManagedOperation } from "@/src/investigation/transferManager";
import { rememberCaseForEvent } from "@/src/investigation/caseIndex";
import { runProtectionHealthCheck } from "@/src/protection/healthCoordinator";
import type { HealthTrigger } from "@/src/protection/healthTypes";

const deviceMeta = () => ({ platform: Platform.OS, adapter_mode: securityAdapter.kind, app_version: "1.0.0", tz_offset_minutes: -new Date().getTimezoneOffset() });

const K = { setup: "apollo.setup.done", events: "apollo.patrol.events", trust: "apollo.trust.entries", verified: "apollo.lastVerifiedAt", protection: "apollo.protection.on", wifi: "apollo.wifi.trusted", quiet: "apollo.quiet.hours", lowPower: "apollo.lowPower", seenEvidence: "apollo.evidence.seen" };

export interface TrustEntry { trust_id: string; device_id: string; indicator_type: "url" | "domain"; indicator_digest: string; indicator_host: string; event_id: string | null; created_at: string; local_indicator?: string }

export interface CheckOutcome { submissionId: string; local: LocalAnalysis; intel: IntelResult | null; intelError: string | null; decision: Decision; assessment: InvestigationResult | null; investigationError: string | null; event: PatrolEvent | null }
export interface MessageUrlResult { url: string; host: string; verdict: "clean" | "malicious" | "unknown"; threat_types: string[]; coverage: string; redirect_chain?: string[]; final_url?: string | null; domain_info?: DomainInfo | null }
export interface MessageExplanation { summary: string; why: string[]; recommendation: string }
export interface MessageOutcome { submissionId: string; analysis: MessageAnalysis; urls: MessageUrlResult[]; explanation: MessageExplanation | null; assessment: InvestigationResult | null; remoteError: string | null; event: PatrolEvent | null }
/** Call Guard add-on: mirrors backend CallRiskResponse (routers/call.py). `decision` is heuristic/
 * probabilistic (IPQualityScore) — see services/phonerisk.py's Truth-of-State comment; it alone may
 * only reach "growling"/"barking" in the app, never a verified "biting" block. */
export interface CallRiskResult {
  number: string; valid: boolean | null; active: boolean | null; fraud_score: number | null; recent_abuse: boolean | null;
  risky: boolean | null; voip: boolean | null; line_type: string | null; carrier: string | null; country: string | null;
  decision: "allow" | "review" | "avoid"; cached: boolean; checked_at: string; source: "ipqualityscore" | "not_configured";
  higgins: { headline: string; found: string; why: string; could_not_establish: string; next_action: string; exact_response: string; warning_only: boolean };
  assessment?: InvestigationResult | null;
}
export { RECOVERY_STEPS, type RecoveryKind } from "@/src/domain/recovery";

interface ApolloContextValue {
  ready: boolean;
  setupDone: boolean;
  deviceId: string | null;
  /** Set when the server rejected this device's credential. The app is in an explicit identity-reset state until the person re-registers. */
  identityReset: string | null;
  reRegisterDevice(): Promise<void>;
  completeSetup(): Promise<void>;
  capabilities: Capability[];
  protection: ProtectionStatus | null;
  permissions: ProtectionPermission[];
  network: NetworkStatus | null;
  adapterLabel: string;
  isMock: boolean;
  refreshing: boolean;
  refresh(minVisibleMs?: number): Promise<ProtectionStatus | null>;
  verifyNow(): Promise<ProtectionStatus | null>;
  lastVerifiedAt: string | null;
  toggleProtection(on: boolean): Promise<void>;
  requestPermission(id: ProtectionPermission["id"]): Promise<ProtectionPermission>;
  events: PatrolEvent[];
  trust: TrustEntry[];
  resolution: StateResolution;
  checkLink(input: string): Promise<CheckOutcome>;
  checkMessage(sender: string, text: string): Promise<MessageOutcome>;
  /** Gmail read-only connection (Gate 1 add-on): fetches recent inbox messages via the backend
   * (never stored server-side), runs each through the same on-device email engine as the paste
   * flow, files Patrol events for anything non-resting, then discards the raw content. */
  scanGmailInbox(): Promise<{ checked: number; flagged: PatrolEvent[] }>;
  recordRecovery(event: PatrolEvent, kind: RecoveryKind): Promise<void>;
  /** Gate 3 Phase B: merge a page-screenshot analysis into an existing link event, or create a new website event. */
  recordPageAnalysis(pa: PageAnalysis, existing: PatrolEvent | null): Promise<PatrolEvent | null>;
  /** Gate 4: Check This Call — user-selected context (+ optional transcript) → Call Risk Engine → Patrol event + Threat Scent. */
  checkCall(input: CallInput): Promise<{ submissionId: string; analysis: CallAnalysis; event: PatrolEvent | null }>;
  /** Call Guard add-on: on-demand caller-number risk check (backend-proxied IPQualityScore). */
  checkNumberRisk(number: string, country?: string): Promise<CallRiskResult>;
  upsertEvent(event: PatrolEvent): Promise<PatrolEvent>;
  blockEvent(event: PatrolEvent): Promise<BlockResult>;
  trustEvent(event: PatrolEvent): Promise<boolean>;
  resolveEvent(event: PatrolEvent): Promise<void>;
  revokeTrust(entry: TrustEntry): Promise<void>;
  clearPatrol(): Promise<void>;
  trustedSsids: string[];
  trustNetwork(ssid: string): Promise<void>;
  forgetNetwork(ssid: string): Promise<void>;
  toast: { message: string; tone: ApolloState | "neutral" } | null;
  showToast(message: string, tone?: ApolloState | "neutral"): void;
  pushStatus: PushStatus;
  /** Backend registration state, separate from the OS permission (spec §10A). */
  pushRegistration: PushState["registration"];
  pushDetail: string | null;
  enablePush(): Promise<PushStatus>;
  quietHours: QuietHours;
  quietNow: boolean;
  setQuietHours(next: QuietHours): Promise<void>;
  lowPower: boolean;
  setLowPower(on: boolean): Promise<void>;
}

export interface QuietHours { enabled: boolean; start_minutes: number; end_minutes: number }
const DEFAULT_QUIET: QuietHours = { enabled: false, start_minutes: 22 * 60, end_minutes: 7 * 60 };

/** Local-time check; mirrors backend `in_quiet_hours`. */
export function isQuietNow(q: QuietHours, at = new Date()): boolean {
  if (!q.enabled) return false;
  const m = at.getHours() * 60 + at.getMinutes();
  return q.start_minutes <= q.end_minutes ? m >= q.start_minutes && m < q.end_minutes : m >= q.start_minutes || m < q.end_minutes;
}

const Ctx = createContext<ApolloContextValue | null>(null);

export function ApolloProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const [ready, setReady] = useState(false);
  const [setupDone, setSetupDone] = useState(false);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [identityReset, setIdentityReset] = useState<string | null>(null);
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
  const [tick, setTick] = useState(0);
  const probeGeneration = useRef(0);

  // Quiet hours (local + synced to backend so growling pushes are held) and battery saver.
  const [quietHours, setQuietHoursState] = useState<QuietHours>(DEFAULT_QUIET);
  const [lowPower, setLowPowerState] = useState(false);
  useEffect(() => {
    void storage.getItem<string | null>(K.quiet, null).then((raw) => { if (raw) setQuietHoursState({ ...DEFAULT_QUIET, ...(JSON.parse(raw) as QuietHours) }); });
    void storage.getItem<boolean>(K.lowPower, false).then((v) => setLowPowerState(!!v));
  }, []);
  const quietNow = useMemo(() => isQuietNow(quietHours), [quietHours, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const quietRef = useRef(quietHours);
  useEffect(() => { quietRef.current = quietHours; }, [quietHours]);
  const syncQuiet = useCallback(async (q: QuietHours, id: string | null) => {
    if (!id) return;
    try { await apiPut(`/devices/${id}/settings`, "device_settings", { quiet_hours: { ...q, tz_offset_minutes: -new Date().getTimezoneOffset() } }); } catch { /* offline: local copy still silences in-app nudges */ }
  }, []);
  const setQuietHours = useCallback(async (next: QuietHours) => {
    setQuietHoursState(next); quietRef.current = next;
    await storage.setItem(K.quiet, JSON.stringify(next));
    await syncQuiet(next, deviceIdRef.current);
  }, [syncQuiet]);
  const setLowPower = useCallback(async (on: boolean) => { setLowPowerState(on); await storage.setItem(K.lowPower, on); }, []);

  const showToast = useCallback((message: string, tone: ApolloState | "neutral" = "neutral") => {
    if (tone === "growling" && isQuietNow(quietRef.current)) return; // quiet hours: hold non-urgent nudges
    setToast({ message, tone });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  // Latest events, updated synchronously so back-to-back upserts (e.g. resolving a whole incident) never
  // operate on a stale snapshot and overwrite each other.
  const eventsRef = useRef<PatrolEvent[]>([]);
  useEffect(() => { eventsRef.current = events; }, [events]);
  const persistEvents = useCallback(async (next: PatrolEvent[]) => {
    eventsRef.current = next; setEvents(next);
    if (!await storage.setItem(K.events, JSON.stringify(next))) { deliveryFailure(); throw new Error('Patrol could not save the event locally'); }
  }, []);
  const persistTrust = useCallback(async (next: TrustEntry[]) => { setTrust(next); await storage.setItem(K.trust, JSON.stringify(next)); }, []);

  const refresh = useCallback(async (minVisibleMs = 0, trigger: HealthTrigger = "periodic") => {
    const generation = ++probeGeneration.current;
    setRefreshing(true);
    const hold = new Promise((r) => setTimeout(r, minVisibleMs));
    try {
      const [health, evidence] = await boundedObservation(Promise.all([
        runProtectionHealthCheck(trigger), securityAdapter.getEnforcementEvidence().catch(() => []),
      ]));
      const { capabilities: caps, protection: status, permissions: perms, network: net } = health;
      if (!status || !net) throw new Error("Protection health is unavailable.");
      if (generation !== probeGeneration.current) return null;
      const observed = freshObservation(status) ? status : unavailableObservation(status);
      setCapabilities(caps); setProtection(observed); setPermissions(perms); setNetwork(net);
      const verified = freshObservation(status) ? status.lastVerified : null;
      setLastVerifiedAt(verified);
      await storage.setItem(K.verified, verified);
      // Connection Guard: raise one growling event per distinct unsafe network condition (trusted networks stay quiet).
      const a = assessConnection(net, trustedSsidsRef.current);
      if (a.state && status.running && lastConnectionKey.current !== a.key) {
        lastConnectionKey.current = a.key;
        const ev: PatrolEvent = {
          event_id: Crypto.randomUUID(), device_id: deviceIdRef.current ?? "local", category: "connection", state: a.state, status: "active",
          headline: a.headline, what_happened: a.what_happened, why: a.why, what_to_do: a.what_to_do, indicator_host: null, indicator_digest: null,
          verified_block: false, adapter_label: securityAdapter.label, occurred_at: new Date().toISOString(), resolved_at: null, trust_allowed: false,
        };
        setEvents((prev) => { const next = [ev, ...prev]; void storage.setItem(K.events, JSON.stringify(next)); return next; });
        void syncEventRef.current?.(ev);
      } else if (!a.state) lastConnectionKey.current = a.key;
      await syncEnforcementEvidence(evidence).catch(deliveryFailure);
      return observed;
    } catch {
      if (generation === probeGeneration.current) { setProtection(p => unavailableObservation(p)); setLastVerifiedAt(null); setCapabilities([]); }
      return null;
    } finally { await hold; setRefreshing(false); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Cross-Platform Architecture Directive: passively surface REAL, native-observed blocks (a real
  // app's traffic actually hit an already-blocked domain and got dropped) as their own verified
  // "biting" events — distinct from the immediate tap-to-block flow in blockEvent() below, which
  // must NEVER reach "biting" on its own (a manual tap is a request, not a verified block). Every
  // entry here already passed isVerifiedEnforcement(); the backend independently re-validates the
  // attached evidence again before it ever sets verified_block itself (see routers/patrol.py).
  const seenEvidenceRef = useRef<Set<string> | null>(null);
  const syncEnforcementEvidence = useCallback(async (evidence: Awaited<ReturnType<typeof securityAdapter.getEnforcementEvidence>>) => {
    if (!evidence.length) return;
    if (!seenEvidenceRef.current) {
      const raw = await storage.getItem<string | null>(K.seenEvidence, null);
      seenEvidenceRef.current = new Set(raw ? (JSON.parse(raw) as string[]) : []);
    }
    const seen = seenEvidenceRef.current;
    // isVerifiedEnforcement() + the evidenceId dedupe below together guarantee repeated evidence for
    // the same real block can never create duplicate "biting" events.
    const fresh = evidence.filter((e) => isVerifiedEnforcement(e) && !seen.has(e.evidenceId));
    for (const e of fresh) {
      const isCall = false; // Call screening is processed separately; never packet-backed Biting.
      const domain = e.destination.domain ?? e.destination.ip ?? (isCall ? "an unknown caller" : "a threat");
      // Upgrade an existing card for this exact host/number (e.g. it was flagged/barking earlier) in
      // place, rather than spawning a duplicate — one destination should read as one continuous story.
      // Calls use `local_indicator` (never synced — see syncEvent) instead of `indicator_host`,
      // matching the same privacy choice Check This Call already makes for phone numbers.
      const existing = eventsRef.current.find(x => x.event_id === (e.eventId ?? e.evidenceId));
      if (existing) { await syncEventRef.current?.(existing); seen.add(e.evidenceId); continue; }
      const base: PatrolEvent = existing ?? {
        event_id: e.eventId ?? e.evidenceId, device_id: deviceIdRef.current ?? "local", category: "connection", state: "barking", status: "active",
        headline: "", what_happened: "", why: [], what_to_do: "", indicator_host: isCall ? null : domain, local_indicator: isCall ? domain : undefined, indicator_digest: null,
        verified_block: false, adapter_label: securityAdapter.label, occurred_at: e.observedAt, resolved_at: null, trust_allowed: false,
      };
      if (!canTransition(base, "biting", { verifiedBlock: true })) continue; // defensive: same single gate everywhere
      const headline = isCall ? `Apollo blocked a call from ${domain}` : `Apollo blocked ${domain}`;
      const whatHappened = isCall
        ? `Apollo's Call Gate rejected an incoming call from ${domain} on this device before it rang — it matched a number Apollo already knew was high-risk.`
        : `Apollo's Site Gate observed a real connection attempt to ${domain} and blocked it on this device.`;
      const whyLine = isCall
        ? "The call was rejected before it rang — confirmed by the operating system, not assumed."
        : "Apollo's on-device filter matched this domain against a threat it already knew about and blocked the exact connection — confirmed by the operating system, not assumed.";
      const ev: PatrolEvent = {
        ...base, state: "biting", status: "blocked", headline,
        what_happened: whatHappened,
        why: [...base.why, whyLine],
        what_to_do: "This connection was blocked. If you already shared details or money, review the recovery steps.",
        indicator_host: isCall ? null : domain, local_indicator: isCall ? domain : base.local_indicator,
        verified_block: true, adapter_label: securityAdapter.label, occurred_at: e.observedAt, resolved_at: null,
        background: true, enforcement_evidence: toPatrolEnforcementEvidence(e),
      };
      await persistEvents([ev, ...eventsRef.current.filter(x => x.event_id !== ev.event_id)]);
      await syncEventRef.current?.(ev);
      seen.add(e.evidenceId); // local dedupe ONLY; delivery receipts live in the durable outbox.
      showToast(isCall ? `Apollo blocked a call from ${domain}.` : `Apollo blocked ${domain}.`, "biting");
    }
    for (const e of evidence.filter(x => x.mechanism === 'call_screening' && x.requestedAction === 'block' && !seen.has(x.evidenceId))) {
      const ev: PatrolEvent = {
        event_id: e.eventId ?? e.evidenceId, device_id: deviceIdRef.current ?? 'local', category: 'call', state: 'barking', status: 'active',
        headline: 'Call rejection requested', what_happened: 'Call Gate submitted a rejection request to Android. No separate completion receipt is available.',
        why: ['This is a call-screening action, not an observed packet drop.'], what_to_do: 'If the call still reaches you, do not share private information. Review Call Gate.',
        indicator_host: null, indicator_digest: null, local_indicator: e.destination.domain, verified_block: false,
        adapter_label: securityAdapter.label, occurred_at: e.observedAt, resolved_at: null, trust_allowed: false, background: true,
      };
      await persistEvents([ev, ...eventsRef.current.filter(x => x.event_id !== ev.event_id)]);
      await syncEventRef.current?.(ev); seen.add(e.evidenceId);
    }
    const retainedSeen = [...seen].slice(-2048);
    await storage.setItem(K.seenEvidence, JSON.stringify(retainedSeen));
    await securityAdapter.acknowledgeEnforcementEvidence?.(retainedSeen);
  }, [showToast, persistEvents]);
  const lastConnectionKey = useRef<string | null>(null);
  const deviceIdRef = useRef<string | null>(null);
  useEffect(() => { deviceIdRef.current = deviceId; }, [deviceId]);
  const syncEventRef = useRef<((e: PatrolEvent) => Promise<void>) | null>(null);
  // Wi‑Fi Memory: networks the user marked as home/work. Local only.
  const [trustedSsids, setTrustedSsids] = useState<string[]>([]);
  const trustedSsidsRef = useRef<string[]>([]);
  useEffect(() => { trustedSsidsRef.current = trustedSsids; }, [trustedSsids]);
  useEffect(() => { storage.getItem<string | null>(K.wifi, null).then((raw) => { if (raw) { const v = JSON.parse(raw) as string[]; setTrustedSsids(v); trustedSsidsRef.current = v; } }); }, []);
  const trustNetwork = useCallback(async (ssid: string) => {
    const next = Array.from(new Set([...trustedSsidsRef.current, ssid])); setTrustedSsids(next); trustedSsidsRef.current = next; await storage.setItem(K.wifi, JSON.stringify(next));
    // Resolve any active connection event for this condition and re-assess.
    setEvents((prev) => { const n = prev.map((e) => e.category === "connection" && e.status === "active" ? { ...e, status: "resolved" as const, resolved_at: new Date().toISOString(), what_to_do: `You marked “${ssid}” as a trusted network.` } : e); void storage.setItem(K.events, JSON.stringify(n)); return n; });
    lastConnectionKey.current = null;
    showToast(`Trusted “${ssid}”. Apollo stays quiet on this network.`, "resting");
  }, [showToast]);
  const forgetNetwork = useCallback(async (ssid: string) => {
    const next = trustedSsidsRef.current.filter((x) => x !== ssid); setTrustedSsids(next); trustedSsidsRef.current = next; await storage.setItem(K.wifi, JSON.stringify(next)); lastConnectionKey.current = null;
  }, []);

  const verifyNow = useCallback(async () => {
    // Keep the Sniffing state visible for at least a beat so the user sees Apollo actually checking.
    return refresh(900);
  }, [refresh]);

  // Boot
  useEffect(() => {
    (async () => {
      try {
        await primeDeviceFacts();
        const [storedDone, ev, tr, protOn] = await Promise.all([
          storage.getItem<boolean>(K.setup, false), storage.getItem<string | null>(K.events, null), storage.getItem<string | null>(K.trust, null),
          storage.getItem<boolean>(K.protection, false),
        ]);
        const href = typeof globalThis.location?.href === "string" ? globalThis.location.href : "";
        const done = storedDone || shouldBypassSetup(Platform.OS, __DEV__, href);
        setSetupDone(!!done);
        if (ev) { const restored = (JSON.parse(ev) as PatrolEvent[]).map(normalizeHistoricalEvent); eventsRef.current = restored; setEvents(restored); }
        if (tr) setTrust(JSON.parse(tr)); setLastVerifiedAt(null); // persisted observations are never live boot health
        if (done) {
          // Server-issued identity. Legacy (pre-token) installs have none and get a fresh identity — never a claimed one.
          let identity = await getDeviceIdentity();
          const resetWhy = identity ? null : await getIdentityResetReason();
          if (resetWhy) setIdentityReset(resetWhy); // explicit reset state survives reloads — never re-register silently
          else if (!identity) { try { identity = await registerDeviceIdentity(API_BASE, deviceMeta()); } catch { identity = null; } }
          if (identity) {
            setDeviceId(identity.deviceId);
            void apiPost("/devices/heartbeat", "device_register", deviceMeta()).catch(() => undefined); // never blocks boot; offline is fine
          }
          if (protOn) await storage.setItem(K.protection, true);
        }
        await refresh(0, "boot");
      } finally { setReady(true); }
    })();
  }, [refresh]);

  // A 401 means the credential is dead (revoked/expired/rotated elsewhere). Fail closed and enter an EXPLICIT
  // identity-reset state: nothing is re-registered silently, because a new identity detaches this install from its
  // Family links, shared incidents and push registration on the server. The person chooses to re-register.
  useEffect(() => onIdentityReset((why) => { setDeviceId(null); setIdentityReset(why); }), []);
  const identityResetRef = useRef<string | null>(null);
  useEffect(() => { identityResetRef.current = identityReset; }, [identityReset]);
  const setupDoneRef = useRef(false);
  useEffect(() => { setupDoneRef.current = setupDone; }, [setupDone]);
  const reRegisterDevice = useCallback(async () => {
    const id = await registerDeviceIdentity(API_BASE, deviceMeta());
    setDeviceId(id.deviceId); setIdentityReset(null);
    showToast("Registered as a new device. Re-pair with family members to share alerts again.", "neutral");
  }, [showToast]);

  // Failure contract: while the security service is unreachable, re-probe /health periodically and whenever the
  // app returns to the foreground. Degraded state clears ONLY on a fresh successful observation (inside probe/client),
  // after which cached server data is refetched and a setup-complete install that could not register at boot
  // (service down at the time) registers now — unless it is in the explicit identity-reset state.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const schedule = (down: boolean) => {
      if (timer) { clearInterval(timer); timer = null; }
      if (down) timer = setInterval(() => void probeBackend(), lowPower ? 120000 : 30000);
    };
    let wasReachable = getBackendHealth().reachable;
    schedule(wasReachable === false);
    const off = onBackendHealth((h) => {
      schedule(h.reachable === false);
      if (h.reachable === true && wasReachable === false) {
        void qc.invalidateQueries();
        if (setupDoneRef.current && !deviceIdRef.current && !identityResetRef.current) {
          void registerDeviceIdentity(API_BASE, deviceMeta()).then((id) => setDeviceId(id.deviceId)).catch(() => undefined);
        }
      }
      wasReachable = h.reachable;
    });
    const sub = AppState.addEventListener("change", (st) => {
      if (st === 'active') { setProtection(p => unavailableObservation(p)); setLastVerifiedAt(null); void refresh(0, "foreground"); }
      else { ++probeGeneration.current; setProtection(p => unavailableObservation(p)); setLastVerifiedAt(null); }
      if (st === "active" && getBackendHealth().reachable === false) void probeBackend();
    });
    return () => { off(); sub.remove(); if (timer) clearInterval(timer); };
  }, [lowPower, qc, refresh]);

  // Re-resolve state over time so cooldown/freshness windows expire visibly (slower in battery saver).
  useEffect(() => { const t = setInterval(() => {
    setTick(n => n + 1);
    setProtection(p => freshObservation(p) ? p : unavailableObservation(p));
  }, 1000); return () => clearInterval(t); }, []);
  useEffect(() => { const t = setInterval(() => { if (AppState.currentState !== 'background') void refresh(0, "periodic"); }, lowPower ? 60000 : 30000); return () => clearInterval(t); }, [lowPower, refresh]);

  // Alert notifications: re-register on every launch once the device identity exists (tokens rotate).
  // Only ask for permission once setup completes (completeSetup → enablePush); silent re-register otherwise.
  const [pushState, setPushState] = useState<PushState>({ permission: Platform.OS === "web" ? "unsupported" : "undetermined", registration: "not_applicable", registrationId: null, detail: null });
  const pushStatus = pushState.permission;
  useEffect(() => {
    if (!deviceId) return;
    void registerForPush(deviceId, { ask: false }).then(setPushState).catch(() => getPushStatus().then((permission) => setPushState((prev) => ({ ...prev, permission }))));
    if (quietRef.current.enabled) void syncQuiet(quietRef.current, deviceId);
  }, [deviceId, syncQuiet]);
  const enablePush = useCallback(async () => {
    const id = deviceIdRef.current;
    const st = id ? await registerForPush(id, { ask: true }) : { ...pushState, permission: await getPushStatus() };
    setPushState(st);
    return st.permission;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const completeSetup = useCallback(async () => {
    let identity = await getDeviceIdentity();
    if (!identity) { try { identity = await registerDeviceIdentity(API_BASE, deviceMeta()); } catch { identity = null; /* offline: retried on next launch */ } }
    if (identity) setDeviceId(identity.deviceId);
    await securityAdapter.startProtection();
    await storage.setItem(K.protection, true);
    await storage.setItem(K.setup, true);
    setSetupDone(true);
    await verifyNow();
    // Contextual ask: the user just turned protection on, so "tell me when Apollo barks" is expected here.
    if (identity) { try { setPushState(await registerForPush(identity.deviceId, { ask: true })); } catch { /* never block setup */ } }
  }, [verifyNow]);

  // Remote Patrol + trust merge (device may have reinstalled). Local wins.
  const remoteEvents = useQuery({ queryKey: ["patrol", deviceId], enabled: !!deviceId, queryFn: () => apiGet<PatrolEvent[]>(`/patrol/events?device_id=${deviceId}`) });
  const remoteTrust = useQuery({ queryKey: ["trust", deviceId], enabled: !!deviceId, queryFn: () => apiGet<TrustEntry[]>(`/trust?device_id=${deviceId}`) });
  useEffect(() => {
    if (!remoteEvents.data) return;
    const known = new Set(events.map((e) => e.event_id));
    const missing = remoteEvents.data.filter((e) => !known.has(e.event_id)).map(normalizeHistoricalEvent);
    if (missing.length) void persistEvents([...events, ...missing].sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at)));
  }, [remoteEvents.data]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!remoteTrust.data) return;
    const known = new Set(trust.map((t) => t.trust_id));
    const missing = remoteTrust.data.filter((t) => !known.has(t.trust_id));
    if (missing.length) void persistTrust([...trust, ...missing]);
  }, [remoteTrust.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const syncEvent = useCallback(async (e: PatrolEvent) => {
    if (!deviceId || (e.device_id !== 'local' && e.device_id !== deviceId)) return;
    try { await patrolDelivery.enqueue(patrolPayload(e, deviceId)); void patrolDelivery.flush(deviceId).catch(deliveryFailure); }
    catch { deliveryFailure(); }
  }, [deviceId]);
  useEffect(() => { syncEventRef.current = syncEvent; }, [syncEvent]);
  useEffect(() => {
    if (!deviceId || !ready) return;
    const retry = async () => {
      try {
        for (const e of eventsRef.current) if (e.device_id === deviceId || e.device_id === 'local') await patrolDelivery.enqueue(patrolPayload(e, deviceId));
        await patrolDelivery.flush(deviceId);
      } catch { deliveryFailure(); }
    };
    void retry(); const timer = setInterval(() => void retry(), 15000);
    const sub = AppState.addEventListener('change', s => { if (s === 'active') void retry(); });
    return () => { clearInterval(timer); sub.remove(); };
  }, [deviceId, ready]);

  const upsertEvent = useCallback(async (input: PatrolEvent) => {
    // Threat Scent: link this event to related recent events (same brand/host within 30 min).
    // When two different gates are involved (e.g. message → link), the sequence escalates to barking.
    let e = normalizeHistoricalEvent(input);
    const events = eventsRef.current;
    if (e.state !== "resting" && !events.some((x) => x.event_id === e.event_id)) {
      const scent = findScentFor(e, events) ?? e.event_id;
      e = { ...e, scent_id: e.scent_id ?? scent };
      const linked = events.filter((x) => x.scent_id === scent && x.category !== e.category && x.state !== "resting");
      if (linked.length && STATE_RANK[e.state] < STATE_RANK.barking) {
        e = { ...e, state: "barking", why: [...e.why, "Connected to an earlier event about the same organisation or website."], what_to_do: `${e.what_to_do} Don't provide passwords, verification codes or transfer money.` };
      }
    }
    const next = [e, ...events.filter((x) => x.event_id !== e.event_id)];
    await persistEvents(next);
    void syncEvent(e);
    return e;
  }, [persistEvents, syncEvent]);

  const checkMessage = useCallback(async (sender: string, text: string): Promise<MessageOutcome> => {
    const analysis = analyseMessage(sender, text);
    let urls: MessageUrlResult[] = []; let explanation: MessageExplanation | null = null; let assessment: InvestigationResult | null = null; let remoteError: string | null = null;
    try {
      const r = await apiPost<{ urls?: unknown; explanation?: unknown; assessment?: unknown }>("/message/analyse", "message_check", {
        device_id: deviceId ?? undefined, sender, text, urls: analysis.signals.urls,
        local_state: analysis.state, scenario: analysis.scenario, signals: analysis.signalLabels, claimed_brand: analysis.signals.claimedBrand, second_opinion: false,
      });
      // Contract guard: only well-formed url verdicts count; anything else is dropped (unknown), never treated as clean.
      urls = Array.isArray(r.urls) ? (r.urls as MessageUrlResult[]).filter((u) => u && typeof u.url === "string" && typeof u.host === "string" && ["clean", "malicious", "unknown"].includes(u.verdict) && Array.isArray(u.threat_types)) : [];
      const ex = r.explanation as MessageExplanation | null | undefined;
      explanation = ex && typeof ex.summary === "string" && typeof ex.recommendation === "string" && Array.isArray(ex.why) ? ex : null;
      assessment = isInvestigationResult(r.assessment) ? r.assessment : null;
    } catch (e) { remoteError = e instanceof Error ? e.message : "Apollo's second opinion is unavailable right now."; }
    let state = analysis.state; const why = [...analysis.why];
    // Email Guard / Text Guard: automatic pre-click assessment over every checked link (redirect
    // chain + RDAP domain-info already included in `urls` from the enriched /message/analyse) plus
    // any display-text-vs-real-destination mismatch recoverable from the plain pasted text. This can
    // only ever raise state to growling/barking — never biting (see src/domain/linkGuard.ts).
    const guard = evaluateLinkGuardFindings(urls, extractAnchorsFromPlainText(text));
    // One current answer (never two competing verdicts): once Higgins completes a genuine assessment over the
    // supplied evidence — never a partial, failed or unavailable pass — its risk verdict is reconciled into the
    // state shown, so the pill/label the person sees can't contradict Higgins' own conclusion (MessageAssessmentResult
    // renders both from this same `state`). A "clear" verdict clears an Apollo-only heuristic flag rather than leaving
    // it displayed alongside a "no strong scam signs" explanation; a "warning" verdict still only raises, never lowers,
    // whatever Apollo already found. A verified malicious-URL match (hard evidence, applied below via `guard`) is
    // never hidden either way — Higgins or not.
    const higginsCurrent = assessment?.processing.higgins_source === "gemini" && assessment.processing.completion === "complete_within_supplied_evidence";
    if (higginsCurrent) {
      if (assessment!.risk === "warning" && STATE_RANK.growling > STATE_RANK[state]) state = "growling";
      else if (assessment!.risk === "clear") state = "resting";
    }
    if (STATE_RANK[guard.state] > STATE_RANK[state]) state = guard.state;
    why.push(...guard.why);
    const firstHost = urls[0]?.host ?? (analysis.signals.urls[0] ? analysis.signals.urls[0].replace(/^https?:\/\//i, "").split("/")[0].toLowerCase() : null);
    let event: PatrolEvent | null = null;
    if (state !== "resting") {
      event = await upsertEvent({
        event_id: Crypto.randomUUID(), device_id: deviceId ?? "local", category: "message", state, status: "active",
        headline: assessment?.higgins.headline ?? `${analysis.scenarioTitle}${analysis.signals.claimedBrand ? ` — claims to be ${analysis.signals.claimedBrand}` : ""}`,
        what_happened: patrolSafeSummary(assessment?.higgins.what_was_found[0] ?? analysis.verdict),
        why: assessment?.findings.map((finding) => finding.title).slice(0, 6) ?? why,
        what_to_do: assessment?.higgins.next_action ?? analysis.recommendation,
        indicator_host: firstHost, indicator_digest: null, local_indicator: firstHost ? `https://${firstHost}/` : null, verified_block: false, adapter_label: securityAdapter.label,
        occurred_at: new Date().toISOString(), resolved_at: null, trust_allowed: false, claimed_brand: analysis.signals.claimedBrand, scenario: analysis.scenario,
        supporting_references: assessment?.sources.filter((source) => source.url).map((source) => ({ label: source.label, url: source.url! })).slice(0, 6),
      });
      if (event.state !== state) { state = event.state; }
    }
    void markCheckDone("message");
    return { submissionId: event?.event_id ?? Crypto.randomUUID(), analysis: { ...analysis, state, why }, urls, explanation, assessment, remoteError, event };
  }, [deviceId, upsertEvent]);

  // Text Guard (Android only): drains notifications ApolloSmsListenerService captured from the
  // default messaging app (opt-in, Settings > Notification access — never READ_SMS) and runs each
  // through the EXACT same on-device engine + Email/Text Guard link assessment as a pasted message.
  // A capability check keeps this a no-op everywhere else (Expo Go, web, iOS, or listener not yet
  // granted) — getRecentMessageSecurityEvents() also always returns [] in those cases regardless.
  useEffect(() => {
    if (Platform.OS !== "android") return;
    let cancelled = false;
    const poll = async () => {
      try {
        const caps = await MessagingSdk.getMessagingCapabilities();
        if (caps.smsFiltering !== "supported") return;
        const items = await MessagingSdk.getRecentMessageSecurityEvents();
        for (const raw of items) {
          if (cancelled) return;
          const item = raw as { id?: unknown; status?: unknown; droppedCount?: unknown; sender?: unknown; text?: unknown };
          const id = typeof item?.id === "string" ? item.id : "";
          if (item.status === "overflow") {
            const dropped = typeof item.droppedCount === "number" ? item.droppedCount : 0;
            showToast(`${dropped} older message notification${dropped === 1 ? " was" : "s were"} not assessed because the protected queue was full.`, "growling");
            if (id) await MessagingSdk.acknowledgeMessageSecurityEvents([id]);
            continue;
          }
          const text = typeof item?.text === "string" ? item.text : "";
          if (!id || !text.trim()) continue;
          const sender = typeof item?.sender === "string" ? item.sender : "";
          // The native encrypted inbox is acknowledged only after this exact operation has a durable backend case.
          const outcome = await checkMessage(sender, text);
          const operation = await startManagedOperation(`sms-notification-${id}`, {
            gate: "text", question: "Investigate this new text-message notification, verify its claims and links, and tell me the safest next action.",
            submissions: [{ clientItemId: `sms-${id}`, kind: "text", value: `From: ${sender}\n${text}`, label: "opt-in text notification" }],
            initialFindingRefs: [], initialFindings: outcome.analysis.signalLabels,
          });
          if (!operation.caseData || !["submitted", "settled"].includes(operation.phase)) continue;
          if (outcome.event) await rememberCaseForEvent(outcome.event.event_id, operation.caseData.id);
          await MessagingSdk.acknowledgeMessageSecurityEvents([id]);
          if (outcome.event) showToast(`Apollo assessed a text message: ${outcome.event.headline}`, outcome.event.state);
        }
      } catch { /* native module unavailable or listener not granted — nothing to drain */ }
    };
    void poll();
    const timer = setInterval(() => void poll(), lowPower ? 120000 : 45000);
    const sub = AppState.addEventListener("change", (st) => { if (st === "active") void poll(); });
    return () => { cancelled = true; clearInterval(timer); sub.remove(); };
  }, [checkMessage, showToast, lowPower]);

  // Runs each OAuth-fetched Gmail message through the on-device email
  // engine + Email Gate's automatic pre-click link assessment, filing a Patrol event for anything
  // non-resting. `messages` is only ever a local, request-scoped array — nothing here is persisted
  // beyond the Patrol event summary (matches the "checked and discarded" backend contract).
  const _scanInboxMessages = useCallback(async (messages: { id: string; from: string; subject: string; date: string; body: string; links: LinkAnchor[] }[], sourceLabel: string): Promise<{ checked: number; flagged: PatrolEvent[] }> => {
    if (!deviceId) return { checked: 0, flagged: [] };
    const flagged: PatrolEvent[] = [];
    for (const m of messages) {
      let a = analyseEmail(m.body, { from: m.from, subject: m.subject });
      let urls: MessageUrlResult[] = [];
      let assessment: InvestigationResult | null = null;
      try {
        const r = await apiPost<{ urls?: unknown; assessment?: unknown }>("/message/analyse", "message_check", {
          device_id: deviceId, sender: m.from || "", text: `${m.subject}\n${m.body}`, urls: a.urls,
          local_state: a.state, scenario: a.scenario, signals: a.signalLabels.slice(0, 20), claimed_brand: a.claimedBrand, second_opinion: false,
        });
        urls = Array.isArray(r.urls) ? (r.urls as MessageUrlResult[]) : [];
        assessment = isInvestigationResult(r.assessment) ? r.assessment : null;
      } catch { /* on-device findings remain available if the purpose-limited service is offline */ }
      // Email Gate: automatic pre-click assessment — redirect chain + RDAP domain-info (already
      // inside `urls`) plus real HTML anchor mismatch detection from the Gmail API
      // actual <a> pairs, unlike pasted plain text). Can only raise state to growling/barking, never biting.
      const guard = evaluateLinkGuardFindings(urls, m.links ?? []);
      if (STATE_RANK[guard.state] > STATE_RANK[a.state]) a = { ...a, state: guard.state };
      if (guard.why.length) a = { ...a, why: [...a.why, ...guard.why] };
      if (a.state === "resting") continue;
      const event = await upsertEvent({
        event_id: Crypto.randomUUID(), device_id: deviceId, category: "email", state: a.state, status: "active",
        headline: `${sourceLabel}: ${assessment?.higgins.headline ?? a.title}`,
        what_happened: patrolSafeSummary(assessment?.higgins.what_was_found[0] ?? a.verdict),
        why: assessment?.findings.map((finding) => finding.title).slice(0, 6) ?? a.why,
        what_to_do: assessment?.higgins.next_action ?? a.recommendation,
        indicator_host: a.lookalikeUrls[0] ? a.lookalikeUrls[0].replace(/^https?:\/\//i, "").split("/")[0] : a.senderDomain,
        indicator_digest: null, local_indicator: a.parsed.subject, verified_block: false, adapter_label: securityAdapter.label,
        occurred_at: new Date().toISOString(), resolved_at: null, trust_allowed: false, claimed_brand: a.claimedBrand, scenario: a.scenario,
        supporting_references: assessment?.sources.filter((source) => source.url).map((source) => ({ label: source.label, url: source.url! })).slice(0, 6),
      });
      flagged.push(event);
    }
    return { checked: messages.length, flagged };
  }, [deviceId, upsertEvent]);

  const scanGmailInbox = useCallback(async (): Promise<{ checked: number; flagged: PatrolEvent[] }> => {
    if (!deviceId) return { checked: 0, flagged: [] };
    const messages = await apiPost<{ id: string; from: string; subject: string; date: string; body: string; links: LinkAnchor[] }[]>("/gmail/scan", "gmail_scan", { device_id: deviceId });
    return _scanInboxMessages(messages, "Gmail");
  }, [deviceId, _scanInboxMessages]);

  const recordPageAnalysis = useCallback(async (pa: PageAnalysis, existing: PatrolEvent | null): Promise<PatrolEvent | null> => {
    if (existing) {
      const escalate = STATE_RANK[pa.state] > STATE_RANK[existing.state] && existing.state !== "biting";
      return upsertEvent({ ...existing, state: escalate ? pa.state : existing.state, status: escalate && existing.status === "resolved" ? "active" : existing.status, resolved_at: escalate ? null : existing.resolved_at,
        headline: escalate ? pa.title : existing.headline, what_happened: escalate ? `${existing.what_happened} A screenshot of the page: ${pa.verdict}` : existing.what_happened,
        why: [...existing.why, ...pa.why.map((w) => `Page: ${w}`)], what_to_do: escalate ? pa.recommendation : existing.what_to_do, claimed_brand: existing.claimed_brand ?? pa.claimedBrand, scenario: pa.scenario });
    }
    if (pa.state === "resting") return null;
    return upsertEvent({
      event_id: Crypto.randomUUID(), device_id: deviceId ?? "local", category: "website", state: pa.state, status: "active", headline: pa.title, what_happened: pa.verdict, why: pa.why, what_to_do: pa.recommendation,
      indicator_host: pa.host, indicator_digest: null, local_indicator: pa.host, verified_block: false, adapter_label: securityAdapter.label, occurred_at: new Date().toISOString(), resolved_at: null,
      trust_allowed: false, claimed_brand: pa.claimedBrand, scenario: pa.scenario,
    });
  }, [deviceId, upsertEvent]);

  const checkCall = useCallback(async (input: CallInput) => {
    const analysis = analyseCall(input);
    let event: PatrolEvent | null = null;
    if (analysis.state !== "resting") {
      event = await upsertEvent({
        event_id: Crypto.randomUUID(), device_id: deviceId ?? "local", category: "call", state: analysis.state, status: "active",
        headline: `${analysis.title}${analysis.claimedBrand ? ` — caller claimed ${analysis.claimedBrand}` : ""}`, what_happened: analysis.verdict, why: analysis.why, what_to_do: analysis.recommendation,
        indicator_host: null, indicator_digest: null, local_indicator: input.number?.trim() || null, verified_block: false, adapter_label: securityAdapter.label,
        occurred_at: new Date().toISOString(), resolved_at: null, trust_allowed: false, claimed_brand: analysis.claimedBrand, scenario: analysis.scenario,
      });
      if (event.state !== analysis.state) return { submissionId: event.event_id, analysis: { ...analysis, state: event.state, why: event.why, verdict: "This call may be connected to the suspicious activity detected earlier." }, event };
    }
    return { submissionId: event?.event_id ?? Crypto.randomUUID(), analysis, event };
  }, [deviceId, upsertEvent]);

  // Call Guard add-on: on-demand caller-number risk check (backend-proxied IPQualityScore — see
  // services/phonerisk.py). Used by the "Check this number" quick action AND the pending-lookup poll
  // below. A non-"allow" decision is remembered on-device (CallSdk.markNumberRisky) so Call Guard's
  // native mechanism can act on it next time, and files a growling/barking (never biting) Patrol
  // event — matching Check This Call's existing choice to keep the number itself local-only
  // (`local_indicator`, never synced — see syncEvent's strip above).
  const checkNumberRisk = useCallback(async (number: string, country?: string): Promise<CallRiskResult> => {
    const body: Record<string, unknown> = { device_id: deviceId ?? "local", number };
    if (country) body.country = country;
    const result = await apiPost<CallRiskResult>("/call/risk-check", "call_risk_check", body);
    if (result.decision !== "allow") {
      try { await CallSdk.markNumberRisky(result.number); } catch { /* informational only if native module unavailable */ }
      const isAvoid = result.decision === "avoid";
      const existing = eventsRef.current.find((x) => x.local_indicator === result.number && x.state !== "biting");
      const why = [result.recent_abuse ? "Reported for recent abuse." : "Elevated fraud-risk score.", result.voip ? "This is a VOIP number, commonly used to spoof caller ID." : null].filter((w): w is string => !!w);
      const ev: PatrolEvent = {
        ...(existing ?? {
          event_id: Crypto.randomUUID(), device_id: deviceId ?? "local", category: "call" as const, status: "active" as const,
          indicator_host: null, indicator_digest: null, local_indicator: result.number, verified_block: false,
          adapter_label: securityAdapter.label, occurred_at: new Date().toISOString(), resolved_at: null, trust_allowed: false, why: [],
        }),
        state: isAvoid ? "barking" : "growling", status: "active",
        headline: isAvoid ? `High-risk caller: ${result.number}` : `Caller worth a second look: ${result.number}`,
        what_happened: isAvoid
          ? `Apollo checked ${result.number} and found strong signs of fraud/spam abuse (fraud score ${result.fraud_score ?? "unknown"}/100).`
          : `Apollo checked ${result.number} and found some risk signals (fraud score ${result.fraud_score ?? "unknown"}/100) — not enough to be certain.`,
        why, what_to_do: isAvoid ? "Apollo will reject future calls from this number automatically. You can also add it to your block list." : "Answer with caution, or add it to your block list if it turns out to be unwanted.",
      };
      setEvents((prev) => { const next = [ev, ...prev.filter((x) => x.event_id !== ev.event_id)]; void storage.setItem(K.events, JSON.stringify(next)); return next; });
      void syncEventRef.current?.(ev);
      showToast(isAvoid ? `Apollo flagged a high-risk caller: ${result.number}` : `Apollo flagged a caller worth checking: ${result.number}`, isAvoid ? "barking" : "growling");
    }
    return result;
  }, [deviceId, showToast]);

  // Call Guard add-on: drains numbers ApolloCallScreeningService saw ringing with no local block/
  // allow/risk signal (mailbox semantics, Android only — CallSdk.getPendingCallLookups() always
  // returns [] elsewhere) and runs the SAME risk check as the manual quick action for each.
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const items = await CallSdk.getPendingCallLookups();
        for (const item of items) {
          if (cancelled) return;
          if (!item?.number) continue;
          // Do not upload incoming caller numbers automatically. Local lists still screen calls.
        }
      } catch { /* native module unavailable — nothing to drain */ }
    };
    void poll();
    const timer = setInterval(() => void poll(), lowPower ? 120000 : 45000);
    const sub = AppState.addEventListener("change", (st) => { if (st === "active") void poll(); });
    return () => { cancelled = true; clearInterval(timer); sub.remove(); };
  }, [checkNumberRisk, lowPower]);

  const recordRecovery = useCallback(async (event: PatrolEvent, kind: RecoveryKind) => {
    const label: Record<RecoveryKind, string> = { clicked: "Opened the link", password: "Entered a password", code: "Shared a verification code", money: "Sent money", info: "Shared personal information", app: "Installed an app", card: "Entered card or bank details", download: "Downloaded a file", called: "Called the number shown", remote: "Gave someone remote access", accessibility: "Granted accessibility access", profile: "Installed a profile or certificate", banking_during_access: "Used banking while they had access", mfa_approved: "Approved a login prompt", locked_out: "Lost access to the account" };
    const escalate = kind !== "clicked";
    await upsertEvent({ ...event, state: escalate ? "barking" : event.state, status: "active", why: [...event.why, `You reported: ${label[kind].toLowerCase()}.`], recovery_kinds: Array.from(new Set([...(event.recovery_kinds ?? []), kind])), what_to_do: RECOVERY_STEPS[kind][0] });
  }, [upsertEvent]);

  const toggleProtection = useCallback(async (on: boolean) => {
    ++probeGeneration.current; setProtection(p => unavailableObservation(p)); setLastVerifiedAt(null);
    try { await boundedObservation(on ? securityAdapter.startProtection() : securityAdapter.stopProtection()); }
    catch { showToast('Protection request was not confirmed. Checking current status.', 'growling'); }
    await storage.setItem(K.protection, on);
    await refresh();
    const ev: PatrolEvent = {
      event_id: Crypto.randomUUID(), device_id: deviceId ?? "local", category: "protection", state: "resting", status: "resolved",
      headline: on ? 'Enable protection requested' : 'Disable protection requested',
      what_happened: 'This records your request, not proof of current protection. Gates shows the latest observed status.',
      why: [], what_to_do: 'Check Gates for the current observation and any required permissions.',
      indicator_host: null, indicator_digest: null, verified_block: false, adapter_label: securityAdapter.label,
      occurred_at: new Date().toISOString(), resolved_at: new Date().toISOString(),
    };
    await upsertEvent(ev);
    if (on) await verifyNow();
  }, [deviceId, refresh, upsertEvent, verifyNow, showToast]);

  const requestPermission = useCallback(async (id: ProtectionPermission["id"]) => {
    const p = await securityAdapter.requestProtectionPermission(id);
    await refresh();
    return p;
  }, [refresh]);

  const checkLink = useCallback(async (input: string): Promise<CheckOutcome> => {
    const local = analyseUrlLocally(input);
    if (!local.valid || !local.normalizedUrl || !local.host) {
      const decision: Decision = { state: "growling", headline: "That doesn't look like a web link", what_happened: "Apollo could not read this as a web address.", why: ["Only http and https links can be checked."], what_to_do: "Paste the full link, including the website name.", action_required: false, trust_allowed: false, block_offered: false, confidence: "low" };
      return { submissionId: Crypto.randomUUID(), local, intel: null, intelError: null, decision, assessment: null, investigationError: null, event: null };
    }
    const indicator = minimalIndicator(local.normalizedUrl);
    let intel: IntelResult | null = null; let intelError: string | null = null;
    try {
      const raw = await apiPost<unknown>("/intel/check", "intel_check", { indicator_type: "url", value: indicator, device_id: deviceId ?? undefined, expand: true });
      // Malformed/partial answer → rejected → "intelligence unavailable" (never optimistic).
      intel = parseIntelResult(raw);
      if (!intel) intelError = FAILURE_MESSAGE.malformed;
    } catch (e) { intelError = e instanceof Error ? e.message : "Reputation check unavailable"; }
    const digest = intel?.indicator_digest ?? (await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, indicator));
    const trusted = trust.some((t) => t.indicator_digest === digest || t.local_indicator === indicator);
    let decision = decide(local, intel, trusted);
    let assessment: InvestigationResult | null = null; let investigationError: string | null = null;
    try {
      const remote = await apiPost<unknown>("/link/investigate", "link_investigation", {
        device_id: deviceId ?? undefined, url: local.normalizedUrl, local_state: decision.state,
        local_findings: decision.why.slice(0, 12), claimed_brand: decision.claimed_brand ?? null,
      });
      assessment = isInvestigationResult(remote) ? remote : null;
      if (!assessment) investigationError = FAILURE_MESSAGE.malformed;
    } catch (error) { investigationError = error instanceof Error ? error.message : "Higgins could not complete the deeper investigation."; }
    if (assessment?.risk === "warning" && decision.state === "resting") {
      decision = { ...decision, state: "growling", headline: assessment.higgins.headline,
        what_happened: assessment.higgins.what_was_found[0] ?? decision.what_happened,
        why: assessment.findings.map((finding) => finding.title).slice(0, 6), what_to_do: assessment.higgins.next_action };
    }
    const isEvent = decision.state !== "resting" || trusted;
    const ev: PatrolEvent = {
      event_id: Crypto.randomUUID(), device_id: deviceId ?? "local", category: intel?.verdict === "malicious" ? "known_threat" : "link",
      state: decision.state, status: decision.state === "resting" ? "resolved" : "active",
      headline: assessment?.higgins.headline ?? decision.headline,
      what_happened: patrolSafeSummary(assessment?.higgins.what_was_found[0] ?? decision.what_happened),
      why: assessment?.findings.map((finding) => finding.title).slice(0, 6) ?? decision.why,
      what_to_do: assessment?.higgins.next_action ?? decision.what_to_do,
      indicator_host: intel?.final_url ? (intel.redirect_chain?.[intel.redirect_chain.length - 1] ?? local.host) : local.host, indicator_digest: digest, local_indicator: indicator, verified_block: false, adapter_label: securityAdapter.label,
      occurred_at: new Date().toISOString(), resolved_at: decision.state === "resting" ? new Date().toISOString() : null, trust_allowed: decision.trust_allowed,
      claimed_brand: decision.claimed_brand ?? null,
      supporting_references: assessment?.sources.filter((source) => source.url).map((source) => ({ label: source.label, url: source.url! })).slice(0, 6),
    };
    if (isEvent || decision.state === "resting") await upsertEvent(ev); // resting checks are still traceable in Patrol
    void markCheckDone("link");
    return { submissionId: ev?.event_id ?? Crypto.randomUUID(), local, intel, intelError, decision, assessment, investigationError, event: ev };
  }, [deviceId, trust, upsertEvent]);

  const blockEvent = useCallback(async (event: PatrolEvent) => {
    const host = event.indicator_host ?? "";
    const result = await securityAdapter.blockDestination(host);
    // A manual "Block" tap can only ever REQUEST a block and confirm the rule is now active
    // ("operational") — it can never claim a VERIFIED block by itself, so this must never move an
    // event to "biting" / THREAT_BLOCKED on its own. Only an actually-observed dropped connection
    // (see syncEnforcementEvidence, driven by real EnforcementEvidence) may do that. isVerifiedEnforcement()
    // below is always false for tap-driven evidence today — kept as the single defensive gate so that
    // guarantee can never silently change without this line catching it.
    if (result.verified) {
      await upsertEvent({ ...event, status: "active", verified_block: false, adapter_label: result.adapterLabel, why: [...event.why, result.detail],
        what_to_do: "Apollo has put a block in place for this destination. This card will update the moment Apollo actually sees and stops a connection attempt to it.",
        enforcement_evidence: null });
      showToast(`Block rule active for ${host}. Apollo will confirm once it sees a connection.`, "barking");
    } else {
      await upsertEvent({ ...event, state: "barking", status: "active", verified_block: false, why: [...event.why, `Block not verified: ${result.detail}`],
        what_to_do: "Apollo could not verify a block on this device. Do not open the link. Avoid this destination.", enforcement_evidence: null });
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
    if (!deviceId) { showToast('Reconnect before clearing synced Patrol history.', 'growling'); return; }
    try {
      await patrolDelivery.pauseForClear(deviceId);
      await apiDelete(`/patrol/events?device_id=${deviceId}`);
      await patrolDelivery.clearPaused(deviceId, eventsRef.current.map(e => e.event_id));
      await persistEvents([]);
      qc.setQueryData(['patrol', deviceId], []);
      showToast('Patrol history hidden. This does not physically erase server records.', 'neutral');
    } catch { showToast('History was not confirmed cleared. Local records are retained; reconnect and retry.', 'growling'); }
    finally { patrolDelivery.resume(deviceId); }
  }, [deviceId, persistEvents, qc, showToast]);

  const visibility = useMemo(() => visibilityFrom(capabilities, freshObservation(protection)), [capabilities, protection, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const resolution = useMemo(() => resolveApolloState({ events, visibility, lastVerifiedAt, now: Date.now() }), [events, visibility, lastVerifiedAt, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const value: ApolloContextValue = {
    ready, setupDone, deviceId, identityReset, reRegisterDevice, completeSetup, capabilities, protection, permissions, network, adapterLabel: securityAdapter.label, isMock: IS_PREVIEW_HARNESS,
    refreshing, refresh, verifyNow, lastVerifiedAt, toggleProtection, requestPermission, events, trust, resolution, checkLink, blockEvent, trustEvent, resolveEvent, revokeTrust, clearPatrol, trustedSsids, trustNetwork, forgetNetwork, toast, showToast, checkMessage, scanGmailInbox, recordRecovery, upsertEvent, recordPageAnalysis, checkCall, checkNumberRisk,
    pushStatus, pushRegistration: pushState.registration, pushDetail: pushState.detail, enablePush, quietHours, quietNow, setQuietHours, lowPower, setLowPower,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApollo() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApollo must be used inside ApolloProvider");
  return v;
}
