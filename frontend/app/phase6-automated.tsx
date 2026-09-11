// Gate Guard M2.1 Phase 6A: Automated Physical-Device Acceptance.
//
// Required user experience: install the native Android build, open this screen once, grant VPN
// permission if prompted, press "Run Automated Acceptance", wait, and receive a generated
// PASS / FAIL / PRECONDITION_FAILURE / PASS WITH CAPABILITY GAP report. The tester never interprets
// logs, decides whether a test passed, or manually correlates evidence IDs -- the harness in
// src/harness/phase6AutomatedHarness.ts owns every deterministic verdict. The tester performs ONLY
// the handful of physical actions Android will not let this app perform on itself (revoke its own
// VPN permission, force itself to restart, toggle system network radios, change the system Private
// DNS setting) -- everything else is triggered and judged automatically. See the detailed
// step-by-step "Advanced / Diagnostics" screen (/phase6-acceptance) for manual developer tooling;
// this screen is the one normal acceptance runs should use.
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Network from "expo-network";
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, type AppStateStatus, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ActionButton, Card, KeyValue } from "@/src/components/harness-ui";
import { readBuildProvenance } from "@/src/harness/buildProvenance";
import {
  checkAwaitingNetwork,
  checkAwaitingRevoke,
  createInitialRun,
  evaluateAwaitingRestart,
  notTestableDohRow,
  runDnsCapabilityCheck,
  runToNextPause,
  type Phase6RunState,
  type Phase6StepResult,
  type Phase6StepVerdict,
} from "@/src/harness/phase6AutomatedHarness";
import { exportPhase6AutomatedReportPdf, exportPhase6AutomatedResultJson } from "@/src/harness/phase6AutomatedReport";
import { readPhase6DeviceProvenance } from "@/src/harness/phase6DeviceProvenance";
import { shareEvidenceFile } from "@/src/harness/proofReport";
import { fetchLatestBundle, fetchM1Config } from "@/src/harness/ruleBundleFixtures";
import { makeStyles, useTheme } from "@/src/theme";

const STORAGE_KEY = "phase6a-automated-run-v1";

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: 20, paddingBottom: 16, gap: 4 },
  backRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  backText: { color: colors.brandPrimary, fontSize: 15, fontWeight: "700" },
  eyebrow: { color: colors.onSurfaceTertiary, fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  title: { color: colors.onSurface, fontSize: 24, fontWeight: "800" },
  subtitle: { color: colors.onSurfaceSecondary, fontSize: 13 },
  content: { paddingHorizontal: 20, gap: 16 },
  note: { color: colors.onSurfaceTertiary, fontSize: 12, lineHeight: 17 },
  actions: { gap: 10 },
  bigVerdict: { fontSize: 22, fontWeight: "900" },
  reasonCode: { fontSize: 11, fontWeight: "700", color: colors.onSurfaceTertiary },
  instructionBanner: { borderRadius: 12, borderWidth: 2, borderColor: colors.brandPrimary, backgroundColor: colors.surfaceTertiary, padding: 14, gap: 8 },
  instructionTitle: { fontSize: 13, fontWeight: "800", color: colors.brandPrimary },
  instructionText: { fontSize: 14, fontWeight: "600", color: colors.onSurface, lineHeight: 20 },
  stepRow: { borderRadius: 10, borderWidth: 1, borderColor: colors.borderStrong, padding: 10, gap: 4 },
  stepTitle: { fontSize: 12, fontWeight: "700", color: colors.onSurface },
  stepMeta: { fontSize: 11, color: colors.onSurfaceTertiary },
  groupTitle: { fontSize: 13, fontWeight: "800", color: colors.onSurfaceSecondary, marginTop: 6 },
  phaseText: { fontSize: 13, fontWeight: "700", color: colors.brandPrimary },
  logBox: { borderRadius: 8, backgroundColor: colors.surfaceTertiary, padding: 8, maxHeight: 160 },
  logLine: { fontSize: 10, color: colors.onSurfaceTertiary, fontFamily: "monospace" },
}));

