import { useMutation, useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ActionButton, Card, KeyValue, StatusBadge, StepRow } from "@/src/components/harness-ui";
import type { SecurityEvent } from "@/src/contracts/securityEventSchemas";
import { type HarnessStep, type ProofMode, runAndroidBlockingProof } from "@/src/harness/androidBlockingProofHarness";
import { runAndroidRevokeProof } from "@/src/harness/androidRevokeProofHarness";
import { readBuildProvenance, type BuildProvenance } from "@/src/harness/buildProvenance";
import { buildProofReport, exportReportJson, exportReportPdf, type ProofReport, shareEvidenceFile } from "@/src/harness/proofReport";
import { fetchLatestBundle, fetchM1Config } from "@/src/harness/ruleBundleFixtures";
import { GuardDogSecuritySDK, type LocalAnalysis } from "@/src/sdk/GuardDogSecuritySDK";
import { makeStyles, useTheme } from "@/src/theme";

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: 20, paddingBottom: 16, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.divider },
  eyebrow: { color: colors.brandPrimary, fontSize: 12, fontWeight: "800", letterSpacing: 2 },
  title: { color: colors.onSurface, fontSize: 28, fontWeight: "800", marginTop: 4 },
  subtitle: { color: colors.muted, fontSize: 14, marginTop: 4 },
  content: { padding: 16, gap: 16 },
  input: { minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.borderStrong, backgroundColor: colors.surfaceTertiary, color: colors.onSurfaceTertiary, paddingHorizontal: 14, fontSize: 15 },
  mono: { color: colors.onSurfaceTertiary, fontSize: 12, fontFamily: "monospace" },
  note: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  eventRow: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.divider, gap: 2 },
  eventType: { color: colors.onSurfaceSecondary, fontWeight: "700", fontSize: 13 },
  actions: { flexDirection: "row", gap: 12, flexWrap: "wrap" },
  empty: { color: colors.muted, fontSize: 13, fontStyle: "italic" },
  prompt: { borderRadius: 12, borderWidth: 1, borderColor: colors.warning, backgroundColor: colors.surfaceTertiary, padding: 12, gap: 4 },
  promptTitle: { color: colors.warning, fontSize: 12, fontWeight: "800", letterSpacing: 1.5 },
  promptText: { color: colors.onSurfaceTertiary, fontSize: 14, lineHeight: 20 },
}));

