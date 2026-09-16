// Gate Guard — DNS/DoH Diagnostic Wizard: pure, dependency-free decision logic. Deliberately ZERO
// react-native / expo / "@/" imports (no Platform, no fetch, no AsyncStorage) so this file can be
// exercised directly by a plain `node --test` run, independent of the Metro/React Native runtime --
// see dnsWizardProbeGate.test.ts. dnsCapabilityDiagnostic.ts imports these functions rather than
// re-implementing the logic, so the exact same decisions that run on-device are what get tested here.
//
// COMPLETELY SEPARATE from the frozen M2.1 Phase 6A acceptance harness -- see
// dnsCapabilityDiagnostic.ts's own file-header comment for the full scope boundary. This file does
// not import from, is not imported by, and does not affect phase6AutomatedHarness.ts.
//
// Physical Pixel 10 run (2026-06) found 3 real bugs this module exists to fix structurally rather
// than patch ad hoc: (1) the "Automatic" row hard-polled for ACTIVE_NO_HOSTNAME and timed out even
// though the device was genuinely in Automatic mode (opportunistic DoT legitimately inactive on
// that network); (2) a correctly-observed "Strict" row was force-gated to NOT_TESTABLE because
// protection had dropped to STOPPED by probe time and nothing attempted recovery; (3) "Strict" was
// recorded twice because every retry appended a new row instead of replacing that step's own row.

export type DnsDiagnosticClassification = "CAPTURED" | "BYPASSED" | "UNOBSERVABLE" | "NOT_TESTABLE";

/** Minimal snapshot shape the hard classification gate needs -- a structural subset of
 * DnsDiagnosticTruthSnapshot (see dnsCapabilityTruthSnapshot.ts), duplicated as a narrow local
 * interface (not imported) so this file keeps zero import-time dependency on any RN-importing
 * module. */
export interface GateTruthInputs {
  nativeAvailable: boolean;
  protectionState: string | null;
  tunOpen: boolean | null;
  dnsGatewayActive: boolean | null;
  m1BundleAccepted: boolean | null;
  probeRuleConfirmedInBundle: boolean | null;
  internetContinuityOk: boolean | null;
  /**
   * Condition 8 of the hard invariant (2026-06 SECOND fix round -- code review finding): this is
   * now a REQUIRED, EXPLICIT struct field rather than something a caller had to remember to push
   * into `extraReasons`. Previously a caller that forgot to run its own contradiction check could
   * silently let a mismatched configuration pass the gate -- this makes that structurally
   * impossible: TypeScript itself requires every call site to supply this field. True only when
   * the requested configuration is established/tester-confirmed AND no contradiction was detected
   * against the observed runtime (see describeOffModeContradiction/describeAutomaticModeContradiction
   * and the Strict-hostname-survived-recovery check in dnsCapabilityDiagnostic.ts).
   */
  configurationEstablished: boolean;
  /** Human-readable detail for why `configurationEstablished` is false (or a note when true) --
   * kept separate from the boolean so the gate can still surface the SPECIFIC contradiction text
   * (e.g. "observed STRICT but tester claimed Off") while the boolean itself stays mandatory. */
  configurationNote: string | null;
  truthViolation: { violated: boolean; reasons: string[] };
}