const VERDICT_COLOR: Record<string, string> = {
  PASS: "#15803d",
  FAIL: "#b91c1c",
  PRECONDITION_FAILURE: "#b45309",
  CAPABILITY_GAP: "#b45309",
  UNOBSERVABLE: "#64748b",
  NOT_TESTABLE: "#64748b",
  PENDING: "#64748b",
  PASS_WITH_CAPABILITY_GAP: "#b45309",
};

function VerdictText({ verdict, style }: { verdict: Phase6StepVerdict | string | null; style?: object }) {
  return <Text style={[{ color: VERDICT_COLOR[verdict ?? "PENDING"] ?? "#64748b", fontWeight: "900" }, style]}>{verdict ?? "PENDING"}</Text>;
}

function StepRow({ step }: { step: Phase6StepResult }) {
  const styles = useStyles();
  return (
    <View style={styles.stepRow} testID={`phase6a-step-${step.id}`}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <Text style={[styles.stepTitle, { flex: 1, flexShrink: 1 }]}>{step.id} · {step.title}</Text>
        <VerdictText verdict={step.verdict} />
      </View>
      <Text style={styles.stepMeta}>{step.reasonCode}</Text>
      <Text style={styles.stepMeta}>{step.explanation}</Text>
    </View>
  );
}

const AWAITING_INSTRUCTIONS: Record<string, string> = {
  "awaiting-revoke": "Turn off Apollo's VPN permission (Android Settings → Network & internet → VPN → Apollo → Disconnect/Forget), then return to this screen.",
  "awaiting-restart": "Force-close Apollo completely (Recent apps → swipe it away) and reopen it, then return to this screen.",
  "awaiting-network": "Toggle Wi-Fi or mobile data off, then back on, then return to this screen.",
};

