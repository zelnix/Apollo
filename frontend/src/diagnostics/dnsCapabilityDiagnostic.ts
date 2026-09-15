// Gate Guard — out-of-band Private DNS (DoT) / app-embedded DoH capability characterization.
//
// COMPLETELY SEPARATE from the frozen M2.1 Phase 6A acceptance harness
// (src/harness/phase6AutomatedHarness.ts). This file does not import from, is not imported by, and
// does not affect any M2.1 acceptance row, verdict, or the frozen rule bundle's behavior. It exists
// purely to OBSERVE and RECORD whether Apollo's plaintext-UDP/53 DNS interception sees a given probe
// query. It never enforces, mitigates, blocks port 853, detects encrypted DNS heuristically, or
// changes any routing/blocking behavior; this milestone is observational only.
//
// Uses its OWN dedicated ruleset (gd-m2-dns-diagnostic-wizard, see
// backend/scripts/create_dns_diagnostic_wizard_ruleset.py) -- deliberately NOT the frozen M2.1
// gd-m2-website-gate v4 bundle. This file never signs, modifies, or re-publishes any rule bundle.
//
// Physical-device review fix: every row used to reprobe the SAME shared hostname
// (dnsprobe.blocktest.btciq.app, M2.1's frozen row-4.1 host), which risked the OS/DNS resolver
// caching an earlier row's genuine bypass resolution and silently reusing it for a LATER row --
// making that later row look like a bypass with no fresh DNS query actually happening. Each of the
// 4 automated/polling rows now gets its own never-reused hostname (dnsprobe2-5.blocktest.btciq.app,
// confirmed real/provisioned by the domain operator 2026-09) so cross-row cache reuse is
// structurally impossible for those rows. "dot-off" deliberately keeps reusing the original
// dnsprobe.blocktest.btciq.app (domain operator's explicit choice, since a 5th net-new host wasn't
// provisioned) -- accepted risk: if a prior M2.1 Phase 6A run resolved that host, "dot-off"'s own
// probe could observe a stale cached answer rather than a fresh over-the-wire lookup. This is the
// only row where that risk applies; see ROW_PROBE_IDENTITY below.
//
// Same strict-attribution principle the M2.1 freeze required for row 4.1 (see PRD): a genuine
// THREAT_BLOCKED event only ever counts as evidence for a probe when its own `host` + `ruleId`
// match THAT probe's own dedicated target -- never inferred from a shared/global enforcement
// counter, and BYPASSED is only ever concluded from independent proof of success, never absence
// alone. Additionally (physical-device review fix): a row's truth-of-state snapshot is now a HARD
// classification gate, not just an informational note -- see evaluateTruthGate/classify below.
import * as Network from "expo-network";
import { Platform } from "react-native";

import { isGenuineBlockedEvent, type SecurityEvent } from "@/src/contracts/securityEventSchemas";
import type { RuleEntry } from "@/src/contracts/shared/ruleBundle";
import { captureDnsDiagnosticTruthSnapshot, describePrivateDnsRuntimeMode, type DnsDiagnosticTruthSnapshot } from "@/src/diagnostics/dnsCapabilityTruthSnapshot";
import { fetchLatestBundle, fetchM1Config, toProtectionConfig } from "@/src/harness/ruleBundleFixtures";
import { GuardDogSecuritySDK } from "@/src/sdk/GuardDogSecuritySDK";
import { GuardDogNative, type NativeDnsCapabilityDeviceSnapshot, type PrivateDnsRuntimeMode } from "@/src/sdk/nativeModule";

/** The wizard's OWN dedicated ruleset -- deliberately separate from gd-m2-website-gate (frozen at
 * v4 for M2.1) so this tool's per-row probe rules never touch or version-bump that frozen bundle. */
export const DNS_DIAGNOSTIC_WIZARD_RULESET_ID = "gd-m2-dns-diagnostic-wizard";

export type WizardRowId = "dot-off" | "dot-automatic" | "dot-strict" | "doh-off" | "doh-on";

export interface RowProbeIdentity {
  host: string;
  ruleId: string;
}

/** One dedicated, never-reused hostname per row (dot-off intentionally excepted -- see file-header
 * comment: it reuses the pre-existing dnsprobe.blocktest.btciq.app by explicit domain-operator
 * choice). All hosts confirmed real/provisioned 2026-09. */
