import { useRouter } from "expo-router";
import X from "lucide-react-native/icons/x";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GATES, runBenchmark, type BenchmarkReport } from "@/src/benchmark/runBenchmark";
import { Body, Button, Card, Pill, SectionTitle } from "@/src/components/ui";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { goBackOrHome } from "@/src/utils/navigation";
import { storage } from "@/src/utils/storage";

const HISTORY_KEY = "apollo.benchmark.history";
interface HistoryEntry { ranAt: string; detectionRate: number; falsePositiveRate: number; barkingRate: number; pass: boolean; coverage: string; corpusVersion: string }

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
  chart: { flexDirection: "row", alignItems: "flex-end", gap: 4, height: 120, paddingTop: spacing.sm },
  barWrap: { flex: 1, alignItems: "center", justifyContent: "flex-end", height: "100%", gap: 2 },
  bar: { width: "100%", borderRadius: 3 },
  gateLine: { position: "absolute", left: 0, right: 0, borderTopWidth: 1, borderStyle: "dashed", borderColor: c.borderStrong },
  legend: { fontFamily: fonts.text, fontSize: 11, color: c.muted },
}));

export default function Benchmark() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<BenchmarkReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  useEffect(() => { storage.getItem<string | null>(HISTORY_KEY, null).then((raw) => { if (raw) setHistory(JSON.parse(raw)); }); }, []);

  const run = async () => {
    setBusy(true); setError(null);
    try {
      const r = await runBenchmark();
      setReport(r);
      const entry: HistoryEntry = { ranAt: r.ranAt, detectionRate: r.detectionRate, falsePositiveRate: r.falsePositiveRate, barkingRate: r.barkingRate, pass: r.gates.pass, coverage: r.intelCoverage, corpusVersion: r.corpusVersion };
      const next = [...history, entry].slice(-30);
      setHistory(next); await storage.setItem(HISTORY_KEY, JSON.stringify(next));
    } catch (e) { setError(e instanceof Error ? e.message : "Benchmark failed"); } finally { setBusy(false); }
  };
  const clearHistory = async () => { setHistory([]); await storage.removeItem(HISTORY_KEY); };
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

        {history.length > 0 ? (
          <View>
            <SectionTitle>History ({history.length} run{history.length > 1 ? "s" : ""})</SectionTitle>
            <Card style={{ gap: spacing.md }} testID="benchmark-history">
              <Body>Detection rate per run (green ≥ 90% gate, dashed line). Bars in orange missed a gate.</Body>
              <View style={s.chart} testID="benchmark-chart">
                <View style={[s.gateLine, { bottom: 0.9 * 100 }]} />
                {history.map((h, i) => (
                  <View key={h.ranAt} style={s.barWrap} testID={`benchmark-bar-${i}`}>
                    <View style={[s.bar, { height: `${Math.max(4, h.detectionRate * 100)}%`, backgroundColor: h.pass ? colors.resting : colors.barking }]} />
                  </View>
                ))}
              </View>
              <View style={s.chart} testID="benchmark-chart-fp">
                <View style={[s.gateLine, { bottom: 0.02 * 100 * 5 }]} />
                {history.map((h, i) => (
                  <View key={h.ranAt} style={s.barWrap}>
                    <View style={[s.bar, { height: `${Math.max(3, Math.min(100, h.falsePositiveRate * 100 * 5))}%`, backgroundColor: h.falsePositiveRate < GATES.falsePositiveMax ? colors.resting : colors.barking }]} />
                  </View>
                ))}
              </View>
              <Text style={s.legend}>Second chart: false-positive rate ×5 scale (dashed line = 2% gate). Oldest run on the left.</Text>
              {[...history].reverse().slice(0, 5).map((h) => (
                <View key={h.ranAt} style={s.row}>
                  <Text style={s.url}>{new Date(h.ranAt).toLocaleString()} · {h.coverage}</Text>
                  <Pill tone={h.pass ? "resting" : "barking"} label={`${pct(h.detectionRate)} / ${pct(h.falsePositiveRate)}`} />
                </View>
              ))}
              <Button testID="benchmark-clear-history" variant="ghost" label="Clear history" onPress={clearHistory} />
            </Card>
          </View>
        ) : null}

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