/**
 * User-mandated hard classification invariant (2026-06 DNS wizard fix round): a row may only be
 * classified CAPTURED / BYPASSED / UNOBSERVABLE if ALL of the following hold simultaneously --
 * otherwise it is unconditionally forced to NOT_TESTABLE, regardless of what the raw
 * attribution/receipt evidence would otherwise suggest. Never weakened; no "continue anyway" exists
 * anywhere that can bypass this:
 *   1. native module available
 *   2. M1 signed rule bundle accepted
 *   3. this wizard's dedicated diagnostic probe rule confirmed present in the accepted bundle
 *   4. protection state ACTIVE
 *   5. native TUN open
 *   6. Website Gate DNS gateway active
 *   7. Internet Continuity re-verified PASS (fresh at probe time; never just carried forward from
 *      Preflight without a fresh recheck)
 *   8. the requested configuration is established/tester-confirmed -- `configurationEstablished`,
 *      a REQUIRED explicit field (2026-06 second fix round; was previously only representable via
 *      caller-convention through `extraReasons`, which a caller could forget to populate)
 *   9. no truth-of-state violation flagged anywhere in the snapshot
 * `extraReasons` remains available ONLY for genuinely orthogonal, ad hoc failure reasons that
 * aren't one of the 9 named conditions above (e.g. a ruleset-drift detail, or a DoH
 * attributed-event/receipt self-contradiction) -- never as a substitute for condition 8.
 */
export function evaluateHardClassificationGate(snapshot: GateTruthInputs, extraReasons: string[] = []): string[] {
  const reasons = [...extraReasons];
  if (!snapshot.nativeAvailable) {
    reasons.push("Native module unavailable at probe time (Expo Go / web).");
    return reasons; // nothing else here is meaningfully checkable without native
  }
  if (snapshot.m1BundleAccepted !== true) reasons.push(`M1 signed rule bundle was not confirmed accepted (m1BundleAccepted=${String(snapshot.m1BundleAccepted)}).`);
  if (snapshot.probeRuleConfirmedInBundle !== true) reasons.push(`The dedicated probe rule was not confirmed present in the accepted diagnostic bundle (probeRuleConfirmedInBundle=${String(snapshot.probeRuleConfirmedInBundle)}).`);
  if (snapshot.protectionState !== "ACTIVE") reasons.push(`Protection state was '${snapshot.protectionState}' at probe time, not ACTIVE.`);
  if (snapshot.tunOpen !== true) reasons.push("Native TUN was not confirmed open at probe time.");
  if (snapshot.dnsGatewayActive !== true) reasons.push("Website Gate DNS gateway was not confirmed active at probe time.");
  if (snapshot.internetContinuityOk !== true) reasons.push(`Internet Continuity was not confirmed PASS at probe time (internetContinuityOk=${String(snapshot.internetContinuityOk)}).`);
  if (snapshot.configurationEstablished !== true) reasons.push(snapshot.configurationNote ?? "The requested configuration was not established/tester-confirmed, or contradicted the observed runtime state.");
  if (snapshot.truthViolation.violated) reasons.push(`Truth-of-state violation flagged: ${snapshot.truthViolation.reasons.join(" ")}`);
  return reasons;
}

/** Absence of a capture is NEVER treated as a bypass -- `independentSuccess` must be an
 * independently-observed proof of success (a fresh in-app fetch resolving, or a server-verified
 * receipt), never inferred merely from "nothing was captured". */
export function classifyWithHardGate(
  attributedEvent: boolean,
  independentSuccess: boolean | null,
  snapshot: GateTruthInputs,
  extraReasons: string[] = [],
): { classification: DnsDiagnosticClassification; gateReasons: string[] } {
  const gateReasons = evaluateHardClassificationGate(snapshot, extraReasons);
  if (gateReasons.length > 0) return { classification: "NOT_TESTABLE", gateReasons };
  if (attributedEvent) return { classification: "CAPTURED", gateReasons: [] };
  if (independentSuccess === true) return { classification: "BYPASSED", gateReasons: [] };
  return { classification: "UNOBSERVABLE", gateReasons: [] };
}

// --- Recovery-before-probe sequencing ---

/** True whenever protection is not currently ACTIVE -- the trigger to attempt a bounded, defensive
 * recovery before any probe is allowed to run. */
export function needsRecovery(protectionState: string | null): boolean {
  return protectionState !== "ACTIVE";
}

export interface RecoveryOutcome {
  recoveryAttempted: boolean;
  protectionStateBeforeProbe: string | null;
  protectionStateAfterRecovery: string | null;
  ready: boolean;
  failureReason: string | null;
}