export const ROW_PROBE_IDENTITY: Record<WizardRowId, RowProbeIdentity> = {
  "dot-off": { host: "dnsprobe.blocktest.btciq.app", ruleId: "m2-dns-wizard-dot-off-001" },
  "dot-automatic": { host: "dnsprobe2.blocktest.btciq.app", ruleId: "m2-dns-wizard-dot-automatic-001" },
  "dot-strict": { host: "dnsprobe3.blocktest.btciq.app", ruleId: "m2-dns-wizard-dot-strict-001" },
  "doh-off": { host: "dnsprobe4.blocktest.btciq.app", ruleId: "m2-dns-wizard-doh-off-001" },
  "doh-on": { host: "dnsprobe5.blocktest.btciq.app", ruleId: "m2-dns-wizard-doh-on-001" },
};

export type DnsDiagnosticCategory = "private-dns" | "app-embedded-doh";
export type DnsDiagnosticClassification = "CAPTURED" | "BYPASSED" | "UNOBSERVABLE" | "NOT_TESTABLE";

/** Exact, user-approved plain-language labels. The underlying classification enum (used by every
 * evidence rule elsewhere in this file) is never renamed or weakened -- this is presentation only. */
export const CLASSIFICATION_LABELS: Record<DnsDiagnosticClassification, string> = {
  CAPTURED: "Apollo is biting — the request was observed and stopped",
  BYPASSED: "This encrypted DNS request bypassed Apollo's DNS visibility",
  UNOBSERVABLE: "Apollo couldn't prove what happened",
  NOT_TESTABLE: "This check couldn't be run",
};

export interface DnsDiagnosticRecord {
  id: string;
  category: DnsDiagnosticCategory;
  /** Machine-derived label (from the native Private DNS snapshot) for private-dns rows; a
   * tester-supplied browser/version + DoH setting for app-embedded-doh rows (Android exposes
   * neither the browser identity nor its DoH setting to a third-party app, so that half stays
   * descriptive metadata -- never treated as evidence). */
  configurationLabel: string;
  probeHostname: string;
  transportNetworkType: string | null;
  sawPlaintextUdp53: boolean;
  websiteGateEventProduced: boolean;
  attributedEvent: SecurityEvent | null;
  independentSuccess: boolean | null;
  independentSuccessSource: "in-app-fetch" | "controlled-server-receipt" | "not-applicable";
  classification: DnsDiagnosticClassification;
  notes: string | null;
  probeStartedAt: string;
  probeEndedAt: string;
  /** Full machine-observed truth-of-state at the moment this specific probe ran. */
  truthSnapshot: DnsDiagnosticTruthSnapshot;
}

// --- Guided wizard step configuration + automated Private DNS runtime-mode polling ---

export interface DotWizardStepConfig {
  id: "dot-off" | "dot-automatic" | "dot-strict";
  title: string;
  settingsInstruction: string;
  /** null for "dot-off": Android's public API can NEVER prove "Off" was selected --
   * INACTIVE_OR_OFF is equally consistent with "Automatic" whose opportunistic probe is currently
   * inactive. So this row is never auto-polled-to-match; the tester explicitly confirms their OWN
   * selection instead, and Apollo records the machine-observed state honestly alongside it -- see
   * runPrivateDnsProbeForStep. Never displayed as "Off verified". */
  targetRuntimeMode: PrivateDnsRuntimeMode | null;
}

export const DOT_WIZARD_STEPS: DotWizardStepConfig[] = [
  {
    id: "dot-off",
    title: "Private DNS — Off",
    settingsInstruction: 'In Android Settings → Network & internet → Private DNS, choose "Off".',
    targetRuntimeMode: null,
  },
  {
    id: "dot-automatic",
    title: "Private DNS — Automatic",
    settingsInstruction: 'In Android Settings → Network & internet → Private DNS, choose "Automatic".',
    targetRuntimeMode: "ACTIVE_NO_HOSTNAME",
  },
  {
    id: "dot-strict",
    title: "Private DNS — Strict hostname",
    settingsInstruction: 'In Android Settings → Network & internet → Private DNS, choose "Private DNS provider hostname", enter a provider (e.g. dns.google), then Save.',
    targetRuntimeMode: "STRICT",
  },
];

