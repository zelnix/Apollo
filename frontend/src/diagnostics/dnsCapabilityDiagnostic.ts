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
// classification gate, not just an informational note -- see dnsWizardProbeGate.ts.
//
// 2026-06 physical Pixel 10 fix round (see PRD "DNS/DoH Wizard -- physical Pixel 10 run FAILED"):
// found 3 real bugs -- "Automatic" hard-polled for ACTIVE_NO_HOSTNAME and timed out even though the
// device was genuinely Automatic (opportunistic DoT legitimately inactive); a correctly-observed
// "Strict" row was force-gated NOT_TESTABLE because protection had dropped to STOPPED with no
// recovery attempt; "Strict" was recorded twice because retries appended instead of replacing that
// step's own row. All decision logic for the fix is centralized in the dependency-free
// dnsWizardProbeGate.ts (own targeted `node --test` unit tests) so it can be exercised without a
// native build; this file wires that pure logic to the real native/SDK reads.
import * as Network from "expo-network";
import { Platform } from "react-native";

import { isGenuineBlockedEvent, type SecurityEvent } from "@/src/contracts/securityEventSchemas";
import type { RuleEntry } from "@/src/contracts/shared/ruleBundle";
import { captureDnsDiagnosticTruthSnapshot, describePrivateDnsRuntimeMode, type DnsDiagnosticTruthSnapshot } from "@/src/diagnostics/dnsCapabilityTruthSnapshot";
import {
  classifyWithHardGate,
  decideRecoveryOutcome,
  describeAutomaticModeContradiction,
  describeOffModeContradiction,
  needsRecovery,
  type GateTruthInputs,
  type ObservedPrivateDnsMode,
} from "@/src/diagnostics/dnsWizardProbeGate";
import { fetchLatestBundle, fetchM1Config, toProtectionConfig } from "@/src/harness/ruleBundleFixtures";
import { GuardDogSecuritySDK, WEBSITE_GATE_DEFAULT_UPSTREAM_DNS_IPV4 } from "@/src/sdk/GuardDogSecuritySDK";
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
  /** The wizard step this record belongs to -- duplicate-row fix: a retry for the SAME step
   * replaces its existing row (see upsertRecordByStepId in dnsWizardProbeGate.ts) rather than
   * appending a second one. */
  stepId: WizardRowId;
  category: DnsDiagnosticCategory;
  /** Machine-derived label (from the native Private DNS snapshot) for private-dns rows; a
   * tester-supplied browser/version + DoH setting for app-embedded-doh rows (Android exposes
   * neither the browser identity nor its DoH setting to a third-party app, so that half stays
   * descriptive metadata -- never treated as evidence). Kept as a convenience combined display
   * string; `configuredMode`/`observedRuntimeMode` below are the explicit, separately-reportable
   * fields the 2026-06 fix round requires. */
  configurationLabel: string;
  /** What was actually configured/tester-confirmed for this row (e.g. "Private DNS — Off
   * (tester-selected)") -- NEVER a machine-verified claim by itself; see `observedRuntimeMode`. */
  configuredMode: string;
  /** The machine-observed runtime state at probe time (honest wording from
   * describePrivateDnsRuntimeMode -- e.g. never claims "Off" for INACTIVE_OR_OFF). */
  observedRuntimeMode: string;
  /** Protection state read immediately before this row's pre-probe readiness sequence started. */
  protectionStateBeforeProbe: string | null;
  /** Whether the pre-probe readiness sequence attempted a recovery (protection was not ACTIVE at
   * the "before" read). Always reported, never silently omitted, regardless of outcome. */
  recoveryAttempted: boolean;
  /** Protection state after the recovery attempt settled (null if no recovery was attempted). */
  protectionStateAfterRecovery: string | null;
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
  /** Full machine-observed truth-of-state at the moment this specific probe ran (captured AFTER
   * the pre-probe readiness/recovery sequence, i.e. it reflects the state the probe actually ran
   * under, never the possibly-stale state from before recovery). */
  truthSnapshot: DnsDiagnosticTruthSnapshot;
}

// --- Guided wizard step configuration + automated Private DNS runtime-mode polling ---

