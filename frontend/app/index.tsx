import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ActionButton, Card, KeyValue, StatusBadge, StepRow } from "@/src/components/harness-ui";
import type { SecurityEvent } from "@/src/contracts/securityEventSchemas";
import { type HarnessStep, runAndroidBlockingProof } from "@/src/harness/androidBlockingProofHarness";
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
}));

export default function Index() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [steps, setSteps] = useState<HarnessStep[]>([]);
  const [url, setUrl] = useState("https://m1-block-test.guarddog.example/login?token=SECRET");
  const [analysis, setAnalysis] = useState<LocalAnalysis | null | undefined>(undefined);
  const analyze = () => setAnalysis(GuardDogSecuritySDK.analyzeUrl(url));

  const config = useQuery({ queryKey: ["m1-config"], queryFn: fetchM1Config });
  const bundle = useQuery({ queryKey: ["m1-bundle", config.data?.rulesetId], queryFn: () => fetchLatestBundle(config.data!.rulesetId), enabled: !!config.data });
  const proof = useMutation({
    mutationFn: () => {
      setSteps([]);
      return runAndroidBlockingProof((step) => setSteps((prev) => [...prev, step]));
    },
  });

  useEffect(() => GuardDogSecuritySDK.onSecurityEvent((event) => setEvents((prev) => [event, ...prev].slice(0, 30))), []);
  useEffect(() => {
    if (bundle.data && !GuardDogSecuritySDK.nativeAvailable) GuardDogSecuritySDK.acceptRuleBundle(bundle.data);
  }, [bundle.data]);

  const caps = GuardDogSecuritySDK.getCapabilities();
  const status = GuardDogSecuritySDK.getProtectionState();
  const blocked = events.filter((e) => e.type === "THREAT_BLOCKED").length;

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined} testID="harness-screen">
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.eyebrow}>GUARD DOG · M1 PROOF HARNESS</Text>
        <Text style={styles.title}>Selective Block Proof</Text>
        <Text style={styles.subtitle}>{caps.platform} · {caps.selectiveIpBlocking ? "selective /32 enforcement available" : "no enforcement layer in this runtime"}</Text>
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
        <Card title="Protection state" testID="protection-state-card">
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <StatusBadge status={status.state} testID="protection-state-badge" />
            <Text style={styles.note} testID="protection-state-reason">{status.reason ?? (status.consentGranted ? "consent granted" : "consent not granted")}</Text>
          </View>
          <KeyValue label="Blocked events (genuine)" value={String(blocked)} testID="blocked-count" />
          <KeyValue label="Rejected bridge payloads" value={String(GuardDogSecuritySDK.rejectedEventCount)} testID="rejected-count" />
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
            <ActionButton title={proof.isPending ? "Running…" : "Run proof"} disabled={proof.isPending || !config.data} onPress={() => proof.mutate()} testID="run-proof-button" />
            <ActionButton title="Stop protection" secondary onPress={() => GuardDogSecuritySDK.stopProtection()} testID="stop-protection-button" />
          </View>
          {proof.error ? <Text style={[styles.note, { color: colors.error }]} testID="harness-error">{String(proof.error)}</Text> : null}
          {steps.length === 0 ? <Text style={styles.empty} testID="harness-empty">No run yet. Steps that cannot happen here are reported BLOCKED, never faked.</Text> : steps.map((s) => <StepRow key={s.id} step={s} />)}
          {proof.data ? (
            <Text style={[styles.note, { color: proof.data.proofComplete ? colors.success : colors.warning }]} testID="harness-verdict">
              {proof.data.proofComplete ? "Genuine end-to-end block proven." : "Proof incomplete: requires Android native build + real controlled endpoint."}
            </Text>
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
