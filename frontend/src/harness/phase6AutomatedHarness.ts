// Gate Guard M2.1 Phase 6A: fully-automated physical-device acceptance orchestrator.
//
// Design principle (frozen for this file): the tester performs ONLY actions Android will not let
// this app perform on itself (revoking its own VPN permission, forcing itself to restart, toggling
// system network radios, changing the system Private DNS setting). Every outcome that software CAN
// observe and judge is judged by this file automatically -- never by asking the tester to interpret
// logs, evidence IDs, or timestamps. See ask_human/finish thread "Phase 6A: Automated Physical-Device
// Acceptance" for the full product requirement this file implements.
//
// This file is a pure orchestration/decision engine (no React). It drives ONLY the frozen public
// GuardDogSecuritySDK surface plus the harness-only read-only diagnostics already used by
// androidBlockingProofHarness.ts (getRecoveryStatus, isVpnConsentRequired) -- it never fabricates,
// infers, or upgrades an absence of evidence into a PASS. THREAT_BLOCKED remains evidence-backed only.
//
// HARNESS-WIDE RULE (frozen, applies to every row in this file): a row may only return PASS from
// evidence collected SPECIFICALLY for that row. No inherited PASS ("row 1.2 is fine because 1.1
// passed"), no inferred PASS, no "same as the previous row" shortcut. If a row's own evidence cannot
// be independently collected this run (for reasons unrelated to enforcement correctness -- timing,
// a skipped precondition, a declined re-consent prompt, etc.), it must return NOT_TESTED with an
// honest reasonCode, never PASS and never a fabricated FAIL. See the 2026-09 acceptance-criteria
// tightening pass (rows 1.2, 3.2, 3.3, 3.4, 3.5) for the frozen per-row definitions this rule governs.
import { Platform } from "react-native";

import { readNativeWebsiteGateOverrides, readRecoveryStatus, readVpnConsentRequired } from "@/src/harness/recoveryDiagnostics";
import { fetchLatestBundle, fetchM1Config, toProtectionConfig, type M1Config } from "@/src/harness/ruleBundleFixtures";
import {
  observeBlockedEventWindow,
  runNegativeTest,
  runPositiveEnforcementTest,
  triggerDnsViaFetch,
  type NegativeTestKind,
} from "@/src/harness/phase6WebsiteGateHarness";
import type { SignedRuleBundle } from "@/src/contracts/shared/ruleBundle.ts";
import { GuardDogSecuritySDK } from "@/src/sdk/GuardDogSecuritySDK";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();

// --- Canonical machine states (the six the product requirement specifies, plus NOT_TESTED -- added
// 2026-09 for rows whose own evidence genuinely could not be collected this run; see the
// harness-wide rule above. NOT_TESTED is never a synonym for PASS or FAIL.) ---
export type Phase6StepVerdict = "PASS" | "FAIL" | "PRECONDITION_FAILURE" | "CAPABILITY_GAP" | "UNOBSERVABLE" | "NOT_TESTABLE" | "NOT_TESTED" | "PENDING";

export interface Phase6StepResult {
  id: string;
  group: 0 | 1 | 2 | 3 | 4;
  title: string;
  verdict: Phase6StepVerdict;
  /** Machine-readable, stable identifier for this exact decision -- never free text. */
  reasonCode: string;
  /** Human-readable explanation of the same decision -- always paired with reasonCode, never alone. */
  explanation: string;
  evidence: Record<string, unknown>;
  startedAt: string | null;
  completedAt: string | null;
}

export type Phase6RunPhase =
  | "idle"
  | "provenance"
  | "native-check"
  | "consent"
  | "config"
  | "start-protection"
  | "gate-active"
  | "clear-override"
  | "positive"
  | "negative"
  | "recovery-stop"
  | "awaiting-revoke"
  | "awaiting-restart"
  | "reactivate-for-network"
  | "awaiting-network"
  | "dns-capability"
  | "done";

export interface Phase6RunState {
  runId: string;
  startedAt: string;
  updatedAt: string;
  phase: Phase6RunPhase;
  testDomain: string;
  matchingRuleId: string;
  provenance: Record<string, unknown>;
  device: Record<string, unknown>;
  /** Precondition checks (group 0): native module present, consent, protection ACTIVE, gate active. */
  preconditions: Phase6StepResult[];
  /** Every graded matrix row, groups 1-4. */
  steps: Phase6StepResult[];
  negativeQueueIndex: number;
  networkTypeBeforeToggle: string | null;
  /** Canonical host of the dedicated, disposable ALLOW override created just before the tester
   * restarts the app (row 3.3's rehydration check) -- null once cleaned up / if never created.
   * Never the same host as testDomain; never left behind after the run touches it. */
  overrideProbeHost: string | null;
  rejectedEventCountAtStart: number;
  truthOfStateViolation: boolean;
  awaitingInstruction: string | null;
  /** ISO timestamp of when the CURRENT awaiting-* phase started -- used only to drive the UI's
   * ACTION_REQUIRED / WAITING_FOR_CONFIRMATION / ACTION_NOT_DETECTED sub-state timeline. Never
   * affects any verdict: a slow tester is not a test failure. */
  awaitingSince: string | null;
  /** Number of "is it done yet?" checks performed against the CURRENT awaiting-* phase without a
   * positive detection. UI-only counter, same non-verdict-affecting rule as awaitingSince. */
  awaitingAttempts: number;
  overallVerdict: "PASS" | "FAIL" | "PRECONDITION_FAILURE" | "PASS_WITH_CAPABILITY_GAP" | "PASS_WITH_UNVERIFIED_ROWS" | null;
  overallReasonCode: string | null;
  overallExplanation: string | null;
  completedAt: string | null;
  log: string[];
}

export const NEGATIVE_KINDS: NegativeTestKind[] = ["rule-match-alone", "manual-override", "local-analysis-only", "gate-start-alone", "failed-dns-forward"];

const NEGATIVE_TITLES: Record<NegativeTestKind, string> = {
  "rule-match-alone": "Rule match alone (no packet ever transits TUN) does not emit THREAT_BLOCKED",
  "manual-override": "Manual local ALLOW override does not emit THREAT_BLOCKED",
  "local-analysis-only": "Local URL/domain analysis verdict alone does not emit THREAT_BLOCKED",
  "gate-start-alone": "Website Gate starting (configure + accept bundle) alone does not emit THREAT_BLOCKED",
  "failed-dns-forward": "A failed/errored DNS forward (fail-open path) does not emit THREAT_BLOCKED",
};
const NEGATIVE_ROW_ID: Record<NegativeTestKind, string> = {
  "rule-match-alone": "2.1",
  "manual-override": "2.2",
  "local-analysis-only": "2.3",
  "gate-start-alone": "2.4",
  "failed-dns-forward": "2.5",
};

export const START_PROTECTION_TIMEOUT_MS = 15_000;
export const GATE_ACTIVE_TIMEOUT_MS = 10_000;
export const POLL_MS = 250;
export const POSITIVE_WINDOW_MS = 20_000;
export const NEGATIVE_WINDOW_MS = 6_000;
export const RECOVERY_TIMEOUT_MS = 20_000;
/** UI-only: how long the screen waits without a positive detection before offering the tester a
 * "didn't detect it yet" recovery card (Try again / Open Settings). Never affects any verdict --
 * see Phase6RunState.awaitingSince. */
export const AWAITING_ACTION_TIMEOUT_MS = 45_000;

export function createInitialRun(testDomain: string, matchingRuleId: string): Phase6RunState {
  const now = nowIso();
  return {
    runId: `phase6a-${Date.now()}`,
    startedAt: now,
    updatedAt: now,
    phase: "idle",
    testDomain,
    matchingRuleId,
    provenance: {},
    device: {},
    preconditions: [],
    steps: [],
    negativeQueueIndex: 0,
    networkTypeBeforeToggle: null,
    overrideProbeHost: null,
    rejectedEventCountAtStart: GuardDogSecuritySDK.rejectedEventCount,
    truthOfStateViolation: false,
    awaitingInstruction: null,
    awaitingSince: null,
    awaitingAttempts: 0,
    overallVerdict: null,
    overallReasonCode: null,
    overallExplanation: null,
    completedAt: null,
    log: [],
  };
}