export interface PrivateDnsPollTick {
  elapsedMs: number;
  snapshot: NativeDnsCapabilityDeviceSnapshot | null;
}

export interface PrivateDnsPollResult {
  outcome: "matched" | "timed-out" | "cancelled" | "unavailable";
  finalSnapshot: NativeDnsCapabilityDeviceSnapshot | null;
  elapsedMs: number;
}

/** Hard ceiling: after this, polling stops and the wizard offers Retry / Open Settings again /
 * Record NOT_TESTABLE -- deliberately NEVER a "Continue anyway" that would let an unverified
 * configuration be labelled as though it were established. */
export const PRIVATE_DNS_POLL_HARD_TIMEOUT_MS = 90_000;
/** Purely a UI hint ("Still checking…") -- changes no polling behavior. */
export const PRIVATE_DNS_POLL_STILL_CHECKING_AFTER_MS = 15_000;
const PRIVATE_DNS_POLL_INTERVAL_MS = 2_000;

/** Polls the native Private DNS runtime snapshot until it matches `targetMode` or the hard timeout
 * elapses. Never resolves "matched" on anything other than a genuine, freshly-read match. */
export function pollForPrivateDnsRuntimeMode(
  targetMode: PrivateDnsRuntimeMode,
  opts: { hardTimeoutMs?: number; intervalMs?: number; onTick?: (tick: PrivateDnsPollTick) => void; isCancelled?: () => boolean } = {},
): Promise<PrivateDnsPollResult> {
  const hardTimeoutMs = opts.hardTimeoutMs ?? PRIVATE_DNS_POLL_HARD_TIMEOUT_MS;
  const intervalMs = opts.intervalMs ?? PRIVATE_DNS_POLL_INTERVAL_MS;
  const startedAt = Date.now();
  return new Promise((resolve) => {
    function tick() {
      if (opts.isCancelled?.()) {
        resolve({ outcome: "cancelled", finalSnapshot: null, elapsedMs: Date.now() - startedAt });
        return;
      }
      if (Platform.OS !== "android" || !GuardDogNative) {
        resolve({ outcome: "unavailable", finalSnapshot: null, elapsedMs: Date.now() - startedAt });
        return;
      }
      const snapshot = GuardDogNative.getDnsCapabilityDeviceSnapshot();
      const elapsedMs = Date.now() - startedAt;
      opts.onTick?.({ elapsedMs, snapshot });
      if (snapshot.privateDnsRuntimeMode === targetMode) {
        resolve({ outcome: "matched", finalSnapshot: snapshot, elapsedMs });
        return;
      }
      if (elapsedMs >= hardTimeoutMs) {
        resolve({ outcome: "timed-out", finalSnapshot: snapshot, elapsedMs });
        return;
      }
      setTimeout(tick, intervalMs);
    }
    tick();
  });
}

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

const nowIso = () => new Date().toISOString();

export async function getNetworkType(): Promise<string | null> {
  try {
    const state = await Network.getNetworkStateAsync();
    return state.type ?? null;
  } catch {
    return null;
  }
}

function isAttributedToProbe(event: SecurityEvent | null, host: string, ruleId: string): boolean {
  return !!event && isGenuineBlockedEvent(event) && (event.host ?? "").toLowerCase() === host.toLowerCase() && event.ruleId === ruleId;
}

/** Physical-device review fix: a row must never be labelled CAPTURED/BYPASSED if the environment it
 * ran under cannot itself be trusted -- these conditions are now a HARD classification gate
 * (forces NOT_TESTABLE), not merely an informational note attached to an otherwise-normal verdict. */
function evaluateTruthGate(truthSnapshot: DnsDiagnosticTruthSnapshot, extraReasons: string[]): string[] {
  const reasons = [...extraReasons];
  if (!truthSnapshot.nativeAvailable) {
    reasons.push("Native module unavailable at probe time (Expo Go / web).");
    return reasons; // nothing else here is meaningfully checkable without native
  }
  if (truthSnapshot.protectionState !== "ACTIVE") reasons.push(`Protection state was '${truthSnapshot.protectionState}' at probe time, not ACTIVE.`);
  if (truthSnapshot.tunOpen === false) reasons.push("Native TUN was reportedly closed at probe time.");
  if (truthSnapshot.dnsGatewayActive === false) reasons.push("Website Gate DNS gateway was reportedly inactive at probe time.");
  if (truthSnapshot.probeRuleConfirmedInBundle === false) reasons.push("The dedicated probe rule was not confirmed present in the accepted diagnostic bundle.");
  return reasons;
}

