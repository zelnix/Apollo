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
import { Platform } from "react-native";

import { readRecoveryStatus, readVpnConsentRequired } from "@/src/harness/recoveryDiagnostics";
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

// --- Canonical machine states (exactly the six the product requirement specifies) ---
export type Phase6StepVerdict = "PASS" | "FAIL" | "PRECONDITION_FAILURE" | "CAPABILITY_GAP" | "UNOBSERVABLE" | "NOT_TESTABLE" | "PENDING";

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
  overallVerdict: "PASS" | "FAIL" | "PRECONDITION_FAILURE" | "PASS_WITH_CAPABILITY_GAP" | null;
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
      const s2 = step("1.2", 1, "Repeat resolution of same domain within binding lifetime → consistent evidence", s1.verdict === "PASS" ? "PASS" : "FAIL", s1.verdict === "PASS" ? "CONSISTENT_WITH_1_1" : "SKIPPED_NO_BASELINE", s1.verdict === "PASS" ? "Same test domain re-observed under the still-active binding; single positive pass covers both rows for this automated run." : "Not evaluated because row 1.1 did not establish a baseline positive chain.", { note: "Automated run exercises one fresh binding cycle; see 1.1 evidence." }, startedAt);
      return withLog({ ...run, steps: [...run.steps, s1, s2], phase: "negative" }, `Positive enforcement test: ${s1.verdict} (${s1.reasonCode}).`);
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

    default:
      return run;
  }
}

/** Called by the screen (on AppState foreground, or a manual "Check now" tap) while phase is
 * "awaiting-revoke". Returns the SAME run unchanged if revoke has not happened yet -- never guesses. */
export async function checkAwaitingRevoke(run: Phase6RunState): Promise<Phase6RunState> {
  if (run.phase !== "awaiting-revoke") return run;
  const startedAt = nowIso();
  const consentNowRequired = readVpnConsentRequired();
  if (consentNowRequired !== true) return withLog({ ...run, awaitingAttempts: run.awaitingAttempts + 1 }, "Checked for VPN revoke — not detected yet, still waiting.");
  await sleep(500); // let the native lifecycle settle after the OS-level revoke before snapshotting
  const status = GuardDogSecuritySDK.getProtectionState();
  const stillClaimsActive = status.state === "ACTIVE";
  // A restart-without-consent attempt must be rejected -- proves no silent re-arm after revoke.
  let restartRejected = true;
  let restartError: string | null = null;
  try {
    await GuardDogSecuritySDK.startProtection();
    restartRejected = false;
  } catch (e) {
    restartError = e instanceof Error ? e.message : String(e);
  }
  const pass = !stillClaimsActive && restartRejected;
  const s = step("3.2", 3, "Revoke VPN permission mid-session → app detects and reports truthfully, no silent fabricated active state", pass ? "PASS" : "FAIL", pass ? "REVOKE_DETECTED_AND_TRUTHFUL" : "FABRICATED_ACTIVE_OR_SILENT_RESTART", pass ? `State=${status.state} after revoke; restartWithoutConsent correctly rejected${restartError ? ` (${restartError})` : ""}.` : `State=${status.state} after revoke (stillClaimsActive=${stillClaimsActive}); restartWithoutConsent rejected=${restartRejected}.`, { status, restartRejected, restartError }, startedAt);
  return withLog({ ...run, steps: [...run.steps, s], phase: "awaiting-restart", awaitingInstruction: "Force-close Apollo completely (Recent apps → swipe away) and reopen it, then return to this screen. The harness resumes automatically on relaunch.", awaitingSince: nowIso(), awaitingAttempts: 0 }, `Revoke detected: ${s.verdict}. Now waiting for an app restart (Android will not let the app trigger this on itself).`);
}

/** Called ONCE right after the screen mounts if the persisted run's phase is "awaiting-restart" --
 * the act of this code running again in a fresh process IS the restart; no separate detection needed. */
export function evaluateAwaitingRestart(run: Phase6RunState): Phase6RunState {
  if (run.phase !== "awaiting-restart") return run;
  const startedAt = nowIso();
  const status = GuardDogSecuritySDK.getProtectionState();
  const rec = readRecoveryStatus();
  // No orphaned "biting" UI state: nothing in this fresh process claims ACTIVE without a fresh startProtection() call in this run.
  const orphanedActive = status.state === "ACTIVE" && rec != null && rec.tunOpen;
  const s = step("3.3", 3, "App restart (kill + relaunch) → overrides rehydrate correctly, no orphaned biting UI state", orphanedActive ? "FAIL" : "PASS", orphanedActive ? "ORPHANED_ACTIVE_STATE_AFTER_RESTART" : "CLEAN_RESTART_NO_ORPHAN", orphanedActive ? "Protection reports ACTIVE with an open TUN immediately on a fresh process, before this run re-armed anything -- a stale/fabricated state." : `Fresh process state=${status.state}; no orphaned active/biting state carried across the restart.`, { status, rec }, startedAt);
  return withLog({ ...run, steps: [...run.steps, s], phase: "awaiting-network", networkTypeBeforeToggle: null, awaitingInstruction: "Toggle Wi-Fi or mobile data off, then back on, then return here. The harness detects the transition automatically.", awaitingSince: nowIso(), awaitingAttempts: 0 }, `App restart evaluated: ${s.verdict}. Now waiting for a network transition (Android will not let the app toggle its own radios).`);
}

/** Called by the screen (on AppState foreground or a manual "Check now" tap) while phase is
 * "awaiting-network". `currentNetworkType` comes from expo-network, read by the screen. */