function step(id: string, group: 0 | 1 | 2 | 3 | 4, title: string, verdict: Phase6StepVerdict, reasonCode: string, explanation: string, evidence: Record<string, unknown>, startedAt: string, completedAt = nowIso()): Phase6StepResult {
  return { id, group, title, verdict, reasonCode, explanation, evidence, startedAt, completedAt };
}

function withLog(run: Phase6RunState, line: string): Phase6RunState {
  return { ...run, log: [...run.log, `${nowIso()} — ${line}`], updatedAt: nowIso() };
}

/** Checks the global Truth-of-State safety net: ANY security event the native bridge rejected during
 * this run (malformed THREAT_BLOCKED lacking a valid enforcementEvidenceId, wrong source, etc.) forces
 * a violation regardless of what any individual step otherwise concluded. */
function checkTruthOfStateSafetyNet(run: Phase6RunState): Phase6RunState {
  const rejectedDuringRun = GuardDogSecuritySDK.rejectedEventCount - run.rejectedEventCountAtStart;
  if (rejectedDuringRun > 0 && !run.truthOfStateViolation) {
    return withLog({ ...run, truthOfStateViolation: true }, `TRUTH-OF-STATE ALERT: ${rejectedDuringRun} security event(s) rejected by bridge validation during this run -- forcing overall FAIL regardless of other results.`);
  }
  return run;
}

function stopWithPrecondition(run: Phase6RunState, reasonCode: string, title: string, explanation: string, evidence: Record<string, unknown>, startedAt: string): Phase6RunState {
  const s = step(`pre-${reasonCode}`, 0, title, "PRECONDITION_FAILURE", reasonCode, explanation, evidence, startedAt);
  return finalizeRun(withLog({ ...run, preconditions: [...run.preconditions, s], phase: "done" }, `PRECONDITION FAILURE: ${explanation}`));
}

/** Row 3.4 (and its companion sanity row 3.5) require a genuinely ACTIVE, gate-active session to
 * mean anything -- if reactivating that session fails for any reason, both rows are honestly
 * NOT_TESTED (never a fabricated FAIL of "the transition itself", since the transition was never
 * reached) and the run continues on to the DNS-capability check rather than hard-stopping and
 * discarding everything rows 1.1-3.3 already proved. */
function skipNetworkActiveTest(run: Phase6RunState, reasonCode: string, explanation: string, evidence: Record<string, unknown>, startedAt: string): Phase6RunState {
  const s34 = step("3.4", 3, "Active network transition (Wi-Fi ↔ cellular) while protection is genuinely ACTIVE → truthful state, and (if it stays active) proven recovery", "NOT_TESTED", reasonCode, explanation, evidence, startedAt);
  const s35 = step("3.5", 3, "Post-transition positive sanity check → enforcement still genuinely functions after the transition", "NOT_TESTED", "NOT_APPLICABLE_REACTIVATION_FAILED", "Row 3.4's precondition (a genuinely ACTIVE, gate-active session) could not be re-established this run -- a sanity check is not applicable.", {}, startedAt);
  return withLog({ ...run, steps: [...run.steps, s34, s35], phase: "dns-capability", awaitingInstruction: null, awaitingSince: null, awaitingAttempts: 0 }, `Network-transition-while-active test (3.4/3.5) skipped: ${reasonCode}. Continuing to the DNS-capability check.`);
}

function finalizeRun(run: Phase6RunState): Phase6RunState {
  const checked = checkTruthOfStateSafetyNet(run);
  if (checked.truthOfStateViolation) {
    return { ...checked, overallVerdict: "FAIL", overallReasonCode: "TRUTH_OF_STATE_VIOLATION", overallExplanation: "A security event failed bridge validation during this run (malformed/incomplete THREAT_BLOCKED). This overrides every other result: FAIL.", completedAt: nowIso(), phase: "done" };
  }
  const precondFail = checked.preconditions.find((p) => p.verdict === "PRECONDITION_FAILURE");
  if (precondFail) {
    return { ...checked, overallVerdict: "PRECONDITION_FAILURE", overallReasonCode: precondFail.reasonCode, overallExplanation: precondFail.explanation, completedAt: nowIso(), phase: "done" };
  }
  const enforcementFail = checked.steps.find((s) => s.group !== 4 && s.verdict === "FAIL");
  if (enforcementFail) {
    return { ...checked, overallVerdict: "FAIL", overallReasonCode: `ROW_${enforcementFail.id}_FAILED`, overallExplanation: `Row ${enforcementFail.id} (${enforcementFail.title}) — ${enforcementFail.explanation}`, completedAt: nowIso(), phase: checked.phase };
  }
  const group4Fail = checked.steps.find((s) => s.group === 4 && s.verdict === "FAIL");
  if (group4Fail) {
    return { ...checked, overallVerdict: "FAIL", overallReasonCode: `ROW_${group4Fail.id}_FAILED`, overallExplanation: `Row ${group4Fail.id} (${group4Fail.title}) — ${group4Fail.explanation}`, completedAt: nowIso(), phase: checked.phase };
  }
  const group4Gap = checked.steps.find((s) => s.group === 4 && s.verdict === "CAPABILITY_GAP");
  const requiredGroupsFilled = checked.steps.filter((s) => s.group === 1 || s.group === 2 || s.group === 3).length >= 7; // 2+5 auto + at least stop
  if (!requiredGroupsFilled) {
    return { ...checked, overallVerdict: null, overallReasonCode: null, overallExplanation: null };
  }
  const group123NotTested = checked.steps.filter((s) => (s.group === 1 || s.group === 2 || s.group === 3) && s.verdict === "NOT_TESTED");
  if (group123NotTested.length > 0) {
    const ids = group123NotTested.map((s) => s.id).join(", ");
    return {
      ...checked,
      overallVerdict: "PASS_WITH_UNVERIFIED_ROWS",
      overallReasonCode: `ROWS_NOT_TESTED_${group123NotTested.map((s) => s.id.replace(/\./g, "_")).join("_")}`,
      overallExplanation: `No acceptance-critical row failed, but row(s) ${ids} could not be independently verified this run (see each row's own reasonCode for why -- a declined re-consent, a timing/precondition gap, etc.; never treated as an inherited or inferred PASS). Re-run to obtain a determinate PASS/FAIL on ${ids} before treating this as full acceptance.`,
      completedAt: nowIso(),
      phase: checked.phase,
    };
  }
  if (group4Gap) {
    return { ...checked, overallVerdict: "PASS_WITH_CAPABILITY_GAP", overallReasonCode: `ROW_${group4Gap.id}_CAPABILITY_GAP`, overallExplanation: `All required enforcement rows passed. Row ${group4Gap.id} (${group4Gap.title}) documents a real, evidence-backed capability gap — not a failure.`, completedAt: nowIso(), phase: checked.phase };
  }
  return { ...checked, overallVerdict: "PASS", overallReasonCode: "ALL_REQUIRED_ROWS_PASSED", overallExplanation: "Every Group 1-3 row passed with a full observed evidence chain (or a confirmed correct absence of evidence for negative/recovery rows).", completedAt: nowIso(), phase: checked.phase };
}

/**
 * Runs every auto-continuing phase in sequence, calling `onProgress` after each state transition so
 * the caller can persist to AsyncStorage and re-render immediately (crash/kill mid-run never loses
 * evidence already captured). Stops automatically at the next phase that requires a physical,
 * OS-level action from the tester ("awaiting-*") or at "done".
 */
export async function runToNextPause(initial: Phase6RunState, onProgress: (run: Phase6RunState) => void): Promise<Phase6RunState> {
  let run = initial;
  const PAUSING = new Set<Phase6RunPhase>(["awaiting-revoke", "awaiting-restart", "awaiting-network", "dns-capability", "done", "idle"]);
  while (true) {
    run = await performPhase(run);
    onProgress(run);
    if (PAUSING.has(run.phase)) return run;
  }
}

