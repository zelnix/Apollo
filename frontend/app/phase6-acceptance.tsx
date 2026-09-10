// Gate Guard M2.1 Phase 6: guided, in-app acceptance report runner. Auto-captures what the app can
// truthfully observe (provenance, device info, ruleset/signature state, network type, the actual
// DNS→sinkhole→TUN→evidence→event chain via the frozen public SDK surface); everything Android does
// not expose to third-party apps (Private DNS setting, physically switching networks, revoking VPN
// permission) gets an explicit on-screen instruction instead. This screen NEVER auto-decides
// PASS/FAIL/verdict -- every classification chip below is a manual tap by the tester, exactly per
// docs/M2_PHASE6_ACCEPTANCE_TEMPLATE.md's frozen invariant.
import { useMutation, useQuery } from "@tanstack/react-query";
import * as Network from "expo-network";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ActionButton, Card, KeyValue, StatusBadge } from "@/src/components/harness-ui";
import { readBuildProvenance } from "@/src/harness/buildProvenance";
import {
  DEFAULT_PHASE6_GAPS,
  DEFAULT_PHASE6_MATRIX,
  emptyPhase6Device,
  emptyPhase6Provenance,
  exportPhase6ReportPdf,
  type Phase6CapabilityGap,
  type Phase6EvidenceAttempt,
  type Phase6MatrixResult,
  type Phase6MatrixRow,
  type Phase6Report,
  type Phase6Verdict,
} from "@/src/harness/phase6AcceptanceReport";
import { readPhase6DeviceProvenance } from "@/src/harness/phase6DeviceProvenance";
import { shareEvidenceFile } from "@/src/harness/proofReport";
import { fetchLatestBundle, fetchM1Config } from "@/src/harness/ruleBundleFixtures";
import { type NegativeTestKind, runNegativeTest, runPositiveEnforcementTest, triggerDnsViaFetch } from "@/src/harness/phase6WebsiteGateHarness";
import { GuardDogSecuritySDK } from "@/src/sdk/GuardDogSecuritySDK";
import { makeStyles, useTheme } from "@/src/theme";

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: 16, paddingBottom: 16, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.divider, flexDirection: "row", alignItems: "center", gap: 8 },
  backButton: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  backText: { color: colors.brandPrimary, fontSize: 24, fontWeight: "700" },
  headerTextWrap: { flex: 1 },
  eyebrow: { color: colors.brandPrimary, fontSize: 11, fontWeight: "800", letterSpacing: 1.5 },
  title: { color: colors.onSurface, fontSize: 20, fontWeight: "800", marginTop: 2 },
  content: { padding: 16, gap: 16 },
  invariantBanner: { borderRadius: 12, borderWidth: 2, borderColor: colors.error, backgroundColor: colors.surfaceTertiary, padding: 14, gap: 6 },
  invariantTitle: { color: colors.error, fontSize: 12, fontWeight: "800", letterSpacing: 1 },
  invariantText: { color: colors.onSurfaceTertiary, fontSize: 13, lineHeight: 19 },
  note: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  input: { minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surfaceTertiary, color: colors.onSurfaceTertiary, paddingHorizontal: 12, fontSize: 13 },
  fieldLabel: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: "600" },
  field: { gap: 4 },
  actions: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  matrixGroupTitle: { color: colors.brandPrimary, fontSize: 13, fontWeight: "800", marginTop: 4 },
  matrixRow: { borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: 10, gap: 6 },
  matrixTest: { color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: "600" },
  chipsRow: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  chip: { paddingHorizontal: 10, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  chipText: { fontSize: 11, fontWeight: "700" },
  attemptCard: { gap: 4, borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: 8 },
  mono: { color: colors.onSurfaceTertiary, fontSize: 11, fontFamily: "monospace" },
  manualStepsCard: { borderRadius: 10, borderWidth: 1, borderColor: colors.warning, backgroundColor: colors.surfaceTertiary, padding: 10, gap: 4 },
  manualStepsTitle: { color: colors.warning, fontSize: 11, fontWeight: "800" },
  howToCard: { borderRadius: 10, borderWidth: 1, borderColor: colors.brandPrimary, backgroundColor: colors.surfaceTertiary, padding: 10, gap: 4 },
  howToTitle: { color: colors.brandPrimary, fontSize: 11, fontWeight: "800" },
  stepRow: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  stepBadge: { color: colors.brandPrimary, fontSize: 12, fontWeight: "800" },
  statusIconBase: { width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  statusIconOkBg: { backgroundColor: colors.success },
  statusIconFailBg: { backgroundColor: colors.error },
  statusIconOkText: { color: colors.onSuccess, fontSize: 13, fontWeight: "900" },
  statusIconFailText: { color: colors.onError, fontSize: 13, fontWeight: "900" },
  inputManual: { borderColor: colors.warning, borderWidth: 2 },
  manualTag: { color: colors.warning, fontSize: 11, fontWeight: "700" },
  optionalTag: { color: colors.muted, fontSize: 11, fontWeight: "600" },
}));

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
  manual,
  optional,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  manual?: boolean;
  optional?: boolean;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const effectivePlaceholder = placeholder ?? (optional ? "optional — leave blank if not applicable" : "e.g. ...");
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>
        {label}
        {manual ? <Text style={styles.manualTag}> · ✎ type this in</Text> : null}
        {optional ? <Text style={styles.optionalTag}> · optional</Text> : null}
      </Text>
      <TextInput
        style={[styles.input, manual ? styles.inputManual : null, multiline ? { minHeight: 72, textAlignVertical: "top", paddingTop: 10 } : null]}
        value={value}
        onChangeText={onChangeText}
        placeholder={effectivePlaceholder}
        placeholderTextColor={colors.muted}
        multiline={multiline}
        autoCapitalize="none"
        autoCorrect={false}
        testID={`phase6-field-${label}`}
      />
    </View>
  );
}

