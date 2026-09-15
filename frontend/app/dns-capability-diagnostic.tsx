// Gate Guard — out-of-band Private DNS (DoT) / app-embedded DoH capability characterization tool.
//
// COMPLETELY SEPARATE from the frozen M2.1 Phase 6A acceptance harness (/phase6-automated,
// src/harness/phase6AutomatedHarness.ts). This screen does not run, re-run, weaken, or affect any
// M2.1 acceptance row or verdict — it is a standalone diagnostic for a different, later milestone:
// documenting Apollo's visibility boundary under various Private DNS / app-embedded DoH
// configurations. Observational only — no mitigation, blocking of port 853, encrypted-DNS
// heuristics, or DoH interception is implemented or exercised here. See
// docs/dns-capability-characterization.md for the full methodology and findings.
//
// Guided, evidence-automated wizard: human involvement is strictly limited to changing an
// Android/browser setting and tapping "Continue" once a step's own evidence is already captured.
// Every classification is machine-observed; the wizard NEVER lets a row be labelled under a
// configuration it could not verify (no "Continue anyway" escape hatch -- see
// pollForPrivateDnsRuntimeMode / PRIVATE_DNS_POLL_HARD_TIMEOUT_MS in dnsCapabilityDiagnostic.ts).
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Linking, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ActionButton, Card, InlineResultCard, KeyValue } from "@/src/components/harness-ui";
import {
  activateWebsiteGateForDiagnostics,
  type ActivationResult,
  buildAppEmbeddedDohRecord,
  buildDohProbeUrl,
  CLASSIFICATION_LABELS,
  type DnsDiagnosticRecord,
  type DotWizardStepConfig,
  DOT_WIZARD_STEPS,
  generateProbeNonce,
  getNetworkType,
  notTestableRecord,
  pollForPrivateDnsRuntimeMode,
  PRIVATE_DNS_POLL_HARD_TIMEOUT_MS,
  PRIVATE_DNS_POLL_STILL_CHECKING_AFTER_MS,
  ROW_PROBE_IDENTITY,
  runPrivateDnsProbeForStep,
  startAppEmbeddedDohObservation,
} from "@/src/diagnostics/dnsCapabilityDiagnostic";
import { exportDnsCharacterizationJson, exportDnsCharacterizationPdf } from "@/src/diagnostics/dnsCapabilityDiagnosticReport";
import { captureDnsDiagnosticTruthSnapshot } from "@/src/diagnostics/dnsCapabilityTruthSnapshot";
import { readBuildProvenance } from "@/src/harness/buildProvenance";
import { readPhase6DeviceProvenance } from "@/src/harness/phase6DeviceProvenance";
import { shareEvidenceFile } from "@/src/harness/proofReport";
import { writeDnsDohStatus } from "@/src/harness/testRunStatus";
import type { NativeDnsCapabilityDeviceSnapshot } from "@/src/sdk/nativeModule";
import { makeStyles, useTheme } from "@/src/theme";

type WizardStepId = "preflight" | "dot-off" | "dot-automatic" | "dot-strict" | "doh-off" | "doh-on" | "final-report";
type DohStepId = "doh-off" | "doh-on";