async function performPhase(run: Phase6RunState): Promise<Phase6RunState> {
  switch (run.phase) {
    case "idle":
      return withLog({ ...run, phase: "provenance" }, "Starting automated acceptance run.");

    case "provenance":
      return withLog({ ...run, phase: "native-check" }, "Provenance capture delegated to the screen (device/build info) — advancing.");

    case "native-check": {
      const startedAt = nowIso();
      if (!GuardDogSecuritySDK.nativeAvailable) {
        return stopWithPrecondition(run, "NATIVE_MODULE_UNAVAILABLE", "Native module available", "GuardDogSecurity native module is not present in this runtime (Expo Go / web). Phase 6A requires a physical Android build — nothing further was attempted.", { platform: Platform.OS }, startedAt);
      }
      const s = step("pre-native", 0, "Native module available", "PASS", "NATIVE_MODULE_PRESENT", "com.guarddog.* native module responded to the bridge.", {}, startedAt);
      return withLog({ ...run, preconditions: [...run.preconditions, s], phase: "consent" }, "Native module present — checking VPN consent.");
    }

    case "consent": {
      const startedAt = nowIso();
      const consentRequired = readVpnConsentRequired();
      if (!consentRequired) {
        const s = step("pre-consent", 0, "VPN consent", "PASS", "CONSENT_ALREADY_GRANTED", "OS already holds VPN consent for this app; no dialog needed.", { consentRequired }, startedAt);
        return withLog({ ...run, preconditions: [...run.preconditions, s], phase: "config" }, "VPN consent already granted — configuring rule bundles.");
      }
      const outcome = await GuardDogSecuritySDK.requestPermission("vpn");
      if (outcome !== "granted") {
        return stopWithPrecondition(run, "VPN_CONSENT_DENIED", "VPN consent", `Android VPN consent prompt result: ${outcome}. Enforcement cannot run without it.`, { outcome }, startedAt);
      }
      const s = step("pre-consent", 0, "VPN consent", "PASS", "CONSENT_GRANTED_ONCE", "Android VPN consent prompt shown once and granted.", { outcome }, startedAt);
      return withLog({ ...run, preconditions: [...run.preconditions, s], phase: "config" }, "VPN consent granted — configuring rule bundles.");
    }

    case "config": {
      const startedAt = nowIso();
      try {
        const m1: M1Config = await fetchM1Config();
        GuardDogSecuritySDK.configure(toProtectionConfig(m1));
        const m1Bundle: SignedRuleBundle = await fetchLatestBundle(m1.rulesetId);
        const m1Accept = GuardDogSecuritySDK.acceptRuleBundle(m1Bundle);
        const m2RulesetId = m1.gateGuard?.websiteGateRulesetId;
        if (!m2RulesetId) {
          return stopWithPrecondition(run, "NO_M2_RULESET_CONFIGURED", "Website Gate ruleset available", "Backend /api/config did not return gateGuard.websiteGateRulesetId — cannot configure the Website Gate.", { m1 }, startedAt);
        }
        const m2Bundle: SignedRuleBundle = await fetchLatestBundle(m2RulesetId);
        GuardDogSecuritySDK.configureWebsiteGate({});
        const m2Accept = GuardDogSecuritySDK.acceptWebsiteGateRuleBundle(m2Bundle);
        await GuardDogSecuritySDK.hydrateWebsiteGateOverrides();
        if (!m1Accept.accepted || !m2Accept.accepted) {
          return stopWithPrecondition(run, "RULE_BUNDLE_NOT_ACCEPTED", "Signed rule bundles accepted", `M1 accepted=${m1Accept.accepted} (${m1Accept.rejectReason ?? "-"}); M2 accepted=${m2Accept.accepted} (${m2Accept.rejectReason ?? "-"}).`, { m1Accept, m2Accept }, startedAt);
        }
        const blockRule = m2Bundle.payload.rules.find((r) => r.action === "block");
        const testDomain = blockRule?.host ?? run.testDomain;
        const matchingRuleId = blockRule?.ruleId ?? run.matchingRuleId;
        const s = step("pre-config", 0, "Signed rule bundles accepted", "PASS", "M1_M2_BUNDLES_ACCEPTED", `M1 ruleset ${m1.rulesetId} v${m1Accept.bundleVersion}; M2 ruleset ${m2RulesetId} v${m2Accept.bundleVersion}.`, { m1Accept, m2Accept, testDomain }, startedAt);
        return withLog({ ...run, testDomain, matchingRuleId, preconditions: [...run.preconditions, s], phase: "start-protection" }, `Rule bundles accepted. Authorized test domain: ${testDomain} (rule ${matchingRuleId}).`);
      } catch (e) {
        return stopWithPrecondition(run, "CONFIG_FETCH_FAILED", "Signed rule bundles accepted", `Could not fetch/accept config or bundles: ${e instanceof Error ? e.message : String(e)}`, {}, startedAt);
      }
    }

    case "start-protection": {
      const startedAt = nowIso();
      let status;
      try {
        status = await GuardDogSecuritySDK.startProtection();
      } catch (e) {
        return stopWithPrecondition(run, "PROTECTION_NOT_ACTIVE", "startProtection() reaches ACTIVE", `startProtection() threw: ${e instanceof Error ? e.message : String(e)}`, {}, startedAt);
      }
      const deadline = Date.now() + START_PROTECTION_TIMEOUT_MS;
      while (status.state !== "ACTIVE" && status.state !== "FAILED" && status.state !== "STOPPED" && status.state !== "REVOKED" && Date.now() < deadline) {
        await sleep(POLL_MS);
        status = GuardDogSecuritySDK.getProtectionState();
      }
      if (status.state !== "ACTIVE") {
        return stopWithPrecondition(run, "PROTECTION_NOT_ACTIVE", "startProtection() reaches ACTIVE", `Protection state settled at ${status.state} (reason: ${status.reason ?? "none given"}) instead of ACTIVE within ${START_PROTECTION_TIMEOUT_MS}ms. Stopping immediately — no positive-test traffic was sent.`, { finalState: status.state, reason: status.reason }, startedAt);
      }
      const s = step("pre-active", 0, "startProtection() reaches ACTIVE", "PASS", "PROTECTION_ACTIVE", "Protection state settled at ACTIVE within timeout.", { finalState: status.state }, startedAt);
      return withLog({ ...run, preconditions: [...run.preconditions, s], phase: "gate-active" }, "Protection ACTIVE — waiting for the Website Gate DNS pipeline to come up.");
    }

    case "gate-active": {
      const startedAt = nowIso();
      const deadline = Date.now() + GATE_ACTIVE_TIMEOUT_MS;
      let gateStatus = GuardDogSecuritySDK.getWebsiteGateStatus();
      while (!gateStatus.dnsGatewayActive && Date.now() < deadline) {
        await sleep(POLL_MS);
        gateStatus = GuardDogSecuritySDK.getWebsiteGateStatus();
      }
      if (!gateStatus.dnsGatewayActive) {
        return stopWithPrecondition(run, "DNS_GATEWAY_NOT_ACTIVE_AFTER_RETRIES", "dnsGatewayActive === true", `dnsGatewayActive stayed false for ${GATE_ACTIVE_TIMEOUT_MS}ms after protection reached ACTIVE (configured=${gateStatus.configured}). Per the fixed acceptance invariant, no positive-test traffic may be sent while this is false — stopping immediately as a precondition failure, not an enforcement FAIL.`, { gateStatus }, startedAt);
      }
      const s = step("pre-gate", 0, "dnsGatewayActive === true", "PASS", "DNS_GATEWAY_ACTIVE", "Live TUN session confirmed the DNS gateway pipeline is active.", { gateStatus }, startedAt);
      return withLog({ ...run, preconditions: [...run.preconditions, s], phase: "clear-override" }, "Website Gate DNS pipeline active — clearing any stale ALLOW override for the test domain.");
    }

    case "clear-override": {
      const startedAt = nowIso();
      await GuardDogSecuritySDK.removeWebsiteGateAllowOverride(run.testDomain);
      const s = step("pre-override", 0, "Stale test-domain override cleared", "PASS", "OVERRIDE_CLEARED", `Removed any ALLOW override for ${run.testDomain} only — no other overrides touched.`, { testDomain: run.testDomain }, startedAt);
      return withLog({ ...run, preconditions: [...run.preconditions, s], phase: "positive" }, `Cleared any stale override for ${run.testDomain}. Running positive enforcement test.`);
    }

    case "positive": {
      const startedAt = nowIso();
      const statsBefore = GuardDogSecuritySDK.getEnforcementStats();
      const evidence = await runPositiveEnforcementTest(run.testDomain, POSITIVE_WINDOW_MS);
      const statsAfter = GuardDogSecuritySDK.getEnforcementStats();
      const tunEvidence = !!statsAfter && !!statsBefore && statsAfter.observedMatching > statsBefore.observedMatching && statsAfter.droppedMatching > statsBefore.droppedMatching;
      const full = !!evidence.blockedEvent?.enforcementEvidenceId && tunEvidence;
      const s1: Phase6StepResult = full
        ? step("1.1", 1, "Authorized blocked domain → full chain observed", "PASS", "FULL_EVIDENCE_CHAIN_OBSERVED", `THREAT_BLOCKED evidenceId=${evidence.blockedEvent!.enforcementEvidenceId} matched real TUN packet observation + intentional drop.`, { evidence, statsBefore, statsAfter }, startedAt)
        : step("1.1", 1, "Authorized blocked domain → full chain observed", "FAIL", evidence.blockedEvent ? "EVENT_WITHOUT_TUN_EVIDENCE" : "NO_EVIDENCE_WITHIN_WINDOW", evidence.blockedEvent ? "A THREAT_BLOCKED event arrived but native TUN drop-reporter counters do not corroborate a real packet observation/drop." : `No THREAT_BLOCKED event observed within ${POSITIVE_WINDOW_MS}ms of triggering traffic to the authorized test domain.`, { evidence, statsBefore, statsAfter }, startedAt);

      // Row 1.2 (2026-09 tightened definition): a GENUINELY separate second request to the SAME
      // domain, while the Website Gate binding row 1.1 just exercised is still live -- its own fresh
      // fetch, its own fresh TUN observation, its own enforcement outcome. Never inherits 1.1's PASS
      // (harness-wide rule at the top of this file). Only attempted if 1.1 established a real
      // baseline binding to repeat against.
      let s2: Phase6StepResult;
      if (s1.verdict !== "PASS") {
        s2 = step("1.2", 1, "Genuine second, independent request under the still-live binding → new evidence or a correctly deduplicated retry", "NOT_TESTED", "SKIPPED_NO_BASELINE", "Not independently evaluated because row 1.1 did not establish a live, evidence-backed binding to repeat against.", {}, startedAt);
      } else {
        const startedAt2 = nowIso();
        const statsBefore2 = GuardDogSecuritySDK.getEnforcementStats();
        const evidence2 = await runPositiveEnforcementTest(run.testDomain, POSITIVE_WINDOW_MS);
        const statsAfter2 = GuardDogSecuritySDK.getEnforcementStats();
        const tunEvidence2 = !!statsAfter2 && !!statsBefore2 && statsAfter2.observedMatching > statsBefore2.observedMatching && statsAfter2.droppedMatching > statsBefore2.droppedMatching;
        const priorEvidenceId = evidence.blockedEvent?.enforcementEvidenceId ?? null;
        const newEvidenceRecord = !!evidence2.blockedEvent?.enforcementEvidenceId && evidence2.blockedEvent.enforcementEvidenceId !== priorEvidenceId;
        const dedupedRetryAttributed = !evidence2.blockedEvent && (statsAfter2?.dedupedRetries ?? 0) > (statsBefore2?.dedupedRetries ?? 0);
        const evidence2Bundle = { evidence2, statsBefore2, statsAfter2, priorEvidenceId };
        if (!tunEvidence2) {
          s2 = step("1.2", 1, "Genuine second, independent request under the still-live binding → new evidence or a correctly deduplicated retry", "NOT_TESTED", "SECOND_REQUEST_NOT_INDEPENDENTLY_OBSERVED", "The second request to the still-live binding was not independently observed at the TUN layer within the window -- cannot confirm or deny a genuine repeat this run; re-run for a determinate result.", evidence2Bundle, startedAt2);
        } else if (newEvidenceRecord) {
          s2 = step("1.2", 1, "Genuine second, independent request under the still-live binding → new evidence or a correctly deduplicated retry", "PASS", "SECOND_REQUEST_NEW_EVIDENCE_RECORD", `A second, independently-triggered request to the still-live binding produced its OWN new evidence record (evidenceId=${evidence2.blockedEvent!.enforcementEvidenceId}, distinct from row 1.1's ${priorEvidenceId}) with corroborating TUN observation/drop.`, evidence2Bundle, startedAt2);
        } else if (dedupedRetryAttributed) {
          s2 = step("1.2", 1, "Genuine second, independent request under the still-live binding → new evidence or a correctly deduplicated retry", "PASS", "SECOND_REQUEST_CORRECTLY_DEDUPED", `A second, independently-triggered request produced a genuine TUN observation/drop, correctly attributed as a deduplicated retry of the still-live binding (dedupedRetries incremented) rather than re-emitting a duplicate event.`, evidence2Bundle, startedAt2);
        } else {
          s2 = step("1.2", 1, "Genuine second, independent request under the still-live binding → new evidence or a correctly deduplicated retry", "FAIL", "SECOND_OBSERVATION_UNACCOUNTED", "A second packet was genuinely observed and dropped at the TUN layer, but neither a new evidence record nor an incremented dedupedRetries counter accounts for it -- inconsistent enforcement bookkeeping for a repeat under the same binding.", evidence2Bundle, startedAt2);
        }
      }
      return withLog({ ...run, steps: [...run.steps, s1, s2], phase: "negative" }, `Positive enforcement test: 1.1=${s1.verdict} (${s1.reasonCode}); 1.2=${s2.verdict} (${s2.reasonCode}).`);
    }

    case "negative": {
      const kind = NEGATIVE_KINDS[run.negativeQueueIndex];
      const startedAt = nowIso();
      let evidence;
      if (kind === "rule-match-alone") {
        evidence = await runNegativeTest(kind, () => {}, NEGATIVE_WINDOW_MS);
      } else if (kind === "manual-override") {
        evidence = await runNegativeTest(
          kind,
          async () => {
            await GuardDogSecuritySDK.setWebsiteGateAllowOverride(run.testDomain);
          },
          NEGATIVE_WINDOW_MS,
        );
      } else if (kind === "local-analysis-only") {
        evidence = await runNegativeTest(
          kind,
          () => {
            GuardDogSecuritySDK.analyzeUrl(`https://${run.testDomain}/`);
          },
          NEGATIVE_WINDOW_MS,
        );
      } else if (kind === "gate-start-alone") {
        evidence = await runNegativeTest(
          kind,
          async () => {
            GuardDogSecuritySDK.configureWebsiteGate({});
          },
          NEGATIVE_WINDOW_MS,
        );
      } else {
        evidence = await runNegativeTest(
          kind,
          async () => {
            await triggerDnsViaFetch(`nonexistent-${Date.now()}.invalid-test.example`, 4000);
          },
          NEGATIVE_WINDOW_MS,
        );
      }
      const unexpected = !!evidence.observedEvent;
      const s = step(NEGATIVE_ROW_ID[kind], 2, NEGATIVE_TITLES[kind], unexpected ? "FAIL" : "PASS", unexpected ? "UNEXPECTED_EVENT_FIRED" : "NO_EVENT_WITHIN_WINDOW_AS_EXPECTED", unexpected ? `UNEXPECTED THREAT_BLOCKED fired for a non-enforcement action — a Truth-of-State violation.` : `No THREAT_BLOCKED observed within ${NEGATIVE_WINDOW_MS}ms — correct/expected outcome for this negative case.`, { evidence }, startedAt);
      if (kind === "manual-override") await GuardDogSecuritySDK.removeWebsiteGateAllowOverride(run.testDomain);
      const nextIndex = run.negativeQueueIndex + 1;
      const nextPhase: Phase6RunPhase = nextIndex >= NEGATIVE_KINDS.length ? "recovery-stop" : "negative";
      return withLog({ ...run, steps: [...run.steps, s], negativeQueueIndex: nextIndex, phase: nextPhase }, `Negative test [${kind}]: ${s.verdict} (${s.reasonCode}).`);
    }

    case "recovery-stop": {
      const startedAt = nowIso();
      let stopStatus;
      try {
        stopStatus = await GuardDogSecuritySDK.stopProtection();
      } catch (e) {
        const s = step("3.1", 3, "Stop protection → status truthfully reports inactive", "FAIL", "STOP_THREW", `stopProtection() threw: ${e instanceof Error ? e.message : String(e)}`, {}, startedAt);
        return withLog({ ...run, steps: [...run.steps, s], phase: "awaiting-revoke", awaitingInstruction: "Turn off Apollo's VPN permission (Settings → Network & internet → VPN → Apollo → Disconnect/Forget), then return here.", awaitingSince: nowIso(), awaitingAttempts: 0 }, "Stop protection threw — recorded FAIL, continuing to next phase.");
      }
      const deadline = Date.now() + RECOVERY_TIMEOUT_MS;
      while (stopStatus.state !== "INACTIVE" && stopStatus.state !== "STOPPED" && Date.now() < deadline) {
        await sleep(POLL_MS);
        stopStatus = GuardDogSecuritySDK.getProtectionState();
      }
      const rec = readRecoveryStatus();
      const stopped = (stopStatus.state === "INACTIVE" || stopStatus.state === "STOPPED") && rec != null && !rec.tunOpen && !rec.selectiveRouteActive;
      const s = step("3.1", 3, "Stop protection → status truthfully reports inactive, no further evidence generated", stopped ? "PASS" : "FAIL", stopped ? "RECOVERY_STATE_CONFIRMED" : "STALE_ACTIVE_STATE_AFTER_STOP", stopped ? `State=${stopStatus.state}, tunOpen=${rec?.tunOpen}, selectiveRouteActive=${rec?.selectiveRouteActive} — truthfully inactive.` : `State=${stopStatus.state}, tunOpen=${rec?.tunOpen}, selectiveRouteActive=${rec?.selectiveRouteActive} — did not settle to a truthfully inactive state.`, { stopStatus, rec }, startedAt);
      return withLog({ ...run, steps: [...run.steps, s], phase: "awaiting-revoke", awaitingInstruction: "Turn off Apollo's VPN permission (Settings → Network & internet → VPN → Apollo → Disconnect/Forget), then return here. The harness detects this automatically.", awaitingSince: nowIso(), awaitingAttempts: 0 }, `Stop protection: ${s.verdict}. Now waiting on a tester action Android does not let the app perform itself.`);
    }

    case "reactivate-for-network": {
      // Rows 3.4/3.5 need a genuinely ACTIVE, gate-active session -- the native module's session
      // state (bundle acceptance, override cache) does not survive the process restart the tester
      // just performed for row 3.3, so re-establish it exactly like the initial "config" phase does.
      // Any failure here is honestly NOT_TESTED for 3.4/3.5 (via skipNetworkActiveTest), never a
      // fabricated FAIL of "the transition" -- the transition itself was never reached.
      const startedAt = nowIso();
      try {
        const consentRequired = readVpnConsentRequired();
        if (consentRequired !== false) {
          const outcome = await GuardDogSecuritySDK.requestPermission("vpn");
          if (outcome !== "granted") {
            return skipNetworkActiveTest(run, "VPN_CONSENT_DENIED_ON_REACTIVATION", `Android VPN consent prompt result on reactivation: ${outcome}. Rows 3.4/3.5 require a genuinely ACTIVE session and cannot be independently tested without it.`, { outcome }, startedAt);
          }
        }
        const m1: M1Config = await fetchM1Config();
        GuardDogSecuritySDK.configure(toProtectionConfig(m1));
        const m1Bundle: SignedRuleBundle = await fetchLatestBundle(m1.rulesetId);
        const m1Accept = GuardDogSecuritySDK.acceptRuleBundle(m1Bundle);
        const m2RulesetId = m1.gateGuard?.websiteGateRulesetId;
        if (!m2RulesetId) {
          return skipNetworkActiveTest(run, "NO_M2_RULESET_CONFIGURED_ON_REACTIVATION", "Backend /api/config did not return gateGuard.websiteGateRulesetId on reactivation.", { m1 }, startedAt);
        }
        const m2Bundle: SignedRuleBundle = await fetchLatestBundle(m2RulesetId);
        GuardDogSecuritySDK.configureWebsiteGate({});
        const m2Accept = GuardDogSecuritySDK.acceptWebsiteGateRuleBundle(m2Bundle);
        await GuardDogSecuritySDK.hydrateWebsiteGateOverrides();
        if (!m1Accept.accepted || !m2Accept.accepted) {
          return skipNetworkActiveTest(run, "RULE_BUNDLE_NOT_ACCEPTED_ON_REACTIVATION", `M1 accepted=${m1Accept.accepted}; M2 accepted=${m2Accept.accepted} on reactivation.`, { m1Accept, m2Accept }, startedAt);
        }
        let status = await GuardDogSecuritySDK.startProtection();
        const startDeadline = Date.now() + START_PROTECTION_TIMEOUT_MS;
        while (status.state !== "ACTIVE" && status.state !== "FAILED" && status.state !== "STOPPED" && status.state !== "REVOKED" && Date.now() < startDeadline) {
          await sleep(POLL_MS);
          status = GuardDogSecuritySDK.getProtectionState();
        }
        if (status.state !== "ACTIVE") {
          return skipNetworkActiveTest(run, "PROTECTION_NOT_ACTIVE_ON_REACTIVATION", `Protection settled at ${status.state} instead of ACTIVE while reactivating for the network-transition test.`, { finalState: status.state }, startedAt);
        }
        const gateDeadline = Date.now() + GATE_ACTIVE_TIMEOUT_MS;
        let gateStatus = GuardDogSecuritySDK.getWebsiteGateStatus();
        while (!gateStatus.dnsGatewayActive && Date.now() < gateDeadline) {
          await sleep(POLL_MS);
          gateStatus = GuardDogSecuritySDK.getWebsiteGateStatus();
        }
        if (!gateStatus.dnsGatewayActive) {
          return skipNetworkActiveTest(run, "DNS_GATEWAY_NOT_ACTIVE_ON_REACTIVATION", "dnsGatewayActive stayed false after reactivation -- cannot test an active network transition.", { gateStatus }, startedAt);
        }
        return withLog(
          { ...run, phase: "awaiting-network", networkTypeBeforeToggle: null, awaitingInstruction: "Protection is ACTIVE again. Switch to a DIFFERENT connected network -- e.g. turn Wi-Fi off so the device switches to mobile data, or the reverse -- not just off. Then return here; Apollo detects the transition automatically.", awaitingSince: nowIso(), awaitingAttempts: 0 },
          "Reactivated: protection ACTIVE, dnsGatewayActive=true. Now waiting for a genuine Wi-Fi ↔ cellular transition (Android will not let the app toggle its own radios).",
        );
      } catch (e) {
        return skipNetworkActiveTest(run, "REACTIVATION_THREW", `Reactivating protection for the network-transition test threw: ${e instanceof Error ? e.message : String(e)}`, {}, startedAt);
      }
    }

    default:
      return run;
  }
}