export interface DotWizardStepConfig {
  id: "dot-off" | "dot-automatic" | "dot-strict";
  title: string;
  settingsInstruction: string;
  /** null for "dot-off" AND "dot-automatic" (2026-06 fix): Android's public API can never PROVE
   * either was selected. "Off" cannot be distinguished from "Automatic" whose opportunistic probe
   * is currently inactive; conversely, requiring/polling for ACTIVE_NO_HOSTNAME to confirm
   * "Automatic" is WRONG -- opportunistic DoT legitimately stays inactive on many real networks
   * even with Automatic genuinely selected (this hard-poll timing out was the physical Pixel 10
   * regression). Both rows are tester-confirmed instead; Apollo records the machine-observed state
   * honestly alongside the tester's own claim (see runPrivateDnsProbeForStep /
   * describeOffModeContradiction / describeAutomaticModeContradiction) -- never displayed as a
   * machine-verified match. Only "dot-strict" has a genuinely machine-provable target. */
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
    // 2026-06 fix: no longer polls-to-match ACTIVE_NO_HOSTNAME -- see the doc comment above.
    targetRuntimeMode: null,
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

/** The exact preflight-derived fields every per-row readiness/gate function needs, carried forward
 * from the Preflight activation result (or the latest retried attempt -- see appendPreflightAttempt
 * in dnsWizardProbeGate.ts / the screen's own immutable attempt history) into every later snapshot
 * this session. */
export interface PreflightCarry {
  m1BundleAccepted: boolean | null;
  probeRuleConfirmedInBundle: boolean | null;
  internetContinuityOk: boolean | null;
  configuredUpstreamDnsResolverIpv4: string | null;
}

/** Converts a full truth-of-state snapshot into the minimal shape the dependency-free hard
 * classification gate (dnsWizardProbeGate.ts's evaluateHardClassificationGate/classifyWithHardGate)
 * needs -- keeps this file's own richer DnsDiagnosticTruthSnapshot decoupled from that pure module.
 * `configurationEstablished`/`configurationNote` (2026-06 second fix round) are now REQUIRED
 * parameters -- every call site must explicitly compute condition 8, it can no longer be forgotten
 * via an optional extraReasons push. */
function toGateInputs(snapshot: DnsDiagnosticTruthSnapshot, configurationEstablished: boolean, configurationNote: string | null): GateTruthInputs {
  return {
    nativeAvailable: snapshot.nativeAvailable,
    protectionState: snapshot.protectionState,
    tunOpen: snapshot.tunOpen,
    dnsGatewayActive: snapshot.dnsGatewayActive,
    m1BundleAccepted: snapshot.m1BundleAccepted,
    probeRuleConfirmedInBundle: snapshot.probeRuleConfirmedInBundle,
    internetContinuityOk: snapshot.internetContinuityOk,
    configurationEstablished,
    configurationNote,
    truthViolation: snapshot.truthViolation,
  };
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

/** Automated probe for Android system Private DNS (DoT) configurations. "dot-strict" is called
 * only once `pollForPrivateDnsRuntimeMode` has already confirmed the device is in the target
 * runtime mode. "dot-off"/"dot-automatic" (`targetRuntimeMode === null`) are called once the
 * tester has manually confirmed their own selection in Android Settings -- neither has a
 * machine-provable target to poll for (see DOT_WIZARD_STEPS doc comment). `configuredMode` /
 * `observedRuntimeMode` are ALWAYS kept separate and explicit (2026-06 fix; `configurationLabel`
 * remains only as a convenience combined display string).
 *
 * 2026-06 fix: every call now runs the full rigorous pre-probe readiness sequence
 * (ensureProbeReadiness, defined below) FIRST -- read config, check protection, bounded recovery
 * if needed, TUN/gateway/continuity re-verification, fresh DNS re-read. If that sequence does not
 * clear, the fetch/observation probe itself is skipped entirely (never attempted) -- the row is
 * still always recorded, honestly, as NOT_TESTABLE via classifyWithHardGate's own independent
 * re-check of the same conditions (defense in depth: readiness.ready and the hard gate must
 * always agree, by construction). There is no "continue anyway" path.
 *
 * `expectedStrictHostname` (2026-06 SECOND fix round, code review finding #5): for "dot-strict"
 * only, the provider hostname originally observed at the moment `pollForPrivateDnsRuntimeMode`
 * matched STRICT. A pre-probe recovery could theoretically re-arm Apollo/the OS against a
 * DIFFERENT strict provider than the tester actually configured (e.g. a stale OS cache resolving
 * to a different provider after a network flap) -- this is now explicitly re-verified to still
 * match AFTER readiness/recovery, not just the runtime MODE. */
export async function runPrivateDnsProbeForStep(
  step: DotWizardStepConfig,
  preflight: PreflightCarry,
  windowMs = 12_000,
  expectedStrictHostname: string | null = null,
): Promise<DnsDiagnosticRecord> {
  const identity = ROW_PROBE_IDENTITY[step.id];
  const probeStartedAt = nowIso();

  const readiness = await ensureProbeReadiness(preflight);
  const observedMode = readiness.freshSnapshot.privateDnsRuntimeMode;
  const machineObserved = describePrivateDnsRuntimeMode(observedMode, readiness.freshSnapshot.privateDnsServerName);
  const configuredMode = step.targetRuntimeMode === null ? `${step.title} (tester-selected)` : step.title;

  // Condition 8 (configurationEstablished) is now a REQUIRED explicit field on the gate input --
  // computed here, never left to an optional extraReasons push a caller could forget.
  let configurationEstablished = true;
  let configurationNote: string | null = null;
  if (step.id === "dot-off") {
    // "Off" row: never machine-provable (see file header). Only a genuinely active encrypted-DNS
    // state contradicts the tester's claim -- not just a labelling nuance.
    const contradiction = describeOffModeContradiction(observedMode as ObservedPrivateDnsMode);
    if (contradiction) {
      configurationEstablished = false;
      configurationNote = contradiction;
    }
  } else if (step.id === "dot-automatic") {
    // "Automatic" row (physical-device fix): never requires/waits for ACTIVE_NO_HOSTNAME.
    // INACTIVE_OR_OFF is a perfectly legitimate Automatic outcome; only STRICT is a contradiction.
    const contradiction = describeAutomaticModeContradiction(observedMode as ObservedPrivateDnsMode);
    if (contradiction) {
      configurationEstablished = false;
      configurationNote = contradiction;
    }
  } else if (observedMode !== "UNAVAILABLE" && observedMode !== step.targetRuntimeMode) {
    configurationEstablished = false;
    configurationNote = `Runtime state drifted between detection and probe execution -- expected ${step.targetRuntimeMode}, observed ${observedMode} at probe time.`;
  } else if (expectedStrictHostname && (readiness.freshSnapshot.privateDnsServerName ?? "").toLowerCase() !== expectedStrictHostname.toLowerCase()) {
    // Mode still matches STRICT, but the SPECIFIC provider hostname drifted across the
    // readiness/recovery sequence -- the mode-only check above would have missed this.
    configurationEstablished = false;
    configurationNote = `Strict provider hostname drifted after the pre-probe readiness/recovery sequence -- originally observed '${expectedStrictHostname}', now observed '${readiness.freshSnapshot.privateDnsServerName ?? "none"}'.`;
  }

  const extraGateReasons: string[] = [];
  if (readiness.readinessFailureReason) extraGateReasons.push(readiness.readinessFailureReason);

  let event: SecurityEvent | null = null;
  let fetchOutcome: Awaited<ReturnType<typeof fetchProbeHost>> | null = null;
  let transportNetworkType: string | null = null;
  if (readiness.ready) {
    transportNetworkType = await getNetworkType();
    event = await observeWindow(async () => {
      fetchOutcome = await fetchProbeHost(identity.host, Math.min(windowMs, 8000));
    }, windowMs);
  }
  const attributedEvent = isAttributedToProbe(event, identity.host, identity.ruleId) ? event : null;
  const independentSuccess = readiness.ready ? (fetchOutcome as { outcome: string } | null)?.outcome === "resolved" : null;

  const { classification, gateReasons } = classifyWithHardGate(
    !!attributedEvent,
    independentSuccess,
    toGateInputs(readiness.freshSnapshot, configurationEstablished, configurationNote),
    extraGateReasons,
  );

  return {
    id: `dot-${Date.now()}`,
    stepId: step.id,
    category: "private-dns",
    configurationLabel: `${configuredMode}. Machine observed: ${machineObserved}`,
    configuredMode,
    observedRuntimeMode: machineObserved,
    protectionStateBeforeProbe: readiness.protectionStateBeforeProbe,
    recoveryAttempted: readiness.recoveryAttempted,
    protectionStateAfterRecovery: readiness.protectionStateAfterRecovery,
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
    truthSnapshot: readiness.freshSnapshot,
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
 * never a manually-reported judgment call.
 *
 * 2026-06 SECOND fix round (code review finding #1, the most important one): a DoH probe runs
 * inside an external browser this app cannot observe directly while it's open. `readiness` is the
 * pre-open readiness/recovery result (captured immediately before `Linking.openURL` fired);
 * `postProbeVerification` is a SEPARATE, verification-ONLY re-check (no recovery attempted --
 * see verifyStillHealthyAfterProbe) captured the moment the tester returned. The record's own
 * `truthSnapshot`/classification are always decided from `postProbeVerification`'s fresh
 * snapshot, NEVER the earlier pre-open one -- if Apollo dropped out of ACTIVE/TUN/gateway/
 * continuity while the browser was open, that completed probe must be forced NOT_TESTABLE, not
 * silently classified against a stale "everything was healthy" read from before the tester ever
 * left the app. `protectionStateBeforeProbe`/`recoveryAttempted`/`protectionStateAfterRecovery`
 * still describe the PRE-OPEN readiness phase specifically (that's the only place recovery ever
 * runs for a DoH row).
 *
 * Physical-device review fix: if Apollo BOTH recorded a genuine attributed block AND the probe
 * page's server receipt independently confirmed arrival, that is a logical contradiction (a
 * genuinely blocked request could never reach the page to fire its receipt beacon) -- this is
 * gated to NOT_TESTABLE via classifyWithHardGate() rather than ever being displayed as CAPTURED. */
export function buildAppEmbeddedDohRecord(
  stepId: WizardRowId,
  configuredMode: string,
  host: string,
  ruleId: string,
  nonce: string,
  event: SecurityEvent | null,
  receiptConfirmed: boolean,
  probeStartedAt: string,
  transportNetworkType: string | null,
  readiness: ProbeReadiness,
  postProbeVerification: PostProbeVerification,
): DnsDiagnosticRecord {
  const truthSnapshot = postProbeVerification.freshSnapshot;
  const attributedEvent = isAttributedToProbe(event, host, ruleId) ? event : null;
  const extraGateReasons: string[] = [];
  if (readiness.readinessFailureReason) extraGateReasons.push(readiness.readinessFailureReason);
  if (postProbeVerification.failureReason) extraGateReasons.push(postProbeVerification.failureReason);
  if (attributedEvent && receiptConfirmed) {
    extraGateReasons.push(
      "Contradiction: Apollo recorded an attributed block AND the probe page's server receipt confirmed independently -- these cannot both be genuine, so this row cannot be trusted as CAPTURED.",
    );
  }
  // If Apollo captured/blocked it, the receipt should never have arrived at all (the request never
  // reached the probe page) -- independentSuccess is only meaningful when there was nothing to
  // capture, and only meaningful at all if the probe was actually attempted AND still verified
  // healthy on return (readiness.ready && postProbeVerification.stillHealthy).
  const independentSuccess = !readiness.ready || !postProbeVerification.stillHealthy ? null : attributedEvent ? null : receiptConfirmed;
  // DoH's configuration (browser DoH toggle) has no automated contradiction check possible --
  // Android exposes neither the browser identity nor its DoH setting to a third-party app, so this
  // condition 8 is always structurally "established" for this category; the readiness/verification
  // failure reasons above cover the genuinely checkable conditions.
  const { classification, gateReasons } = classifyWithHardGate(!!attributedEvent, independentSuccess, toGateInputs(truthSnapshot, true, null), extraGateReasons);
  const observedRuntimeMode = describePrivateDnsRuntimeMode(truthSnapshot.privateDnsRuntimeMode, truthSnapshot.privateDnsServerName);
  return {
    id: `doh-${Date.now()}`,
    stepId,
    category: "app-embedded-doh",
    configurationLabel: configuredMode,
    configuredMode,
    observedRuntimeMode,
    protectionStateBeforeProbe: readiness.protectionStateBeforeProbe,
    recoveryAttempted: readiness.recoveryAttempted,
    protectionStateAfterRecovery: readiness.protectionStateAfterRecovery,
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
 * record, never silently skipped and never guessed as UNOBSERVABLE. `recoveryInfo` (2026-06 second
 * fix round, code review finding #2) preserves the EXACT pre-probe/before/after recovery evidence
 * when a caller already ran `ensureProbeReadiness()` and it came back not-ready -- previously this
 * helper always hardcoded `recoveryAttempted: false`, silently discarding genuine recovery evidence
 * (e.g. "recovery was attempted and failed") whenever a readiness failure led straight to this
 * NOT_TESTABLE path instead of the normal probe-record path. */
export function notTestableRecord(
  stepId: WizardRowId,
  category: DnsDiagnosticCategory,
  configuredMode: string,
  reason: string,
  truthSnapshot: DnsDiagnosticTruthSnapshot,
  probeHostname = "n/a",
  recoveryInfo?: { protectionStateBeforeProbe: string | null; recoveryAttempted: boolean; protectionStateAfterRecovery: string | null },
): DnsDiagnosticRecord {
  const at = nowIso();
  return {
    id: `nt-${Date.now()}`,
    stepId,
    category,
    configurationLabel: configuredMode,
    configuredMode,
    observedRuntimeMode: describePrivateDnsRuntimeMode(truthSnapshot.privateDnsRuntimeMode, truthSnapshot.privateDnsServerName),
    protectionStateBeforeProbe: recoveryInfo?.protectionStateBeforeProbe ?? truthSnapshot.protectionState,
    recoveryAttempted: recoveryInfo?.recoveryAttempted ?? false,
    protectionStateAfterRecovery: recoveryInfo?.protectionStateAfterRecovery ?? null,
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
  /** True iff the M1 signed rule bundle (gd-m1-controlled-block -- the SAME baseline bundle Phase
   * 6A accepts, fetched via fetchM1Config().rulesetId) was fetched and genuinely accepted via
   * acceptRuleBundle(). Physical-device review fix: startProtection() is REJECTED by the native
   * module without this -- this wizard previously never fetched/accepted it at all (it only ever
   * dealt with its OWN Website Gate bundle). `null` = never attempted (failed even earlier: native
   * unavailable / permission denied); `false` = fetched and rejected; `true` = accepted. */
  m1BundleAccepted: boolean | null;
  /** True iff the fetched, currently-accepted DIAGNOSTIC WIZARD bundle (gd-m2-dns-diagnostic-wizard
   * -- NOT the production gd-m2-website-gate bundle) genuinely carries all 5 dedicated per-row
   * probe rules -- confirms every row's evidence will be attributable before any probe is run.
   * `null` means activation failed BEFORE this bundle was ever fetched/inspected -- "not yet
   * checked", never conflated with `false` ("checked, and it's genuinely missing"). */
  probeRuleConfirmedInBundle: boolean | null;
  /** True iff a known-good, definitely-not-a-test-domain HTTPS request completed successfully
   * while the Website Gate's DNS pipeline was active -- proves ordinary browsing wasn't silently
   * broken (see checkInternetContinuity() doc comment for the physical-device regression this
   * guards against). `null` = never attempted (failed even earlier). `false` = the gate came up
   * "active" but a normal, non-test destination was genuinely unreachable through it -- Preflight
   * MUST fail in this case; no row may ever be classified while this is false. */
  internetContinuityOk: boolean | null;
  /** The EXPLICIT, named, auditable upstream DNS resolver configured for this session (see
   * WEBSITE_GATE_DEFAULT_UPSTREAM_DNS_IPV4 in GuardDogSecuritySDK.ts) -- recorded so
   * physical-device evidence always states exactly which resolver ordinary (non-block) DNS
   * queries were forwarded to, never an unnamed implementation detail. `null` = never attempted
   * (Preflight failed before Step 2 configured the Website Gate); otherwise the literal IPv4
   * string actually passed to the native module (or explicit `null` if a test deliberately
   * requested fail-open-by-silence). */
  configuredUpstreamDnsResolverIpv4: string | null;
  /** Full machine-observed truth-of-state snapshot taken at the end of Preflight. Carried forward
   * as the `m1BundleAccepted`/`probeRuleConfirmedInBundle` baseline for every later per-row
   * snapshot this session. */
  preflightSnapshot: DnsDiagnosticTruthSnapshot;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Same timeout/interval the frozen Phase 6A harness uses for its own equivalent precondition
 * polls (see phase6AutomatedHarness.ts START_PROTECTION_TIMEOUT_MS / GATE_ACTIVE_TIMEOUT_MS /
 * POLL_MS) -- duplicated here, not imported, to keep this file's deliberate zero code-level
 * dependency on that frozen file (see the function doc comment below). */
const ACTIVATION_START_PROTECTION_TIMEOUT_MS = 15_000;
const ACTIVATION_GATE_ACTIVE_TIMEOUT_MS = 10_000;
const ACTIVATION_POLL_MS = 250;
/** 2026-06 second fix round (code review finding #4): a legitimate TUN can come up a short moment
 * AFTER protection reaches ACTIVE -- the prior implementation did one immediate, unpolled read
 * right after the ACTIVE poll settled, which could false-NOT_TESTABLE a row purely on timing. */
const ACTIVATION_TUN_OPEN_TIMEOUT_MS = 5_000;

/** Android's own standard captive-portal/connectivity-check endpoint -- a well-known, definitely
 * non-test, non-blocklisted destination, never added to any ruleset, never classified as a wizard
 * row. Used ONLY to prove ordinary DNS+HTTPS still works while the Website Gate is active. */
const INTERNET_CONTINUITY_CHECK_URL = "https://connectivitycheck.gstatic.com/generate_204";
const INTERNET_CONTINUITY_TIMEOUT_MS = 8_000;

/** Physical-device regression guard (2026-09): a Pixel 10 run found that "DNS gateway active"
 * alone does NOT prove ordinary browsing still works. Root cause (fixed alongside this check, see
 * WEBSITE_GATE_DEFAULT_UPSTREAM_DNS_IPV4 in GuardDogSecuritySDK.ts): every caller of
 * `configureWebsiteGate()` -- this wizard AND the frozen Phase 6A harness -- omitted
 * `upstreamDnsResolverIpv4`, which the native module correctly (by its own prior contract) treated
 * as an explicit request to fail open by silence for every non-block DNS query. Combined with the
 * DNS gateway becoming the device's ONLY system DNS resolver while active, this meant EVERY
 * ordinary (non-test) hostname lookup silently got no answer at all -- normal browsing broke
 * completely, invisible to every existing acceptance test because none of them ever attempt a
 * normal HTTPS request while the gate is active. Required invariant (never relaxed): Apollo ACTIVE
 * must preserve ordinary internet connectivity; only explicitly authorized destinations may be
 * dropped. This check is therefore load-bearing, not advisory -- Preflight MUST fail
 * (INTERNET_CONTINUITY_FAILED) rather than let the wizard proceed to classify any row if it fails,
 * even if the upstream-resolver fix above is somehow not present in a given build. */
async function checkInternetContinuity(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INTERNET_CONTINUITY_TIMEOUT_MS);
  try {
    await fetch(INTERNET_CONTINUITY_CHECK_URL, { method: "GET", cache: "no-store", signal: controller.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export interface ProbeReadiness {
  ready: boolean;
  protectionStateBeforeProbe: string | null;
  protectionStateAfterRecovery: string | null;
  recoveryAttempted: boolean;
  /** Fresh truth-of-state snapshot re-read AFTER the readiness/recovery sequence -- this is the
   * snapshot every row must use for both display and classification, never a possibly-stale one
   * captured before recovery ran. */
  freshSnapshot: DnsDiagnosticTruthSnapshot;
  readinessFailureReason: string | null;
}

/**
 * 2026-06 physical-device fix: the rigorous pre-probe sequence required before EVERY row, DoT and
 * DoH alike (previously DoH rows had NO readiness check at all, and DoT rows only captured a
 * snapshot without ever attempting recovery -- exactly how a correctly-observed "Strict" reading
 * got force-gated to NOT_TESTABLE on the Pixel 10 run after protection had silently dropped to
 * STOPPED). Sequence: read config -> check protection -> bounded, defensive recovery attempt if not
 * ACTIVE -> wait for ACTIVE -> TUN open -> dnsGatewayActive (+ ruleset didn't drift) -> Internet
 * Continuity re-verified FRESH (never just carried forward from Preflight) -> re-read DNS state.
 * There is no "continue anyway": if this doesn't clear, `ready` is false and the caller must skip
 * the actual probe attempt and let classifyWithHardGate's own independent re-check of the same
 * conditions record NOT_TESTABLE (defense in depth -- `ready` and the hard gate always agree, by
 * construction, since both ultimately look at the same freshSnapshot).
 *
 * VPN-survives-Settings-transition (best-effort per explicit user decision, not blocking): this is
 * the structural answer to that concern too -- opening Android Settings to change Private DNS does
 * not, by itself, stop this app's foreground VpnService or kill the process; IF the OS or user
 * revoked VPN consent / the tunnel dropped during that transition for any reason, THIS sequence is
 * exactly what detects and attempts to recover from it before the next probe runs, rather than a
 * separate native lifecycle change.
 */
export async function ensureProbeReadiness(preflight: PreflightCarry): Promise<ProbeReadiness> {
  let status = GuardDogSecuritySDK.getProtectionState();
  const protectionStateBeforeProbe = status.state;
  let recoveryAttempted = false;
  let protectionStateAfterRecovery: string | null = null;

  if (needsRecovery(protectionStateBeforeProbe)) {
    recoveryAttempted = true;
    try {
      status = await GuardDogSecuritySDK.startProtection();
    } catch {
      // Being unable to even ATTEMPT startProtection() (e.g. consent genuinely revoked) is itself
      // captured by the terminal poll below settling at whatever getProtectionState() reports.
    }
    const startDeadline = Date.now() + ACTIVATION_START_PROTECTION_TIMEOUT_MS;
    while (status.state !== "ACTIVE" && status.state !== "FAILED" && status.state !== "STOPPED" && status.state !== "REVOKED" && Date.now() < startDeadline) {
      await sleep(ACTIVATION_POLL_MS);
      status = GuardDogSecuritySDK.getProtectionState();
    }
    protectionStateAfterRecovery = status.state;
  }

  const recovery = decideRecoveryOutcome(protectionStateBeforeProbe, recoveryAttempted ? protectionStateAfterRecovery : null, recoveryAttempted);
  let readinessFailureReason = recovery.failureReason;

  if (!readinessFailureReason) {
    // 2026-06 second fix round (code review finding #4): bounded POLL for TUN open, not one
    // immediate unpolled read -- a legitimate TUN can come up a short moment after protection
    // settles at ACTIVE, and the prior single-read check could false-NOT_TESTABLE a row purely on
    // timing rather than a genuine failure.
    let tunOpen = Platform.OS === "android" && GuardDogNative ? GuardDogNative.getRecoveryStatus().tunOpen : null;
    if (Platform.OS === "android" && GuardDogNative) {
      const tunDeadline = Date.now() + ACTIVATION_TUN_OPEN_TIMEOUT_MS;
      while (tunOpen !== true && Date.now() < tunDeadline) {
        await sleep(ACTIVATION_POLL_MS);
        tunOpen = GuardDogNative.getRecoveryStatus().tunOpen;
      }
    }
    if (tunOpen !== true) readinessFailureReason = "Native TUN was not confirmed open after the pre-probe readiness check (bounded poll).";
  }

  if (!readinessFailureReason) {
    let gateStatus = GuardDogSecuritySDK.getWebsiteGateStatus();
    const gateDeadline = Date.now() + ACTIVATION_GATE_ACTIVE_TIMEOUT_MS;
    while (!gateStatus.dnsGatewayActive && Date.now() < gateDeadline) {
      await sleep(ACTIVATION_POLL_MS);
      gateStatus = GuardDogSecuritySDK.getWebsiteGateStatus();
    }
    if (!gateStatus.dnsGatewayActive) {
      readinessFailureReason = "Website Gate DNS gateway was not confirmed active after the pre-probe readiness check.";
    } else if (gateStatus.acceptedRulesetId !== DNS_DIAGNOSTIC_WIZARD_RULESET_ID) {
      readinessFailureReason = `Accepted ruleset drifted before this probe (expected ${DNS_DIAGNOSTIC_WIZARD_RULESET_ID}, observed ${gateStatus.acceptedRulesetId ?? "none"}).`;
    }
  }

  let internetContinuityOk = preflight.internetContinuityOk;
  if (!readinessFailureReason) {
    internetContinuityOk = await checkInternetContinuity();
    if (!internetContinuityOk) readinessFailureReason = "Internet Continuity re-check failed immediately before this probe -- ordinary browsing would be broken.";
  }

  const freshSnapshot = await captureDnsDiagnosticTruthSnapshot({ ...preflight, internetContinuityOk });

  return { ready: !readinessFailureReason, protectionStateBeforeProbe, protectionStateAfterRecovery, recoveryAttempted, freshSnapshot, readinessFailureReason };
}

export interface PostProbeVerification {
  stillHealthy: boolean;
  failureReason: string | null;
  /** Fresh truth-of-state snapshot re-read at the moment of this verification -- this, NOT the
   * earlier pre-open readiness snapshot, is what a DoH row's classification must be decided from. */
  freshSnapshot: DnsDiagnosticTruthSnapshot;
}

/**
 * Verification-ONLY re-check (2026-06 SECOND fix round -- code review finding #1, the most
 * important one): a DoH probe runs inside an external browser this app cannot observe directly
 * while it's open. The wizard can only bracket that window with a pre-open `ensureProbeReadiness()`
 * call (which MAY recover) and this post-return check. This function NEVER attempts recovery -- it
 * only proves whether the hard-gate conditions were STILL true at the moment the tester actually
 * returned from the browser. If Apollo dropped out of ACTIVE/TUN/gateway/continuity WHILE the
 * browser was open, the probe that already happened cannot be salvaged by recovering now and
 * pretending it was healthy throughout -- the row must be forced NOT_TESTABLE. Recovery, if
 * needed, only ever runs at the START of the NEXT row's own `ensureProbeReadiness()` call.
 */
export async function verifyStillHealthyAfterProbe(preflight: PreflightCarry): Promise<PostProbeVerification> {
  const status = GuardDogSecuritySDK.getProtectionState();
  let failureReason: string | null = null;
  if (status.state !== "ACTIVE") {
    failureReason = `Protection was '${status.state}' when the tester returned from the browser, not ACTIVE (verification-only -- no recovery attempted here).`;
  }

  if (!failureReason) {
    const tunOpen = Platform.OS === "android" && GuardDogNative ? GuardDogNative.getRecoveryStatus().tunOpen : null;
    if (tunOpen !== true) failureReason = "Native TUN was not open when the tester returned from the browser.";
  }

  if (!failureReason) {
    const gateStatus = GuardDogSecuritySDK.getWebsiteGateStatus();
    if (!gateStatus.dnsGatewayActive) {
      failureReason = "Website Gate DNS gateway was not active when the tester returned from the browser.";
    } else if (gateStatus.acceptedRulesetId !== DNS_DIAGNOSTIC_WIZARD_RULESET_ID) {
      failureReason = `Accepted ruleset drifted while the browser was open (expected ${DNS_DIAGNOSTIC_WIZARD_RULESET_ID}, observed ${gateStatus.acceptedRulesetId ?? "none"}).`;
    }
  }

  let internetContinuityOk = preflight.internetContinuityOk;
  if (!failureReason) {
    internetContinuityOk = await checkInternetContinuity();
    if (!internetContinuityOk) failureReason = "Internet Continuity failed when the tester returned from the browser.";
  }

  const freshSnapshot = await captureDnsDiagnosticTruthSnapshot({ ...preflight, internetContinuityOk });
  return { stillHealthy: !failureReason, failureReason, freshSnapshot };
}

/** Activates protection + the Website Gate using ONLY the stable public GuardDogSecuritySDK surface
 * -- implemented fresh here (not imported) so this tool has zero code-level dependency on
 * phase6AutomatedHarness.ts, but now mirrors that frozen harness's PROVEN activation order exactly:
 * requestPermission -> fetch+configure M1 -> fetch+accept the M1 signed bundle -> configure the
 * Website Gate -> fetch+accept THIS WIZARD's OWN dedicated bundle (gd-m2-dns-diagnostic-wizard,
 * never the frozen gd-m2-website-gate v4) -> hydrate overrides -> verify the 5 probe rules ->
 * ONLY THEN startProtection() -> poll ACTIVE -> poll dnsGatewayActive -> verify Internet
 * continuity. Never signs or publishes a bundle; only reads currently-live ones.
 *
 * Physical-device review fixes (2026-09):
 * 1. Ordering bug: this wizard previously called startProtection() having only ever
 *    fetched/configured M1 -- it never fetched or accepted the M1 SIGNED BUNDLE via
 *    acceptRuleBundle(), which the native module requires before it will let startProtection()
 *    proceed at all ("no accepted signed rule bundle"). This only surfaced on a real device,
 *    because the JS/web fallback SDK doesn't enforce that precondition. Fixed by accepting M1
 *    first, exactly where the frozen Phase 6A harness's own proven "config" phase does it.
 * 2. startProtection() can genuinely settle at ACTIVE a moment after returning a transitional state
 *    (STARTING) -- polling for a terminal state instead of judging the very first synchronous read
 *    avoids a false PRECONDITION failure on a device that would have reached ACTIVE shortly after.
 * 3. `m1BundleAccepted` / `probeRuleConfirmedInBundle` are only ever MEANINGFULLY known once each
 *    bundle has actually been fetched and accepted -- every earlier failure path reports the
 *    not-yet-reached one(s) as `null` ("not yet checked"), never `false` ("confirmed absent"), so
 *    the truth snapshot's violation reasons never claim a check that never ran.
 * 4. Internet Continuity preflight (new, see checkInternetContinuity() above): a second physical
 *    run found the DNS gateway coming up "active" while silently breaking ALL ordinary browsing.
 *    Root-caused and fixed at the SDK layer; this check is the load-bearing safety net that stops
 *    the wizard cold (INTERNET_CONTINUITY_FAILED) rather than let any row be classified against an
 *    Apollo session that isn't honoring its own core invariant. */
export async function activateWebsiteGateForDiagnostics(): Promise<ActivationResult> {
  // Mutated once, right after Step 2 configures the Website Gate -- read by every `fail()` call
  // via closure (not a positional param) so every failure from that point on automatically reports
  // the exact resolver actually configured, no matter how many new fail() call sites are added
  // later. Physical-device review fix: must be an EXPLICITLY named, auditable value, never an
  // invisible fallback -- see WEBSITE_GATE_DEFAULT_UPSTREAM_DNS_IPV4 in GuardDogSecuritySDK.ts.
  let configuredUpstreamDnsResolverIpv4: string | null = null;
  const fail = async (
    reason: string,
    m1BundleAccepted: boolean | null = null,
    probeRuleConfirmedInBundle: boolean | null = null,
    internetContinuityOk: boolean | null = null,
  ): Promise<ActivationResult> => ({
    ok: false,
    reason,
    m1BundleAccepted,
    probeRuleConfirmedInBundle,
    internetContinuityOk,
    configuredUpstreamDnsResolverIpv4,
    preflightSnapshot: await captureDnsDiagnosticTruthSnapshot({ m1BundleAccepted, probeRuleConfirmedInBundle, internetContinuityOk, configuredUpstreamDnsResolverIpv4 }),
  });
  if (!GuardDogSecuritySDK.nativeAvailable) return fail("NATIVE_MODULE_UNAVAILABLE (Expo Go / web -- a native Android build is required)");
  const permission = await GuardDogSecuritySDK.requestPermission("vpn");
  if (permission !== "granted") return fail(`VPN_PERMISSION_${permission.toUpperCase()}`);

  const m1Config = await fetchM1Config();
  GuardDogSecuritySDK.configure(toProtectionConfig(m1Config));

  // Step 1 (must happen BEFORE startProtection()): fetch + accept the M1 baseline signed bundle --
  // the same one Phase 6A accepts via GuardDogSecuritySDK.acceptRuleBundle(). Without this,
  // startProtection() is rejected by the native module ("no accepted signed rule bundle").
  const m1Bundle = await fetchLatestBundle(m1Config.rulesetId);
  const m1Acceptance = GuardDogSecuritySDK.acceptRuleBundle(m1Bundle);
  if (!m1Acceptance.accepted) return fail(`M1_BUNDLE_REJECTED (${m1Acceptance.rejectReason})`, false);

  // Step 2: configure + accept THIS WIZARD's own dedicated bundle into the Website Gate slot --
  // deliberately gd-m2-dns-diagnostic-wizard, never the frozen gd-m2-website-gate v4. Explicitly
  // (not by omission) names the configured default upstream resolver -- auditable in every report
  // from here on via `configuredUpstreamDnsResolverIpv4` -- rather than relying on the SDK's own
  // internal default to apply silently.
  const websiteGateConfig = GuardDogSecuritySDK.configureWebsiteGate({ upstreamDnsResolverIpv4: WEBSITE_GATE_DEFAULT_UPSTREAM_DNS_IPV4 });
  configuredUpstreamDnsResolverIpv4 = websiteGateConfig.upstreamDnsResolverIpv4;
  const bundle = await fetchLatestBundle(DNS_DIAGNOSTIC_WIZARD_RULESET_ID);
  const acceptance = GuardDogSecuritySDK.acceptWebsiteGateRuleBundle(bundle);
  if (!acceptance.accepted) return fail(`BUNDLE_REJECTED (${acceptance.rejectReason})`, true, false);
  await GuardDogSecuritySDK.hydrateWebsiteGateOverrides();

  const rules = bundle.payload.rules as RuleEntry[];
  const probeRuleConfirmedInBundle = Object.values(ROW_PROBE_IDENTITY).every((identity) => rules.some((r) => r.host === identity.host && r.ruleId === identity.ruleId && r.action === "block"));

  // Step 3: only now is it valid to call startProtection() -- both bundles are accepted.
  let status = await GuardDogSecuritySDK.startProtection();
  const startDeadline = Date.now() + ACTIVATION_START_PROTECTION_TIMEOUT_MS;
  while (status.state !== "ACTIVE" && status.state !== "FAILED" && status.state !== "STOPPED" && status.state !== "REVOKED" && Date.now() < startDeadline) {
    await sleep(ACTIVATION_POLL_MS);
    status = GuardDogSecuritySDK.getProtectionState();
  }
  if (status.state !== "ACTIVE") return fail(`PROTECTION_NOT_ACTIVE (state=${status.state})`, true, probeRuleConfirmedInBundle);

  let gateStatus = GuardDogSecuritySDK.getWebsiteGateStatus();
  const gateDeadline = Date.now() + ACTIVATION_GATE_ACTIVE_TIMEOUT_MS;
  while (!gateStatus.dnsGatewayActive && Date.now() < gateDeadline) {
    await sleep(ACTIVATION_POLL_MS);
    gateStatus = GuardDogSecuritySDK.getWebsiteGateStatus();
  }
  if (!gateStatus.dnsGatewayActive) return fail("DNS_GATEWAY_NOT_ACTIVE", true, probeRuleConfirmedInBundle);

  // Step 4 (new): Internet Continuity preflight -- "DNS gateway active" alone does not prove
  // ordinary browsing works. Required invariant: Apollo ACTIVE must preserve ordinary internet
  // connectivity; only explicitly authorized destinations may be dropped. Stop cold, before any
  // row can be classified, if a known-good non-test destination is unreachable.
  const internetContinuityOk = await checkInternetContinuity();
  if (!internetContinuityOk) {
    return fail(
      `INTERNET_CONTINUITY_FAILED (${INTERNET_CONTINUITY_CHECK_URL} was unreachable via configured upstream resolver ${configuredUpstreamDnsResolverIpv4} while the Website Gate was active -- ordinary browsing would be broken; do not proceed)`,
      true,
      probeRuleConfirmedInBundle,
      false,
    );
  }

  const preflightSnapshot = await captureDnsDiagnosticTruthSnapshot({ m1BundleAccepted: true, probeRuleConfirmedInBundle, internetContinuityOk, configuredUpstreamDnsResolverIpv4 });
  return { ok: true, reason: null, m1BundleAccepted: true, probeRuleConfirmedInBundle, internetContinuityOk, configuredUpstreamDnsResolverIpv4, preflightSnapshot };
}