function classify(
  attributedEvent: SecurityEvent | null,
  independentSuccess: boolean | null,
  truthSnapshot: DnsDiagnosticTruthSnapshot,
  extraGateReasons: string[] = [],
): { classification: DnsDiagnosticClassification; gateReasons: string[] } {
  const gateReasons = evaluateTruthGate(truthSnapshot, extraGateReasons);
  if (gateReasons.length > 0) return { classification: "NOT_TESTABLE", gateReasons };
  if (attributedEvent) return { classification: "CAPTURED", gateReasons: [] };
  if (independentSuccess === true) return { classification: "BYPASSED", gateReasons: [] }; // absence of capture alone is NEVER treated as a bypass -- never guessed.
  return { classification: "UNOBSERVABLE", gateReasons: [] };
}

function unrelatedEventNote(event: SecurityEvent | null, attributedEvent: SecurityEvent | null, host: string): string | null {
  return event && !attributedEvent ? `A genuine THREAT_BLOCKED arrived during this window for a different host/rule than ${host} -- unrelated leftover traffic, correctly excluded from this probe's own evidence.` : null;
}

/** Self-contained (deliberately NOT importing src/harness/* observation helpers, to keep this tool
 * fully independent of the frozen acceptance harness): subscribes before `action` runs, resolves
 * with the first genuine THREAT_BLOCKED seen within `windowMs`, or null if none arrived. */
function observeWindow(action: () => Promise<void> | void, windowMs: number): Promise<SecurityEvent | null> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      unsubscribe();
      resolve(null);
    }, windowMs);
    const unsubscribe = GuardDogSecuritySDK.onSecurityEvent((event) => {
      if (settled || !isGenuineBlockedEvent(event)) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(event);
    });
    void action();
  });
}

async function fetchProbeHost(host: string, timeoutMs: number): Promise<{ outcome: "resolved" | "network-error" | "timeout"; httpStatus: number | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`https://${host}/`, { method: "GET", signal: controller.signal });
    return { outcome: "resolved", httpStatus: res.status };
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    return { outcome: aborted ? "timeout" : "network-error", httpStatus: null };
  } finally {
    clearTimeout(timer);
  }
}

/** Automated probe for Android system Private DNS (DoT) configurations. For "dot-automatic"/
 * "dot-strict", called only once `pollForPrivateDnsRuntimeMode` has already confirmed the device is
 * in the step's target runtime mode. For "dot-off" (`targetRuntimeMode === null`), called once the
 * tester has manually confirmed THEY selected Off in Android Settings -- there is no machine-provable
 * target to poll for. `configurationLabel` is derived ENTIRELY from a fresh native snapshot taken at
 * probe time (never from an earlier poll match, and never manually typed). Physical-device review
 * fixes applied here: (1) drift between detection and execution, and (2) an "Off" claim that the
 * machine observes as definitely NOT off, both now HARD-gate the row to NOT_TESTABLE via classify()
 * instead of merely adding a note. */