/** Called by the screen (on AppState foreground, or a manual "Check now" tap) while phase is
 * "awaiting-revoke". Returns the SAME run unchanged if revoke has not happened yet -- never guesses.
 * 2026-09 tightened definition: PASS never relies on `consentGranted` alone (that field was observed
 * to go stale/wrong on a real device after a genuine revoke) -- it requires five INDEPENDENTLY
 * verified conditions. Any contradiction in the native status snapshot (e.g. `consentGranted:true`
 * surviving a confirmed revoke) is logged as its own diagnostic assertion, never silently dropped
 * and never allowed to weaken the row's own pass criteria. */
export async function checkAwaitingRevoke(run: Phase6RunState): Promise<Phase6RunState> {
  if (run.phase !== "awaiting-revoke") return run;
  const startedAt = nowIso();
  const consentNowRequired = readVpnConsentRequired();
  if (consentNowRequired !== true) return withLog({ ...run, awaitingAttempts: run.awaitingAttempts + 1 }, "Checked for VPN revoke — not detected yet, still waiting.");
  await sleep(500); // let the native lifecycle settle after the OS-level revoke before snapshotting
  const status = GuardDogSecuritySDK.getProtectionState();
  const rec = readRecoveryStatus();
  // A restart-without-consent attempt must be rejected -- proves no silent re-arm after revoke.
  let restartRejected = true;
  let restartError: string | null = null;
  try {
    await GuardDogSecuritySDK.startProtection();
    restartRejected = false;
  } catch (e) {
    restartError = e instanceof Error ? e.message : String(e);
  }
  // Five independently-verified conditions -- consentGranted is deliberately NOT one of them.
  const vpnNoLongerActive = status.state !== "ACTIVE";
  const tunClosed = rec != null && rec.tunOpen === false;
  const routeCleared = rec != null && rec.selectiveRouteActive === false;
  const noStaleState = rec != null && !rec.tunOpen && !rec.selectiveRouteActive && !rec.dropReporterAttached && !rec.vpnTransportPresent;
  const pass = vpnNoLongerActive && tunClosed && routeCleared && restartRejected && noStaleState;
  const failedChecks = [
    !vpnNoLongerActive ? "vpnNoLongerActive" : null,
    !tunClosed ? "tunClosed" : null,
    !routeCleared ? "routeCleared" : null,
    !restartRejected ? "restartRejected" : null,
    !noStaleState ? "noStaleState" : null,
  ].filter((x): x is string => x !== null);

  // Separate diagnostic assertion (never gates this row's PASS/FAIL, never silently ignored): the
  // native status snapshot's own `consentGranted` field contradicts the independently-confirmed
  // revoke whenever it still reports true here.
  const consentGrantedFieldContradiction = status.consentGranted === true;

  const s = step(
    "3.2",
    3,
    "Revoke VPN permission mid-session → independently verified (never from consentGranted alone), no silent fabricated active state",
    pass ? "PASS" : "FAIL",
    pass ? (consentGrantedFieldContradiction ? "REVOKE_INDEPENDENTLY_VERIFIED_WITH_STALE_CONSENT_FIELD" : "REVOKE_INDEPENDENTLY_VERIFIED") : "REVOKE_VERIFICATION_FAILED",
    pass
      ? `Independently verified: state!=ACTIVE, tunOpen=false, selectiveRouteActive=false, restart-without-consent rejected, no stale active/biting state.${consentGrantedFieldContradiction ? " CONTRADICTION FLAGGED: status.consentGranted still reports true after this confirmed revoke -- that field is stale/wrong on this device; it did NOT factor into this PASS and should be fixed in the native layer, not accommodated by weakening this test." : ""}`
      : `Failed independently-verified check(s): ${failedChecks.join(", ")}. status.consentGranted=${status.consentGranted}${consentGrantedFieldContradiction ? " (also contradicts the confirmed revoke, but that field was never relied on for this verdict either way)" : ""}.`,
    { status, rec, restartRejected, restartError, failedChecks, consentGrantedFieldContradiction, nativeReportingContradiction: consentGrantedFieldContradiction ? { field: "consentGranted", reportedValue: true, expectedGivenConfirmedRevoke: false, detail: "isVpnConsentRequired()===true independently confirms the OS revoked consent, yet getProtectionState().consentGranted still reports true -- a native-layer truthfulness bug to fix, not to test around." } : null },
    startedAt,
  );
  if (consentGrantedFieldContradiction) {
    // Ensure this is visible in the run log too, not just buried in evidence JSON.
    run = withLog(run, "⚠ CONTRADICTION (diagnostic, does not affect the 3.2 verdict above): status.consentGranted still reports true after an independently-confirmed VPN revoke. This native status field is stale/wrong on this device and should be fixed, not accommodated.");
  }
  // Set up row 3.3's rehydration check BEFORE instructing the tester to restart: a dedicated,
  // disposable probe host, never the real testDomain, cleaned up unconditionally by
  // evaluateAwaitingRestart regardless of outcome.
  const overrideProbeHost = `phase6a-override-probe.${run.testDomain}`;
  const probeCreated = await GuardDogSecuritySDK.setWebsiteGateAllowOverride(overrideProbeHost).catch(() => false);
  return withLog(
    {
      ...run,
      steps: [...run.steps, s],
      phase: "awaiting-restart",
      overrideProbeHost: probeCreated ? overrideProbeHost : null,
      awaitingInstruction: "Force-close Apollo completely (Recent apps → swipe away) and reopen it, then return to this screen. The harness resumes automatically on relaunch.",
      awaitingSince: nowIso(),
      awaitingAttempts: 0,
    },
    `Revoke detected: ${s.verdict}. Probe override for row 3.3 ${probeCreated ? "created" : "FAILED to create"}. Now waiting for an app restart (Android will not let the app trigger this on itself).`,
  );
}

