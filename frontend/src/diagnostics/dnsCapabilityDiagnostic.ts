// Gate Guard — out-of-band Private DNS (DoT) / app-embedded DoH capability characterization.
//
// COMPLETELY SEPARATE from the frozen M2.1 Phase 6A acceptance harness
// (src/harness/phase6AutomatedHarness.ts). This file does not import from, is not imported by, and
// does not affect any M2.1 acceptance row, verdict, or the frozen rule bundle's behavior. It exists
// purely to OBSERVE and RECORD -- under a device configuration the tester sets and labels manually
// (Android does not expose Private DNS mode or another app's DoH setting to a third-party app) --
// whether Apollo's plaintext-UDP/53 DNS interception sees a given probe query. It never enforces,
// mitigates, blocks port 853, detects encrypted DNS heuristically, or changes any routing/blocking
// behavior; this milestone is observational only.
//
// Reuses the dedicated, already-signed M2.1 rule (m2-block-dns-capability-001 ->
// dnsprobe.blocktest.btciq.app, live in gd-m2-website-gate v4, frozen) purely as a READ-ONLY
// observation target -- this file never signs, modifies, or re-publishes any rule bundle, and never
// bumps the bundle version the M2.1 freeze is pinned to.
//
// Same strict-attribution principle the M2.1 freeze required for row 4.1 (see PRD): a genuine
// THREAT_BLOCKED event only ever counts as evidence for a probe when its own `host` + `ruleId`
// match this probe's dedicated target -- never inferred from a shared/global enforcement counter,
// and BYPASSED is only ever concluded from independent proof of success, never from absence alone.
import * as Network from "expo-network";
import { Platform } from "react-native";

import { isGenuineBlockedEvent, type SecurityEvent } from "@/src/contracts/securityEventSchemas";
import type { RuleEntry } from "@/src/contracts/shared/ruleBundle";
import { captureDnsDiagnosticTruthSnapshot, describePrivateDnsRuntimeMode, type DnsDiagnosticTruthSnapshot } from "@/src/diagnostics/dnsCapabilityTruthSnapshot";
import { fetchLatestBundle, fetchM1Config, toProtectionConfig } from "@/src/harness/ruleBundleFixtures";
import { GuardDogSecuritySDK } from "@/src/sdk/GuardDogSecuritySDK";
import { GuardDogNative, type NativeDnsCapabilityDeviceSnapshot, type PrivateDnsRuntimeMode } from "@/src/sdk/nativeModule";

export const DNS_DIAGNOSTIC_PROBE_HOST = "dnsprobe.blocktest.btciq.app";
export const DNS_DIAGNOSTIC_PROBE_RULE_ID = "m2-block-dns-capability-001";

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
  targetRuntimeMode: PrivateDnsRuntimeMode;
}