/**
 * Pure decision helper: given a before/after protection-state pair that the caller already
 * observed via real native/SDK reads (this function does no I/O itself), decides whether the row
 * is ready to probe. Recovery is bounded and defensive -- if it was needed and did not result in
 * ACTIVE, `ready` is false and the row must be forced to NOT_TESTABLE by the classification gate;
 * there is no "continue anyway" path anywhere that can override this.
 */
export function decideRecoveryOutcome(before: string | null, after: string | null, recoveryWasAttempted: boolean): RecoveryOutcome {
  if (before === "ACTIVE") {
    return { recoveryAttempted: false, protectionStateBeforeProbe: before, protectionStateAfterRecovery: null, ready: true, failureReason: null };
  }
  if (!recoveryWasAttempted) {
    return {
      recoveryAttempted: false,
      protectionStateBeforeProbe: before,
      protectionStateAfterRecovery: null,
      ready: false,
      failureReason: `Protection was '${before}', not ACTIVE, and no recovery attempt was made.`,
    };
  }
  if (after !== "ACTIVE") {
    return {
      recoveryAttempted: true,
      protectionStateBeforeProbe: before,
      protectionStateAfterRecovery: after,
      ready: false,
      failureReason: `Recovery was attempted but protection settled at '${after}', not ACTIVE.`,
    };
  }
  return { recoveryAttempted: true, protectionStateBeforeProbe: before, protectionStateAfterRecovery: after, ready: true, failureReason: null };
}

// --- Automatic / Off Private DNS configuration contradiction checks ---

export type ObservedPrivateDnsMode = "STRICT" | "ACTIVE_NO_HOSTNAME" | "INACTIVE_OR_OFF" | "UNSUPPORTED_OS_VERSION" | "UNAVAILABLE";

/** "Off" row: Android's public API can never PROVE "Off" was selected. Only a genuinely active
 * encrypted-DNS state (STRICT or ACTIVE_NO_HOSTNAME) contradicts the tester's claim. */
export function describeOffModeContradiction(observedMode: ObservedPrivateDnsMode): string | null {
  if (observedMode === "STRICT" || observedMode === "ACTIVE_NO_HOSTNAME") {
    return `Tester indicated Private DNS was set to Off, but the machine observed '${observedMode}' at probe time, which is inconsistent with Off -- this row's evidence cannot be trusted under the claimed configuration.`;
  }
  return null;
}

/**
 * "Automatic" row (physical-device fix): the wizard must NOT require/poll for ACTIVE_NO_HOSTNAME --
 * Android's opportunistic DoT probe legitimately stays inactive on many networks even with
 * "Automatic" genuinely selected, which is exactly why the prior implementation's hard poll for
 * ACTIVE_NO_HOSTNAME timed out on the Pixel 10 run. INACTIVE_OR_OFF and ACTIVE_NO_HOSTNAME are BOTH
 * consistent with a genuine "Automatic" selection -- accepted as a valid tester-confirmed
 * configuration either way. Only a genuinely STRICT observation is a real contradiction (that means
 * Strict is actually active, not Automatic).
 */
export function describeAutomaticModeContradiction(observedMode: ObservedPrivateDnsMode): string | null {
  if (observedMode === "STRICT") {
    return "Tester indicated Private DNS was set to Automatic, but the machine observed 'STRICT' at probe time, which is inconsistent with Automatic -- this row's evidence cannot be trusted under the claimed configuration.";
  }
  return null;
}

// --- Duplicate-row fix: retries replace the existing row for that wizard step, never append ---

export interface StepKeyed {
  stepId: string;
}

/**
 * Upserts `record` into `records` by `stepId` -- a retry for the SAME step replaces its existing
 * row in place (same position) rather than appending a duplicate. A brand-new step's row is
 * prepended (kept consistent with the wizard's existing most-recent-first convention).
 */
