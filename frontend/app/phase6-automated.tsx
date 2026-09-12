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
//
// UX contract (frozen for this file): visual hierarchy is ALWAYS (1) what to do right now, (2)
// whether Apollo has detected it, (3) what Apollo itself is doing, (4) overall run progress, (5)
// raw technical evidence -- collapsed by default. Every manual OS-level step drives an explicit
// ACTION_REQUIRED → WAITING_FOR_CONFIRMATION → ACTION_CONFIRMED → CONTINUING happy path, or
// WAITING_FOR_CONFIRMATION → ACTION_NOT_DETECTED as a non-fatal recovery path (never an automatic
// FAIL -- see phase6AutomatedHarness.ts's finalizeRun, which never reads awaitingSince/awaitingAttempts).
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Network from "expo-network";
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, type AppStateStatus, Linking, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ActionButton, Card, KeyValue } from "@/src/components/harness-ui";
import { readBuildProvenance } from "@/src/harness/buildProvenance";
import {
  AWAITING_ACTION_TIMEOUT_MS,
  checkAwaitingNetwork,
  checkAwaitingRevoke,
  createInitialRun,
  evaluateAwaitingRestart,
  notTestableDohRow,
  runDnsCapabilityCheck,
  runToNextPause,
  sleep,
  type Phase6RunPhase,
  type Phase6RunState,
  type Phase6StepResult,
  type Phase6StepVerdict,
} from "@/src/harness/phase6AutomatedHarness";
import { exportPhase6AutomatedReportPdf, exportPhase6AutomatedResultJson, isFinalRun } from "@/src/harness/phase6AutomatedReport";
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
  // --- New UX-contract styles (action card / confirmation / progress / collapsed evidence) ---
  numberedStepRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  numberBubble: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.brandPrimary, alignItems: "center", justifyContent: "center", marginTop: 1 },
  numberBubbleText: { color: colors.onBrandPrimary, fontSize: 11, fontWeight: "800" },
  numberedStepText: { flex: 1, fontSize: 14, fontWeight: "600", color: colors.onSurface, lineHeight: 20 },
  confirmedBanner: { borderRadius: 12, borderWidth: 2, borderColor: colors.success, backgroundColor: colors.surfaceTertiary, padding: 14, gap: 6 },
  confirmedTitle: { fontSize: 15, fontWeight: "800", color: colors.success },
  waitingBanner: { borderRadius: 12, borderWidth: 2, borderColor: colors.brandPrimary, backgroundColor: colors.surfaceTertiary, padding: 14, gap: 8, flexDirection: "row", alignItems: "center" },
  notDetectedBanner: { borderRadius: 12, borderWidth: 2, borderColor: colors.warning, backgroundColor: colors.surfaceTertiary, padding: 14, gap: 8 },
  notDetectedTitle: { fontSize: 14, fontWeight: "800", color: colors.warning },
  noActionBanner: { borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary, padding: 10, flexDirection: "row", alignItems: "center", gap: 10 },
  noActionText: { fontSize: 12, fontWeight: "600", color: colors.onSurfaceSecondary, flex: 1 },
  workingTitle: { fontSize: 13, fontWeight: "800", color: colors.onSurfaceSecondary },
  workingDetail: { fontSize: 12, color: colors.onSurfaceTertiary },
  progressHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  progressStepText: { fontSize: 12, fontWeight: "800", color: colors.brandPrimary },
  progressBarTrack: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceTertiary, overflow: "hidden", marginTop: 4 },
  progressBarFill: { height: 6, borderRadius: 3, backgroundColor: colors.brandPrimary },
  progressCurrent: { fontSize: 14, fontWeight: "700", color: colors.onSurface, marginTop: 8 },
  progressNext: { fontSize: 12, color: colors.onSurfaceTertiary, marginTop: 2 },
  techToggleCard: { backgroundColor: colors.surfaceSecondary, borderRadius: 16, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 16 },
  techToggleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44 },
  techToggleText: { fontSize: 12, fontWeight: "700", color: colors.onSurfaceSecondary },
  techToggleChevron: { fontSize: 12, fontWeight: "700", color: colors.onSurfaceTertiary },
  interimNote: { fontSize: 11, color: colors.onSurfaceTertiary, lineHeight: 15 },
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