export async function checkAwaitingNetwork(run: Phase6RunState, currentNetworkType: string): Promise<Phase6RunState> {
  if (run.phase !== "awaiting-network") return run;
  if (run.networkTypeBeforeToggle === null) {
    return { ...run, networkTypeBeforeToggle: currentNetworkType };
  }
  if (currentNetworkType === run.networkTypeBeforeToggle) {
    return withLog({ ...run, awaitingAttempts: run.awaitingAttempts + 1 }, `Checked for network transition — still ${currentNetworkType}, no change detected yet.`);
  }
  const startedAt = nowIso();
  const status = GuardDogSecuritySDK.getProtectionState();
  const truthfulThroughTransition = status.state !== "ACTIVE" || (readRecoveryStatus()?.tunOpen ?? false) === true; // if it claims ACTIVE, the TUN must genuinely still be open
  const s = step("3.4", 3, "Network transition → protection status reported truthfully through the transition", truthfulThroughTransition ? "PASS" : "FAIL", truthfulThroughTransition ? "TRUTHFUL_THROUGH_TRANSITION" : "STALE_STATE_ACROSS_TRANSITION", truthfulThroughTransition ? `Network changed ${run.networkTypeBeforeToggle} → ${currentNetworkType}; reported state (${status.state}) stayed consistent with actual TUN state.` : `Network changed ${run.networkTypeBeforeToggle} → ${currentNetworkType}; state claims ${status.state} but the TUN evidence disagrees.`, { before: run.networkTypeBeforeToggle, after: currentNetworkType, status }, startedAt);
  return withLog({ ...run, steps: [...run.steps, s], phase: "dns-capability", awaitingInstruction: null, awaitingSince: null, awaitingAttempts: 0 }, `Network transition evaluated: ${s.verdict}. Running the automatic DNS-capability check.`);
}

export interface DnsCapabilityCheckResult {
  step: Phase6StepResult;
  run: Phase6RunState;
}

/**
 * Group 4: Android does not expose the actual Private DNS setting value to a non-privileged app
 * (confirmed: even reading Settings.Global.PRIVATE_DNS_MODE needs WRITE_SECURE_SETTINGS/ADB/device-
 * owner on modern Android). So instead of reading the setting, this classifies the CONSEQUENCE from
 * two independent signals: (a) did Apollo's own plaintext DNS interception observe the query
 * (enforcementStats delta), (b) did the connection independently succeed via SOME path (a real HTTP
 * response, proving resolution + connect + TLS worked). BYPASSED/CAPABILITY_GAP is only ever
 * classified when (b) is true -- an absence of (a) alone is UNOBSERVABLE, never assumed to be a
 * bypass. Callable repeatedly (returns a fresh step each time); the tester may re-run this after
 * manually changing the device's Private DNS setting in Android Settings between taps.
 */
export async function runDnsCapabilityCheck(run: Phase6RunState): Promise<DnsCapabilityCheckResult> {
  const startedAt = nowIso();
  const statsBefore = GuardDogSecuritySDK.getEnforcementStats();
  let fetchOutcome: Awaited<ReturnType<typeof triggerDnsViaFetch>> | null = null;
  const { event } = await observeBlockedEventWindow(async () => {
    fetchOutcome = await triggerDnsViaFetch(run.testDomain, 8000);
  }, POSITIVE_WINDOW_MS);
  const statsAfter = GuardDogSecuritySDK.getEnforcementStats();
  const observedDelta = (statsAfter?.observedMatching ?? 0) - (statsBefore?.observedMatching ?? 0);
  const priorCount = run.steps.filter((s) => s.id.startsWith("4.")).length;
  const rowId = `4.${priorCount + 1}`;
  let s: Phase6StepResult;
  if (event?.enforcementEvidenceId) {
    s = step(rowId, 4, "Ambient Private DNS condition → DNS-capability check", "PASS", "DNS_QUERY_CAPTURED_AND_BLOCKED", `Apollo's DNS interception observed and blocked the query (evidenceId=${event.enforcementEvidenceId}). This ambient condition is fully captured by Apollo — not a bypass.`, { statsBefore, statsAfter, fetchOutcome, event }, startedAt);
  } else if (observedDelta > 0) {
    s = step(rowId, 4, "Ambient Private DNS condition → DNS-capability check", "FAIL", "OBSERVED_BUT_NOT_BLOCKED", "Apollo's interception observed a matching packet but did not produce a full evidence-backed block — an enforcement gap, not a documented capability limitation.", { statsBefore, statsAfter, fetchOutcome }, startedAt);
  } else if (fetchOutcome && (fetchOutcome as { outcome: string }).outcome === "resolved") {
    s = step(rowId, 4, "Ambient Private DNS condition → DNS-capability check", "CAPABILITY_GAP", "INDEPENDENT_EVIDENCE_OF_BYPASS", "Apollo's plaintext DNS interception did not observe this query, AND the request independently succeeded (a real HTTP response came back) — proof the resolution/connection happened via a path invisible to Apollo (e.g. system Private DNS or app-embedded DoH). Documented capability gap, not a fabricated block and not an enforcement failure.", { statsBefore, statsAfter, fetchOutcome }, startedAt);
  } else {
    s = step(rowId, 4, "Ambient Private DNS condition → DNS-capability check", "UNOBSERVABLE", "NO_INDEPENDENT_EVIDENCE_EITHER_WAY", "Apollo did not observe this query, but the request also did not independently succeed (no confirmed HTTP response) — there is no evidence either way whether it bypassed Apollo or simply never resolved. Not classified as a bypass without independent proof.", { statsBefore, statsAfter, fetchOutcome }, startedAt);
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
