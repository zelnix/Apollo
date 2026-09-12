// Gate Guard — out-of-band Private DNS (DoT) / app-embedded DoH capability characterization tool.
//
// COMPLETELY SEPARATE from the frozen M2.1 Phase 6A acceptance harness (/phase6-automated,
// src/harness/phase6AutomatedHarness.ts). This screen does not run, re-run, weaken, or affect any
// M2.1 acceptance row or verdict — it is a standalone diagnostic for a different, later milestone:
// documenting Apollo's visibility boundary under various Private DNS / app-embedded DoH
// configurations. Observational only — no mitigation, blocking of port 853, encrypted-DNS
// heuristics, or DoH interception is implemented or exercised here. See
// docs/dns-capability-characterization.md for the full methodology and findings.
import { router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ActionButton, Card, InlineResultCard, KeyValue, RadioGroup } from "@/src/components/harness-ui";
import { readBuildProvenance } from "@/src/harness/buildProvenance";
import { readPhase6DeviceProvenance } from "@/src/harness/phase6DeviceProvenance";
import { shareEvidenceFile } from "@/src/harness/proofReport";
import {
  activateWebsiteGateForDiagnostics,
  type ActivationResult,
  buildAppEmbeddedDohRecord,
  type DnsDiagnosticRecord,
  DNS_DIAGNOSTIC_PROBE_HOST,
  notTestableRecord,
  runPrivateDnsProbe,
  startAppEmbeddedDohObservation,
} from "@/src/diagnostics/dnsCapabilityDiagnostic";
import { exportDnsCharacterizationJson, exportDnsCharacterizationPdf } from "@/src/diagnostics/dnsCapabilityDiagnosticReport";
import { makeStyles, useTheme } from "@/src/theme";

const DOT_MODES = ["Off", "Automatic", "Strict hostname"];
const DOH_STATES = ["DoH ON", "DoH OFF"];
const DOH_OUTCOMES = ["Not yet reported", "Page loaded", "Page did not load"];

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { paddingHorizontal: 20, paddingBottom: 16, gap: 4 },
  backRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  backText: { color: colors.brandPrimary, fontSize: 15, fontWeight: "700" },
  eyebrow: { color: colors.onSurfaceTertiary, fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  title: { color: colors.onSurface, fontSize: 22, fontWeight: "800" },
  subtitle: { color: colors.onSurfaceSecondary, fontSize: 13 },
  content: { paddingHorizontal: 20, gap: 16, paddingBottom: 40 },
  note: { color: colors.onSurfaceTertiary, fontSize: 12, lineHeight: 17 },
  buttonRow: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  errorText: { color: colors.error, fontSize: 12, fontWeight: "600" },
  scopeBanner: { backgroundColor: colors.surfaceTertiary, borderRadius: 12, padding: 12, gap: 4, borderWidth: 1, borderColor: colors.border },
  scopeBannerText: { color: colors.onSurfaceSecondary, fontSize: 11, lineHeight: 16 },
}));

function classificationTone(c: DnsDiagnosticRecord["classification"]): "good" | "bad" | "neutral" {
  if (c === "CAPTURED") return "good";
  if (c === "BYPASSED") return "bad";
  return "neutral";
}

export default function DnsCapabilityDiagnosticScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  const [sessionId] = useState(() => `dns-doh-${Date.now()}`);
  const [sessionStartedAt] = useState(() => new Date().toISOString());
  const [activation, setActivation] = useState<ActivationResult | null>(null);
  const [activating, setActivating] = useState(false);
  const [records, setRecords] = useState<DnsDiagnosticRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [dotMode, setDotMode] = useState(DOT_MODES[0]);
  const [dotDetail, setDotDetail] = useState("");

  const [dohBrowserLabel, setDohBrowserLabel] = useState("");
  const [dohState, setDohState] = useState(DOH_STATES[0]);
  const [dohOutcome, setDohOutcome] = useState(DOH_OUTCOMES[0]);
  const [dohObservation, setDohObservation] = useState<{ startedAt: string; finish: () => Promise<import("@/src/contracts/securityEventSchemas").SecurityEvent | null> } | null>(null);

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

  async function handleRunDotProbe() {
    setBusy(true);
    setError(null);
    try {
      const label = dotDetail.trim() ? `Private DNS: ${dotMode} (${dotDetail.trim()})` : `Private DNS: ${dotMode}`;
      const record = await runPrivateDnsProbe(label);
      setRecords((prev) => [record, ...prev]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function handleStartDohWindow() {
    setError(null);
    setDohOutcome(DOH_OUTCOMES[0]);
    setDohObservation(startAppEmbeddedDohObservation(90_000));
  }

  async function handleFinishDohWindow() {
    if (!dohObservation) return;
    setBusy(true);
    setError(null);
    try {
      const event = await dohObservation.finish();
      const browserLoaded = dohOutcome === "Page loaded" ? true : dohOutcome === "Page did not load" ? false : null;
      const label = `${dohBrowserLabel.trim() || "Unnamed browser"}, ${dohState}`;
      const record = await buildAppEmbeddedDohRecord(label, event, browserLoaded, dohObservation.startedAt);
      setRecords((prev) => [record, ...prev]);
      setDohObservation(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function handleMarkNotTestable(category: "private-dns" | "app-embedded-doh", label: string, reason: string) {
    setRecords((prev) => [notTestableRecord(category, label, reason), ...prev]);
  }

  async function buildRun() {
    const [buildProvenance, deviceProvenance] = await Promise.all([readBuildProvenance(), Promise.resolve(readPhase6DeviceProvenance())]);
    return { runId: sessionId, startedAt: sessionStartedAt, records: [...records].reverse(), buildProvenance, deviceProvenance };
  }

  async function handleExportJson() {
    setBusy(true);
    setError(null);
    try {
      const run = await buildRun();
      const uri = await exportDnsCharacterizationJson(run);
      if (uri) await shareEvidenceFile(uri);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleExportPdf() {
    setBusy(true);
    setError(null);
    try {
      const run = await buildRun();
      const uri = await exportDnsCharacterizationPdf(run);
      if (uri) await shareEvidenceFile(uri);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.root} testID="dns-doh-diagnostic-screen">
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => router.back()} style={styles.backRow} testID="dns-doh-back">
          <Text style={styles.backText}>‹ Back</Text>
        </Pressable>
        <Text style={styles.eyebrow}>OUT-OF-BAND · OBSERVATIONAL ONLY</Text>
        <Text style={styles.title}>Private DNS / DoH Capability Diagnostic</Text>
        <Text style={styles.subtitle}>Separate from the frozen M2.1 acceptance harness — characterizes what Apollo can and cannot see.</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.scopeBanner}>
          <Text style={styles.scopeBannerText}>
            This tool never blocks, enforces, or changes routing — it only records evidence for later documentation. Android does not expose the system Private DNS setting or another app&apos;s DoH setting to this app, so you label each configuration manually after changing it yourself.
          </Text>
        </View>

        <Card title="1 · Activate protection + Website Gate">
          <Text style={styles.note}>Required once per session before running any probe below. Uses the same live signed rule bundle as production — including the dedicated probe rule for {DNS_DIAGNOSTIC_PROBE_HOST}.</Text>
          <ActionButton title={activating ? "Activating…" : "Activate"} onPress={handleActivate} disabled={activating} testID="dns-doh-activate" />
          {activation ? (
            <>
              <KeyValue label="Status" value={activation.ok ? "Active" : `Failed: ${activation.reason}`} testID="dns-doh-activation-status" />
              {activation.ok ? <KeyValue label="Probe rule confirmed in bundle" value={activation.probeRuleConfirmedInBundle ? "yes" : "NO — probes will be unattributable"} /> : null}
            </>
          ) : null}
        </Card>

        <Card title="2 · Private DNS (DoT) probe">
          <Text style={styles.note}>In Android Settings → Network &amp; internet → Private DNS, set the mode below, come back, then run the probe — it&apos;s fully automatic from here.</Text>
          <RadioGroup label="Mode set in Android Settings" options={DOT_MODES} value={dotMode} onChange={setDotMode} testID="dns-doh-dot-mode" />
          <Text style={styles.note}>Optional detail (e.g. provider hostname for Strict mode):</Text>
          <TextInputLike value={dotDetail} onChangeText={setDotDetail} placeholder="e.g. dns.google" />
          <ActionButton title="Open Private DNS Settings" secondary onPress={() => Platform.OS === "android" && Linking.sendIntent("android.settings.PRIVATE_DNS_SETTINGS").catch(() => Linking.openSettings())} testID="dns-doh-open-private-dns-settings" />
          <ActionButton title={busy ? "Running…" : "Run probe"} onPress={handleRunDotProbe} disabled={busy || !activation?.ok} testID="dns-doh-run-dot-probe" />
          <ActionButton title="Mark this configuration NOT_TESTABLE" secondary onPress={() => handleMarkNotTestable("private-dns", `Private DNS: ${dotMode}`, "Tester marked this configuration as not testable on this device/OS.")} testID="dns-doh-dot-not-testable" />
        </Card>

        <Card title="3 · App-embedded DoH probe">
          <Text style={styles.note}>
            This app cannot trigger or observe another app&apos;s DoH request. Start the window, switch to the target browser, navigate to https://{DNS_DIAGNOSTIC_PROBE_HOST}/, note whether it loaded, then come back and finish.
          </Text>
          <Text style={styles.note} testID="dns-doh-label-hint">Browser name / version:</Text>
          <TextInputLike value={dohBrowserLabel} onChangeText={setDohBrowserLabel} placeholder="e.g. Firefox 143" />
          <RadioGroup label="DoH setting in that browser" options={DOH_STATES} value={dohState} onChange={setDohState} testID="dns-doh-state" />
          {!dohObservation ? (
            <ActionButton title="Start 90s observation window" onPress={handleStartDohWindow} disabled={busy || !activation?.ok} testID="dns-doh-start-window" />
          ) : (
            <>
              <Text style={styles.note}>Window running since {dohObservation.startedAt}. Switch apps now — this keeps listening in the background.</Text>
              <RadioGroup label="What happened in the browser?" options={DOH_OUTCOMES} value={dohOutcome} onChange={setDohOutcome} testID="dns-doh-outcome" />
              <ActionButton title={busy ? "Finishing…" : "Finish & classify"} onPress={handleFinishDohWindow} disabled={busy} testID="dns-doh-finish-window" />
            </>
          )}
          <ActionButton title="Mark this configuration NOT_TESTABLE" secondary onPress={() => handleMarkNotTestable("app-embedded-doh", `${dohBrowserLabel.trim() || "Unnamed browser"}, ${dohState}`, "Tester marked this configuration as not testable (e.g. browser unavailable on this device).")} testID="dns-doh-doh-not-testable" />
        </Card>

        {error ? <Text style={styles.errorText} testID="dns-doh-error">{error}</Text> : null}
        {busy ? <ActivityIndicator color={colors.brandPrimary} /> : null}

        <Card title={`4 · Results (${records.length})`}>
          {records.length === 0 ? (
            <Text style={styles.note}>No probes recorded yet.</Text>
          ) : (
            records.map((r) => (
              <InlineResultCard
                key={r.id}
                tone={classificationTone(r.classification)}
                title={`${r.classification} — ${r.configurationLabel}`}
                testID={`dns-doh-record-${r.id}`}
                rows={[
                  ["Category", r.category],
                  ["Probe host", r.probeHostname],
                  ["Network", r.transportNetworkType ?? "unknown"],
                  ["Saw plaintext UDP/53", r.sawPlaintextUdp53 ? "yes" : "no"],
                  ["Independent success", r.independentSuccess === null ? "n/a" : r.independentSuccess ? `yes (${r.independentSuccessSource})` : `no (${r.independentSuccessSource})`],
                  ...(r.notes ? ([["Notes", r.notes]] as [string, string][]) : []),
                ]}
              />
            ))
          )}
        </Card>

        <Card title="5 · Export evidence">
          <Text style={styles.note}>Session ID: {sessionId}</Text>
          <View style={styles.buttonRow}>
            <ActionButton title="Export JSON" secondary onPress={handleExportJson} disabled={busy || records.length === 0} testID="dns-doh-export-json" />
            <ActionButton title="Export PDF" onPress={handleExportPdf} disabled={busy || records.length === 0} testID="dns-doh-export-pdf" />
          </View>
        </Card>
      </ScrollView>
    </View>
  );
}

/** Minimal themed text input — this screen only needs free-text labels, not a full form library. */
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