export const DOT_WIZARD_STEPS: DotWizardStepConfig[] = [
  {
    id: "dot-off",
    title: "Private DNS — Off",
    settingsInstruction: 'In Android Settings → Network & internet → Private DNS, choose "Off".',
    targetRuntimeMode: "INACTIVE_OR_OFF",
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

function isAttributedToProbe(event: SecurityEvent | null): boolean {
  return !!event && isGenuineBlockedEvent(event) && (event.host ?? "").toLowerCase() === DNS_DIAGNOSTIC_PROBE_HOST.toLowerCase() && event.ruleId === DNS_DIAGNOSTIC_PROBE_RULE_ID;
}

function classify(attributedEvent: SecurityEvent | null, independentSuccess: boolean | null): DnsDiagnosticClassification {
  if (attributedEvent) return "CAPTURED";
  if (independentSuccess === true) return "BYPASSED";
  return "UNOBSERVABLE"; // absence of capture alone is NEVER treated as a bypass -- never guessed.
}

function unrelatedEventNote(event: SecurityEvent | null, attributedEvent: SecurityEvent | null): string | null {
  return event && !attributedEvent ? `A genuine THREAT_BLOCKED arrived during this window for a different host/rule (host=${event.host ?? "unknown"}) -- unrelated leftover traffic, correctly excluded from this probe's own evidence.` : null;
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

async function fetchProbeHost(timeoutMs: number): Promise<{ outcome: "resolved" | "network-error" | "timeout"; httpStatus: number | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`https://${DNS_DIAGNOSTIC_PROBE_HOST}/`, { method: "GET", signal: controller.signal });
    return { outcome: "resolved", httpStatus: res.status };
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    return { outcome: aborted ? "timeout" : "network-error", httpStatus: null };
  } finally {
    clearTimeout(timer);
  }
}

/** Automated single-action probe for Android system Private DNS (DoT) configurations. Called only
 * once `pollForPrivateDnsRuntimeMode` has already confirmed the device is in the step's target
 * runtime mode -- the app's own fetch() resolves via the system DNS resolver, which DOES honor the
 * system Private DNS mode. `configurationLabel` is derived ENTIRELY from a fresh native snapshot
 * taken at probe time (never from the earlier poll match, and never manually typed) -- if the
 * runtime state drifted between detection and execution, that drift is recorded verbatim, never
 * silently reported as the originally-expected state. */
export async function runPrivateDnsProbeForStep(step: DotWizardStepConfig, probeRuleConfirmedInBundle: boolean | null, windowMs = 12_000): Promise<DnsDiagnosticRecord> {
  const probeStartedAt = nowIso();
  const truthSnapshot = await captureDnsDiagnosticTruthSnapshot(probeRuleConfirmedInBundle);
  const transportNetworkType = await getNetworkType();
  let fetchOutcome: Awaited<ReturnType<typeof fetchProbeHost>> | null = null;
  const event = await observeWindow(async () => {
    fetchOutcome = await fetchProbeHost(Math.min(windowMs, 8000));
  }, windowMs);
  const attributedEvent = isAttributedToProbe(event) ? event : null;
  const independentSuccess = (fetchOutcome as { outcome: string } | null)?.outcome === "resolved";
  const observedMode = truthSnapshot.privateDnsRuntimeMode;
  const drifted = observedMode !== "UNAVAILABLE" && observedMode !== step.targetRuntimeMode;
  const driftNote = drifted
    ? `Runtime state drifted between detection and probe execution -- expected ${step.targetRuntimeMode}, observed ${observedMode} at probe time. Recorded exactly as observed, never as the originally-expected state.`
    : null;
  return {
    id: `dot-${Date.now()}`,
    category: "private-dns",
    configurationLabel: `${step.title}: ${describePrivateDnsRuntimeMode(observedMode, truthSnapshot.privateDnsServerName)}`,
    probeHostname: DNS_DIAGNOSTIC_PROBE_HOST,
    transportNetworkType,
    sawPlaintextUdp53: !!attributedEvent,
    websiteGateEventProduced: !!attributedEvent,
    attributedEvent,
    independentSuccess,
    independentSuccessSource: "in-app-fetch",
    classification: classify(attributedEvent, independentSuccess),
    notes: [unrelatedEventNote(event, attributedEvent), driftNote].filter((n): n is string => !!n).join(" ") || null,
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

/** The exact URL the tester opens in the target browser. See
 * docs/dns-capability-characterization.md for the single static asset that must be hosted at this
 * already-DNS/TLS-provisioned host to serve it and report the receipt -- this app does not, and
 * cannot, host that page itself (it must be reachable at the SAME hostname Apollo's dedicated rule
 * matches, independent of this app). */
export function buildDohProbeUrl(nonce: string): string {
  return `https://${DNS_DIAGNOSTIC_PROBE_HOST}/dnsdiag/?n=${nonce}`;
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

/** Starts listening for a genuine, attributed THREAT_BLOCKED the moment the tester is about to open
 * the probe URL in the target browser. Call the returned `finish()` once the tester is back in this
 * app (or let it auto-expire after `maxWindowMs`) -- it does one final short receipt poll before
 * resolving, since the beacon fetch on the probe page completes almost instantly on page load. */
export function startAppEmbeddedDohObservation(nonce: string, maxWindowMs = 120_000): { startedAt: string; finish: () => Promise<{ event: SecurityEvent | null; receiptConfirmed: boolean }> } {
  const startedAt = nowIso();
  let settled = false;
  let capturedEvent: SecurityEvent | null = null;
  const hardTimer = setTimeout(() => {
    settled = true;
    unsubscribe();
  }, maxWindowMs);
  const unsubscribe = GuardDogSecuritySDK.onSecurityEvent((event) => {
    if (settled || capturedEvent || !isAttributedToProbe(event)) return;
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
 * immediately before `Linking.openURL` was fired, so it reflects the exact state the probe ran under. */
export function buildAppEmbeddedDohRecord(
  configurationLabel: string,
  nonce: string,
  event: SecurityEvent | null,
  receiptConfirmed: boolean,
  probeStartedAt: string,
  transportNetworkType: string | null,
  truthSnapshot: DnsDiagnosticTruthSnapshot,
): DnsDiagnosticRecord {
  const attributedEvent = isAttributedToProbe(event) ? event : null;
  // If Apollo captured/blocked it, the receipt should never have arrived at all (the request never
  // reached the probe page) -- independentSuccess is only meaningful when there was nothing to capture.
  const independentSuccess = attributedEvent ? null : receiptConfirmed;
  return {
    id: `doh-${Date.now()}`,
    category: "app-embedded-doh",
    configurationLabel,
    probeHostname: buildDohProbeUrl(nonce),
    transportNetworkType,
    sawPlaintextUdp53: !!attributedEvent,
    websiteGateEventProduced: !!attributedEvent,
    attributedEvent,
    independentSuccess,
    independentSuccessSource: attributedEvent ? "not-applicable" : "controlled-server-receipt",
    classification: classify(attributedEvent, independentSuccess),
    notes: unrelatedEventNote(event, attributedEvent),
    probeStartedAt,
    probeEndedAt: nowIso(),
    truthSnapshot,
  };
}

/** For preconditions that could not be met at all (e.g. native module unavailable, gate not active,
 * or Private DNS detection timed out and the tester chose not to retry) -- an explicit NOT_TESTABLE
 * record, never silently skipped and never guessed as UNOBSERVABLE. */
export function notTestableRecord(category: DnsDiagnosticCategory, configurationLabel: string, reason: string, truthSnapshot: DnsDiagnosticTruthSnapshot): DnsDiagnosticRecord {
  const at = nowIso();
  return {
    id: `nt-${Date.now()}`,
    category,
    configurationLabel,
    probeHostname: DNS_DIAGNOSTIC_PROBE_HOST,
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
  /** True iff the fetched, currently-accepted M2 bundle genuinely carries the dedicated probe
   * rule -- confirms this diagnostic's evidence will be attributable before any probe is run. */
  probeRuleConfirmedInBundle: boolean;
  /** Full machine-observed truth-of-state snapshot taken at the end of Preflight. Carried forward
   * as the `probeRuleConfirmedInBundle` baseline for every later per-row snapshot this session. */
  preflightSnapshot: DnsDiagnosticTruthSnapshot;
}

/** Activates protection + the Website Gate using ONLY the stable public GuardDogSecuritySDK surface
 * (requestPermission -> configure -> startProtection -> configureWebsiteGate -> accept the live
 * signed gd-m2-website-gate bundle -> hydrate overrides) -- the exact same public calls the M2.1
 * harness uses, but implemented fresh here so this tool has zero code-level dependency on
 * phase6AutomatedHarness.ts. Never signs or publishes a bundle; only reads the currently-live one. */
export async function activateWebsiteGateForDiagnostics(): Promise<ActivationResult> {
  const fail = async (reason: string): Promise<ActivationResult> => ({ ok: false, reason, probeRuleConfirmedInBundle: false, preflightSnapshot: await captureDnsDiagnosticTruthSnapshot(false) });
  if (!GuardDogSecuritySDK.nativeAvailable) return fail("NATIVE_MODULE_UNAVAILABLE (Expo Go / web -- a native Android build is required)");
  const permission = await GuardDogSecuritySDK.requestPermission("vpn");
  if (permission !== "granted") return fail(`VPN_PERMISSION_${permission.toUpperCase()}`);
  const m1Config = await fetchM1Config();
  GuardDogSecuritySDK.configure(toProtectionConfig(m1Config));
  const status = await GuardDogSecuritySDK.startProtection();
  if (status.state !== "ACTIVE") return fail(`PROTECTION_NOT_ACTIVE (state=${status.state})`);
  const rulesetId = m1Config.gateGuard?.websiteGateRulesetId;
  if (!rulesetId) return fail("NO_WEBSITE_GATE_RULESET_CONFIGURED");
  GuardDogSecuritySDK.configureWebsiteGate({});
  const bundle = await fetchLatestBundle(rulesetId);
  const acceptance = GuardDogSecuritySDK.acceptWebsiteGateRuleBundle(bundle);
  if (!acceptance.accepted) return fail(`BUNDLE_REJECTED (${acceptance.rejectReason})`);
  await GuardDogSecuritySDK.hydrateWebsiteGateOverrides();
  const gateStatus = GuardDogSecuritySDK.getWebsiteGateStatus();
  if (!gateStatus.dnsGatewayActive) return fail("DNS_GATEWAY_NOT_ACTIVE");
  const rules = bundle.payload.rules as RuleEntry[];
  const probeRuleConfirmedInBundle = rules.some((r) => r.host === DNS_DIAGNOSTIC_PROBE_HOST && r.ruleId === DNS_DIAGNOSTIC_PROBE_RULE_ID && r.action === "block");
  const preflightSnapshot = await captureDnsDiagnosticTruthSnapshot(probeRuleConfirmedInBundle);
  return { ok: true, reason: null, probeRuleConfirmedInBundle, preflightSnapshot };
}