export default function Phase6Automated() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const [run, setRun] = useState<Phase6RunState | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runRef = useRef<Phase6RunState | null>(null);
  runRef.current = run;

  const persist = useCallback((next: Phase6RunState) => {
    runRef.current = next;
    setRun(next);
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
  }, []);

  // --- Load persisted run on mount; if we were mid-restart-test, that's literally happening now. ---
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          let loaded: Phase6RunState = JSON.parse(raw);
          if (loaded.phase === "awaiting-restart") {
            loaded = evaluateAwaitingRestart(loaded);
            AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(loaded)).catch(() => {});
          }
          runRef.current = loaded;
          setRun(loaded);
        }
      } catch {
        // Corrupt/missing state -- start fresh, never crash.
      } finally {
        setHydrated(true);
      }
    })();
  }, []);

  const continueRun = useCallback(async (starting: Phase6RunState) => {
    setBusy(true);
    setError(null);
    try {
      const finished = await runToNextPause(starting, (progress) => persist(progress));
      if (finished.phase === "awaiting-network") {
        // Prime the "before" network reading immediately so the first foreground check has a baseline.
        const state = await Network.getNetworkStateAsync();
        const primed = await checkAwaitingNetwork(finished, state.type ?? "UNKNOWN");
        persist(primed);
      }
      if (finished.phase === "dns-capability") {
        const { run: withDns } = await runDnsCapabilityCheck(finished);
        const withDoh = { ...withDns, steps: [...withDns.steps, notTestableDohRow()] };
        persist(withDoh);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [persist]);

  // --- Detect completion of tester-performed OS-level actions on foreground resume. ---
  useEffect(() => {
    const onChange = async (state: AppStateStatus) => {
      if (state !== "active") return;
      const current = runRef.current;
      if (!current) return;
      if (current.phase === "awaiting-revoke") {
        setBusy(true);
        const next = await checkAwaitingRevoke(current);
        persist(next);
        if (next.phase !== "awaiting-revoke") await continueRun(next);
        setBusy(false);
      } else if (current.phase === "awaiting-network") {
        setBusy(true);
        const netState = await Network.getNetworkStateAsync();
        const next = await checkAwaitingNetwork(current, netState.type ?? "UNKNOWN");
        persist(next);
        if (next.phase === "dns-capability") await continueRun(next);
        setBusy(false);
      }
    };
    const sub = AppState.addEventListener("change", onChange);
    return () => sub.remove();
  }, [persist, continueRun]);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const m1 = await fetchM1Config();
      const bundle = await fetchLatestBundle(m1.rulesetId);
      const blockRule = bundle.payload.rules.find((r) => r.action === "block");
      const initial = createInitialRun(blockRule?.host ?? "", blockRule?.ruleId ?? "");
      const buildProv = await readBuildProvenance();
      const deviceProv = readPhase6DeviceProvenance();
      const withProvenance: Phase6RunState = { ...initial, provenance: { ...buildProv }, device: { ...deviceProv } };
      persist(withProvenance);
      await continueRun(withProvenance);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function checkNow() {
    if (!run) return;
    setBusy(true);
    try {
      if (run.phase === "awaiting-revoke") {
        const next = await checkAwaitingRevoke(run);
        persist(next);
        if (next.phase !== "awaiting-revoke") await continueRun(next);
      } else if (run.phase === "awaiting-network") {
        const netState = await Network.getNetworkStateAsync();
        const next = await checkAwaitingNetwork(run, netState.type ?? "UNKNOWN");
        persist(next);
        if (next.phase === "dns-capability") await continueRun(next);
      }
    } finally {
      setBusy(false);
    }
  }

  async function recheckDnsCapability() {
    if (!run) return;
    setBusy(true);
    try {
      const { run: next } = await runDnsCapabilityCheck(run);
      persist(next);
    } finally {
      setBusy(false);
    }
  }

  async function startNewRun() {
    await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
    runRef.current = null;
    setRun(null);
    setError(null);
  }

  async function generatePdf() {
    if (!run) return;
    setBusy(true);
    try {
      const uri = await exportPhase6AutomatedReportPdf(run);
      if (uri) await shareEvidenceFile(uri);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function exportJson() {
    if (!run) return;
    setBusy(true);
    try {
      const uri = await exportPhase6AutomatedResultJson(run);
      if (uri) await shareEvidenceFile(uri);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const isDone = run?.phase === "done";
  const isAwaiting = run != null && run.phase.startsWith("awaiting-");
  const dnsRows = run?.steps.filter((s) => s.group === 4) ?? [];

  return (
    <View style={styles.root} testID="phase6a-screen">
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => router.back()} style={styles.backRow} testID="phase6a-back">
          <Text style={styles.backText}>‹ Back</Text>
        </Pressable>
        <Text style={styles.eyebrow}>GATE GUARD M2.1 · PHASE 6A</Text>
        <Text style={styles.title}>Automated Acceptance</Text>
        <Text style={styles.subtitle}>One button. The harness decides every result from observed evidence.</Text>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}>
        {!hydrated ? (
          <ActivityIndicator color={colors.brandPrimary} />
        ) : (
          <>
            {error ? (
              <View style={[styles.instructionBanner, { borderColor: "#b91c1c" }]}>
                <Text style={[styles.instructionTitle, { color: "#b91c1c" }]}>ERROR</Text>
                <Text style={styles.instructionText}>{error}</Text>
              </View>
            ) : null}

            {!run ? (
              <Card title="Ready to run">
                <Text style={styles.note}>
                  This activates real VPN protection and the Website Gate on this device, sends real traffic to the backend-authorized test domain, and automatically judges every result from
                  native evidence (protection state, recovery state, enforcement counters, validated security events). You will be asked for Android VPN permission once if not already granted.
                  A few steps near the end (VPN-revoke, app restart, network toggle) will pause and show you the exact one-tap action to perform in Android — the harness detects completion and
                  judges the result itself.
                </Text>
                <View style={styles.actions}>
                  <ActionButton title={busy ? "Starting…" : "Run Automated Acceptance"} onPress={start} disabled={busy} testID="phase6a-run-button" />
                </View>
              </Card>
            ) : (
              <>
                <Card title="Run status">
                  <KeyValue label="Run ID" value={run.runId} />
                  <KeyValue label="Started" value={run.startedAt} />
                  <KeyValue label="Authorized test domain" value={run.testDomain || "not yet configured"} />
                  {!isDone ? <Text style={styles.phaseText}>{busy ? "Working…" : `Phase: ${run.phase}`}</Text> : null}
                  {busy ? <ActivityIndicator color={colors.brandPrimary} /> : null}
                </Card>

                {isAwaiting ? (
                  <View style={styles.instructionBanner} testID="phase6a-awaiting-instruction">
                    <Text style={styles.instructionTitle}>ACTION NEEDED — ANDROID WON&apos;T LET THE APP DO THIS ITSELF</Text>
                    <Text style={styles.instructionText}>{run.awaitingInstruction ?? AWAITING_INSTRUCTIONS[run.phase]}</Text>
                    <Text style={styles.note}>Returning to this app after completing the step checks automatically. If nothing happens within a few seconds, tap below.</Text>
                    <ActionButton title={busy ? "Checking…" : "Check now"} secondary onPress={checkNow} disabled={busy} testID="phase6a-check-now" />
                  </View>
                ) : null}

                {isDone ? (
                  <Card title="Result">
                    <VerdictText verdict={run.overallVerdict} style={styles.bigVerdict} />
                    <Text style={styles.reasonCode}>{run.overallReasonCode}</Text>
                    <Text style={styles.note}>{run.overallExplanation}</Text>
                    {run.truthOfStateViolation ? <Text style={[styles.note, { color: "#b91c1c", fontWeight: "800" }]}>TRUTH-OF-STATE VIOLATION FLAGGED — see log below.</Text> : null}
                    <View style={styles.actions}>
                      <ActionButton title="Generate PDF report" onPress={generatePdf} disabled={busy} testID="phase6a-generate-pdf" />
                      <ActionButton title="Export canonical JSON" secondary onPress={exportJson} disabled={busy} testID="phase6a-export-json" />
                      <ActionButton title="Start new automated run" secondary onPress={startNewRun} disabled={busy} testID="phase6a-new-run" />
                    </View>
                  </Card>
                ) : null}

                {run.preconditions.length > 0 ? (
                  <Card title="0 · Preconditions">
                    {run.preconditions.map((s) => <StepRow key={s.id} step={s} />)}
                  </Card>
                ) : null}

                {run.steps.some((s) => s.group === 1) ? (
                  <Card title="1 · Positive enforcement">
                    {run.steps.filter((s) => s.group === 1).map((s) => <StepRow key={s.id} step={s} />)}
                  </Card>
                ) : null}

                {run.steps.some((s) => s.group === 2) ? (
                  <Card title="2 · Negative false-Biting">
                    {run.steps.filter((s) => s.group === 2).map((s) => <StepRow key={s.id} step={s} />)}
                  </Card>
                ) : null}

                {run.steps.some((s) => s.group === 3) ? (
                  <Card title="3 · Recovery / stop / revoke / restart / network">
                    {run.steps.filter((s) => s.group === 3).map((s) => <StepRow key={s.id} step={s} />)}
                  </Card>
                ) : null}

                {(dnsRows.length > 0 || isDone) ? (
                  <Card title="4 · DNS capability (Private DNS / DoT / DoH)">
                    <Text style={styles.note}>Android doesn&apos;t expose the actual Private DNS setting value to this app, so each check below classifies the observed consequence instead. You can re-run this after manually changing Private DNS in Android Settings to build up more rows — each tap is fully automatic.</Text>
                    {dnsRows.map((s) => <StepRow key={s.id} step={s} />)}
                    <ActionButton title={busy ? "Checking…" : "Re-check DNS capability now"} secondary onPress={recheckDnsCapability} disabled={busy || !run.testDomain || run.preconditions.some((p) => p.reasonCode === "NATIVE_MODULE_UNAVAILABLE")} testID="phase6a-recheck-dns" />
                  </Card>
                ) : null}

                {run.log.length > 0 ? (
                  <Card title="Run log">
                    <ScrollView style={styles.logBox} nestedScrollEnabled>
                      {run.log.map((line, i) => <Text key={i} style={styles.logLine} selectable>{line}</Text>)}
                    </ScrollView>
                  </Card>
                ) : null}
              </>
            )}

            <Pressable onPress={() => router.push("/phase6-acceptance")} testID="phase6a-advanced-link">
              <Text style={[styles.note, { color: colors.brandPrimary, textAlign: "center", marginTop: 8 }]}>Advanced / Diagnostics (manual step-by-step harness) →</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </View>
  );
}