/** Called ONCE right after the screen mounts if the persisted run's phase is "awaiting-restart" --
 * the act of this code running again in a fresh process IS the restart; no separate detection needed.
 * 2026-09 tightened definition: row 3.3 now requires TWO independent checks to both pass --
 * (A) no orphaned enforcement state survived the restart, and (B) the durable override record
 * genuinely rehydrates into the native runtime cache, which this harness confirmed goes ephemeral
 * on process death. Never PASS on check A alone (that was the old, weaker definition). */
export async function evaluateAwaitingRestart(run: Phase6RunState): Promise<Phase6RunState> {
  if (run.phase !== "awaiting-restart") return run;
  const startedAt = nowIso();
  const status = GuardDogSecuritySDK.getProtectionState();
  const rec = readRecoveryStatus();

  // Check A: no orphaned "biting" state -- nothing in this fresh process claims ACTIVE without a
  // fresh startProtection() call in this run.
  const orphanedActive = status.state === "ACTIVE" && rec != null && rec.tunOpen;
  const checkAPass = !orphanedActive;

  // Check B: override persistence/rehydration, using the probe row 3.2 created just before
  // instructing the restart. Unconditionally cleaned up below regardless of outcome.
  let checkBPass = false;
  let checkBReasonCode = "NO_PROBE_OVERRIDE_CREATED_BEFORE_RESTART";
  let checkBEvidence: Record<string, unknown> = { note: "The pre-restart probe override (row 3.2) was never created -- rehydration cannot be independently tested this run." };
  if (run.overrideProbeHost) {
    const persisted = await GuardDogSecuritySDK.getWebsiteGateOverrides();
    const persistedRecord = persisted.find((r) => r.host === run.overrideProbeHost) ?? null;
    const persistedOk = !!persistedRecord && persistedRecord.type === "allow";
    await GuardDogSecuritySDK.hydrateWebsiteGateOverrides();
    const nativeList = readNativeWebsiteGateOverrides();
    const nativeOk = !!nativeList && nativeList.includes(run.overrideProbeHost);
    checkBPass = persistedOk && nativeOk;
    checkBReasonCode = checkBPass ? "OVERRIDE_REHYDRATED_CORRECTLY" : !persistedOk ? "PERSISTED_RECORD_MISSING_OR_WRONG_TYPE_AFTER_RESTART" : "NATIVE_CACHE_NOT_REHYDRATED_FROM_DURABLE_STORE";
    checkBEvidence = { probeHost: run.overrideProbeHost, persistedRecord, nativeList, persistedOk, nativeOk };
    // Clean up unconditionally -- never leave a disposable test override behind.
    await GuardDogSecuritySDK.removeWebsiteGateAllowOverride(run.overrideProbeHost);
  }

  const bothPass = checkAPass && checkBPass;
  const verdict: Phase6StepVerdict = bothPass ? "PASS" : !checkAPass ? "FAIL" : checkBReasonCode === "NO_PROBE_OVERRIDE_CREATED_BEFORE_RESTART" ? "NOT_TESTED" : "FAIL";
  const reasonCode = bothPass ? "CLEAN_RESTART_AND_OVERRIDE_REHYDRATED" : !checkAPass ? "ORPHANED_ACTIVE_STATE_AFTER_RESTART" : checkBReasonCode;
  const explanation = bothPass
    ? `Both independent checks passed: (A) no orphaned active/biting state survived the restart (state=${status.state}); (B) the probe override genuinely rehydrated into the native cache from the durable store after the native session was wiped by process death.`
    : !checkAPass
      ? "Protection reports ACTIVE with an open TUN immediately on a fresh process, before this run re-armed anything -- a stale/fabricated state (check A failed; check B not decisive)."
      : checkBReasonCode === "NO_PROBE_OVERRIDE_CREATED_BEFORE_RESTART"
        ? "Check A (no orphaned state) passed, but check B (override rehydration) could not be independently tested this run because its pre-restart probe setup failed."
        : `Check A (no orphaned state) passed, but check B (override rehydration) failed: ${checkBReasonCode}.`;
  const s = step("3.3", 3, "App restart (kill + relaunch): (A) no orphaned enforcement state, AND (B) durable override genuinely rehydrates into native session state — both required", verdict, reasonCode, explanation, { status, rec, checkAPass, checkBPass, checkBEvidence }, startedAt);
  return withLog(
    { ...run, steps: [...run.steps, s], phase: "reactivate-for-network", overrideProbeHost: null, awaitingInstruction: null, awaitingSince: null, awaitingAttempts: 0 },
    `App restart evaluated: 3.3=${s.verdict} (${s.reasonCode}). Re-establishing an ACTIVE session for the network-transition test (row 3.4).`,
  );
}