export function upsertRecordByStepId<T extends StepKeyed>(records: T[], record: T): T[] {
  const existingIndex = records.findIndex((r) => r.stepId === record.stepId);
  if (existingIndex === -1) return [record, ...records];
  const next = [...records];
  next[existingIndex] = record;
  return next;
}

// --- Immutable preflight provenance: retries append, never silently overwrite prior attempts ---

export interface AttemptKeyed {
  attemptNumber: number;
}

/**
 * Appends a new, immutable preflight attempt record. Never mutates or replaces a prior attempt --
 * "Retry activation" on the wizard's Preflight step must never silently erase a previously
 * successful attempt's evidence, even if the retry itself later fails.
 */
export function appendPreflightAttempt<T>(attempts: (T & AttemptKeyed)[], attempt: T): (T & AttemptKeyed)[] {
  const attemptNumber = attempts.length + 1;
  return [...attempts, { ...attempt, attemptNumber } as T & AttemptKeyed];
}

/** The attempt that should currently gate wizard progression / feed per-row preflight carry values
 * -- the LATEST attempt. Earlier attempts remain in the array, untouched, for the report/audit. */
export function latestAttempt<T>(attempts: T[]): T | null {
  return attempts.length > 0 ? attempts[attempts.length - 1] : null;
}

/** Was ANY attempt in this session ever a successful, non-violated activation? Report/audit
 * narrative only -- live gating always uses `latestAttempt`, never "was ever ok", since a later
 * genuine failure means the CURRENT live session state is genuinely no longer trustworthy. */
export function anyAttemptEverSucceeded<T extends { ok: boolean }>(attempts: T[]): boolean {
  return attempts.some((a) => a.ok);
}


// --- DNS cache isolation across separate whole-wizard runs (2026-06 FIFTH fix round) ---

export interface DnsCacheFreshnessCheck {
  freshnessGuaranteed: boolean;
  reason: string | null;
}

/**
 * The 5 dedicated probe hostnames (`dnsprobe`..`dnsprobe5.blocktest.btciq.app`) are exact, real DNS
 * records the domain operator provisioned -- confirmed 2026-06 (not under a wildcard, so brand-new
 * per-run hostnames cannot be generated from the app without new external DNS provisioning; TTL on
 * every one of the 5 records was directly confirmed at 30s). Instead, this tracks the last time
 * THIS EXACT host was actually probed (persisted across app restarts / separate whole-wizard runs
 * -- see readHostProbeTimestamps/recordHostProbedNow in dnsCapabilityDiagnostic.ts) and requires a
 * generous safety-margin cooldown (well beyond the confirmed 30s TTL, to also absorb any additional
 * OS-level resolver caching this app cannot directly inspect or flush) before trusting a "no
 * capture, but independent success" result as a genuine BYPASSED verdict.
 *
 * Deliberately only ever needs to gate BYPASSED/UNOBSERVABLE, NEVER CAPTURED: if Apollo observed
 * wire traffic at all, a fresh query genuinely occurred (a cached DNS answer produces zero wire
 * traffic for Apollo to have any chance of seeing) -- callers must only invoke this when there was
 * no attributed capture.
 */
export function checkDnsCacheFreshness(lastProbedAtIso: string | null, nowMs: number, cooldownMs: number): DnsCacheFreshnessCheck {
  if (!lastProbedAtIso) return { freshnessGuaranteed: true, reason: null };
  const elapsedMs = nowMs - new Date(lastProbedAtIso).getTime();
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return { freshnessGuaranteed: true, reason: null }; // unparsable timestamp / clock skew -- never invent a false failure from bad input
  if (elapsedMs >= cooldownMs) return { freshnessGuaranteed: true, reason: null };
  return {
    freshnessGuaranteed: false,
    reason: `This exact probe host was last queried ${Math.round(elapsedMs / 1000)}s ago (cooldown ${Math.round(cooldownMs / 1000)}s, based on the DNS record's own confirmed TTL) -- a successful independent fetch this soon after cannot be trusted as a fresh over-the-wire lookup; it may be served from a cached DNS answer with zero wire traffic for Apollo to have observed.`,
  };
}

