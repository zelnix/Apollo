// ApolloProvider — app-wide store: device identity (server-issued, src/auth/deviceIdentity), adapter
// status/capabilities, Patrol events (local-first, minimal sync), trust list,
// verification timestamps and the resolved Apollo state.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import * as Localization from "expo-localization";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Platform } from "react-native";

import { API_BASE, apiDelete, apiGet, apiPatch, apiPost, apiPostEmpty, apiPut } from "@/src/api/client";
import { getBackendHealth, onBackendHealth, probeBackend } from "@/src/api/backendHealth";
import { clearDeviceIdentity, getDeviceIdentity, getDeviceToken, getIdentityResetReason, onIdentityReset, registerDeviceIdentity } from "@/src/auth/deviceIdentity";
import { PENDING_DELETE_KEY, wipeLocalApolloData, type DeleteDataResult } from "@/src/domain/privacyData";
import { visibilityFrom } from "@/src/domain/capability";
import { assessConnection } from "@/src/domain/connection";
import { isTrustedCaller } from "@/src/domain/trustedCallers";
import { decide } from "@/src/domain/decision";
import { parseIntelResult } from "@/src/domain/intelContract";
import { minimalIndicator } from "@/src/domain/privacy";
import { FAILURE_MESSAGE } from "@/src/domain/serviceHealth";
import { markCheckDone } from "@/src/store/checkCompletion";
import { evaluateLinkGuardFindings, extractAnchorsFromPlainText } from "@/src/domain/linkGuard";
import { analyseMessage, type MessageAnalysis } from "@/src/domain/messageAnalysis";
import { analyseCall, type CallAnalysis, type CallInput } from "@/src/domain/callAnalysis";
import { analyseUrlLocally } from "@/src/domain/risk";
import { evaluateTriage } from "@/src/domain/triage/engine";
import { callTriageEvidence, linkTriageEvidence, messageTriageEvidence, numberRiskTriageEvidence, type CorrelationInput } from "@/src/domain/triage/evidence";
import { STATE_RANK } from "@/src/domain/stateMachine";
import { findScentFor } from "@/src/domain/threatScent";
import { canTransition, resolveApolloState, type StateResolution } from "@/src/domain/stateMachine";
import type { ApolloState, Capability, Decision, DomainInfo, IntelResult, LocalAnalysis, PatrolEvent, PatrolRecord, PrivateDnsStatus } from "@/src/domain/types";
import { patrolRecordToEvent } from "@/src/domain/patrolRecords";
import { IS_PREVIEW_HARNESS, securityAdapter } from "@/src/security/securityAdapter";
import { MOCK_THREAT_EVENT } from "@/src/domain/mockThreatPreview";
import { primeDeviceFacts } from "@/src/investigation/deviceBroker";
import type { BlockResult, NetworkStatus, ProtectionPermission, ProtectionStatus } from "@/src/security/SecurityPlatformAdapter";
import { isPacketEvidence as isVerifiedEnforcement, normalizeHistoricalEvent } from '@/src/domain/packetEvidence';
import { freshObservation, unavailableObservation, boundedObservation } from '@/src/domain/protectionObservation';
import { patrolPayload } from '@/src/domain/patrolPayload';
import { mergeLocalAndRemoteEvents } from '@/src/domain/eventMerge';
import { investigationPatch } from '@/src/domain/investigationCaseUpdate';
import { getInvestigation, subscribeDeviceInvestigations } from '@/src/investigation/deviceStore';
import { patrolDelivery, deliveryFailure } from './patrolDelivery';
import { toPatrolEnforcementEvidence } from "@/src/domain/enforcementEvidenceSync";
import { getNotificationStatus, requestNotificationPermission, scheduleLocalAlert, registerRemotePush, type NotificationStatus } from "@/src/push/notifications";
import { eventLocalAlert, protectionLocalAlert } from "@/src/push/localAlerts";
import { completedCheckAlert, protectionUpdateAlert } from "@/src/push/protectionAlerts";
import { MessagingSdk } from "@/src/security/messagingSdk";
import { CallSdk } from "@/src/security/callSdk";
import { storage } from "@/src/utils/storage";
import { useCallGuardPipeline } from "@/src/pipelines/callGuardPipeline";
import { useTextGuardLocalFindings } from "@/src/pipelines/textGuardPipeline";
import { shouldBypassSetup } from "@/src/testing/setupBypass";
import { patrolSafeSummary, type InvestigationResult } from "@/src/domain/investigation";
import { RECOVERY_STEPS, type RecoveryKind } from "@/src/domain/recovery";
import { getNativeModule } from "@/src/security/nativeBridge";
import { NativeCallFailed, recordNativeFailure } from "@/src/security/nativeDiagnostics";
import { runProtectionHealthCheck } from "@/src/protection/healthCoordinator";
import type { HealthTrigger } from "@/src/protection/healthTypes";
import { APP_VERSION } from "@/src/config/buildInfo";
import { isVerifiedDesktopFlowDrop } from "@/src/security/desktopEvidence";
import { getOriginalSource, saveOriginalSource, type OriginalSourceInput } from "@/src/store/originalSource";
import { listEvidence } from "@/src/investigation/client";

// ── Privacy-safe notification diagnostic logger ──────────────────────────
// Records notification failures with enough detail to distinguish permission,
// registration and scheduling issues — without exposing email content or PII.
type NotifFailKind = "permission" | "registration" | "scheduling" | "unknown";
function logNotifDiagnostic(kind: NotifFailKind, error: unknown, context?: string): void {
  const message = error instanceof Error ? error.message : String(error);
  // Strip any potential PII / email content — keep only the failure classification
  const safeMsg = message.replace(/[\w.-]+@[\w.-]+/g, "[redacted-email]").slice(0, 200);
  const tag = `[Apollo notification ${kind}]`;
  if (__DEV__) {
    console.warn(`${tag} ${safeMsg}${context ? ` (context: ${context})` : ""}`);
  }
  // In production, this could be sent to a privacy-safe telemetry endpoint.
  // For now, store the last failure locally for diagnostics.
  void storage.setItem("apollo.notif.lastFailure", JSON.stringify({
    kind, message: safeMsg, at: new Date().toISOString(), context: context ?? null,
  })).catch(() => undefined);
}

const deviceMeta = () => ({
  platform: Platform.OS,
  adapter_mode: securityAdapter.kind,
  app_version: APP_VERSION,
  tz_offset_minutes: -new Date().getTimezoneOffset(),
  locale: Localization.getLocales()[0]?.languageTag ?? "en-AU",
});

const K = { setup: "apollo.setup.done", events: "apollo.patrol.events", exampleSeeded: "apollo.example.threat.seeded", trust: "apollo.trust.entries", verified: "apollo.lastVerifiedAt", protection: "apollo.protection.on", wifi: "apollo.wifi.trusted", quiet: "apollo.quiet.hours", lowPower: "apollo.lowPower", seenEvidence: "apollo.evidence.seen" };

/** Safe JSON parse that returns `fallback` instead of throwing on corrupt data.
 *  Optionally validates parsed shape (e.g. Array.isArray for list keys).
 *  Corrupt or shape-invalid keys are **removed** from storage so the next boot is clean. */
function safeParse<T>(raw: string | null | undefined, fallback: T, storageKey?: string, validate?: (v: unknown) => boolean): T {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (validate && !validate(parsed)) {
      console.warn(`[Apollo boot] shape mismatch in "${storageKey ?? "?"}", quarantining`);
      if (storageKey) void storage.removeItem(storageKey).catch(() => {});
      return fallback;
    }
    return parsed as T;
  }
  catch (e) {
    console.warn(`[Apollo boot] corrupt data in "${storageKey ?? "?"}", quarantining:`, e);
    if (storageKey) void storage.removeItem(storageKey).catch(() => {});
    return fallback;
  }
}

export interface TrustEntry { trust_id: string; device_id: string; indicator_type: "url" | "domain"; indicator_digest: string; indicator_host: string; event_id: string | null; created_at: string; local_indicator?: string }

export interface CheckOutcome { submissionId: string; local: LocalAnalysis; intel: IntelResult | null; intelError: string | null; decision: Decision; assessment: InvestigationResult | null; investigationError: string | null; event: PatrolEvent | null }
export interface MessageUrlResult { url: string; host: string; verdict: "clean" | "malicious" | "unknown"; threat_types: string[]; coverage: string; redirect_chain?: string[]; final_url?: string | null; domain_info?: DomainInfo | null }
export interface MessageExplanation { summary: string; why: string[]; recommendation: string }
export interface MessageOutcome { submissionId: string; analysis: MessageAnalysis; urls: MessageUrlResult[]; explanation: MessageExplanation | null; assessment: InvestigationResult | null; remoteError: string | null; event: PatrolEvent | null }
/** Call Guard add-on: mirrors backend CallRiskResponse (routers/call.py). `decision` is heuristic/
 * probabilistic (IPQualityScore) — see services/phonerisk.py's Truth-of-State comment; it alone may
 * only reach "growling"/"barking" in the app, never a verified "biting" block.
 * "unknown" means reputation data was genuinely unavailable — not safe, not suspicious. */