const STEP_ORDER: WizardStepId[] = ["preflight", "dot-off", "dot-automatic", "dot-strict", "doh-off", "doh-on", "final-report"];
const STEP_TITLES: Record<WizardStepId, string> = {
  preflight: "Preflight",
  "dot-off": "Private DNS — Off",
  "dot-automatic": "Private DNS — Automatic",
  "dot-strict": "Private DNS — Strict",
  "doh-off": "Browser DoH — Off",
  "doh-on": "Browser DoH — On",
  "final-report": "Final report",
};

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: 20, paddingBottom: 12, gap: 4 },
  backRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  backText: { color: colors.brandPrimary, fontSize: 15, fontWeight: "700" },
  eyebrow: { color: colors.onSurfaceTertiary, fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  title: { color: colors.onSurface, fontSize: 22, fontWeight: "800" },
  subtitle: { color: colors.onSurfaceSecondary, fontSize: 13 },
  progressRow: { flexDirection: "row", gap: 6, marginTop: 12 },
  progressDot: { flex: 1, height: 5, borderRadius: 3 },
  stepLabel: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: "700", marginTop: 8 },
  content: { paddingHorizontal: 20, gap: 16, paddingBottom: 40 },
  note: { color: colors.onSurfaceTertiary, fontSize: 12, lineHeight: 17 },
  buttonRow: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  errorText: { color: colors.error, fontSize: 12, fontWeight: "600" },
  scopeBanner: { backgroundColor: colors.surfaceTertiary, borderRadius: 12, padding: 12, gap: 4, borderWidth: 1, borderColor: colors.border },
  scopeBannerText: { color: colors.onSurfaceSecondary, fontSize: 11, lineHeight: 16 },
  probeUrlBox: { backgroundColor: colors.surfaceTertiary, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: colors.borderStrong },
  probeUrlText: { color: colors.brandPrimary, fontSize: 13, fontWeight: "700" },
  timerText: { color: colors.onSurfaceTertiary, fontSize: 12, fontStyle: "italic" },
  violationBanner: { backgroundColor: colors.surfaceTertiary, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: colors.error, gap: 4 },
  violationText: { color: colors.error, fontSize: 12, fontWeight: "700" },
}));

function classificationTone(c: DnsDiagnosticRecord["classification"]): "good" | "bad" | "neutral" {
  if (c === "CAPTURED") return "good";
  if (c === "BYPASSED") return "bad";
  return "neutral";
}

function recordToRows(r: DnsDiagnosticRecord): [string, string][] {
  return [
    ["Category", r.category],
    ["Probe host", r.probeHostname],
    ["Network", r.transportNetworkType ?? "unknown"],
    ["Saw plaintext UDP/53", r.sawPlaintextUdp53 ? "yes" : "no"],
    ["Independent success", r.independentSuccess === null ? "n/a" : r.independentSuccess ? `yes (${r.independentSuccessSource})` : `no (${r.independentSuccessSource})`],
    ["Meaning", CLASSIFICATION_LABELS[r.classification]],
    ...(r.truthSnapshot.truthViolation.violated ? ([["⚠ Truth violation", r.truthSnapshot.truthViolation.reasons.join(" ")]] as [string, string][]) : []),
    ...(r.notes ? ([["Notes", r.notes]] as [string, string][]) : []),
  ];
}

export default function DnsCapabilityDiagnosticScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const [stepIndex, setStepIndex] = useState(0);
  const currentStepId = STEP_ORDER[stepIndex];

  const [sessionId] = useState(() => `dns-doh-${Date.now()}`);
  const [sessionStartedAt] = useState(() => new Date().toISOString());

  const [activation, setActivation] = useState<ActivationResult | null>(null);
  const [activating, setActivating] = useState(false);
  const [records, setRecords] = useState<DnsDiagnosticRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stepResult, setStepResult] = useState<DnsDiagnosticRecord | null>(null);

  // Carried through from the Preflight activation result into every per-row/per-step snapshot this
  // session (never re-derived per row -- see dnsCapabilityTruthSnapshot.ts doc comments).
  const preflightCarry = {
    m1BundleAccepted: activation?.m1BundleAccepted ?? null,
    probeRuleConfirmedInBundle: activation?.probeRuleConfirmedInBundle ?? null,
    internetContinuityOk: activation?.internetContinuityOk ?? null,
  };

  // --- Private DNS (DoT) automated polling sub-state ---
  const [pollPhase, setPollPhase] = useState<"idle" | "polling" | "matched" | "timed-out">("idle");
  const [pollElapsedMs, setPollElapsedMs] = useState(0);
  const [pollSnapshot, setPollSnapshot] = useState<NativeDnsCapabilityDeviceSnapshot | null>(null);
  const pollCancelRef = useRef(false);

  // --- App-embedded DoH sub-state ---
  const [dohBrowserLabel, setDohBrowserLabel] = useState("");
  const [dohPhase, setDohPhase] = useState<"idle" | "observing">("idle");
  const dohObservationRef = useRef<{ startedAt: string; finish: () => Promise<{ event: import("@/src/contracts/securityEventSchemas").SecurityEvent | null; receiptConfirmed: boolean }> } | null>(null);
  const dohNonceRef = useRef<string | null>(null);
  const dohStepRef = useRef<DohStepId | null>(null);
  const dohTruthSnapshotRef = useRef<Awaited<ReturnType<typeof captureDnsDiagnosticTruthSnapshot>> | null>(null);
  const dohNetTypeRef = useRef<string | null>(null);
  const dohWentBackgroundRef = useRef(false);
  const dohFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function resetStepTransientState() {
    setError(null);
    setStepResult(null);
    setPollPhase("idle");
    setPollElapsedMs(0);
    setPollSnapshot(null);
    setDohPhase("idle");
    // dohBrowserLabel is deliberately NOT reset here -- entered once, carried across doh-off/doh-on.
  }

  function goToStep(index: number) {
    pollCancelRef.current = true;
    if (dohFallbackTimerRef.current) clearTimeout(dohFallbackTimerRef.current);
    dohObservationRef.current = null;
    resetStepTransientState();
    setStepIndex(index);
  }

  // Home-screen "at a glance" status pill (see src/harness/testRunStatus.ts) -- purely a UI
  // signal, never read back by this wizard and never affects any classification/verdict here.
  useEffect(() => {
    if (currentStepId === "preflight" || currentStepId === "final-report") return;
    writeDnsDohStatus("in_progress");
  }, [currentStepId]);
  useEffect(() => {
    if (currentStepId !== "final-report") return;
    const hasTruthViolation = records.some((r) => r.truthSnapshot.truthViolation.violated);
    writeDnsDohStatus(hasTruthViolation ? "needs_attention" : "completed");
  }, [currentStepId, records]);

  /** Only ever called for "dot-automatic"/"dot-strict" (targetRuntimeMode is machine-provable for
   * those). "dot-off" never polls-to-match -- see handleConfirmDotOff. */
  async function handleStartDotPolling(step: DotWizardStepConfig) {
    if (step.targetRuntimeMode === null) return;
    setError(null);
    setStepResult(null);
    setPollPhase("polling");
    setPollElapsedMs(0);
    setPollSnapshot(null);
    const result = await pollForPrivateDnsRuntimeMode(step.targetRuntimeMode, {
      onTick: (tick) => {
        setPollElapsedMs(tick.elapsedMs);
        setPollSnapshot(tick.snapshot);
      },
      isCancelled: () => pollCancelRef.current,
    });
    if (pollCancelRef.current) return; // the tester navigated away from this step -- ignore this stale result
    if (result.outcome === "matched") {
      setPollPhase("matched");
      setBusy(true);
      try {
        const record = await runPrivateDnsProbeForStep(step, preflightCarry);
        setRecords((prev) => [record, ...prev]);
        setStepResult(record);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    } else if (result.outcome === "unavailable") {
      setError("NATIVE_MODULE_UNAVAILABLE — Private DNS detection requires a native Android build (not Expo Go / web).");
      setPollPhase("timed-out");
    } else if (result.outcome === "timed-out") {
      setPollPhase("timed-out");
    }
  }

  /** "dot-off" row: Android's public API can NEVER prove "Off" was selected (see
   * dnsCapabilityDiagnostic.ts) -- so instead of polling-to-match, the tester explicitly confirms
   * THEIR OWN selection here, and Apollo records the machine-observed state honestly alongside it
   * (never displayed as "Off verified"). */
  async function handleConfirmDotOff(step: DotWizardStepConfig) {
    setError(null);
    setStepResult(null);
    setBusy(true);
    try {
      const record = await runPrivateDnsProbeForStep(step, preflightCarry);
      setRecords((prev) => [record, ...prev]);
      setStepResult(record);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // Auto-start automated detection the moment a machine-verifiable Private DNS step becomes
  // current. "dot-off" is excluded -- it waits for the tester's manual confirmation instead.
  useEffect(() => {
    pollCancelRef.current = false;
    if ((currentStepId === "dot-automatic" || currentStepId === "dot-strict") && activation?.ok) {
      const step = DOT_WIZARD_STEPS.find((s) => s.id === currentStepId);
      if (step) void handleStartDotPolling(step);
    }
    return () => {
      pollCancelRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex]);

  // Re-check immediately whenever the app resumes (tester likely just returned from Android Settings).
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        if (dohObservationRef.current && dohWentBackgroundRef.current) {
          void finishDohObservation();
        }
      } else if (next === "background" || next === "inactive") {
        if (dohObservationRef.current) dohWentBackgroundRef.current = true;
      }
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openPrivateDnsSettings() {
    if (Platform.OS === "android") {
      Linking.sendIntent("android.settings.PRIVATE_DNS_SETTINGS").catch(() => Linking.openSettings());
    } else {
      Linking.openSettings();
    }
  }

  async function handleRecordDotNotTestable(step: DotWizardStepConfig) {
    pollCancelRef.current = true;
    setBusy(true);
    try {
      const snapshot = await captureDnsDiagnosticTruthSnapshot(preflightCarry);
      const reason =
        step.targetRuntimeMode === null
          ? "Tester chose not to confirm the Off configuration for this row."
          : `Automated detection did not observe the target Private DNS runtime state (${step.targetRuntimeMode}) within ${PRIVATE_DNS_POLL_HARD_TIMEOUT_MS / 1000}s.`;
      const record = notTestableRecord("private-dns", `${step.title}: not testable`, reason, snapshot, ROW_PROBE_IDENTITY[step.id].host);
      setRecords((prev) => [record, ...prev]);
      setStepResult(record);
      setPollPhase("idle");
    } finally {
      setBusy(false);
    }
  }

  async function handleActivate() {
    setActivating(true);
    setError(null);
    try {
      const result = await activateWebsiteGateForDiagnostics();
      setActivation(result);
      if (!result.ok) setError(result.reason);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActivating(false);
    }
  }

  async function handleStartDohStep(step: DohStepId) {
    setError(null);
    setStepResult(null);
    setBusy(true);
    try {
      const identity = ROW_PROBE_IDENTITY[step];
      const nonce = generateProbeNonce();
      dohNonceRef.current = nonce;
      dohStepRef.current = step;
      dohTruthSnapshotRef.current = await captureDnsDiagnosticTruthSnapshot(preflightCarry);
      dohNetTypeRef.current = await getNetworkType();
      const observation = startAppEmbeddedDohObservation(identity.host, identity.ruleId, nonce, 120_000);
      dohObservationRef.current = observation;
      dohWentBackgroundRef.current = false;
      setDohPhase("observing");
      await Linking.openURL(buildDohProbeUrl(identity.host, nonce));
      // Safety net in case AppState never reports background/active (e.g. multi-window/split-screen browsers).
      dohFallbackTimerRef.current = setTimeout(() => void finishDohObservation(), 125_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      dohObservationRef.current = null;
    } finally {
      setBusy(false);
    }
  }

  async function finishDohObservation() {
    const observation = dohObservationRef.current;
    const nonce = dohNonceRef.current;
    const step = dohStepRef.current;
    if (!observation || !nonce || !step) return;
    const identity = ROW_PROBE_IDENTITY[step];
    dohObservationRef.current = null;
    if (dohFallbackTimerRef.current) {
      clearTimeout(dohFallbackTimerRef.current);
      dohFallbackTimerRef.current = null;
    }
    setBusy(true);
    setError(null);
    try {
      const { event, receiptConfirmed } = await observation.finish();
      const label = `${dohBrowserLabel.trim() || "Unnamed browser"} — ${step === "doh-on" ? "DoH ON" : "DoH OFF"}`;
      const record = buildAppEmbeddedDohRecord(label, identity.host, identity.ruleId, nonce, event, receiptConfirmed, observation.startedAt, dohNetTypeRef.current, dohTruthSnapshotRef.current!);
      setRecords((prev) => [record, ...prev]);
      setStepResult(record);
      setDohPhase("idle");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleRecordDohNotTestable(step: DohStepId) {
    setBusy(true);
    try {
      const snapshot = await captureDnsDiagnosticTruthSnapshot(preflightCarry);
      const label = `${dohBrowserLabel.trim() || "Unnamed browser"} — ${step === "doh-on" ? "DoH ON" : "DoH OFF"}`;
      const record = notTestableRecord("app-embedded-doh", label, "Tester marked this configuration as not testable (e.g. that browser unavailable on this device).", snapshot, ROW_PROBE_IDENTITY[step].host);
      setRecords((prev) => [record, ...prev]);
      setStepResult(record);
      setDohPhase("idle");
    } finally {
      setBusy(false);
    }
  }

  async function buildRun() {
    const [buildProvenance, deviceProvenance] = await Promise.all([readBuildProvenance(), Promise.resolve(readPhase6DeviceProvenance())]);
    return { runId: sessionId, startedAt: sessionStartedAt, records: [...records].reverse(), buildProvenance, deviceProvenance, preflightSnapshot: activation?.preflightSnapshot ?? null };
  }

  /** Single share action (physical-device review requested this instead of two separate
   * Export JSON / Export PDF buttons): generates BOTH artifacts for the record, but only shares
   * the PDF via the OS share sheet -- it's the comprehensive, human-readable evidence artifact and
   * already includes everything the JSON does, presented as tables. */
  async function handleShareReport() {
    setBusy(true);
    setError(null);
    try {
      const run = await buildRun();
      await exportDnsCharacterizationJson(run); // written to disk for raw-evidence audit trails; not part of the share sheet
      const pdfUri = await exportDnsCharacterizationPdf(run);
      if (pdfUri) await shareEvidenceFile(pdfUri);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const preflightPassed = !!activation?.ok && !activation.preflightSnapshot.truthViolation.violated;

  return (
    <View style={styles.root} testID="dns-doh-diagnostic-screen">
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => (stepIndex > 0 ? goToStep(stepIndex - 1) : router.back())} style={styles.backRow} testID="dns-doh-back">
          <Text style={styles.backText}>‹ Back</Text>
        </Pressable>
        <Text style={styles.eyebrow}>GUIDED · EVIDENCE-AUTOMATED · OBSERVATIONAL ONLY</Text>
        <Text style={styles.title}>Private DNS / DoH Capability Diagnostic</Text>
        <Text style={styles.subtitle}>Separate from the frozen M2.1 acceptance harness — characterizes what Apollo can and cannot see.</Text>
        <View style={styles.progressRow} testID="dns-wizard-progress">
          {STEP_ORDER.map((id, i) => (
            <View key={id} style={[styles.progressDot, { backgroundColor: i < stepIndex ? colors.success : i === stepIndex ? colors.brandPrimary : colors.surfaceTertiary }]} />
          ))}
        </View>
        <Text style={styles.stepLabel}>
          Step {stepIndex + 1} of {STEP_ORDER.length} · {STEP_TITLES[currentStepId]}
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {currentStepId === "preflight" ? (
          <>
            <View style={styles.scopeBanner}>
              <Text style={styles.scopeBannerText}>
                This tool never blocks, enforces, or changes routing — it only records machine-observed evidence. The only manual actions anywhere in this wizard are changing an Android/browser setting yourself and tapping Continue once a step&apos;s evidence is captured.
              </Text>
            </View>
            <Card title="Activate protection + diagnostic Website Gate">
              <Text style={styles.note}>
                Required once per session before any probe runs. Uses this wizard&apos;s OWN dedicated, separately-signed rule bundle (never the production Website Gate bundle, and never the frozen M2.1 bundle) -- 5 unique probe hosts, one per row below, so no row can ever reuse another row&apos;s cached DNS answer.
              </Text>
              <ActionButton title={activating ? "Activating…" : activation ? "Retry activation" : "Start diagnostic"} onPress={handleActivate} disabled={activating} testID="dns-doh-activate" />
              {activation ? (
                <>
                  <KeyValue label="Status" value={activation.ok ? "Active" : `Failed: ${activation.reason}`} testID="dns-doh-activation-status" />
                  <KeyValue
                    label="M1 protection bundle accepted"
                    value={activation.m1BundleAccepted === null ? "not checked (activation failed before this was attempted)" : activation.m1BundleAccepted ? "yes" : "NO — startProtection() cannot succeed without this"}
                  />
                  <KeyValue
                    label="Internet continuity (non-test destination reachable)"
                    value={activation.internetContinuityOk === null ? "not checked (activation failed before this was attempted)" : activation.internetContinuityOk ? "yes" : "NO — ordinary browsing would be broken"}
                  />
                  <KeyValue
                    label="All 5 probe rules confirmed in bundle"
                    value={
                      activation.probeRuleConfirmedInBundle === null
                        ? "not checked (activation failed before the bundle was verified)"
                        : activation.probeRuleConfirmedInBundle
                          ? "yes"
                          : "NO — probes will be unattributable"
                    }
                  />
                  <KeyValue label="Native module" value={activation.preflightSnapshot.nativeAvailable ? "available" : "unavailable (Expo Go / web)"} />
                  <KeyValue label="Active native stack" value={activation.preflightSnapshot.activeNativeStackId ?? "n/a"} />
                  <KeyValue label="Supported ABIs" value={activation.preflightSnapshot.supportedAbis.join(", ") || "n/a"} />
                  <KeyValue label="VPN consent granted" value={activation.preflightSnapshot.vpnConsentGranted === null ? "n/a" : activation.preflightSnapshot.vpnConsentGranted ? "yes" : "no"} />
                  <KeyValue label="Protection state" value={activation.preflightSnapshot.protectionState ?? "n/a"} />
                  <KeyValue label="TUN open" value={activation.preflightSnapshot.tunOpen === null ? "n/a" : activation.preflightSnapshot.tunOpen ? "yes" : "no"} />
                  <KeyValue label="Notifications enabled" value={activation.preflightSnapshot.notificationsEnabled === null ? "n/a" : activation.preflightSnapshot.notificationsEnabled ? "yes" : "no"} />
                  <KeyValue label="DNS gateway active" value={activation.preflightSnapshot.dnsGatewayActive === null ? "n/a" : activation.preflightSnapshot.dnsGatewayActive ? "yes" : "no"} />
                  <KeyValue label="Build APK SHA-256" value={activation.preflightSnapshot.buildProvenance.apkSha256 ?? "n/a"} />
                  {activation.preflightSnapshot.truthViolation.violated ? (
                    <View style={styles.violationBanner}>
                      <Text style={styles.violationText}>⚠ Truth-of-state violation — cannot proceed:</Text>
                      {activation.preflightSnapshot.truthViolation.reasons.map((r) => (
                        <Text key={r} style={styles.violationText}>
                          {r}
                        </Text>
                      ))}
                    </View>
                  ) : null}
                </>
              ) : null}
            </Card>
            {preflightPassed ? <ActionButton title="Continue" onPress={() => goToStep(1)} testID="dns-wizard-preflight-continue" /> : null}
            {/* Physical-device review fix: a failed/violated Preflight must still let the tester
                export/share whatever WAS captured (the attempt + failure reason + truth snapshot
                are themselves evidence) -- never gated behind preflightPassed. */}
            {activation ? (
              <ActionButton
                title={busy ? "Preparing…" : "Share diagnostic report"}
                secondary
                onPress={handleShareReport}
                disabled={busy}
                testID="dns-doh-preflight-share-report"
              />
            ) : null}
          </>
        ) : null}

        {currentStepId === "dot-off" || currentStepId === "dot-automatic" || currentStepId === "dot-strict" ? (
          <DotStepCard
            step={DOT_WIZARD_STEPS.find((s) => s.id === currentStepId)!}
            styles={styles}
            colors={colors}
            pollPhase={pollPhase}
            pollElapsedMs={pollElapsedMs}
            pollSnapshot={pollSnapshot}
            stepResult={stepResult}
            busy={busy}
            onOpenSettings={openPrivateDnsSettings}
            onCheckAgain={() => void handleStartDotPolling(DOT_WIZARD_STEPS.find((s) => s.id === currentStepId)!)}
            onConfirmOff={() => void handleConfirmDotOff(DOT_WIZARD_STEPS.find((s) => s.id === currentStepId)!)}
            onRecordNotTestable={() => void handleRecordDotNotTestable(DOT_WIZARD_STEPS.find((s) => s.id === currentStepId)!)}
            onContinue={() => goToStep(stepIndex + 1)}
          />
        ) : null}

        {currentStepId === "doh-off" || currentStepId === "doh-on" ? (
          <Card title={STEP_TITLES[currentStepId]}>
            <Text style={styles.note}>
              Android cannot read another app&apos;s DoH setting, so this is the one step in this wizard needing a manual change: turn {currentStepId === "doh-on" ? "ON" : "OFF"} DNS-over-HTTPS in your browser&apos;s settings now, come back here, then tap the button below — Apollo will automatically generate a fresh probe nonce, open the probe page in that browser, and wait for either its own attributed capture or the page&apos;s independent server receipt.
            </Text>
            <Text style={styles.note}>Browser name / version (optional, for your records only — not evidence):</Text>
            <TextInputLike value={dohBrowserLabel} onChangeText={setDohBrowserLabel} placeholder="e.g. Firefox 143" />
            {dohPhase === "idle" ? (
              <>
                <ActionButton title={busy ? "Opening…" : "I've changed it — Run probe"} onPress={() => void handleStartDohStep(currentStepId)} disabled={busy} testID={`dns-wizard-${currentStepId}-run`} />
                <ActionButton title="Mark this configuration NOT_TESTABLE" secondary onPress={() => void handleRecordDohNotTestable(currentStepId)} disabled={busy} testID={`dns-wizard-${currentStepId}-not-testable`} />
              </>
            ) : (
              <>
                <Text style={styles.note}>Probe URL opened: {dohNonceRef.current && dohStepRef.current ? buildDohProbeUrl(ROW_PROBE_IDENTITY[dohStepRef.current].host, dohNonceRef.current) : ""}</Text>
                <Text style={styles.timerText}>Waiting for you to return from the browser (auto-detects on app resume, up to 120s)…</Text>
                <ActivityIndicator color={colors.brandPrimary} />
              </>
            )}
            {stepResult ? (
              <>
                <InlineResultCard
                  tone={classificationTone(stepResult.classification)}
                  title={`${stepResult.classification} — ${CLASSIFICATION_LABELS[stepResult.classification]}`}
                  testID={`dns-wizard-${currentStepId}-result`}
                  rows={recordToRows(stepResult)}
                />
                <ActionButton title="Continue" onPress={() => goToStep(stepIndex + 1)} testID={`dns-wizard-${currentStepId}-continue`} />
              </>
            ) : null}
          </Card>
        ) : null}

        {currentStepId === "final-report" ? (
          <>
            <Card title={`Results (${records.length})`}>
              {records.length === 0 ? (
                <Text style={styles.note}>No probes recorded yet.</Text>
              ) : (
                records.map((r) => (
                  <InlineResultCard
                    key={r.id}
                    tone={classificationTone(r.classification)}
                    title={`${r.classification} — ${r.configurationLabel}`}
                    testID={`dns-doh-record-${r.id}`}
                    rows={recordToRows(r)}
                  />
                ))
              )}
            </Card>
            <Card title="Export evidence">
              <Text style={styles.note}>Session ID: {sessionId}</Text>
              <ActionButton title={busy ? "Preparing…" : "Share report"} onPress={handleShareReport} disabled={busy || records.length === 0} testID="dns-doh-share-report" />
            </Card>
          </>
        ) : null}

        {error ? (
          <Text style={styles.errorText} testID="dns-doh-error">
            {error}
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

/** Isolated so the DoT polling/result UI stays readable; purely presentational + local button wiring. */
function DotStepCard({
  step,
  styles,
  colors,
  pollPhase,
  pollElapsedMs,
  pollSnapshot,
  stepResult,
  busy,
  onOpenSettings,
  onCheckAgain,
  onConfirmOff,
  onRecordNotTestable,
  onContinue,
}: {
  step: DotWizardStepConfig;
  styles: ReturnType<typeof useStyles>;
  colors: ReturnType<typeof useTheme>["colors"];
  pollPhase: "idle" | "polling" | "matched" | "timed-out";
  pollElapsedMs: number;
  pollSnapshot: NativeDnsCapabilityDeviceSnapshot | null;
  stepResult: DnsDiagnosticRecord | null;
  busy: boolean;
  onOpenSettings: () => void;
  onCheckAgain: () => void;
  onConfirmOff: () => void;
  onRecordNotTestable: () => void;
  onContinue: () => void;
}) {
  const stillChecking = pollElapsedMs >= PRIVATE_DNS_POLL_STILL_CHECKING_AFTER_MS;

  // "dot-off": Android's public API can never PROVE "Off" was selected -- no polling-to-match here.
  // The tester confirms THEIR OWN selection; Apollo records the machine truth honestly alongside it.
  if (step.targetRuntimeMode === null) {
    return (
      <Card title={step.title}>
        <Text style={styles.note}>{step.settingsInstruction}</Text>
        <Text style={styles.note}>
          Android cannot prove &quot;Off&quot; was selected -- it can only tell whether Private DNS is currently active, which is also true if Automatic&apos;s opportunistic probe happens to be inactive. So this one row needs your confirmation: after setting Off in Android Settings, tap below and Apollo will record the machine-observed state honestly alongside your selection (never displayed as &quot;Off verified&quot;).
        </Text>
        <ActionButton title="Open Private DNS Settings" secondary onPress={onOpenSettings} testID={`dns-wizard-${step.id}-open-settings`} />
        {!stepResult ? (
          <>
            <ActionButton title={busy ? "Running…" : "I've set it to Off — Run probe"} onPress={onConfirmOff} disabled={busy} testID={`dns-wizard-${step.id}-confirm-off`} />
            <ActionButton title="Record as not testable" secondary onPress={onRecordNotTestable} disabled={busy} testID={`dns-wizard-${step.id}-record-not-testable`} />
          </>
        ) : null}
        {stepResult ? (
          <>
            <InlineResultCard
              tone={classificationTone(stepResult.classification)}
              title={`${stepResult.classification} — ${CLASSIFICATION_LABELS[stepResult.classification]}`}
              testID={`dns-wizard-${step.id}-result`}
              rows={recordToRows(stepResult)}
            />
            <ActionButton title="Continue" onPress={onContinue} testID={`dns-wizard-${step.id}-continue`} />
          </>
        ) : null}
      </Card>
    );
  }

  return (
    <Card title={step.title}>
      <Text style={styles.note}>{step.settingsInstruction}</Text>
      <ActionButton title="Open Private DNS Settings" secondary onPress={onOpenSettings} testID={`dns-wizard-${step.id}-open-settings`} />
      {pollPhase === "polling" ? (
        <>
          <Text style={styles.timerText} testID={`dns-wizard-${step.id}-checking`}>
            {stillChecking ? "Still checking…" : "Checking…"} ({Math.round(pollElapsedMs / 1000)}s)
          </Text>
          <Text style={styles.note}>Currently observed: {pollSnapshot?.privateDnsRuntimeMode ?? "…"}</Text>
          <ActivityIndicator color={colors.brandPrimary} />
        </>
      ) : null}
      {pollPhase === "matched" && busy ? (
        <>
          <Text style={styles.note}>Configuration confirmed — running the probe now…</Text>
          <ActivityIndicator color={colors.brandPrimary} />
        </>
      ) : null}
      {pollPhase === "timed-out" ? (
        <>
          <Text style={styles.note} testID={`dns-wizard-${step.id}-timeout`}>
            Could not automatically confirm this configuration within {PRIVATE_DNS_POLL_HARD_TIMEOUT_MS / 1000}s. Nothing was recorded under an unverified state.
          </Text>
          <View style={styles.buttonRow}>
            <ActionButton title="Check again" onPress={onCheckAgain} disabled={busy} testID={`dns-wizard-${step.id}-check-again`} />
            <ActionButton title="Open Settings again" secondary onPress={onOpenSettings} disabled={busy} testID={`dns-wizard-${step.id}-open-settings-again`} />
          </View>
          <ActionButton title="Record as not testable" secondary onPress={onRecordNotTestable} disabled={busy} testID={`dns-wizard-${step.id}-record-not-testable`} />
        </>
      ) : null}
      {stepResult ? (
        <>
          <InlineResultCard
            tone={classificationTone(stepResult.classification)}
            title={`${stepResult.classification} — ${CLASSIFICATION_LABELS[stepResult.classification]}`}
            testID={`dns-wizard-${step.id}-result`}
            rows={recordToRows(stepResult)}
          />
          <ActionButton title="Continue" onPress={onContinue} testID={`dns-wizard-${step.id}-continue`} />
        </>
      ) : null}
    </Card>
  );
}

/** Minimal themed text input — this screen only needs one optional free-text metadata field. */
function TextInputLike({ value, onChangeText, placeholder }: { value: string; onChangeText: (v: string) => void; placeholder: string }) {
  const { colors } = useTheme();
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.onSurfaceTertiary}
      style={{ minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: colors.borderStrong, paddingHorizontal: 12, color: colors.onSurface, fontSize: 14 }}
      testID="dns-doh-browser-label-input"
    />
  );
}