// --- Per-host probe-timestamp bookkeeping (pure) ---
//
// The AsyncStorage-backed read/write in dnsCapabilityDiagnostic.ts (readHostProbeTimestamps /
// recordHostProbedNow / markDnsProbeHostQueriedNow) is a thin wrapper around this pure map
// operation -- kept here, dependency-free, so the exact per-host isolation guarantee (probing one
// of the 5 dedicated hosts, e.g. dnsprobe4, must never read, write, or otherwise leak into a
// DIFFERENT host's, e.g. dnsprobe5, own timestamp) is directly `node --test`-able without any
// AsyncStorage/RN mocking.

export type ProbeHostTimestamps = Record<string, string>;

/** Pure, immutable: given the full persisted host->timestamp map, records `host` as probed at
 * `nowIso`. Returns the PREVIOUS timestamp for that exact host only (or null if never probed
 * before) alongside the next full map -- never mutates `map`, and never touches any other host's
 * entry. This is the single place the "does recording one row's probe ever leak into another
 * row's freshness check" guarantee is enforced. */
export function recordHostProbedInMap(map: ProbeHostTimestamps, host: string, nowIso: string): { previous: string | null; next: ProbeHostTimestamps } {
  return { previous: map[host] ?? null, next: { ...map, [host]: nowIso } };
}

// --- Per-attempt PreflightCarry ref resolution (2026-06 SIXTH fix round: browser-return stale-closure bug) ---

/** Structural subset of dnsCapabilityDiagnostic.ts's `PreflightCarry` -- duplicated here (not
 * imported), same zero-RN-dependency reason as `GateTruthInputs` above. */
export interface PreflightCarryLike {
  m1BundleAccepted: boolean | null;
  probeRuleConfirmedInBundle: boolean | null;
  internetContinuityOk: boolean | null;
  configuredUpstreamDnsResolverIpv4: string | null;
}

/** The honest, fully-null default -- deliberately the SAME shape a genuinely-not-yet-attempted
 * Preflight would report, so falling back to it only ever safely forces NOT_TESTABLE via the hard
 * gate, never fabricates a false pass. */
export const SAFE_NULL_PREFLIGHT_CARRY: PreflightCarryLike = {
  m1BundleAccepted: null,
  probeRuleConfirmedInBundle: null,
  internetContinuityOk: null,
  configuredUpstreamDnsResolverIpv4: null,
};

/**
 * Physical Pixel 10 finding (2026-06): both "Use secure DNS" rows recorded protection ACTIVE, a
 * genuine attributed plaintext-UDP/53 capture, AND were still force-classified NOT_TESTABLE with
 * a contradiction claiming the M1 signed bundle was never confirmed accepted -- even though the
 * SAME report's own Preflight section says "M1 protection bundle accepted: yes". Root cause: the
 * screen's `AppState` subscription that drives the browser-return path (`finishDohObservation`)
 * is registered ONCE with an empty effect dependency array, so it only ever runs with that FIRST
 * render's closure -- including whatever the render-scoped `PreflightCarry` object was at MOUNT
 * time (before Preflight activation had even run: `m1BundleAccepted` was still `null` then). Every
 * later browser-return manufactured the exact contradiction seen in the PDF from that stale,
 * closed-over object, never from the real, currently-accepted state.
 *
 * Fix: the screen captures a FRESH `PreflightCarry` into a ref at the START of every
 * `handleStartDohStep` call (always invoked directly from a live onPress, never a stale closure)
 * and reads it back ONLY through this resolver in `finishDohObservation`/
 * `verifyStillHealthyAfterProbe` -- which NEVER falls back to that second, potentially-stale
 * render-scoped variable. If the ref was somehow never populated for this attempt, the honest
 * `SAFE_NULL_PREFLIGHT_CARRY` default is returned instead (safely forces NOT_TESTABLE via the hard
 * gate), never a stale non-null value left over from a previous render/attempt.
 */