export interface CallRiskResult {
  number: string; valid: boolean | null; active: boolean | null; fraud_score: number | null; recent_abuse: boolean | null;
  risky: boolean | null; voip: boolean | null; line_type: string | null; carrier: string | null; country: string | null;
  decision: "allow" | "review" | "avoid" | "unknown"; cached: boolean; checked_at: string; source: "ipqualityscore" | "not_configured" | "unavailable";
  higgins: { headline: string; found: string; why: string; could_not_establish: string; next_action: string; exact_response: string; warning_only: boolean };
  assessment?: InvestigationResult | null;
  /** Set by checkNumberRisk when it already created a Magnum DI case for this number.
   *  Callers (e.g. call-guard manual flow) MUST poll this case instead of launching a second investigation. */
  investigation_case_id?: string | null;
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
  /** Grant VPN consent (if needed) and start Site Gate, flipping its status immediately. Returns whether consent was granted. */
  enableSiteProtection(): Promise<boolean>;
  events: PatrolEvent[];
  trust: TrustEntry[];
  resolution: StateResolution;
  checkLink(input: string, scentId?: string): Promise<CheckOutcome>;
  checkMessage(sender: string, text: string): Promise<MessageOutcome>;
  /** Gmail read-only connection (Gate 1 add-on): fetches recent inbox messages via the backend
   * (never stored server-side), runs each through the same on-device email engine as the paste
   * flow, files Patrol events for anything non-resting, then discards the raw content. */
  scanGmailInbox(): Promise<{ checked: number; accepted: number }>;
  recordRecovery(event: PatrolEvent, kind: RecoveryKind): Promise<void>;
  /** Gate 4: Check This Call — user-selected context (+ optional transcript) → Call Risk Engine → Patrol event + Threat Scent. */
  checkCall(input: CallInput): Promise<{ submissionId: string; analysis: CallAnalysis; event: PatrolEvent | null }>;
  /** Call Guard add-on: on-demand caller-number risk check (backend-proxied IPQualityScore). */
  checkNumberRisk(number: string, country?: string): Promise<CallRiskResult>;
  /** `original` = the exact source investigated; saved unaltered on this device for the Evidence tab. */
  upsertEvent(event: PatrolEvent, original?: OriginalSourceInput): Promise<PatrolEvent>;
  reopenEvent(event: PatrolEvent): Promise<void>;
  blockEvent(event: PatrolEvent): Promise<BlockResult>;
  trustEvent(event: PatrolEvent): Promise<boolean>;
  resolveEvent(event: PatrolEvent): Promise<void>;
  revokeTrust(entry: TrustEntry): Promise<void>;
  clearPatrol(): Promise<void>;
  requestDataDeletion(): Promise<{ ok: boolean; pending?: boolean; result?: DeleteDataResult }>;
  trustedSsids: string[];
  trustNetwork(ssid: string): Promise<void>;
  forgetNetwork(ssid: string): Promise<void>;
  toast: { message: string; tone: ApolloState | "neutral" } | null;
  showToast(message: string, tone?: ApolloState | "neutral"): void;
  notificationStatus: NotificationStatus;
  enableNotifications(): Promise<NotificationStatus>;
  quietHours: QuietHours;
  quietNow: boolean;
  setQuietHours(next: QuietHours): Promise<void>;
  lowPower: boolean;
  setLowPower(on: boolean): Promise<void>;
  /** Private DNS / DoH gap detection. null when not determined (web/non-native). */
  privateDnsStatus: PrivateDnsStatus | null;
  storage: { getItem(key: string, fallback: string | null): Promise<string | null>; setItem(key: string, value: string): Promise<boolean> };
}

export interface QuietHours { enabled: boolean; start_minutes: number; end_minutes: number }
const DEFAULT_QUIET: QuietHours = { enabled: false, start_minutes: 22 * 60, end_minutes: 7 * 60 };

/** Local-time check; mirrors backend `in_quiet_hours`. */
export function isQuietNow(q: QuietHours, at = new Date()): boolean {
  if (!q.enabled) return false;
  const m = at.getHours() * 60 + at.getMinutes();
  return q.start_minutes <= q.end_minutes ? m >= q.start_minutes && m < q.end_minutes : m >= q.start_minutes || m < q.end_minutes;
}

/** Android only: ensure system VPN consent before GuardDog's VpnService starts.
 *  Requests consent when needed, lets Android's consent screen complete, and returns the result of a
 *  FRESH permission read. Never throws — a declined/failed request resolves false so setup can finish
 *  with Site Gate in "permission required" (reduced coverage) rather than disabling Apollo as a whole. */