/** Called by the screen (on AppState foreground or a manual "Check now" tap) while phase is
 * "awaiting-network". `currentNetworkType` comes from expo-network, read by the screen.
 * 2026-09 tightened definition: this phase is now only entered with protection genuinely ACTIVE and
 * dnsGatewayActive===true (see the "reactivate-for-network" phase above) -- a real Wi-Fi ↔ cellular
 * transition, not the old, weaker "any change including dropping to NONE while already inactive."
 * Landing back on ACTIVE requires proven, not cosmetic, recovery (row 3.5's sanity fetch); landing
 * on anything else is accepted ONLY if reported truthfully with no stale evidence -- an explicit,
 * defined outcome either way, never assumed. */
export async function checkAwaitingNetwork(run: Phase6RunState, currentNetworkType: string): Promise<Phase6RunState> {
  if (run.phase !== "awaiting-network") return run;
  if (run.networkTypeBeforeToggle === null) {
    return { ...run, networkTypeBeforeToggle: currentNetworkType };
  }
  // Require landing on a genuinely DIFFERENT connected type -- dropping to NONE/UNKNOWN is not the
  // active Wi-Fi<->cellular scenario this row exercises; keep waiting rather than settle for it.
  if (currentNetworkType === run.networkTypeBeforeToggle || currentNetworkType === "NONE" || currentNetworkType === "UNKNOWN") {
    return withLog({ ...run, awaitingAttempts: run.awaitingAttempts + 1 }, `Checked for an active network transition — still ${currentNetworkType} (need a different CONNECTED type, e.g. Wi-Fi ↔ cellular), no change detected yet.`);
  }
  const startedAt = nowIso();
  const statsAtDetection = GuardDogSecuritySDK.getEnforcementStats();
  await sleep(1500); // let the native layer settle/react to the transition before snapshotting
  const status = GuardDogSecuritySDK.getProtectionState();
  const rec = readRecoveryStatus();
  const gateStatus = GuardDogSecuritySDK.getWebsiteGateStatus();
  const statsAtSettle = GuardDogSecuritySDK.getEnforcementStats();
  const noStaleEvidenceDuringTransition = !!statsAtSettle && !!statsAtDetection && statsAtSettle.observedMatching === statsAtDetection.observedMatching && statsAtSettle.droppedMatching === statsAtDetection.droppedMatching;
  const rowTitle = "Active network transition (Wi-Fi ↔ cellular) while protection is genuinely ACTIVE → truthful state, and (if it stays active) proven recovery";

  if (status.state === "ACTIVE") {
    // "Recovers automatically" path -- every one of these must hold, or it's a truthfulness FAIL.
    const tunReallyOpen = rec != null && rec.tunOpen === true;
    const gateReallyActive = gateStatus.dnsGatewayActive === true;
    const activePass = tunReallyOpen && gateReallyActive && noStaleEvidenceDuringTransition;
    const s = step(
      "3.4",
      3,
      rowTitle,
      activePass ? "PASS" : "FAIL",
      activePass ? "TRUTHFUL_ACTIVE_RECOVERY" : !tunReallyOpen ? "CLAIMS_ACTIVE_BUT_TUN_CLOSED" : !gateReallyActive ? "CLAIMS_ACTIVE_BUT_GATE_INACTIVE" : "STALE_EVIDENCE_DURING_TRANSITION",
      activePass
        ? `Network changed ${run.networkTypeBeforeToggle} → ${currentNetworkType} while protection was ACTIVE; state stayed ACTIVE with a genuinely open TUN, dnsGatewayActive stayed true, and no unexplained enforcement events fired purely from the transition.`
        : `Network changed ${run.networkTypeBeforeToggle} → ${currentNetworkType} while protection was ACTIVE; state claims ACTIVE but tunOpen=${rec?.tunOpen}, dnsGatewayActive=${gateStatus.dnsGatewayActive}, evidenceUnchanged=${noStaleEvidenceDuringTransition} -- inconsistent with a genuine automatic recovery.`,
      { before: run.networkTypeBeforeToggle, after: currentNetworkType, status, rec, gateStatus, statsAtDetection, statsAtSettle },
      startedAt,
    );
    if (!activePass) {
      const s35 = step("3.5", 3, "Post-transition positive sanity check → enforcement still genuinely functions after the transition", "NOT_TESTED", "NOT_APPLICABLE_ROW_3_4_FAILED", "Row 3.4 did not confirm a genuinely truthful ACTIVE state after the transition -- a sanity check would not be meaningful.", {}, startedAt);
      return withLog({ ...run, steps: [...run.steps, s, s35], phase: "dns-capability", awaitingInstruction: null, awaitingSince: null, awaitingAttempts: 0 }, `Network transition (active path) evaluated: 3.4=FAIL (${s.reasonCode}).`);
    }
    // Row 3.5: only meaningful once 3.4 has confirmed a genuinely truthful ACTIVE recovery -- its
    // own fresh fetch, its own fresh TUN evidence, never inherited from row 1.1/1.2/3.4.
    const sanityStartedAt = nowIso();
    const statsBeforeSanity = GuardDogSecuritySDK.getEnforcementStats();
    const sanityEvidence = await runPositiveEnforcementTest(run.testDomain, POSITIVE_WINDOW_MS);
    const statsAfterSanity = GuardDogSecuritySDK.getEnforcementStats();
    const sanityTunEvidence = !!statsAfterSanity && !!statsBeforeSanity && statsAfterSanity.observedMatching > statsBeforeSanity.observedMatching && statsAfterSanity.droppedMatching > statsBeforeSanity.droppedMatching;
    const sanityFull = !!sanityEvidence.blockedEvent?.enforcementEvidenceId && sanityTunEvidence;
    const s35 = step(
      "3.5",
      3,
      "Post-transition positive sanity check → enforcement still genuinely functions after the transition",
      sanityFull ? "PASS" : "FAIL",
      sanityFull ? "SANITY_ENFORCEMENT_CONFIRMED_POST_TRANSITION" : sanityEvidence.blockedEvent ? "SANITY_EVENT_WITHOUT_TUN_EVIDENCE" : "SANITY_NO_EVIDENCE_WITHIN_WINDOW",
      sanityFull
        ? `Post-transition fetch to ${run.testDomain} produced a fresh THREAT_BLOCKED (evidenceId=${sanityEvidence.blockedEvent!.enforcementEvidenceId}) with corroborating TUN evidence -- enforcement genuinely still works after the transition, not just cosmetically ACTIVE.`
        : "Post-transition fetch did not produce a fully evidence-backed block -- protection claims ACTIVE/recovered but enforcement did not genuinely fire.",
      { sanityEvidence, statsBeforeSanity, statsAfterSanity },
      sanityStartedAt,
    );
    return withLog({ ...run, steps: [...run.steps, s, s35], phase: "dns-capability", awaitingInstruction: null, awaitingSince: null, awaitingAttempts: 0 }, `Network transition (active path): 3.4=${s.verdict}, 3.5=${s35.verdict}.`);
  }

  // "Design intentionally drops to inactive" path: PASS only if internally consistent (truthfully
  // inactive, no stale TUN/route left open, no unexplained evidence) -- an explicit, accepted
  // outcome, not a guess about intent.
  const tunReallyClosed = rec == null || rec.tunOpen === false;
  const inactivePass = tunReallyClosed && noStaleEvidenceDuringTransition;
  const s = step(
    "3.4",
    3,
    rowTitle,
    inactivePass ? "PASS" : "FAIL",
    inactivePass ? "TRUTHFUL_INACTIVE_AFTER_TRANSITION_BY_DESIGN" : "CLAIMS_INACTIVE_BUT_TUN_STILL_OPEN",
    inactivePass
      ? `Network changed ${run.networkTypeBeforeToggle} → ${currentNetworkType} while protection was ACTIVE; the transition caused protection to settle at ${status.state} -- reported truthfully (TUN genuinely closed, no unexplained evidence). This documents that this app does not auto-recover across this transition, rather than fabricating a false ACTIVE.`
      : `Network changed ${run.networkTypeBeforeToggle} → ${currentNetworkType}; state claims ${status.state} (not ACTIVE) but tunOpen=${rec?.tunOpen}, evidenceUnchanged=${noStaleEvidenceDuringTransition} -- inconsistent, a stale-state truthfulness violation.`,
    { before: run.networkTypeBeforeToggle, after: currentNetworkType, status, rec, statsAtDetection, statsAtSettle },
    startedAt,
  );
  const s35 = step("3.5", 3, "Post-transition positive sanity check → enforcement still genuinely functions after the transition", "NOT_TESTED", "NOT_APPLICABLE_PROTECTION_INACTIVE_AFTER_TRANSITION", "Protection reported inactive after the transition -- a positive sanity fetch is not applicable to this outcome.", {}, startedAt);
  return withLog({ ...run, steps: [...run.steps, s, s35], phase: "dns-capability", awaitingInstruction: null, awaitingSince: null, awaitingAttempts: 0 }, `Network transition (inactive-after-transition path) evaluated: 3.4=${s.verdict}.`);
}

