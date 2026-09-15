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
 *   7. Internet Continuity re-verified PASS (fresh at probe time -- see `extraReasons`/caller;
 *      never just carried forward from Preflight without a fresh recheck)
 *   8. the requested configuration is established/tester-confirmed (checked by the caller via
 *      `extraReasons` -- e.g. a Private DNS runtime-mode contradiction, or a readiness/recovery
 *      failure reason)
 *   9. no truth-of-state violation flagged anywhere in the snapshot
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
