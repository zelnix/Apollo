import { Redirect, useRouter } from "expo-router";
import Shield from "lucide-react-native/icons/shield";
import React from "react";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Body, Button, Card, Pill, SectionTitle } from "@/src/components/ui";
import { requestSiteProtectionRecovery } from "@/src/protection/healthCoordinator";
import { useProtectionHealth } from "@/src/protection/healthStore";
import type { GateHealthRecord } from "@/src/protection/healthTypes";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, spacing, useTheme } from "@/src/theme";

const STATE_LABEL: Record<GateHealthRecord["state"], string> = {
  running: "Running", stopped: "Off", needs_user: "Needs you", manual_only: "One-off check", unsupported: "Not available",
  unavailable: "Unavailable", checking: "Checking", degraded: "Needs attention",
};
const AUTOMATIC = new Set<GateHealthRecord["id"]>(["site", "text", "call"]);

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  content: { paddingHorizontal: spacing.xl, gap: spacing.xl },
  title: { fontFamily: fonts.displayBold, fontSize: 30, color: c.onSurface },
  summary: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  summaryText: { flex: 1, gap: 4 },
  card: { gap: spacing.md },
  row: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md },
  name: { flex: 1, fontFamily: fonts.textSemibold, fontSize: 16, color: c.onSurface },
}));

function HealthCard({ record }: { record: GateHealthRecord }) {
  const s = useStyles();
  const router = useRouter();
  const { showToast } = useApollo();
  const act = async () => {
    if (!record.userAction) return;
    if (record.userAction.kind === "restore_site") {
      const attempt = await requestSiteProtectionRecovery();
      showToast(attempt.status === "failed" ? "Android could not open the approval screen." : "Apollo will check the result when you return.", attempt.status === "failed" ? "growling" : "neutral");
      return;
    }
    if (record.userAction.route) router.push(record.userAction.route as never);
  };
  return <Card testID={`gate-health-${record.id}`} style={s.card}>
    <View style={s.row}>
      <Text testID={`gate-health-${record.id}-title`} style={s.name}>{record.title}</Text>
      <Pill testID={`gate-health-${record.id}-state`} tone={record.state === "running" ? "resting" : record.state === "needs_user" || record.state === "degraded" ? "growling" : "neutral"} label={STATE_LABEL[record.state]} />
    </View>
    <Body testID={`gate-health-${record.id}-scope`}>{record.scope}</Body>
    {record.userAction ? <Button testID={`gate-health-${record.id}-action`} variant={record.state === "needs_user" || record.state === "degraded" ? "primary" : "secondary"} label={record.userAction.label} onPress={() => void act()} /> : null}
  </Card>;
}

export default function GuardScreen() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { ready, setupDone } = useApollo();
  const health = useProtectionHealth();
  if (ready && !setupDone) return <Redirect href="/" />;
  const automatic = health.gates.filter((gate) => AUTOMATIC.has(gate.id));
  const manual = health.gates.filter((gate) => !AUTOMATIC.has(gate.id));
  const active = automatic.filter((gate) => gate.state === "running").length;
  const attention = automatic.filter((gate) => gate.state === "needs_user" || gate.state === "degraded").length;
  return <View style={s.root} testID="gates-screen">
    <ScrollView contentContainerStyle={[s.content, { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + 110 }]}>
      <Text style={s.title} testID="gates-title">Protection</Text>
      <Card testID="gates-summary-card">
        <View style={s.summary}><Shield size={28} color={attention ? colors.growling : colors.brandPrimary} />
          <View style={s.summaryText}><Text style={s.name} testID="gates-summary-title">{attention ? `${attention} protection ${attention === 1 ? "needs" : "need"} you` : `${active} automatic ${active === 1 ? "protection is" : "protections are"} running`}</Text>
            <Body testID="gates-summary-time">{health.checking ? "Checking current device status…" : health.checkedAt ? "Status checked from current device signals." : "Status will appear after the first device check."}</Body></View>
        </View>
      </Card>
      <View testID="gates-automatic-section" style={{ gap: spacing.md }}><SectionTitle>Automatic protection</SectionTitle>{automatic.map((record) => <HealthCard key={record.id} record={record} />)}</View>
      <View testID="gates-manual-section" style={{ gap: spacing.md }}><SectionTitle>One-off checks</SectionTitle>{manual.map((record) => <HealthCard key={record.id} record={record} />)}</View>
    </ScrollView>
  </View>;
}