function StatusIcon({ status }: { status?: "success" | "error" }) {
  const styles = useStyles();
  if (status === "success")
    return (
      <View style={[styles.statusIconBase, styles.statusIconOkBg]}>
        <Text style={styles.statusIconOkText}>✓</Text>
      </View>
    );
  if (status === "error")
    return (
      <View style={[styles.statusIconBase, styles.statusIconFailBg]}>
        <Text style={styles.statusIconFailText}>✗</Text>
      </View>
    );
  return null;
}

const RESULT_OPTIONS: Record<1 | 2 | 3 | 4, Phase6MatrixResult[]> = {
  1: ["PASS", "FAIL"],
  2: ["PASS", "FAIL"],
  3: ["PASS", "FAIL"],
  4: ["CAPTURED", "BYPASSED", "UNOBSERVABLE", "FAIL"],
};

function MatrixRowEditor({ row, onChange }: { row: Phase6MatrixRow; onChange: (next: Phase6MatrixRow) => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.matrixRow} testID={`phase6-matrix-${row.id}`}>
      <Text style={styles.matrixTest}>
        {row.id} · {row.test}
      </Text>
      <View style={styles.chipsRow}>
        {RESULT_OPTIONS[row.group].map((opt) => {
          const selected = row.result === opt;
          return (
            <Pressable
              key={opt}
              testID={`phase6-matrix-${row.id}-${opt}`}
              onPress={() => onChange({ ...row, result: opt })}
              style={[styles.chip, { borderColor: selected ? colors.brandPrimary : colors.borderStrong, backgroundColor: selected ? colors.brandPrimary : "transparent" }]}
            >
              <Text style={[styles.chipText, { color: selected ? colors.onBrandPrimary : colors.onSurfaceTertiary }]}>{opt}</Text>
            </Pressable>
          );
        })}
        {row.result !== "" ? (
          <Pressable testID={`phase6-matrix-${row.id}-clear`} onPress={() => onChange({ ...row, result: "" })} style={[styles.chip, { borderColor: colors.borderStrong }]}>
            <Text style={[styles.chipText, { color: colors.muted }]}>clear</Text>
          </Pressable>
        ) : null}
      </View>
      <TextInput style={[styles.input, styles.inputManual]} value={row.evidenceRef} onChangeText={(v) => onChange({ ...row, evidenceRef: v })} placeholder="Evidence ref (e.g. attempt #1)" placeholderTextColor={colors.muted} />
      <TextInput style={[styles.input, styles.inputManual]} value={row.notes} onChangeText={(v) => onChange({ ...row, notes: v })} placeholder="Notes (record raw result -- do not adapt to pass)" placeholderTextColor={colors.muted} />
    </View>
  );
}