async function ensureAndroidVpnConsent(): Promise<boolean> {
  const vpnGranted = async () => {
    try { return (await securityAdapter.getProtectionPermissions()).find((p) => p.id === "vpn_config")?.status === "granted"; }
    catch { return false; }
  };
  const perms = await securityAdapter.getProtectionPermissions().catch(() => [] as ProtectionPermission[]);
  const vpn = perms.find((p) => p.id === "vpn_config");
  if (!vpn || vpn.status === "granted") return true; // not applicable on this device, or already granted
  const result = await securityAdapter.requestProtectionPermission("vpn_config").catch(() => null);
  if (!result) return false;
  // Current native build launches Android's VPN-consent dialog FOR RESULT and resolves only after
  // the user responds, so these states are authoritative — no polling/guessing needed.
  if (result.status === "granted" || result.requestState === "granted" || result.requestState === "already_granted") return true;
  if (result.requestState === "denied" || result.requestState === "launch_failed" || result.requestState === "unsupported" || result.requestState === "cancelled") return false;
  // Legacy fallback (older native that returned "system_ui_opened" immediately): wait for the user to
  // respond and return from the consent screen, then read the real state. Never bails early — it
  // settles only after a genuine background→active return, or at a hard 120s ceiling.
  if (result.requestState === "system_ui_opened") {
    return new Promise<boolean>((resolve) => {
      let done = false; let backgrounded = false; const ceiling = Date.now() + 120_000; let timer: ReturnType<typeof setTimeout>;
      const finish = (v: boolean) => { if (done) return; done = true; sub.remove(); clearTimeout(timer); resolve(v); };
      const onReturn = async () => { for (let i = 0; i < 6 && !done; i++) { if (await vpnGranted()) { finish(true); return; } await new Promise((r) => setTimeout(r, 500)); } finish(await vpnGranted()); };
      const tick = async () => { if (done) return; if (await vpnGranted()) { finish(true); return; } if (Date.now() > ceiling) { finish(false); return; } timer = setTimeout(tick, 1000); };
      const sub = AppState.addEventListener("change", (st) => { if (st === "background" || st === "inactive") backgrounded = true; else if (st === "active" && backgrounded) { backgrounded = false; void onReturn(); } });
      timer = setTimeout(tick, 1000);
    });
  }
  return vpnGranted();
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
  const [privateDnsStatus, setPrivateDnsStatus] = useState<PrivateDnsStatus | null>(null);
  useEffect(() => {
    void storage.getItem<string | null>(K.quiet, null).then((raw) => { if (raw) { const parsed = safeParse<QuietHours | null>(raw, null, K.quiet, (v) => typeof v === "object" && v !== null && !Array.isArray(v)); if (parsed) setQuietHoursState({ ...DEFAULT_QUIET, ...parsed }); } });
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
  const alertedStates = useRef(new Map<string, ApolloState>());
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
      // ── Private DNS gap detection ──────────────────────────────────────────
      if (securityAdapter.getPrivateDnsStatus) {
        securityAdapter.getPrivateDnsStatus().then(setPrivateDnsStatus).catch((error) => {
          // Unknown, not "no Private DNS" — null renders as unavailable and the failure is recorded.
          recordNativeFailure("getPrivateDnsStatus", error instanceof Error ? error.message : String(error));
          setPrivateDnsStatus(null);
        });
      }
      const verified = freshObservation(status) ? status.lastVerified : null;
      setLastVerifiedAt(verified);
      await storage.setItem(K.verified, verified);
      // Connection Guard: raise one growling event per distinct unsafe network condition (trusted networks stay quiet).
      const a = assessConnection(net, trustedSsidsRef.current);
      // Network Gate monitors the live OS connection snapshot and needs no VPN — raise one event
      // per distinct unsafe network condition whenever observed (open/WEP Wi‑Fi, captive portal),
      // regardless of whether the Website Gate VPN is running.
      if (a.state && lastConnectionKey.current !== a.key) {
        lastConnectionKey.current = a.key;
        const ev: PatrolEvent = {
          event_id: Crypto.randomUUID(), device_id: deviceIdRef.current ?? "local", category: "connection", state: a.state, status: "active",
          headline: a.headline, what_happened: a.what_happened, why: a.why, what_to_do: a.what_to_do, indicator_host: null, indicator_digest: null,
          verified_block: false, evidence_provenance: "local_device", adapter_label: securityAdapter.label, occurred_at: new Date().toISOString(), resolved_at: null, trust_allowed: false,
        };
        setEvents((prev) => { const next = [ev, ...prev]; void storage.setItem(K.events, JSON.stringify(next)); return next; });
        void saveOriginalSource([ev.event_id], { kind: "network", data: net });
        void syncEventRef.current?.(ev);
      } else if (!a.state) lastConnectionKey.current = a.key;
      await syncEnforcementEvidence(evidence).catch(deliveryFailure);
      await syncDnsThreatObservations().catch(deliveryFailure);
      return observed;
    } catch {
      // Stage 12 failure domain separation: a health-check failure does not mean native
      // protection has stopped. Keep last-known capabilities and protection state; only
      // mark the observation as stale (unavailable) so the UI shows "checking..." rather
      // than falsely implying protection is off. Capabilities are adapter-provided and
      // remain valid regardless of network/backend availability.
      if (generation === probeGeneration.current) { setProtection(p => unavailableObservation(p)); setLastVerifiedAt(null); }
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
      seenEvidenceRef.current = new Set(raw ? safeParse<string[]>(raw, [], K.seenEvidence, Array.isArray) : []);
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
        verified_block: false, evidence_provenance: "local_device", adapter_label: securityAdapter.label, occurred_at: e.observedAt, resolved_at: null, trust_allowed: false,
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
        verified_block: true, evidence_provenance: "local_device", adapter_label: securityAdapter.label, occurred_at: e.observedAt, resolved_at: null,
        background: true, enforcement_evidence: toPatrolEnforcementEvidence(e),
      };
      await persistEvents([ev, ...eventsRef.current.filter(x => x.event_id !== ev.event_id)]);
      void saveOriginalSource([ev.event_id], { kind: "network", data: e, capturedAt: e.observedAt });
      await syncEventRef.current?.(ev);
      seen.add(e.evidenceId); // local dedupe ONLY; delivery receipts live in the durable outbox.
      showToast(isCall ? `Apollo blocked a call from ${domain}.` : `Apollo blocked ${domain}.`, "biting");
    }
    // WFP ALE and NEFilterDataProvider report genuine OS flow/authorization drops, not packet-drop
    // evidence. Surface them locally and acknowledge them, but preserve the stricter P0 rule that
    // only correlated packet drops may produce Biting or upload enforcement evidence.
    for (const e of evidence.filter(x => isVerifiedDesktopFlowDrop(x) && !seen.has(x.evidenceId))) {
      const domain = e.destination.domain!;
      const source = e.attribution.processName ?? e.attribution.appId;
      const mechanism = e.mechanism === "wfp_ale_authorization" ? "Windows Filtering Platform" : "the macOS Network Extension";
      const ev: PatrolEvent = {
        event_id: e.eventId ?? e.evidenceId, device_id: deviceIdRef.current ?? "local", category: "connection", state: "barking", status: "active",
        headline: `Apollo's desktop filter stopped ${domain}`,
        what_happened: `${mechanism} reported a blocked outbound connection${source ? ` from ${source}` : ""}. This is flow-level evidence, so Apollo does not label it Biting.`,
        why: ["The operating system reported an enforced flow or connection-authorization drop.", "Apollo reserves Biting for correlated packet-drop evidence."],
        what_to_do: "Review the application that attempted the connection and keep the destination blocked.", indicator_host: domain, indicator_digest: null,
        verified_block: false, evidence_provenance: "local_device", adapter_label: securityAdapter.label, occurred_at: e.observedAt, resolved_at: null, trust_allowed: false, background: true,
      };
      await persistEvents([ev, ...eventsRef.current.filter(x => x.event_id !== ev.event_id)]);
      void saveOriginalSource([ev.event_id], { kind: ev.category === "call" ? "call" : "network", data: e, capturedAt: e.observedAt });
      await syncEventRef.current?.(ev); seen.add(e.evidenceId);
      showToast(`Apollo's desktop filter stopped ${domain}.`, "barking");
    }
    for (const e of evidence.filter(x => x.mechanism === 'call_screening' && x.requestedAction === 'block' && !seen.has(x.evidenceId))) {
      const ev: PatrolEvent = {
        event_id: e.eventId ?? e.evidenceId, device_id: deviceIdRef.current ?? 'local', category: 'call', state: 'barking', status: 'active',
        headline: 'Call rejection requested', what_happened: 'Call Gate submitted a rejection request to Android. No separate completion receipt is available.',
        why: ['This is a call-screening action, not an observed packet drop.'], what_to_do: 'If the call still reaches you, do not share private information. Review Call Gate.',
        indicator_host: null, indicator_digest: null, local_indicator: e.destination.domain, verified_block: false, evidence_provenance: "local_device",
        adapter_label: securityAdapter.label, occurred_at: e.observedAt, resolved_at: null, trust_allowed: false, background: true,
      };
      await persistEvents([ev, ...eventsRef.current.filter(x => x.event_id !== ev.event_id)]);
      void saveOriginalSource([ev.event_id], { kind: ev.category === "call" ? "call" : "network", data: e, capturedAt: e.observedAt });
      await syncEventRef.current?.(ev); seen.add(e.evidenceId);
    }
    const retainedSeen = [...seen].slice(-2048);
    await storage.setItem(K.seenEvidence, JSON.stringify(retainedSeen));
    await securityAdapter.acknowledgeEnforcementEvidence?.(retainedSeen);
  }, [showToast, persistEvents]);

  // ── DNS Threat Observation sync (Growling only — never Biting) ──────────
  // Polls native DNS threat observations from a SEPARATE inbox (ApolloDnsThreatInbox).
  // These represent genuine DNS-level detections: Apollo redirected a DNS query for a
  // known-dangerous hostname to a sinkhole. This is a DETECTION, not enforcement.
  const seenDnsObsRef = useRef<Set<string> | null>(null);
  const syncDnsThreatObservations = useCallback(async () => {
    if (!securityAdapter.getDnsThreatObservations) return;
    try {
      const observations = await securityAdapter.getDnsThreatObservations();
      if (!observations.length) return;
      if (!seenDnsObsRef.current) {
        const raw = await storage.getItem<string | null>("apollo:seen_dns_observations", null);
        seenDnsObsRef.current = new Set(raw ? safeParse<string[]>(raw, [], "seen_dns_observations", Array.isArray) : []);
      }
      const seen = seenDnsObsRef.current;
      const fresh = observations.filter((o) => !seen.has(o.observationId));
      const ackIds: string[] = [];
      for (const obs of fresh) {
        const domain = obs.hostname;
        const ev: PatrolEvent = {
          event_id: `dns-obs-${obs.observationId}`, device_id: deviceIdRef.current ?? "local", category: "website",
          state: "growling", status: "active",
          headline: `Apollo detected a known threat: ${domain}`,
          what_happened: `Apollo's website protection observed a DNS query for ${domain}, which matches a known threat in Apollo's active rules. The DNS answer was redirected to prevent the connection.`,
          why: ["Apollo's DNS gateway intercepted the query before the browser received a real address.", "This is a detection — Apollo redirected the DNS answer, but has not yet confirmed whether a real connection attempt followed."],
          what_to_do: "Do not visit this website. If you opened it from a message or link, treat that source as suspicious.",
          indicator_host: domain, indicator_digest: null,
          verified_block: false, evidence_provenance: "dns_observation",
          adapter_label: securityAdapter.label, occurred_at: obs.observedAt, resolved_at: null, trust_allowed: false, background: true,
        };
        await persistEvents([ev, ...eventsRef.current.filter(x => x.event_id !== ev.event_id)]);
        void saveOriginalSource([ev.event_id], { kind: "network", data: obs, capturedAt: obs.observedAt });
        await syncEventRef.current?.(ev);
        seen.add(obs.observationId); ackIds.push(obs.observationId);
        showToast(`Apollo detected a known threat: ${domain}`, "growling");
      }
      if (ackIds.length) {
        const retainedSeen = [...seen].slice(-2048);
        await storage.setItem("apollo:seen_dns_observations", JSON.stringify(retainedSeen));
        await securityAdapter.acknowledgeDnsThreatObservations?.(ackIds);
      }
    } catch (error) {
      // A failed read of the DNS observation inbox is a protection-visibility gap, not an all-clear.
      // It is recorded for Support instead of being silently treated as "nothing detected".
      recordNativeFailure("getDnsThreatObservations", error instanceof Error ? error.message : String(error));
    }
  }, [showToast, persistEvents]);

  const lastConnectionKey = useRef<string | null>(null);
  const deviceIdRef = useRef<string | null>(null);
  useEffect(() => { deviceIdRef.current = deviceId; }, [deviceId]);
  const syncEventRef = useRef<((e: PatrolEvent) => Promise<void>) | null>(null);
  // Wi‑Fi Memory: networks the user marked as home/work. Local only.
  const [trustedSsids, setTrustedSsids] = useState<string[]>([]);
  const trustedSsidsRef = useRef<string[]>([]);
  useEffect(() => { trustedSsidsRef.current = trustedSsids; }, [trustedSsids]);
  useEffect(() => { storage.getItem<string | null>(K.wifi, null).then((raw) => { if (raw) { const v = safeParse<string[]>(raw, [], K.wifi, Array.isArray); setTrustedSsids(v); trustedSsidsRef.current = v; } }); }, []);
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
        // Phase 1 — restore persisted local state. Each step is individually guarded so a
        // corrupt/stale record cannot prevent the live boot-health observation in Phase 2.
        try {
          await primeDeviceFacts();
          const [storedDone, ev, tr, protOn] = await Promise.all([
            storage.getItem<boolean>(K.setup, false), storage.getItem<string | null>(K.events, null), storage.getItem<string | null>(K.trust, null),
            storage.getItem<boolean>(K.protection, false),
          ]);
          const href = typeof globalThis.location?.href === "string" ? globalThis.location.href : "";
          const done = storedDone || shouldBypassSetup(Platform.OS, __DEV__, href);
          setSetupDone(!!done);
          if (ev) {
            const restored = safeParse<PatrolEvent[]>(ev, [], K.events, Array.isArray).map(normalizeHistoricalEvent)
              // The example case is sample data: refresh its wording from the current definition,
              // but never overwrite what the person did with it (resolved, reopened, state).
              .map((event) => (event.event_id === MOCK_THREAT_EVENT.event_id
                ? {
                    ...MOCK_THREAT_EVENT,
                    status: event.status,
                    state: event.state,
                    resolved_at: event.resolved_at,
                    reopened_at: event.reopened_at,
                    previously_resolved_at: event.previously_resolved_at,
                  }
                : event));
            eventsRef.current = restored;
            alertedStates.current = new Map(restored.map((event) => [event.event_id, event.state]));
            setEvents(restored);
          }
          // Seed the clearly-labelled EXAMPLE threat case once, on every platform, so the full
          // investigation UI can be seen on a real device as well as in the web preview. It is only
          // seeded when there is nothing else in Patrol, and only once — dismissing it is permanent.
          if (eventsRef.current.length === 0 && !(await storage.getItem<boolean>(K.exampleSeeded, false))) {
            const seed = [MOCK_THREAT_EVENT];
            eventsRef.current = seed;
            alertedStates.current = new Map(seed.map((e) => [e.event_id, e.state]));
            setEvents(seed);
            void storage.setItem(K.exampleSeeded, true);
            void storage.setItem(K.events, JSON.stringify(seed));
          }
          if (tr) setTrust(safeParse<TrustEntry[]>(tr, [], K.trust, Array.isArray)); setLastVerifiedAt(null); // persisted observations are never live boot health
          if (done) {
            // Server-issued identity. Legacy (pre-token) installs have none and get a fresh identity — never a claimed one.
            let identity = await getDeviceIdentity();
            const resetWhy = identity ? null : await getIdentityResetReason();
            if (resetWhy) setIdentityReset(resetWhy); // explicit reset state survives reloads — never re-register silently
            else if (!identity) { try { identity = await registerDeviceIdentity(API_BASE, deviceMeta()); } catch { identity = null; } }
            if (identity) {
              setDeviceId(identity.deviceId);
              // Build the request inside the Promise chain too: egress validation is synchronous, so a
              // future client/server contract mismatch must remain contained like an offline heartbeat.
              void Promise.resolve().then(() => apiPost("/devices/heartbeat", "device_register", deviceMeta())).catch(() => undefined);
              // Live Caller ID PIR — silently write the PIR server URL to shared UserDefaults (iOS)
              // so the LiveCallerIDLookup extension knows where to query. Non-blocking, best-effort.
              if (Platform.OS === "ios") {
                const pirUrl = Constants.expoConfig?.extra?.pirServer?.url;
                if (pirUrl && typeof pirUrl === "string" && pirUrl.length > 0) {
                  void getNativeModule()?.configurePirServerUrl(pirUrl).catch(() => undefined);
                }
              }
            }
            if (protOn) await storage.setItem(K.protection, true);
          }
        } catch (restoreError) {
          console.warn("[Apollo boot] local state restoration failed, continuing to boot-health check:", restoreError);
        }
        // Phase 2 — live boot-health observation. Runs regardless of Phase 1 outcome so the
        // initial protection-health check is never silently skipped.
        await refresh(0, "boot");
      } catch (bootError) {
        // Degraded boot: log the failure, continue with whatever state was loaded so far.
        // The app remains functional but may be missing Patrol history or trust entries.
        console.warn("[Apollo boot] startup error, entering degraded state:", bootError);
      } finally { setReady(true); }
    })();
  }, [refresh]);

  // A 401 means the credential is dead (revoked/expired/rotated elsewhere). Fail closed and enter an EXPLICIT
  // identity-reset state: nothing is re-registered silently, because a new identity detaches this install from its
  // Family links and shared incidents on the server. The person chooses to re-register.
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
    // Stage 12: Track when the app entered background so foreground return can decide
    // whether a full refresh is warranted. Brief tab-switches (< 60s) should not trigger
    // a full health-check cycle or flash protection as "unavailable".
    let backgroundAt: number | null = null;
    const sub = AppState.addEventListener("change", (st) => {
      if (st === 'active') {
        const away = backgroundAt ? Date.now() - backgroundAt : Infinity;
        backgroundAt = null;
        if (away > 60_000) {
          // Meaningful absence (> 60s): full refresh, protection may be stale.
          void refresh(0, "foreground");
        } else {
          // Brief absence (< 60s): protection observation is still fresh — skip full refresh.
          // The periodic timer will pick up the next check on schedule.
        }
        if (getBackendHealth().reachable === false) void probeBackend();
      } else {
        backgroundAt = Date.now();
        // Cancel any in-flight observation so it doesn't land after we return and overwrite
        // a fresh foreground result. Don't blank protection — native protection is still running.
        ++probeGeneration.current;
      }
    });
    return () => { off(); sub.remove(); if (timer) clearInterval(timer); };
  }, [lowPower, qc, refresh]);

  // Re-resolve state over time so cooldown/freshness windows expire visibly (slower in battery saver).
  useEffect(() => { const t = setInterval(() => {
    setTick(n => n + 1);
    setProtection(p => freshObservation(p) ? p : unavailableObservation(p));
  }, 1000); return () => clearInterval(t); }, []);
  useEffect(() => { const t = setInterval(() => { if (AppState.currentState !== 'background') void refresh(0, "periodic"); }, lowPower ? 60000 : 30000); return () => clearInterval(t); }, [lowPower, refresh]);

  // Local notification permission is independent of server identity; no remote token is requested.
  const [notificationStatus, setNotificationStatus] = useState<NotificationStatus>(Platform.OS === "web" ? "unsupported" : "undetermined");
  useEffect(() => {
    const refreshPermission = () => { void getNotificationStatus().then(setNotificationStatus).catch(() => setNotificationStatus("unsupported")); };
    refreshPermission();
    const sub = AppState.addEventListener("change", (state) => { if (state === "active") refreshPermission(); });
    return () => sub.remove();
  }, []);
  useEffect(() => { if (deviceId && quietRef.current.enabled) void syncQuiet(quietRef.current, deviceId); }, [deviceId, syncQuiet]);
  // Register for remote push when device identity becomes available (boot or recovery).
  useEffect(() => { if (deviceId) void registerRemotePush().catch(() => undefined); }, [deviceId]);
  const enableNotifications = useCallback(async () => {
    const status = await requestNotificationPermission();
    setNotificationStatus(status);
    return status;
  }, []);

  // Observe accepted Patrol updates downstream of enforcement; neither this effect nor its alerts
  // may promote an event to Biting. Historical records are seeded above and old syncs stay silent.
  //
  // Stage 12 — one finding → one notification: for each event state change, select the SINGLE
  // most relevant notification. Priority: threat alert > completed check > protection update.
  // This prevents one real finding from producing separate Gate/Patrol/Home/Higgins notifications.
  useEffect(() => {
    if (!ready) return;
    for (const event of events) {
      const previous = alertedStates.current.get(event.event_id);
      alertedStates.current.set(event.event_id, event.state);
      const age = Date.now() - Date.parse(event.occurred_at);
      if (previous === event.state || !Number.isFinite(age) || age < 0 || age > 120_000) continue;
      // Pick the single most specific notification for this event change.
      const alert = eventLocalAlert(event) ?? completedCheckAlert(event) ?? protectionUpdateAlert(event);
      // Quiet hours silence everything EXCEPT a live threat. (All Apollo alerts now share the one
      // "apollo_alerts" channel, so severity comes from the event state, not the channel name.)
      const urgent = event.state === "barking" || event.state === "biting";
      if (alert && (urgent || !isQuietNow(quietRef.current))) void scheduleLocalAlert(alert).catch((e) => logNotifDiagnostic("scheduling", e, `event=${event.event_id}`));
    }
    if (alertedStates.current.size > 2048) alertedStates.current = new Map(events.slice(0, 2048).map((event) => [event.event_id, event.state]));
  }, [ready, events]);

  const lastObservedProtection = useRef<ProtectionStatus | null>(null);
  useEffect(() => {
    if (!ready || !protection || !Number.isFinite(Date.parse(protection.checkedAt))) return;
    if (lastObservedProtection.current?.checkedAt === protection.checkedAt) return;
    const previous = lastObservedProtection.current;
    lastObservedProtection.current = protection;
    if (previous) {
      const alert = protectionLocalAlert(previous, protection);
      if (alert) void scheduleLocalAlert(alert).catch((e) => logNotifDiagnostic("scheduling", e, "protection-status"));
    }
  }, [ready, protection]);

  const completeSetup = useCallback(async () => {
    let identity = await getDeviceIdentity();
    if (!identity) { try { identity = await registerDeviceIdentity(API_BASE, deviceMeta()); } catch { identity = null; /* offline: retried on next launch */ } }
    if (identity) setDeviceId(identity.deviceId);

    // Record the person's intent to run protection. Site Gate's VPN consent (Android) and the other
    // per-Gate permissions are now requested in the setup walkthrough (app/setup-gates.tsx) using a
    // consistent Enable / Not now pattern — so setup never blocks on any single permission. On
    // non-Android, protection starts here (content filter needs no system consent dialog).
    await storage.setItem(K.protection, true);
    // Call Guard: automatic incoming-number checks are turned ON during onboarding by default (the Call
    // Gate shows the disclosure and lets the person turn it off anytime). Only seed when never set, so a
    // later user choice is never overwritten.
    if ((await storage.getItem("apollo.call.auto_check", null)) === null) await storage.setItem("apollo.call.auto_check", "true");
    if (Platform.OS !== "android") { try { await securityAdapter.startProtection(); } catch { /* reduced coverage */ } }

    await storage.setItem(K.setup, true);
    setSetupDone(true);
    await verifyNow();
    // Contextual ask: the user just turned protection on, so "tell me when Apollo barks" is expected here.
    try { await enableNotifications(); } catch (e) { logNotifDiagnostic("permission", e, "setup-flow"); }
    // Register for remote push delivery after notification permission is granted.
    void registerRemotePush().catch((e) => logNotifDiagnostic("registration", e, "setup-push"));
  }, [verifyNow, enableNotifications]);

  // Remote Patrol + trust merge — uses the extracted pure mergeLocalAndRemoteEvents function
  // so the same production logic is exercised by both the app and the regression tests.
  const remoteEvents = useQuery({ queryKey: ["patrol", deviceId], enabled: !!deviceId, queryFn: () => apiGet<PatrolRecord[]>(`/patrol/records?limit=200`) });
  const remoteTrust = useQuery({ queryKey: ["trust", deviceId], enabled: !!deviceId, queryFn: () => apiGet<TrustEntry[]>(`/trust?device_id=${deviceId}`) });
  useEffect(() => {
    // Wait until local events are restored, and merge against the live ref — merging against an
    // empty/stale snapshot let the server's unresolved copy overwrite a local "contained" decision.
    if (!remoteEvents.data || !ready) return;
    const remoteConverted = remoteEvents.data.map((record) => {
      const e = normalizeHistoricalEvent(patrolRecordToEvent(record));
      return { ...e, evidence_provenance: e.evidence_provenance ?? "server_projected" as const };
    });
    const { events: merged } = mergeLocalAndRemoteEvents(eventsRef.current, remoteConverted);
    void persistEvents(merged);
  }, [remoteEvents.data, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  // Server-investigated sources (monitored email, captured texts, Higgins submissions): download the exact
  // original once while the investigation still holds it (server copies expire after 24 h) and keep it on device.
  const originalTried = useRef(new Set<string>());
  useEffect(() => {
    if (!ready || !deviceId) return;
    const pending = events.filter((e) => e.investigation_case_id && !originalTried.current.has(e.event_id));
    if (!pending.length) return;
    void (async () => {
      const token = await getDeviceToken();
      if (!token) return;
      for (const ev of pending) {
        originalTried.current.add(ev.event_id);
        const caseId = ev.investigation_case_id!;
        try {
          if (await getOriginalSource(ev.event_id) || await getOriginalSource(caseId)) continue;
          const { items } = await listEvidence(caseId);
          const roots = items.filter((i) => i.origin === "user_submission" && !i.parentId && i.availability === "available" && (i.kind === "text" || i.kind === "url"));
          if (!roots.length) continue;
          const parts: { kind: string; body: string }[] = [];
          for (const item of roots) {
            const res = await fetch(`${API_BASE}/investigations/${caseId}/evidence/${item.id}/content`, { headers: { Authorization: `Bearer ${token}` } });
            if (res.ok) parts.push({ kind: item.kind, body: await res.text() });
          }
          if (!parts.length) continue;
          const meta = ev.source_metadata;
          const fields = [
            meta?.sender ? { label: "From", value: meta.sender } : null,
            meta?.reply_to ? { label: "Reply-to", value: meta.reply_to } : null,
            meta?.subject ? { label: "Subject", value: meta.subject } : null,
            meta?.received_at ? { label: "Received", value: new Date(meta.received_at).toLocaleString() } : null,
          ].filter((f): f is { label: string; value: string } => !!f);
          const texts = parts.filter((p) => p.kind === "text").map((p) => p.body);
          const urls = parts.filter((p) => p.kind === "url").map((p) => p.body);
          await saveOriginalSource([ev.event_id, caseId], {
            kind: meta?.type ?? (urls.length && !texts.length ? "link" : "text"), fields,
            text: texts.length ? texts.join("\n\n") : null, url: urls.length ? urls.join("\n") : null, origin: "investigation",
          });
        } catch { /* investigation unavailable or expired — Evidence explains the original wasn't saved */ }
      }
    })();
  }, [events, ready, deviceId]);
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

  const upsertEvent = useCallback(async (input: PatrolEvent, original?: OriginalSourceInput) => {
    // Threat Scent: link this event to related recent events (same brand/host within 30 min).
    // Cross-gate correlation associates findings into the same incident for display purposes,
    // but each event preserves its own independently assessed severity. The overall incident
    // status is derived at display time by buildScents(), not by upgrading individual events.
    let e = normalizeHistoricalEvent({ ...input, evidence_provenance: input.evidence_provenance ?? "local_device" });
    const events = eventsRef.current;
    if (e.state !== "resting" && !events.some((x) => x.event_id === e.event_id)) {
      const scent = findScentFor(e, events) ?? e.event_id;
      e = { ...e, scent_id: e.scent_id ?? scent };
    }
    const next = [e, ...events.filter((x) => x.event_id !== e.event_id)];
    await persistEvents(next);
    if (original) await saveOriginalSource([e.event_id], original);
    void syncEvent(e);
    return e;
  }, [persistEvents, syncEvent]);

  // ── A finished investigation becomes the case's own content ───────────────
  // The server purges a completed investigation the moment this device commits it, so its patrol
  // projection can only ever say "Apollo is investigating this". The real answer is in device
  // storage: apply it to the case so Threats, the case screen and its history show the actual
  // findings, the actual conclusion and the actual next step.
  useEffect(() => {
    if (!ready) return;
    let live = true;
    const apply = async () => {
      const caseIds = Array.from(new Set(eventsRef.current
        .map((e) => e.investigation_case_id ?? e.patrol_record?.investigationCaseId)
        .filter((id): id is string => !!id)));
      for (const caseId of caseIds) {
        const event = eventsRef.current.find((e) => (e.investigation_case_id ?? e.patrol_record?.investigationCaseId) === caseId);
        if (!event) continue;
        const inv = await getInvestigation(caseId).catch(() => null);
        const patch = investigationPatch(event, inv);
        if (patch && live) await upsertEvent(patch);
      }
    };
    void apply();
    const unsubscribe = subscribeDeviceInvestigations(() => { void apply(); });
    return () => { live = false; unsubscribe(); };
  }, [ready, events, upsertEvent]);

  // ── Triage correlation (deterministic) ───────────────────────────────────
  // Related evidence (same Threat Scent / same indicator) with a compatible mechanic belongs to ONE
  // case. When that case already has a Magnum DI investigation, Triage must reuse it so a correlated
  // incident never spends a second Gemini call.
  const correlationFor = useCallback((args: { indicator?: string | null; scentId?: string | null; mechanics: string[] }): { correlation: CorrelationInput; existingCaseId: string | null } => {
    const windowMs = 4 * 60 * 60 * 1000;
    const now = Date.now();
    const related = eventsRef.current.filter((e) =>
      !e.resolved_at && now - Date.parse(e.occurred_at) <= windowMs &&
      ((args.scentId && e.scent_id === args.scentId) ||
       (args.indicator && (e.local_indicator === args.indicator || e.indicator_host === args.indicator))));
    const existingCaseId = related.find((e) => !!e.investigation_case_id)?.investigation_case_id ?? null;
    return {
      correlation: {
        related: related.slice(0, 6).map((e) => ({ category: e.category, event_id: e.event_id, occurred_at: e.occurred_at })),
        mechanics: args.mechanics,
        // Time proximity alone is never enough: a correlated sibling must itself carry concern.
        supporting_evidence: related.some((e) => e.state !== "resting"),
        case_key: related[0]?.scent_id ?? args.scentId ?? null,
      },
      existingCaseId,
    };
  }, []);

  const checkMessage = useCallback(async (sender: string, text: string): Promise<MessageOutcome> => {    const analysis = analyseMessage(sender, text);
    let urls: MessageUrlResult[] = []; let remoteError: string | null = null;
    // Gate detection path: local/deterministic analysis + link reputation only.
    // No backend investigation call — Magnum DI investigates only when the person requests it.
    try {
      // Fetch URL reputation for links found in the message (existing intel endpoint, not investigation).
      for (const rawUrl of analysis.signals.urls.slice(0, 5)) {
        try {
          const raw = await apiPost<unknown>("/intel/check", "intel_check", { indicator_type: "url", value: rawUrl, device_id: deviceId ?? undefined, expand: true });
          const parsed = parseIntelResult(raw);
          if (parsed) {
            urls.push({
              url: rawUrl, host: rawUrl.replace(/^https?:\/\//i, "").split("/")[0].toLowerCase(),
              verdict: parsed.verdict === "malicious" ? "malicious" : parsed.verdict === "clean" ? "clean" : "unknown",
              threat_types: parsed.threat_types ?? [],
              // Real coverage from the reputation service. "none" means nothing could be checked —
              // it must never be recorded as a completed check.
              coverage: parsed.coverage === "none" ? "unavailable" : parsed.coverage,
              redirect_chain: parsed.redirect_chain ?? undefined, final_url: parsed.final_url ?? null,
              domain_info: parsed.domain_info ?? null,
            });
          }
        } catch { urls.push({ url: rawUrl, host: rawUrl.replace(/^https?:\/\//i, "").split("/")[0].toLowerCase(), verdict: "unknown", threat_types: [], coverage: "unavailable" }); }
      }
    } catch (e) { remoteError = e instanceof Error ? e.message : "URL reputation check unavailable."; }
    let state = analysis.state; const why = [...analysis.why];
    // Email Guard / Text Guard: automatic pre-click assessment over every checked link plus
    // any display-text-vs-real-destination mismatch. This can only raise state to growling/barking.
    const guard = evaluateLinkGuardFindings(urls, extractAnchorsFromPlainText(text));
    if (STATE_RANK[guard.state] > STATE_RANK[state]) state = guard.state;
    why.push(...guard.why);
    const firstHost = urls[0]?.host ?? (analysis.signals.urls[0] ? analysis.signals.urls[0].replace(/^https?:\/\//i, "").split("/")[0].toLowerCase() : null);
    let event: PatrolEvent | null = null;
    let investigationCaseId: string | null = null;

    // ── Triage Investigation (Tier 1, deterministic, 0 Gemini calls) ───────
    const linkOutcome = urls.some((u) => u.verdict === "malicious") ? "POSSIBLE_THREAT_IDENTIFIED" as const
      : urls.some((u) => u.coverage === "unavailable") ? "LIMITED_UNABLE_TO_DETERMINE" as const
      : urls.length ? "NO_THREAT_IDENTIFIED" as const : null;
    const { correlation, existingCaseId } = correlationFor({ indicator: firstHost, mechanics: ["scam_message", "deceptive_link"] });
    const triage = evaluateTriage(messageTriageEvidence({ analysis, linkOutcome, correlation }));

    // Patrol event: Apollo's deterministic reasons (local analysis + URL guard) drive the state.
    if (triage.outcome === "POSSIBLE_THREAT_IDENTIFIED") {
      // Tier 2: exactly ONE Magnum DI investigation per correlated case.
      if (existingCaseId) {
        investigationCaseId = existingCaseId;
      } else {
        try {
          // Fields POST /message/analyse actually reads — Apollo's deterministic findings travel as
          // `signals` so they reach Magnum DI's brief instead of being silently dropped.
          const remote = await apiPost<{ investigation_case_id?: string | null; investigation_error?: string | null }>("/message/analyse", "message_investigation", {
            device_id: deviceId ?? undefined, text, sender,
            urls: analysis.signals.urls.slice(0, 20),
            local_state: state, scenario: analysis.scenario,
            signals: why.slice(0, 20), claimed_brand: analysis.signals.claimedBrand ?? null,
          });
          investigationCaseId = typeof remote.investigation_case_id === "string" ? remote.investigation_case_id : null;
          if (remote.investigation_error) why.push(`${remote.investigation_error} This result comes from Apollo's deterministic checks only.`);
          else if (!investigationCaseId) why.push("Apollo asked for a deeper Magnum DI investigation but no case was opened, so no deeper investigation is running.");
        } catch (error) {
          // Triage escalated, but the deeper investigation never started. The person is told, rather
          // than being left with a deterministic-only result that looks like the full picture.
          why.push(`Apollo couldn't start the deeper Magnum DI investigation (${error instanceof Error ? error.message : "reason could not be determined"}). This result comes from Apollo's deterministic checks only.`);
        }
      }
    }
    if (state !== "resting" || triage.outcome !== "NO_THREAT_IDENTIFIED") {
      const guardHeadline = guard.why.length ? `Suspicious link detected${firstHost ? `: ${firstHost}` : ""}` : "";
      const apolloHeadline = analysis.state !== "resting"
        ? `${analysis.scenarioTitle}${analysis.signals.claimedBrand ? ` — claims to be ${analysis.signals.claimedBrand}` : ""}`
        : guardHeadline;
      event = await upsertEvent({
        event_id: Crypto.randomUUID(), device_id: deviceId ?? "local", category: "message", state, status: "active",
        headline: apolloHeadline,
        what_happened: patrolSafeSummary(analysis.state !== "resting" ? analysis.verdict : (guard.why[0] ?? analysis.verdict)),
        why,
        what_to_do: analysis.recommendation,
        indicator_host: firstHost, indicator_digest: null, local_indicator: firstHost ? `https://${firstHost}/` : null, verified_block: false, adapter_label: securityAdapter.label,
        occurred_at: new Date().toISOString(), resolved_at: null, trust_allowed: false, claimed_brand: analysis.signals.claimedBrand, scenario: analysis.scenario,
        investigation_case_id: investigationCaseId,
        triage_investigation: triage,
      }, { kind: "text", fields: sender.trim() ? [{ label: "From", value: sender }] : [], text });
      if (event.state !== state) { state = event.state; }
    }
    void markCheckDone("message");
    return { submissionId: event?.event_id ?? Crypto.randomUUID(), analysis: { ...analysis, state, why }, urls, explanation: null, assessment: null, remoteError, event };
  }, [correlationFor, deviceId, upsertEvent]);

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
          const item = raw as { id?: unknown; status?: unknown; droppedCount?: unknown; sender?: unknown; text?: unknown; sourceKey?: unknown; revisionDigest?: unknown; capturedAt?: unknown; expiresAt?: unknown; contentComplete?: unknown; originalCharacters?: unknown };
          const id = typeof item?.id === "string" ? item.id : "";
          if (item.status === "overflow") {
            const dropped = typeof item.droppedCount === "number" ? item.droppedCount : 0;
            showToast(`${dropped} older message notification${dropped === 1 ? " was" : "s were"} not assessed because the protected queue was full.`, "growling");
            if (id) await MessagingSdk.acknowledgeMessageSecurityEvents([id]);
            continue;
          }
          if (item.status === "queue_error") {
            showToast("Apollo could not read its protected message queue. Open Support before relying on automatic text checks.", "growling");
            continue;
          }
          const text = typeof item?.text === "string" ? item.text : "";
          if (!id || !text.trim()) continue;
          const sender = typeof item.sender === "string" ? item.sender : "";
          // Trusted senders: always run the analysis — trust influences notification quieting, not
          // detection suppression. If a trusted sender's message contains barking-level evidence
          // (e.g., spoofed number), create a Patrol event anyway. Only acknowledge silently when the
          // analysis shows no concern or low concern (resting/ears_up).
          const senderTrusted = !!(sender && await isTrustedCaller(sender));
          if (senderTrusted) {
            // Still analyse the message content for evidence.
            const quickAnalysis = analyseMessage(sender, text);
            const hasUrls = quickAnalysis.signals.urls.length > 0;
            if (!hasUrls && (quickAnalysis.state === "resting" || quickAnalysis.state === "ears_up")) {
              // Low/no concern from a trusted sender AND no URLs to check against external
              // threat intelligence — acknowledge quietly without Patrol event.
              await MessagingSdk.acknowledgeMessageSecurityEvents([id]);
              continue;
            }
            // Trusted sender but contains URLs (need external reputation check) or significant
            // local evidence (growling/barking) — fall through to full backend investigation.
          }
          await apiPost("/investigations/background/text", "investigation", {
            submissionId: id, sourceKey: typeof item.sourceKey === "string" ? item.sourceKey : id,
            revisionDigest: typeof item.revisionDigest === "string" ? item.revisionDigest : id,
            sender, text, capturedAt: typeof item.capturedAt === "string" ? item.capturedAt : new Date().toISOString(),
            expiresAt: typeof item.expiresAt === "string" ? item.expiresAt : new Date(Date.now() + 15 * 60 * 1000).toISOString(),
            contentComplete: item.contentComplete !== false,
            originalCharacters: typeof item.originalCharacters === "number" ? item.originalCharacters : text.length,
          });
          await MessagingSdk.acknowledgeMessageSecurityEvents([id]);
          showToast("Magnum DI is investigating a captured text. The result will appear in Patrol.", "neutral");
        }
      } catch (error) {
        // Module absent / listener not granted is reported by the capability check above, so a throw here
        // means a real read failure: Apollo cannot claim there was nothing to assess.
        if (error instanceof NativeCallFailed) {
          showToast("Apollo couldn't read its protected message queue, so recent texts may not have been assessed. Open Support before relying on automatic text checks.", "growling");
        }
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), lowPower ? 120000 : 45000);
    const sub = AppState.addEventListener("change", (st) => { if (st === "active") void poll(); });
    return () => { cancelled = true; clearInterval(timer); sub.remove(); };
  }, [showToast, lowPower]);

  useEffect(() => {
    if (Platform.OS !== "android" || !deviceId) return;
    void getDeviceToken().then((deviceToken) => {
      const module = getNativeModule();
      if (!deviceToken || !module?.configureTextBackgroundHandoff) return;
      return module.configureTextBackgroundHandoff(JSON.stringify({ backendUrl: API_BASE, deviceToken }));
    }).catch(() => undefined);
  }, [deviceId]);

  const scanGmailInbox = useCallback(async (): Promise<{ checked: number; accepted: number }> => {
    if (!deviceId) return { checked: 0, accepted: 0 };
    const result = await apiPost<{ status: string; checked: number; accepted: number; nextCursor: string | null }>("/gmail/scan", "gmail_scan", { device_id: deviceId });
    if (result.status === "busy") throw new Error("A Gmail assessment is already in progress.");
    return { checked: result.checked, accepted: result.accepted };
  }, [deviceId]);

  const checkCall = useCallback(async (input: CallInput) => {
    const analysis = analyseCall(input);
    let event: PatrolEvent | null = null;
    // ── Triage Investigation (deterministic, 0 Gemini calls) ──
    const { correlation, existingCaseId } = correlationFor({ indicator: input.number?.trim() || null, mechanics: ["remote_access", "scam_call"] });
    const triage = evaluateTriage(callTriageEvidence({ input, analysis, correlation }));
    if (analysis.state !== "resting" || triage.outcome !== "NO_THREAT_IDENTIFIED") {
      // Tier 2 (Magnum DI) runs ONLY for a deterministic Possible Threat — once per correlated case.
      let investigationCaseId: string | null = existingCaseId;
      let escalationNote: string | null = null;
      if (triage.outcome === "POSSIBLE_THREAT_IDENTIFIED" && !investigationCaseId) {
        const callSummary = [
          input.claim ? `Caller said: ${input.claim}` : null,
          input.brandName ? `Claimed brand: ${input.brandName}` : null,
          input.number ? `Number: ${input.number}` : null,
          input.asks.length ? `Asked for: ${input.asks.join(", ")}` : null,
          input.transcript ? `Transcript: ${input.transcript}` : null,
        ].filter(Boolean).join("\n");
        try {
          const remote = await apiPost<{ case?: { id?: string | null } }>("/investigations", "call_investigation", {
            gate: "call",
            question: `Investigate this phone call.\n\n${callSummary}`,
            submissions: [{ client_item_id: Crypto.randomUUID(), kind: "text", value: callSummary, label: "Call details" }],
            initial_findings: analysis.why.slice(0, 12),
          });
          investigationCaseId = typeof remote.case?.id === "string" ? remote.case.id : null;
          if (!investigationCaseId) escalationNote = "Apollo asked for a deeper Magnum DI investigation but the service didn't return a case, so no deeper investigation is running.";
        } catch (error) {
          escalationNote = `Apollo couldn't start the deeper Magnum DI investigation (${error instanceof Error ? error.message : "reason could not be determined"}). This result comes from Apollo's deterministic checks only.`;
        }
      }
      event = await upsertEvent({
        event_id: Crypto.randomUUID(), device_id: deviceId ?? "local", category: "call", state: analysis.state, status: "active",
        headline: `${analysis.title}${analysis.claimedBrand ? ` — caller claimed ${analysis.claimedBrand}` : ""}`, what_happened: analysis.verdict, why: escalationNote ? [...analysis.why, escalationNote] : analysis.why, what_to_do: analysis.recommendation,
        indicator_host: null, indicator_digest: null, local_indicator: input.number?.trim() || null, verified_block: false, adapter_label: securityAdapter.label,
        occurred_at: new Date().toISOString(), resolved_at: null, trust_allowed: false, claimed_brand: analysis.claimedBrand, scenario: analysis.scenario,
        investigation_case_id: investigationCaseId,
        triage_investigation: triage,
      }, { kind: "call", fields: [
        ...(input.number?.trim() ? [{ label: "Number", value: input.number }] : []),
        { label: "Caller said", value: input.brandName ? `${input.claim} (${input.brandName})` : input.claim },
        ...(input.asks.length ? [{ label: "Asked for", value: input.asks.join(", ") }] : []),
      ], text: input.transcript?.trim() ? input.transcript : null });
      if (event.state !== analysis.state) return { submissionId: event.event_id, analysis: { ...analysis, state: event.state, why: event.why, verdict: "This call may be connected to the suspicious activity detected earlier." }, event };
    }
    return { submissionId: event?.event_id ?? Crypto.randomUUID(), analysis, event };
  }, [correlationFor, deviceId, upsertEvent]);

  // Call Guard add-on: on-demand caller-number risk check (backend-proxied IPQualityScore — see
  // services/phonerisk.py). Used by the "Check this number" quick action AND the pending-lookup poll
  // below. A non-"allow" decision is remembered on-device (CallSdk.markNumberRisky) so Call Guard's
  // native mechanism can act on it next time, and files a growling/barking (never biting) Patrol
  // event — matching Check This Call's existing choice to keep the number itself local-only
  // (`local_indicator`, never synced — see syncEvent's strip above).
  const checkNumberRisk = useCallback(async (number: string, country?: string): Promise<CallRiskResult> => {
    const body: Record<string, unknown> = { device_id: deviceId ?? "local", number };
    // Auto-detect device region for local numbers without country code
    const region = country || Localization.getLocales()[0]?.regionCode;
    if (region) body.country = region;
    const result = await apiPost<CallRiskResult>("/call/risk-check", "call_risk_check", body);
    if (result.decision !== "allow" && result.decision !== "unknown") {
      // A2 fix: only "avoid" (high-risk, strong fraud signals) should auto-block by adding to the
      // autoRisky list. "review" (moderate signals, uncertain) should only warn — the person decides.
      // "unknown" never triggers auto-block or threat warning — it means data was unavailable.
      // "Apollo will block this from now on" may only be said when the device confirms it stored the number.
      let autoBlockConfirmed = false;
      let autoBlockDetail: string | null = null;
      if (result.decision === "avoid") {
        try {
          const marked = await CallSdk.markNumberRisky(result.number);
          autoBlockConfirmed = marked.ok === true;
          if (!autoBlockConfirmed) autoBlockDetail = "This device didn't confirm it saved the number to Apollo's screening list.";
        } catch (error) {
          autoBlockDetail = error instanceof NativeCallFailed
            ? "Apollo tried to add this number to its screening list and the device read failed."
            : "Apollo couldn't confirm the number was added to its screening list.";
        }
      }
      const isAvoid = result.decision === "avoid";
      const existing = eventsRef.current.find((x) => x.local_indicator === result.number && x.state !== "biting");
      const why = [result.recent_abuse ? "Reported for recent abuse." : "Elevated fraud-risk score.", result.voip ? "This is a VOIP number, commonly used to spoof caller ID." : null].filter((w): w is string => !!w);

      // Triage first (deterministic, 0 Gemini calls). Magnum DI runs ONLY for a Possible Threat,
      // and reuses the correlated case when one already exists.
      const { correlation, existingCaseId } = correlationFor({ indicator: result.number, mechanics: ["scam_call", "callback"] });
      const triage = evaluateTriage(numberRiskTriageEvidence({
        decision: result.decision, fraudScore: result.fraud_score ?? null,
        recentAbuse: result.recent_abuse ?? null, voip: result.voip ?? null, correlation,
      }));
      let investigationCaseId: string | null = existingCaseId;
      if (triage.outcome === "POSSIBLE_THREAT_IDENTIFIED" && !investigationCaseId) try {
        const investigationResult = await apiPost<{ case?: { id?: string | null } }>("/investigations", "number_risk_investigation", {
          gate: "call",
          question: `Investigate caller ${result.number}. Fraud score: ${result.fraud_score ?? "unknown"}/100.`,
          submissions: [{ client_item_id: Crypto.randomUUID(), kind: "text", value: `Number: ${result.number}\nDecision: ${result.decision}\nFraud score: ${result.fraud_score ?? "unknown"}/100\n${result.voip ? "VOIP number" : ""}${result.recent_abuse ? "\nRecent abuse reported" : ""}`, label: "Risk check result" }],
          initial_findings: why,
        });
        investigationCaseId = typeof investigationResult.case?.id === "string" ? investigationResult.case.id : null;
        if (!investigationCaseId) why.push("Apollo asked for a deeper Magnum DI investigation but the service didn't return a case, so no deeper investigation is running.");
      } catch (error) {
        why.push(`Apollo couldn't start the deeper Magnum DI investigation (${error instanceof Error ? error.message : "reason could not be determined"}). This result comes from the reputation check and Apollo's deterministic rules only.`);
      }

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
        why,
        what_to_do: isAvoid
          ? (autoBlockConfirmed
              ? "Apollo will reject future calls from this number automatically. You can also add it to your block list."
              : `Add this number to your block list — Apollo has NOT started blocking it automatically. ${autoBlockDetail ?? "Automatic screening isn't active on this device."}`)
          : "Answer with caution, or add it to your block list if it turns out to be unwanted.",
        investigation_case_id: investigationCaseId,
        triage_investigation: triage,
      };
      // Attach caller metadata from the risk check for display (country, carrier, line type).
      (ev as unknown as Record<string, unknown>).caller_meta = {
        country: result.country ?? null, carrier: result.carrier ?? null,
        line_type: result.line_type ?? null, voip: result.voip ?? null,
        fraud_score: result.fraud_score ?? null, source: result.source,
        identity_verified: false, // IPQualityScore provides reputation, not authenticated identity
      };
      setEvents((prev) => { const next = [ev, ...prev.filter((x) => x.event_id !== ev.event_id)]; void storage.setItem(K.events, JSON.stringify(next)); return next; });
      void saveOriginalSource([ev.event_id], { kind: "call", fields: [{ label: "Number", value: number }], data: result });
      void syncEventRef.current?.(ev);
      showToast(isAvoid ? `Apollo flagged a high-risk caller: ${result.number}` : `Apollo flagged a caller worth checking: ${result.number}`, isAvoid ? "barking" : "growling");
      // Expose the case ID on the result so callers (e.g. call-guard manual flow) know an
      // investigation is already in flight and MUST NOT launch a second one.
      result.investigation_case_id = investigationCaseId;
    }
    return result;
  }, [correlationFor, deviceId, showToast]);

  // ── Call Guard Pipeline (extracted to src/pipelines/callGuardPipeline.ts) ──
  useCallGuardPipeline({
    deviceId, lowPower, checkNumberRisk, storage,
    getPendingCallLookups: CallSdk.getPendingCallLookups,
    acknowledgeCallLookups: CallSdk.acknowledgeCallLookups,
    retryCallLookups: CallSdk.retryCallLookups,
    isTrustedCaller,
  });

  // ── Text Guard Pipeline (extracted to src/pipelines/textGuardPipeline.ts) ──
  useTextGuardLocalFindings({
    deviceId, eventsRef, persistEvents,
    getTextGuardLocalFindings: MessagingSdk.getTextGuardLocalFindings,
    acknowledgeTextGuardLocalFindings: MessagingSdk.acknowledgeTextGuardLocalFindings,
    onReadFailure: (message) => showToast(message, "growling"),
  });




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

  // Settings "Turn on Site Gate": record intent, ensure VPN consent lands (waits for the system
  // consent screen to return on Android — see ensureAndroidVpnConsent), then start the VPN service
  // and refresh so the Gate flips to "Protection on" immediately, without reopening the app. A
  // decline leaves Apollo in reduced coverage (Site Gate stays "permission required").
  const enableSiteProtection = useCallback(async (): Promise<boolean> => {
    await storage.setItem(K.protection, true);
    const granted = Platform.OS === "android" ? await ensureAndroidVpnConsent() : true;
    if (granted) { try { await securityAdapter.startProtection(); } catch { /* reduced coverage — health check retries */ } }
    await refresh(0, "protection_change");
    return granted;
  }, [refresh]);

  const checkLink = useCallback(async (input: string, scentId?: string): Promise<CheckOutcome> => {
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
    let investigationCaseId: string | null = null;
    // ── Triage Investigation (deterministic, 0 Gemini calls) ──
    const { correlation, existingCaseId } = correlationFor({ indicator: local.host, scentId, mechanics: ["deceptive_link", "download", "malicious_destination"] });
    const triage = evaluateTriage(linkTriageEvidence({
      local, intel, intelError, correlation,
      credentialInteraction: local.signals.some((s) => s.code === "credential_lure" || s.code === "credentials_in_url"),
    }));
    // Tier 2 (Magnum DI) runs ONLY for a deterministic Possible Threat, once per correlated case.
    if (triage.outcome === "POSSIBLE_THREAT_IDENTIFIED") {
      if (existingCaseId) investigationCaseId = existingCaseId;
      else try {
        const remote = await apiPost<{ investigation_case_id?: string | null; verdict?: string; investigation_error?: string | null }>("/link/investigate", "link_investigation", {
          device_id: deviceId ?? undefined, url: local.normalizedUrl, local_state: decision.state,
          local_findings: decision.why.slice(0, 12), claimed_brand: decision.claimed_brand ?? null,
        });
        investigationCaseId = typeof remote.investigation_case_id === "string" ? remote.investigation_case_id : null;
        if (remote.investigation_error) investigationError = remote.investigation_error;
        else if (!investigationCaseId) investigationError = "Apollo asked for a deeper Magnum DI investigation but no case was opened, so no deeper investigation is running.";
      } catch (error) { investigationError = error instanceof Error ? error.message : "Magnum DI could not start the investigation."; }
    }
    // Apollo's deterministic decision stands. Magnum DI investigates asynchronously.
    const isEvent = decision.state !== "resting" || trusted;
    const ev: PatrolEvent = {
      event_id: Crypto.randomUUID(), device_id: deviceId ?? "local", category: intel?.verdict === "malicious" ? "known_threat" : "link",
      state: decision.state, status: decision.state === "resting" ? "resolved" : "active",
      headline: decision.headline,
      what_happened: patrolSafeSummary(decision.what_happened),
      why: decision.why,
      what_to_do: decision.what_to_do,
      indicator_host: intel?.final_url ? (intel.redirect_chain?.[intel.redirect_chain.length - 1] ?? local.host) : local.host, indicator_digest: digest, local_indicator: indicator, verified_block: false, adapter_label: securityAdapter.label,
      occurred_at: new Date().toISOString(), resolved_at: decision.state === "resting" ? new Date().toISOString() : null, trust_allowed: decision.trust_allowed,
      claimed_brand: decision.claimed_brand ?? null,
      investigation_case_id: investigationCaseId,
      triage_investigation: triage,
      // Scent handoff: when checkLink is invoked from a message flow, the caller provides the
      // message event's scent_id so that findScentFor can discover the correlation.
      ...(scentId ? { scent_id: scentId } : {}),
    };
    if (isEvent || decision.state === "resting") await upsertEvent(ev, { kind: "link", url: input }); // resting checks are still traceable in Patrol
    void markCheckDone("link");
    // When Link Gate confirms a malicious domain, trigger an urgent rule refresh so Site Gate
    // can pick up any new rules derived from this intelligence as soon as possible.
    if (intel?.verdict === "malicious" && securityAdapter.triggerUrgentRuleRefresh) {
      securityAdapter.triggerUrgentRuleRefresh().catch((error) => {
        // Website protection did not take the new intelligence early; the periodic refresh still applies.
        recordNativeFailure("triggerUrgentRuleRefresh", error instanceof Error ? error.message : String(error));
      });
    }
    return { submissionId: ev?.event_id ?? Crypto.randomUUID(), local, intel, intelError, decision, assessment, investigationError, event: ev };
  }, [correlationFor, deviceId, trust, upsertEvent]);

  const blockEvent = useCallback(async (event: PatrolEvent) => {
    const host = event.indicator_host ?? "";
    const result = await securityAdapter.blockDestination(host);
    // A manual "Block" tap can only ever REQUEST a block and confirm the rule is now active
    // ("operational") — it can never claim a VERIFIED block by itself, so this must never move an
    // event to "biting" / THREAT_BLOCKED on its own. Only an actually-observed dropped connection
    // (see syncEnforcementEvidence, driven by real EnforcementEvidence) may do that. isVerifiedEnforcement()
    // below is always false for tap-driven evidence today — kept as the single defensive gate so that
    // guarantee can never silently change without this line catching it.
    //
    // iOS Safari Content Blocker: the native module returns verified=false because Safari does not
    // confirm individual matches. However, when rulesState="prepared" and (reloadState="reload_requested"
    // with activeState="enabled_match_unobservable"), the rules have been accepted by Safari — this is
    // a successful rule installation even though match verification is architecturally impossible.
    const nativeResult = result as unknown as Record<string, unknown>;
    const rulesPrepared = nativeResult.rulesState === "prepared";
    const reloadAccepted = nativeResult.reloadState === "reload_requested";
    const extensionEnabled = nativeResult.activeState === "enabled_match_unobservable";
    const iosRulesAccepted = rulesPrepared && reloadAccepted && extensionEnabled;
    if (result.verified || iosRulesAccepted) {
      const iosNote = iosRulesAccepted && !result.verified
        ? " Safari accepted the rule but cannot confirm individual matches."
        : "";
      await upsertEvent({ ...event, status: "active", verified_block: false, adapter_label: result.adapterLabel, why: [...event.why, result.detail],
        what_to_do: `Apollo has put a block in place for this destination.${iosNote} This card will update the moment Apollo actually sees and stops a connection attempt to it.`,
        enforcement_evidence: null });
      showToast(`Block rule active for ${host}. Apollo will confirm once it sees a connection.`, "barking");
    } else if (rulesPrepared) {
      // Rules are prepared but the Safari extension may not be enabled, or reload failed.
      // This is better than "could not verify" — the rules exist, just not fully active.
      const limitation = nativeResult.activeState === "not_enabled"
        ? "Enable Apollo's Safari extension in Settings > Safari > Extensions."
        : nativeResult.reloadState === "reload_failed"
          ? "The rule list is prepared but Safari could not reload it. Try again."
          : "The rule is prepared but Apollo cannot confirm it is active.";
      await upsertEvent({ ...event, state: "barking", status: "active", verified_block: false,
        adapter_label: result.adapterLabel, why: [...event.why, result.detail],
        what_to_do: limitation, enforcement_evidence: null });
      showToast(limitation, "barking");
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
    const resolvedAt = new Date().toISOString();
    // Resolve the tapped event AND all scent-linked siblings (same logical incident), plus earlier
    // checks filed on the same case (same case_key) — closing a case closes every check in it.
    // Without this, marking one copy as contained leaves identical-looking duplicates active.
    const siblings = eventsRef.current.filter((e) => !e.resolved_at && e.event_id !== event.event_id &&
      ((!!event.scent_id && e.scent_id === event.scent_id) || (!!event.case_key && e.case_key === event.case_key)));
    await upsertEvent({ ...event, status: "resolved", resolved_at: resolvedAt });
    for (const sib of siblings) await upsertEvent({ ...sib, status: "resolved", resolved_at: resolvedAt });
    showToast(event.category === "device"
      ? "Device check closed. Rechecking your device files a new check on this case."
      : "Marked as handled. Apollo will rest after a fresh check.", "neutral");
  }, [showToast, upsertEvent]);

  // Undo "contained/handled": reopen locally and on the server (PATCH reopen clears resolved_at).
  const reopenEvent = useCallback(async (event: PatrolEvent) => {
    const status = event.state === "biting" && event.verified_block ? "blocked" : "active";
    const reopened = {
      ...event, status, resolved_at: null, reopened_at: new Date().toISOString(),
      // Keep the moment it was closed so History still records the resolution it had.
      previously_resolved_at: event.resolved_at ?? event.previously_resolved_at ?? null,
    } as PatrolEvent;
    await persistEvents([reopened, ...eventsRef.current.filter((x) => x.event_id !== event.event_id)]);
    if (deviceId && (event.device_id === "local" || event.device_id === deviceId)) {
      try { await apiPatch(`/patrol/events/${event.event_id}?device_id=${deviceId}`, { reopen: true, status }); }
      catch { void syncEvent(reopened); }
    }
    showToast("Case reopened.", "neutral");
  }, [deviceId, persistEvents, showToast, syncEvent]);

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

  // Delete My Apollo Data — permanently erase everything for this device on the service, then wipe this
  // phone and return to a true first-run state. Honest offline behaviour: if the service can't be reached,
  // nothing is wiped; a pending request is recorded and retried automatically when Apollo reconnects.
  const requestDataDeletion = useCallback(async (): Promise<{ ok: boolean; pending?: boolean; result?: DeleteDataResult }> => {
    let result: DeleteDataResult;
    try {
      result = await apiPostEmpty<DeleteDataResult>("/devices/delete-data", Crypto.randomUUID());
    } catch {
      await storage.setItem(PENDING_DELETE_KEY, true);
      return { ok: false, pending: true };
    }
    // Server records are gone. Now wipe this phone and reset the in-memory app state to first run.
    try { await wipeLocalApolloData(); } catch { /* best effort — the service copy is already gone */ }
    await clearDeviceIdentity();
    eventsRef.current = [];
    setEvents([]); setTrust([]); setTrustedSsids([]); setLastVerifiedAt(null);
    setDeviceId(null); setSetupDone(false); setIdentityReset(null);
    qc.clear();
    return { ok: true, result };
  }, [qc]);

  // If a delete was requested while offline, retry it the moment Apollo reconnects.
  useEffect(() => {
    const off = onBackendHealth((h) => {
      if (h.reachable === true) void storage.getItem<boolean>(PENDING_DELETE_KEY, false).then((pending) => { if (pending) void requestDataDeletion(); });
    });
    return off;
  }, [requestDataDeletion]);

  const visibility = useMemo(() => visibilityFrom(capabilities, freshObservation(protection)), [capabilities, protection, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const platformCanEnforce = useMemo(() => capabilities.some((c) => c.id === "site_guard" && c.status !== "unsupported"), [capabilities]);
  const resolution = useMemo(() => resolveApolloState({ events, visibility, lastVerifiedAt, platformCanEnforce, now: Date.now() }), [events, visibility, lastVerifiedAt, platformCanEnforce, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const value: ApolloContextValue = {
    ready, setupDone, deviceId, identityReset, reRegisterDevice, completeSetup, capabilities, protection, permissions, network, adapterLabel: securityAdapter.label, isMock: IS_PREVIEW_HARNESS,
    privateDnsStatus,
    refreshing, refresh, verifyNow, lastVerifiedAt, toggleProtection, requestPermission, enableSiteProtection, events, trust, resolution, checkLink, blockEvent, trustEvent, resolveEvent, reopenEvent, revokeTrust, clearPatrol, requestDataDeletion, trustedSsids, trustNetwork, forgetNetwork, toast, showToast, checkMessage, scanGmailInbox, recordRecovery, upsertEvent, checkCall, checkNumberRisk,
    notificationStatus, enableNotifications, quietHours, quietNow, setQuietHours, lowPower, setLowPower, storage,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApollo() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApollo must be used inside ApolloProvider");
  return v;
}