export function resolveDohAttemptPreflightCarry(capturedRef: PreflightCarryLike | null): PreflightCarryLike {
  return capturedRef ?? SAFE_NULL_PREFLIGHT_CARRY;
}

// --- DoH attempt metadata (browser name/version + provider/mode) ref resolution (2026-06 NINTH fix round) ---

export interface DohAttemptMeta {
  browserLabel: string;
  providerLabel: string;
}

/** The honest, fully-empty default -- `buildDohConfiguredModeLabel` below renders this as
 * "Unnamed browser" / "NOT RECORDED", the SAME wording a genuinely-never-filled-in attempt would
 * show. Falling back to it only ever honestly documents "nothing was captured for this attempt",
 * never fabricates or leaks a value from a different attempt. */
export const SAFE_EMPTY_DOH_ATTEMPT_META: DohAttemptMeta = { browserLabel: "", providerLabel: "" };

/**
 * Confirmed physical repro (2026-06 NINTH fix round): tester entered "Chrome 152.0.7977.83" into
 * the browser name/version field (and, on the "doh-on" row, a selected provider/mode too), but
 * the EXPORTED REPORT still recorded "Unnamed browser" / "NOT RECORDED" -- not because the field
 * was skipped, but because `finishDohObservation()` was building `configuredMode` by reading the
 * render-scoped `dohBrowserLabel`/`dohProviderLabel` React state DIRECTLY. `finishDohObservation`
 * can run under the SAME mount-time `AppState` closure documented in
 * `resolveDohAttemptPreflightCarry`'s doc comment above -- under that stale closure, those two
 * state variables are frozen at whatever they were AT MOUNT (both empty strings, since the tester
 * had not typed anything yet). Identical root cause, identical fix shape: the screen captures a
 * FRESH `DohAttemptMeta` into a ref at the START of every `handleStartDohStep` call (always
 * invoked live from an onPress, never a stale closure) and reads it back ONLY through this
 * resolver in `finishDohObservation` -- never the render-scoped state variables directly. If the
 * ref was somehow never populated, the honest `SAFE_EMPTY_DOH_ATTEMPT_META` default is returned
 * (same "Unnamed browser"/"NOT RECORDED" wording as before), never a stale non-empty value left
 * over from a previous attempt/row.
 */
export function resolveDohAttemptMeta(capturedRef: DohAttemptMeta | null): DohAttemptMeta {
  return capturedRef ?? SAFE_EMPTY_DOH_ATTEMPT_META;
}

/** Pure: builds the exact `configuredMode`/label string for a DoH row from an ALREADY-RESOLVED
 * `DohAttemptMeta` -- never reads any React state itself, so it is safe to call from a callback
 * running under a stale closure as long as the caller resolved `meta` via `resolveDohAttemptMeta`
 * (browser-return path) or supplied it live (launch-time path) first. `stepLabel` is the
 * caller-supplied human label for the step (e.g. "Use secure DNS — Off") -- kept as a plain string
 * parameter, never an app-specific constant import, so this file keeps its zero-RN-dependency
 * contract. */
export function buildDohConfiguredModeLabel(step: "doh-off" | "doh-on", stepLabel: string, meta: DohAttemptMeta, extraSuffix = ""): string {
  const browser = meta.browserLabel.trim() || "Unnamed browser";
  const providerPart = step === "doh-on" ? ` (selected provider/mode: ${meta.providerLabel.trim() || "NOT RECORDED"})` : "";
  return `${browser} — ${stepLabel}${providerPart}${extraSuffix}`;
}

// --- Truth violation vs readiness concern split (2026-06 SEVENTH fix round) ---