export default function Phase6Acceptance() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const [provenance, setProvenance] = useState(emptyPhase6Provenance());
  const [device, setDevice] = useState(emptyPhase6Device());
  const [testDomain, setTestDomain] = useState("");
  const [matchingRuleId, setMatchingRuleId] = useState("");
  const [attempts, setAttempts] = useState<Phase6EvidenceAttempt[]>([]);
  const [matrix, setMatrix] = useState<Phase6MatrixRow[]>(DEFAULT_PHASE6_MATRIX);
  const [gaps, setGaps] = useState<Phase6CapabilityGap[]>(DEFAULT_PHASE6_GAPS);
  const [verdict, setVerdict] = useState<Phase6Verdict>("");
  const [justification, setJustification] = useState("");
  const [completedBy, setCompletedBy] = useState("");
  const [pdfUri, setPdfUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stepStatus, setStepStatus] = useState<Record<string, "success" | "error">>({});
  const [statusTick, setStatusTick] = useState(0);

  function markStep(id: string, ok: boolean) {
    setStepStatus((prev) => ({ ...prev, [id]: ok ? "success" : "error" }));
  }

  // Re-read on every render (fresh sync snapshot); statusTick just forces a re-render on demand
  // (e.g. after a manual out-of-app step like toggling Wi-Fi or revoking VPN permission).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _tick = statusTick;
  const protectionState = GuardDogSecuritySDK.getProtectionState();
  const gateStatus = GuardDogSecuritySDK.getWebsiteGateStatus();

  const config = useQuery({ queryKey: ["m1-config"], queryFn: fetchM1Config });
  const m2RulesetId = config.data?.gateGuard?.websiteGateRulesetId ?? null;
  const bundle = useQuery({ queryKey: ["m2-bundle", m2RulesetId], queryFn: () => fetchLatestBundle(m2RulesetId as string), enabled: !!m2RulesetId });

  useEffect(() => {
    if (!bundle.data || testDomain) return;
    const blockRule = bundle.data.payload.rules.find((r) => r.action === "block");
    if (blockRule) {
      setTestDomain(blockRule.host);
      setMatchingRuleId(blockRule.ruleId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle.data]);

  function updateRow(next: Phase6MatrixRow) {
    setMatrix((prev) => prev.map((r) => (r.id === next.id ? next : r)));
  }
  function updateGap(index: number, next: Phase6CapabilityGap) {
    setGaps((prev) => prev.map((g, i) => (i === index ? next : g)));
  }
  function pushAttempt(a: Phase6EvidenceAttempt) {
    setAttempts((prev) => [...prev, a]);
  }

  const autoCapture = useMutation({
    mutationFn: async () => ({ bp: await readBuildProvenance(), dp: readPhase6DeviceProvenance(), net: await Network.getNetworkStateAsync().catch(() => null) }),
    onSuccess: ({ bp, dp, net }) => {
      setError(null);
      markStep("autocapture", true);
      setProvenance((prev) => ({
        ...prev,
        commitSha: bp.gitSha ?? prev.commitSha,
        ciRunId: bp.ciRunId ?? prev.ciRunId,
        ciRunUrl: bp.ciRunId && bp.ciRunId !== "local" ? `https://github.com/zelnix/Apollo/actions/runs/${bp.ciRunId}` : prev.ciRunUrl,
        apkFilename: prev.apkFilename || bp.packageName || prev.apkFilename,
        apkSha256: bp.apkSha256 ?? prev.apkSha256,
        appVersion: bp.versionName ?? prev.appVersion,
        buildNumber: bp.versionCode != null ? String(bp.versionCode) : prev.buildNumber,
        activeNativeStackId: dp.activeNativeStackId,
        rulesetId: m2RulesetId ?? prev.rulesetId,
        bundleVersion: bundle.data ? String(bundle.data.bundleVersion) : prev.bundleVersion,
        bundleKeyId: bundle.data?.keyId ?? prev.bundleKeyId,
        bundleSignatureState: bundle.data ? "loaded from backend; native acceptance result recorded separately below" : prev.bundleSignatureState,
        sessionStartedAt: new Date().toISOString(),
      }));
      setDevice((prev) => ({
        ...prev,
        manufacturer: dp.manufacturer,
        model: dp.model,
        osRelease: dp.osRelease,
        securityPatch: dp.securityPatch,
        networkType: net ? `${net.type}${net.isConnected ? " (connected)" : " (disconnected)"}` : prev.networkType,
        recordedAt: new Date().toISOString(),
      }));
    },
    onError: (e) => {
      setError(e instanceof Error ? e.message : String(e));
      markStep("autocapture", false);
    },
  });

  const activateGate = useMutation({
    mutationFn: async () => {
      GuardDogSecuritySDK.configureWebsiteGate({});
      if (!bundle.data) throw new Error("M2 rule bundle not loaded yet -- check backend connectivity");
      const result = GuardDogSecuritySDK.acceptWebsiteGateRuleBundle(bundle.data);
      if (!result.accepted) throw new Error(`bundle rejected: ${result.rejectReason ?? "unknown"}`);
      await GuardDogSecuritySDK.hydrateWebsiteGateOverrides();
      return result;
    },
    onSuccess: () => {
      setError(null);
      markStep("activate", true);
    },
    onError: (e) => {
      setError(e instanceof Error ? e.message : String(e));
      markStep("activate", false);
    },
  });

  const runPositive = useMutation({
    mutationFn: () => runPositiveEnforcementTest(testDomain, 20_000),
    onSuccess: (r) => {
      setError(null);
      markStep("positive", true);
      pushAttempt({
        label: `Positive enforcement attempt #${attempts.length + 1}`,
        dnsQueryObserved: r.dnsQueryTriggeredVia,
        decisionAndReason: `status before: ${JSON.stringify(r.statusBefore)} | status after: ${JSON.stringify(r.statusAfter)}`,
        sinkholeBinding: r.blockedEvent ? "inferred active (see enforcementStatsAfter + evidence below)" : "none observed within window",
        tunPacketObserved: r.enforcementStatsAfter ? JSON.stringify(r.enforcementStatsAfter) : "none",
        intentionalDrop: r.blockedEvent ? "yes -- see THREAT_BLOCKED row" : "no event received -- do not assume a drop happened",
        evidenceRecord: r.blockedEvent ? JSON.stringify(r.blockedEvent) : "none",
        evidenceId: r.blockedEvent?.enforcementEvidenceId ?? "none",
        threatBlockedEmitted: r.blockedEvent ? `yes, eventId=${r.blockedEvent.id}` : "no",
        frontendCorrelation: r.blockedEvent ? `enforcementEvidenceId ${r.blockedEvent.enforcementEvidenceId} — confirm this ID also appears in the app's own event/Patrol view` : "n/a -- no event to correlate",
        bitingUiConsequence: r.blockedEvent ? "confirm manually: does the app UI show \"Apollo is biting\" for this event?" : "n/a -- no event",
        stopRevokeResult: "",
        timestamps: `fetch attempted ${r.startedAt}, evidence window closed ${r.completedAt}`,
      });
    },
    onError: (e) => {
      setError(e instanceof Error ? e.message : String(e));
      markStep("positive", false);
    },
  });

  const runNegative = useMutation({
    mutationFn: (kind: NegativeTestKind) => {
      const actions: Record<NegativeTestKind, () => Promise<void> | void> = {
        "rule-match-alone": () => {},
        "manual-override": async () => {
          await GuardDogSecuritySDK.setWebsiteGateAllowOverride(testDomain);
        },
        "local-analysis-only": () => {
          GuardDogSecuritySDK.analyzeUrl(`https://${testDomain}/`);
        },
        "gate-start-alone": () => {
          GuardDogSecuritySDK.configureWebsiteGate({});
        },
        "failed-dns-forward": async () => {
          await triggerDnsViaFetch(`phase6-nonexistent-${Date.now()}.invalid`, 4000);
        },
      };
      return runNegativeTest(kind, actions[kind], 6000);
    },
    onSuccess: (r) => {
      setError(null);
      markStep(`neg-${r.kind}`, true);
      pushAttempt({
        label: `Negative test: ${r.kind}`,
        dnsQueryObserved: "n/a (negative test -- no authorized-domain traffic sent)",
        decisionAndReason: r.kind,
        sinkholeBinding: "n/a",
        tunPacketObserved: "n/a",
        intentionalDrop: "n/a",
        evidenceRecord: r.observedEvent ? JSON.stringify(r.observedEvent) : "none observed (expected/correct)",
        evidenceId: r.observedEvent?.enforcementEvidenceId ?? "none",
        threatBlockedEmitted: r.observedEvent ? `UNEXPECTED: yes, eventId=${r.observedEvent.id} -- investigate, this may be a Truth-of-State violation` : "no (expected)",
        frontendCorrelation: "n/a",
        bitingUiConsequence: r.observedEvent ? "UNEXPECTED -- record raw result, do not adapt" : "none (expected)",
        stopRevokeResult: "",
        timestamps: `ran ${r.ranAt}, window closed ${r.windowClosedAt}`,
      });
    },
    onError: (e, variables) => {
      setError(e instanceof Error ? e.message : String(e));
      markStep(`neg-${variables}`, false);
    },
  });

  const stopProtection = useMutation({
    mutationFn: async () => {
      GuardDogSecuritySDK.stopProtection();
      return true;
    },
    onSuccess: () => {
      setError(null);
      markStep("stop", true);
    },
    onError: (e) => {
      setError(e instanceof Error ? e.message : String(e));
      markStep("stop", false);
    },
  });

  const captureSnapshot = useMutation({
    mutationFn: async ({ label }: { key: string; label: string }) => ({
      label,
      status: GuardDogSecuritySDK.getProtectionState(),
      gateStatus: GuardDogSecuritySDK.getWebsiteGateStatus(),
      net: await Network.getNetworkStateAsync().catch(() => null),
      at: new Date().toISOString(),
    }),
    onSuccess: (r, variables) => {
      setError(null);
      markStep(`snapshot-${variables.key}`, true);
      pushAttempt({
        label: `Snapshot: ${r.label}`,
        dnsQueryObserved: "n/a (manual-step snapshot)",
        decisionAndReason: JSON.stringify(r.gateStatus),
        sinkholeBinding: "n/a",
        tunPacketObserved: "n/a",
        intentionalDrop: "n/a",
        evidenceRecord: JSON.stringify({ protectionState: r.status, network: r.net }),
        evidenceId: "n/a",
        threatBlockedEmitted: "n/a (snapshot, not an event-wait test)",
        frontendCorrelation: "n/a",
        bitingUiConsequence: "n/a",
        stopRevokeResult: `protectionState=${r.status.state}${r.status.reason ? ` (${r.status.reason})` : ""}`,
        timestamps: `captured ${r.at}`,
      });
    },
    onError: (e, variables) => {
      setError(e instanceof Error ? e.message : String(e));
      markStep(`snapshot-${variables.key}`, false);
    },
  });

  function buildReport(): Phase6Report {
    return {
      provenance,
      device,
      setup: { testDomain, matchingRuleId, resolvedAt: new Date().toISOString() },
      attempts,
      matrix,
      gaps,
      verdict,
      justification,
      testedCommitShaRepeat: provenance.commitSha,
      completedBy,
      completedAt: new Date().toISOString(),
    };
  }

  const generatePdf = useMutation({
    mutationFn: () => exportPhase6ReportPdf(buildReport()),
    onSuccess: (uri) => {
      setError(null);
      markStep("pdf", true);
      setPdfUri(uri);
    },
    onError: (e) => {
      setError(e instanceof Error ? e.message : String(e));
      markStep("pdf", false);
    },
  });

  return (
    <View style={styles.root} testID="phase6-acceptance-screen">
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable style={styles.backButton} onPress={() => router.back()} testID="phase6-back-button" accessibilityRole="button">
          <Text style={styles.backText}>‹</Text>
        </Pressable>
        <View style={styles.headerTextWrap}>
          <Text style={styles.eyebrow}>APOLLO NATIVE GATES · M2.1 PHASE 6</Text>
          <Text style={styles.title}>Acceptance Report Runner</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]} keyboardShouldPersistTaps="handled">
        <View style={styles.invariantBanner} testID="phase6-invariant-banner">
          <Text style={styles.invariantTitle}>FROZEN ACCEPTANCE INVARIANT</Text>
          <Text style={styles.invariantText}>
            THREAT_BLOCKED is evidence-backed only. It requires an authorized destination, a real packet observed by the enforcement layer, an intentional drop, an
            enforcement evidence record, and event emission from that evidence path. No rule match or UI action alone may satisfy Phase 6 acceptance. This screen never
            auto-decides PASS/FAIL for you.
          </Text>
        </View>

        {error ? (
          <Card title="Last action error">
            <Text style={[styles.note, { color: colors.error }]} selectable>
              {error}
            </Text>
          </Card>
        ) : null}

        <Card title="Live protection status" testID="phase6-live-status-card">
          <Text style={styles.note}>Check this any time — including right after a manual step done outside the app (Settings, force-close, etc.) — then tap Refresh status since the app can't detect those changes on its own.</Text>
          <View style={styles.stepRow}>
            <StatusBadge status={protectionState.state} testID="phase6-protection-state-badge" />
            <Text style={styles.note}>{protectionState.reason ?? (protectionState.consentGranted ? "consent granted" : "consent not granted")}</Text>
          </View>
          <View style={styles.stepRow}>
            <Text style={styles.fieldLabel}>Website Gate configured</Text>
            <StatusBadge status={gateStatus.configured ? "ACTIVE" : "INACTIVE"} testID="phase6-gate-configured-badge" />
          </View>
          <View style={styles.stepRow}>
            <Text style={styles.fieldLabel}>DNS gateway active (live, TUN-confirmed)</Text>
            <StatusBadge status={gateStatus.dnsGatewayActive ? "ACTIVE" : "INACTIVE"} testID="phase6-dns-active-badge" />
          </View>
          <KeyValue label="Accepted ruleset / bundle" value={gateStatus.acceptedRulesetId ? `${gateStatus.acceptedRulesetId} v${gateStatus.acceptedBundleVersion}` : "none accepted yet"} testID="phase6-gate-bundle" />
          <KeyValue label="Local overrides count" value={String(gateStatus.overrideCount)} testID="phase6-gate-overrides" />

          {!gateStatus.dnsGatewayActive ? (
            <View style={styles.howToCard} testID="phase6-quick-turn-on">
              <Text style={styles.howToTitle}>NEEDS TO BE ON — required before Steps 3–8 (enforcement tests)</Text>
              <Text style={styles.note}>Website Gate is currently OFF. Tap the button below to turn it on (same action as Step 2) before running the positive/negative enforcement tests.</Text>
              <View style={styles.stepRow}>
                <ActionButton title={activateGate.isPending ? "Activating…" : "Turn ON — Activate Website Gate"} onPress={() => activateGate.mutate()} disabled={activateGate.isPending || !bundle.data} testID="phase6-quick-activate" />
                <StatusIcon status={stepStatus.activate} />
              </View>
            </View>
          ) : (
            <View style={styles.howToCard} testID="phase6-quick-turn-off">
              <Text style={styles.howToTitle}>NEEDS TO BE OFF — required for Step 9 (stop / recovery test)</Text>
              <Text style={styles.note}>Website Gate is currently ON. Once you've finished Steps 3–8, tap the button below to turn it off (same action as Step 9), then go capture Step 9's snapshot.</Text>
              <View style={styles.stepRow}>
                <ActionButton title="Turn OFF — Stop protection" secondary onPress={() => stopProtection.mutate()} disabled={stopProtection.isPending} testID="phase6-quick-stop" />
                <StatusIcon status={stepStatus.stop} />
              </View>
            </View>
          )}

          <View style={styles.actions}>
            <ActionButton title="Refresh status" secondary onPress={() => setStatusTick((t) => t + 1)} testID="phase6-refresh-status" />
          </View>
        </Card>

        <Card title="0. Provenance baseline">
          <Text style={styles.stepBadge}>STEP 1 — Auto-capture provenance</Text>
          <View style={styles.stepRow}>
            <ActionButton title={autoCapture.isPending ? "Capturing…" : "Auto-capture provenance"} onPress={() => autoCapture.mutate()} disabled={autoCapture.isPending} testID="phase6-autocapture-button" />
            <StatusIcon status={stepStatus.autocapture} />
          </View>
          <Text style={styles.note}>
            Tap the button above once — no typing needed for it. It auto-fills every field below marked "(auto)": commit SHA, CI run id, APK SHA-256, version, device-confirmed active native stack,
            ruleset/bundle info. Every field WITHOUT "(auto)" needs you to type it in manually (read Branch/CI run id/job/artifact names off the GitHub Actions run page; "No-drift confirmation" only
            applies if you're using a fresh Publish build instead of a CI artifact).
          </Text>
          <Field label="Branch" value={provenance.branch} onChangeText={(v) => setProvenance((p) => ({ ...p, branch: v }))} placeholder="m2-native-acceptance" manual />
          <Field label="Exact commit SHA (auto)" value={provenance.commitSha} onChangeText={(v) => setProvenance((p) => ({ ...p, commitSha: v }))} />
          <Field label="CI run ID (auto)" value={provenance.ciRunId} onChangeText={(v) => setProvenance((p) => ({ ...p, ciRunId: v }))} />
          <Field label="CI run URL (auto)" value={provenance.ciRunUrl} onChangeText={(v) => setProvenance((p) => ({ ...p, ciRunUrl: v }))} />
          <Field label="Job name(s)" value={provenance.jobNames} onChangeText={(v) => setProvenance((p) => ({ ...p, jobNames: v }))} placeholder="Gate Guard, android-dev-build" manual />
          <Field label="Artifact name(s)" value={provenance.artifactNames} onChangeText={(v) => setProvenance((p) => ({ ...p, artifactNames: v }))} placeholder="android-dev-build, gate-guard" manual />
          <Field label="Artifact digest(s)" value={provenance.artifactDigests} onChangeText={(v) => setProvenance((p) => ({ ...p, artifactDigests: v }))} placeholder="sha256:abc123... (copy from the Artifacts table on the CI run page)" manual />
          <Field label="Build source" value={provenance.buildSource} onChangeText={(v) => setProvenance((p) => ({ ...p, buildSource: v }))} placeholder="CI artifact / fresh Publish build" manual />
          <Field
            label="No-drift confirmation"
            value={provenance.noDriftConfirmation}
            onChangeText={(v) => setProvenance((p) => ({ ...p, noDriftConfirmation: v }))}
            placeholder="e.g. git diff <verified-sha> <build-sha> --stat -> empty (only needed if Build source above is a fresh Publish build, not a CI artifact)"
            manual
            optional
          />
          <Field label="APK filename" value={provenance.apkFilename} onChangeText={(v) => setProvenance((p) => ({ ...p, apkFilename: v }))} placeholder="app-release.apk" manual />
          <Field label="APK SHA-256 (auto)" value={provenance.apkSha256} onChangeText={(v) => setProvenance((p) => ({ ...p, apkSha256: v }))} />
          <Field label="App version (auto)" value={provenance.appVersion} onChangeText={(v) => setProvenance((p) => ({ ...p, appVersion: v }))} />
          <Field label="Build number (auto)" value={provenance.buildNumber} onChangeText={(v) => setProvenance((p) => ({ ...p, buildNumber: v }))} />
          <Field label="Architecture" value={provenance.architecture} onChangeText={(v) => setProvenance((p) => ({ ...p, architecture: v }))} placeholder="arm64-v8a" manual />
          <Field label="Active native stack (device-confirmed, auto)" value={provenance.activeNativeStackId} onChangeText={(v) => setProvenance((p) => ({ ...p, activeNativeStackId: v }))} />
          <Field label="Backend branch" value={provenance.backendBranch} onChangeText={(v) => setProvenance((p) => ({ ...p, backendBranch: v }))} placeholder="main" manual />
          <Field label="Backend commit SHA" value={provenance.backendCommitSha} onChangeText={(v) => setProvenance((p) => ({ ...p, backendCommitSha: v }))} placeholder="e.g. a1b2c3d... (40-char SHA, from your backend deployment)" manual />
          <Field label="Biting/Truth-of-State invariant confirmed present" value={provenance.bitingInvariantConfirmed} onChangeText={(v) => setProvenance((p) => ({ ...p, bitingInvariantConfirmed: v }))} placeholder="yes / no + how verified" manual />
          <Field label="Ruleset ID (auto)" value={provenance.rulesetId} onChangeText={(v) => setProvenance((p) => ({ ...p, rulesetId: v }))} />
          <Field label="Bundle version (auto)" value={provenance.bundleVersion} onChangeText={(v) => setProvenance((p) => ({ ...p, bundleVersion: v }))} />
          <Field label="Bundle signing key ID (auto)" value={provenance.bundleKeyId} onChangeText={(v) => setProvenance((p) => ({ ...p, bundleKeyId: v }))} />
          <Field label="Bundle signature state" value={provenance.bundleSignatureState} onChangeText={(v) => setProvenance((p) => ({ ...p, bundleSignatureState: v }))} placeholder="e.g. verified natively via Kotlin Ed25519 check: yes" manual />
        </Card>

        <Card title="1. Device & environment">
          <Text style={styles.note}>Manufacturer/model/OS/security patch are auto-captured above. The rest of these Android does not expose to third-party apps — read them off the device and type them in.</Text>
          <View style={styles.manualStepsCard}>
            <Text style={styles.manualStepsTitle}>HOW TO CHECK: Private DNS setting</Text>
            <Text style={styles.note}>Settings → Network & internet → Private DNS. Note whether it shows "Off", "Automatic", or a provider hostname, then type it below.</Text>
          </View>
          <Field label="Permissions granted before test" value={device.permissionsBeforeTest} onChangeText={(v) => setDevice((d) => ({ ...d, permissionsBeforeTest: v }))} placeholder="VPN: granted, Notifications: granted" manual />
          <Field label="VPN state before test" value={device.vpnStateBeforeTest} onChangeText={(v) => setDevice((d) => ({ ...d, vpnStateBeforeTest: v }))} placeholder="off / no other VPN active" manual />
          <Field label="Network type (auto)" value={device.networkType} onChangeText={(v) => setDevice((d) => ({ ...d, networkType: v }))} />
          <Field label="Private DNS setting (manual — see instructions above)" value={device.privateDnsSetting} onChangeText={(v) => setDevice((d) => ({ ...d, privateDnsSetting: v }))} placeholder="Off / Automatic / dns.google" manual />
        </Card>

        <Card title="2. Test setup + activate Website Gate">
          <Text style={styles.stepBadge}>STEP 2 — Activate Website Gate</Text>
          <Text style={styles.note}>
            No typing required here by default. The authorized test domain + matching rule ID below are auto-filled from the accepted M2 bundle's first "block" rule as soon as it loads (currently{" "}
            {bundle.data ? `bundle v${bundle.data.bundleVersion}` : "loading…"}). Only edit them if you deliberately want to test a different domain than the one the bundle blocks.
          </Text>
          <Field label="Authorized test domain (auto-filled from accepted bundle)" value={testDomain} onChangeText={setTestDomain} placeholder="blocktest.btciq.app" />
          <Field label="Matching rule ID (auto-filled from accepted bundle)" value={matchingRuleId} onChangeText={setMatchingRuleId} />
          <View style={styles.stepRow}>
            <ActionButton
              title={activateGate.isPending ? "Activating…" : "Activate Website Gate (configure + accept bundle)"}
              onPress={() => activateGate.mutate()}
              disabled={activateGate.isPending || !bundle.data}
              testID="phase6-activate-button"
            />
            <StatusIcon status={stepStatus.activate} />
          </View>
          {activateGate.data ? <Text style={styles.note}>Accepted: rulesetId={String(activateGate.data.rulesetId)}, bundleVersion={String(activateGate.data.bundleVersion)}</Text> : null}
        </Card>

        <Card title="3. Run guided tests → evidence attempts">
          <Text style={styles.matrixGroupTitle}>Group 1 — Positive enforcement</Text>
          <Text style={styles.stepBadge}>STEP 3 — Run positive enforcement test</Text>
          <View style={styles.stepRow}>
            <ActionButton title={runPositive.isPending ? "Running (up to 20s)…" : "Run positive enforcement test"} onPress={() => runPositive.mutate()} disabled={runPositive.isPending || !testDomain} testID="phase6-run-positive-button" />
            <StatusIcon status={stepStatus.positive} />
          </View>

          <Text style={styles.matrixGroupTitle}>Group 2 — Negative false-Biting</Text>
          <Text style={styles.stepBadge}>STEP 4 — Rule match alone</Text>
          <View style={styles.stepRow}>
            <ActionButton title="Rule match alone" secondary onPress={() => runNegative.mutate("rule-match-alone")} disabled={runNegative.isPending} testID="phase6-neg-rule-match" />
            <StatusIcon status={stepStatus["neg-rule-match-alone"]} />
          </View>
          <Text style={styles.stepBadge}>STEP 5 — Manual override</Text>
          <View style={styles.stepRow}>
            <ActionButton title="Manual override" secondary onPress={() => runNegative.mutate("manual-override")} disabled={runNegative.isPending || !testDomain} testID="phase6-neg-override" />
            <StatusIcon status={stepStatus["neg-manual-override"]} />
          </View>
          <Text style={styles.stepBadge}>STEP 6 — Local analysis only</Text>
          <View style={styles.stepRow}>
            <ActionButton title="Local analysis only" secondary onPress={() => runNegative.mutate("local-analysis-only")} disabled={runNegative.isPending || !testDomain} testID="phase6-neg-analysis" />
            <StatusIcon status={stepStatus["neg-local-analysis-only"]} />
          </View>
          <Text style={styles.stepBadge}>STEP 7 — Gate start alone</Text>
          <View style={styles.stepRow}>
            <ActionButton title="Gate start alone" secondary onPress={() => runNegative.mutate("gate-start-alone")} disabled={runNegative.isPending} testID="phase6-neg-gate-start" />
            <StatusIcon status={stepStatus["neg-gate-start-alone"]} />
          </View>
          <Text style={styles.stepBadge}>STEP 8 — Failed DNS forward</Text>
          <View style={styles.stepRow}>
            <ActionButton title="Failed DNS forward" secondary onPress={() => runNegative.mutate("failed-dns-forward")} disabled={runNegative.isPending} testID="phase6-neg-failed-dns" />
            <StatusIcon status={stepStatus["neg-failed-dns-forward"]} />
          </View>

          <Text style={styles.matrixGroupTitle}>Groups 3 & 4 — manual-step snapshot</Text>
          <Text style={styles.note}>Android does not let a third-party app trigger these steps itself. For each one below: do the manual action described right there, then immediately tap that step's own Capture snapshot button — it records live protectionState/gate status/network as the evidence for that exact matrix row.</Text>

          <Text style={styles.stepBadge}>STEP 9 — Stop protection (matrix row 3.1)</Text>
          <Text style={styles.note}>Tap "Stop protection" below, then tap "Capture snapshot" right after — confirms status truthfully reports inactive.</Text>
          <View style={styles.stepRow}>
            <ActionButton title="Stop protection" secondary onPress={() => stopProtection.mutate()} disabled={stopProtection.isPending} testID="phase6-stop-protection" />
            <StatusIcon status={stepStatus.stop} />
          </View>
          <View style={styles.stepRow}>
            <ActionButton title="Capture snapshot" secondary onPress={() => captureSnapshot.mutate({ key: "stop", label: "after Stop protection" })} disabled={captureSnapshot.isPending} testID="phase6-snapshot-stop" />
            <StatusIcon status={stepStatus["snapshot-stop"]} />
          </View>

          <View style={styles.howToCard}>
            <Text style={styles.howToTitle}>STEP 10 — Revoke VPN permission mid-session (matrix row 3.2)</Text>
            <Text style={styles.note}>Settings → Network & internet → VPN → this app → Disconnect/Forget. Then come back to this screen and tap "Capture snapshot" below.</Text>
          </View>
          <View style={styles.stepRow}>
            <ActionButton title="Capture snapshot" secondary onPress={() => captureSnapshot.mutate({ key: "revoke", label: "after VPN permission revoke" })} disabled={captureSnapshot.isPending} testID="phase6-snapshot-revoke" />
            <StatusIcon status={stepStatus["snapshot-revoke"]} />
          </View>

          <View style={styles.howToCard}>
            <Text style={styles.howToTitle}>STEP 11 — App restart (matrix row 3.3)</Text>
            <Text style={styles.note}>Force-close the app (Recent apps → swipe away) and relaunch it, navigate back to this screen, then tap "Capture snapshot" below.</Text>
          </View>
          <View style={styles.stepRow}>
            <ActionButton title="Capture snapshot" secondary onPress={() => captureSnapshot.mutate({ key: "restart", label: "after app restart" })} disabled={captureSnapshot.isPending} testID="phase6-snapshot-restart" />
            <StatusIcon status={stepStatus["snapshot-restart"]} />
          </View>

          <View style={styles.howToCard}>
            <Text style={styles.howToTitle}>STEP 12 — Network transition (matrix row 3.4)</Text>
            <Text style={styles.note}>Toggle Wi-Fi/mobile data in Settings, then come back to this screen and tap "Capture snapshot" below.</Text>
          </View>
          <View style={styles.stepRow}>
            <ActionButton title="Capture snapshot" secondary onPress={() => captureSnapshot.mutate({ key: "network", label: "after network transition" })} disabled={captureSnapshot.isPending} testID="phase6-snapshot-network" />
            <StatusIcon status={stepStatus["snapshot-network"]} />
          </View>
        </Card>

        <Card title={`Evidence attempts (${attempts.length})`}>
          {attempts.length === 0 ? <Text style={styles.note}>None yet — run a test above.</Text> : null}
          {attempts.map((a, i) => (
            <View key={`${a.label}-${i}`} style={styles.attemptCard} testID={`phase6-attempt-${i}`}>
              <Text style={styles.matrixTest}>
                #{i + 1} · {a.label}
              </Text>
              <Text style={styles.mono} selectable>
                evidenceId: {a.evidenceId} · threatBlocked: {a.threatBlockedEmitted}
              </Text>
              <Text style={styles.note}>{a.timestamps}</Text>
            </View>
          ))}
        </Card>

        <Card title="4. PASS/FAIL matrix">
          <Text style={styles.matrixGroupTitle}>Group 1 — Positive enforcement</Text>
          <View style={styles.howToCard}>
            <Text style={styles.howToTitle}>HOW TO DETERMINE PASS/FAIL</Text>
            <Text style={styles.note}>
              PASS = the linked evidence attempt above (from Step 3) shows every link in the chain with a real observed timestamp: DNS query → sinkhole → TUN packet → intentional drop → evidence
              record → THREAT_BLOCKED event whose enforcementEvidenceId matches → visible in-app as "Apollo is biting". If any link is missing, unclear, or only inferred rather than directly
              observed, mark FAIL — never guess PASS.
            </Text>
          </View>
          {matrix.filter((r) => r.group === 1).map((r) => <MatrixRowEditor key={r.id} row={r} onChange={updateRow} />)}

          <Text style={styles.matrixGroupTitle}>Group 2 — Negative false-Biting</Text>
          <View style={styles.howToCard}>
            <Text style={styles.howToTitle}>HOW TO DETERMINE PASS/FAIL</Text>
            <Text style={styles.note}>
              PASS = the linked evidence attempt above (from Steps 4–8) shows "none observed (expected/correct)" for threatBlockedEmitted/evidenceId — no fabricated event. FAIL = an event
              unexpectedly appears (marked "UNEXPECTED" in the attempt) — this is a false-Biting / Truth-of-State violation, the most serious possible failure; do not soften it.
            </Text>
          </View>
          {matrix.filter((r) => r.group === 2).map((r) => <MatrixRowEditor key={r.id} row={r} onChange={updateRow} />)}

          <Text style={styles.matrixGroupTitle}>Group 3 — Recovery / stop / revoke</Text>
          <View style={styles.howToCard}>
            <Text style={styles.howToTitle}>HOW TO DETERMINE PASS/FAIL</Text>
            <Text style={styles.note}>
              PASS = the snapshot captured right after the matching manual step (Steps 9–12) truthfully reflects what actually happened — e.g. after Stop, protectionState reports inactive; after
              revoke, it reports the degraded/inactive reason; after restart or a network change nothing stale or fabricated is shown. FAIL = any mismatch between what actually happened and what
              the snapshot reports.
            </Text>
          </View>
          {matrix.filter((r) => r.group === 3).map((r) => <MatrixRowEditor key={r.id} row={r} onChange={updateRow} />)}

          <Text style={styles.matrixGroupTitle}>Group 4 — Private DNS / DoT / DoH</Text>
          <View style={styles.howToCard}>
            <Text style={styles.howToTitle}>HOW TO DETERMINE CAPTURED / BYPASSED / UNOBSERVABLE / FAIL</Text>
            <Text style={styles.note}>
              This group is not simply PASS/FAIL. CAPTURED = the query was seen and enforced exactly like Group 1. BYPASSED = the query never reached Apollo's interception at all — expected for
              Private DNS/DoH, a documented limitation, not a failure. UNOBSERVABLE = you could not tell which of the two happened. Only mark FAIL if you see a fabricated THREAT_BLOCKED for
              traffic that actually bypassed Apollo (that would be a Truth-of-State violation). A bypass is a documented capability result, not something to disguise as a successful block.
            </Text>
          </View>
          {matrix.filter((r) => r.group === 4).map((r) => <MatrixRowEditor key={r.id} row={r} onChange={updateRow} />)}
        </Card>

        <Card title="5. Known capability gaps">
          <Text style={styles.note}>
            For each row: leave "Observed impact" blank only if you did not exercise this bypass path in Group 4 above. If you did (Group 4.3/4.4), describe exactly what you saw — was the traffic
            invisible to Apollo as expected, or did anything unexpected happen (e.g. a fabricated block)? This is a factual record, not a pass/fail judgment.
          </Text>
          {gaps.map((g, i) => (
            <View key={g.gap} style={styles.matrixRow}>
              <Text style={styles.matrixTest}>{g.gap}</Text>
              <Text style={styles.note}>{g.disclosed}</Text>
              <TextInput style={[styles.input, styles.inputManual]} value={g.observedImpact} onChangeText={(v) => updateGap(i, { ...g, observedImpact: v })} placeholder="Observed impact during this run" placeholderTextColor={colors.muted} />
            </View>
          ))}
        </Card>

        <Card title="6. Overall verdict">
          <View style={styles.howToCard}>
            <Text style={styles.howToTitle}>HOW TO DECIDE</Text>
            <Text style={styles.note}>
              • PASS — every Group 1 and Group 2 row above is PASS, every Group 3 row is PASS, and any Group 4 bypass matches the disclosed gaps in Section 5 (no fabricated evidence).{"\n"}• FAIL —
              any Group 1, 2, or 3 row is FAIL — especially any case where THREAT_BLOCKED fired without the full evidence chain, which is a Truth-of-State violation, the most serious failure.{"\n"}•
              PASS WITH DOCUMENTED CAPABILITY GAP — Groups 1–3 all PASS, but Group 4 revealed a real bypass (e.g. Private DNS) now recorded in Section 5, with no fabricated evidence.
            </Text>
          </View>
          <View style={styles.chipsRow}>
            {(["PASS", "FAIL", "PASS WITH DOCUMENTED CAPABILITY GAP"] as Phase6Verdict[]).map((v) => {
              const selected = verdict === v;
              return (
                <Pressable
                  key={v}
                  testID={`phase6-verdict-${v}`}
                  onPress={() => setVerdict(v)}
                  style={[styles.chip, { borderColor: selected ? colors.brandPrimary : colors.borderStrong, backgroundColor: selected ? colors.brandPrimary : "transparent" }]}
                >
                  <Text style={[styles.chipText, { color: selected ? colors.onBrandPrimary : colors.onSurfaceTertiary }]}>{v}</Text>
                </Pressable>
              );
            })}
          </View>
          <Field label="Justification (cite specific matrix row numbers)" value={justification} onChangeText={setJustification} placeholder="e.g. Rows 1.1–1.2, 2.1–2.5 all PASS; Group 3 rows PASS; Group 4 gap documented in Section 5" multiline manual />
          <Field label="Completed by" value={completedBy} onChangeText={setCompletedBy} placeholder="e.g. Jane Doe — 2026-06-15" manual />
        </Card>

        <Card title="Export">
          <Text style={styles.stepBadge}>STEP 13 — Generate + share PDF</Text>
          <View style={styles.stepRow}>
            <ActionButton title={generatePdf.isPending ? "Generating…" : "Generate PDF"} onPress={() => generatePdf.mutate()} disabled={generatePdf.isPending} testID="phase6-generate-pdf" />
            <StatusIcon status={stepStatus.pdf} />
            {pdfUri ? <ActionButton title="Share / Save PDF" secondary onPress={() => shareEvidenceFile(pdfUri)} testID="phase6-share-pdf" /> : null}
          </View>
          {pdfUri ? (
            <Text style={styles.mono} selectable>
              {pdfUri}
            </Text>
          ) : null}
          <Text style={styles.note}>Note: this report captures raw evidence per your own live actions. Classifying each row and choosing the final verdict remains a manual step, per design.</Text>
        </Card>
      </ScrollView>
    </View>
  );
}