/** Numbered, plain-English steps shown inside the ACTION_REQUIRED card -- separate from
 * awaitingInstruction (which stays a single sentence for logs/reports). */
const AWAITING_STEPS: Record<string, string[]> = {
  "awaiting-revoke": [
    "Open Android Settings → Network & internet → VPN.",
    "Tap Apollo, then choose Disconnect or Forget.",
    "Come back to this screen — Apollo checks automatically.",
  ],
  "awaiting-restart": [
    "Open Recent apps and swipe Apollo away to fully close it.",
    "Reopen Apollo from your home screen or app drawer.",
    "It resumes automatically on this exact screen.",
  ],
  "awaiting-network": [
    "Protection is ACTIVE again — leave it running.",
    "Switch to a genuinely DIFFERENT connected network: e.g. turn Wi-Fi off so the phone switches to mobile data, or the reverse. Not just off.",
    "Come back to this screen — Apollo detects the transition and re-checks enforcement automatically.",
  ],
};

/** Android intent action to jump straight to the relevant system settings screen, where one
 * exists. "awaiting-restart" has none -- that's a Recent-apps gesture, not a settings screen. */
const AWAITING_SETTINGS_INTENT: Partial<Record<string, string>> = {
  "awaiting-revoke": "android.settings.VPN_SETTINGS",
  "awaiting-network": "android.settings.WIRELESS_SETTINGS",
};

const AWAITING_NOT_DETECTED_HINT: Record<string, string> = {
  "awaiting-revoke": "Make sure you tapped Disconnect/Forget for Apollo specifically (not a different VPN app) in Settings → VPN.",
  "awaiting-restart": "Make sure you fully swiped Apollo away in Recent apps (not just backgrounded it) before reopening — a simple background/foreground doesn't count.",
  "awaiting-network": "Make sure you landed on a genuinely different CONNECTED network (Wi-Fi ↔ mobile data) — turning a radio off without a replacement connection, or turning the same one back on, doesn't count.",
};

const AWAITING_TITLE: Record<string, string> = {
  "awaiting-revoke": "Revoke Apollo's VPN permission",
  "awaiting-restart": "Force-close and reopen Apollo",
  "awaiting-network": "Switch to a different connected network",
};

/** The 14 human-facing milestones this run passes through, in order — used only to render the
 * "What happens next?" progress panel. Purely cosmetic; never consulted for any verdict. */
const MILESTONES: { label: string; duration: string; noAction: boolean }[] = [
  { label: "Verifying build & device", duration: "a few seconds", noAction: true },
  { label: "Requesting VPN permission (Android may prompt you once)", duration: "one tap if prompted", noAction: false },
  { label: "Loading & verifying signed security rules", duration: "a few seconds", noAction: true },
  { label: "Starting protection & activating the Website Gate", duration: "up to 15 seconds", noAction: true },
  { label: "Testing blocked-domain enforcement (twice, same live binding)", duration: "up to 20 seconds", noAction: true },
  { label: "Running false-positive safety checks (5 checks)", duration: "about 30 seconds total", noAction: true },
  { label: "Stopping protection & confirming clean recovery", duration: "a few seconds", noAction: true },
  { label: "Waiting on you: revoke Apollo's VPN permission", duration: "waiting on you", noAction: false },
  { label: "Waiting on you: force-close and reopen the app", duration: "waiting on you", noAction: false },
  { label: "Re-establishing an active session for the network test", duration: "up to 15 seconds, may prompt once", noAction: false },
  { label: "Waiting on you: switch to a different connected network", duration: "waiting on you", noAction: false },
  { label: "Running the automatic DNS-capability check", duration: "a few seconds", noAction: true },
  { label: "Done — review & export your report", duration: "—", noAction: true },
];

function milestoneIndex(phase: Phase6RunPhase): number {
  switch (phase) {
    case "idle":
    case "provenance":
    case "native-check":
      return 0;
    case "consent":
      return 1;
    case "config":
      return 2;
    case "start-protection":
    case "gate-active":
    case "clear-override":
      return 3;
    case "positive":
      return 4;
    case "negative":
      return 5;
    case "recovery-stop":
      return 6;
    case "awaiting-revoke":
      return 7;
    case "awaiting-restart":
      return 8;
    case "reactivate-for-network":
      return 9;
    case "awaiting-network":
      return 10;
    case "dns-capability":
      return 11;
    case "done":
      return 12;
    default:
      return 0;
  }
}

