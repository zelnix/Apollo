import { useRouter } from "expo-router";
import X from "lucide-react-native/icons/x";
import React, { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GATES, runBenchmark, type BenchmarkReport } from "@/src/benchmark/runBenchmark";
import { Body, Button, Card, Pill, SectionTitle } from "@/src/components/ui";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { goBackOrHome } from "@/src/utils/navigation";

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  top: { paddingHorizontal: spacing.xl, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: spacing.md },
  title: { fontFamily: fonts.displayBold, fontSize: 22, color: c.onSurface },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: c.surfaceTertiary },
  content: { paddingHorizontal: spacing.xl, gap: spacing.xl },
  metricRow: { flexDirection: "row", gap: spacing.md },
  metric: { flex: 1, backgroundColor: c.surfaceTertiary, borderRadius: radius.md, padding: spacing.lg, gap: 4 },
  metricValue: { fontFamily: fonts.displayBold, fontSize: 26, color: c.onSurface },
  metricLabel: { fontFamily: fonts.text, fontSize: 12, color: c.onSurfaceSecondary },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: c.divider },
  url: { fontFamily: fonts.text, fontSize: 12, color: c.onSurfaceSecondary, flex: 1 },
}));

export default function Benchmark() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<BenchmarkReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true); setError(null);
    try { setReport(await runBenchmark()); } catch (e) { setError(e instanceof Error ? e.message : "Benchmark failed"); } finally { setBusy(false); }
  };
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const misses = report?.rows.filter((r) => (r.label === "threat" && !r.detected) || r.falsePositive) ?? [];

  return (
    <View style={s.root}>
      <View style={[s.top, { paddingTop: insets.top + spacing.md }]}>
        <Text style={s.title}>Threat benchmark</Text>
        <Pressable testID="benchmark-close" accessibilityRole="button" onPress={() => goBackOrHome(router)} style={s.close}><X size={20} color={colors.onSurface} /></Pressable>
      </View>
      <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xl }]} testID="benchmark-scroll">
        <Card style={{ gap: spacing.md }}>
          <Body>Runs a labelled corpus (60 threats, 60 clean sites) through Apollo&apos;s on-device engine and reputation intelligence, then scores it against the launch gates: detection ≥ {GATES.detectionMin * 100}% and false positives &lt; {GATES.falsePositiveMax * 100}%.</Body>
          <Button testID="benchmark-run" label={busy ? "Running…" : report ? "Run again" : "Run benchmark"} onPress={run} disabled={busy} icon={busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : undefined} />
          {error ? <Text style={{ color: colors.barking, fontFamily: fonts.textMedium }} testID="benchmark-error">{error}</Text> : null}
        </Card>

        {report ? (
          <>
            <Card style={{ gap: spacing.md }} testID="benchmark-results">
              <View style={{ flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" }}>
                <Pill tone={report.gates.pass ? "resting" : "barking"} label={report.gates.pass ? "Gates passed" : "Gates not met"} testID="benchmark-gate" />
                <Pill tone={report.intelCoverage === "full" ? "resting" : "growling"} label={`Intelligence coverage: ${report.intelCoverage}`} testID="benchmark-coverage" />
              </View>
              <View style={s.metricRow}>
                <View style={s.metric}><Text style={[s.metricValue, { color: report.gates.detection ? colors.resting : colors.barking }]} testID="benchmark-detection">{pct(report.detectionRate)}</Text><Text style={s.metricLabel}>Detection ({report.detected}/{report.threats}) · gate ≥ 90%</Text></View>
                <View style={s.metric}><Text style={[s.metricValue, { color: report.gates.falsePositive ? colors.resting : colors.barking }]} testID="benchmark-fp">{pct(report.falsePositiveRate)}</Text><Text style={s.metricLabel}>False positives ({report.falsePositives}/{report.clean}) · gate &lt; 2%</Text></View>
              </View>
              <View style={s.metricRow}>
                <View style={s.metric}><Text style={s.metricValue}>{pct(report.barkingRate)}</Text><Text style={s.metricLabel}>Threats reaching Barking (action needed)</Text></View>
                <View style={s.metric}><Text style={s.metricValue}>{report.rows.filter((r) => r.label === "threat" && r.state === "growling").length}</Text><Text style={s.metricLabel}>Threats held at Growling (uncertain)</Text></View>
              </View>
              <Body>Corpus {report.corpusVersion} · {new Date(report.ranAt).toLocaleString()}</Body>
              {report.intelCoverage !== "full" ? <Body>Reputation intelligence was only partly available, so this run relies more on on-device heuristics than a production run would.</Body> : null}
            </Card>

            <View>
              <SectionTitle>Misses & false positives ({misses.length})</SectionTitle>
              <Card>
                {misses.length === 0 ? <Body>None. Every threat triggered a reaction and every clean site rested.</Body> : misses.map((r) => (
                  <View key={r.url} style={s.row}>
                    <Text style={s.url} numberOfLines={1}>{r.url}</Text>
                    <Pill tone={r.state} label={`${r.label} → ${r.state}`} />
                  </View>
                ))}
              </Card>
            </View>

            <View>
              <SectionTitle>All results</SectionTitle>
              <Card>
                {report.rows.map((r) => (
                  <View key={r.url} style={s.row}>
                    <Text style={s.url} numberOfLines={1}>{r.url}</Text>
                    <Pill tone={r.state} label={`${r.localScore} · ${r.state}`} />
                  </View>
                ))}
              </Card>
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}