export async function runPrivateDnsProbeForStep(step: DotWizardStepConfig, probeRuleConfirmedInBundle: boolean | null, windowMs = 12_000): Promise<DnsDiagnosticRecord> {
  const identity = ROW_PROBE_IDENTITY[step.id];
  const probeStartedAt = nowIso();
  const truthSnapshot = await captureDnsDiagnosticTruthSnapshot(probeRuleConfirmedInBundle);
  const transportNetworkType = await getNetworkType();
  let fetchOutcome: Awaited<ReturnType<typeof fetchProbeHost>> | null = null;
  const event = await observeWindow(async () => {
    fetchOutcome = await fetchProbeHost(identity.host, Math.min(windowMs, 8000));
  }, windowMs);
  const attributedEvent = isAttributedToProbe(event, identity.host, identity.ruleId) ? event : null;
  const independentSuccess = (fetchOutcome as { outcome: string } | null)?.outcome === "resolved";
  const observedMode = truthSnapshot.privateDnsRuntimeMode;

  const extraGateReasons: string[] = [];
  if (step.targetRuntimeMode === null) {
    // "Off" row: never machine-provable (see file header). If the machine observes a state that IS
    // definitely inconsistent with Off (genuinely active encrypted DNS), that is a real
    // contradiction with the tester's claim -- not just a labelling nuance.
    if (observedMode === "STRICT" || observedMode === "ACTIVE_NO_HOSTNAME") {
      extraGateReasons.push(
        `Tester indicated Private DNS was set to Off, but the machine observed '${observedMode}' at probe time, which is inconsistent with Off -- this row's evidence cannot be trusted under the claimed configuration.`,
      );
    }
  } else if (observedMode !== "UNAVAILABLE" && observedMode !== step.targetRuntimeMode) {
    extraGateReasons.push(`Runtime state drifted between detection and probe execution -- expected ${step.targetRuntimeMode}, observed ${observedMode} at probe time.`);
  }

  const { classification, gateReasons } = classify(attributedEvent, independentSuccess, truthSnapshot, extraGateReasons);
  const machineObserved = describePrivateDnsRuntimeMode(observedMode, truthSnapshot.privateDnsServerName);
  const configurationLabel = step.targetRuntimeMode === null ? `${step.title} (tester-selected). Machine observed: ${machineObserved}` : `${step.title}: ${machineObserved}`;

  return {
    id: `dot-${Date.now()}`,
    category: "private-dns",
    configurationLabel,
    probeHostname: identity.host,
    transportNetworkType,
    sawPlaintextUdp53: !!attributedEvent,
    websiteGateEventProduced: !!attributedEvent,
    attributedEvent,
    independentSuccess,
    independentSuccessSource: "in-app-fetch",
    classification,
    notes: [unrelatedEventNote(event, attributedEvent, identity.host), gateReasons.length > 0 ? `NOT_TESTABLE reason(s): ${gateReasons.join(" ")}` : null].filter((n): n is string => !!n).join(" ") || null,
    probeStartedAt,
    probeEndedAt: nowIso(),
    truthSnapshot,
  };
}

/** App-embedded DoH (e.g. a browser's own built-in DoH) cannot be triggered by this app, and the M2.1
 * freeze's own lesson applies here too: a manually-reported "the page looked like it loaded"
 * judgment is not strong enough evidence to support a machine BYPASSED verdict -- it reintroduces
 * exactly the human interpretation the freeze worked to remove. Instead, each probe gets a unique
 * nonce; the tester opens the dedicated probe URL (see buildDohProbeUrl) in the target browser,
 * whose page independently calls the backend's receipt endpoint client-side. Apollo's own attributed
 * event stream AND the server-confirmed receipt are both evidence this tool observes itself -- never
 * a tester's subjective judgment call. */