type AwaitingSubState = "ACTION_REQUIRED" | "WAITING_FOR_CONFIRMATION" | "ACTION_NOT_DETECTED";

function computeAwaitingSubState(run: Phase6RunState, busy: boolean): AwaitingSubState {
  if (busy) return "WAITING_FOR_CONFIRMATION";
  if (run.awaitingSince && Date.now() - new Date(run.awaitingSince).getTime() > AWAITING_ACTION_TIMEOUT_MS) return "ACTION_NOT_DETECTED";
  return "ACTION_REQUIRED";
}

/** Best-effort: jumps straight to the relevant Android settings screen. Silently no-ops on
 * iOS/web or if the OS rejects the intent -- the numbered steps above are always sufficient on
 * their own, this button is a convenience, never a requirement. */
async function openAndroidSettings(intentAction: string) {
  if (Platform.OS !== "android") return;
  try {
    await Linking.sendIntent(intentAction);
  } catch {
    try {
      await Linking.openSettings();
    } catch {
      // No settings surface reachable -- the numbered steps already told the tester where to go manually.
    }
  }
}

export default function Phase6Automated() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const [run, setRun] = useState<Phase6RunState | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Non-null while showing the transient "✓ Done" confirmation card (the CONTINUING state) --
   * overrides whatever the underlying run.phase would otherwise render for ~2s. */
  const [confirmationHold, setConfirmationHold] = useState<string | null>(null);
  const [techExpanded, setTechExpanded] = useState(false);
  const runRef = useRef<Phase6RunState | null>(null);
  const checkInFlightRef = useRef(false);
  runRef.current = run;

  const persist = useCallback((next: Phase6RunState) => {
    runRef.current = next;
    setRun(next);
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch(() => {});
  }, []);

  /** Holds a "✓ Done" confirmation on screen for ~2s (CONTINUING) before letting whatever the next
   * phase's card is render underneath -- gives the tester a moment to actually register the
   * confirmation instead of the screen jumping straight to the next instruction. The run data
   * itself is always persisted BEFORE this is called; this only delays what gets *rendered*. */
  const holdConfirmation = useCallback(async (message: string) => {
    setConfirmationHold(message);
    await sleep(2000);
    setConfirmationHold(null);
  }, []);

  const continueRun = useCallback(async (starting: Phase6RunState) => {
    setBusy(true);
    setError(null);
    try {
      const finished = await runToNextPause(starting, (progress) => persist(progress));
      if (finished.phase === "awaiting-network") {
        // Prime the "before" network reading immediately so the first check has a baseline.
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

  // --- Load persisted run on mount; if we were mid-restart-test, that's literally happening now. ---
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          let loaded: Phase6RunState = JSON.parse(raw);
          const wasAwaitingRestart = loaded.phase === "awaiting-restart";
          if (wasAwaitingRestart) {
            loaded = await evaluateAwaitingRestart(loaded);
            AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(loaded)).catch(() => {});
          }
          runRef.current = loaded;
          setRun(loaded);
          if (wasAwaitingRestart) {
            const restartStep = loaded.steps.find((s) => s.id === "3.3");
            if (restartStep) holdConfirmation(`Apollo confirmed the restart. ${restartStep.explanation}`);
          }
          if (loaded.phase === "reactivate-for-network") {
            // Row 3.3's checks are done (just now, or from an earlier reopened session); re-establish
            // an ACTIVE session for rows 3.4/3.5 fully automatically (may trigger one Android
            // VPN-consent system dialog -- expected).
            setHydrated(true);
            await continueRun(loaded);
            return;
          }
        }
      } catch {
        // Corrupt/missing state -- start fresh, never crash.
      } finally {
        setHydrated(true);
      }
    })();
  }, [holdConfirmation, continueRun]);

  /** Single source of truth for "check whether the tester's manual step is done yet" -- used by the
   * foreground listener, the periodic poll, and the manual "Check now" / "Try again" button so all
   * three give identical, reliable feedback. On a positive detection, holds a "✓ Done" confirmation
   * on screen for ~2s (CONTINUING) before advancing to the next phase. Never overlaps itself. */
  const runAwaitingCheck = useCallback(async () => {
    const current = runRef.current;
    if (!current || checkInFlightRef.current) return;
    if (current.phase !== "awaiting-revoke" && current.phase !== "awaiting-network") return;
    checkInFlightRef.current = true;
    setBusy(true);
    try {
      if (current.phase === "awaiting-revoke") {
        const next = await checkAwaitingRevoke(current);
        persist(next);
        setBusy(false);
        if (next.phase !== "awaiting-revoke") {
          const lastStep = next.steps[next.steps.length - 1];
          await holdConfirmation(lastStep?.explanation ?? "Apollo confirmed the change.");
          await continueRun(next);
        }
      } else {
        const netState = await Network.getNetworkStateAsync();
        const next = await checkAwaitingNetwork(current, netState.type ?? "UNKNOWN");
        persist(next);
        setBusy(false);
        if (next.phase === "dns-capability") {
          const lastStep = next.steps[next.steps.length - 1];
          await holdConfirmation(lastStep?.explanation ?? "Apollo confirmed the change.");
          await continueRun(next);
        }
      }
    } finally {
      checkInFlightRef.current = false;
    }
  }, [persist, continueRun, holdConfirmation]);

  // --- Detect completion of tester-performed OS-level actions on foreground resume. ---
  useEffect(() => {
    const onChange = (state: AppStateStatus) => {
      if (state === "active") runAwaitingCheck();
    };
    const sub = AppState.addEventListener("change", onChange);
    return () => sub.remove();
  }, [runAwaitingCheck]);

  // --- Fallback: some OS-level actions (e.g. toggling Wi-Fi via the quick-settings shade) don't
  // reliably background/foreground the app, so the foreground listener above may never fire. Poll
  // periodically as a safety net whenever we're actually waiting on the tester -- this same tick
  // also keeps the ACTION_NOT_DETECTED timeout state fresh on screen. ---
  useEffect(() => {
    if (!run || (run.phase !== "awaiting-revoke" && run.phase !== "awaiting-network")) return;
    const interval = setInterval(() => runAwaitingCheck(), 4000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.phase, runAwaitingCheck]);

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
    await runAwaitingCheck();
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
    setConfirmationHold(null);
    setTechExpanded(false);
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

  const isDone = run != null && isFinalRun(run);
  const isAwaiting = run != null && run.phase.startsWith("awaiting-");
  const dnsRows = run?.steps.filter((s) => s.group === 4) ?? [];
  const milestoneIdx = run ? milestoneIndex(run.phase) : 0;
  const milestone = MILESTONES[milestoneIdx];
  const nextMilestone = MILESTONES[milestoneIdx + 1] ?? null;
  const subState: AwaitingSubState | null = run && isAwaiting ? computeAwaitingSubState(run, busy) : null;
  const totalChecks = run ? run.preconditions.length + run.steps.length : 0;
  const settingsIntent = run ? AWAITING_SETTINGS_INTENT[run.phase] : undefined;

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
              <View style={[styles.instructionBanner, { borderColor: "#b91c1c" }]} testID="phase6a-error-banner">
                <Text style={[styles.instructionTitle, { color: "#b91c1c" }]}>ERROR</Text>
                <Text style={styles.instructionText}>{error}</Text>
              </View>
            ) : null}

            {!run ? (
              <Card title="Ready to run">
                <Text style={styles.note}>
                  This activates real VPN protection and the Website Gate on this device, sends real traffic to the backend-authorized test domain, and automatically judges every result from
                  native evidence (protection state, recovery state, enforcement counters, validated security events). You will be asked for Android VPN permission once if not already granted.
                  A few steps near the end (VPN-revoke, app restart, network toggle) will pause and walk you through exactly what to do — Apollo detects completion and judges the result itself.
                </Text>
                <View style={styles.actions}>
                  <ActionButton title={busy ? "Starting…" : "Run Automated Acceptance"} onPress={start} disabled={busy} testID="phase6a-run-button" />
                </View>
              </Card>
            ) : (
              <>
                {/* ============ 1 & 2. WHAT TO DO RIGHT NOW, and WHETHER APOLLO DETECTED IT ============ */}
                {confirmationHold ? (
                  <View style={styles.confirmedBanner} testID="phase6a-confirmed">
                    <Text style={styles.confirmedTitle}>✓ Done — Apollo detected the change correctly</Text>
                    <Text style={styles.instructionText}>{confirmationHold}</Text>
                  </View>
                ) : isAwaiting && subState === "WAITING_FOR_CONFIRMATION" ? (
                  <View style={styles.waitingBanner} testID="phase6a-waiting">
                    <ActivityIndicator color={colors.brandPrimary} />
                    <Text style={styles.instructionText}>Checking whether you&apos;ve completed this step…</Text>
                  </View>
                ) : isAwaiting && subState === "ACTION_NOT_DETECTED" ? (
                  <View style={styles.notDetectedBanner} testID="phase6a-not-detected">
                    <Text style={styles.notDetectedTitle}>Apollo didn&apos;t detect the change yet</Text>
                    <Text style={styles.instructionText}>{AWAITING_NOT_DETECTED_HINT[run.phase] ?? "Double-check you completed the step below, then try again."}</Text>
                    <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
                      <ActionButton title="Try again" onPress={checkNow} disabled={busy} testID="phase6a-check-now" />
                      {settingsIntent ? <ActionButton title="Open Settings" secondary onPress={() => openAndroidSettings(settingsIntent)} testID="phase6a-open-settings" /> : null}
                    </View>
                  </View>
                ) : isAwaiting ? (
                  <View style={styles.instructionBanner} testID="phase6a-awaiting-instruction">
                    <Text style={styles.instructionTitle}>ACTION NEEDED · {AWAITING_TITLE[run.phase] ?? "Android won't let the app do this itself"}</Text>
                    {(AWAITING_STEPS[run.phase] ?? []).map((text, i) => (
                      <View key={i} style={styles.numberedStepRow}>
                        <View style={styles.numberBubble}>
                          <Text style={styles.numberBubbleText}>{i + 1}</Text>
                        </View>
                        <Text style={styles.numberedStepText}>{text}</Text>
                      </View>
                    ))}
                    <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap", marginTop: 4 }}>
                      <ActionButton title="Check now" secondary onPress={checkNow} disabled={busy} testID="phase6a-check-now" />
                      {settingsIntent ? <ActionButton title="Open Settings" secondary onPress={() => openAndroidSettings(settingsIntent)} testID="phase6a-open-settings" /> : null}
                    </View>
                  </View>
                ) : !isDone && milestone.noAction ? (
                  <View style={styles.noActionBanner} testID="phase6a-no-action-banner">
                    <ActivityIndicator color={colors.brandPrimary} />
                    <Text style={styles.noActionText}>No action needed from you right now — Apollo is running this step automatically.</Text>
                  </View>
                ) : !isDone ? (
                  <View style={styles.noActionBanner} testID="phase6a-no-action-banner">
                    <ActivityIndicator color={colors.brandPrimary} />
                    <Text style={styles.noActionText}>Working automatically — Android may show its own one-time system prompt during this step; respond to that if it appears.</Text>
                  </View>
                ) : null}

                {/* ============ 3. WHAT APOLLO ITSELF IS DOING ============ */}
                {!isDone ? (
                  <Card title="What Apollo is doing">
                    <Text style={styles.workingTitle}>{isAwaiting ? "Paused — waiting for the action above" : milestone.label}</Text>
                    {!isAwaiting ? <Text style={styles.workingDetail}>Typically {milestone.duration}.</Text> : null}
                  </Card>
                ) : null}

                {/* ============ 4. OVERALL PROGRESS ============ */}
                {!isDone ? (
                  <Card title="What happens next?" testID="phase6a-progress-panel">
                    <View style={styles.progressHeaderRow}>
                      <Text style={styles.progressStepText}>Step {milestoneIdx + 1} of {MILESTONES.length}</Text>
                    </View>
                    <View style={styles.progressBarTrack}>
                      <View style={[styles.progressBarFill, { width: `${((milestoneIdx + 1) / MILESTONES.length) * 100}%` }]} />
                    </View>
                    <Text style={styles.progressCurrent}>Current: {milestone.label}</Text>
                    {nextMilestone ? <Text style={styles.progressNext}>Next: {nextMilestone.label}</Text> : null}
                    <Text style={styles.progressNext}>Estimated: {milestone.duration}</Text>
                    <Text style={[styles.interimNote, { marginTop: 6 }]}>
                      Need to stop early or debug? Export an interim diagnostic report below — it&apos;s always clearly labelled as incomplete, never presented as an acceptance verdict.
                    </Text>
                    <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap", marginTop: 4 }}>
                      <ActionButton title="Interim PDF" secondary onPress={generatePdf} disabled={busy} testID="phase6a-export-interim-pdf" />
                      <ActionButton title="Interim JSON" secondary onPress={exportJson} disabled={busy} testID="phase6a-export-interim-json" />
                    </View>
                  </Card>
                ) : null}

                {/* ============ Result — only once the harness has actually finished ============ */}
                {isDone ? (
                  <Card title="Result">
                    <VerdictText verdict={run.overallVerdict} style={styles.bigVerdict} />
                    <Text style={styles.reasonCode}>{run.overallReasonCode}</Text>
                    <Text style={styles.note}>{run.overallExplanation}</Text>
                    {run.truthOfStateViolation ? <Text style={[styles.note, { color: "#b91c1c", fontWeight: "800" }]}>TRUTH-OF-STATE VIOLATION FLAGGED — see Technical Evidence below.</Text> : null}
                    <View style={styles.actions}>
                      <ActionButton title="Generate PDF report" onPress={generatePdf} disabled={busy} testID="phase6a-generate-pdf" />
                      <ActionButton title="Export canonical JSON" secondary onPress={exportJson} disabled={busy} testID="phase6a-export-json" />
                      <ActionButton title="Start new automated run" secondary onPress={startNewRun} disabled={busy} testID="phase6a-new-run" />
                    </View>
                  </Card>
                ) : null}

                {/* ============ 5. TECHNICAL EVIDENCE — collapsed by default ============ */}
                <View style={styles.techToggleCard}>
                  <Pressable style={styles.techToggleRow} onPress={() => setTechExpanded((v) => !v)} testID="phase6a-tech-toggle" accessibilityRole="button">
                    <Text style={styles.techToggleText}>Technical Evidence · {totalChecks} checks</Text>
                    <Text style={styles.techToggleChevron}>{techExpanded ? "Hide details ▲" : "View details ▼"}</Text>
                  </Pressable>
                </View>

                {techExpanded ? (
                  <>
                    <Card title="Run status">
                      <KeyValue label="Run ID" value={run.runId} />
                      <KeyValue label="Started" value={run.startedAt} />
                      <KeyValue label="Authorized test domain" value={run.testDomain || "not yet configured"} />
                      <KeyValue label="Phase" value={run.phase} />
                    </Card>

                    {!isDone ? (
                      <Card title="Abandon this run">
                        <Text style={styles.note}>Starts a brand-new automated run from scratch. This run&apos;s un-exported data is discarded.</Text>
                        <ActionButton title="Start new run" secondary onPress={startNewRun} disabled={busy} testID="phase6a-abandon-run" />
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
                        <Text style={styles.note}>Android doesn&apos;t expose the actual Private DNS setting value to this app, so each check below classifies the observed consequence instead. Change Private DNS in Android Settings, then re-check — each tap is fully automatic.</Text>
                        {dnsRows.map((s) => <StepRow key={s.id} step={s} />)}
                        <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
                          <ActionButton title={busy ? "Checking…" : "Re-check DNS capability now"} secondary onPress={recheckDnsCapability} disabled={busy || !run.testDomain || run.preconditions.some((p) => p.reasonCode === "NATIVE_MODULE_UNAVAILABLE")} testID="phase6a-recheck-dns" />
                          <ActionButton title="Open Private DNS Settings" secondary onPress={() => openAndroidSettings("android.settings.PRIVATE_DNS_SETTINGS")} testID="phase6a-open-private-dns-settings" />
                        </View>
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