export interface TruthViolationInputs {
  protectionState: string | null;
  isVpnConsentRequired: boolean;
  dnsGatewayActive: boolean;
  tunOpen: boolean;
  m1BundleAccepted: boolean | null;
  probeRuleConfirmedInBundle: boolean | null;
  internetContinuityOk: boolean | null;
}

export interface TruthViolationResult {
  truthViolation: { violated: boolean; reasons: string[] };
  /** A per-row ENVIRONMENTAL readiness concern -- deliberately distinct from a genuine internal
   * self-contradiction in Apollo's own reported state. Physical Pixel 10 finding (2026-06
   * SEVENTH round): `dnsGatewayActive=true` + `internetContinuityOk=false` observed at a PER-ROW
   * `ensureProbeReadiness()` re-check (added specifically to catch continuity degrading well after
   * Preflight's own one-time check, e.g. because Android system Private DNS Strict was still
   * active) is NOT a contradiction in Apollo's own state machine -- the Website Gate genuinely
   * being "active" says nothing about whether ordinary internet happens to work at that exact
   * moment; that is precisely what the separate per-row continuity re-check exists to catch, and
   * it did, correctly forcing that row to NOT_TESTABLE. Previously this combination was flagged as
   * a `truthViolation` with wording claiming "the wizard should have stopped, not continued" --
   * misleading on rows where the wizard's OWN readiness check had already correctly halted the
   * probe. Kept as a separate, honestly-worded field so a later interpretation layer can
   * distinguish "the environment wasn't healthy enough to test right now" from "the app's own
   * state contradicts itself" -- with ZERO change to the hard gate's classification outcome:
   * NOT_TESTABLE is still forced either way via `internetContinuityOk`'s own independent gate
   * condition in `evaluateHardClassificationGate`. */
  readinessConcern: string | null;
}

/** Same 5 genuine-self-contradiction checks as before, PLUS the dnsGatewayActive+!internetContinuityOk
 * combination now returned as a separate `readinessConcern` instead of a 6th `truthViolation`
 * reason (see doc comment above for why). Callers (dnsCapabilityTruthSnapshot.ts) attach both
 * fields to the truth-of-state snapshot; report/UI layers render them under clearly different,
 * differently-worded/colored labels. */
export function computeTruthViolationAndReadinessConcern(args: TruthViolationInputs): TruthViolationResult {
  const reasons: string[] = [];
  if (args.protectionState === "ACTIVE" && args.isVpnConsentRequired) {
    reasons.push("Protection state reports ACTIVE but the OS reports VPN consent is currently required -- contradictory.");
  }
  if (args.dnsGatewayActive && !args.tunOpen) {
    reasons.push("Website Gate DNS gateway reports active but the native TUN is reportedly not open -- contradictory.");
  }
  if (args.dnsGatewayActive && args.protectionState !== "ACTIVE") {
    reasons.push(`Website Gate DNS gateway reports active while protection state is "${args.protectionState ?? "unknown"}" (not ACTIVE) -- stale/invalid combination.`);
  }
  if (args.protectionState === "ACTIVE" && args.m1BundleAccepted !== true) {
    reasons.push(`Protection state reports ACTIVE but the M1 signed rule bundle is not confirmed accepted (m1BundleAccepted=${String(args.m1BundleAccepted)}) -- contradictory.`);
  }
  if (args.probeRuleConfirmedInBundle === false) {
    reasons.push("The dedicated probe rule is NOT confirmed present in the accepted signed bundle -- any capture below would be unattributable.");
  }
  const readinessConcern =
    args.dnsGatewayActive && args.internetContinuityOk === false
      ? "Website Gate DNS gateway reports active but Internet Continuity failed at this snapshot's capture time -- ordinary browsing was not confirmed working right now. This is a per-row ENVIRONMENTAL readiness failure (already independently forced NOT_TESTABLE via the hard gate's own continuity condition), not a contradiction in Apollo's own reported state."
      : null;
  return { truthViolation: { violated: reasons.length > 0, reasons }, readinessConcern };
}