export default function Index() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [steps, setSteps] = useState<HarnessStep[]>([]);
  const [url, setUrl] = useState("");
  const [analysis, setAnalysis] = useState<LocalAnalysis | null | undefined>(undefined);
  const [report, setReport] = useState<ProofReport | null>(null);
  const [provenance, setProvenance] = useState<BuildProvenance | null>(null);
  const [pdfUri, setPdfUri] = useState<string | null>(null);
  const [jsonUri, setJsonUri] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<string | null>(null);
  const analyze = () => setAnalysis(GuardDogSecuritySDK.analyzeUrl(url));

  const config = useQuery({ queryKey: ["m1-config"], queryFn: fetchM1Config });
  const bundle = useQuery({ queryKey: ["m1-bundle", config.data?.rulesetId], queryFn: () => fetchLatestBundle(config.data!.rulesetId), enabled: !!config.data });
  const proof = useMutation({
    mutationFn: (mode: ProofMode) => {
      setSteps([]);
      setReport(null);
      setJsonUri(null);
      setPdfUri(null);
      setPrompt(null);
      const onStep = (step: HarnessStep) => setSteps((prev) => [...prev, step]);
      return mode === "revoke" ? runAndroidRevokeProof(onStep, setPrompt) : runAndroidBlockingProof(onStep);
    },
    onSettled: () => setPrompt(null),
  });

  useEffect(() => GuardDogSecuritySDK.onSecurityEvent((event) => setEvents((prev) => [event, ...prev].slice(0, 30))), []);
  // CI start-up smoke marker (scripts/ci/android-startup-smoke.sh reads it from logcat): emitted once after the first committed render,
  // i.e. only when React Native bootstrapped, the bundle executed and the harness screen mounted. Carries the build provenance so the
  // smoke log is bound to the CI run.
  useEffect(() => {
    readBuildProvenance().then((p) => {
      setProvenance(p);
      console.log(`GD_SMOKE_READY ${JSON.stringify({ gitSha: p.gitSha, ciRunId: p.ciRunId, apkSha256: p.apkSha256, native: GuardDogSecuritySDK.nativeAvailable })}`);
    });
  }, []);
  useEffect(() => {
    if (config.data && url === "") setUrl(`https://${config.data.controlledEndpoint.host}/login?token=SECRET`);
  }, [config.data, url]);
  useEffect(() => {
    if (bundle.data && !GuardDogSecuritySDK.nativeAvailable) GuardDogSecuritySDK.acceptRuleBundle(bundle.data);
  }, [bundle.data]);

  const caps = GuardDogSecuritySDK.getCapabilities();
  const status = GuardDogSecuritySDK.getProtectionState();
  const blocked = events.filter((e) => e.type === "THREAT_BLOCKED").length;

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined} testID="harness-screen">
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.eyebrow}>APOLLO NATIVE GATES · M1 PROOF HARNESS</Text>
        <Text style={styles.title}>Selective Block Proof</Text>
        <Text style={styles.subtitle}>{caps.platform} · {caps.selectiveIpBlocking ? "selective /32 enforcement available" : "no enforcement layer in this runtime"}</Text>
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
        <Card title="Gate Guard M2.1 · Phase 6" testID="phase6-nav-card">
          <Text style={styles.note}>Physical-device acceptance report runner for the Website Gate (DNS→sinkhole→TUN evidence chain, PASS/FAIL matrix, PDF export). Real data requires a native Android build.</Text>
          <View style={styles.actions}>
            <ActionButton title="Open Phase 6 Acceptance Report Runner" onPress={() => router.push("/phase6-acceptance")} testID="open-phase6-button" />
          </View>
        </Card>

        <Card title="Protection state" testID="protection-state-card">
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <StatusBadge status={status.state} testID="protection-state-badge" />
            <Text style={styles.note} testID="protection-state-reason">{status.reason ?? (status.consentGranted ? "consent granted" : "consent not granted")}</Text>
          </View>
          <KeyValue label="Blocked events (genuine)" value={String(blocked)} testID="blocked-count" />
          <KeyValue label="Rejected bridge payloads" value={String(GuardDogSecuritySDK.rejectedEventCount)} testID="rejected-count" />
        </Card>

        {/* Read-only, harness-only: lets the phone's installed build be matched against CI (apk-provenance.json) BEFORE any enforcement proof runs. */}
        <Card title="Build provenance (this installed APK)" testID="provenance-card">
          {provenance ? (
            <>
              <Text style={styles.note}>APK SHA-256 (must equal apk-provenance.json.apkSha256 of the CI run)</Text>
              <Text style={styles.mono} selectable testID="provenance-apk-sha">{provenance.apkSha256 ?? "unavailable (not an installed Android APK)"}</Text>
              <Text style={styles.note}>Git SHA (EXPO_PUBLIC_GIT_SHA baked into this JS bundle)</Text>
              <Text style={styles.mono} selectable testID="provenance-git-sha">{provenance.gitSha ?? "not baked in (non-CI bundle)"}</Text>
              <KeyValue label="CI run ID" value={provenance.ciRunId ?? "not baked in (non-CI bundle)"} testID="provenance-run-id" />
              <KeyValue label="Native module available" value={GuardDogSecuritySDK.nativeAvailable ? "yes" : "no"} testID="provenance-native" />
              {provenance.packageName ? <Text style={styles.mono} testID="provenance-package">{provenance.packageName} · v{provenance.versionName} ({provenance.versionCode}) · {provenance.debuggable ? "debuggable" : "release"}{provenance.splitApks ? ` · ${provenance.splitApks} split APK(s)` : ""}</Text> : null}
            </>
          ) : (
            <ActivityIndicator color={colors.brandPrimary} testID="provenance-loading" />
          )}
        </Card>

        <Card title="Backend · signed rules" testID="backend-card">
          {config.isLoading || bundle.isLoading ? <ActivityIndicator color={colors.brandPrimary} testID="backend-loading" /> : null}
          {config.error ? <Text style={[styles.note, { color: colors.error }]} testID="backend-error">{String(config.error)}</Text> : null}
          {config.data ? (
            <>
              <KeyValue label="Ruleset" value={config.data.rulesetId} testID="config-ruleset" />
              <KeyValue label="Controlled host" value={config.data.controlledEndpoint.host} testID="config-host" />
              <KeyValue label="Dedicated IPv4" value={config.data.controlledEndpoint.ipv4} testID="config-ipv4" />
              <KeyValue label="Signing key" value={config.data.signingKeyId} testID="config-key" />
            </>
          ) : null}
          {bundle.data ? (
            <>
              <KeyValue label="Bundle version" value={`v${bundle.data.bundleVersion} · ${bundle.data.payload.rules.length} rule(s)`} testID="bundle-version" />
              <Text style={styles.mono} testID="bundle-hash">payloadHash {bundle.data.payloadHash.slice(0, 32)}…</Text>
            </>
          ) : null}
        </Card>

        <Card title="Local URL analysis (never leaves device)" testID="analysis-card">
          <TextInput
            testID="analyze-url-input"
            style={styles.input}
            value={url}
            onChangeText={setUrl}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="done"
            placeholder="https://…"
            placeholderTextColor={colors.muted}
            onSubmitEditing={analyze}
          />
          <ActionButton title="Analyze locally" secondary onPress={analyze} testID="analyze-url-button" />
          {analysis ? (
            <>
              <KeyValue label="Verdict" value={analysis.verdict + (analysis.ruleId ? ` (${analysis.ruleId})` : "")} testID="analysis-verdict" />
              <KeyValue label="Shareable sanitizedUrl" value={analysis.sanitizedUrl} testID="analysis-sanitized-url" />
              <Text style={styles.note}>Query, fragment and credentials were stripped. A rule match is a verdict, not a block.</Text>
            </>
          ) : analysis === null ? (
            <Text style={styles.empty} testID="analysis-invalid">Not an analyzable http(s) URL.</Text>
          ) : null}
        </Card>

        <Card title="Acceptance chain" testID="harness-card">
          <View style={styles.actions}>
            <ActionButton title={proof.isPending && proof.variables === "block" ? "Running…" : "Run proof"} disabled={proof.isPending || !config.data} onPress={() => proof.mutate("block")} testID="run-proof-button" />
            <ActionButton title={proof.isPending && proof.variables === "revoke" ? "Waiting…" : "Run revoke proof"} secondary disabled={proof.isPending || !config.data} onPress={() => proof.mutate("revoke")} testID="run-revoke-proof-button" />
            <ActionButton title="Stop protection" secondary onPress={() => GuardDogSecuritySDK.stopProtection()} testID="stop-protection-button" />
          </View>
          {prompt ? (
            <View style={styles.prompt} testID="harness-prompt">
              <Text style={styles.promptTitle}>ACTION REQUIRED ON THE PHONE</Text>
              <Text style={styles.promptText}>{prompt}</Text>
            </View>
          ) : null}
          {proof.error ? <Text style={[styles.note, { color: colors.error }]} testID="harness-error">{String(proof.error)}</Text> : null}
          {steps.length === 0 ? <Text style={styles.empty} testID="harness-empty">No run yet. Steps that cannot happen here are reported BLOCKED, never faked.</Text> : steps.map((s) => <StepRow key={s.id} step={s} />)}
          {proof.data ? (
            <Text style={[styles.note, { color: proof.data.recoveryComplete || proof.data.revokeComplete ? colors.success : colors.warning }]} testID="harness-verdict">
              {proof.data.mode === "revoke"
                ? proof.data.revokeComplete
                  ? "Genuine system revocation observed, cleanup and consent reset proven, no silent restart."
                  : "Revoke proof incomplete (see steps): requires a real external revocation on the device."
                : proof.data.recoveryComplete
                  ? "Genuine end-to-end block AND recovery proven."
                  : proof.data.proofComplete
                    ? "Block proven; recovery incomplete (see recovery steps)."
                    : "Proof incomplete: requires Android native build + real controlled endpoint."}
            </Text>
          ) : null}
        </Card>

        <Card title="Proof report export (local JSON + PDF)" testID="report-card">
          <View style={styles.actions}>
            <ActionButton
              title="Build JSON evidence"
              secondary
              disabled={!proof.data || !config.data}
              onPress={async () => {
                const provenance = await readBuildProvenance().catch(() => null);
                const built = buildProofReport(config.data!, bundle.data ?? null, proof.data!, events, provenance);
                setReport(built);
                setJsonUri((await exportReportJson(built)) ?? "shown below (web: no file system)");
              }}
              testID="build-report-button"
            />
            <ActionButton
              title="Export PDF"
              disabled={!report}
              onPress={async () => setPdfUri((await exportReportPdf(report!)) ?? "print dialog opened")}
              testID="export-pdf-button"
            />
          </View>
          {report ? (
            <>
              <KeyValue label="Proof mode" value={report.mode} testID="report-mode" />
              {report.mode === "revoke" ? (
                <KeyValue label="Revoke proof complete" value={report.revokeComplete ? "yes" : "no — lifecycle item open"} testID="report-revoke-complete" />
              ) : (
                <>
                  <KeyValue label="Block proof complete" value={report.proofComplete ? "yes" : "no — milestone open"} testID="report-proof-complete" />
                  <KeyValue label="Recovery proof complete" value={report.recoveryComplete ? "yes" : "no"} testID="report-recovery-complete" />
                  <KeyValue label="enforcementEvidenceId" value={report.auditChain.enforcementEvidenceId ?? "none"} testID="report-evidence-id" />
                </>
              )}
              <KeyValue label="APK SHA-256" value={report.provenance?.apkSha256 ?? "n/a (not an Android APK)"} testID="report-apk-sha" />
              <KeyValue label="Commit / CI run" value={`${report.provenance?.gitSha ?? "—"} / ${report.provenance?.ciRunId ?? "—"}`} testID="report-provenance" />
              {report.auditChain.recovery ? (
                <KeyValue
                  label="Recovery"
                  value={`${report.auditChain.recovery.stateAfterStop} · TUN ${report.auditChain.recovery.tunOpen === false ? "closed" : "open/unknown"} · HTTPS ${report.auditChain.recovery.httpsStatusAfterStop ?? "—"}`}
                  testID="report-recovery"
                />
              ) : null}
              {report.auditChain.revocation ? (
                <KeyValue
                  label="Revocation"
                  value={`${report.auditChain.revocation.stateAfterRevoke} · TUN ${report.auditChain.revocation.tunOpen === false ? "closed" : "open/unknown"} · sdk consent ${report.auditChain.revocation.consentGrantedAfterRevoke === false ? "cleared" : "NOT cleared"} · restart ${report.auditChain.revocation.restartWithoutConsent} · OS prepared-state obs. prepare()!=null=${String(report.auditChain.revocation.osConsentRequiredAfterRevoke)}`}
                  testID="report-revocation"
                />
              ) : null}
              <Text style={styles.mono} numberOfLines={12} testID="report-json">{JSON.stringify(report.auditChain, null, 1)}</Text>
            </>
          ) : (
            <Text style={styles.empty} testID="report-empty">Run the proof first. The report only contains observed results.</Text>
          )}
          {jsonUri ? (
            <View style={styles.actions}>
              <Text style={[styles.note, { flex: 1 }]} testID="report-json-uri">JSON: {jsonUri}</Text>
              {jsonUri.startsWith("file") ? <ActionButton title="Share JSON" secondary onPress={() => shareEvidenceFile(jsonUri)} testID="share-json-button" /> : null}
            </View>
          ) : null}
          {pdfUri ? (
            <View style={styles.actions}>
              <Text style={[styles.note, { flex: 1 }]} testID="report-pdf-uri">PDF: {pdfUri}</Text>
              {pdfUri.startsWith("file") ? <ActionButton title="Share PDF" secondary onPress={() => shareEvidenceFile(pdfUri)} testID="share-pdf-button" /> : null}
            </View>
          ) : null}
        </Card>

        <Card title="Security events" testID="events-card">
          {events.length === 0 ? <Text style={styles.empty} testID="events-empty">No events received from the SDK.</Text> : null}
          {events.map((e) => (
            <View key={e.id} style={styles.eventRow} testID={`event-${e.type}`}>
              <Text style={styles.eventType}>{e.type} · {e.source}</Text>
              <Text style={styles.mono}>{e.enforcementEvidenceId ? `evidence ${e.enforcementEvidenceId} · ` : ""}{e.host ?? e.protectionState ?? e.reason ?? ""}</Text>
            </View>
          ))}
        </Card>

        <Text style={styles.note} testID="scope-note">
          M1 scope: Android selective /32 route against a Guard Dog-controlled dedicated IP only. No DNS interception, DoH/DoT, QUIC visibility, per-app attribution or universal protection is claimed. iOS: analysis and warning only.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