export function generateProbeNonce(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** The exact URL the tester opens in the target browser for a given row's dedicated host. See
 * docs/dns-capability-characterization.md for the static asset that must be hosted at each
 * already-DNS/TLS-provisioned host to serve it and report the receipt -- this app does not, and
 * cannot, host that page itself (it must be reachable at the SAME hostname Apollo's dedicated rule
 * matches, independent of this app). */
export function buildDohProbeUrl(host: string, nonce: string): string {
  return `https://${host}/dnsdiag/?n=${nonce}`;
}

/** Polls the backend receipt endpoint until it confirms the nonce arrived, or `deadlineMs` elapses.
 * A transient network hiccup while polling is retried, never treated as a definitive "not received." */
async function pollReceipt(nonce: string, deadlineMs: number, intervalMs = 2000): Promise<boolean> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BACKEND_URL}/api/dns-diagnostics/receipts/${nonce}`, { cache: "no-store" });
      if (res.ok) {
        const body = (await res.json()) as { received: boolean };
        if (body.received) return true;
      }
    } catch {
      // transient network hiccup while polling -- keep trying until the deadline instead of giving up.
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

/** Starts listening for a genuine, attributed THREAT_BLOCKED (for this row's dedicated host+ruleId)
 * the moment the tester is about to open the probe URL in the target browser. Call the returned
 * `finish()` once the tester is back in this app (or let it auto-expire after `maxWindowMs`) -- it
 * does one final short receipt poll before resolving, since the beacon fetch on the probe page
 * completes almost instantly on page load. */
export function startAppEmbeddedDohObservation(
  host: string,
  ruleId: string,
  nonce: string,
  maxWindowMs = 120_000,
): { startedAt: string; finish: () => Promise<{ event: SecurityEvent | null; receiptConfirmed: boolean }> } {
  const startedAt = nowIso();
  let settled = false;
  let capturedEvent: SecurityEvent | null = null;
  const hardTimer = setTimeout(() => {
    settled = true;
    unsubscribe();
  }, maxWindowMs);
  const unsubscribe = GuardDogSecuritySDK.onSecurityEvent((event) => {
    if (settled || capturedEvent || !isAttributedToProbe(event, host, ruleId)) return;
    capturedEvent = event; // keep the first attributed hit; later unrelated noise is ignored anyway.
  });
  return {
    startedAt,
    finish: async () => {
      if (!settled) {
        settled = true;
        clearTimeout(hardTimer);
        unsubscribe();
      }
      // A short final grace poll -- covers the case where the tester already saw the page load and
      // is now just tapping "Finish", plus a small margin for network jitter on the beacon call.
      const receiptConfirmed = await pollReceipt(nonce, 5000, 1000);
      return { event: capturedEvent, receiptConfirmed };
    },
  };
}

/** Builds the record for an app-embedded DoH probe from ONLY machine-observed evidence: Apollo's own
 * attributed event stream, and the backend's independent, server-verified receipt confirmation --
 * never a manually-reported judgment call. `truthSnapshot` must be captured by the caller
 * immediately before `Linking.openURL` was fired, so it reflects the exact state the probe ran under.
 * Physical-device review fix: if Apollo BOTH recorded a genuine attributed block AND the probe
 * page's server receipt independently confirmed arrival, that is a logical contradiction (a
 * genuinely blocked request could never reach the page to fire its receipt beacon) -- this is now
 * gated to NOT_TESTABLE via classify() rather than ever being displayed as CAPTURED. */
export function buildAppEmbeddedDohRecord(
  configurationLabel: string,
  host: string,
  ruleId: string,
  nonce: string,
  event: SecurityEvent | null,
  receiptConfirmed: boolean,
  probeStartedAt: string,
  transportNetworkType: string | null,
  truthSnapshot: DnsDiagnosticTruthSnapshot,
): DnsDiagnosticRecord {
  const attributedEvent = isAttributedToProbe(event, host, ruleId) ? event : null;
  const contradictionReasons: string[] = [];
  if (attributedEvent && receiptConfirmed) {
    contradictionReasons.push(
      "Contradiction: Apollo recorded an attributed block AND the probe page's server receipt confirmed independently -- these cannot both be genuine, so this row cannot be trusted as CAPTURED.",
    );
  }
  // If Apollo captured/blocked it, the receipt should never have arrived at all (the request never
  // reached the probe page) -- independentSuccess is only meaningful when there was nothing to capture.
  const independentSuccess = attributedEvent ? null : receiptConfirmed;
  const { classification, gateReasons } = classify(attributedEvent, independentSuccess, truthSnapshot, contradictionReasons);
  return {
    id: `doh-${Date.now()}`,
    category: "app-embedded-doh",
    configurationLabel,
    probeHostname: buildDohProbeUrl(host, nonce),
    transportNetworkType,
    sawPlaintextUdp53: !!attributedEvent,
    websiteGateEventProduced: !!attributedEvent,
    attributedEvent,
    independentSuccess,
    independentSuccessSource: attributedEvent ? "not-applicable" : "controlled-server-receipt",
    classification,
    notes: [unrelatedEventNote(event, attributedEvent, host), gateReasons.length > 0 ? `NOT_TESTABLE reason(s): ${gateReasons.join(" ")}` : null].filter((n): n is string => !!n).join(" ") || null,
    probeStartedAt,
    probeEndedAt: nowIso(),
    truthSnapshot,
  };
}

/** For preconditions that could not be met at all (e.g. native module unavailable, gate not active,
 * or Private DNS detection timed out and the tester chose not to retry) -- an explicit NOT_TESTABLE
 * record, never silently skipped and never guessed as UNOBSERVABLE. */
export function notTestableRecord(category: DnsDiagnosticCategory, configurationLabel: string, reason: string, truthSnapshot: DnsDiagnosticTruthSnapshot, probeHostname = "n/a"): DnsDiagnosticRecord {
  const at = nowIso();
  return {
    id: `nt-${Date.now()}`,
    category,
    configurationLabel,
    probeHostname,
    transportNetworkType: null,
    sawPlaintextUdp53: false,
    websiteGateEventProduced: false,
    attributedEvent: null,
    independentSuccess: null,
    independentSuccessSource: "not-applicable",
    classification: "NOT_TESTABLE",
    notes: reason,
    probeStartedAt: at,
    probeEndedAt: at,
    truthSnapshot,
  };
}

export interface ActivationResult {
  ok: boolean;
  reason: string | null;
  /** True iff the fetched, currently-accepted DIAGNOSTIC WIZARD bundle (gd-m2-dns-diagnostic-wizard
   * -- NOT the production gd-m2-website-gate bundle) genuinely carries all 5 dedicated per-row
   * probe rules -- confirms every row's evidence will be attributable before any probe is run. */
  probeRuleConfirmedInBundle: boolean;
  /** Full machine-observed truth-of-state snapshot taken at the end of Preflight. Carried forward
   * as the `probeRuleConfirmedInBundle` baseline for every later per-row snapshot this session. */
  preflightSnapshot: DnsDiagnosticTruthSnapshot;
}

/** Activates protection + the Website Gate using ONLY the stable public GuardDogSecuritySDK surface
 * (requestPermission -> configure -> startProtection -> configureWebsiteGate -> accept the live
 * signed gd-m2-dns-diagnostic-wizard bundle -> hydrate overrides) -- the same public calls the M2.1
 * harness uses for its own (different, frozen) bundle, but implemented fresh here so this tool has
 * zero code-level dependency on phase6AutomatedHarness.ts. Never signs or publishes a bundle; only
 * reads the currently-live one. Deliberately accepts the WIZARD's own dedicated ruleset here, NOT
 * the production gd-m2-website-gate bundle -- see DNS_DIAGNOSTIC_WIZARD_RULESET_ID. */
export async function activateWebsiteGateForDiagnostics(): Promise<ActivationResult> {
  const fail = async (reason: string): Promise<ActivationResult> => ({ ok: false, reason, probeRuleConfirmedInBundle: false, preflightSnapshot: await captureDnsDiagnosticTruthSnapshot(false) });
  if (!GuardDogSecuritySDK.nativeAvailable) return fail("NATIVE_MODULE_UNAVAILABLE (Expo Go / web -- a native Android build is required)");
  const permission = await GuardDogSecuritySDK.requestPermission("vpn");
  if (permission !== "granted") return fail(`VPN_PERMISSION_${permission.toUpperCase()}`);
  const m1Config = await fetchM1Config();
  GuardDogSecuritySDK.configure(toProtectionConfig(m1Config));
  const status = await GuardDogSecuritySDK.startProtection();
  if (status.state !== "ACTIVE") return fail(`PROTECTION_NOT_ACTIVE (state=${status.state})`);
  GuardDogSecuritySDK.configureWebsiteGate({});
  const bundle = await fetchLatestBundle(DNS_DIAGNOSTIC_WIZARD_RULESET_ID);
  const acceptance = GuardDogSecuritySDK.acceptWebsiteGateRuleBundle(bundle);
  if (!acceptance.accepted) return fail(`BUNDLE_REJECTED (${acceptance.rejectReason})`);
  await GuardDogSecuritySDK.hydrateWebsiteGateOverrides();
  const gateStatus = GuardDogSecuritySDK.getWebsiteGateStatus();
  if (!gateStatus.dnsGatewayActive) return fail("DNS_GATEWAY_NOT_ACTIVE");
  const rules = bundle.payload.rules as RuleEntry[];
  const probeRuleConfirmedInBundle = Object.values(ROW_PROBE_IDENTITY).every((identity) => rules.some((r) => r.host === identity.host && r.ruleId === identity.ruleId && r.action === "block"));
  const preflightSnapshot = await captureDnsDiagnosticTruthSnapshot(probeRuleConfirmedInBundle);
  return { ok: true, reason: null, probeRuleConfirmedInBundle, preflightSnapshot };
}
