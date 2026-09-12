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

import { isGenuineBlockedEvent, type SecurityEvent } from "@/src/contracts/securityEventSchemas";
import type { RuleEntry } from "@/src/contracts/shared/ruleBundle";
import { fetchLatestBundle, fetchM1Config, toProtectionConfig } from "@/src/harness/ruleBundleFixtures";
import { GuardDogSecuritySDK } from "@/src/sdk/GuardDogSecuritySDK";

export const DNS_DIAGNOSTIC_PROBE_HOST = "dnsprobe.blocktest.btciq.app";
export const DNS_DIAGNOSTIC_PROBE_RULE_ID = "m2-block-dns-capability-001";

export type DnsDiagnosticCategory = "private-dns" | "app-embedded-doh";
export type DnsDiagnosticClassification = "CAPTURED" | "BYPASSED" | "UNOBSERVABLE" | "NOT_TESTABLE";

export interface DnsDiagnosticRecord {
  id: string;
  category: DnsDiagnosticCategory;
  /** Manual, tester-supplied label -- Android does not expose this value to a third-party app.
   * e.g. "DoT: Strict (dns.google)" or "Firefox 143, Enhanced Tracking Protection DoH: ON". */
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

/** Automated single-action probe for Android system Private DNS (DoT) configurations. The app's own
 * fetch() resolves via the system DNS resolver, which DOES honor the system Private DNS mode -- so
 * once the tester has set the mode in Android Settings beforehand and labelled it, this probe is
 * fully automated (no manual observation window needed, unlike the DoH case below). */
export async function runPrivateDnsProbe(configurationLabel: string, windowMs = 12_000): Promise<DnsDiagnosticRecord> {
  const probeStartedAt = nowIso();
  const transportNetworkType = await getNetworkType();
  let fetchOutcome: Awaited<ReturnType<typeof fetchProbeHost>> | null = null;
  const event = await observeWindow(async () => {
    fetchOutcome = await fetchProbeHost(Math.min(windowMs, 8000));
  }, windowMs);
  const attributedEvent = isAttributedToProbe(event) ? event : null;
  const independentSuccess = (fetchOutcome as { outcome: string } | null)?.outcome === "resolved";
  return {
    id: `dot-${Date.now()}`,
    category: "private-dns",
    configurationLabel,
    probeHostname: DNS_DIAGNOSTIC_PROBE_HOST,
    transportNetworkType,
    sawPlaintextUdp53: !!attributedEvent,
    websiteGateEventProduced: !!attributedEvent,
    attributedEvent,
    independentSuccess,
    independentSuccessSource: "in-app-fetch",
    classification: classify(attributedEvent, independentSuccess),
    notes: unrelatedEventNote(event, attributedEvent),
    probeStartedAt,
    probeEndedAt: nowIso(),
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
 * never a manually-reported judgment call. */
export function buildAppEmbeddedDohRecord(configurationLabel: string, nonce: string, event: SecurityEvent | null, receiptConfirmed: boolean, probeStartedAt: string, transportNetworkType: string | null): DnsDiagnosticRecord {
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
  };
}

/** For preconditions that could not be met at all (e.g. native module unavailable, gate not active) --
 * an explicit NOT_TESTABLE record, never silently skipped and never guessed as UNOBSERVABLE. */
export function notTestableRecord(category: DnsDiagnosticCategory, configurationLabel: string, reason: string): DnsDiagnosticRecord {
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
  };
}

export interface ActivationResult {
  ok: boolean;
  reason: string | null;
  /** True iff the fetched, currently-accepted M2 bundle genuinely carries the dedicated probe
   * rule -- confirms this diagnostic's evidence will be attributable before any probe is run. */
  probeRuleConfirmedInBundle: boolean;
}

/** Activates protection + the Website Gate using ONLY the stable public GuardDogSecuritySDK surface
 * (requestPermission -> configure -> startProtection -> configureWebsiteGate -> accept the live
 * signed gd-m2-website-gate bundle -> hydrate overrides) -- the exact same public calls the M2.1
 * harness uses, but implemented fresh here so this tool has zero code-level dependency on
 * phase6AutomatedHarness.ts. Never signs or publishes a bundle; only reads the currently-live one. */
export async function activateWebsiteGateForDiagnostics(): Promise<ActivationResult> {
  if (!GuardDogSecuritySDK.nativeAvailable) return { ok: false, reason: "NATIVE_MODULE_UNAVAILABLE (Expo Go / web -- a native Android build is required)", probeRuleConfirmedInBundle: false };
  const permission = await GuardDogSecuritySDK.requestPermission("vpn");
  if (permission !== "granted") return { ok: false, reason: `VPN_PERMISSION_${permission.toUpperCase()}`, probeRuleConfirmedInBundle: false };
  const m1Config = await fetchM1Config();
  GuardDogSecuritySDK.configure(toProtectionConfig(m1Config));
  const status = await GuardDogSecuritySDK.startProtection();
  if (status.state !== "ACTIVE") return { ok: false, reason: `PROTECTION_NOT_ACTIVE (state=${status.state})`, probeRuleConfirmedInBundle: false };
  const rulesetId = m1Config.gateGuard?.websiteGateRulesetId;
  if (!rulesetId) return { ok: false, reason: "NO_WEBSITE_GATE_RULESET_CONFIGURED", probeRuleConfirmedInBundle: false };
  GuardDogSecuritySDK.configureWebsiteGate({});
  const bundle = await fetchLatestBundle(rulesetId);
  const acceptance = GuardDogSecuritySDK.acceptWebsiteGateRuleBundle(bundle);
  if (!acceptance.accepted) return { ok: false, reason: `BUNDLE_REJECTED (${acceptance.rejectReason})`, probeRuleConfirmedInBundle: false };
  await GuardDogSecuritySDK.hydrateWebsiteGateOverrides();
  const gateStatus = GuardDogSecuritySDK.getWebsiteGateStatus();
  if (!gateStatus.dnsGatewayActive) return { ok: false, reason: "DNS_GATEWAY_NOT_ACTIVE", probeRuleConfirmedInBundle: false };
  const rules = bundle.payload.rules as RuleEntry[];
  const probeRuleConfirmedInBundle = rules.some((r) => r.host === DNS_DIAGNOSTIC_PROBE_HOST && r.ruleId === DNS_DIAGNOSTIC_PROBE_RULE_ID && r.action === "block");
  return { ok: true, reason: null, probeRuleConfirmedInBundle };
}