export interface DnsCapabilityCheckResult {
  step: Phase6StepResult;
  run: Phase6RunState;
}

/** Dedicated, isolated host + rule for row 4.1 ONLY -- never `run.testDomain` (shared by rows
 * 1.1/1.2/3.x). A real physical run showed row 4.1's old raw-counter-delta check misfire from
 * leftover background retries against the SHARED test domain landing inside this row's own
 * observation window. Using a completely separate signed block rule (see
 * backend/scripts/add_dns_capability_rule.py -- additive, `m2-block-blocktest-001` untouched) means
 * no other row's traffic can ever produce a matching, correctly-attributed event for THIS host. */
export const DNS_CAPABILITY_TEST_HOST = "dnsprobe.blocktest.btciq.app";
export const DNS_CAPABILITY_RULE_ID = "m2-block-dns-capability-001";

/**
 * Group 4: Android does not expose the actual Private DNS setting value to a non-privileged app
 * (confirmed: even reading Settings.Global.PRIVATE_DNS_MODE needs WRITE_SECURE_SETTINGS/ADB/device-
 * owner on modern Android). So instead of reading the setting, this classifies the CONSEQUENCE from
 * two independent signals, BOTH strictly attributed to this row's own dedicated probe host (never
 * inferred from the GLOBAL observedMatching/droppedMatching counters, which are shared across every
 * row's traffic in this run and were the source of a false FAIL from unrelated leftover retries):
 * (a) did a genuine THREAT_BLOCKED event arrive whose own `host` field matches
 * [DNS_CAPABILITY_TEST_HOST] exactly, (b) did the connection to that SAME host independently succeed
 * via SOME path (a real HTTP response, proving resolution + connect + TLS worked). BYPASSED/
 * CAPABILITY_GAP is only ever classified when (b) is true for OUR host -- an absence of (a) alone is
 * UNOBSERVABLE, never assumed to be a bypass. Callable repeatedly (returns a fresh step each time);
 * the tester may re-run this after manually changing the device's Private DNS setting in Android
 * Settings between taps.
 */
export async function runDnsCapabilityCheck(run: Phase6RunState): Promise<DnsCapabilityCheckResult> {
  const startedAt = nowIso();
  const statsBefore = GuardDogSecuritySDK.getEnforcementStats();
  let fetchOutcome: Awaited<ReturnType<typeof triggerDnsViaFetch>> | null = null;
  const { event } = await observeBlockedEventWindow(async () => {
    fetchOutcome = await triggerDnsViaFetch(DNS_CAPABILITY_TEST_HOST, 8000);
  }, POSITIVE_WINDOW_MS);
  const statsAfter = GuardDogSecuritySDK.getEnforcementStats();
  const priorCount = run.steps.filter((s) => s.id.startsWith("4.")).length;
  const rowId = `4.${priorCount + 1}`;
  // Strict per-row attribution: a genuine THREAT_BLOCKED only ever counts as THIS row's own
  // evidence when its own `host` field matches the dedicated probe host queried above -- an event
  // for any other host (e.g. leftover retries from rows 1.1/1.2/3.x against their own shared test
  // domain) is unrelated noise and is explicitly excluded, never upgraded into this row's PASS/FAIL.
  const attributedEvent = event && event.host?.toLowerCase() === DNS_CAPABILITY_TEST_HOST.toLowerCase() ? event : null;
  const unrelatedEventNote = event && !attributedEvent
    ? ` (A genuine THREAT_BLOCKED did arrive during this window for a DIFFERENT host [${event.host ?? "unknown"}] -- unrelated leftover traffic, correctly excluded from this row's own evidence.)`
    : "";
  let s: Phase6StepResult;
  if (attributedEvent?.enforcementEvidenceId && attributedEvent.ruleId === DNS_CAPABILITY_RULE_ID) {
    s = step(
      rowId,
      4,
      "Ambient Private DNS condition → DNS-capability check",
      "PASS",
      "DNS_QUERY_CAPTURED_AND_BLOCKED",
      `Apollo's DNS interception observed and blocked the dedicated probe query to ${DNS_CAPABILITY_TEST_HOST} (evidenceId=${attributedEvent.enforcementEvidenceId}, ruleId=${attributedEvent.ruleId}). This ambient condition is fully captured by Apollo — not a bypass.`,
      { statsBefore, statsAfter, fetchOutcome, event, attributedEvent },
      startedAt,
    );
  } else if (attributedEvent?.enforcementEvidenceId) {
    // Host matched but a DIFFERENT rule authorized it -- a genuine, specifically-attributable
    // authorization mismatch. Still derived only from this row's own evidence, never from ambient
    // global counters.
    s = step(
      rowId,
      4,
      "Ambient Private DNS condition → DNS-capability check",
      "FAIL",
      "BLOCKED_BY_UNEXPECTED_RULE",
      `The dedicated probe host ${DNS_CAPABILITY_TEST_HOST} was blocked, but by ruleId=${attributedEvent.ruleId} instead of the expected ${DNS_CAPABILITY_RULE_ID} -- a genuine authorization mismatch, attributed entirely to this row's own evidence.`,
      { statsBefore, statsAfter, fetchOutcome, event, attributedEvent },
      startedAt,
    );
  } else if (fetchOutcome && (fetchOutcome as { outcome: string }).outcome === "resolved") {
    s = step(
      rowId,
      4,
      "Ambient Private DNS condition → DNS-capability check",
      "CAPABILITY_GAP",
      "INDEPENDENT_EVIDENCE_OF_BYPASS",
      `Apollo's plaintext DNS interception did not attribute a block to ${DNS_CAPABILITY_TEST_HOST}, AND the request to that same host independently succeeded (a real HTTP response came back) — proof the resolution/connection happened via a path invisible to Apollo (e.g. system Private DNS or app-embedded DoH). Documented capability gap, not a fabricated block and not an enforcement failure.${unrelatedEventNote}`,
      { statsBefore, statsAfter, fetchOutcome, event },
      startedAt,
    );
  } else {
    s = step(
      rowId,
      4,
      "Ambient Private DNS condition → DNS-capability check",
      "UNOBSERVABLE",
      "NO_INDEPENDENT_EVIDENCE_EITHER_WAY",
      `Apollo did not attribute a block to ${DNS_CAPABILITY_TEST_HOST}, but the request to that same host also did not independently succeed (no confirmed HTTP response) — there is no evidence either way whether it bypassed Apollo or simply never resolved. Not classified as a bypass without independent proof.${unrelatedEventNote}`,
      { statsBefore, statsAfter, fetchOutcome, event },
      startedAt,
    );
  }
  const advanced = withLog({ ...run, steps: [...run.steps, s], phase: run.phase === "dns-capability" ? "done" : run.phase }, `DNS-capability check: ${s.verdict} (${s.reasonCode}).`);
  return { step: s, run: finalizeRun(advanced) };
}

/** Always-true, informational row: this harness has no in-app mechanism to force app-embedded DoH
 * (that requires a separate browser/app configured to use DoH, outside this harness's control). */
export function notTestableDohRow(): Phase6StepResult {
  const now = nowIso();
  return step("4.doh", 4, "App-embedded DoH bypass (e.g. a browser forcing DoH)", "NOT_TESTABLE", "NO_IN_APP_TRIGGER_MECHANISM", "This harness has no way to force another app's embedded DoH resolver to fire from inside itself. Documented via ANDROID_M2_DNS_COVERAGE_TAG (see contracts/shared/capabilities.ts); exercise out-of-band with a DoH-forcing browser if a definitive check is needed.", {}, now, now);
}

export { finalizeRun };
